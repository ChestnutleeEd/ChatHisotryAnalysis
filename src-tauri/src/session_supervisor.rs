//! Host-owned sidecar resolution, process supervision, and session lifecycle.
//!
//! This module is deliberately independent from the renderer IPC command
//! handlers.  The renderer can request a named operation, but it never gets a
//! path, executable, argument list, environment, PID, process-group ID, or
//! session-directory capability.  Native selection and the application cache
//! are host inputs to [`SessionInput`].

use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::fmt;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::ipc::valid_state_transition;
use crate::lifecycle::{CleanupCoordinator, CleanupKey, CleanupTerminal};
use crate::security::trusted_main_window_label;
use crate::trust_anchor::{self, SIDECAR_BUNDLE_DIRECTORY};

pub const SIDECAR_PROTOCOL_VERSION: &str = "chat-history-analysis.sidecar.v1";
pub const MAX_CONFIGURATION_BYTES: usize = 1_048_576;
pub const MAX_PROTOCOL_LINE_BYTES: usize = 16_384;
pub const MAX_PROTOCOL_EVENTS: usize = 4_096;
pub const MAX_SOURCES: usize = 20;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const ANALYSIS_SESSIONS_DIRECTORY: &str = "analysis-sessions";
pub const SIDECAR_EXECUTABLE_ARGUMENT: &str = "sidecar";
pub const GRACEFUL_CANCEL_GRACE: Duration = Duration::from_millis(500);
pub const TERM_CANCEL_GRACE: Duration = Duration::from_millis(500);
pub const FINAL_KILL_WAIT: Duration = Duration::from_millis(750);
pub const WATCHER_TERMINAL_WAIT: Duration = Duration::from_millis(3_000);
pub const SIDECAR_SPAWN_TIMEOUT: Duration = Duration::from_secs(15);
pub const SIDECAR_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
pub const PREPROCESSING_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(45);
pub const SESSION_MARKER_CONTENT: &[u8] = b"chat-history-analysis-session-v1\n";

const SIDECAR_PROTOCOL_VERSION_FIELD: &str = "protocolVersion";
const SIDECAR_EVIDENCE_ENV: &str = "CHAT_HISTORY_ANALYSIS_PARENT_NONCE";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupervisorErrorCode {
    InvalidRequest,
    InvalidState,
    WindowNotAuthorized,
    SessionBusy,
    SessionStale,
    SidecarUnavailable,
    SidecarVerificationFailed,
    SidecarSpawnFailed,
    SidecarStartFailed,
    SidecarHandshakeTimeout,
    PreprocessingStalled,
    SidecarProtocolMismatch,
    SidecarProtocolFailed,
    SidecarProtocolInvalid,
    SidecarCrashed,
    SidecarExitedUnexpectedly,
    SidecarExited,
    SessionCancelled,
    SessionCleanupFailed,
    CleanupRequired,
    ProcessIdentityMismatch,
    DiskSpaceInsufficient,
}

impl SupervisorErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::InvalidState => "INVALID_STATE",
            Self::WindowNotAuthorized => "WINDOW_NOT_AUTHORIZED",
            Self::SessionBusy => "SESSION_BUSY",
            Self::SessionStale => "SESSION_STALE",
            Self::SidecarUnavailable => "SIDECAR_UNAVAILABLE",
            Self::SidecarVerificationFailed => "SIDECAR_VERIFICATION_FAILED",
            Self::SidecarSpawnFailed => "SIDECAR_SPAWN_FAILED",
            Self::SidecarStartFailed => "SIDECAR_START_FAILED",
            Self::SidecarHandshakeTimeout => "SIDECAR_HANDSHAKE_TIMEOUT",
            Self::PreprocessingStalled => "PREPROCESSING_STALLED",
            Self::SidecarProtocolMismatch => "SIDECAR_PROTOCOL_MISMATCH",
            Self::SidecarProtocolFailed => "SIDECAR_PROTOCOL_FAILED",
            Self::SidecarProtocolInvalid => "SIDECAR_PROTOCOL_INVALID",
            Self::SidecarCrashed => "SIDECAR_CRASHED",
            Self::SidecarExitedUnexpectedly => "SIDECAR_EXITED_UNEXPECTEDLY",
            Self::SidecarExited => "SIDECAR_EXITED",
            Self::SessionCancelled => "SESSION_CANCELLED",
            Self::SessionCleanupFailed => "SESSION_CLEANUP_FAILED",
            Self::CleanupRequired => "CLEANUP_REQUIRED",
            Self::ProcessIdentityMismatch => "PROCESS_IDENTITY_MISMATCH",
            Self::DiskSpaceInsufficient => "DISK_SPACE_INSUFFICIENT",
        }
    }
}

impl fmt::Display for SupervisorErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupervisorError {
    pub code: SupervisorErrorCode,
}

impl SupervisorError {
    const fn new(code: SupervisorErrorCode) -> Self {
        Self { code }
    }
}

impl fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.code.fmt(formatter)
    }
}

impl std::error::Error for SupervisorError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Idle,
    Selecting,
    Ready,
    Preprocessing,
    Handoff,
    Analyzing,
    Complete,
    Cancelling,
    Failed,
    Discarding,
    Closing,
}

impl SessionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Selecting => "selecting",
            Self::Ready => "ready",
            Self::Preprocessing => "preprocessing",
            Self::Handoff => "handoff",
            Self::Analyzing => "analyzing",
            Self::Complete => "complete",
            Self::Cancelling => "cancelling",
            Self::Failed => "failed",
            Self::Discarding => "discarding",
            Self::Closing => "closing",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarProgress {
    pub phase: String,
    pub percentage: u8,
    pub status: String,
    pub aggregate_count: u64,
    pub capacity_value: u64,
    pub role: Option<String>,
    pub source_ordinal: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarResult {
    pub source_count: u64,
    pub event_count: u64,
    pub eligible_text_count: u64,
    pub chunk_count: u64,
    pub duplicate_event_count: u64,
    pub warning_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionTerminal {
    Complete(SidecarResult),
    Failed(String),
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CleanupStatus {
    Complete { removed_entry_count: u64 },
    Required,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent {
    State(SessionState),
    Progress(SidecarProgress),
    Terminal(SessionTerminal),
    Cleanup(CleanupStatus),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSnapshot {
    pub operation_id: String,
    pub session_id: String,
    pub generation: u64,
    pub state: SessionState,
    pub terminal: Option<SessionTerminal>,
    pub cleanup: Option<CleanupStatus>,
    pub cancel_reason: Option<CancelReason>,
    pub phase: String,
    pub progress: Option<SidecarProgress>,
    pub heartbeat_status: HeartbeatStatus,
    pub elapsed_bucket: String,
    pub cancel_available: bool,
    pub events: Vec<SessionEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeartbeatStatus {
    Starting,
    Active,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WatchdogTimeouts {
    pub spawn: Duration,
    pub handshake: Duration,
    pub inactivity: Duration,
}

impl Default for WatchdogTimeouts {
    fn default() -> Self {
        Self {
            spawn: SIDECAR_SPAWN_TIMEOUT,
            handshake: SIDECAR_HANDSHAKE_TIMEOUT,
            inactivity: PREPROCESSING_INACTIVITY_TIMEOUT,
        }
    }
}

/// Host-owned paths and fixed working directory.  Its Debug implementation
/// intentionally omits every path because paths are private protocol data.
#[derive(Clone)]
pub struct SessionInput {
    annual_sources: Vec<PathBuf>,
    verification_sources: Vec<PathBuf>,
    application_cache_root: PathBuf,
    working_directory: PathBuf,
}

impl SessionInput {
    pub fn new(
        annual_sources: Vec<PathBuf>,
        verification_sources: Vec<PathBuf>,
        application_cache_root: PathBuf,
        working_directory: PathBuf,
    ) -> Self {
        Self {
            annual_sources,
            verification_sources,
            application_cache_root,
            working_directory,
        }
    }

    pub(crate) fn total_source_bytes(&self) -> Result<u64, SupervisorError> {
        let mut total = 0u64;
        for path in self
            .annual_sources
            .iter()
            .chain(self.verification_sources.iter())
        {
            let size = fs::symlink_metadata(path)
                .map(|metadata| metadata.len())
                .map_err(|_| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?;
            total = total
                .checked_add(size)
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::DiskSpaceInsufficient))?;
        }
        Ok(total)
    }

    fn validate(&self) -> Result<(), SupervisorError> {
        if self.annual_sources.is_empty()
            || self.annual_sources.len() > MAX_SOURCES
            || self.verification_sources.len() > MAX_SOURCES
            || !directory_location(&self.application_cache_root)
            || !absolute_directory(&self.working_directory)
            || self
                .annual_sources
                .iter()
                .chain(self.verification_sources.iter())
                .any(|path| !source_file_path(path))
        {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidRequest));
        }
        if !secure_directory(&self.working_directory) {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidRequest));
        }
        Ok(())
    }
}

impl fmt::Debug for SessionInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionInput")
            .field("annual_source_count", &self.annual_sources.len())
            .field(
                "verification_source_count",
                &self.verification_sources.len(),
            )
            .finish()
    }
}

#[derive(Clone)]
pub struct SidecarResolution {
    executable: PathBuf,
    fixed_args: Vec<String>,
    packaged: bool,
}

impl fmt::Debug for SidecarResolution {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SidecarResolution")
            .field("packaged", &self.packaged)
            .field("argument_count", &self.fixed_args.len())
            .finish()
    }
}

