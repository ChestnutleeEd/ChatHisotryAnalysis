//! Real-process orphan/recovery fixture.
//!
//! This binary is only used by host integration tests.  It exposes process
//! identity metadata through a caller-selected synthetic file, can create a
//! descendant in the same process group, and supports cooperative or ignored
//! termination.  It never reads chat data.

use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

static TERMINATE: AtomicBool = AtomicBool::new(false);
static INTERRUPT_SIGNALS: AtomicUsize = AtomicUsize::new(0);
static TERM_SIGNALS: AtomicUsize = AtomicUsize::new(0);

#[cfg(unix)]
extern "C" fn handle_termination(signal: i32) {
    if signal == 2 {
        INTERRUPT_SIGNALS.fetch_add(1, Ordering::Relaxed);
    } else if signal == 15 {
        TERM_SIGNALS.fetch_add(1, Ordering::Relaxed);
    }
    TERMINATE.store(true, Ordering::Release);
}

#[cfg(unix)]
extern "C" fn ignore_termination(signal: i32) {
    if signal == 2 {
        INTERRUPT_SIGNALS.fetch_add(1, Ordering::Relaxed);
    } else if signal == 15 {
        TERM_SIGNALS.fetch_add(1, Ordering::Relaxed);
    }
}

fn argument(name: &str) -> PathBuf {
    let mut arguments = std::env::args().skip(1);
    while let Some(candidate) = arguments.next() {
        if candidate == name {
            return PathBuf::from(arguments.next().expect("argument value"));
        }
    }
    panic!("missing {name}");
}

fn has_flag(name: &str) -> bool {
    std::env::args().skip(1).any(|argument| argument == name)
}

fn optional_argument(name: &str) -> Option<PathBuf> {
    let mut arguments = std::env::args().skip(1);
    while let Some(candidate) = arguments.next() {
        if candidate == name {
            return Some(PathBuf::from(arguments.next().expect("argument value")));
        }
    }
    None
}

fn write_signal_observation(path: Option<&PathBuf>) {
    let Some(path) = path else {
        return;
    };
    let value = json!({
        "interruptCount": INTERRUPT_SIGNALS.load(Ordering::Relaxed),
        "termCount": TERM_SIGNALS.load(Ordering::Relaxed),
    });
    let _ = fs::write(
        path,
        serde_json::to_vec(&value).expect("signal observation json"),
    );
}

#[cfg(unix)]
fn install_signal_handlers(ignore: bool) {
    unsafe extern "C" {
        fn signal(signal: i32, handler: extern "C" fn(i32)) -> usize;
    }
    let handler = if ignore {
        ignore_termination as extern "C" fn(i32)
    } else {
        handle_termination as extern "C" fn(i32)
    };
    unsafe {
        signal(2, handler);
        signal(15, handler);
    }
}

#[cfg(not(unix))]
fn install_signal_handlers(_: bool) {}

#[cfg(unix)]
fn set_process_group() {
    unsafe extern "C" {
        fn setpgid(pid: i32, process_group: i32) -> i32;
    }
    let result = unsafe { setpgid(0, 0) };
    assert_eq!(result, 0, "setpgid");
}

#[cfg(not(unix))]
fn set_process_group() {}

#[cfg(unix)]
fn process_group_id() -> i32 {
    unsafe extern "C" {
        fn getpgrp() -> i32;
    }
    unsafe { getpgrp() }
}

#[cfg(not(unix))]
fn process_group_id() -> i32 {
    std::process::id() as i32
}

#[cfg(target_os = "linux")]
fn start_fingerprint() -> String {
    let value =
        fs::read_to_string(format!("/proc/{}/stat", std::process::id())).expect("process stat");
    value
        .rsplit_once(") ")
        .and_then(|(_, rest)| rest.split_whitespace().nth(19))
        .expect("process start")
        .to_string()
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacProcBsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
    comm: [u8; 16],
    name: [u8; 32],
    nfiles: u32,
    pgid: u32,
    pjobc: u32,
    tdev: u32,
    tpgid: u32,
    nice: i32,
    start_tvsec: u64,
    start_tvusec: u64,
}

#[cfg(target_os = "macos")]
fn start_fingerprint() -> String {
    unsafe extern "C" {
        fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut u8, buffersize: i32) -> i32;
    }
    let mut info = std::mem::MaybeUninit::<MacProcBsdInfo>::zeroed();
    let size = std::mem::size_of::<MacProcBsdInfo>();
    let result = unsafe {
        proc_pidinfo(
            std::process::id() as i32,
            3,
            0,
            info.as_mut_ptr().cast::<u8>(),
            size as i32,
        )
    };
    assert_eq!(result, size as i32, "process start");
    let info = unsafe { info.assume_init() };
    format!("{}:{}", info.start_tvsec, info.start_tvusec)
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn start_fingerprint() -> String {
    format!("{}", std::process::id())
}

#[cfg(not(unix))]
fn start_fingerprint() -> String {
    format!("synthetic-start:{}", std::process::id())
}

fn executable_fingerprint() -> String {
    let executable = std::env::current_exe()
        .expect("current executable")
        .canonicalize()
        .expect("canonical executable");
    let digest = Sha256::digest(fs::read(executable).expect("executable bytes"));
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_metadata(path: &PathBuf, child_pid: Option<u32>) -> io::Result<()> {
    let nonce =
        std::env::var("CHAT_HISTORY_ANALYSIS_PARENT_NONCE").expect("synthetic nonce environment");
    let value = json!({
        "pid": std::process::id(),
        "processGroupId": process_group_id(),
        "startFingerprint": start_fingerprint(),
        "executableFingerprint": executable_fingerprint(),
        "nonce": nonce,
        "childPid": child_pid,
    });
    fs::write(path, serde_json::to_vec(&value).expect("metadata json"))
}

fn main() {
    set_process_group();
    let ignore = has_flag("--ignore-termination");
    install_signal_handlers(ignore);
    let child_pid = if has_flag("--child") {
        Some(
            Command::new("/bin/sleep")
                .arg("60")
                .spawn()
                .expect("synthetic child")
                .id(),
        )
    } else {
        None
    };
    let metadata_path = argument("--metadata-file");
    write_metadata(&metadata_path, child_pid).expect("metadata file");
    let signal_path = optional_argument("--signal-file");
    write_signal_observation(signal_path.as_ref());
    if has_flag("--exit-after-metadata") {
        return;
    }
    while ignore || !TERMINATE.load(Ordering::Acquire) {
        write_signal_observation(signal_path.as_ref());
        thread::sleep(Duration::from_millis(25));
    }
    write_signal_observation(signal_path.as_ref());
}
