use chat_history_analysis_lib::session_supervisor::{
    CancelReason, CleanupStatus, SessionEvent, SessionInput, SessionState, SessionSupervisor,
    SessionTerminal, SidecarResolution, SupervisorErrorCode, ANALYSIS_SESSIONS_DIRECTORY,
};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::process;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

struct Fixture {
    root: PathBuf,
    cache_root: PathBuf,
    sessions_root: PathBuf,
    working_directory: PathBuf,
    source: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "chat-history-analysis-stage3-{}-{nonce}",
            process::id()
        ));
        fs::create_dir(&root).expect("fixture root");
        set_private(&root);
        let cache_root = root.join("cache");
        let sessions_root = cache_root.join(ANALYSIS_SESSIONS_DIRECTORY);
        let working_directory = root.join("cwd");
        fs::create_dir(&cache_root).expect("cache root");
        fs::create_dir(&sessions_root).expect("sessions root");
        fs::create_dir(&working_directory).expect("working directory");
        set_private(&cache_root);
        set_private(&sessions_root);
        set_private(&working_directory);
        let source = root.join("synthetic-source.json");
        let mut file = File::create(&source).expect("source");
        file.write_all(b"synthetic stage3 input")
            .expect("source bytes");
        set_private_file(&source);
        Self {
            root,
            cache_root,
            sessions_root,
            working_directory,
            source,
        }
    }

    fn input(&self) -> SessionInput {
        SessionInput::new(
            vec![self.source.clone()],
            Vec::new(),
            self.cache_root.clone(),
            self.working_directory.clone(),
        )
    }

    fn resolution(&self, mode: &str) -> SidecarResolution {
        SidecarResolution::host_owned_for_test(
            PathBuf::from(env!("CARGO_BIN_EXE_synthetic-sidecar")),
            vec!["--mode".to_string(), mode.to_string()],
        )
        .expect("synthetic resolution")
    }

    fn session_directory(&self, session_id: &str) -> PathBuf {
        self.sessions_root.join(session_id)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        remove_file_if_present(&self.source);
        remove_file_if_present(&self.working_directory.join("grandchild.pid"));
        remove_file_if_present(&self.working_directory.join("worker-ready"));
        remove_dir_if_present(&self.working_directory);
        remove_dir_if_present(&self.sessions_root);
        remove_dir_if_present(&self.cache_root);
        remove_dir_if_present(&self.root);
    }
}

fn set_private(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).expect("private dir");
    }
}

fn set_private_file(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).expect("private file");
    }
}

fn remove_file_if_present(path: &PathBuf) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => {
            fs::remove_file(path).expect("fixture file cleanup");
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => panic!("fixture file metadata: {error}"),
    }
}

fn remove_dir_if_present(path: &PathBuf) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir(path).expect("fixture dir cleanup");
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => panic!("fixture dir metadata: {error}"),
    }
}

fn wait_for_child_to_exit(pid: i32) {
    for _ in 0..80 {
        if !process_is_alive(pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("synthetic descendant remained alive: {pid}");
}

#[cfg(unix)]
fn process_is_alive(pid: i32) -> bool {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe { kill(pid, 0) == 0 }
}

#[cfg(not(unix))]
fn process_is_alive(_pid: i32) -> bool {
    false
}

struct RecordingWorker {
    cooperative: AtomicUsize,
    forced: AtomicUsize,
}

impl chat_history_analysis_lib::session_supervisor::WorkerTermination for RecordingWorker {
    fn request_cancellation(&self) {
        self.cooperative.fetch_add(1, Ordering::SeqCst);
    }

    fn force_terminate(&self) {
        self.forced.fetch_add(1, Ordering::SeqCst);
    }
}

#[test]
fn successful_real_sidecar_uses_opaque_snapshot_and_releases_session() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let input_debug = format!("{:?}", fixture.input());
    assert!(!input_debug.contains(fixture.root.to_string_lossy().as_ref()));
    let started = supervisor
        .start("main", fixture.resolution("success"), fixture.input())
        .expect("start");
    assert!(started.session_id.starts_with("ses_"));
    assert_eq!(started.session_id.len(), 36);
    let debug = format!("{:?}", supervisor);
    assert_eq!(debug, "SessionSupervisor");

    let completed = supervisor
        .wait(
            "main",
            &started.session_id,
            started.generation,
            Duration::from_secs(2),
        )
        .expect("wait");
    assert_eq!(completed.state, SessionState::Complete);
    assert!(matches!(
        completed.terminal,
        Some(SessionTerminal::Complete(_))
    ));
    assert!(completed.events.iter().any(|event| matches!(
        event,
        SessionEvent::Progress(progress) if progress.phase == "startup"
    )));
    assert!(!format!("{:?}", completed).contains(fixture.root.to_string_lossy().as_ref()));

    let discarded = supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("discard");
    assert!(matches!(
        discarded.cleanup,
        Some(CleanupStatus::Complete { .. })
    ));
    assert!(supervisor.active_snapshot().is_none());
}

#[test]
fn start_creates_a_missing_owner_only_session_root() {
    let fixture = Fixture::new();
    fs::remove_dir(&fixture.sessions_root).expect("remove synthetic session root");
    let supervisor = SessionSupervisor::default();
    let started = supervisor
        .start("main", fixture.resolution("success"), fixture.input())
        .expect("start creates session root");
    let metadata = fs::symlink_metadata(&fixture.sessions_root).expect("session root metadata");
    assert!(metadata.is_dir() && !metadata.file_type().is_symlink());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(metadata.permissions().mode() & 0o777, 0o700);
    }
    supervisor
        .wait(
            "main",
            &started.session_id,
            started.generation,
            Duration::from_secs(2),
        )
        .expect("complete");
    supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("discard");
}