impl SidecarResolution {
    /// Resolve the only production packaged location and verify it before a
    /// caller can build a launch.  No PATH lookup or renderer input is used.
    pub fn packaged(resource_directory: &Path) -> Result<Self, SupervisorError> {
        if !absolute_directory(resource_directory) {
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarUnavailable,
            ));
        }
        let bundle_root = resource_directory.join(SIDECAR_BUNDLE_DIRECTORY);
        trust_anchor::verify_sidecar_bundle(&bundle_root)
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarVerificationFailed))?;
        let anchor = trust_anchor::embedded_anchor()
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarVerificationFailed))?;
        let executable = bundle_root.join(anchor.executable_name);
        validate_executable(&executable)?;
        Ok(Self {
            executable,
            fixed_args: vec![SIDECAR_EXECUTABLE_ARGUMENT.to_string()],
            packaged: true,
        })
    }

    /// Development mode still requires a host-selected absolute executable.
    /// It is never resolved from PATH and uses the same `sidecar` argv.
    pub fn development(executable: PathBuf) -> Result<Self, SupervisorError> {
        validate_executable(&executable)?;
        Ok(Self {
            executable,
            fixed_args: vec![SIDECAR_EXECUTABLE_ARGUMENT.to_string()],
            packaged: false,
        })
    }

    /// Development Python seam with a fixed host-owned entrypoint. The
    /// entrypoint is not renderer-controlled and is never resolved from PATH.
    pub fn development_python(
        executable: PathBuf,
        entrypoint: PathBuf,
    ) -> Result<Self, SupervisorError> {
        validate_executable(&executable)?;
        validate_entrypoint(&entrypoint)?;
        Ok(Self {
            executable,
            fixed_args: vec![
                entrypoint
                    .to_str()
                    .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?
                    .to_string(),
                SIDECAR_EXECUTABLE_ARGUMENT.to_string(),
            ],
            packaged: false,
        })
    }

    /// Test-only host seam for the compiled synthetic sidecar.  Production
    /// callers use [`Self::packaged`] or [`Self::development`].
    pub fn host_owned_for_test(
        executable: PathBuf,
        fixed_args: Vec<String>,
    ) -> Result<Self, SupervisorError> {
        validate_executable(&executable)?;
        if fixed_args.iter().any(|argument| {
            argument.is_empty() || argument.starts_with('/') || argument.contains('\0')
        }) {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidRequest));
        }
        Ok(Self {
            executable,
            fixed_args,
            packaged: false,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParserError {
    Invalid,
    TooLarge,
    MissingTerminal,
    ProtocolMismatch,
}

#[derive(Debug)]
struct ParsedStdout {
    progress: Vec<SidecarProgress>,
    result: SidecarResult,
}

#[derive(Debug)]
struct ParsedStderr {
    reason_code: String,
}

#[derive(Debug)]
struct RunOutcome {
    terminal: Result<SidecarTerminalResult, SupervisorErrorCode>,
}

#[derive(Debug)]
enum SidecarTerminalResult {
    Success(SidecarResult, Vec<SidecarProgress>),
    Failure(String),
}

#[derive(Debug, Clone)]
struct ProcessIdentity {
    pid: u32,
    group_id: i32,
    executable: PathBuf,
    executable_fingerprint: String,
    start_fingerprint: String,
    nonce: String,
    session_id: String,
    generation: u64,
}

#[derive(Debug)]
struct ProcessControl {
    identity: ProcessIdentity,
    stdin: Mutex<Option<ChildStdin>>,
    forced: AtomicBool,
    signal_stage: AtomicU8,
}

impl ProcessControl {
    fn close_stdin(&self) {
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
    }

    fn signal(
        &self,
        session_id: &str,
        generation: u64,
        signal: i32,
    ) -> Result<(), SupervisorError> {
        let requested_stage = match signal {
            2 => 1,
            15 => 2,
            9 => 3,
            _ => return Err(SupervisorError::new(SupervisorErrorCode::InvalidRequest)),
        };
        loop {
            let current_stage = self.signal_stage.load(Ordering::Acquire);
            if current_stage >= requested_stage {
                return Ok(());
            }
            if self
                .signal_stage
                .compare_exchange(
                    current_stage,
                    requested_stage,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok()
            {
                break;
            }
        }
        if self.identity.session_id != session_id
            || self.identity.generation != generation
            || self.identity.session_id.is_empty()
            || self.identity.generation == 0
        {
            let _ = self.signal_stage.compare_exchange(
                requested_stage,
                requested_stage.saturating_sub(1),
                Ordering::AcqRel,
                Ordering::Acquire,
            );
            return Err(SupervisorError::new(
                SupervisorErrorCode::ProcessIdentityMismatch,
            ));
        }
        match process_identity_status(&self.identity) {
            IdentityStatus::Exited => Ok(()),
            IdentityStatus::Mismatch => {
                let _ = self.signal_stage.compare_exchange(
                    requested_stage,
                    requested_stage.saturating_sub(1),
                    Ordering::AcqRel,
                    Ordering::Acquire,
                );
                Err(SupervisorError::new(
                    SupervisorErrorCode::ProcessIdentityMismatch,
                ))
            }
            IdentityStatus::Alive => send_process_group_signal(self.identity.group_id, signal),
        }
    }

    fn force_kill(&self, session_id: &str, generation: u64) -> Result<(), SupervisorError> {
        self.forced.store(true, Ordering::Release);
        self.signal(session_id, generation, 9)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdentityStatus {
    Alive,
    Exited,
    Mismatch,
}

struct ActiveSession {
    input: SessionInput,
    storage: Option<crate::secure_storage::SecureStorage>,
    output_directory: PathBuf,
    window_label: String,
    operation_id: String,
    session_id: String,
    generation: u64,
    state: SessionState,
    terminal: Option<SessionTerminal>,
    cleanup: Option<CleanupStatus>,
    events: Vec<SessionEvent>,
    process: Arc<ProcessControl>,
    progress_receiver: Option<Receiver<SidecarProgress>>,
    outcome_receiver: Option<Receiver<RunOutcome>>,
    watcher_active: bool,
    cancel_reason: Option<CancelReason>,
    started_at: Instant,
    last_heartbeat_at: Option<Instant>,
    worker: Option<Arc<dyn WorkerTermination>>,
}

/// A terminal operation is no longer an active supervisor slot.  The small
/// retained record keeps only the original host-owned selection authority and
/// content-free terminal snapshot needed by Retry/cleanup recovery.
struct RetainedSession {
    input: SessionInput,
    storage: Option<crate::secure_storage::SecureStorage>,
    output_directory: PathBuf,
    snapshot: SessionSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    User,
    Replacement,
    ApplicationClose,
}

/// Host-only hook for the analytics Worker generation that consumes a
/// verified handoff. Stage 3 owns the cancellation boundary; Stage 4 wires
/// the real Worker implementation through this trait without exposing a
/// process or capability to the renderer.
pub trait WorkerTermination: Send + Sync {
    fn request_cancellation(&self);
    fn force_terminate(&self);

    /// Wait for the Worker runtime to acknowledge that it has stopped.  The
    /// default keeps host-only test implementations source-compatible while
    /// making the production renderer lease an explicit cleanup barrier.
    fn wait_for_termination(&self, _timeout: Duration) -> bool {
        false
    }

    fn acknowledge_termination(&self) {}
}

struct SupervisorInner {
    next_generation: u64,
    active: Option<ActiveSession>,
    retained: Option<RetainedSession>,
}

#[derive(Clone)]
pub struct SessionSupervisor {
    inner: Arc<Mutex<SupervisorInner>>,
    cleanup_coordinator: CleanupCoordinator,
    watchdog_timeouts: WatchdogTimeouts,
}

impl fmt::Debug for SessionSupervisor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionSupervisor")
    }
}

impl Default for SessionSupervisor {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SupervisorInner {
                next_generation: 0,
                active: None,
                retained: None,
            })),
            cleanup_coordinator: CleanupCoordinator::default(),
            watchdog_timeouts: WatchdogTimeouts::default(),
        }
    }
}

