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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::ipc::valid_state_transition;
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
    SidecarStartFailed,
    SidecarHandshakeTimeout,
    SidecarProtocolMismatch,
    SidecarProtocolInvalid,
    SidecarCrashed,
    SidecarExited,
    SessionCancelled,
    SessionCleanupFailed,
    CleanupRequired,
    ProcessIdentityMismatch,
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
            Self::SidecarStartFailed => "SIDECAR_START_FAILED",
            Self::SidecarHandshakeTimeout => "SIDECAR_HANDSHAKE_TIMEOUT",
            Self::SidecarProtocolMismatch => "SIDECAR_PROTOCOL_MISMATCH",
            Self::SidecarProtocolInvalid => "SIDECAR_PROTOCOL_INVALID",
            Self::SidecarCrashed => "SIDECAR_CRASHED",
            Self::SidecarExited => "SIDECAR_EXITED",
            Self::SessionCancelled => "SESSION_CANCELLED",
            Self::SessionCleanupFailed => "SESSION_CLEANUP_FAILED",
            Self::CleanupRequired => "CLEANUP_REQUIRED",
            Self::ProcessIdentityMismatch => "PROCESS_IDENTITY_MISMATCH",
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
    pub session_id: String,
    pub generation: u64,
    pub state: SessionState,
    pub terminal: Option<SessionTerminal>,
    pub cleanup: Option<CleanupStatus>,
    pub events: Vec<SessionEvent>,
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
        let sessions = self
            .application_cache_root
            .join(ANALYSIS_SESSIONS_DIRECTORY);
        if !directory_location(&sessions) || !secure_directory(&self.working_directory) {
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
    start_fingerprint: String,
    nonce: String,
}

#[derive(Debug)]
struct ProcessControl {
    identity: ProcessIdentity,
    stdin: Mutex<Option<ChildStdin>>,
    forced: AtomicBool,
}

impl ProcessControl {
    fn close_stdin(&self) {
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
    }

    fn signal(&self, signal: i32) -> Result<(), SupervisorError> {
        match process_identity_status(&self.identity) {
            IdentityStatus::Exited => Ok(()),
            IdentityStatus::Mismatch => Err(SupervisorError::new(
                SupervisorErrorCode::ProcessIdentityMismatch,
            )),
            IdentityStatus::Alive => send_process_group_signal(self.identity.group_id, signal),
        }
    }

    fn force_kill(&self) -> Result<(), SupervisorError> {
        self.forced.store(true, Ordering::Release);
        self.signal(9)
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
    output_directory: PathBuf,
    window_label: String,
    session_id: String,
    generation: u64,
    state: SessionState,
    terminal: Option<SessionTerminal>,
    cleanup: Option<CleanupStatus>,
    events: Vec<SessionEvent>,
    process: Arc<ProcessControl>,
    outcome_receiver: Option<Receiver<RunOutcome>>,
    cancel_reason: Option<CancelReason>,
    worker: Option<Arc<dyn WorkerTermination>>,
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
}

struct SupervisorInner {
    next_generation: u64,
    active: Option<ActiveSession>,
}

#[derive(Clone)]
pub struct SessionSupervisor {
    inner: Arc<Mutex<SupervisorInner>>,
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
            })),
        }
    }
}

