use chat_history_analysis_lib::analytics_results::{ResultKey, ResultRegistry};
use chat_history_analysis_lib::dataset_handoff::verify_session_dataset;
use chat_history_analysis_lib::dataset_transport::{
    DatasetStreamControlRequest, DatasetStreamOpenRequest, DatasetStreamReadRequest,
    DatasetTransportState,
};
use chat_history_analysis_lib::export::{bytes_for_format, save_to_destination, ExportFormat};
use chat_history_analysis_lib::export_schema::{
    ApprovedChartKey, DatasetExportContext, PrivacySafeExportSnapshot, RendererAggregateInput,
};
use chat_history_analysis_lib::secure_storage::{
    OwnerRecord, SecureStorage, OWNER_RECORD_SCHEMA_VERSION,
};
use chat_history_analysis_lib::session_supervisor::{
    recover_startup_sessions, CancelReason, CleanupStatus, SessionEvent, SessionInput,
    SessionState, SessionSupervisor, SessionTerminal, SidecarResolution, SupervisorErrorCode,
    ANALYSIS_SESSIONS_DIRECTORY, SESSION_MARKER_CONTENT,
};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{self, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SYNTHETIC_READINESS_TIMEOUT: Duration = Duration::from_secs(5);

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
        let root = (0..100)
            .map(|attempt| {
                std::env::temp_dir().join(format!(
                    "chat-history-analysis-stage3-{}-{nonce}-{attempt}",
                    process::id()
                ))
            })
            .find(|candidate| match fs::create_dir(candidate) {
                Ok(()) => true,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
                Err(error) => panic!("fixture root: {error}"),
            })
            .expect("fixture root collision limit");
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
        let mut cleanup_failed = false;
        cleanup_failed |= remove_file_if_present(&self.source).is_err();
        for name in [
            "grandchild.pid",
            "orphan-grandchild.pid",
            "orphan-metadata.json",
            "orphan-signal.json",
            "orphan-control-metadata.json",
            "orphan-control-signal.json",
            "worker-ready",
        ] {
            cleanup_failed |= remove_file_if_present(&self.working_directory.join(name)).is_err();
        }
        for path in [
            self.working_directory.as_path(),
            self.sessions_root.as_path(),
            self.cache_root.as_path(),
            self.root.as_path(),
        ] {
            cleanup_failed |= remove_dir_if_present(path).is_err();
        }
        if cleanup_failed {
            eprintln!("synthetic fixture cleanup incomplete");
        }
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

fn remove_file_if_present(path: &Path) -> Result<(), ()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => {
            fs::remove_file(path).map_err(|_| ())?;
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(()),
    }
    Ok(())
}

fn remove_dir_if_present(path: &Path) -> Result<(), ()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir(path).map_err(|_| ())?;
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(()),
    }
    Ok(())
}