impl SessionSupervisor {
    /// Construct a supervisor with explicit watchdog deadlines.  Production
    /// uses [`Default`]; the shorter deadlines are a deterministic synthetic
    /// seam for lifecycle tests and never receive renderer input.
    pub fn with_watchdog_timeouts(handshake: Duration, inactivity: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SupervisorInner {
                next_generation: 0,
                active: None,
                retained: None,
            })),
            cleanup_coordinator: CleanupCoordinator::default(),
            watchdog_timeouts: WatchdogTimeouts {
                spawn: SIDECAR_SPAWN_TIMEOUT,
                handshake,
                inactivity,
            },
        }
    }

    pub fn active_snapshot(&self) -> Option<SessionSnapshot> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.active.as_ref().map(snapshot))
    }

    /// Return the last terminal snapshot without making it an active slot.
    /// This is a host-only recovery seam; it never exposes paths or content.
    pub fn retained_snapshot(&self) -> Option<SessionSnapshot> {
        self.inner.lock().ok().and_then(|inner| {
            inner
                .retained
                .as_ref()
                .map(|retained| retained.snapshot.clone())
        })
    }

    pub fn start(
        &self,
        window_label: &str,
        resolution: SidecarResolution,
        input: SessionInput,
    ) -> Result<SessionSnapshot, SupervisorError> {
        if !trusted_main_window_label(window_label) {
            return Err(SupervisorError::new(
                SupervisorErrorCode::WindowNotAuthorized,
            ));
        }
        let storage =
            crate::secure_storage::SecureStorage::new_or_create(&input.application_cache_root)
                .map_err(|_| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?;
        ensure_secure_directory(&input.working_directory)?;
        input.validate()?;
        storage
            .sessions_root()
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::SessionCleanupFailed))?;

        // Reserve the only live-generation slot before spawning.  Keeping the
        // guard across spawn closes the check/spawn/insert race without ever
        // needing to kill a just-started session behind a competing caller.
        let mut inner = self.lock_inner()?;
        if inner.active.is_some() {
            return Err(SupervisorError::new(SupervisorErrorCode::SessionBusy));
        }
        if let Some(retained) = inner.retained.take() {
            if !matches!(
                retained.snapshot.cleanup,
                Some(CleanupStatus::Complete { .. })
            ) {
                inner.retained = Some(retained);
                return Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired));
            }
            self.cleanup_coordinator.forget(&CleanupKey::new(
                window_label,
                &retained.snapshot.session_id,
                retained.snapshot.generation,
            ));
        }
        inner.next_generation = inner
            .next_generation
            .checked_add(1)
            .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidState))?;
        let session_id = opaque_id("ses_")?;
        let operation_id = opaque_id("op_")?;
        let generation = inner.next_generation;
        let output_directory = input
            .application_cache_root
            .join(ANALYSIS_SESSIONS_DIRECTORY)
            .join(&session_id);
        let free_bytes = available_free_bytes(&input.application_cache_root)?;
        if !free_space_satisfies(
            free_bytes,
            required_session_bytes(input.total_source_bytes()?),
        ) {
            return Err(SupervisorError::new(
                SupervisorErrorCode::DiskSpaceInsufficient,
            ));
        }
        let normalized_directory = storage
            .create_session(&session_id, generation)
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarStartFailed))?;

        let nonce = opaque_id("nonce_")?;
        let configuration = build_configuration(
            &session_id,
            generation,
            &nonce,
            &input,
            &normalized_directory,
        )?;
        let launch = SidecarLaunch {
            resolution,
            cwd: input.working_directory.clone(),
            configuration,
            nonce,
        };
        let (process, progress_receiver, receiver) =
            match spawn_sidecar(launch, &session_id, generation, self.watchdog_timeouts) {
                Ok(value) => value,
                Err(error) => {
                    let _ =
                        cleanup_session_directory(Some(&storage), &output_directory, &session_id);
                    return Err(error);
                }
            };

        if write_owner_record(&storage, &session_id, generation, &process.identity).is_err() {
            let _ = process.force_kill(&session_id, generation);
            thread::sleep(FINAL_KILL_WAIT);
            let _ = cleanup_session_directory(Some(&storage), &output_directory, &session_id);
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        }

        let mut events = Vec::with_capacity(8);
        events.push(SessionEvent::State(SessionState::Ready));
        events.push(SessionEvent::State(SessionState::Preprocessing));
        inner.active = Some(ActiveSession {
            input,
            storage: Some(storage),
            output_directory,
            window_label: window_label.to_string(),
            operation_id,
            session_id,
            generation,
            state: SessionState::Preprocessing,
            terminal: None,
            cleanup: None,
            events,
            process,
            progress_receiver: Some(progress_receiver),
            outcome_receiver: Some(receiver),
            watcher_active: false,
            cancel_reason: None,
            started_at: Instant::now(),
            last_heartbeat_at: None,
            worker: None,
        });
        Ok(inner
            .active
            .as_ref()
            .map(snapshot)
            .expect("active session inserted"))
    }

    pub fn wait(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        timeout: Duration,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let (receiver, progress_receiver) = {
            let mut inner = self.lock_inner()?;
            validate_active(&inner, window_label, session_id, generation)?;
            let active = inner.active.as_mut().expect("validated active session");
            if active.terminal.is_some() {
                return Ok(snapshot(active));
            }
            let receiver = active
                .outcome_receiver
                .take()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidState))?;
            (receiver, active.progress_receiver.take())
        };

        let deadline = Instant::now() + timeout;
        loop {
            if let Some(progress_receiver) = progress_receiver.as_ref() {
                while let Ok(progress) = progress_receiver.try_recv() {
                    let _ = self.record_progress(session_id, generation, progress);
                }
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.put_back_receivers(session_id, generation, receiver, progress_receiver)?;
                let _ = self.cancel(
                    window_label,
                    session_id,
                    generation,
                    CancelReason::ApplicationClose,
                );
                return Err(SupervisorError::new(
                    SupervisorErrorCode::SidecarHandshakeTimeout,
                ));
            }
            match receiver.recv_timeout(remaining.min(Duration::from_millis(25))) {
                Ok(outcome) => {
                    if let Some(progress_receiver) = progress_receiver.as_ref() {
                        while let Ok(progress) = progress_receiver.try_recv() {
                            let _ = self.record_progress(session_id, generation, progress);
                        }
                    }
                    return self.apply_outcome(session_id, generation, outcome);
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return self.apply_outcome(
                        session_id,
                        generation,
                        RunOutcome {
                            terminal: Err(SupervisorErrorCode::SidecarCrashed),
                        },
                    );
                }
            }
        }
    }

    /// Move the sidecar outcome receiver to a host watcher. This is the
    /// production event path: the renderer command can request cancellation
    /// while the watcher remains the sole consumer of the process outcome.
    pub fn watch<F>(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        callback: F,
    ) -> Result<(), SupervisorError>
    where
        F: FnOnce(Result<SessionSnapshot, SupervisorError>) + Send + 'static,
    {
        self.watch_with_progress(window_label, session_id, generation, |_| {}, callback)
    }

    pub fn watch_with_progress<P, F>(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        on_progress: P,
        callback: F,
    ) -> Result<(), SupervisorError>
    where
        P: Fn(SidecarProgress) + Send + 'static,
        F: FnOnce(Result<SessionSnapshot, SupervisorError>) + Send + 'static,
    {
        let (receiver, progress_receiver) = {
            let mut inner = self.lock_inner()?;
            validate_active(&inner, window_label, session_id, generation)?;
            let active = inner.active.as_mut().expect("validated active session");
            if active.terminal.is_some() || active.watcher_active {
                return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
            }
            active.watcher_active = true;
            let receiver = active
                .outcome_receiver
                .take()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidState))?;
            let progress_receiver = active
                .progress_receiver
                .take()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidState))?;
            (receiver, progress_receiver)
        };
        let supervisor = self.clone();
        let window_label = window_label.to_string();
        let session_id = session_id.to_string();
        thread::Builder::new()
            .name("sidecar-outcome-watcher".to_string())
            .spawn(move || {
                let result = loop {
                    while let Ok(progress) = progress_receiver.try_recv() {
                        if supervisor
                            .record_progress(&session_id, generation, progress.clone())
                            .is_ok()
                        {
                            on_progress(progress);
                        }
                    }
                    match receiver.recv_timeout(Duration::from_millis(25)) {
                        Ok(outcome) => {
                            while let Ok(progress) = progress_receiver.try_recv() {
                                if supervisor
                                    .record_progress(&session_id, generation, progress.clone())
                                    .is_ok()
                                {
                                    on_progress(progress);
                                }
                            }
                            break supervisor.apply_outcome(&session_id, generation, outcome);
                        }
                        Err(RecvTimeoutError::Timeout) => continue,
                        Err(RecvTimeoutError::Disconnected) => {
                            break supervisor.apply_outcome(
                                &session_id,
                                generation,
                                RunOutcome {
                                    terminal: Err(SupervisorErrorCode::SidecarCrashed),
                                },
                            );
                        }
                    }
                };
                callback(result);
                let _ = (window_label, session_id, generation);
            })
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarStartFailed))?;
        Ok(())
    }

    pub fn cancel(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        reason: CancelReason,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let worker_only = {
            let mut inner = self.lock_inner()?;
            validate_active(&inner, window_label, session_id, generation)?;
            let active = inner.active.as_mut().expect("validated active session");
            if matches!(active.terminal, Some(SessionTerminal::Complete(_)))
                && active.state == SessionState::Analyzing
            {
                if active.state != SessionState::Cancelling {
                    transition(active, SessionState::Cancelling)?;
                    active
                        .events
                        .push(SessionEvent::State(SessionState::Cancelling));
                    active.cancel_reason = Some(reason);
                }
                active.worker.clone()
            } else {
                None
            }
        };
        if let Some(worker) = worker_only {
            worker.request_cancellation();
            self.wait_for_worker_termination(session_id, generation);
            return self
                .active_snapshot()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        let watched_process = {
            let mut inner = self.lock_inner()?;
            validate_active(&inner, window_label, session_id, generation)?;
            let active = inner.active.as_mut().expect("validated active session");
            if active.terminal.is_some() {
                return Ok(snapshot(active));
            }
            if !active.watcher_active {
                None
            } else {
                if active.state != SessionState::Cancelling {
                    transition(active, SessionState::Cancelling)?;
                    active
                        .events
                        .push(SessionEvent::State(SessionState::Cancelling));
                    active.cancel_reason = Some(reason);
                }
                Some(Arc::clone(&active.process))
            }
        };
        if let Some(process) = watched_process {
            self.request_worker_cancellation(session_id, generation);
            self.wait_for_worker_termination(session_id, generation);
            if let Err(error) = process.signal(session_id, generation, 2) {
                if error.code == SupervisorErrorCode::ProcessIdentityMismatch {
                    self.mark_cleanup_required(session_id, generation);
                }
                return Err(error);
            }
            let escalation_process = Arc::clone(&process);
            let escalation_supervisor = self.clone();
            let escalation_session = session_id.to_string();
            thread::spawn(move || {
                thread::sleep(GRACEFUL_CANCEL_GRACE);
                if process_is_alive(escalation_process.identity.pid) {
                    escalation_supervisor.force_worker_termination(&escalation_session, generation);
                    let _ = escalation_process.signal(&escalation_session, generation, 15);
                    thread::sleep(TERM_CANCEL_GRACE);
                    if process_is_alive(escalation_process.identity.pid) {
                        escalation_supervisor
                            .force_worker_termination(&escalation_session, generation);
                        let _ = escalation_process.force_kill(&escalation_session, generation);
                    }
                }
            });
            return self
                .active_snapshot()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        let (process, receiver, progress_receiver) = {
            let mut inner = self.lock_inner()?;
            validate_active(&inner, window_label, session_id, generation)?;
            let active = inner.active.as_mut().expect("validated active session");
            if active.terminal.is_some() {
                return Ok(snapshot(active));
            }
            if active.state != SessionState::Cancelling {
                transition(active, SessionState::Cancelling)?;
                active
                    .events
                    .push(SessionEvent::State(SessionState::Cancelling));
                active.cancel_reason = Some(reason);
            }
            let receiver = active
                .outcome_receiver
                .take()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidState))?;
            let progress_receiver = active.progress_receiver.take();
            (Arc::clone(&active.process), receiver, progress_receiver)
        };

        self.request_worker_cancellation(session_id, generation);
        self.wait_for_worker_termination(session_id, generation);
        if let Err(error) = process.signal(session_id, generation, 2) {
            if error.code == SupervisorErrorCode::ProcessIdentityMismatch {
                self.mark_cleanup_required(session_id, generation);
            }
            self.put_back_receivers(session_id, generation, receiver, progress_receiver)?;
            return Err(error);
        }
        let result = receiver.recv_timeout(GRACEFUL_CANCEL_GRACE);
        let outcome = match result {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Disconnected) => {
                return self.apply_outcome(
                    session_id,
                    generation,
                    RunOutcome {
                        terminal: Err(SupervisorErrorCode::SidecarCrashed),
                    },
                );
            }
            Err(RecvTimeoutError::Timeout) => {
                process.close_stdin();
                self.force_worker_termination(session_id, generation);
                if let Err(error) = process.signal(session_id, generation, 15) {
                    if error.code == SupervisorErrorCode::ProcessIdentityMismatch {
                        self.mark_cleanup_required(session_id, generation);
                    }
                    self.put_back_receivers(session_id, generation, receiver, progress_receiver)?;
                    return Err(error);
                }
                match receiver.recv_timeout(TERM_CANCEL_GRACE) {
                    Ok(outcome) => outcome,
                    Err(RecvTimeoutError::Disconnected) => {
                        return self.apply_outcome(
                            session_id,
                            generation,
                            RunOutcome {
                                terminal: Err(SupervisorErrorCode::SidecarCrashed),
                            },
                        );
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        self.force_worker_termination(session_id, generation);
                        if let Err(error) = process.force_kill(session_id, generation) {
                            if error.code == SupervisorErrorCode::ProcessIdentityMismatch {
                                self.mark_cleanup_required(session_id, generation);
                            }
                            self.put_back_receivers(
                                session_id,
                                generation,
                                receiver,
                                progress_receiver,
                            )?;
                            return Err(error);
                        }
                        match receiver.recv_timeout(FINAL_KILL_WAIT) {
                            Ok(outcome) => outcome,
                            Err(RecvTimeoutError::Disconnected) => {
                                return self.apply_outcome(
                                    session_id,
                                    generation,
                                    RunOutcome {
                                        terminal: Err(SupervisorErrorCode::SidecarCrashed),
                                    },
                                );
                            }
                            Err(RecvTimeoutError::Timeout) => {
                                self.put_back_receivers(
                                    session_id,
                                    generation,
                                    receiver,
                                    progress_receiver,
                                )?;
                                return Err(SupervisorError::new(
                                    SupervisorErrorCode::SessionCleanupFailed,
                                ));
                            }
                        }
                    }
                }
            }
        };
        self.apply_outcome(session_id, generation, outcome)
    }

    pub fn attach_worker(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        worker: Arc<dyn WorkerTermination>,
    ) -> Result<(), SupervisorError> {
        let mut inner = self.lock_inner()?;
        validate_active(&inner, window_label, session_id, generation)?;
        let active = inner.active.as_mut().expect("validated active session");
        // The sidecar session is terminal after its first canonical dataset
        // result, but the renderer may still replace aggregate filters within
        // the same dataset session. Keep that host lease lifecycle separate
        // from the terminal sidecar state.
        if !matches!(
            active.state,
            SessionState::Preprocessing
                | SessionState::Handoff
                | SessionState::Analyzing
                | SessionState::Complete
        ) {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
        }
        if active.worker.is_some() {
            return Err(SupervisorError::new(SupervisorErrorCode::SessionBusy));
        }
        active.worker = Some(worker);
        Ok(())
    }

    pub fn detach_worker(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), SupervisorError> {
        let mut inner = self.lock_inner()?;
        validate_active(&inner, window_label, session_id, generation)?;
        let active = inner.active.as_mut().expect("validated active session");
        active.worker = None;
        Ok(())
    }

    pub fn acknowledge_worker_stop(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), SupervisorError> {
        let worker = {
            let inner = self.lock_inner()?;
            validate_active(&inner, window_label, session_id, generation)?;
            inner
                .active
                .as_ref()
                .and_then(|active| active.worker.clone())
        };
        let Some(worker) = worker else {
            return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
        };
        worker.acknowledge_termination();
        Ok(())
    }

    /// Commit the renderer Worker result into the host registry before the
    /// lifecycle reaches `complete`.  A missing lease is a stale production
    /// commit, never a reason to publish completion.
    pub fn worker_result_committed(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        validate_active(&inner, window_label, session_id, generation)?;
        let active = inner.active.as_mut().expect("validated active session");
        if !matches!(active.terminal, Some(SessionTerminal::Complete(_)))
            || !matches!(
                active.state,
                SessionState::Analyzing | SessionState::Complete
            )
            || active.worker.is_none()
        {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
        }
        active.worker = None;
        if active.state == SessionState::Analyzing {
            transition(active, SessionState::Complete)?;
            active
                .events
                .push(SessionEvent::State(SessionState::Complete));
        }
        Ok(snapshot(active))
    }

    pub fn discard(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        if self.active_snapshot().is_some_and(|snapshot| {
            (snapshot.terminal.is_none()
                || matches!(snapshot.terminal, Some(SessionTerminal::Complete(_)))
                    && snapshot.state == SessionState::Analyzing)
                && snapshot.state != SessionState::Closing
        }) {
            let cancelled = self.cancel(
                window_label,
                session_id,
                generation,
                CancelReason::Replacement,
            )?;
            if cancelled.terminal.is_none() {
                self.wait_for_terminal(session_id, generation)?;
            }
        }
        self.cleanup_and_maybe_remove(window_label, session_id, generation)
    }

    pub fn replace(
        &self,
        window_label: &str,
        resolution: SidecarResolution,
        input: SessionInput,
    ) -> Result<SessionSnapshot, SupervisorError> {
        if let Some(active) = self.active_snapshot() {
            if (active.terminal.is_none()
                || matches!(active.terminal, Some(SessionTerminal::Complete(_)))
                    && active.state == SessionState::Analyzing)
                && active.state != SessionState::Closing
            {
                let cancelled = self.cancel(
                    window_label,
                    &active.session_id,
                    active.generation,
                    CancelReason::Replacement,
                )?;
                if cancelled.terminal.is_none() {
                    self.wait_for_terminal(&active.session_id, active.generation)?;
                }
            }
            let _ =
                self.cleanup_and_maybe_remove(window_label, &active.session_id, active.generation)?;
        }
        self.start(window_label, resolution, input)
    }

    /// Fence and remove the current generation before a native source picker
    /// opens.  The picker must never run alongside a live sidecar or Worker.
    pub fn prepare_replacement(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        if let Some(active) = self.active_snapshot() {
            if active.session_id != session_id || active.generation != generation {
                return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
            }
            if (active.terminal.is_none()
                || matches!(active.terminal, Some(SessionTerminal::Complete(_)))
                    && active.state == SessionState::Analyzing)
                && active.state != SessionState::Closing
            {
                let cancelled = self.cancel(
                    window_label,
                    session_id,
                    generation,
                    CancelReason::Replacement,
                )?;
                if cancelled.terminal.is_none() {
                    self.wait_for_terminal(session_id, generation)?;
                }
            }
        }
        self.discard(window_label, session_id, generation)
    }

    pub fn retry(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        resolution: SidecarResolution,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let input = {
            let inner = self.lock_inner()?;
            if let Some(active) = inner.active.as_ref().filter(|active| {
                active.window_label == window_label
                    && active.session_id == session_id
                    && active.generation == generation
            }) {
                if active.state != SessionState::Failed {
                    return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
                }
                active.input.clone()
            } else if let Some(retained) = inner.retained.as_ref().filter(|retained| {
                retained.snapshot.session_id == session_id
                    && retained.snapshot.generation == generation
            }) {
                if !matches!(retained.snapshot.terminal, Some(SessionTerminal::Failed(_))) {
                    return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
                }
                retained.input.clone()
            } else {
                return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
            }
        };
        self.cleanup_and_maybe_remove(window_label, session_id, generation)?;
        self.start(window_label, resolution, input)
    }

    pub fn close(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        if let Some(active) = self.active_snapshot() {
            if active.session_id != session_id || active.generation != generation {
                return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
            }
            if (active.terminal.is_none()
                || matches!(active.terminal, Some(SessionTerminal::Complete(_)))
                    && active.state == SessionState::Analyzing)
                && active.state != SessionState::Closing
            {
                let cancelled = self.cancel(
                    window_label,
                    session_id,
                    generation,
                    CancelReason::ApplicationClose,
                )?;
                if cancelled.terminal.is_none() {
                    self.wait_for_terminal(session_id, generation)?;
                }
            }
            return self.cleanup_and_maybe_remove(window_label, session_id, generation);
        }
        self.cleanup_and_maybe_remove(window_label, session_id, generation)
    }

    pub fn shutdown(&self) {
        if let Some(active) = self.active_snapshot() {
            if (active.terminal.is_none()
                || matches!(active.terminal, Some(SessionTerminal::Complete(_)))
                    && active.state == SessionState::Analyzing)
                && active.state != SessionState::Closing
            {
                if let Ok(cancelled) = self.cancel(
                    "main",
                    &active.session_id,
                    active.generation,
                    CancelReason::ApplicationClose,
                ) {
                    if cancelled.terminal.is_none() {
                        let _ = self.wait_for_terminal(&active.session_id, active.generation);
                    }
                }
            }
            let _ = self.cleanup_and_maybe_remove("main", &active.session_id, active.generation);
        } else if let Some(retained) = self.retained_snapshot() {
            let _ =
                self.cleanup_and_maybe_remove("main", &retained.session_id, retained.generation);
        }
    }

    pub fn renderer_disconnected(&self, window_label: &str) {
        if let Some(active) = self.active_snapshot() {
            let _ = self.close(window_label, &active.session_id, active.generation);
        }
    }

    /// Convert a sidecar-successful but handoff-invalid generation into a
    /// retryable failed generation while retaining its validated input.
    /// Retry will create a fresh absent destination.
    pub fn reject_handoff(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        reason: &str,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        validate_active(&inner, window_label, session_id, generation)?;
        let active = inner.active.as_mut().expect("validated active session");
        if !matches!(active.terminal, Some(SessionTerminal::Complete(_))) {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
        }
        active.state = SessionState::Failed;
        let terminal = SessionTerminal::Failed(reason.to_string());
        active
            .events
            .push(SessionEvent::State(SessionState::Failed));
        active.events.push(SessionEvent::Terminal(terminal.clone()));
        active.terminal = Some(terminal);
        let output_directory = active.output_directory.clone();
        let window_label = active.window_label.clone();
        let active_session_id = active.session_id.clone();
        let active_generation = active.generation;
        let storage = active.storage.clone();
        let cleanup = self.cleanup_for_identity(
            &window_label,
            &active_session_id,
            active_generation,
            &output_directory,
            storage.as_ref(),
        );
        active.cleanup = Some(cleanup.clone());
        active.events.push(SessionEvent::Cleanup(cleanup));
        let result = snapshot(active);
        let can_release = active.worker.is_none()
            && !matches!(
                (&active.terminal, active.state),
                (Some(SessionTerminal::Complete(_)), SessionState::Analyzing)
            );
        if can_release {
            let retained = retain_terminal_locked(&mut inner);
            return retained.ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        Ok(result)
    }

    /// Complete an unexpected watcher/error path exactly once.  This is the
    /// fallback for failures that happen outside the normal sidecar outcome
    /// parser (for example a disconnected watcher or a late process error).
    /// It fences the generation, records a stable terminal reason, performs
    /// the same cleanup attempt as the normal path, and releases the live
    /// slot when no renderer Worker still owns the generation.
    pub fn finalize_unexpected(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        reason: SupervisorErrorCode,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        if inner.active.is_none() {
            return inner
                .retained
                .as_ref()
                .filter(|retained| {
                    retained.snapshot.session_id == session_id
                        && retained.snapshot.generation == generation
                })
                .map(|retained| retained.snapshot.clone())
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        validate_active(&inner, window_label, session_id, generation)?;
        let active = inner.active.as_mut().expect("validated active session");
        active.watcher_active = false;
        if active.terminal.is_none() {
            let cancelled = active.cancel_reason.is_some();
            let next_state = if cancelled {
                SessionState::Cancelling
            } else {
                SessionState::Failed
            };
            active.state = next_state;
            active.events.push(SessionEvent::State(next_state));
            let terminal = if cancelled {
                SessionTerminal::Cancelled
            } else {
                SessionTerminal::Failed(reason.as_str().to_string())
            };
            active.events.push(SessionEvent::Terminal(terminal.clone()));
            active.terminal = Some(terminal);
        }

        if !matches!(active.terminal, Some(SessionTerminal::Complete(_))) {
            if active.worker.is_some() {
                active.cleanup = Some(CleanupStatus::Required);
                active
                    .events
                    .push(SessionEvent::Cleanup(CleanupStatus::Required));
                return Ok(snapshot(active));
            }
            let output_directory = active.output_directory.clone();
            let active_window = active.window_label.clone();
            let active_session = active.session_id.clone();
            let active_generation = active.generation;
            let storage = active.storage.clone();
            let cleanup = self.cleanup_for_identity(
                &active_window,
                &active_session,
                active_generation,
                &output_directory,
                storage.as_ref(),
            );
            active.cleanup = Some(cleanup.clone());
            active.events.push(SessionEvent::Cleanup(cleanup));
        }
        let can_release = active.worker.is_none()
            && !matches!(
                (&active.terminal, active.state),
                (Some(SessionTerminal::Complete(_)), SessionState::Analyzing)
            );
        if can_release {
            let retained = retain_terminal_locked(&mut inner);
            return retained.ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        Ok(snapshot(active))
    }

    fn wait_for_terminal(
        &self,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let deadline = Instant::now() + WATCHER_TERMINAL_WAIT;
        loop {
            let snapshot = self
                .active_snapshot()
                .or_else(|| self.retained_snapshot())
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale))?;
            if snapshot.session_id != session_id || snapshot.generation != generation {
                return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
            }
            if snapshot.terminal.is_some() {
                return Ok(snapshot);
            }
            if Instant::now() >= deadline {
                return Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired));
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn record_progress(
        &self,
        session_id: &str,
        generation: u64,
        progress: SidecarProgress,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        let Some(active) = inner.active.as_mut() else {
            return inner
                .retained
                .as_ref()
                .filter(|retained| {
                    retained.snapshot.session_id == session_id
                        && retained.snapshot.generation == generation
                })
                .map(|retained| retained.snapshot.clone())
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        };
        if active.session_id != session_id || active.generation != generation {
            return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        if active.terminal.is_some() {
            return Ok(snapshot(active));
        }
        if !active
            .events
            .iter()
            .any(|event| matches!(event, SessionEvent::Progress(existing) if existing == &progress))
        {
            active.events.push(SessionEvent::Progress(progress));
        }
        active.last_heartbeat_at = Some(Instant::now());
        Ok(snapshot(active))
    }

    fn apply_outcome(
        &self,
        session_id: &str,
        generation: u64,
        outcome: RunOutcome,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        let Some(active) = inner.active.as_mut() else {
            return inner
                .retained
                .as_ref()
                .filter(|retained| {
                    retained.snapshot.session_id == session_id
                        && retained.snapshot.generation == generation
                })
                .map(|retained| retained.snapshot.clone())
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        };
        if active.session_id != session_id || active.generation != generation {
            return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        active.watcher_active = false;
        if active.terminal.is_some() {
            return Ok(snapshot(active));
        }
        match outcome.terminal {
            Ok(terminal) => match terminal {
                SidecarTerminalResult::Success(result, progress) => {
                    for item in progress {
                        if !active.events.iter().any(|event| {
                            matches!(event, SessionEvent::Progress(existing) if existing == &item)
                        }) {
                            active.events.push(SessionEvent::Progress(item));
                        }
                    }
                    transition(active, SessionState::Handoff)?;
                    active
                        .events
                        .push(SessionEvent::State(SessionState::Handoff));
                    transition(active, SessionState::Analyzing)?;
                    active
                        .events
                        .push(SessionEvent::State(SessionState::Analyzing));
                    let terminal = SessionTerminal::Complete(result);
                    active.events.push(SessionEvent::Terminal(terminal.clone()));
                    active.terminal = Some(terminal);
                }
                SidecarTerminalResult::Failure(reason_code) => {
                    let terminal =
                        if active.cancel_reason.is_some() || reason_code == "USER_CANCELLED" {
                            transition(active, SessionState::Cancelling)?;
                            SessionTerminal::Cancelled
                        } else {
                            transition(active, SessionState::Failed)?;
                            SessionTerminal::Failed(reason_code)
                        };
                    active.events.push(SessionEvent::Terminal(terminal.clone()));
                    active.terminal = Some(terminal);
                }
            },
            Err(_error) if active.cancel_reason.is_some() => {
                transition(active, SessionState::Cancelling)?;
                active
                    .events
                    .push(SessionEvent::Terminal(SessionTerminal::Cancelled));
                active.terminal = Some(SessionTerminal::Cancelled);
            }
            Err(error) => {
                transition(active, SessionState::Failed)?;
                let terminal = SessionTerminal::Failed(error.as_str().to_string());
                active.events.push(SessionEvent::Terminal(terminal.clone()));
                active.terminal = Some(terminal);
            }
        }

        if !matches!(active.terminal, Some(SessionTerminal::Complete(_))) {
            if active.worker.is_some() {
                active.cleanup = Some(CleanupStatus::Required);
                active
                    .events
                    .push(SessionEvent::Cleanup(CleanupStatus::Required));
                return Ok(snapshot(active));
            }
            let output_directory = active.output_directory.clone();
            let window_label = active.window_label.clone();
            let session_id = active.session_id.clone();
            let generation = active.generation;
            let storage = active.storage.clone();
            let status = self.cleanup_for_identity(
                &window_label,
                &session_id,
                generation,
                &output_directory,
                storage.as_ref(),
            );
            active.cleanup = Some(status.clone());
            active.events.push(SessionEvent::Cleanup(status));
        }
        let result = snapshot(active);
        let can_release = active.worker.is_none()
            && !matches!(
                (&active.terminal, active.state),
                (Some(SessionTerminal::Complete(_)), SessionState::Analyzing)
            );
        if can_release {
            let retained = retain_terminal_locked(&mut inner);
            return retained.ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        Ok(result)
    }

    fn cleanup_and_maybe_remove(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        if inner.active.is_none() {
            let retained_matches = inner.retained.as_ref().is_some_and(|retained| {
                retained.snapshot.session_id == session_id
                    && retained.snapshot.generation == generation
            });
            if retained_matches {
                drop(inner);
                return self.cleanup_retained(window_label, session_id, generation);
            }
            return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
        }
        validate_active(&inner, window_label, session_id, generation)?;
        let active = inner.active.as_mut().expect("validated active session");
        if active.watcher_active && active.terminal.is_none() {
            return Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired));
        }
        if active.state == SessionState::Closing && process_is_alive(active.process.identity.pid) {
            active.cleanup = Some(CleanupStatus::Required);
            return Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired));
        }
        if active.worker.is_some() {
            active.cleanup = Some(CleanupStatus::Required);
            return Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired));
        }
        if !matches!(active.cleanup, Some(CleanupStatus::Complete { .. })) {
            if active.state != SessionState::Closing && active.state != SessionState::Discarding {
                transition(active, SessionState::Discarding)?;
                active
                    .events
                    .push(SessionEvent::State(SessionState::Discarding));
            }
            let output_directory = active.output_directory.clone();
            let active_window = active.window_label.clone();
            let active_session = active.session_id.clone();
            let active_generation = active.generation;
            let storage = active.storage.clone();
            let status = self.cleanup_for_identity(
                &active_window,
                &active_session,
                active_generation,
                &output_directory,
                storage.as_ref(),
            );
            active.cleanup = Some(status.clone());
            active.events.push(SessionEvent::Cleanup(status));
        }
        let completed = matches!(active.cleanup, Some(CleanupStatus::Complete { .. }));
        if completed {
            let result = snapshot(active);
            inner.active = None;
            self.cleanup_coordinator
                .forget(&CleanupKey::new(window_label, session_id, generation));
            Ok(result)
        } else {
            active.state = SessionState::Closing;
            Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired))
        }
    }

    fn cleanup_retained(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let retained = {
            let mut inner = self.lock_inner()?;
            let Some(retained) = inner.retained.take() else {
                return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
            };
            if retained.snapshot.session_id != session_id
                || retained.snapshot.generation != generation
            {
                inner.retained = Some(retained);
                return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
            }
            retained
        };
        let status = self.cleanup_for_identity(
            window_label,
            session_id,
            generation,
            &retained.output_directory,
            retained.storage.as_ref(),
        );
        let mut terminal_snapshot = retained.snapshot;
        terminal_snapshot.cleanup = Some(status.clone());
        if matches!(status, CleanupStatus::Complete { .. }) {
            self.cleanup_coordinator
                .forget(&CleanupKey::new(window_label, session_id, generation));
            return Ok(terminal_snapshot);
        }
        let mut inner = self.lock_inner()?;
        inner.retained = Some(RetainedSession {
            input: retained.input,
            storage: retained.storage,
            output_directory: retained.output_directory,
            snapshot: terminal_snapshot,
        });
        Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired))
    }

    fn put_back_receivers(
        &self,
        session_id: &str,
        generation: u64,
        receiver: Receiver<RunOutcome>,
        progress_receiver: Option<Receiver<SidecarProgress>>,
    ) -> Result<(), SupervisorError> {
        let mut inner = self.lock_inner()?;
        let active = inner
            .active
            .as_mut()
            .filter(|active| active.session_id == session_id && active.generation == generation)
            .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale))?;
        if active.outcome_receiver.is_some() {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
        }
        active.outcome_receiver = Some(receiver);
        if active.progress_receiver.is_some() {
            return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
        }
        active.progress_receiver = progress_receiver;
        Ok(())
    }

    fn request_worker_cancellation(&self, session_id: &str, generation: u64) {
        let worker = self.inner.lock().ok().and_then(|inner| {
            inner.active.as_ref().and_then(|active| {
                (active.session_id == session_id && active.generation == generation)
                    .then(|| active.worker.clone())
                    .flatten()
            })
        });
        if let Some(worker) = worker {
            worker.request_cancellation();
        }
    }

    fn wait_for_worker_termination(&self, session_id: &str, generation: u64) -> bool {
        let worker = self.inner.lock().ok().and_then(|inner| {
            inner.active.as_ref().and_then(|active| {
                (active.session_id == session_id && active.generation == generation)
                    .then(|| active.worker.clone())
                    .flatten()
            })
        });
        let Some(worker) = worker else {
            return true;
        };
        if !worker.wait_for_termination(GRACEFUL_CANCEL_GRACE) {
            worker.force_terminate();
            if !worker.wait_for_termination(FINAL_KILL_WAIT) {
                self.mark_cleanup_required(session_id, generation);
                return false;
            }
        }
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(active) = inner
                .active
                .as_mut()
                .filter(|active| active.session_id == session_id && active.generation == generation)
            {
                active.worker = None;
            }
        }
        true
    }

    fn force_worker_termination(&self, session_id: &str, generation: u64) {
        let worker = self.inner.lock().ok().and_then(|inner| {
            inner.active.as_ref().and_then(|active| {
                (active.session_id == session_id && active.generation == generation)
                    .then(|| active.worker.clone())
                    .flatten()
            })
        });
        if let Some(worker) = worker {
            worker.force_terminate();
        }
    }

    fn cleanup_for_identity(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        directory: &Path,
        storage: Option<&crate::secure_storage::SecureStorage>,
    ) -> CleanupStatus {
        let key = CleanupKey::new(window_label, session_id, generation);
        let storage = storage.cloned();
        let outcome =
            self.cleanup_coordinator.run(key.clone(), || {
                match cleanup_session_directory(storage.as_ref(), directory, session_id) {
                    Ok(CleanupStatus::Complete {
                        removed_entry_count,
                    }) => CleanupTerminal::Complete {
                        removed_entry_count,
                    },
                    Ok(CleanupStatus::Required) | Err(_) => CleanupTerminal::Required,
                }
            });
        if !outcome.is_complete() {
            self.cleanup_coordinator.forget(&key);
        }
        match outcome {
            CleanupTerminal::Complete {
                removed_entry_count,
            } => CleanupStatus::Complete {
                removed_entry_count,
            },
            CleanupTerminal::Required
            | CleanupTerminal::Timeout
            | CleanupTerminal::UnsafeEntry
            | CleanupTerminal::OwnerMismatch
            | CleanupTerminal::ModeMismatch
            | CleanupTerminal::TypeMismatch => CleanupStatus::Required,
        }
    }

    fn mark_cleanup_required(&self, session_id: &str, generation: u64) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        let Some(active) = inner
            .active
            .as_mut()
            .filter(|active| active.session_id == session_id && active.generation == generation)
        else {
            return;
        };
        if active.cleanup != Some(CleanupStatus::Required) {
            active.cleanup = Some(CleanupStatus::Required);
            active
                .events
                .push(SessionEvent::Cleanup(CleanupStatus::Required));
        }
        if active.state != SessionState::Closing
            && transition(active, SessionState::Closing).is_ok()
        {
            active
                .events
                .push(SessionEvent::State(SessionState::Closing));
        }
    }

    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, SupervisorInner>, SupervisorError> {
        self.inner
            .lock()
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::InvalidState))
    }
}