impl SessionSupervisor {
    pub fn active_snapshot(&self) -> Option<SessionSnapshot> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.active.as_ref().map(snapshot))
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
        input.validate()?;
        ensure_secure_directory(&input.application_cache_root)?;
        ensure_secure_directory(
            &input
                .application_cache_root
                .join(ANALYSIS_SESSIONS_DIRECTORY),
        )?;

        // Reserve the only live-generation slot before spawning.  Keeping the
        // guard across spawn closes the check/spawn/insert race without ever
        // needing to kill a just-started session behind a competing caller.
        let mut inner = self.lock_inner()?;
        if inner.active.is_some() {
            return Err(SupervisorError::new(SupervisorErrorCode::SessionBusy));
        }
        inner.next_generation = inner
            .next_generation
            .checked_add(1)
            .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidState))?;
        let session_id = opaque_id("ses_")?;
        let generation = inner.next_generation;
        let output_directory = input
            .application_cache_root
            .join(ANALYSIS_SESSIONS_DIRECTORY)
            .join(&session_id);
        if output_directory.exists() || output_directory.symlink_metadata().is_ok() {
            return Err(SupervisorError::new(
                SupervisorErrorCode::SidecarStartFailed,
            ));
        }

        let nonce = opaque_id("nonce_")?;
        let configuration =
            build_configuration(&session_id, generation, &nonce, &input, &output_directory)?;
        let launch = SidecarLaunch {
            resolution,
            cwd: input.working_directory.clone(),
            configuration,
            nonce,
        };
        let (process, receiver) = spawn_sidecar(launch, &session_id, generation)?;

        let mut events = Vec::with_capacity(8);
        events.push(SessionEvent::State(SessionState::Ready));
        events.push(SessionEvent::State(SessionState::Preprocessing));
        inner.active = Some(ActiveSession {
            input,
            output_directory,
            window_label: window_label.to_string(),
            session_id,
            generation,
            state: SessionState::Preprocessing,
            terminal: None,
            cleanup: None,
            events,
            process,
            outcome_receiver: Some(receiver),
            cancel_reason: None,
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
        let receiver = {
            let mut inner = self.lock_inner()?;
            validate_active(&inner, window_label, session_id, generation)?;
            let active = inner.active.as_mut().expect("validated active session");
            if active.terminal.is_some() {
                return Ok(snapshot(active));
            }
            active
                .outcome_receiver
                .take()
                .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::InvalidState))?
        };

        match receiver.recv_timeout(timeout) {
            Ok(outcome) => self.apply_outcome(outcome),
            Err(RecvTimeoutError::Timeout) => {
                self.put_back_receiver(session_id, generation, receiver)?;
                let _ = self.cancel(
                    window_label,
                    session_id,
                    generation,
                    CancelReason::ApplicationClose,
                );
                Err(SupervisorError::new(
                    SupervisorErrorCode::SidecarHandshakeTimeout,
                ))
            }
            Err(RecvTimeoutError::Disconnected) => self.apply_outcome(RunOutcome {
                terminal: Err(SupervisorErrorCode::SidecarCrashed),
            }),
        }
    }

    pub fn cancel(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        reason: CancelReason,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let (process, receiver) = {
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
            (Arc::clone(&active.process), receiver)
        };

        self.request_worker_cancellation(session_id, generation);
        if let Err(error) = process.signal(2) {
            if error.code == SupervisorErrorCode::ProcessIdentityMismatch {
                self.mark_cleanup_required(session_id, generation);
            }
            self.put_back_receiver(session_id, generation, receiver)?;
            return Err(error);
        }
        let result = receiver.recv_timeout(GRACEFUL_CANCEL_GRACE);
        let outcome = match result {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Disconnected) => {
                return self.apply_outcome(RunOutcome {
                    terminal: Err(SupervisorErrorCode::SidecarCrashed),
                });
            }
            Err(RecvTimeoutError::Timeout) => {
                process.close_stdin();
                self.force_worker_termination(session_id, generation);
                if let Err(error) = process.signal(15) {
                    if error.code == SupervisorErrorCode::ProcessIdentityMismatch {
                        self.mark_cleanup_required(session_id, generation);
                    }
                    self.put_back_receiver(session_id, generation, receiver)?;
                    return Err(error);
                }
                match receiver.recv_timeout(TERM_CANCEL_GRACE) {
                    Ok(outcome) => outcome,
                    Err(RecvTimeoutError::Disconnected) => {
                        return self.apply_outcome(RunOutcome {
                            terminal: Err(SupervisorErrorCode::SidecarCrashed),
                        });
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        self.force_worker_termination(session_id, generation);
                        if let Err(error) = process.force_kill() {
                            if error.code == SupervisorErrorCode::ProcessIdentityMismatch {
                                self.mark_cleanup_required(session_id, generation);
                            }
                            self.put_back_receiver(session_id, generation, receiver)?;
                            return Err(error);
                        }
                        match receiver.recv_timeout(FINAL_KILL_WAIT) {
                            Ok(outcome) => outcome,
                            Err(RecvTimeoutError::Disconnected) => {
                                return self.apply_outcome(RunOutcome {
                                    terminal: Err(SupervisorErrorCode::SidecarCrashed),
                                });
                            }
                            Err(RecvTimeoutError::Timeout) => {
                                self.put_back_receiver(session_id, generation, receiver)?;
                                return Err(SupervisorError::new(
                                    SupervisorErrorCode::SessionCleanupFailed,
                                ));
                            }
                        }
                    }
                }
            }
        };
        self.apply_outcome(outcome)
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
        if !matches!(
            active.state,
            SessionState::Preprocessing | SessionState::Handoff | SessionState::Analyzing
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

    pub fn discard(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        if self.active_snapshot().is_some_and(|snapshot| {
            snapshot.terminal.is_none() && snapshot.state != SessionState::Closing
        }) {
            let _ = self.cancel(
                window_label,
                session_id,
                generation,
                CancelReason::Replacement,
            )?;
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
            if active.terminal.is_none() && active.state != SessionState::Closing {
                let _ = self.cancel(
                    window_label,
                    &active.session_id,
                    active.generation,
                    CancelReason::Replacement,
                )?;
            }
            let _ =
                self.cleanup_and_maybe_remove(window_label, &active.session_id, active.generation)?;
        }
        self.start(window_label, resolution, input)
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
            validate_active(&inner, window_label, session_id, generation)?;
            let active = inner.active.as_ref().expect("validated active session");
            if active.state != SessionState::Failed
                || !matches!(active.cleanup, Some(CleanupStatus::Complete { .. }))
            {
                return Err(SupervisorError::new(SupervisorErrorCode::InvalidState));
            }
            active.input.clone()
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
            if active.terminal.is_none() && active.state != SessionState::Closing {
                let _ = self.cancel(
                    window_label,
                    session_id,
                    generation,
                    CancelReason::ApplicationClose,
                )?;
            }
            return self.cleanup_and_maybe_remove(window_label, session_id, generation);
        }
        Err(SupervisorError::new(SupervisorErrorCode::SessionStale))
    }

    pub fn shutdown(&self) {
        let Some(active) = self.active_snapshot() else {
            return;
        };
        if active.terminal.is_none() && active.state != SessionState::Closing {
            let _ = self.cancel(
                "main",
                &active.session_id,
                active.generation,
                CancelReason::ApplicationClose,
            );
        }
        let _ = self.cleanup_and_maybe_remove("main", &active.session_id, active.generation);
    }

    pub fn renderer_disconnected(&self, window_label: &str) {
        if let Some(active) = self.active_snapshot() {
            let _ = self.close(window_label, &active.session_id, active.generation);
        }
    }

    fn apply_outcome(&self, outcome: RunOutcome) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        let active = inner
            .active
            .as_mut()
            .ok_or_else(|| SupervisorError::new(SupervisorErrorCode::SessionStale))?;
        if active.terminal.is_some() {
            return Ok(snapshot(active));
        }
        match outcome.terminal {
            Ok(terminal) => match terminal {
                SidecarTerminalResult::Success(result, progress) => {
                    for item in progress {
                        active.events.push(SessionEvent::Progress(item));
                    }
                    transition(active, SessionState::Handoff)?;
                    active
                        .events
                        .push(SessionEvent::State(SessionState::Handoff));
                    transition(active, SessionState::Analyzing)?;
                    active
                        .events
                        .push(SessionEvent::State(SessionState::Analyzing));
                    transition(active, SessionState::Complete)?;
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
            let cleanup = cleanup_session_directory(&active.output_directory, &active.session_id);
            let status = match cleanup {
                Ok(status) => status,
                Err(_) => CleanupStatus::Required,
            };
            active.cleanup = Some(status.clone());
            active.events.push(SessionEvent::Cleanup(status));
        }
        Ok(snapshot(active))
    }

    fn cleanup_and_maybe_remove(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<SessionSnapshot, SupervisorError> {
        let mut inner = self.lock_inner()?;
        validate_active(&inner, window_label, session_id, generation)?;
        let active = inner.active.as_mut().expect("validated active session");
        if active.state == SessionState::Closing && process_is_alive(active.process.identity.pid) {
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
            let status = cleanup_session_directory(&active.output_directory, &active.session_id)
                .unwrap_or(CleanupStatus::Required);
            active.cleanup = Some(status.clone());
            active.events.push(SessionEvent::Cleanup(status));
        }
        let completed = matches!(active.cleanup, Some(CleanupStatus::Complete { .. }));
        if completed {
            let result = snapshot(active);
            inner.active = None;
            Ok(result)
        } else {
            active.state = SessionState::Closing;
            Err(SupervisorError::new(SupervisorErrorCode::CleanupRequired))
        }
    }

    fn put_back_receiver(
        &self,
        session_id: &str,
        generation: u64,
        receiver: Receiver<RunOutcome>,
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
    SessionSnapshot {
        session_id: active.session_id.clone(),
        generation: active.generation,
        state: active.state,
        terminal: active.terminal.clone(),
        cleanup: active.cleanup.clone(),
        events: active.events.clone(),
    }
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
) -> Result<(Arc<ProcessControl>, Receiver<RunOutcome>), SupervisorError> {
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
    let mut child = command
        .spawn()
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarStartFailed))?;
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
            start_fingerprint,
            nonce: launch.nonce,
        },
        stdin: Mutex::new(Some(stdin)),
        forced: AtomicBool::new(false),
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

    let (sender, receiver) = mpsc::channel();
    let process = Arc::clone(&control);
    let session = session_id.to_string();
    thread::Builder::new()
        .name("sidecar-process-monitor".to_string())
        .spawn(move || {
            let terminal = monitor_child(child, process, stdout, stderr, &session, generation);
            let _ = sender.send(RunOutcome { terminal });
        })
        .map_err(|_| SupervisorError::new(SupervisorErrorCode::SidecarStartFailed))?;
    Ok((control, receiver))
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
) -> Result<SidecarTerminalResult, SupervisorErrorCode> {
    let session_id = session_id.to_string();
    let (stdout_sender, stdout_receiver) = mpsc::channel();
    let stdout_thread = thread::spawn(move || {
        let result = parse_stdout(stdout, &session_id, generation);
        let _ = stdout_sender.send(result);
    });
    let (stderr_sender, stderr_receiver) = mpsc::channel();
    let stderr_thread = thread::spawn(move || {
        let result = parse_stderr(stderr);
        let _ = stderr_sender.send(result);
    });

    let mut stdout_result = None;
    let mut stderr_result = None;
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
            let _ = process.force_kill();
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
                        ParserError::MissingTerminal => SupervisorErrorCode::SidecarCrashed,
                        other => map_parser_error(other),
                    });
                }
                Err(error) => return Err(map_parser_error(error)),
            };
            if !status.success() {
                return Err(SupervisorErrorCode::SidecarExited);
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
    mut reader: impl Read,
    session_id: &str,
    generation: u64,
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
                progress.push(SidecarProgress {
                    phase: phase.to_string(),
                    percentage,
                    status: status.to_string(),
                    aggregate_count,
                    capacity_value,
                    role,
                    source_ordinal,
                });
            }
            "result" => {
                let allowed = [
                    "protocolVersion",
                    "type",
                    "sessionId",
                    "generation",
                    "status",
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
    directory: &Path,
    session_id: &str,
) -> Result<CleanupStatus, SupervisorError> {
    if !absolute_path(directory)
        || directory.file_name().and_then(|value| value.to_str()) != Some(session_id)
        || directory
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|value| value.to_str())
            != Some(ANALYSIS_SESSIONS_DIRECTORY)
    {
        return Ok(CleanupStatus::Required);
    }
    let metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(CleanupStatus::Complete {
                removed_entry_count: 0,
            });
        }
        Err(_) => return Ok(CleanupStatus::Required),
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || !secure_directory(directory)
        || !secure_directory(directory.parent().unwrap_or(directory))
    {
        return Ok(CleanupStatus::Required);
    }
    let mut removed = 0u64;
    let mut unsafe_entry = false;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return Ok(CleanupStatus::Required),
    };
    for entry in entries {
        let Ok(entry) = entry else {
            unsafe_entry = true;
            continue;
        };
        let path = entry.path();
        let Ok(entry_metadata) = fs::symlink_metadata(&path) else {
            unsafe_entry = true;
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry_metadata.file_type().is_symlink() {
            unsafe_entry = true;
            continue;
        }
        if entry_metadata.is_file() && is_secure_regular_file(&path) && is_known_session_file(&name)
        {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            } else {
                unsafe_entry = true;
            }
        } else if entry_metadata.is_dir() && name == "normalized" {
            match cleanup_known_directory(&path) {
                Ok(count) => removed += count,
                Err(()) => unsafe_entry = true,
            }
        } else {
            unsafe_entry = true;
        }
    }
    if unsafe_entry {
        return Ok(CleanupStatus::Required);
    }
    let mut entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return Ok(CleanupStatus::Required),
    };
    if entries.next().is_some() {
        return Ok(CleanupStatus::Required);
    }
    if fs::remove_dir(directory).is_ok() {
        removed += 1;
        Ok(CleanupStatus::Complete {
            removed_entry_count: removed,
        })
    } else {
        Ok(CleanupStatus::Required)
    }
}

