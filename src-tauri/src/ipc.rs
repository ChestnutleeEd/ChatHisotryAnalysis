use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::Mutex;

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
            if payload.record_count == 0
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
    registry: Mutex<SessionRegistry>,
    supervisor: crate::session_supervisor::SessionSupervisor,
}

impl Default for IpcCoreState {
    fn default() -> Self {
        Self {
            registry: Mutex::new(SessionRegistry::default()),
            supervisor: crate::session_supervisor::SessionSupervisor::default(),
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

fn command_result(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, IpcCoreState>,
    value: Value,
    expected_type: &str,
) -> Result<CommandAck, IpcError> {
    if !trusted_main_window_label(window.label()) {
        return Err(IpcError::with_code(None, FailureCode::WindowNotAuthorized));
    }
    let request_id = validate_command(&value)?;
    if value.get("type").and_then(Value::as_str) != Some(expected_type) {
        return Err(IpcError::invalid(Some(request_id)));
    }
    if expected_type == "cancel-analysis"
        || expected_type == "retry-analysis"
        || expected_type == "discard-session"
        || expected_type == "export-aggregate"
    {
        let session_id = value
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
        let generation = value
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
        state
            .validate_owned_session(window.label(), session_id, generation)
            .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    }
    Err(IpcError::contract_only(Some(request_id)))
}

#[tauri::command]
pub fn select_annual_sources(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "select-annual-sources")
}

#[tauri::command]
pub fn select_verification_sources(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "select-verification-sources")
}

#[tauri::command]
pub fn start_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "start-analysis")
}

#[tauri::command]
pub fn cancel_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "cancel-analysis")
}

#[tauri::command]
pub fn retry_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "retry-analysis")
}

#[tauri::command]
pub fn discard_session(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "discard-session")
}

#[tauri::command]
pub fn export_aggregate(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "export-aggregate")
}

#[tauri::command]
pub fn request_application_close(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    command_result(&window, &state, request, "request-application-close")
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