fn retain_terminal_locked(inner: &mut SupervisorInner) -> Option<SessionSnapshot> {
    let active = inner.active.take()?;
    let terminal_snapshot = snapshot(&active);
    inner.retained = Some(RetainedSession {
        input: active.input,
        storage: active.storage,
        output_directory: active.output_directory,
        snapshot: terminal_snapshot.clone(),
    });
    Some(terminal_snapshot)
}

impl Drop for SessionSupervisor {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            self.shutdown();
        }
    }
}

struct SidecarLaunch {
    resolution: SidecarResolution,
    cwd: PathBuf,
    configuration: Vec<u8>,
    nonce: String,
}

fn snapshot(active: &ActiveSession) -> SessionSnapshot {
    let progress = active.events.iter().rev().find_map(|event| match event {
        SessionEvent::Progress(progress) => Some(progress.clone()),
        _ => None,
    });
    let phase = progress
        .as_ref()
        .map(|progress| progress.phase.clone())
        .unwrap_or_else(|| match active.state {
            SessionState::Ready => "selection".to_string(),
            SessionState::Preprocessing => "startup".to_string(),
            SessionState::Handoff => "output-verification".to_string(),
            SessionState::Analyzing => "analysis".to_string(),
            SessionState::Cancelling => "cancellation".to_string(),
            SessionState::Failed => "failure".to_string(),
            SessionState::Discarding | SessionState::Closing => "cleanup".to_string(),
            SessionState::Idle | SessionState::Selecting | SessionState::Complete => {
                active.state.as_str().to_string()
            }
        });
    let heartbeat_status = if active.terminal.is_some() {
        HeartbeatStatus::Terminal
    } else if active.last_heartbeat_at.is_some() {
        HeartbeatStatus::Active
    } else {
        HeartbeatStatus::Starting
    };
    SessionSnapshot {
        operation_id: active.operation_id.clone(),
        session_id: active.session_id.clone(),
        generation: active.generation,
        state: active.state,
        terminal: active.terminal.clone(),
        cleanup: active.cleanup.clone(),
        cancel_reason: active.cancel_reason,
        phase,
        progress,
        heartbeat_status,
        elapsed_bucket: elapsed_bucket(active.started_at.elapsed()),
        cancel_available: active.terminal.is_none()
            && matches!(
                active.state,
                SessionState::Preprocessing
                    | SessionState::Handoff
                    | SessionState::Analyzing
                    | SessionState::Cancelling
            ),
        events: active.events.clone(),
    }
}

