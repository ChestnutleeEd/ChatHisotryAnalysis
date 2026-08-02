use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::security::trusted_main_window_label;

pub const PROTOCOL_VERSION: &str = "chat-history-analysis.desktop-ipc.v1";
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FailureCode {
    UnsupportedProtocolVersion,
    InvalidRequest,
    CommandNotAllowed,
    InvalidSession,
    InvalidGeneration,
    InvalidState,
    StaleGeneration,
    StaleEvent,
    WindowNotAuthorized,
    ContractOnly,
    SessionBusy,
    SessionStale,
    SidecarUnavailable,
    SidecarVerificationFailed,
    SidecarStartFailed,
    SidecarHandshakeTimeout,
    SidecarProtocolMismatch,
    SidecarExited,
    SessionCancelled,
    SessionCleanupFailed,
    ProcessIdentityMismatch,
    SidecarProtocolInvalid,
    SidecarCrashed,
    DatasetTransportInvalid,
    MemoryPressure,
    WorkerRuntimeFailed,
    CleanupRequired,
    NoSourceSelected,
    SourceCountExceeded,
    UnsupportedFileType,
    SourceUnreadable,
    DuplicateSource,
    SourceSetInvalid,
    SelectionStale,
    DiskSpaceInsufficient,
    DatasetHandoffInvalid,
    DatasetTampered,
    DialogUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub protocol_version: &'static str,
    pub request_id: Option<String>,
    pub code: FailureCode,
}