#[test]
fn stale_window_and_generation_requests_cannot_mutate_terminal_session() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let started = supervisor
        .start("main", fixture.resolution("success"), fixture.input())
        .expect("start");
    let completed = supervisor
        .wait(
            "main",
            &started.session_id,
            started.generation,
            Duration::from_secs(2),
        )
        .expect("wait");
    assert_eq!(
        supervisor.wait(
            "other",
            &started.session_id,
            started.generation,
            Duration::from_millis(1),
        ),
        Err(
            chat_history_analysis_lib::session_supervisor::SupervisorError {
                code: SupervisorErrorCode::WindowNotAuthorized
            }
        )
    );
    assert_eq!(
        supervisor.cancel(
            "main",
            &started.session_id,
            started.generation + 1,
            CancelReason::User,
        ),
        Err(
            chat_history_analysis_lib::session_supervisor::SupervisorError {
                code: SupervisorErrorCode::SessionStale
            }
        )
    );
    let repeated = supervisor
        .cancel(
            "main",
            &started.session_id,
            started.generation,
            CancelReason::User,
        )
        .expect("terminal cancel is idempotent");
    assert_eq!(repeated, completed);
    supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("discard");
}

#[test]
fn renderer_disconnect_closes_a_live_session_without_a_second_process() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let started = supervisor
        .start("main", fixture.resolution("ignore-cancel"), fixture.input())
        .expect("start");
    supervisor.renderer_disconnected("main");
    assert!(supervisor.active_snapshot().is_none());
    // The supervisor's bounded close path owns the group kill; this call is
    // deliberately idempotent and must not find a stale live session.
    supervisor.renderer_disconnected("main");
    assert!(supervisor
        .close("main", &started.session_id, started.generation)
        .is_err());
}

#[test]
fn cancellation_requests_and_escalates_the_attached_worker_generation() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let resolution = SidecarResolution::host_owned_for_test(
        PathBuf::from(env!("CARGO_BIN_EXE_synthetic-sidecar")),
        vec![
            "--mode".to_string(),
            "ignore-cancel".to_string(),
            "--ready-file".to_string(),
            "worker-ready".to_string(),
        ],
    )
    .expect("synthetic resolution");
    let started = supervisor
        .start("main", resolution, fixture.input())
        .expect("start");
    let worker = Arc::new(RecordingWorker {
        cooperative: AtomicUsize::new(0),
        forced: AtomicUsize::new(0),
    });
    supervisor
        .attach_worker(
            "main",
            &started.session_id,
            started.generation,
            worker.clone(),
        )
        .expect("attach worker");
    for _ in 0..80 {
        if fixture.working_directory.join("worker-ready").exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(fixture.working_directory.join("worker-ready").exists());
    let cancelled = supervisor
        .cancel(
            "main",
            &started.session_id,
            started.generation,
            CancelReason::User,
        )
        .expect("cancel");
    assert_eq!(cancelled.state, SessionState::Cancelling);
    assert_eq!(worker.cooperative.load(Ordering::SeqCst), 1);
    assert!(worker.forced.load(Ordering::SeqCst) >= 1);
    supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("discard");
}

#[test]
fn malformed_protocol_crash_and_wrong_session_are_content_free_failures() {
    for mode in [
        "malformed",
        "excessive",
        "protocol-mismatch",
        "wrong-session",
        "duplicate-terminal",
        "crash",
    ] {
        let fixture = Fixture::new();
        let supervisor = SessionSupervisor::default();
        let started = supervisor
            .start("main", fixture.resolution(mode), fixture.input())
            .expect("start");
        let outcome = supervisor
            .wait(
                "main",
                &started.session_id,
                started.generation,
                Duration::from_secs(2),
            )
            .expect("failure terminal");
        let Some(SessionTerminal::Failed(reason)) = outcome.terminal else {
            panic!("expected failed terminal for {mode}");
        };
        assert!(
            reason.starts_with("SIDECAR_"),
            "unexpected reason: {reason}"
        );
        assert!(!reason.contains('/'));
        assert!(matches!(
            outcome.cleanup,
            Some(CleanupStatus::Complete { .. })
        ));
        supervisor
            .discard("main", &started.session_id, started.generation)
            .expect("discard failed session");
    }
}