fn elapsed_bucket(elapsed: Duration) -> String {
    match elapsed {
        elapsed if elapsed < Duration::from_secs(1) => "<1s",
        elapsed if elapsed < Duration::from_secs(5) => "1-5s",
        elapsed if elapsed < Duration::from_secs(30) => "5-30s",
        elapsed if elapsed < Duration::from_secs(60) => "30-60s",
        _ => "60s+",
    }
    .to_string()
}

fn validate_active(
    inner: &SupervisorInner,
    window_label: &str,
    session_id: &str,
    generation: u64,
) -> Result<(), SupervisorError> {
    if !trusted_main_window_label(window_label) {
        return Err(SupervisorError::new(
            SupervisorErrorCode::WindowNotAuthorized,
        ));
    }
    let active = inner
        .active
        .as_ref()
        .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale))?;
    if active.window_label != window_label
        || active.session_id != session_id
        || active.generation != generation
    {
        return Err(SupervisorError::new(SupervisorErrorCode::SessionStale));
    }
    Ok(())
}

fn transition(active: &mut ActiveSession, next: SessionState) -> Result<(), SupervisorError> {
    if valid_state_transition(active.state.as_str(), next.as_str()) {
        active.state = next;
        Ok(())
    } else {
        Err(SupervisorError::new(SupervisorErrorCode::InvalidState))
    }
}

fn build_configuration(
    session_id: &str,
    generation: u64,
    nonce: &str,
    input: &SessionInput,
    output_directory: &Path,
) -> Result<Vec<u8>, SupervisorError> {
    let paths = |values: &[PathBuf]| -> Result<Vec<Value>, SupervisorError> {
        values
            .iter()
            .map(|path| {
                path.to_str()
                    .map(|value| Value::String(value.to_string()))
                    .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidRequest))
            })
            .collect()
    };
    let mut object = Map::new();
    object.insert(
        SIDECAR_PROTOCOL_VERSION_FIELD.to_string(),
        Value::String(SIDECAR_PROTOCOL_VERSION.to_string()),
    );
    object.insert(
        "sessionId".to_string(),
        Value::String(session_id.to_string()),
    );
    object.insert("generation".to_string(), Value::from(generation));
    object.insert(
        "annualSources".to_string(),
        Value::Array(paths(&input.annual_sources)?),
    );
    object.insert(
        "verificationSources".to_string(),
        Value::Array(paths(&input.verification_sources)?),
    );
    object.insert(
        "applicationCacheRoot".to_string(),
        Value::String(
            input
                .application_cache_root
                .to_str()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?
                .to_string(),
        ),
    );
    object.insert(
        "outputDirectory".to_string(),
        Value::String(
            output_directory
                .to_str()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?
                .to_string(),
        ),
    );
    object.insert("sessionNonce".to_string(), Value::String(nonce.to_string()));
    object.insert(
        "preprocessorMode".to_string(),
        Value::String("canonical-event-v2".to_string()),
    );
    let payload = serde_json::to_vec(&Value::Object(object))
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?;
    if payload.is_empty() || payload.len() > MAX_CONFIGURATION_BYTES {
        return Err(SupervisorError::new(SupervisorErrorCode::InvalidRequest));
    }
    let mut encoded = Vec::with_capacity(payload.len() + 4);
    encoded.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    encoded.extend_from_slice(&payload);
    Ok(encoded)
}

fn spawn_sidecar(
    launch: SidecarLaunch,
    session_id: &str,
    generation: u64,
    watchdog_timeouts: WatchdogTimeouts,
) -> Result<
    (
        Arc<ProcessControl>,
        Receiver<SidecarProgress>,
        Receiver<RunOutcome>,
    ),
    SupervisorError,
> {
    validate_executable(&launch.resolution.executable)?;
    if !secure_directory(&launch.cwd) || launch.configuration.len() > MAX_CONFIGURATION_BYTES {
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarStartFailed,
        ));
    }
    let mut command = Command::new(&launch.resolution.executable);
    command
        .args(&launch.resolution.fixed_args)
        .current_dir(&launch.cwd)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONHASHSEED", "0")
        .env(SIDECAR_EVIDENCE_ENV, &launch.nonce)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if unix_set_process_group() == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        });
    }
    let mut child = spawn_command_with_timeout(command, watchdog_timeouts.spawn)?;
    let pid = child.id();
    let executable = match launch.resolution.executable.canonicalize() {
        Ok(path) => path,
        Err(_) => {
            terminate_spawn_failure(&mut child);
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        }
    };
    let group_id = match process_group_id(pid) {
        Some(group_id) => group_id,
        None => {
            terminate_spawn_failure(&mut child);
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        }
    };
    if group_id != pid as i32 {
        terminate_spawn_failure(&mut child);
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarStartFailed,
        ));
    }
    let start_fingerprint = match process_start_fingerprint(pid) {
        Some(fingerprint) => fingerprint,
        None => {
            terminate_spawn_failure(&mut child);
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        }
    };
    let executable_fingerprint = match executable_fingerprint(&executable) {
        Ok(fingerprint) => fingerprint,
        Err(_) => {
            terminate_spawn_failure(&mut child);
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        }
    };
    let Some(stdin) = child.stdin.take() else {
        terminate_spawn_failure(&mut child);
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarStartFailed,
        ));
    };
    let Some(stdout) = child.stdout.take() else {
        terminate_spawn_failure(&mut child);
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarStartFailed,
        ));
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_spawn_failure(&mut child);
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarStartFailed,
        ));
    };
    let control = Arc::new(ProcessControl {
        identity: ProcessIdentity {
            pid,
            group_id,
            executable,
            executable_fingerprint,
            start_fingerprint,
            nonce: launch.nonce,
            session_id: session_id.to_string(),
            generation,
        },
        stdin: Mutex::new(Some(stdin)),
        forced: AtomicBool::new(false),
        signal_stage: AtomicU8::new(0),
    });
    {
        let mut input = match control.stdin.lock() {
            Ok(input) => input,
            Err(_) => {
                terminate_spawn_failure(&mut child);
                return Err(SupervisorError::new(
                    SupervisorErrorCode::SidecarStartFailed,
                ));
            }
        };
        let Some(stream) = input.as_mut() else {
            terminate_spawn_failure(&mut child);
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        };
        if stream
            .write_all(&launch.configuration)
            .and_then(|_| stream.flush())
            .is_err()
        {
            terminate_spawn_failure(&mut child);
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        }
    }

    let (progress_sender, progress_receiver) = mpsc::channel();
    let heartbeat = Arc::new(Mutex::new(None::<Instant>));
    let (sender, receiver) = mpsc::channel();
    let process = Arc::clone(&control);
    let session = session_id.to_string();
    let monitor_heartbeat = Arc::clone(&heartbeat);
    let parser_heartbeat = Arc::clone(&heartbeat);
    thread::Builder::new()
        .name("sidecar-process-monitor".to_string())
        .spawn(move || {
            let terminal = monitor_child(
                child,
                process,
                stdout,
                stderr,
                &session,
                generation,
                progress_sender,
                parser_heartbeat,
                monitor_heartbeat,
                watchdog_timeouts,
            );
            let _ = sender.send(RunOutcome { terminal });
        })
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarStartFailed))?;
    Ok((control, progress_receiver, receiver))
}

fn spawn_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<Child, SupervisorError> {
    let abandoned = Arc::new(AtomicBool::new(false));
    let (sender, receiver) = mpsc::sync_channel(1);
    let thread_abandoned = Arc::clone(&abandoned);
    thread::Builder::new()
        .name("sidecar-spawn".to_string())
        .spawn(move || {
            let result = command.spawn();
            match result {
                Ok(mut child) if thread_abandoned.load(Ordering::Acquire) => {
                    terminate_spawn_failure(&mut child);
                }
                Ok(child) => {
                    let _ = sender.send(Ok(child));
                }
                Err(_) => {
                    let _ = sender.send(Err(()));
                }
            }
        })
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarSpawnFailed))?;
    match receiver.recv_timeout(timeout) {
        Ok(Ok(child)) => Ok(child),
        Ok(Err(())) | Err(RecvTimeoutError::Disconnected) => Err(SupervisorError::new(
            SupervisorErrorCode::SidecarSpawnFailed,
        )),
        Err(RecvTimeoutError::Timeout) => {
            abandoned.store(true, Ordering::Release);
            Err(SupervisorError::new(
                SupervisorErrorCode::SidecarSpawnFailed,
            ))
        }
    }
}