fn wait_for_child_to_exit(pid: i32) {
    let deadline = Instant::now() + SYNTHETIC_READINESS_TIMEOUT;
    while Instant::now() < deadline {
        if !process_is_alive(pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("synthetic descendant remained alive: {pid}");
}

fn wait_for_path(path: &Path) {
    let deadline = Instant::now() + SYNTHETIC_READINESS_TIMEOUT;
    while Instant::now() < deadline {
        if path.exists() {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("synthetic readiness marker did not appear");
}

#[cfg(unix)]
fn kill_process_group(group_id: i32) {
    unsafe extern "C" {
        fn killpg(group_id: i32, signal: i32) -> i32;
    }
    let result = unsafe { killpg(group_id, 9) };
    assert!(result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(3));
}

#[cfg(not(unix))]
fn kill_process_group(_: i32) {}

fn spawn_detached_orphan(
    fixture: &Fixture,
    metadata_path: &Path,
    signal_path: Option<&Path>,
    nonce: &str,
    ignore_termination: bool,
    child: bool,
) -> process::Child {
    let mut script = "\"$1\" --metadata-file \"$2\"".to_string();
    if signal_path.is_some() {
        script.push_str(" --signal-file \"$3\"");
    }
    if ignore_termination {
        script.push_str(" --ignore-termination");
    }
    if child {
        script.push_str(" --child");
    }
    script.push_str(" & exit 0");
    let mut command = Command::new("/bin/sh");
    command
        .arg("-c")
        .arg(script)
        .arg("synthetic-orphan-launcher")
        .arg(env!("CARGO_BIN_EXE_synthetic-orphan"))
        .arg(metadata_path);
    if let Some(signal_path) = signal_path {
        command.arg(signal_path);
    }
    command
        .env("CHAT_HISTORY_ANALYSIS_PARENT_NONCE", nonce)
        .current_dir(&fixture.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn detached synthetic orphan launcher")
}

fn wait_for_orphan_metadata(path: &Path) -> serde_json::Value {
    let deadline = Instant::now() + SYNTHETIC_READINESS_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok(bytes) = fs::read(path) {
            if let Ok(value) = serde_json::from_slice(&bytes) {
                return value;
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("synthetic orphan metadata did not become readable");
}

fn synthetic_export_aggregate() -> RendererAggregateInput {
    let snapshot = PrivacySafeExportSnapshot::from_dataset(1, "2025-01-01", "2025-01-01")
        .expect("synthetic snapshot");
    let value: serde_json::Value =
        serde_json::from_slice(&snapshot.to_json_bytes().expect("synthetic JSON"))
            .expect("synthetic JSON value");
    let mut fields = value["metrics"]
        .as_object()
        .expect("host metric object")
        .clone();
    fields.insert("chartKey".to_string(), value["chartKey"].clone());
    fields.insert("filters".to_string(), value["filters"].clone());
    serde_json::from_value(serde_json::Value::Object(fields)).expect("exact numeric aggregate")
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

    fn wait_for_termination(&self, _timeout: Duration) -> bool {
        self.forced.load(Ordering::SeqCst) > 0
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
    assert_eq!(completed.state, SessionState::Analyzing);
    assert!(matches!(
        completed.terminal,
        Some(SessionTerminal::Complete(_))
    ));
    assert!(completed.events.iter().any(|event| matches!(
        event,
        SessionEvent::Progress(progress) if progress.phase == "startup"
    )));
    assert!(!format!("{:?}", completed).contains(fixture.root.to_string_lossy().as_ref()));

    let worker = Arc::new(RecordingWorker {
        cooperative: AtomicUsize::new(0),
        forced: AtomicUsize::new(0),
    });
    supervisor
        .attach_worker("main", &started.session_id, started.generation, worker)
        .expect("attach production Worker lease seam");
    let analysis_complete = supervisor
        .worker_result_committed("main", &started.session_id, started.generation)
        .expect("commit Worker result before complete");
    assert_eq!(analysis_complete.state, SessionState::Complete);

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
fn stage10_production_representative_sidecar_registry_export_stress_is_bounded() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let registry = ResultRegistry::default();
    let transport = DatasetTransportState::default();
    transport.mark_sidecar_verified();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("synthetic transport runtime");

    for ordinal in 1..=128u64 {
        let started = supervisor
            .start("main", fixture.resolution("success"), fixture.input())
            .expect("start real synthetic sidecar");
        let completed = supervisor
            .wait(
                "main",
                &started.session_id,
                started.generation,
                Duration::from_secs(2),
            )
            .expect("real sidecar completion");
        assert!(matches!(
            completed.terminal,
            Some(SessionTerminal::Complete(_))
        ));

        let session_root = fixture.session_directory(&started.session_id);
        let verified =
            verify_session_dataset(&session_root, &started.session_id, started.generation)
                .expect("verify production handoff");
        let expected_manifest = verified.manifest.clone();
        let expected_chunks = verified.chunks.clone();
        let capability = transport
            .register_host_dataset_for_session(
                "main",
                &started.session_id,
                started.generation,
                verified.manifest,
                verified.chunks,
            )
            .expect("register verified dataset transport");
        let transported = runtime.block_on(async {
            let opened = transport
                .open(
                    "main",
                    DatasetStreamOpenRequest {
                        protocol_version: chat_history_analysis_lib::ipc::PROTOCOL_VERSION
                            .to_string(),
                        session_id: capability.session_id.clone(),
                        generation: capability.generation,
                        dataset_id: capability.dataset_id.clone(),
                    },
                )
                .expect("open verified dataset stream");
            assert_eq!(opened.record_count, capability.record_count);
            let manifest = transport
                .receive(
                    "main",
                    DatasetStreamReadRequest {
                        protocol_version: chat_history_analysis_lib::ipc::PROTOCOL_VERSION
                            .to_string(),
                        session_id: capability.session_id.clone(),
                        generation: capability.generation,
                        dataset_id: capability.dataset_id.clone(),
                        kind: "manifest".to_string(),
                        ordinal: None,
                        expected_bytes: None,
                    },
                )
                .await
                .expect("receive verified manifest");
            let mut chunks = Vec::new();
            for (index, expected) in expected_chunks.iter().enumerate() {
                chunks.push(
                    transport
                        .receive(
                            "main",
                            DatasetStreamReadRequest {
                                protocol_version: chat_history_analysis_lib::ipc::PROTOCOL_VERSION
                                    .to_string(),
                                session_id: capability.session_id.clone(),
                                generation: capability.generation,
                                dataset_id: capability.dataset_id.clone(),
                                kind: "chunk".to_string(),
                                ordinal: Some((index + 1) as u64),
                                expected_bytes: Some(expected.len() as u64),
                            },
                        )
                        .await
                        .expect("receive verified chunk"),
                );
            }
            transport
                .complete(
                    "main",
                    DatasetStreamControlRequest {
                        protocol_version: chat_history_analysis_lib::ipc::PROTOCOL_VERSION
                            .to_string(),
                        session_id: capability.session_id.clone(),
                        generation: capability.generation,
                        dataset_id: capability.dataset_id.clone(),
                    },
                )
                .await
                .expect("complete verified dataset stream");
            (manifest, chunks)
        });
        assert_eq!(transported.0, expected_manifest);
        assert_eq!(transported.1, expected_chunks);
        assert_eq!(
            transport.close_session("main", &started.session_id, started.generation),
            2
        );

        let key = ResultKey::new("main", &started.session_id, started.generation);
        registry
            .register_context(
                key.clone(),
                DatasetExportContext {
                    dataset_id: format!("dat_{ordinal:032x}"),
                    record_count: 1,
                    minimum_calendar_date: "2025-01-01".to_string(),
                    maximum_calendar_date: "2025-01-01".to_string(),
                },
            )
            .expect("register host context");
        registry
            .begin_pending(key.clone())
            .expect("begin aggregate");
        let result_id = registry
            .commit_pending(&key, synthetic_export_aggregate())
            .expect("commit exact aggregate");
        let format_specs = if ordinal == 1 {
            vec![
                (ExportFormat::Json, ApprovedChartKey::Trends),
                (ExportFormat::Csv, ApprovedChartKey::Trends),
                (ExportFormat::Png, ApprovedChartKey::Trends),
            ]
        } else {
            vec![(ExportFormat::Json, ApprovedChartKey::Trends)]
        };
        for (format, chart_key) in format_specs {
            let lease = registry
                .begin_export("main", &started.session_id, started.generation, &result_id)
                .expect("begin host export lease");
            let bytes = bytes_for_format(lease.snapshot(), format, chart_key)
                .expect("render approved host export");
            let destination = fixture.root.join(format!(
                "stage10-synthetic-export-{ordinal:03}.{}",
                format.extension()
            ));
            save_to_destination(&destination, &bytes, false).expect("atomic native save");
            assert!(destination.is_file());
            assert!(!String::from_utf8_lossy(&bytes).contains("synthetic-secret"));
            if format == ExportFormat::Png {
                assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
            }
            drop(lease);
            fs::remove_file(&destination).expect("remove synthetic destination");
        }

        registry.clear_session("main", &started.session_id, started.generation);
        let discarded = supervisor
            .discard("main", &started.session_id, started.generation)
            .expect("cleanup real synthetic session");
        assert!(matches!(
            discarded.cleanup,
            Some(CleanupStatus::Complete { .. })
        ));
        assert_eq!(registry.entry_count(), 0);
        assert!(supervisor.active_snapshot().is_none());
    }
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
fn startup_recovery_cleans_one_recognized_session_without_following_unknown_entries() {
    let fixture = Fixture::new();
    let session_id = "ses_00000000000000000000000000000001";
    let session_directory = fixture.session_directory(session_id);
    fs::create_dir(&session_directory).expect("recognized session directory");
    set_private(&session_directory);
    let marker = session_directory.join(".session-marker");
    fs::write(&marker, SESSION_MARKER_CONTENT).expect("marker");
    set_private_file(&marker);
    let state = session_directory.join("session-state");
    fs::write(
        &state,
        format!("sessionId={session_id}\ngeneration=1\n").as_bytes(),
    )
    .expect("state");
    set_private_file(&state);
    let normalized = session_directory.join("normalized");
    fs::create_dir(&normalized).expect("normalized directory");
    set_private(&normalized);

    let recovery = recover_startup_sessions(&fixture.cache_root).expect("startup recovery");
    assert_eq!(recovery.recognized_session_count, 1);
    assert_eq!(recovery.cleaned_session_count, 1);
    assert!(!recovery.cleanup_required);
    assert!(!session_directory.exists());
}

#[test]
fn startup_recovery_arbitrates_a_real_orphan_process_group_before_cleanup() {
    let fixture = Fixture::new();
    let resolution = SidecarResolution::host_owned_for_test(
        PathBuf::from(env!("CARGO_BIN_EXE_synthetic-sidecar")),
        vec![
            "--mode".to_string(),
            "grandchild".to_string(),
            "--pid-file".to_string(),
            "orphan-grandchild.pid".to_string(),
        ],
    )
    .expect("synthetic resolution");
    let supervisor = SessionSupervisor::default();
    let started = supervisor
        .start("main", resolution, fixture.input())
        .expect("start real orphan candidate");
    let session_directory = fixture.session_directory(&started.session_id);
    let owner_record = session_directory.join(".owner-record");
    let child_pid_file = fixture.working_directory.join("orphan-grandchild.pid");
    wait_for_path(&owner_record);
    wait_for_path(&child_pid_file);
    let child_pid = fs::read_to_string(&child_pid_file)
        .expect("orphan child pid")
        .parse::<i32>()
        .expect("orphan child pid number");

    let recovery = recover_startup_sessions(&fixture.cache_root).expect("startup recovery");
    assert_eq!(recovery.recognized_session_count, 1);
    assert_eq!(recovery.cleaned_session_count, 1);
    assert!(!recovery.cleanup_required);
    assert!(!session_directory.exists());
    wait_for_child_to_exit(child_pid);
}

#[test]
fn synthetic_orphan_helper_exposes_identity_and_recovery_kills_owned_tree() {
    let fixture = Fixture::new();
    let storage = SecureStorage::new(&fixture.cache_root).expect("secure storage");
    let session_id = "ses_00000000000000000000000000000009";
    storage.create_session(session_id, 1).expect("session");
    let metadata_path = fixture.working_directory.join("orphan-metadata.json");
    let nonce = "nonce_00000000000000000000000000000009";
    let mut orphan = Command::new("/bin/sh")
        .arg("-c")
        .arg("\"$1\" --metadata-file \"$2\" --child & exit 0")
        .arg("synthetic-orphan-launcher")
        .arg(env!("CARGO_BIN_EXE_synthetic-orphan"))
        .arg(&metadata_path)
        .env("CHAT_HISTORY_ANALYSIS_PARENT_NONCE", nonce)
        .current_dir(&fixture.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn synthetic orphan");
    wait_for_path(&metadata_path);
    orphan.wait().expect("orphan launcher");
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(&metadata_path).expect("orphan metadata"))
            .expect("orphan metadata json");
    let child_pid = metadata["childPid"].as_u64().expect("child pid") as i32;
    let owner = OwnerRecord {
        schema_version: OWNER_RECORD_SCHEMA_VERSION.to_string(),
        state_version: "active.v1".to_string(),
        pid: metadata["pid"].as_u64().expect("orphan pid") as u32,
        process_group_id: metadata["processGroupId"].as_i64().expect("orphan pgid") as i32,
        start_fingerprint: metadata["startFingerprint"]
            .as_str()
            .expect("orphan start")
            .to_string(),
        executable_fingerprint: metadata["executableFingerprint"]
            .as_str()
            .expect("orphan executable")
            .to_string(),
        session_id: session_id.to_string(),
        generation: 1,
        nonce: nonce.to_string(),
    };
    storage
        .write_owner_record(session_id, &owner)
        .expect("owner record");

    let recovery = recover_startup_sessions(&fixture.cache_root).expect("recover orphan");
    assert_eq!(recovery.recognized_session_count, 1);
    assert_eq!(recovery.cleaned_session_count, 1);
    assert!(!recovery.cleanup_required);
    assert!(!fixture.session_directory(session_id).exists());
    wait_for_child_to_exit(child_pid);
    let _ = orphan.wait();
}

#[test]
fn synthetic_orphan_identity_mismatch_matrix_preserves_session_and_unrelated_process() {
    let cases = [
        "nonce-mismatch",
        "pgid-mismatch",
        "start-fingerprint-mismatch",
        "executable-mismatch",
        "pid-reuse-control-process",
        "owner-schema-mismatch",
    ];

    for (ordinal, case) in cases.into_iter().enumerate() {
        let fixture = Fixture::new();
        let storage = SecureStorage::new(&fixture.cache_root).expect("secure storage");
        let session_id = format!("ses_{:032x}", 20 + ordinal);
        storage.create_session(&session_id, 1).expect("session");
        let metadata_path = fixture.working_directory.join("orphan-metadata.json");
        let signal_path = fixture.working_directory.join("orphan-signal.json");
        let nonce = format!("nonce_{:032x}", 100 + ordinal);
        let mut launcher = spawn_detached_orphan(
            &fixture,
            &metadata_path,
            Some(&signal_path),
            &nonce,
            false,
            true,
        );
        let metadata = wait_for_orphan_metadata(&metadata_path);
        launcher.wait().expect("orphan launcher");
        let first_pid = metadata["pid"].as_u64().expect("orphan pid") as i32;
        let first_group = metadata["processGroupId"]
            .as_i64()
            .expect("orphan process group") as i32;
        let child_pid = metadata["childPid"].as_u64().expect("orphan child") as i32;
        let mut owner = OwnerRecord {
            schema_version: OWNER_RECORD_SCHEMA_VERSION.to_string(),
            state_version: "active.v1".to_string(),
            pid: first_pid as u32,
            process_group_id: first_group,
            start_fingerprint: metadata["startFingerprint"]
                .as_str()
                .expect("orphan start")
                .to_string(),
            executable_fingerprint: metadata["executableFingerprint"]
                .as_str()
                .expect("orphan executable")
                .to_string(),
            session_id: session_id.clone(),
            generation: 1,
            nonce: nonce.clone(),
        };

        let mut control_pid = None;
        let mut control_group = None;
        let mut control_signal = None;
        match case {
            "nonce-mismatch" => owner.nonce = format!("nonce_{:032x}", 900 + ordinal),
            "pgid-mismatch" => owner.process_group_id = first_group.saturating_add(1),
            "start-fingerprint-mismatch" => owner.start_fingerprint = "mismatch-start".to_string(),
            "executable-mismatch" => owner.executable_fingerprint = "0".repeat(64),
            "pid-reuse-control-process" => {
                let control_metadata_path = fixture
                    .working_directory
                    .join("orphan-control-metadata.json");
                let control_signal_path =
                    fixture.working_directory.join("orphan-control-signal.json");
                let control_nonce = format!("nonce_{:032x}", 700 + ordinal);
                let mut control_launcher = spawn_detached_orphan(
                    &fixture,
                    &control_metadata_path,
                    Some(&control_signal_path),
                    &control_nonce,
                    false,
                    false,
                );
                let control_metadata = wait_for_orphan_metadata(&control_metadata_path);
                control_launcher.wait().expect("control launcher");
                control_pid = Some(control_metadata["pid"].as_u64().expect("control pid") as i32);
                control_group = Some(
                    control_metadata["processGroupId"]
                        .as_i64()
                        .expect("control process group") as i32,
                );
                control_signal = Some(control_signal_path);
                owner.pid = control_pid.expect("control pid") as u32;
            }
            "owner-schema-mismatch" => {}
            _ => unreachable!("known synthetic mismatch case"),
        }

        storage
            .write_owner_record(&session_id, &owner)
            .expect("owner record");
        if case == "owner-schema-mismatch" {
            let mut invalid = serde_json::to_value(&owner).expect("owner value");
            invalid["schemaVersion"] = serde_json::Value::String("synthetic-invalid".to_string());
            fs::write(
                fixture.session_directory(&session_id).join(".owner-record"),
                serde_json::to_vec(&invalid).expect("invalid owner json"),
            )
            .expect("invalid owner record");
        }

        let recovery = recover_startup_sessions(&fixture.cache_root).expect("mismatch recovery");
        assert_eq!(recovery.recognized_session_count, 1, "case={case}");
        assert_eq!(recovery.cleaned_session_count, 0, "case={case}");
        assert!(recovery.cleanup_required, "case={case}");
        assert!(
            fixture.session_directory(&session_id).exists(),
            "case={case}"
        );

        if let Some(control_signal) = control_signal {
            let signal: serde_json::Value = serde_json::from_slice(
                &fs::read(control_signal).expect("control signal observation"),
            )
            .expect("control signal json");
            assert_eq!(signal["interruptCount"], 0, "case={case}");
            assert_eq!(signal["termCount"], 0, "case={case}");
        }

        kill_process_group(first_group);
        wait_for_child_to_exit(first_pid);
        wait_for_child_to_exit(child_pid);
        if let Some(control_pid) = control_pid {
            kill_process_group(control_group.expect("control group"));
            wait_for_child_to_exit(control_pid);
        }
        assert!(matches!(
            storage.cleanup_session(&session_id),
            chat_history_analysis_lib::secure_storage::CleanupOutcome::Complete { .. }
        ));
    }
}

#[test]
fn synthetic_orphan_helper_escalates_ignored_signals_and_cleans_owned_tree() {
    let fixture = Fixture::new();
    let storage = SecureStorage::new(&fixture.cache_root).expect("secure storage");
    let session_id = "ses_0000000000000000000000000000001a";
    storage.create_session(session_id, 1).expect("session");
    let metadata_path = fixture.working_directory.join("orphan-metadata.json");
    let nonce = "nonce_0000000000000000000000000000001a";
    let mut launcher = spawn_detached_orphan(&fixture, &metadata_path, None, nonce, true, true);
    let metadata = wait_for_orphan_metadata(&metadata_path);
    launcher.wait().expect("orphan launcher");
    let child_pid = metadata["childPid"].as_u64().expect("orphan child") as i32;
    let owner = OwnerRecord {
        schema_version: OWNER_RECORD_SCHEMA_VERSION.to_string(),
        state_version: "active.v1".to_string(),
        pid: metadata["pid"].as_u64().expect("orphan pid") as u32,
        process_group_id: metadata["processGroupId"].as_i64().expect("orphan pgid") as i32,
        start_fingerprint: metadata["startFingerprint"]
            .as_str()
            .expect("orphan start")
            .to_string(),
        executable_fingerprint: metadata["executableFingerprint"]
            .as_str()
            .expect("orphan executable")
            .to_string(),
        session_id: session_id.to_string(),
        generation: 1,
        nonce: nonce.to_string(),
    };
    storage
        .write_owner_record(session_id, &owner)
        .expect("owner record");

    let recovery = recover_startup_sessions(&fixture.cache_root).expect("hung recovery");
    assert_eq!(recovery.recognized_session_count, 1);
    assert_eq!(recovery.cleaned_session_count, 1);
    assert!(!recovery.cleanup_required);
    assert!(!fixture.session_directory(session_id).exists());
    wait_for_child_to_exit(child_pid);
}

#[test]
fn watched_discard_waits_for_cancellation_before_removing_session() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::default();
    let started = supervisor
        .start("main", fixture.resolution("delay"), fixture.input())
        .expect("start");
    let (sender, receiver) = std::sync::mpsc::channel();
    let session_id = started.session_id.clone();
    supervisor
        .watch("main", &session_id, started.generation, move |result| {
            sender.send(result).expect("watch result");
        })
        .expect("watch");
    let discarded = supervisor
        .discard("main", &session_id, started.generation)
        .expect("discard waits for watcher");
    assert!(matches!(
        discarded.cleanup,
        Some(CleanupStatus::Complete { .. })
    ));
    assert!(supervisor.active_snapshot().is_none());
    let watched = receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("watch completion")
        .expect("watched snapshot");
    assert_eq!(watched.cancel_reason, Some(CancelReason::Replacement));
}

#[test]
fn live_progress_and_watchdog_close_silent_and_stalled_sidecars() {
    let fixture = Fixture::new();
    let supervisor = SessionSupervisor::with_watchdog_timeouts(
        Duration::from_millis(150),
        Duration::from_millis(250),
    );
    let silent = supervisor
        .start("main", fixture.resolution("silent"), fixture.input())
        .expect("start silent sidecar");
    let (silent_result_sender, silent_result_receiver) = std::sync::mpsc::channel();
    supervisor
        .watch_with_progress(
            "main",
            &silent.session_id,
            silent.generation,
            |_| {},
            move |result| {
                silent_result_sender.send(result).expect("silent result");
            },
        )
        .expect("watch silent sidecar");
    let silent_result = silent_result_receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("silent watchdog result")
        .expect("silent snapshot");
    assert_eq!(
        silent_result.terminal,
        Some(SessionTerminal::Failed(
            "SIDECAR_HANDSHAKE_TIMEOUT".to_string()
        ))
    );
    supervisor
        .discard("main", &silent.session_id, silent.generation)
        .expect("discard silent session");

    let stalled = supervisor
        .start("main", fixture.resolution("no-terminal"), fixture.input())
        .expect("start stalled sidecar");
    let (progress_sender, progress_receiver) = std::sync::mpsc::channel();
    let (stalled_result_sender, stalled_result_receiver) = std::sync::mpsc::channel();
    supervisor
        .watch_with_progress(
            "main",
            &stalled.session_id,
            stalled.generation,
            move |progress| {
                progress_sender.send(progress).expect("progress");
            },
            move |result| {
                stalled_result_sender.send(result).expect("stalled result");
            },
        )
        .expect("watch stalled sidecar");
    assert_eq!(
        progress_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("initial heartbeat")
            .phase,
        "startup"
    );
    let stalled_result = stalled_result_receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("stalled watchdog result")
        .expect("stalled snapshot");
    assert_eq!(
        stalled_result.terminal,
        Some(SessionTerminal::Failed("PREPROCESSING_STALLED".to_string()))
    );
    supervisor
        .discard("main", &stalled.session_id, stalled.generation)
        .expect("discard stalled session");
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
    let cancelled = supervisor
        .cancel(
            "main",
            &started.session_id,
            started.generation,
            CancelReason::User,
        )
        .expect("worker-only terminal cancel is accepted");
    assert_eq!(cancelled.terminal, completed.terminal);
    assert_eq!(cancelled.state, SessionState::Cancelling);
    assert_eq!(cancelled.cancel_reason, Some(CancelReason::User));
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
    wait_for_path(&fixture.working_directory.join("worker-ready"));
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
    wait_for_path(&pid_file);
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
    assert_eq!(completed.state, SessionState::Analyzing);

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
    let _ = remove_file_if_present(&unknown);
    supervisor
        .discard("main", &started.session_id, started.generation)
        .expect("cleanup retry");
    assert!(supervisor.active_snapshot().is_none());
}