#[test]
fn structured_stderr_failure_is_separated_from_raw_stderr() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let started = supervisor
        .start(
            "main",
            fixture.resolution("sensitive-stderr"),
            fixture.input(),
        )
        .expect("start");
    let outcome = supervisor
        .wait(
            "main",
            &started.session_id,
            started.generation,
            Duration::from_secs(2),
        )
        .expect("failure terminal");
    assert!(matches!(
        outcome.terminal,
        Some(SessionTerminal::Failed(ref reason)) if reason == "SIDECAR_PROTOCOL_INVALID"
    ));
    assert!(!format!("{:?}", outcome).contains("synthetic-source"));
    supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("discard");
}

#[test]
fn cancellation_escalates_to_the_sidecar_process_group_and_kills_descendant() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let started = SidecarResolution::host_owned_for_test(
        PathBuf::from(env!("CARGO_BIN_EXE_synthetic-sidecar")),
        vec![
            "--mode".to_string(),
            "grandchild".to_string(),
            "--pid-file".to_string(),
            "grandchild.pid".to_string(),
        ],
    )
    .expect("synthetic resolution");
    let started = supervisor
        .start("main", started, fixture.input())
        .expect("start");
    let pid_file = fixture.working_directory.join("grandchild.pid");
    for _ in 0..80 {
        if pid_file.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let pid = fs::read_to_string(&pid_file)
        .expect("grandchild pid file")
        .parse::<i32>()
        .expect("grandchild pid");
    let cancelled = supervisor
        .cancel(
            "main",
            &started.session_id,
            started.generation,
            CancelReason::User,
        )
        .expect("cancel");
    assert_eq!(cancelled.state, SessionState::Cancelling);
    assert!(matches!(
        cancelled.terminal,
        Some(SessionTerminal::Cancelled)
    ));
    wait_for_child_to_exit(pid);
    supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("discard");
}

#[test]
fn retry_and_replacement_are_serial_and_generation_monotonic() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let first = supervisor
        .start("main", fixture.resolution("malformed"), fixture.input())
        .expect("first start");
    assert_eq!(
        supervisor.start("main", fixture.resolution("success"), fixture.input()),
        Err(
            chat_history_analysis_lib::session_supervisor::SupervisorError {
                code: SupervisorErrorCode::SessionBusy
            }
        )
    );
    let failed = supervisor
        .wait(
            "main",
            &first.session_id,
            first.generation,
            Duration::from_secs(2),
        )
        .expect("first failure");
    let retried = supervisor
        .retry(
            "main",
            &first.session_id,
            first.generation,
            fixture.resolution("success"),
        )
        .expect("retry");
    assert!(retried.generation > failed.generation);
    assert_ne!(retried.session_id, first.session_id);
    let completed = supervisor
        .wait(
            "main",
            &retried.session_id,
            retried.generation,
            Duration::from_secs(2),
        )
        .expect("retry completion");
    assert_eq!(completed.state, SessionState::Complete);

    let replaced = supervisor
        .replace("main", fixture.resolution("success"), fixture.input())
        .expect("replacement");
    assert!(replaced.generation > retried.generation);
    supervisor
        .wait(
            "main",
            &replaced.session_id,
            replaced.generation,
            Duration::from_secs(2),
        )
        .expect("replacement completion");
    supervisor
        .discard("main", &replaced.session_id, replaced.generation)
        .expect("replacement discard");
}

#[test]
fn cleanup_preserves_unknown_entries_and_requires_explicit_retry() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let started = supervisor
        .start("main", fixture.resolution("malformed"), fixture.input())
        .expect("start");
    let session_directory = fixture.session_directory(&started.session_id);
    fs::create_dir(&session_directory).expect("session directory");
    set_private(&session_directory);
    let marker = session_directory.join(".session-marker");
    File::create(&marker).expect("marker");
    set_private_file(&marker);
    let unknown = session_directory.join("user-owned-remnant");
    File::create(&unknown).expect("unknown entry");
    set_private_file(&unknown);

    let failed = supervisor
        .wait(
            "main",
            &started.session_id,
            started.generation,
            Duration::from_secs(2),
        )
        .expect("failure");
    assert_eq!(failed.cleanup, Some(CleanupStatus::Required));
    assert!(unknown.exists());
    assert_eq!(
        supervisor.discard("main", &started.session_id, started.generation),
        Err(
            chat_history_analysis_lib::session_supervisor::SupervisorError {
                code: SupervisorErrorCode::CleanupRequired
            }
        )
    );
    remove_file_if_present(&unknown);
    supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("cleanup retry");
    assert!(supervisor.active_snapshot().is_none());
}