fn terminate_spawn_failure(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn monitor_child(
    mut child: Child,
    process: Arc<ProcessControl>,
    stdout: impl Read + Send + 'static,
    stderr: impl Read + Send + 'static,
    session_id: &str,
    generation: u64,
    progress_sender: mpsc::Sender<SidecarProgress>,
    parser_heartbeat: Arc<Mutex<Option<Instant>>>,
    monitor_heartbeat: Arc<Mutex<Option<Instant>>>,
    watchdog_timeouts: WatchdogTimeouts,
) -> Result<SidecarTerminalResult, SupervisorErrorCode> {
    let session_id = session_id.to_string();
    let (stdout_sender, stdout_receiver) = mpsc::channel();
    let stdout_session_id = session_id.clone();
    let stdout_thread = thread::spawn(move || {
        let result = parse_stdout_with_progress(
            stdout,
            &stdout_session_id,
            generation,
            Some(progress_sender),
            Some(parser_heartbeat),
        );
        let _ = stdout_sender.send(result);
    });
    let (stderr_sender, stderr_receiver) = mpsc::channel();
    let stderr_thread = thread::spawn(move || {
        let result = parse_stderr(stderr);
        let _ = stderr_sender.send(result);
    });

    let mut stdout_result = None;
    let mut stderr_result = None;
    let monitor_started = Instant::now();
    let mut first_progress_seen = false;
    let mut last_progress_at = monitor_started;
    let mut watchdog_failure = None;
    let status = loop {
        if stdout_result.is_none() {
            stdout_result = stdout_receiver.try_recv().ok();
        }
        if stderr_result.is_none() {
            stderr_result = stderr_receiver.try_recv().ok();
        }
        if stdout_result.as_ref().is_some_and(Result::is_err)
            || stderr_result.as_ref().is_some_and(Result::is_err)
        {
            let _ = process.force_kill(&session_id, generation);
        }
        if let Ok(last_progress) = monitor_heartbeat.lock().map(|value| *value) {
            if let Some(last_progress) = last_progress {
                first_progress_seen = true;
                last_progress_at = last_progress;
            }
        }
        if !first_progress_seen {
            if monitor_started.elapsed() >= watchdog_timeouts.handshake {
                let _ = process.force_kill(&session_id, generation);
                watchdog_failure = Some(SupervisorErrorCode::SidecarHandshakeTimeout);
            }
        } else if last_progress_at.elapsed() >= watchdog_timeouts.inactivity {
            let _ = process.force_kill(&session_id, generation);
            watchdog_failure = Some(SupervisorErrorCode::PreprocessingStalled);
        }
        if watchdog_failure.is_some() {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }
                Err(_) => return Err(SupervisorErrorCode::SidecarExitedUnexpectedly),
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => return Err(SupervisorErrorCode::SidecarExited),
        }
    };
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    if stdout_result.is_none() {
        stdout_result = stdout_receiver.recv().ok();
    }
    if stderr_result.is_none() {
        stderr_result = stderr_receiver.recv().ok();
    }
    process.close_stdin();

    if let Some(error) = watchdog_failure {
        return Err(error);
    }

    let stdout_result = stdout_result.ok_or(SupervisorErrorCode::SidecarProtocolInvalid)?;
    let stderr_result = stderr_result
        .ok_or(SupervisorErrorCode::SidecarProtocolInvalid)?
        .map_err(map_parser_error)?;
    match stderr_result {
        Some(stderr) => {
            if status.success() {
                return Err(SupervisorErrorCode::SidecarProtocolInvalid);
            }
            match stdout_result {
                Err(ParserError::MissingTerminal) => Ok(SidecarTerminalResult::Failure(
                    stable_sidecar_reason(&stderr.reason_code).to_string(),
                )),
                Err(_) | Ok(_) => Err(SupervisorErrorCode::SidecarProtocolInvalid),
            }
        }
        None => {
            let stdout_result = match stdout_result {
                Ok(result) => result,
                Err(error) if !status.success() => {
                    return Err(match error {
                        ParserError::MissingTerminal => {
                            SupervisorErrorCode::SidecarExitedUnexpectedly
                        }
                        other => map_parser_error(other),
                    });
                }
                Err(error) => return Err(map_parser_error(error)),
            };
            if !status.success() {
                return Err(SupervisorErrorCode::SidecarExitedUnexpectedly);
            }
            Ok(SidecarTerminalResult::Success(
                stdout_result.result,
                stdout_result.progress,
            ))
        }
    }
}

fn stable_sidecar_reason(value: &str) -> &str {
    match value {
        "UNSUPPORTED_PYTHON_RUNTIME"
        | "IJSON_DISTRIBUTION_UNVERIFIED"
        | "IJSON_BACKEND_UNAVAILABLE"
        | "IJSON_BACKEND_MISMATCH"
        | "IJSON_PARSER_INITIALIZATION_FAILED"
        | "ARGUMENT_FAILURE"
        | "INPUT_PREFLIGHT_FAILED"
        | "OUTPUT_IGNORE_POLICY_FAILED"
        | "RAW_INPUT_FILE_LIMIT_EXCEEDED"
        | "ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED"
        | "AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED"
        | "SOURCE_READ_FAILED"
        | "INVALID_UTF8"
        | "UTF8_BOM_NOT_SUPPORTED"
        | "INVALID_JSON"
        | "UNSUPPORTED_TOP_LEVEL_STRUCTURE"
        | "UNSUPPORTED_EXPORT_FORMAT"
        | "UNSUPPORTED_SESSION"
        | "SESSION_IDENTITY_INVALID"
        | "PARTICIPANT_INVALID"
        | "MESSAGE_TIME_INVALID"
        | "MESSAGE_TIME_RANGE_UNAVAILABLE"
        | "SOURCE_EVENT_INVALID"
        | "UNSAFE_LOCAL_TYPE"
        | "DIFFERENT_CONVERSATION"
        | "SOURCE_MUTATED"
        | "RAW_MESSAGE_LIMIT_EXCEEDED"
        | "OUTPUT_DESTINATION_EXISTS"
        | "OUTPUT_PARENT_UNSAFE"
        | "OUTPUT_STAGING_FAILED"
        | "SQLITE_POLICY_FAILED"
        | "CRYPTOGRAPHIC_IDENTITY_COLLISION"
        | "OVERLAP_VERIFICATION_FAILED"
        | "NO_ELIGIBLE_TEXT_RECORDS"
        | "NORMALIZED_RECORD_TOO_LARGE"
        | "NORMALIZED_RECORD_LIMIT_EXCEEDED"
        | "NORMALIZED_DATASET_LIMIT_EXCEEDED"
        | "NORMALIZED_SCHEMA_INVALID"
        | "PRIVACY_VALIDATION_FAILED"
        | "OUTPUT_WRITE_FAILED"
        | "OUTPUT_FLUSH_FAILED"
        | "OUTPUT_INTEGRITY_FAILED"
        | "OUTPUT_CLEANUP_FAILED"
        | "OUTPUT_PROMOTION_FAILED"
        | "DATASET_SELECTION_INVALID"
        | "RECOVERY_PARENT_UNSAFE"
        | "RECOVERY_CANDIDATE_INVALID"
        | "RECOVERY_CONFIRMATION_REQUIRED"
        | "RECOVERY_CLEANUP_FAILED"
        | "CANONICAL_EVENT_LIMIT_EXCEEDED"
        | "CANONICAL_DATASET_LIMIT_EXCEEDED"
        | "CANONICAL_CHUNK_LIMIT_EXCEEDED"
        | "CANONICAL_NO_EVENTS"
        | "CANONICAL_SCHEMA_INVALID"
        | "CANONICAL_PRIVACY_VALIDATION_FAILED"
        | "SOURCE_DATE_INVALID"
        | "SIDECAR_PROTOCOL_INVALID"
        | "SIDECAR_CRASHED"
        | "USER_CANCELLED" => value,
        _ => "SIDECAR_PROTOCOL_INVALID",
    }
}

fn map_parser_error(error: ParserError) -> SupervisorErrorCode {
    match error {
        ParserError::ProtocolMismatch => SupervisorErrorCode::SidecarProtocolMismatch,
        ParserError::Invalid | ParserError::TooLarge | ParserError::MissingTerminal => {
            SupervisorErrorCode::SidecarProtocolInvalid
        }
    }
}

fn parse_stdout(
    reader: impl Read,
    session_id: &str,
    generation: u64,
) -> Result<ParsedStdout, ParserError> {
    parse_stdout_with_progress(reader, session_id, generation, None, None)
}

fn parse_stdout_with_progress(
    mut reader: impl Read,
    session_id: &str,
    generation: u64,
    progress_sender: Option<mpsc::Sender<SidecarProgress>>,
    heartbeat: Option<Arc<Mutex<Option<Instant>>>>,
) -> Result<ParsedStdout, ParserError> {
    let mut progress = Vec::new();
    let mut previous_percentage = 0u8;
    let mut terminal: Option<SidecarResult> = None;
    for _ in 0..MAX_PROTOCOL_EVENTS {
        let Some(line) = read_bounded_line(&mut reader)? else {
            break;
        };
        if terminal.is_some() {
            return Err(ParserError::Invalid);
        }
        let value: Value = serde_json::from_slice(&line).map_err(|_| ParserError::Invalid)?;
        let object = value.as_object().ok_or(ParserError::Invalid)?;
        let kind = object
            .get("type")
            .and_then(Value::as_str)
            .ok_or(ParserError::Invalid)?;
        match kind {
            "progress" => {
                let base_allowed = [
                    "protocolVersion",
                    "type",
                    "sessionId",
                    "generation",
                    "phase",
                    "percentage",
                    "status",
                    "aggregateCount",
                    "capacityValue",
                ];
                let role_allowed = [
                    "protocolVersion",
                    "type",
                    "sessionId",
                    "generation",
                    "phase",
                    "percentage",
                    "status",
                    "aggregateCount",
                    "capacityValue",
                    "role",
                    "sourceOrdinal",
                ];
                (exact_keys(object, &base_allowed) || exact_keys(object, &role_allowed))
                    .then_some(())
                    .ok_or(ParserError::Invalid)?;
                require_protocol(object)?;
                if object.get("sessionId").and_then(Value::as_str) != Some(session_id)
                    || object.get("generation").and_then(Value::as_u64) != Some(generation)
                {
                    return Err(ParserError::Invalid);
                }
                let phase = object
                    .get("phase")
                    .and_then(Value::as_str)
                    .filter(|phase| is_sidecar_phase(phase))
                    .ok_or(ParserError::Invalid)?;
                let percentage = safe_u64(object.get("percentage"))
                    .filter(|value| *value <= 100)
                    .ok_or(ParserError::Invalid)? as u8;
                if percentage < previous_percentage {
                    return Err(ParserError::Invalid);
                }
                let status = object
                    .get("status")
                    .and_then(Value::as_str)
                    .filter(|status| matches!(*status, "running" | "completed"))
                    .ok_or(ParserError::Invalid)?;
                let aggregate_count =
                    safe_u64(object.get("aggregateCount")).ok_or(ParserError::Invalid)?;
                let capacity_value = safe_u64(object.get("capacityValue"))
                    .filter(|value| *value > 0)
                    .ok_or(ParserError::Invalid)?;
                if aggregate_count > capacity_value {
                    return Err(ParserError::Invalid);
                }
                let (role, source_ordinal) = if object.contains_key("role") {
                    let role = object
                        .get("role")
                        .and_then(Value::as_str)
                        .filter(|value| matches!(*value, "annual-source" | "overlap-verification"))
                        .ok_or(ParserError::Invalid)?;
                    let source_ordinal = safe_u64(object.get("sourceOrdinal"))
                        .filter(|value| *value >= 1)
                        .ok_or(ParserError::Invalid)?;
                    (Some(role.to_string()), Some(source_ordinal))
                } else {
                    (None, None)
                };
                previous_percentage = percentage;
                let progress_item = SidecarProgress {
                    phase: phase.to_string(),
                    percentage,
                    status: status.to_string(),
                    aggregate_count,
                    capacity_value,
                    role,
                    source_ordinal,
                };
                if let Some(heartbeat) = heartbeat.as_ref() {
                    if let Ok(mut last) = heartbeat.lock() {
                        *last = Some(Instant::now());
                    }
                }
                if let Some(sender) = progress_sender.as_ref() {
                    let _ = sender.send(progress_item.clone());
                }
                progress.push(progress_item);
            }
            "heartbeat" => {
                let allowed = ["protocolVersion", "type", "sessionId", "generation"];
                exact_keys(object, &allowed)
                    .then_some(())
                    .ok_or(ParserError::Invalid)?;
                require_protocol(object)?;
                if object.get("sessionId").and_then(Value::as_str) != Some(session_id)
                    || object.get("generation").and_then(Value::as_u64) != Some(generation)
                {
                    return Err(ParserError::Invalid);
                }
                if let Some(heartbeat) = heartbeat.as_ref() {
                    if let Ok(mut last) = heartbeat.lock() {
                        *last = Some(Instant::now());
                    }
                }
            }
            "result" => {
                let allowed = [
                    "protocolVersion",
                    "type",
                    "sessionId",
                    "generation",
                    "status",
                    "sourceCount",
                    "eventCount",
                    "eligibleTextCount",
                    "chunkCount",
                    "duplicateEventCount",
                    "warningCount",
                ];
                exact_keys(object, &allowed)
                    .then_some(())
                    .ok_or(ParserError::Invalid)?;
                require_protocol(object)?;
                if object.get("sessionId").and_then(Value::as_str) != Some(session_id)
                    || object.get("generation").and_then(Value::as_u64) != Some(generation)
                    || object.get("status").and_then(Value::as_str) != Some("success")
                {
                    return Err(ParserError::Invalid);
                }
                let result = SidecarResult {
                    source_count: safe_u64(object.get("sourceCount"))
                        .ok_or(ParserError::Invalid)?,
                    event_count: safe_u64(object.get("eventCount")).ok_or(ParserError::Invalid)?,
                    eligible_text_count: safe_u64(object.get("eligibleTextCount"))
                        .ok_or(ParserError::Invalid)?,
                    chunk_count: safe_u64(object.get("chunkCount")).ok_or(ParserError::Invalid)?,
                    duplicate_event_count: safe_u64(object.get("duplicateEventCount"))
                        .ok_or(ParserError::Invalid)?,
                    warning_count: safe_u64(object.get("warningCount"))
                        .ok_or(ParserError::Invalid)?,
                };
                terminal = Some(result);
            }
            _ => return Err(ParserError::Invalid),
        }
    }
    if terminal.is_none() {
        return Err(ParserError::MissingTerminal);
    }
    if read_bounded_line(&mut reader)?.is_some() {
        return Err(ParserError::Invalid);
    }
    Ok(ParsedStdout {
        progress,
        result: terminal.expect("checked terminal"),
    })
}