impl IpcError {
    fn invalid(request_id: Option<String>) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            code: FailureCode::InvalidRequest,
        }
    }

    fn with_code(request_id: Option<String>, code: FailureCode) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            code,
        }
    }

    fn contract_only(request_id: Option<String>) -> Self {
        Self::with_code(request_id, FailureCode::ContractOnly)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandAck {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectionCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    selection_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    session_id: String,
    generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    session_id: String,
    generation: u64,
    report_format: String,
    result_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CloseCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    decision: String,
}

fn object_keys(value: &Value) -> Option<BTreeSet<String>> {
    value
        .as_object()
        .map(|object| object.keys().cloned().collect())
}

fn exact_keys(value: &Value, expected: &[&str]) -> bool {
    let Some(actual) = object_keys(value) else {
        return false;
    };
    let expected = expected
        .iter()
        .map(|key| (*key).to_string())
        .collect::<BTreeSet<_>>();
    actual == expected
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn valid_id(value: &str, prefix: &str) -> bool {
    value.len() == prefix.len() + 32
        && value.starts_with(prefix)
        && value[prefix.len()..]
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn valid_protocol(value: &str) -> Result<(), FailureCode> {
    if value == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(FailureCode::UnsupportedProtocolVersion)
    }
}

fn all_json_integers_are_safe(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().all(all_json_integers_are_safe),
        Value::Object(values) => values.values().all(all_json_integers_are_safe),
        Value::Number(number) => {
            number
                .as_u64()
                .is_none_or(|unsigned| unsigned <= MAX_SAFE_INTEGER)
                && number.as_i64().is_none_or(|signed| signed >= 0)
        }
        _ => true,
    }
}

fn parse<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T, IpcError> {
    serde_json::from_value(value.clone()).map_err(|_| IpcError::invalid(None))
}

fn validate_select(value: &Value, expected_type: &str) -> Result<SelectCommand, IpcError> {
    if !exact_keys(value, &["protocolVersion", "requestId", "type"])
        || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: SelectCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != expected_type || !valid_id(&command.request_id, "req_") {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_selection(value: &Value, expected_type: &str) -> Result<SelectionCommand, IpcError> {
    if !exact_keys(
        value,
        &["protocolVersion", "requestId", "selectionId", "type"],
    ) || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: SelectionCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != expected_type
        || !valid_id(&command.request_id, "req_")
        || !valid_id(&command.selection_id, "sel_")
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_session(value: &Value, expected_type: &str) -> Result<SessionCommand, IpcError> {
    if !exact_keys(
        value,
        &[
            "generation",
            "protocolVersion",
            "requestId",
            "sessionId",
            "type",
        ],
    ) || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: SessionCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != expected_type
        || !valid_id(&command.request_id, "req_")
        || !valid_id(&command.session_id, "ses_")
        || command.generation == 0
        || command.generation > MAX_SAFE_INTEGER
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_export(value: &Value) -> Result<ExportCommand, IpcError> {
    if !exact_keys(
        value,
        &[
            "generation",
            "protocolVersion",
            "reportFormat",
            "requestId",
            "resultId",
            "sessionId",
            "type",
        ],
    ) || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: ExportCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != "export-aggregate"
        || !valid_id(&command.request_id, "req_")
        || !valid_id(&command.session_id, "ses_")
        || !valid_id(&command.result_id, "res_")
        || command.generation == 0
        || command.generation > MAX_SAFE_INTEGER
        || !matches!(command.report_format.as_str(), "png" | "csv" | "json")
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_close(value: &Value) -> Result<CloseCommand, IpcError> {
    if !exact_keys(value, &["decision", "protocolVersion", "requestId", "type"])
        || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: CloseCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != "request-application-close"
        || !valid_id(&command.request_id, "req_")
        || !matches!(command.decision.as_str(), "keep-open" | "cancel-and-close")
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

pub fn validate_command(value: &Value) -> Result<String, IpcError> {
    let Some(command_type) = string_field(value, "type") else {
        return Err(IpcError::invalid(None));
    };
    let request_id = string_field(value, "requestId");
    match command_type.as_str() {
        "select-annual-sources" | "select-verification-sources" => {
            validate_select(value, &command_type).map(|command| command.request_id)
        }
        "start-analysis" => {
            validate_selection(value, &command_type).map(|command| command.request_id)
        }
        "cancel-analysis" | "retry-analysis" | "discard-session" => {
            validate_session(value, &command_type).map(|command| command.request_id)
        }
        "export-aggregate" => validate_export(value).map(|command| command.request_id),
        "request-application-close" => validate_close(value).map(|command| command.request_id),
        _ => Err(IpcError::with_code(
            request_id,
            FailureCode::CommandNotAllowed,
        )),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EventType {
    SelectionReady,
    State,
    Progress,
    DatasetReady,
    Failure,
    Cancelled,
    Cleanup,
    Exported,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionReadyPayload {
    pub selection_id: String,
    pub annual_source_count: u64,
    pub verification_source_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatePayload {
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgressPayload {
    pub phase: String,
    pub completed: u64,
    pub total: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetReadyPayload {
    pub dataset_id: String,
    pub result_id: String,
    pub record_count: u64,
    pub chunk_count: u64,
    pub minimum_calendar_date: String,
    pub maximum_calendar_date: String,
    pub pseudonymous: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailurePayload {
    pub code: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelledPayload {
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupPayload {
    pub status: String,
    pub removed_entry_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportedPayload {
    pub result_id: String,
    pub report_format: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClosedPayload {
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum EventPayload {
    SelectionReady(SelectionReadyPayload),
    State(StatePayload),
    Progress(ProgressPayload),
    DatasetReady(DatasetReadyPayload),
    Failure(FailurePayload),
    Cancelled(CancelledPayload),
    Cleanup(CleanupPayload),
    Exported(ExportedPayload),
    Closed(ClosedPayload),
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventEnvelope {
    pub protocol_version: String,
    pub session_id: Option<String>,
    pub generation: u64,
    pub sequence: u64,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub payload: EventPayload,
}

fn is_calendar_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
    {
        return false;
    }
    let year = value[0..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    if !(1..=12).contains(&month) || day == 0 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    day <= max_day
}

fn valid_failure_code(value: &str) -> bool {
    matches!(
        value,
        "UNSUPPORTED_PROTOCOL_VERSION"
            | "INVALID_REQUEST"
            | "COMMAND_NOT_ALLOWED"
            | "INVALID_SESSION"
            | "INVALID_GENERATION"
            | "INVALID_STATE"
            | "STALE_GENERATION"
            | "STALE_EVENT"
            | "WINDOW_NOT_AUTHORIZED"
            | "CONTRACT_ONLY"
            | "SESSION_BUSY"
            | "SESSION_STALE"
            | "SIDECAR_UNAVAILABLE"
            | "SIDECAR_VERIFICATION_FAILED"
            | "SIDECAR_START_FAILED"
            | "SIDECAR_HANDSHAKE_TIMEOUT"
            | "SIDECAR_PROTOCOL_MISMATCH"
            | "SIDECAR_EXITED"
            | "SESSION_CANCELLED"
            | "SESSION_CLEANUP_FAILED"
            | "PROCESS_IDENTITY_MISMATCH"
            | "SIDECAR_PROTOCOL_INVALID"
            | "SIDECAR_CRASHED"
            | "DATASET_TRANSPORT_INVALID"
            | "MEMORY_PRESSURE"
            | "WORKER_RUNTIME_FAILED"
            | "CLEANUP_REQUIRED"
            | "NO_SOURCE_SELECTED"
            | "SOURCE_COUNT_EXCEEDED"
            | "UNSUPPORTED_FILE_TYPE"
            | "SOURCE_UNREADABLE"
            | "DUPLICATE_SOURCE"
            | "SOURCE_SET_INVALID"
            | "SELECTION_STALE"
            | "DISK_SPACE_INSUFFICIENT"
            | "DATASET_HANDOFF_INVALID"
            | "DATASET_TAMPERED"
            | "DIALOG_UNAVAILABLE"
    )
}

pub fn validate_event(value: &Value) -> Result<EventEnvelope, IpcError> {
    if !exact_keys(
        value,
        &[
            "generation",
            "payload",
            "protocolVersion",
            "sequence",
            "sessionId",
            "type",
        ],
    ) || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(None));
    }
    let event: EventEnvelope =
        serde_json::from_value(value.clone()).map_err(|_| IpcError::invalid(None))?;
    if event.protocol_version != PROTOCOL_VERSION
        || event.sequence == 0
        || event
            .session_id
            .as_deref()
            .is_some_and(|id| !valid_id(id, "ses_"))
        || (event.session_id.is_some() && event.generation == 0)
        || event.generation > MAX_SAFE_INTEGER
        || event.sequence > MAX_SAFE_INTEGER
    {
        return Err(IpcError::invalid(None));
    }
    if !matches!(&event.event_type, EventType::SelectionReady) && event.session_id.is_none() {
        return Err(IpcError::invalid(None));
    }
    match (&event.event_type, &event.payload) {
        (EventType::SelectionReady, EventPayload::SelectionReady(payload)) => {
            if event.session_id.is_some()
                || event.generation != 0
                || !valid_id(&payload.selection_id, "sel_")
                || payload.annual_source_count > MAX_SAFE_INTEGER
                || payload.verification_source_count > MAX_SAFE_INTEGER
            {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::State, EventPayload::State(payload)) => {
            if event.session_id.is_none() || !is_state(&payload.state) {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::Progress, EventPayload::Progress(payload)) => {
            if !is_phase(&payload.phase)
                || payload.total == 0
                || payload.completed > payload.total
                || payload.completed > MAX_SAFE_INTEGER
                || payload.total > MAX_SAFE_INTEGER
                || !payload.percentage.is_finite()
                || !(0.0..=100.0).contains(&payload.percentage)
            {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::DatasetReady, EventPayload::DatasetReady(payload)) => {
            if !valid_id(&payload.dataset_id, "dat_")
                || !valid_id(&payload.result_id, "res_")
                || payload.record_count == 0
                || payload.chunk_count == 0
                || payload.record_count > MAX_SAFE_INTEGER
                || payload.chunk_count > MAX_SAFE_INTEGER
                || !is_calendar_date(&payload.minimum_calendar_date)
                || !is_calendar_date(&payload.maximum_calendar_date)
                || payload.minimum_calendar_date > payload.maximum_calendar_date
                || !payload.pseudonymous
            {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::Failure, EventPayload::Failure(payload)) => {
            if !valid_failure_code(&payload.code) {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::Cancelled, EventPayload::Cancelled(payload)) => {
            if !matches!(
                payload.reason.as_str(),
                "user" | "replacement" | "application-close"
            ) {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::Cleanup, EventPayload::Cleanup(payload)) => {
            if !matches!(payload.status.as_str(), "complete" | "required")
                || payload.removed_entry_count > MAX_SAFE_INTEGER
            {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::Exported, EventPayload::Exported(payload)) => {
            if !valid_id(&payload.result_id, "res_")
                || !matches!(payload.report_format.as_str(), "png" | "csv" | "json")
            {
                return Err(IpcError::invalid(None));
            }
        }
        (EventType::Closed, EventPayload::Closed(payload)) => {
            if !matches!(payload.status.as_str(), "complete" | "cleanup-required") {
                return Err(IpcError::invalid(None));
            }
        }
        _ => return Err(IpcError::invalid(None)),
    }
    Ok(event)
}

fn is_state(value: &str) -> bool {
    matches!(
        value,
        "idle"
            | "selecting"
            | "ready"
            | "preprocessing"
            | "handoff"
            | "analyzing"
            | "complete"
            | "cancelling"
            | "failed"
            | "discarding"
            | "closing"
    )
}

fn is_phase(value: &str) -> bool {
    matches!(
        value,
        "selection"
            | "validation"
            | "preprocessing"
            | "handoff"
            | "transport"
            | "hash"
            | "parse"
            | "index"
            | "tokenization"
            | "aggregation"
            | "cleanup"
    )
}

pub fn valid_state_transition(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    match from {
        "idle" => matches!(to, "selecting"),
        "selecting" => matches!(to, "idle" | "ready"),
        "ready" => matches!(to, "preprocessing" | "selecting" | "discarding"),
        "preprocessing" => matches!(to, "handoff" | "cancelling" | "failed" | "closing"),
        "handoff" => matches!(to, "analyzing" | "cancelling" | "failed" | "closing"),
        "analyzing" => matches!(to, "complete" | "cancelling" | "failed" | "closing"),
        "complete" => matches!(to, "selecting" | "discarding" | "closing"),
        "cancelling" => matches!(to, "ready" | "failed" | "discarding" | "closing"),
        "failed" => matches!(to, "ready" | "preprocessing" | "discarding" | "closing"),
        "discarding" => matches!(to, "idle" | "selecting" | "closing"),
        "closing" => false,
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalOutcome {
    Complete,
    Failure,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRecord {
    pub window_label: String,
    pub session_id: String,
    pub generation: u64,
    pub expected_sequence: u64,
    pub state: String,
    pub terminal_outcome: Option<TerminalOutcome>,
    pub cleanup_status: Option<String>,
    pub closed: bool,
}

impl SessionRecord {
    fn new(window_label: &str, session_id: &str, generation: u64) -> Self {
        Self {
            window_label: window_label.to_string(),
            session_id: session_id.to_string(),
            generation,
            expected_sequence: 1,
            state: "ready".to_string(),
            terminal_outcome: None,
            cleanup_status: None,
            closed: false,
        }
    }
}

#[derive(Debug, Default)]
struct SessionRegistry {
    active: Option<SessionRecord>,
}

#[derive(Debug)]
pub struct IpcCoreState {
    registry: Arc<Mutex<SessionRegistry>>,
    selection: Arc<Mutex<crate::desktop_selection::SelectionRegistry>>,
    supervisor: crate::session_supervisor::SessionSupervisor,
    startup_cleanup_required: Arc<AtomicBool>,
}

impl Default for IpcCoreState {
    fn default() -> Self {
        Self {
            registry: Arc::new(Mutex::new(SessionRegistry::default())),
            selection: Arc::new(Mutex::new(
                crate::desktop_selection::SelectionRegistry::default(),
            )),
            supervisor: crate::session_supervisor::SessionSupervisor::default(),
            startup_cleanup_required: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Clone for IpcCoreState {
    fn clone(&self) -> Self {
        Self {
            registry: Arc::clone(&self.registry),
            selection: Arc::clone(&self.selection),
            supervisor: self.supervisor.clone(),
            startup_cleanup_required: Arc::clone(&self.startup_cleanup_required),
        }
    }
}

impl IpcCoreState {
    pub fn session_supervisor(&self) -> &crate::session_supervisor::SessionSupervisor {
        &self.supervisor
    }

    pub fn renderer_disconnected(&self, window_label: &str) {
        self.supervisor.renderer_disconnected(window_label);
    }

    pub fn shutdown(&self) {
        self.supervisor.shutdown();
    }

    pub fn set_startup_cleanup_required(&self, required: bool) {
        self.startup_cleanup_required
            .store(required, Ordering::Release);
    }

    pub fn startup_cleanup_required(&self) -> bool {
        self.startup_cleanup_required.load(Ordering::Acquire)
    }

    pub fn replace_selection(
        &self,
        role: crate::desktop_selection::SourceRole,
        paths: Vec<std::path::PathBuf>,
    ) -> Result<crate::desktop_selection::SelectionSummary, FailureCode> {
        self.selection
            .lock()
            .map_err(|_| FailureCode::InvalidState)?
            .replace_role(role, paths)
            .map_err(selection_failure_code)
    }

    pub fn current_selection(
        &self,
        selection_id: &str,
    ) -> Result<crate::desktop_selection::SelectionRecord, FailureCode> {
        let selection = self
            .selection
            .lock()
            .map_err(|_| FailureCode::InvalidState)?
            .current()
            .ok_or(FailureCode::NoSourceSelected)?;
        if selection.selection_id() != selection_id {
            return Err(FailureCode::SelectionStale);
        }
        Ok(selection)
    }

    pub fn clear_selection(&self) {
        if let Ok(mut selection) = self.selection.lock() {
            selection.clear();
        }
    }

    pub fn replace_registered_session(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        if !trusted_main_window_label(trusted_window_label)
            || !valid_id(session_id, "ses_")
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return Err(FailureCode::WindowNotAuthorized);
        }
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        registry.active = Some(SessionRecord::new(
            trusted_window_label,
            session_id,
            generation,
        ));
        Ok(())
    }

    pub fn publish_selection_ready(
        &self,
        window: &tauri::WebviewWindow,
        summary: &crate::desktop_selection::SelectionSummary,
    ) -> Result<(), FailureCode> {
        let value = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "sessionId": null,
            "generation": 0,
            "sequence": 1,
            "type": "selection-ready",
            "payload": {
                "selectionId": summary.selection_id,
                "annualSourceCount": summary.annual_source_count,
                "verificationSourceCount": summary.verification_source_count,
            },
        });
        validate_event(&value).map_err(|error| error.code)?;
        window
            .emit("desktop-event", &value)
            .map_err(|_| FailureCode::InvalidState)
    }

    pub fn publish_state(
        &self,
        window: &tauri::WebviewWindow,
        state: &str,
    ) -> Result<(), FailureCode> {
        self.publish_session_value(window, "state", serde_json::json!({ "state": state }))
    }

    pub fn publish_progress(
        &self,
        window: &tauri::WebviewWindow,
        phase: &str,
        completed: u64,
        total: u64,
        percentage: f64,
    ) -> Result<(), FailureCode> {
        self.publish_session_value(
            window,
            "progress",
            serde_json::json!({
                "phase": phase,
                "completed": completed,
                "total": total,
                "percentage": percentage,
            }),
        )
    }

    pub fn publish_dataset_ready(
        &self,
        window: &tauri::WebviewWindow,
        dataset_id: &str,
        result_id: &str,
        record_count: u64,
        chunk_count: u64,
        minimum_calendar_date: &str,
        maximum_calendar_date: &str,
    ) -> Result<(), FailureCode> {
        self.publish_session_value(
            window,
            "dataset-ready",
            serde_json::json!({
                "datasetId": dataset_id,
                "resultId": result_id,
                "recordCount": record_count,
                "chunkCount": chunk_count,
                "minimumCalendarDate": minimum_calendar_date,
                "maximumCalendarDate": maximum_calendar_date,
                "pseudonymous": true,
            }),
        )
    }

    pub fn publish_failure(
        &self,
        window: &tauri::WebviewWindow,
        code: FailureCode,
        retryable: bool,
    ) -> Result<(), FailureCode> {
        self.publish_session_value(
            window,
            "failure",
            serde_json::json!({
                "code": code,
                "retryable": retryable,
            }),
        )
    }

    pub fn publish_cancelled(
        &self,
        window: &tauri::WebviewWindow,
        reason: &str,
    ) -> Result<(), FailureCode> {
        self.publish_session_value(window, "cancelled", serde_json::json!({ "reason": reason }))
    }

    pub fn publish_cleanup(
        &self,
        window: &tauri::WebviewWindow,
        status: &str,
        removed_entry_count: u64,
    ) -> Result<(), FailureCode> {
        self.publish_session_value(
            window,
            "cleanup",
            serde_json::json!({
                "status": status,
                "removedEntryCount": removed_entry_count,
            }),
        )
    }

    pub fn publish_closed(
        &self,
        window: &tauri::WebviewWindow,
        status: &str,
    ) -> Result<(), FailureCode> {
        self.publish_session_value(window, "closed", serde_json::json!({ "status": status }))
    }

    fn publish_session_value(
        &self,
        window: &tauri::WebviewWindow,
        event_type: &str,
        payload: Value,
    ) -> Result<(), FailureCode> {
        let (session_id, generation, sequence) = {
            let registry = self
                .registry
                .lock()
                .map_err(|_| FailureCode::InvalidState)?;
            let active = registry
                .active
                .as_ref()
                .ok_or(FailureCode::InvalidSession)?;
            (
                active.session_id.clone(),
                active.generation,
                active.expected_sequence,
            )
        };
        let value = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "sessionId": session_id,
            "generation": generation,
            "sequence": sequence,
            "type": event_type,
            "payload": payload,
        });
        self.accept_event(window.label(), &value)?;
        window
            .emit("desktop-event", &value)
            .map_err(|_| FailureCode::InvalidState)
    }
}

impl IpcCoreState {
    pub fn register_session(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        if !trusted_main_window_label(trusted_window_label)
            || !valid_id(session_id, "ses_")
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return Err(FailureCode::WindowNotAuthorized);
        }
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        if registry.active.is_some() {
            return Err(FailureCode::InvalidState);
        }
        registry.active = Some(SessionRecord::new(
            trusted_window_label,
            session_id,
            generation,
        ));
        Ok(())
    }

    pub fn validate_owned_session(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        if !trusted_main_window_label(trusted_window_label) {
            return Err(FailureCode::WindowNotAuthorized);
        }
        let registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        let Some(active) = registry.active.as_ref() else {
            return Err(FailureCode::InvalidSession);
        };
        if active.window_label != trusted_window_label || active.session_id != session_id {
            return Err(FailureCode::InvalidSession);
        }
        if active.generation != generation {
            return Err(FailureCode::StaleGeneration);
        }
        if active.closed {
            return Err(FailureCode::InvalidSession);
        }
        Ok(())
    }

    pub fn accept_event(
        &self,
        trusted_window_label: &str,
        value: &Value,
    ) -> Result<(), FailureCode> {
        if !trusted_main_window_label(trusted_window_label) {
            return Err(FailureCode::WindowNotAuthorized);
        }
        let event = validate_event(value).map_err(|error| error.code)?;
        if matches!(&event.event_type, EventType::SelectionReady) {
            return Ok(());
        }
        let Some(session_id) = event.session_id.as_deref() else {
            return Err(FailureCode::InvalidSession);
        };
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        let Some(active) = registry.active.as_mut() else {
            return Err(FailureCode::InvalidSession);
        };
        if active.window_label != trusted_window_label || active.session_id != session_id {
            return Err(FailureCode::InvalidSession);
        }
        if active.generation != event.generation {
            return Err(FailureCode::StaleGeneration);
        }
        if event.sequence != active.expected_sequence {
            return Err(if event.sequence < active.expected_sequence {
                FailureCode::StaleEvent
            } else {
                FailureCode::InvalidState
            });
        }

        if active.closed {
            return Err(FailureCode::StaleEvent);
        }
        match (&event.event_type, &event.payload) {
            (EventType::State, EventPayload::State(payload)) => {
                if active.terminal_outcome.is_some() {
                    return Err(FailureCode::StaleEvent);
                }
                if !valid_state_transition(&active.state, &payload.state) {
                    return Err(FailureCode::InvalidState);
                }
                active.state = payload.state.clone();
                if active.state == "complete" {
                    active.terminal_outcome = Some(TerminalOutcome::Complete);
                } else if active.state == "failed" {
                    active.terminal_outcome = Some(TerminalOutcome::Failure);
                }
            }
            (EventType::Failure, EventPayload::Failure(_)) => {
                if active.terminal_outcome.is_some() {
                    return Err(FailureCode::StaleEvent);
                }
                active.state = "failed".to_string();
                active.terminal_outcome = Some(TerminalOutcome::Failure);
            }
            (EventType::Cancelled, EventPayload::Cancelled(_)) => {
                if active.terminal_outcome.is_some() {
                    return Err(FailureCode::StaleEvent);
                }
                active.state = "cancelling".to_string();
                active.terminal_outcome = Some(TerminalOutcome::Cancelled);
            }
            (EventType::Cleanup, EventPayload::Cleanup(payload)) => {
                if active.terminal_outcome.is_none() || active.cleanup_status.is_some() {
                    return Err(FailureCode::InvalidState);
                }
                active.cleanup_status = Some(payload.status.clone());
            }
            (EventType::Closed, EventPayload::Closed(_)) => {
                if active.terminal_outcome.is_none() || active.cleanup_status.is_none() {
                    return Err(FailureCode::InvalidState);
                }
                active.closed = true;
            }
            (EventType::Exported, EventPayload::Exported(_)) => {
                if active.terminal_outcome != Some(TerminalOutcome::Complete)
                    || active.cleanup_status.is_some()
                {
                    return Err(FailureCode::InvalidState);
                }
            }
            (EventType::Progress, EventPayload::Progress(_))
            | (EventType::DatasetReady, EventPayload::DatasetReady(_)) => {
                if active.terminal_outcome.is_some() {
                    return Err(FailureCode::StaleEvent);
                }
            }
            (EventType::SelectionReady, EventPayload::SelectionReady(_)) => {
                return Err(FailureCode::InvalidState)
            }
            _ => return Err(FailureCode::InvalidRequest),
        }
        active.expected_sequence = active
            .expected_sequence
            .checked_add(1)
            .ok_or(FailureCode::InvalidState)?;
        if active.closed {
            registry.active = None;
        }
        Ok(())
    }

    #[cfg(test)]
    fn snapshot(&self) -> Option<SessionRecord> {
        self.registry
            .lock()
            .ok()
            .and_then(|registry| registry.active.clone())
    }
}

fn command_ack(request_id: String) -> CommandAck {
    CommandAck {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        accepted: true,
    }
}

fn selection_failure_code(error: crate::desktop_selection::SelectionError) -> FailureCode {
    match error.code {
        crate::desktop_selection::SelectionErrorCode::NoSourceSelected => {
            FailureCode::NoSourceSelected
        }
        crate::desktop_selection::SelectionErrorCode::SourceCountExceeded => {
            FailureCode::SourceCountExceeded
        }
        crate::desktop_selection::SelectionErrorCode::UnsupportedFileType => {
            FailureCode::UnsupportedFileType
        }
        crate::desktop_selection::SelectionErrorCode::SourceUnreadable => {
            FailureCode::SourceUnreadable
        }
        crate::desktop_selection::SelectionErrorCode::DuplicateSource => {
            FailureCode::DuplicateSource
        }
        crate::desktop_selection::SelectionErrorCode::SelectionStale => FailureCode::SelectionStale,
        crate::desktop_selection::SelectionErrorCode::DialogUnavailable => {
            FailureCode::DialogUnavailable
        }
        crate::desktop_selection::SelectionErrorCode::InvalidSelection => {
            FailureCode::SourceSetInvalid
        }
    }
}

fn map_supervisor_code(code: crate::session_supervisor::SupervisorErrorCode) -> FailureCode {
    use crate::session_supervisor::SupervisorErrorCode;
    match code {
        SupervisorErrorCode::InvalidRequest => FailureCode::InvalidRequest,
        SupervisorErrorCode::InvalidState => FailureCode::InvalidState,
        SupervisorErrorCode::WindowNotAuthorized => FailureCode::WindowNotAuthorized,
        SupervisorErrorCode::SessionBusy => FailureCode::SessionBusy,
        SupervisorErrorCode::SessionStale => FailureCode::SessionStale,
        SupervisorErrorCode::SidecarUnavailable => FailureCode::SidecarUnavailable,
        SupervisorErrorCode::SidecarVerificationFailed => FailureCode::SidecarVerificationFailed,
        SupervisorErrorCode::SidecarStartFailed => FailureCode::SidecarStartFailed,
        SupervisorErrorCode::SidecarHandshakeTimeout => FailureCode::SidecarHandshakeTimeout,
        SupervisorErrorCode::SidecarProtocolMismatch => FailureCode::SidecarProtocolMismatch,
        SupervisorErrorCode::SidecarProtocolInvalid => FailureCode::SidecarProtocolInvalid,
        SupervisorErrorCode::SidecarCrashed => FailureCode::SidecarCrashed,
        SupervisorErrorCode::SidecarExited => FailureCode::SidecarExited,
        SupervisorErrorCode::SessionCancelled => FailureCode::SessionCancelled,
        SupervisorErrorCode::SessionCleanupFailed => FailureCode::SessionCleanupFailed,
        SupervisorErrorCode::CleanupRequired => FailureCode::CleanupRequired,
        SupervisorErrorCode::ProcessIdentityMismatch => FailureCode::ProcessIdentityMismatch,
        SupervisorErrorCode::DiskSpaceInsufficient => FailureCode::DiskSpaceInsufficient,
    }
}

fn map_sidecar_reason(reason: &str) -> FailureCode {
    match reason {
        "SOURCE_MUTATED" => FailureCode::SourceUnreadable,
        "OUTPUT_DESTINATION_EXISTS"
        | "OUTPUT_PARENT_UNSAFE"
        | "OUTPUT_STAGING_FAILED"
        | "OUTPUT_WRITE_FAILED"
        | "OUTPUT_FLUSH_FAILED"
        | "OUTPUT_INTEGRITY_FAILED"
        | "OUTPUT_CLEANUP_FAILED"
        | "OUTPUT_PROMOTION_FAILED"
        | "CANONICAL_SCHEMA_INVALID"
        | "CANONICAL_PRIVACY_VALIDATION_FAILED"
        | "CANONICAL_DATASET_LIMIT_EXCEEDED"
        | "CANONICAL_CHUNK_LIMIT_EXCEEDED"
        | "CANONICAL_EVENT_LIMIT_EXCEEDED"
        | "CANONICAL_NO_EVENTS" => FailureCode::DatasetHandoffInvalid,
        "INPUT_PREFLIGHT_FAILED"
        | "RAW_INPUT_FILE_LIMIT_EXCEEDED"
        | "ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED"
        | "AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED"
        | "UNSUPPORTED_EXPORT_FORMAT"
        | "NO_ELIGIBLE_TEXT_RECORDS" => FailureCode::SourceSetInvalid,
        "USER_CANCELLED" => FailureCode::SessionCancelled,
        "SIDECAR_CRASHED" => FailureCode::SidecarCrashed,
        _ => FailureCode::SidecarProtocolInvalid,
    }
}

fn code_as_reason(code: &FailureCode) -> &'static str {
    match code {
        FailureCode::DatasetTampered => "DATASET_TAMPERED",
        FailureCode::DatasetHandoffInvalid => "DATASET_HANDOFF_INVALID",
        _ => "DATASET_HANDOFF_INVALID",
    }
}

fn retryable_failure(code: &FailureCode) -> bool {
    matches!(
        code,
        FailureCode::SessionCleanupFailed
            | FailureCode::CleanupRequired
            | FailureCode::SidecarUnavailable
            | FailureCode::SidecarVerificationFailed
            | FailureCode::SidecarStartFailed
            | FailureCode::SidecarHandshakeTimeout
            | FailureCode::SidecarProtocolMismatch
            | FailureCode::SidecarExited
            | FailureCode::SidecarProtocolInvalid
            | FailureCode::SidecarCrashed
            | FailureCode::DatasetHandoffInvalid
            | FailureCode::DatasetTampered
            | FailureCode::DiskSpaceInsufficient
            | FailureCode::MemoryPressure
            | FailureCode::WorkerRuntimeFailed
    )
}

fn opaque_ipc_id(prefix: &str) -> Result<String, IpcError> {
    let mut bytes = [0u8; 16];
    #[cfg(unix)]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(&mut bytes))
            .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    }
    #[cfg(not(unix))]
    {
        let _ = bytes;
        return Err(IpcError::with_code(None, FailureCode::InvalidState));
    }
    let mut value = prefix.to_string();
    for byte in bytes {
        value.push_str(&format!("{byte:02x}"));
    }
    Ok(value)
}

fn app_cache_paths(
    window: &tauri::WebviewWindow,
) -> Result<(std::path::PathBuf, std::path::PathBuf), IpcError> {
    let cache_root = window
        .app_handle()
        .path()
        .app_cache_dir()
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    let working_directory = cache_root.join("sidecar-work");
    Ok((cache_root, working_directory))
}

fn retry_startup_recovery(
    window: &tauri::WebviewWindow,
    state: &IpcCoreState,
) -> Result<(), IpcError> {
    if !state.startup_cleanup_required() {
        return Ok(());
    }
    let cache_root = window
        .app_handle()
        .path()
        .app_cache_dir()
        .map_err(|_| IpcError::with_code(None, FailureCode::SessionCleanupFailed))?;
    let recovery = crate::session_supervisor::recover_startup_sessions(&cache_root)
        .map_err(|_| IpcError::with_code(None, FailureCode::SessionCleanupFailed))?;
    state.set_startup_cleanup_required(recovery.cleanup_required);
    if recovery.cleanup_required {
        Err(IpcError::with_code(None, FailureCode::CleanupRequired))
    } else {
        Ok(())
    }
}

fn resolve_sidecar(
    window: &tauri::WebviewWindow,
) -> Result<crate::session_supervisor::SidecarResolution, IpcError> {
    if let Ok(resource_directory) = window.app_handle().path().resource_dir() {
        if let Ok(resolution) =
            crate::session_supervisor::SidecarResolution::packaged(&resource_directory)
        {
            return Ok(resolution);
        }
    }
    #[cfg(debug_assertions)]
    {
        let python = std::env::var_os("CHAT_HISTORY_ANALYSIS_DEV_PYTHON")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                let candidate = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../.venv/bin/python");
                candidate.exists().then_some(candidate)
            });
        let entrypoint = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../scripts/sidecar/sidecar_entry.py");
        if let Some(python) = python {
            if let Ok(resolution) =
                crate::session_supervisor::SidecarResolution::development_python(python, entrypoint)
            {
                return Ok(resolution);
            }
        }
    }
    Err(IpcError::with_code(None, FailureCode::SidecarUnavailable))
}

fn cleanup_count(snapshot: &crate::session_supervisor::SessionSnapshot) -> (String, u64) {
    match snapshot.cleanup {
        Some(crate::session_supervisor::CleanupStatus::Complete {
            removed_entry_count,
        }) => ("complete".to_string(), removed_entry_count),
        Some(crate::session_supervisor::CleanupStatus::Required) | None => {
            ("required".to_string(), 0)
        }
    }
}

fn publish_snapshot_cleanup(
    core: &IpcCoreState,
    window: &tauri::WebviewWindow,
    snapshot: &crate::session_supervisor::SessionSnapshot,
) {
    let (status, count) = cleanup_count(snapshot);
    let _ = core.publish_cleanup(window, &status, count);
}

fn phase_for_sidecar(value: &str) -> &'static str {
    match value {
        "output-verification" | "output-promotion" => "handoff",
        "input-preflight"
        | "source-digest"
        | "source-validation"
        | "session-validation"
        | "source-staging"
        | "dataset-staging"
        | "output-serialization" => "preprocessing",
        _ => "preprocessing",
    }
}

fn handle_watched_session(
    core: IpcCoreState,
    window: tauri::WebviewWindow,
    transport: crate::dataset_transport::DatasetTransportState,
    cache_root: std::path::PathBuf,
    session_id: String,
    generation: u64,
    result: Result<
        crate::session_supervisor::SessionSnapshot,
        crate::session_supervisor::SupervisorError,
    >,
) {
    let snapshot = match result {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let code = map_supervisor_code(error.code);
            transport.close_session(&window.label(), &session_id, generation);
            let _ = core.publish_failure(&window, code.clone(), retryable_failure(&code));
            if let Some(snapshot) = core.supervisor.active_snapshot() {
                publish_snapshot_cleanup(&core, &window, &snapshot);
            }
            return;
        }
    };
    match snapshot.terminal.clone() {
        Some(crate::session_supervisor::SessionTerminal::Complete(_)) => {
            for event in &snapshot.events {
                if let crate::session_supervisor::SessionEvent::Progress(progress) = event {
                    let total = progress.capacity_value.max(1);
                    let completed = progress.aggregate_count.min(total);
                    let _ = core.publish_progress(
                        &window,
                        phase_for_sidecar(&progress.phase),
                        completed,
                        total,
                        f64::from(progress.percentage),
                    );
                }
            }
            let _ = core.publish_state(&window, "handoff");
            let session_root = cache_root
                .join(crate::session_supervisor::ANALYSIS_SESSIONS_DIRECTORY)
                .join(&session_id);
            let verified = match crate::dataset_handoff::verify_session_dataset(
                &session_root,
                &session_id,
                generation,
            ) {
                Ok(verified) => verified,
                Err(error) => {
                    let code = if error.code
                        == crate::dataset_handoff::HandoffErrorCode::TamperedDataset
                    {
                        FailureCode::DatasetTampered
                    } else {
                        FailureCode::DatasetHandoffInvalid
                    };
                    let _ = core.publish_failure(&window, code.clone(), true);
                    if let Ok(cleaned) = core.supervisor.reject_handoff(
                        window.label(),
                        &session_id,
                        generation,
                        code_as_reason(&code),
                    ) {
                        publish_snapshot_cleanup(&core, &window, &cleaned);
                    }
                    return;
                }
            };
            transport.mark_sidecar_verified();
            let capability = match transport.register_host_dataset_for_session(
                window.label(),
                &session_id,
                generation,
                verified.manifest,
                verified.chunks,
            ) {
                Ok(capability) => capability,
                Err(_) => {
                    let _ =
                        core.publish_failure(&window, FailureCode::DatasetTransportInvalid, true);
                    if let Ok(cleaned) = core.supervisor.reject_handoff(
                        window.label(),
                        &session_id,
                        generation,
                        "DATASET_TRANSPORT_INVALID",
                    ) {
                        publish_snapshot_cleanup(&core, &window, &cleaned);
                    }
                    return;
                }
            };
            let result_id = match opaque_ipc_id("res_") {
                Ok(result_id) => result_id,
                Err(_) => {
                    transport.close_session(&window.label(), &session_id, generation);
                    let _ = core.publish_failure(&window, FailureCode::InvalidState, true);
                    if let Ok(cleaned) = core.supervisor.reject_handoff(
                        window.label(),
                        &session_id,
                        generation,
                        "RESULT_ID_FAILED",
                    ) {
                        publish_snapshot_cleanup(&core, &window, &cleaned);
                    }
                    return;
                }
            };
            if core
                .publish_dataset_ready(
                    &window,
                    &capability.dataset_id,
                    &result_id,
                    verified.record_count,
                    verified.chunk_count,
                    &verified.minimum_calendar_date,
                    &verified.maximum_calendar_date,
                )
                .is_err()
            {
                transport.close_session(&window.label(), &session_id, generation);
                return;
            }
            let _ = core.publish_state(&window, "analyzing");
            let _ = core.publish_state(&window, "complete");
        }
        Some(crate::session_supervisor::SessionTerminal::Failed(reason)) => {
            let code = map_sidecar_reason(&reason);
            transport.close_session(&window.label(), &session_id, generation);
            let _ = core.publish_failure(&window, code.clone(), retryable_failure(&code));
            publish_snapshot_cleanup(&core, &window, &snapshot);
        }
        Some(crate::session_supervisor::SessionTerminal::Cancelled) => {
            transport.close_session(&window.label(), &session_id, generation);
            let reason = match snapshot.cancel_reason {
                Some(crate::session_supervisor::CancelReason::Replacement) => "replacement",
                Some(crate::session_supervisor::CancelReason::ApplicationClose) => {
                    "application-close"
                }
                Some(crate::session_supervisor::CancelReason::User) | None => "user",
            };
            let _ = core.publish_cancelled(&window, reason);
            publish_snapshot_cleanup(&core, &window, &snapshot);
            if reason != "user" {
                let _ = core.publish_closed(
                    &window,
                    if matches!(
                        snapshot.cleanup,
                        Some(crate::session_supervisor::CleanupStatus::Complete { .. })
                    ) {
                        "complete"
                    } else {
                        "cleanup-required"
                    },
                );
                let _ = core
                    .supervisor
                    .discard(window.label(), &session_id, generation);
            }
        }
        None => {
            let _ = core.publish_failure(&window, FailureCode::SidecarCrashed, true);
            transport.close_session(&window.label(), &session_id, generation);
            if let Some(snapshot) = core.supervisor.active_snapshot() {
                publish_snapshot_cleanup(&core, &window, &snapshot);
            }
        }
    }
}

fn start_session(
    window: &tauri::WebviewWindow,
    state: &IpcCoreState,
    selection_id: &str,
) -> Result<(String, u64), IpcError> {
    retry_startup_recovery(window, state)?;
    let selection = state
        .current_selection(selection_id)
        .map_err(|code| IpcError::with_code(None, code))?;
    if selection.annual_sources().is_empty() {
        return Err(IpcError::with_code(None, FailureCode::NoSourceSelected));
    }
    let (cache_root, working_directory) = app_cache_paths(window)?;
    let resolution = resolve_sidecar(window)?;
    let input = crate::session_supervisor::SessionInput::new(
        selection.annual_sources().to_vec(),
        selection.verification_sources().to_vec(),
        cache_root.clone(),
        working_directory,
    );
    let snapshot = state
        .supervisor
        .start(window.label(), resolution, input)
        .map_err(|error| IpcError::with_code(None, map_supervisor_code(error.code)))?;
    if let Err(code) =
        state.register_session(window.label(), &snapshot.session_id, snapshot.generation)
    {
        let _ = state
            .supervisor
            .discard(window.label(), &snapshot.session_id, snapshot.generation);
        return Err(IpcError::with_code(None, code));
    }
    if let Err(code) = state
        .publish_state(window, "ready")
        .and_then(|_| state.publish_state(window, "preprocessing"))
    {
        let _ = state
            .supervisor
            .discard(window.label(), &snapshot.session_id, snapshot.generation);
        return Err(IpcError::with_code(None, code));
    }
    let core = state.clone();
    let watcher_window = window.clone();
    let transport = window
        .app_handle()
        .state::<crate::dataset_transport::DatasetTransportState>()
        .inner()
        .clone();
    let cache_for_watcher = cache_root;
    let session_id = snapshot.session_id.clone();
    let generation = snapshot.generation;
    let watch_session = session_id.clone();
    if let Err(error) =
        state
            .supervisor
            .watch(window.label(), &session_id, generation, move |result| {
                handle_watched_session(
                    core,
                    watcher_window,
                    transport,
                    cache_for_watcher,
                    watch_session,
                    generation,
                    result,
                );
            })
    {
        let _ = state
            .supervisor
            .discard(window.label(), &session_id, generation);
        return Err(IpcError::with_code(None, map_supervisor_code(error.code)));
    }
    state.clear_selection();
    Ok((session_id, generation))
}

#[tauri::command]
pub fn select_annual_sources(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    if request.get("type").and_then(Value::as_str) != Some("select-annual-sources") {
        return Err(IpcError::invalid(Some(request_id)));
    }
    retry_startup_recovery(&window, state.inner()).map_err(|mut error| {
        error.request_id = Some(request_id.clone());
        error
    })?;
    let Some(paths) = crate::desktop_selection::choose_sources(
        &window,
        crate::desktop_selection::SourceRole::Annual,
    )
    .map_err(|error| {
        IpcError::with_code(Some(request_id.clone()), selection_failure_code(error))
    })?
    else {
        return Ok(command_ack(request_id));
    };
    let summary = state
        .replace_selection(crate::desktop_selection::SourceRole::Annual, paths)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    state
        .publish_selection_ready(&window, &summary)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn select_verification_sources(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    if request.get("type").and_then(Value::as_str) != Some("select-verification-sources") {
        return Err(IpcError::invalid(Some(request_id)));
    }
    retry_startup_recovery(&window, state.inner()).map_err(|mut error| {
        error.request_id = Some(request_id.clone());
        error
    })?;
    let Some(paths) = crate::desktop_selection::choose_sources(
        &window,
        crate::desktop_selection::SourceRole::Verification,
    )
    .map_err(|error| {
        IpcError::with_code(Some(request_id.clone()), selection_failure_code(error))
    })?
    else {
        return Ok(command_ack(request_id));
    };
    let summary = state
        .replace_selection(crate::desktop_selection::SourceRole::Verification, paths)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    state
        .publish_selection_ready(&window, &summary)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn start_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    let selection_id = request
        .get("selectionId")
        .and_then(Value::as_str)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    start_session(&window, state.inner(), selection_id).map_err(|mut error| {
        if error.request_id.is_none() {
            error.request_id = Some(request_id.clone());
        }
        error
    })?;
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn cancel_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    let session_id = request
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let generation = request
        .get("generation")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    state
        .validate_owned_session(window.label(), session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    let cancelled = state
        .supervisor
        .cancel(
            window.label(),
            session_id,
            generation,
            crate::session_supervisor::CancelReason::User,
        )
        .map_err(|error| {
            IpcError::with_code(Some(request_id.clone()), map_supervisor_code(error.code))
        })?;
    if cancelled.terminal.is_none() {
        let _ = state.publish_state(&window, "cancelling");
    }
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn retry_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    let session_id = request
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let generation = request
        .get("generation")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    state
        .validate_owned_session(window.label(), session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    let resolution = resolve_sidecar(&window)?;
    let snapshot = state
        .supervisor
        .retry(window.label(), session_id, generation, resolution)
        .map_err(|error| {
            IpcError::with_code(Some(request_id.clone()), map_supervisor_code(error.code))
        })?;
    if let Err(code) =
        state.replace_registered_session(window.label(), &snapshot.session_id, snapshot.generation)
    {
        let _ = state
            .supervisor
            .discard(window.label(), &snapshot.session_id, snapshot.generation);
        return Err(IpcError::with_code(Some(request_id.clone()), code));
    }
    if let Err(code) = state
        .publish_state(&window, "ready")
        .and_then(|_| state.publish_state(&window, "preprocessing"))
    {
        let _ = state
            .supervisor
            .discard(window.label(), &snapshot.session_id, snapshot.generation);
        return Err(IpcError::with_code(Some(request_id.clone()), code));
    }
    let core = state.inner().clone();
    let watcher_window = window.clone();
    let transport = window
        .app_handle()
        .state::<crate::dataset_transport::DatasetTransportState>()
        .inner()
        .clone();
    let cache_root = app_cache_paths(&window)?.0;
    let new_session_id = snapshot.session_id.clone();
    let new_generation = snapshot.generation;
    let watch_session_arg = new_session_id.clone();
    let watched_session_id = new_session_id.clone();
    if let Err(error) = state.supervisor.watch(
        window.label(),
        &watch_session_arg,
        new_generation,
        move |result| {
            handle_watched_session(
                core,
                watcher_window,
                transport,
                cache_root,
                watched_session_id,
                new_generation,
                result,
            );
        },
    ) {
        let _ = state
            .supervisor
            .discard(window.label(), &new_session_id, new_generation);
        return Err(IpcError::with_code(
            Some(request_id.clone()),
            map_supervisor_code(error.code),
        ));
    }
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn discard_session(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    let session_id = request
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let generation = request
        .get("generation")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    state
        .validate_owned_session(window.label(), session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    if let Some(active) = state.supervisor.active_snapshot() {
        if active.session_id == session_id
            && active.generation == generation
            && active.terminal.is_none()
            && active.state != crate::session_supervisor::SessionState::Closing
        {
            state
                .supervisor
                .cancel(
                    window.label(),
                    session_id,
                    generation,
                    crate::session_supervisor::CancelReason::Replacement,
                )
                .map_err(|error| {
                    IpcError::with_code(Some(request_id.clone()), map_supervisor_code(error.code))
                })?;
            let _ = state.publish_state(&window, "cancelling");
            return Ok(command_ack(request_id));
        }
    }
    let snapshot = state
        .supervisor
        .discard(window.label(), session_id, generation)
        .map_err(|error| {
            IpcError::with_code(Some(request_id.clone()), map_supervisor_code(error.code))
        })?;
    window
        .app_handle()
        .state::<crate::dataset_transport::DatasetTransportState>()
        .close_session(window.label(), session_id, generation);
    let cleanup_already_published = state
        .registry
        .lock()
        .ok()
        .and_then(|registry| {
            registry
                .active
                .as_ref()
                .and_then(|active| active.cleanup_status.clone())
        })
        .is_some();
    if !cleanup_already_published {
        publish_snapshot_cleanup(state.inner(), &window, &snapshot);
    }
    let _ = state.publish_closed(
        &window,
        if matches!(
            snapshot.cleanup,
            Some(crate::session_supervisor::CleanupStatus::Complete { .. })
        ) {
            "complete"
        } else {
            "cleanup-required"
        },
    );
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn export_aggregate(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    let session_id = request
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let generation = request
        .get("generation")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    state
        .validate_owned_session(window.label(), session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    Err(IpcError::contract_only(Some(request_id)))
}

#[tauri::command]
pub fn request_application_close(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    if request.get("decision").and_then(Value::as_str) == Some("cancel-and-close") {
        if let Some(snapshot) = state.supervisor.active_snapshot() {
            if snapshot.terminal.is_none()
                && snapshot.state != crate::session_supervisor::SessionState::Closing
            {
                state
                    .supervisor
                    .cancel(
                        window.label(),
                        &snapshot.session_id,
                        snapshot.generation,
                        crate::session_supervisor::CancelReason::ApplicationClose,
                    )
                    .map_err(|error| {
                        IpcError::with_code(
                            Some(request_id.clone()),
                            map_supervisor_code(error.code),
                        )
                    })?;
                let _ = state.publish_state(&window, "cancelling");
            } else if let Ok(cleaned) =
                state
                    .supervisor
                    .close(window.label(), &snapshot.session_id, snapshot.generation)
            {
                window
                    .app_handle()
                    .state::<crate::dataset_transport::DatasetTransportState>()
                    .close_session(window.label(), &snapshot.session_id, snapshot.generation);
                publish_snapshot_cleanup(state.inner(), &window, &cleaned);
                let _ = state.publish_closed(
                    &window,
                    if matches!(
                        cleaned.cleanup,
                        Some(crate::session_supervisor::CleanupStatus::Complete { .. })
                    ) {
                        "complete"
                    } else {
                        "cleanup-required"
                    },
                );
            }
        }
    }
    Ok(command_ack(request_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Deserialize)]
    struct CommandVector {
        value: Value,
    }

    #[derive(Debug, Deserialize)]
    struct EventVector {
        value: Value,
    }

    #[derive(Debug, Deserialize)]
    struct Vectors {
        commands: Vec<CommandVector>,
        events: Vec<EventVector>,
        #[serde(rename = "invalidCommands")]
        invalid_commands: Vec<CommandVector>,
        #[serde(rename = "invalidEvents")]
        invalid_events: Vec<EventVector>,
    }

    fn vectors() -> Vectors {
        serde_json::from_str(include_str!("../../contracts/desktop-ipc-v1.vectors.json"))
            .expect("valid shared vectors")
    }

    #[test]
    fn shared_vectors_validate_with_rust_schema_in_both_directions() {
        let vectors = vectors();
        assert!(!vectors.commands.is_empty());
        assert!(!vectors.events.is_empty());
        for command in vectors.commands {
            assert!(validate_command(&command.value).is_ok());
        }
        for event in vectors.events {
            assert!(validate_event(&event.value).is_ok());
        }
        for command in vectors.invalid_commands {
            assert!(validate_command(&command.value).is_err());
        }
        for event in vectors.invalid_events {
            assert!(validate_event(&event.value).is_err());
        }
    }

    #[test]
    fn unsafe_integer_unknown_fields_and_invalid_transitions_are_rejected() {
        let unknown = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "select-annual-sources",
            "requestId": "req_00000000000000000000000000000001",
            "path": "synthetic"
        });
        assert!(validate_command(&unknown).is_err());
        let unsafe_generation = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "cancel-analysis",
            "requestId": "req_00000000000000000000000000000004",
            "sessionId": "ses_00000000000000000000000000000001",
            "generation": 9007199254740992u64
        });
        assert!(validate_command(&unsafe_generation).is_err());
        assert!(!valid_state_transition("closing", "idle"));
        assert!(!valid_state_transition("complete", "analyzing"));
        assert!(valid_state_transition("ready", "preprocessing"));
    }

    #[test]
    fn core_state_binds_window_session_generation_and_terminal_cleanup_order() {
        let state = IpcCoreState::default();
        let session = "ses_00000000000000000000000000000001";
        state.register_session("main", session, 1).unwrap();
        assert_eq!(
            state.validate_owned_session("other", session, 1),
            Err(FailureCode::WindowNotAuthorized)
        );
        assert_eq!(
            state.validate_owned_session("main", session, 2),
            Err(FailureCode::StaleGeneration)
        );
        assert_eq!(
            state.validate_owned_session("main", "ses_00000000000000000000000000000002", 1),
            Err(FailureCode::InvalidSession)
        );

        let event = |sequence: u64, event_type: &str, payload: Value| {
            serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "sessionId": session,
                "generation": 1,
                "sequence": sequence,
                "type": event_type,
                "payload": payload,
            })
        };
        state
            .accept_event(
                "main",
                &event(1, "state", serde_json::json!({"state":"preprocessing"})),
            )
            .unwrap();
        state
            .accept_event(
                "main",
                &event(2, "state", serde_json::json!({"state":"handoff"})),
            )
            .unwrap();
        state
            .accept_event(
                "main",
                &event(3, "state", serde_json::json!({"state":"analyzing"})),
            )
            .unwrap();
        state
            .accept_event(
                "main",
                &event(4, "state", serde_json::json!({"state":"complete"})),
            )
            .unwrap();
        assert_eq!(
            state.accept_event(
                "main",
                &event(5, "progress", serde_json::json!({"phase":"aggregation","completed":1,"total":1,"percentage":100}))
            ),
            Err(FailureCode::StaleEvent)
        );
        state
            .accept_event(
                "main",
                &event(
                    5,
                    "cleanup",
                    serde_json::json!({"status":"complete","removedEntryCount":2}),
                ),
            )
            .unwrap();
        assert_eq!(
            state.accept_event(
                "main",
                &event(7, "closed", serde_json::json!({"status":"complete"}))
            ),
            Err(FailureCode::InvalidState)
        );
        state
            .accept_event(
                "main",
                &event(6, "closed", serde_json::json!({"status":"complete"})),
            )
            .unwrap();
        assert!(state.snapshot().is_none());
    }

    #[test]
    fn failure_and_cancelled_are_first_terminal_outcomes() {
        let event = |session: &str, sequence: u64, event_type: &str, payload: Value| {
            serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "sessionId": session,
                "generation": 1,
                "sequence": sequence,
                "type": event_type,
                "payload": payload,
            })
        };

        let failure_state = IpcCoreState::default();
        let failure_session = "ses_00000000000000000000000000000001";
        failure_state
            .register_session("main", failure_session, 1)
            .unwrap();
        failure_state
            .accept_event(
                "main",
                &event(
                    failure_session,
                    1,
                    "failure",
                    serde_json::json!({
                        "code": "WORKER_RUNTIME_FAILED",
                        "retryable": false
                    }),
                ),
            )
            .unwrap();
        assert_eq!(
            failure_state.accept_event(
                "main",
                &event(
                    failure_session,
                    2,
                    "cancelled",
                    serde_json::json!({"reason":"user"}),
                ),
            ),
            Err(FailureCode::StaleEvent)
        );

        let cancelled_state = IpcCoreState::default();
        let cancelled_session = "ses_00000000000000000000000000000002";
        cancelled_state
            .register_session("main", cancelled_session, 1)
            .unwrap();
        cancelled_state
            .accept_event(
                "main",
                &event(
                    cancelled_session,
                    1,
                    "cancelled",
                    serde_json::json!({"reason":"replacement"}),
                ),
            )
            .unwrap();
        assert_eq!(
            cancelled_state.accept_event(
                "main",
                &event(
                    cancelled_session,
                    2,
                    "failure",
                    serde_json::json!({
                        "code": "CLEANUP_REQUIRED",
                        "retryable": true
                    }),
                ),
            ),
            Err(FailureCode::StaleEvent)
        );
    }

    #[test]
    fn terminal_races_allow_only_cleanup_then_closed() {
        let make_event = |session: &str, sequence: u64, event_type: &str, payload: Value| {
            serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "sessionId": session,
                "generation": 1,
                "sequence": sequence,
                "type": event_type,
                "payload": payload,
            })
        };

        let completed = IpcCoreState::default();
        let complete_session = "ses_00000000000000000000000000000003";
        completed
            .register_session("main", complete_session, 1)
            .unwrap();
        for (sequence, state_name) in [
            (1, "preprocessing"),
            (2, "handoff"),
            (3, "analyzing"),
            (4, "complete"),
        ] {
            completed
                .accept_event(
                    "main",
                    &make_event(
                        complete_session,
                        sequence,
                        "state",
                        serde_json::json!({"state": state_name}),
                    ),
                )
                .unwrap();
        }
        assert_eq!(
            completed.accept_event(
                "main",
                &make_event(
                    complete_session,
                    5,
                    "cancelled",
                    serde_json::json!({"reason":"replacement"}),
                ),
            ),
            Err(FailureCode::StaleEvent)
        );
        completed
            .accept_event(
                "main",
                &make_event(
                    complete_session,
                    5,
                    "cleanup",
                    serde_json::json!({"status":"complete","removedEntryCount":1}),
                ),
            )
            .unwrap();
        assert_eq!(
            completed.accept_event(
                "main",
                &make_event(
                    complete_session,
                    6,
                    "cleanup",
                    serde_json::json!({"status":"complete","removedEntryCount":1}),
                ),
            ),
            Err(FailureCode::InvalidState)
        );
        completed
            .accept_event(
                "main",
                &make_event(
                    complete_session,
                    6,
                    "closed",
                    serde_json::json!({"status":"complete"}),
                ),
            )
            .unwrap();
        assert_eq!(
            completed.accept_event(
                "main",
                &make_event(
                    complete_session,
                    7,
                    "closed",
                    serde_json::json!({"status":"complete"}),
                ),
            ),
            Err(FailureCode::InvalidSession)
        );

        let cancelled = IpcCoreState::default();
        let cancelled_session = "ses_00000000000000000000000000000004";
        cancelled
            .register_session("main", cancelled_session, 1)
            .unwrap();
        cancelled
            .accept_event(
                "main",
                &make_event(
                    cancelled_session,
                    1,
                    "cancelled",
                    serde_json::json!({"reason":"user"}),
                ),
            )
            .unwrap();
        assert_eq!(
            cancelled.accept_event(
                "main",
                &make_event(
                    cancelled_session,
                    2,
                    "state",
                    serde_json::json!({"state":"complete"}),
                ),
            ),
            Err(FailureCode::StaleEvent)
        );
        cancelled
            .accept_event(
                "main",
                &make_event(
                    cancelled_session,
                    2,
                    "cleanup",
                    serde_json::json!({"status":"required","removedEntryCount":2}),
                ),
            )
            .unwrap();
        cancelled
            .accept_event(
                "main",
                &make_event(
                    cancelled_session,
                    3,
                    "closed",
                    serde_json::json!({"status":"cleanup-required"}),
                ),
            )
            .unwrap();
    }

    #[test]
    fn lifecycle_events_require_session_correlation() {
        let sessionless_progress = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "sessionId": null,
            "generation": 0,
            "sequence": 1,
            "type": "progress",
            "payload": {"phase":"preprocessing","completed":0,"total":1,"percentage":0}
        });
        assert!(validate_event(&sessionless_progress).is_err());
        let selection_ready = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "sessionId": null,
            "generation": 0,
            "sequence": 1,
            "type": "selection-ready",
            "payload": {
                "selectionId": "sel_00000000000000000000000000000001",
                "annualSourceCount": 1,
                "verificationSourceCount": 0
            }
        });
        assert!(validate_event(&selection_ready).is_ok());
        assert_eq!(
            IpcCoreState::default().accept_event("main", &selection_ready),
            Ok(())
        );
    }

    #[test]
    fn active_generation_and_terminal_race_vectors_fail_closed() {
        let session = "ses_00000000000000000000000000000005";
        let make_event = |generation: u64, sequence: u64, event_type: &str, payload: Value| {
            serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "sessionId": session,
                "generation": generation,
                "sequence": sequence,
                "type": event_type,
                "payload": payload,
            })
        };

        let state = IpcCoreState::default();
        state.register_session("main", session, 1).unwrap();
        assert_eq!(
            state.accept_event(
                "main",
                &make_event(
                    2,
                    2,
                    "progress",
                    serde_json::json!({"phase":"preprocessing","completed":1,"total":2,"percentage":50}),
                ),
            ),
            Err(FailureCode::StaleGeneration)
        );
        assert_eq!(
            state.accept_event(
                "main",
                &make_event(
                    1,
                    3,
                    "progress",
                    serde_json::json!({"phase":"preprocessing","completed":1,"total":2,"percentage":50}),
                ),
            ),
            Err(FailureCode::InvalidState)
        );

        let sessionless = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "sessionId": null,
            "generation": 0,
            "sequence": 2,
            "type": "progress",
            "payload": {"phase":"preprocessing","completed":1,"total":2,"percentage":50}
        });
        assert_eq!(
            state.accept_event("main", &sessionless),
            Err(FailureCode::InvalidRequest)
        );
        let unsupported = make_event(
            1,
            1,
            "progress",
            serde_json::json!({"phase":"preprocessing","completed":0,"total":1,"percentage":0}),
        );
        let mut unsupported = unsupported;
        unsupported["protocolVersion"] =
            Value::String("chat-history-analysis.desktop-ipc.v0".to_string());
        assert_eq!(
            state.accept_event("main", &unsupported),
            Err(FailureCode::InvalidRequest)
        );

        let terminal = IpcCoreState::default();
        terminal.register_session("main", session, 1).unwrap();
        for (sequence, state_name) in [
            (1, "preprocessing"),
            (2, "handoff"),
            (3, "analyzing"),
            (4, "complete"),
        ] {
            terminal
                .accept_event(
                    "main",
                    &make_event(
                        1,
                        sequence,
                        "state",
                        serde_json::json!({"state": state_name}),
                    ),
                )
                .unwrap();
        }
        assert_eq!(
            terminal.accept_event(
                "main",
                &make_event(1, 5, "state", serde_json::json!({"state":"complete"})),
            ),
            Err(FailureCode::StaleEvent)
        );
        assert_eq!(
            terminal.accept_event(
                "main",
                &make_event(
                    1,
                    5,
                    "progress",
                    serde_json::json!({"phase":"aggregation","completed":1,"total":1,"percentage":100}),
                ),
            ),
            Err(FailureCode::StaleEvent)
        );
        assert_eq!(
            terminal.accept_event(
                "main",
                &make_event(1, 5, "closed", serde_json::json!({"status":"complete"}),),
            ),
            Err(FailureCode::InvalidState)
        );

        let not_terminal = IpcCoreState::default();
        not_terminal.register_session("main", session, 1).unwrap();
        for (sequence, state_name) in [(1, "preprocessing"), (2, "handoff"), (3, "analyzing")] {
            not_terminal
                .accept_event(
                    "main",
                    &make_event(
                        1,
                        sequence,
                        "state",
                        serde_json::json!({"state": state_name}),
                    ),
                )
                .unwrap();
        }
        assert_eq!(
            not_terminal.accept_event(
                "main",
                &make_event(
                    1,
                    4,
                    "cleanup",
                    serde_json::json!({"status":"complete","removedEntryCount":1}),
                ),
            ),
            Err(FailureCode::InvalidState)
        );
    }
}
