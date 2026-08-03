//! Test-only sidecar executable used by the real-process supervisor tests.
//!
//! It intentionally contains no chat parser and accepts only fabricated
//! protocol input.  Cargo builds it for tests; the Tauri application does not
//! bundle it as the production sidecar.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{self, Command};
use std::thread;
use std::time::{Duration, Instant};

const PROTOCOL: &str = "chat-history-analysis.sidecar.v1";

fn read_configuration() -> (String, u64, PathBuf) {
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
    let output = value
        .get("outputDirectory")
        .and_then(Value::as_str)
        .expect("output directory");
    (session_id, generation, PathBuf::from(output))
}

fn write_synthetic_dataset(output: &PathBuf) {
    if !output.exists() {
        std::fs::create_dir(output).expect("synthetic normalized directory");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(output, std::fs::Permissions::from_mode(0o700))
            .expect("synthetic normalized mode");
    }
    let event = br#"{"createTime":1735689600,"formattedTime":"2025-01-01 08:00:00","calendarDate":"2025-01-01","senderScope":"owner","messageCategory":"text","textEligible":true,"content":"synthetic","fileRank":0,"sourceIndex":0}
"#;
    let digest = Sha256::digest(event);
    let digest = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let manifest = json!({
        "schemaVersion": "chat-history-analysis.manifest.v2",
        "canonicalSchemaVersion": "chat-history-analysis.canonical-event.v2",
        "preprocessorVersion": "0.1.0",
        "timePolicy": "UTC+08:00",
        "metricDefinitionVersions": {
            "population": "chat-history-analysis.metric.population.v1",
            "time": "chat-history-analysis.metric.time.utc-plus-8.v1",
            "tokens": "chat-history-analysis.metric.tokens.jieba.v1",
            "keywords": "chat-history-analysis.metric.keywords.log-odds.v1",
            "sessions": "chat-history-analysis.metric.sessions.threshold.v1"
        },
        "chunks": [{
            "ordinal": 0,
            "name": "chunk-0000.ndjson",
            "byteSize": event.len(),
            "recordCount": 1,
            "sha256": digest
        }],
        "aggregates": {
            "eventCount": 1,
            "userMessageCount": 1,
            "eligibleTextCount": 1,
            "systemEventCount": 0,
            "chunkCount": 1,
            "totalBytes": event.len(),
            "warningCount": 0,
            "messageCategoryCounts": {
                "text": 1, "image": 0, "voice": 0, "video": 0, "file": 0,
                "animated-emoji": 0, "structured": 0, "location": 0, "call": 0,
                "mini-program": 0, "reply": 0, "contact-card": 0, "system": 0,
                "other": 0, "unknown": 0
            },
            "unknownSenderCount": 0
        },
        "limits": {
            "maxEvents": 2_000_000,
            "maxDatasetBytes": 536_870_912,
            "maxChunkBytes": 33_554_432,
            "maxChunkCount": 16_384
        },
        "privacyValidation": {
            "status": "passed",
            "forbiddenFieldCount": 0,
            "contentPolicy": "eligible-text-only"
        }
    });
    let mut manifest_bytes = serde_json::to_vec(&manifest).expect("synthetic manifest");
    manifest_bytes.push(b'\n');
    let chunk_path = output.join("chunk-0000.ndjson");
    let manifest_path = output.join("manifest.json");
    let mut chunk = std::fs::File::create(chunk_path).expect("synthetic chunk");
    chunk.write_all(event).expect("synthetic chunk bytes");
    let mut manifest_file = std::fs::File::create(manifest_path).expect("synthetic manifest file");
    manifest_file
        .write_all(&manifest_bytes)
        .expect("synthetic manifest bytes");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [
            output.join("chunk-0000.ndjson"),
            output.join("manifest.json"),
        ] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .expect("synthetic file mode");
        }
    }
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
    let (session_id, generation, output_directory) = read_configuration();
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
    if matches!(
        selected_mode.as_str(),
        "success" | "delay" | "ignore-cancel" | "grandchild"
    ) {
        write_synthetic_dataset(&output_directory);
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