fn parse_stderr(mut reader: impl Read) -> Result<Option<ParsedStderr>, ParserError> {
    let Some(line) = read_bounded_line(&mut reader)? else {
        return Ok(None);
    };
    let value: Value = serde_json::from_slice(&line).map_err(|_| ParserError::Invalid)?;
    let object = value.as_object().ok_or(ParserError::Invalid)?;
    let allowed = ["protocolVersion", "type", "reasonCode"];
    exact_keys(object, &allowed)
        .then_some(())
        .ok_or(ParserError::Invalid)?;
    require_protocol(object)?;
    if object.get("type").and_then(Value::as_str) != Some("failure") {
        return Err(ParserError::Invalid);
    }
    let reason_code = object
        .get("reasonCode")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
        .ok_or(ParserError::Invalid)?;
    if read_bounded_line(&mut reader)?.is_some() {
        return Err(ParserError::Invalid);
    }
    Ok(Some(ParsedStderr {
        reason_code: reason_code.to_string(),
    }))
}

fn read_bounded_line(reader: &mut impl Read) -> Result<Option<Vec<u8>>, ParserError> {
    let mut line = Vec::with_capacity(128);
    loop {
        let mut byte = [0u8; 1];
        match reader.read(&mut byte) {
            Ok(0) if line.is_empty() => return Ok(None),
            Ok(0) => return Err(ParserError::Invalid),
            Ok(1) => {
                line.push(byte[0]);
                if line.len() > MAX_PROTOCOL_LINE_BYTES {
                    return Err(ParserError::TooLarge);
                }
                if byte[0] == b'\n' {
                    line.pop();
                    if line.is_empty() {
                        return Err(ParserError::Invalid);
                    }
                    return Ok(Some(line));
                }
            }
            Ok(_) => return Err(ParserError::Invalid),
            Err(_) => return Err(ParserError::Invalid),
        }
    }
}

fn exact_keys(object: &Map<String, Value>, expected: &[&str]) -> bool {
    if object.len() != expected.len() {
        return false;
    }
    let expected = expected.iter().copied().collect::<BTreeSet<_>>();
    object.keys().all(|key| expected.contains(key.as_str()))
}

fn require_protocol(object: &Map<String, Value>) -> Result<(), ParserError> {
    match object
        .get(SIDECAR_PROTOCOL_VERSION_FIELD)
        .and_then(Value::as_str)
    {
        Some(SIDECAR_PROTOCOL_VERSION) => Ok(()),
        Some(_) => Err(ParserError::ProtocolMismatch),
        None => Err(ParserError::Invalid),
    }
}

fn safe_u64(value: Option<&Value>) -> Option<u64> {
    let value = value?.as_u64()?;
    (value <= MAX_SAFE_INTEGER).then_some(value)
}

fn is_sidecar_phase(value: &str) -> bool {
    matches!(
        value,
        "startup"
            | "input-preflight"
            | "source-digest"
            | "source-validation"
            | "session-validation"
            | "source-staging"
            | "dataset-staging"
            | "output-serialization"
            | "output-verification"
            | "output-promotion"
    )
}

fn validate_executable(path: &Path) -> Result<(), SupervisorError> {
    if !absolute_path(path) || !path_has_no_symlink_components(path) {
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarUnavailable,
        ));
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarUnavailable))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarUnavailable,
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarUnavailable,
            ));
        }
    }
    Ok(())
}

fn validate_entrypoint(path: &Path) -> Result<(), SupervisorError> {
    if !absolute_path(path) || !path_has_no_symlink_components(path) {
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarUnavailable,
        ));
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarUnavailable))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(SupervisorError::new(
            SupervisorErrorCode::SidecarUnavailable,
        ));
    }
    Ok(())
}

fn absolute_path(path: &Path) -> bool {
    path.is_absolute()
        && path.to_str().is_some()
        && !path.to_string_lossy().contains('\0')
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
}

fn path_has_no_symlink_components(path: &Path) -> bool {
    if !absolute_path(path) {
        return false;
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                #[cfg(target_os = "macos")]
                if current == Path::new("/var")
                    && fs::canonicalize(&current).ok().as_deref() == Some(Path::new("/private/var"))
                {
                    continue;
                }
                return false;
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return true,
            Err(_) => return false,
        }
    }
    true
}

fn directory_location(path: &Path) -> bool {
    if !path_has_no_symlink_components(path) {
        return false;
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) => metadata.is_dir() && !metadata.file_type().is_symlink(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            path.parent().is_some_and(absolute_directory)
        }
        Err(_) => false,
    }
}

fn source_file_path(path: &Path) -> bool {
    if !path_has_no_symlink_components(path) {
        return false;
    }
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn ensure_secure_directory(path: &Path) -> Result<(), SupervisorError> {
    if !directory_location(path) {
        return Err(SupervisorError::new(SupervisorErrorCode::InvalidRequest));
    }
    if fs::symlink_metadata(path).is_err() {
        fs::create_dir(path)
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))
                .map_err(|_| SupervisorError::new(SupervisorErrorCode::InvalidRequest))?;
        }
    }
    if secure_directory(path) {
        Ok(())
    } else {
        Err(SupervisorError::new(SupervisorErrorCode::InvalidRequest))
    }
}

fn absolute_directory(path: &Path) -> bool {
    absolute_path(path)
        && path_has_no_symlink_components(path)
        && fs::symlink_metadata(path)
            .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
}

fn secure_directory(path: &Path) -> bool {
    if !path_has_no_symlink_components(path) {
        return false;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        metadata.uid() == unsafe { libc_getuid() } && metadata.permissions().mode() & 0o777 == 0o700
    }
    #[cfg(not(unix))]
    true
}

fn opaque_id(prefix: &str) -> Result<String, SupervisorError> {
    let mut bytes = [0u8; 16];
    fill_random(&mut bytes).map_err(|_| SupervisorError::new(SupervisorErrorCode::InvalidState))?;
    let mut value = String::with_capacity(prefix.len() + 32);
    value.push_str(prefix);
    for byte in bytes {
        value.push_str(&format!("{byte:02x}"));
    }
    Ok(value)
}

/// Opaque host-owned identifier for a renderer analytics Worker lease.
pub fn new_worker_operation_id() -> Result<String, SupervisorError> {
    opaque_id("wrk_")
}

pub fn new_worker_nonce() -> Result<String, SupervisorError> {
    opaque_id("nonce_")
}

const MINIMUM_SESSION_FREE_BYTES: u64 = 128 * 1024 * 1024;
const SESSION_OVERHEAD_BYTES: u64 = 64 * 1024 * 1024;

pub fn free_space_satisfies(available_bytes: u64, required_bytes: u64) -> bool {
    available_bytes >= required_bytes
}

fn required_session_bytes(raw_bytes: u64) -> u64 {
    raw_bytes
        .saturating_mul(2)
        .saturating_add(SESSION_OVERHEAD_BYTES)
        .max(MINIMUM_SESSION_FREE_BYTES)
}

fn available_free_bytes(path: &Path) -> Result<u64, SupervisorError> {
    #[cfg(unix)]
    {
        let path = std::ffi::CString::new(path.to_string_lossy().as_bytes())
            .map_err(|_| SupervisorError::new(SupervisorErrorCode::DiskSpaceInsufficient))?;
        let mut statistics = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        let result = unsafe { libc::statvfs(path.as_ptr(), statistics.as_mut_ptr()) };
        if result != 0 {
            return Err(SupervisorError::new(
                SupervisorErrorCode::DiskSpaceInsufficient,
            ));
        }
        let statistics = unsafe { statistics.assume_init() };
        let block_size = statistics.f_frsize.max(statistics.f_bsize);
        block_size
            .checked_mul(u64::from(statistics.f_bavail))
            .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::DiskSpaceInsufficient))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(SupervisorError::new(
            SupervisorErrorCode::DiskSpaceInsufficient,
        ))
    }
}

fn write_owner_record(
    storage: &crate::secure_storage::SecureStorage,
    session_id: &str,
    generation: u64,
    identity: &ProcessIdentity,
) -> Result<(), SupervisorError> {
    let record = crate::secure_storage::OwnerRecord {
        schema_version: crate::secure_storage::OWNER_RECORD_SCHEMA_VERSION.to_string(),
        state_version: "active.v1".to_string(),
        pid: identity.pid,
        process_group_id: identity.group_id,
        start_fingerprint: identity.start_fingerprint.clone(),
        executable_fingerprint: identity.executable_fingerprint.clone(),
        session_id: session_id.to_string(),
        generation,
        nonce: identity.nonce.clone(),
    };
    storage
        .write_owner_record(session_id, &record)
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarStartFailed))
}

fn executable_fingerprint(path: &Path) -> Result<String, SupervisorError> {
    let bytes = fs::read(path)
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarStartFailed))?;
    let digest = Sha256::digest(bytes);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StartupRecovery {
    pub recognized_session_count: u64,
    pub cleaned_session_count: u64,
    pub cleanup_required: bool,
}

/// Inspect only direct children of the application-owned session root and
/// clean recognized remnants entry by entry. Unknown, unsafe, or malformed
/// entries are left untouched and reported through a stable boolean.
pub fn recover_startup_sessions(
    application_cache_root: &Path,
) -> Result<StartupRecovery, SupervisorError> {
    let storage = crate::secure_storage::SecureStorage::new_or_create(application_cache_root)
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SessionCleanupFailed))?;
    let recovery = storage
        .recover_startup_with(recover_owner_record)
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SessionCleanupFailed))?;
    Ok(StartupRecovery {
        recognized_session_count: recovery.recognized_session_count,
        cleaned_session_count: recovery.cleaned_session_count,
        cleanup_required: recovery.cleanup_required,
    })
}

fn recover_owner_record(
    owner: &crate::secure_storage::OwnerRecord,
) -> crate::secure_storage::RecoveryDisposition {
    for (signal, wait) in [
        (2, GRACEFUL_CANCEL_GRACE),
        (15, TERM_CANCEL_GRACE),
        (9, FINAL_KILL_WAIT),
    ] {
        match owner_identity_status(owner) {
            IdentityStatus::Exited => {
                return if signal == 2 {
                    crate::secure_storage::RecoveryDisposition::Dead
                } else {
                    crate::secure_storage::RecoveryDisposition::Terminated
                };
            }
            IdentityStatus::Mismatch => {
                return crate::secure_storage::RecoveryDisposition::UnownedLive;
            }
            IdentityStatus::Alive => {}
        }
        if send_process_group_signal(owner.process_group_id, signal).is_err() {
            return crate::secure_storage::RecoveryDisposition::TerminationFailed;
        }
        if wait_for_process_exit(owner.pid, wait) {
            return crate::secure_storage::RecoveryDisposition::Terminated;
        }
    }
    crate::secure_storage::RecoveryDisposition::TerminationFailed
}