fn cleanup_known_directory(path: &Path) -> Result<u64, ()> {
    if !secure_directory(path) {
        return Err(());
    }
    let mut removed = 0u64;
    for entry in fs::read_dir(path).map_err(|_| ())? {
        let entry = entry.map_err(|_| ())?;
        let entry_path = entry.path();
        if !is_secure_regular_file(&entry_path) {
            return Err(());
        }
        if !is_known_session_file(&entry.file_name().to_string_lossy()) {
            return Err(());
        }
        fs::remove_file(entry_path).map_err(|_| ())?;
        removed += 1;
    }
    fs::remove_dir(path).map_err(|_| ())?;
    Ok(removed + 1)
}

fn is_secure_regular_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        metadata.uid() == unsafe { libc_getuid() } && metadata.permissions().mode() & 0o777 == 0o600
    }
    #[cfg(not(unix))]
    true
}

fn is_known_session_file(name: &str) -> bool {
    matches!(
        name,
        ".session-marker" | "session-state" | "manifest.json" | ".cleanup-required"
    ) || (name.starts_with("chunk-")
        && name.ends_with(".ndjson")
        && name[6..name.len() - 6].len() >= 4
        && name[6..name.len() - 6]
            .bytes()
            .all(|byte| byte.is_ascii_digit()))
}

