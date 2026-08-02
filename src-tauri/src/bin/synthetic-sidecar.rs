//! Test-only sidecar executable used by the real-process supervisor tests.
//!
//! It intentionally contains no chat parser and accepts only fabricated
//! protocol input.  Cargo builds it for tests; the Tauri application does not
//! bundle it as the production sidecar.

use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::process::{self, Command};
use std::thread;
use std::time::{Duration, Instant};

const PROTOCOL: &str = "chat-history-analysis.sidecar.v1";

fn read_configuration() -> (String, u64) {
    let mut length = [0u8; 4];
    io::stdin()
        .read_exact(&mut length)
        .expect("configuration length");
    let size = u32::from_be_bytes(length) as usize;
    let mut payload = vec![0u8; size];
    io::stdin().read_exact(&mut payload).expect("configuration");
    let value: Value = serde_json::from_slice(&payload).expect("configuration json");
    let session_id = value
        .get("sessionId")
        .and_then(Value::as_str)
        .expect("session id")
        .to_string();
    let generation = value
        .get("generation")
        .and_then(Value::as_u64)
        .expect("generation");
    (session_id, generation)
}

fn emit(value: Value) {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, &value).expect("synthetic stdout");
    stdout.write_all(b"\n").expect("synthetic newline");
    stdout.flush().expect("synthetic flush");
}

fn mode() -> String {
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--mode" {
            return arguments.next().unwrap_or_else(|| "success".to_string());
        }
    }
    "success".to_string()
}

fn argument_value(name: &str) -> Option<String> {
    std::env::args()
        .skip(1)
        .collect::<Vec<_>>()
        .windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn sleep_through_signals(duration: Duration) {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        thread::sleep(remaining);
    }
}

#[cfg(unix)]
fn ignore_termination_signals() {
    extern "C" fn ignore(_: i32) {}
    unsafe extern "C" {
        fn signal(signal: i32, handler: extern "C" fn(i32)) -> usize;
    }
    unsafe {
        signal(2, ignore);
        signal(15, ignore);
    }
}

#[cfg(not(unix))]
fn ignore_termination_signals() {}

fn main() {
    let selected_mode = mode();
    if matches!(selected_mode.as_str(), "ignore-cancel" | "grandchild") {
        ignore_termination_signals();
    }
    if let Some(path) = argument_value("--ready-file") {
        std::fs::write(path, b"ready").expect("synthetic ready file");
    }
    let (session_id, generation) = read_configuration();
    if selected_mode == "early-exit" {
        process::exit(17);
    }
    if selected_mode == "crash" {
        process::abort();
    }
    if selected_mode == "sensitive-stderr" {
        eprintln!("/private/synthetic-source.json traceback private-token");
    }
    if selected_mode == "malformed" {
        println!("not-json");
        return;
    }
    if selected_mode == "excessive" {
        println!("{}", "x".repeat(20_000));
        return;
    }
    if selected_mode == "protocol-mismatch" {
        emit(json!({
            "protocolVersion": "chat-history-analysis.sidecar.v0",
            "type": "progress",
            "sessionId": session_id,
            "generation": generation,
            "phase": "startup",
            "percentage": 1,
            "status": "running",
            "aggregateCount": 0,
            "capacityValue": 1
        }));
        return;
    }
    let event_session = if selected_mode == "wrong-session" {
        "ses_00000000000000000000000000000000".to_string()
    } else {
        session_id.clone()
    };
    emit(json!({
        "protocolVersion": PROTOCOL,
        "type": "progress",
        "sessionId": event_session,
        "generation": generation,
        "phase": "startup",
        "percentage": 0,
        "status": "running",
        "aggregateCount": 0,
        "capacityValue": 1
    }));
    if selected_mode == "delay" {
        thread::sleep(Duration::from_secs(5));
    }
    if matches!(selected_mode.as_str(), "ignore-cancel" | "grandchild") {
        if selected_mode == "grandchild" {
            let child = Command::new("/bin/sleep")
                .arg("60")
                .spawn()
                .expect("synthetic grandchild");
            if let Some(path) = argument_value("--pid-file") {
                std::fs::write(path, child.id().to_string()).expect("synthetic pid file");
            }
            // The supervisor owns the process group and deliberately kills
            // both this process and the descendant; waiting here would keep
            // the fixture alive past the cancellation boundary.
            std::mem::forget(child);
        }
        sleep_through_signals(Duration::from_secs(60));
    }
    if selected_mode == "no-terminal" {
        sleep_through_signals(Duration::from_secs(60));
        return;
    }
    if selected_mode == "out-of-order" {
        emit(json!({
            "protocolVersion": PROTOCOL,
            "type": "progress",
            "sessionId": session_id,
            "generation": generation,
            "phase": "startup",
            "percentage": 10,
            "status": "running",
            "aggregateCount": 0,
            "capacityValue": 1
        }));
    }
    emit(json!({
        "protocolVersion": PROTOCOL,
        "type": "progress",
        "sessionId": session_id,
        "generation": generation,
        "phase": "output-promotion",
        "percentage": 100,
        "status": "completed",
        "aggregateCount": 1,
        "capacityValue": 1
    }));
    let result = json!({
        "protocolVersion": PROTOCOL,
        "type": "result",
        "sessionId": session_id,
        "generation": generation,
        "status": "success",
        "eventCount": 1,
        "eligibleTextCount": 1,
        "chunkCount": 1,
        "duplicateEventCount": 0,
        "warningCount": 0
    });
    emit(result.clone());
    if selected_mode == "duplicate-terminal" {
        emit(result);
    }
}