fn owner_identity_status(owner: &crate::secure_storage::OwnerRecord) -> IdentityStatus {
    if !process_is_alive(owner.pid) {
        return IdentityStatus::Exited;
    }
    let executable_matches = process_executable(owner.pid).is_some_and(|path| {
        executable_fingerprint(&path)
            .ok()
            .is_some_and(|fingerprint| fingerprint == owner.executable_fingerprint)
    });
    if owner.session_id.is_empty()
        || owner.generation == 0
        || process_group_id(owner.pid) != Some(owner.process_group_id)
        || process_start_fingerprint(owner.pid).as_deref() != Some(owner.start_fingerprint.as_str())
        || !process_nonce_matches(owner.pid, &owner.nonce)
        || !executable_matches
    {
        IdentityStatus::Mismatch
    } else {
        IdentityStatus::Alive
    }
}

fn wait_for_process_exit(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !process_is_alive(pid) {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    !process_is_alive(pid)
}

fn fill_random(bytes: &mut [u8]) -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut file = fs::File::open("/dev/urandom")?;
        file.read_exact(bytes)
    }
    #[cfg(not(unix))]
    {
        let _ = bytes;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "random source unavailable",
        ))
    }
}

fn cleanup_session_directory(
    pinned_storage: Option<&crate::secure_storage::SecureStorage>,
    directory: &Path,
    session_id: &str,
) -> Result<CleanupStatus, SupervisorError> {
    let storage = if let Some(storage) = pinned_storage {
        storage.clone()
    } else {
        let Some(sessions_root) = directory.parent() else {
            return Ok(CleanupStatus::Required);
        };
        if sessions_root.file_name().and_then(|value| value.to_str())
            != Some(ANALYSIS_SESSIONS_DIRECTORY)
        {
            return Ok(CleanupStatus::Required);
        }
        let Some(application_cache_root) = sessions_root.parent() else {
            return Ok(CleanupStatus::Required);
        };
        match crate::secure_storage::SecureStorage::new(application_cache_root) {
            Ok(storage) => storage,
            Err(_) => return Ok(CleanupStatus::Required),
        }
    };
    match storage.cleanup_session(session_id) {
        crate::secure_storage::CleanupOutcome::Complete {
            removed_entry_count,
        } => Ok(CleanupStatus::Complete {
            removed_entry_count,
        }),
        crate::secure_storage::CleanupOutcome::Required
        | crate::secure_storage::CleanupOutcome::UnsafeEntry
        | crate::secure_storage::CleanupOutcome::OwnerMismatch
        | crate::secure_storage::CleanupOutcome::ModeMismatch
        | crate::secure_storage::CleanupOutcome::TypeMismatch => Ok(CleanupStatus::Required),
    }
}

fn process_identity_status(identity: &ProcessIdentity) -> IdentityStatus {
    if !process_is_alive(identity.pid) {
        return IdentityStatus::Exited;
    }
    if identity.session_id.is_empty()
        || identity.generation == 0
        || identity.nonce.is_empty()
        || identity.executable_fingerprint.len() != 64
        || !process_nonce_matches(identity.pid, &identity.nonce)
    {
        return IdentityStatus::Mismatch;
    }
    let executable_matches = process_executable(identity.pid).is_some_and(|path| {
        path == identity.executable
            && executable_fingerprint(&path)
                .ok()
                .is_some_and(|fingerprint| fingerprint == identity.executable_fingerprint)
    });
    if process_group_id(identity.pid) != Some(identity.group_id)
        || !executable_matches
        || process_start_fingerprint(identity.pid).as_deref()
            != Some(identity.start_fingerprint.as_str())
    {
        IdentityStatus::Mismatch
    } else {
        IdentityStatus::Alive
    }
}

fn process_nonce_matches(pid: u32, nonce: &str) -> bool {
    let expected = format!("{SIDECAR_EVIDENCE_ENV}={nonce}");
    process_environment_entries(pid)
        .iter()
        .any(|entry| entry == &expected)
}

#[cfg(target_os = "macos")]
fn process_environment_entries(pid: u32) -> Vec<String> {
    use std::ffi::c_void;

    unsafe extern "C" {
        fn sysctl(
            name: *mut i32,
            name_len: u32,
            old: *mut c_void,
            old_len: *mut usize,
            new: *mut c_void,
            new_len: usize,
        ) -> i32;
    }
    const CTL_KERN: i32 = 1;
    const KERN_PROCARGS2: i32 = 49;
    let mut mib = [CTL_KERN, KERN_PROCARGS2, pid as i32];
    let mut length = 0usize;
    if unsafe {
        sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            std::ptr::null_mut(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || length < std::mem::size_of::<i32>()
    {
        return Vec::new();
    }
    let mut bytes = vec![0u8; length];
    if unsafe {
        sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            bytes.as_mut_ptr().cast::<c_void>(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    } != 0
    {
        return Vec::new();
    }
    bytes.truncate(length);
    bytes[std::mem::size_of::<i32>()..]
        .split(|byte| *byte == 0)
        .filter_map(|value| std::str::from_utf8(value).ok().map(str::to_owned))
        .collect()
}

#[cfg(target_os = "linux")]
fn process_environment_entries(pid: u32) -> Vec<String> {
    fs::read(format!("/proc/{pid}/environ"))
        .unwrap_or_default()
        .split(|byte| *byte == 0)
        .filter_map(|value| std::str::from_utf8(value).ok().map(str::to_owned))
        .collect()
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn process_environment_entries(_pid: u32) -> Vec<String> {
    Vec::new()
}

#[cfg(not(unix))]
fn process_environment_entries(_pid: u32) -> Vec<String> {
    Vec::new()
}

fn send_process_group_signal(group_id: i32, signal: i32) -> Result<(), SupervisorError> {
    #[cfg(unix)]
    {
        if unsafe { libc_killpg(group_id, signal) } == 0 {
            Ok(())
        } else {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(3) {
                Ok(())
            } else {
                Err(SupervisorError::new(
                    SupervisorErrorCode::SessionCleanupFailed,
                ))
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (group_id, signal);
        Err(SupervisorError::new(
            SupervisorErrorCode::SessionCleanupFailed,
        ))
    }
}

#[cfg(unix)]
unsafe fn libc_getuid() -> u32 {
    unsafe extern "C" {
        fn getuid() -> u32;
    }
    unsafe { getuid() }
}

#[cfg(unix)]
unsafe fn unix_set_process_group() -> i32 {
    unsafe extern "C" {
        fn setpgid(pid: i32, process_group: i32) -> i32;
    }
    unsafe { setpgid(0, 0) }
}

#[cfg(unix)]
unsafe fn libc_killpg(group_id: i32, signal: i32) -> i32 {
    unsafe extern "C" {
        fn killpg(group_id: i32, signal: i32) -> i32;
    }
    unsafe { killpg(group_id, signal) }
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe { kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
fn process_is_alive(_pid: u32) -> bool {
    false
}

#[cfg(unix)]
fn process_group_id(pid: u32) -> Option<i32> {
    unsafe extern "C" {
        fn getpgid(pid: i32) -> i32;
    }
    let value = unsafe { getpgid(pid as i32) };
    (value >= 0).then_some(value)
}

#[cfg(not(unix))]
fn process_group_id(_pid: u32) -> Option<i32> {
    None
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
fn process_start_fingerprint(pid: u32) -> Option<String> {
    unsafe extern "C" {
        fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut u8, buffersize: i32) -> i32;
    }
    let mut info = std::mem::MaybeUninit::<MacProcBsdInfo>::zeroed();
    let size = std::mem::size_of::<MacProcBsdInfo>();
    let result = unsafe {
        proc_pidinfo(
            pid as i32,
            3,
            0,
            info.as_mut_ptr().cast::<u8>(),
            size as i32,
        )
    };
    if result != size as i32 {
        return None;
    }
    let info = unsafe { info.assume_init() };
    Some(format!("{}:{}", info.start_tvsec, info.start_tvusec))
}

#[cfg(target_os = "linux")]
fn process_start_fingerprint(pid: u32) -> Option<String> {
    let value = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = value.rsplit_once(") ")?.1;
    let start = rest.split_whitespace().nth(19)?;
    Some(start.to_string())
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn process_start_fingerprint(pid: u32) -> Option<String> {
    Some(pid.to_string())
}

#[cfg(not(unix))]
fn process_start_fingerprint(_pid: u32) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn process_executable(pid: u32) -> Option<PathBuf> {
    unsafe extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut u8, buffersize: u32) -> i32;
    }
    let mut buffer = [0u8; 4096];
    let size = unsafe { proc_pidpath(pid as i32, buffer.as_mut_ptr(), buffer.len() as u32) };
    if size <= 0 || size as usize > buffer.len() {
        return None;
    }
    PathBuf::from(std::str::from_utf8(&buffer[..size as usize]).ok()?)
        .canonicalize()
        .ok()
}

#[cfg(target_os = "linux")]
fn process_executable(pid: u32) -> Option<PathBuf> {
    fs::read_link(format!("/proc/{pid}/exe"))
        .ok()?
        .canonicalize()
        .ok()
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn process_executable(_pid: u32) -> Option<PathBuf> {
    None
}

#[cfg(not(unix))]
fn process_executable(_pid: u32) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_transitions_are_explicit_and_fail_closed() {
        let mut active = ActiveSession {
            input: SessionInput::new(Vec::new(), Vec::new(), PathBuf::new(), PathBuf::new()),
            storage: None,
            output_directory: PathBuf::new(),
            window_label: "main".to_string(),
            operation_id: "op_00000000000000000000000000000001".to_string(),
            session_id: "ses_00000000000000000000000000000001".to_string(),
            generation: 1,
            state: SessionState::Ready,
            terminal: None,
            cleanup: None,
            events: Vec::new(),
            process: Arc::new(ProcessControl {
                identity: ProcessIdentity {
                    pid: 0,
                    group_id: 0,
                    executable: PathBuf::new(),
                    executable_fingerprint: String::new(),
                    start_fingerprint: String::new(),
                    nonce: String::new(),
                    session_id: String::new(),
                    generation: 0,
                },
                stdin: Mutex::new(None),
                forced: AtomicBool::new(false),
                signal_stage: AtomicU8::new(0),
            }),
            progress_receiver: None,
            outcome_receiver: None,
            watcher_active: false,
            cancel_reason: None,
            started_at: Instant::now(),
            last_heartbeat_at: None,
            worker: None,
        };
        assert!(transition(&mut active, SessionState::Preprocessing).is_ok());
        assert!(transition(&mut active, SessionState::Idle).is_err());
    }

    #[test]
    fn bounded_parser_rejects_unknown_fields_and_out_of_order_progress() {
        let first = br#"{"protocolVersion":"chat-history-analysis.sidecar.v1","type":"progress","sessionId":"ses_00000000000000000000000000000001","generation":1,"phase":"startup","percentage":50,"status":"running","aggregateCount":0,"capacityValue":1}
{"protocolVersion":"chat-history-analysis.sidecar.v1","type":"progress","sessionId":"ses_00000000000000000000000000000001","generation":1,"phase":"startup","percentage":49,"status":"running","aggregateCount":0,"capacityValue":1}
{"protocolVersion":"chat-history-analysis.sidecar.v1","type":"result","sessionId":"ses_00000000000000000000000000000001","generation":1,"status":"success","sourceCount":1,"eventCount":1,"eligibleTextCount":1,"chunkCount":1,"duplicateEventCount":0,"warningCount":0}
"#;
        assert!(matches!(
            parse_stdout(&first[..], "ses_00000000000000000000000000000001", 1),
            Err(ParserError::Invalid)
        ));
    }

    #[test]
    fn state_transition_matrix_is_explicit() {
        let states = [
            SessionState::Idle,
            SessionState::Selecting,
            SessionState::Ready,
            SessionState::Preprocessing,
            SessionState::Handoff,
            SessionState::Analyzing,
            SessionState::Complete,
            SessionState::Cancelling,
            SessionState::Failed,
            SessionState::Discarding,
            SessionState::Closing,
        ];
        let allowed = [
            ("idle", "selecting"),
            ("selecting", "idle"),
            ("selecting", "ready"),
            ("ready", "preprocessing"),
            ("ready", "selecting"),
            ("ready", "discarding"),
            ("preprocessing", "handoff"),
            ("preprocessing", "cancelling"),
            ("preprocessing", "failed"),
            ("preprocessing", "closing"),
            ("handoff", "analyzing"),
            ("handoff", "cancelling"),
            ("handoff", "failed"),
            ("handoff", "closing"),
            ("analyzing", "complete"),
            ("analyzing", "cancelling"),
            ("analyzing", "failed"),
            ("analyzing", "closing"),
            ("complete", "selecting"),
            ("complete", "discarding"),
            ("complete", "closing"),
            ("cancelling", "ready"),
            ("cancelling", "failed"),
            ("cancelling", "discarding"),
            ("cancelling", "closing"),
            ("failed", "ready"),
            ("failed", "preprocessing"),
            ("failed", "discarding"),
            ("failed", "closing"),
            ("discarding", "idle"),
            ("discarding", "selecting"),
            ("discarding", "closing"),
        ];
        for from in states {
            for to in states {
                let expected = from == to || allowed.contains(&(from.as_str(), to.as_str()));
                assert_eq!(
                    valid_state_transition(from.as_str(), to.as_str()),
                    expected,
                    "unexpected transition {} -> {}",
                    from.as_str(),
                    to.as_str()
                );
            }
        }
    }
}