fn process_identity_status(identity: &ProcessIdentity) -> IdentityStatus {
    if !process_is_alive(identity.pid) {
        return IdentityStatus::Exited;
    }
    if identity.nonce.is_empty() || !process_nonce_matches(identity.pid, &identity.nonce) {
        return IdentityStatus::Mismatch;
    }
    if process_group_id(identity.pid) != Some(identity.group_id)
        || process_executable(identity.pid).as_deref() != Some(identity.executable.as_path())
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
            output_directory: PathBuf::new(),
            window_label: "main".to_string(),
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
                    start_fingerprint: String::new(),
                    nonce: String::new(),
                },
                stdin: Mutex::new(None),
                forced: AtomicBool::new(false),
            }),
            outcome_receiver: None,
            cancel_reason: None,
            worker: None,
        };
        assert!(transition(&mut active, SessionState::Preprocessing).is_ok());
        assert!(transition(&mut active, SessionState::Idle).is_err());
    }

    #[test]
    fn bounded_parser_rejects_unknown_fields_and_out_of_order_progress() {
        let first = br#"{"protocolVersion":"chat-history-analysis.sidecar.v1","type":"progress","sessionId":"ses_00000000000000000000000000000001","generation":1,"phase":"startup","percentage":50,"status":"running","aggregateCount":0,"capacityValue":1}
{"protocolVersion":"chat-history-analysis.sidecar.v1","type":"progress","sessionId":"ses_00000000000000000000000000000001","generation":1,"phase":"startup","percentage":49,"status":"running","aggregateCount":0,"capacityValue":1}
{"protocolVersion":"chat-history-analysis.sidecar.v1","type":"result","sessionId":"ses_00000000000000000000000000000001","generation":1,"status":"success","eventCount":1,"eligibleTextCount":1,"chunkCount":1,"duplicateEventCount":0,"warningCount":0}
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
