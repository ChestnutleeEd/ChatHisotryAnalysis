use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};

use crate::security::trusted_main_window_label;

pub const PROTOCOL_VERSION: &str = "chat-history-analysis.desktop-ipc.v1";
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const WORKER_CAPABILITY_PROTOCOL_VERSION: &str = "chat-history-analysis.worker-capability.v1";
pub const WORKER_QUERY_REQUEST_VERSION: &str = "chat-history-analysis.aggregate-query.v1";
pub const ANALYTICS_RESULT_CONTRACT_VERSION: &str = "chat-history-analysis.analytics-result.v3";
const WORKER_CAPABILITY_TTL_MILLIS: u64 = 5 * 60 * 1_000;
const MAX_STATUS_EVENTS: usize = 4_096;
const WORKER_QUERY_TIMEZONE: &str = crate::export_schema::TIMEZONE;
const WORKER_QUERY_METRIC_DEFINITIONS: [&str; 5] = [
    "chat-history-analysis.metric.population.v1",
    "chat-history-analysis.metric.time.utc-plus-8.v1",
    "chat-history-analysis.metric.tokens.jieba.v1",
    "chat-history-analysis.metric.keywords.log-odds.v1",
    "chat-history-analysis.metric.sessions.threshold.v1",
];

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
    SidecarSpawnFailed,
    SidecarStartFailed,
    SidecarHandshakeTimeout,
    PreprocessingStalled,
    SidecarProtocolMismatch,
    SidecarProtocolFailed,
    SidecarExited,
    SidecarExitedUnexpectedly,
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
    ExportBusy,
    ExportResultPending,
    ExportStaleResult,
    ExportSchemaInvalid,
    ExportLimitExceeded,
    ExportRenderFailed,
    ExportPermissionDenied,
    ExportDiskFull,
    ExportWriteFailed,
    ExportFlushFailed,
    ExportDurabilityUncertain,
    ExportRenameFailed,
    ExportCleanupRequired,
    ExportResultNotFound,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandAck {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisCommandAck {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub accepted: bool,
    pub outcome: &'static str,
    pub operation_id: String,
    pub session_id: String,
    pub generation: u64,
    pub initial_phase: &'static str,
    pub cancel_available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisHeartbeat {
    Inactive,
    Starting,
    Active,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisTerminal {
    Complete,
    Failure,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStatusAck {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub accepted: bool,
    pub registered: bool,
    pub operation_id: Option<String>,
    pub session_id: Option<String>,
    pub generation: u64,
    pub state: String,
    pub phase: String,
    pub progress: Option<ProgressPayload>,
    pub heartbeat: AnalysisHeartbeat,
    pub elapsed_bucket: String,
    pub cancel_available: bool,
    pub terminal: Option<AnalysisTerminal>,
    pub cleanup_status: Option<String>,
    pub events: Vec<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SelectionOutcome {
    Registered,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionCommandAck {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub accepted: bool,
    pub outcome: SelectionOutcome,
    pub selection: Option<crate::desktop_selection::SelectionSummary>,
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
struct CancelCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    #[serde(default)]
    operation_id: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    generation: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    operation_id: String,
    after_sequence: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerPrepareCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    session_id: String,
    generation: u64,
    query_key: String,
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
    #[serde(default)]
    chart_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AggregateResultCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    request_id: String,
    session_id: String,
    generation: u64,
    aggregate: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerOperationCapability {
    pub protocol_version: String,
    pub operation_id: String,
    pub nonce: String,
    pub window_id: String,
    pub session_id: String,
    pub generation: u64,
    pub dataset_id: String,
    pub query_key: String,
    pub analytics_contract_version: String,
    pub expires_at_millis: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerCommitCommand {
    protocol_version: String,
    #[serde(rename = "type")]
    command_type: String,
    capability: WorkerOperationCapability,
    aggregate: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkerOperationState {
    Ready,
    Committing,
}

#[derive(Debug, Clone)]
struct WorkerOperationRecord {
    capability: WorkerOperationCapability,
    state: WorkerOperationState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerCommitAck {
    pub protocol_version: &'static str,
    pub accepted: bool,
    pub result_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerPreparationAck {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub accepted: bool,
    pub capability: WorkerOperationCapability,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultCommitAck {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub accepted: bool,
    pub result_id: String,
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

fn validate_cancel(value: &Value) -> Result<CancelCommand, IpcError> {
    let legacy_keys = [
        "generation",
        "protocolVersion",
        "requestId",
        "sessionId",
        "type",
    ];
    let operation_keys = ["operationId", "protocolVersion", "requestId", "type"];
    let combined_keys = [
        "generation",
        "operationId",
        "protocolVersion",
        "requestId",
        "sessionId",
        "type",
    ];
    if !(exact_keys(value, &legacy_keys)
        || exact_keys(value, &operation_keys)
        || exact_keys(value, &combined_keys))
        || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: CancelCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != "cancel-analysis"
        || !valid_id(&command.request_id, "req_")
        || command.operation_id.is_none() && command.session_id.is_none()
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    if let Some(operation_id) = command.operation_id.as_deref() {
        if !valid_id(operation_id, "op_") {
            return Err(IpcError::invalid(Some(command.request_id)));
        }
    }
    if let Some(session_id) = command.session_id.as_deref() {
        if !valid_id(session_id, "ses_") {
            return Err(IpcError::invalid(Some(command.request_id)));
        }
    }
    if let Some(generation) = command.generation {
        if generation == 0 || generation > MAX_SAFE_INTEGER {
            return Err(IpcError::invalid(Some(command.request_id)));
        }
    }
    if command.operation_id.is_none()
        && (command.session_id.is_none() || command.generation.is_none())
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_status(value: &Value) -> Result<StatusCommand, IpcError> {
    if !exact_keys(
        value,
        &[
            "afterSequence",
            "operationId",
            "protocolVersion",
            "requestId",
            "type",
        ],
    ) || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: StatusCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != "get-analysis-status"
        || !valid_id(&command.request_id, "req_")
        || !valid_id(&command.operation_id, "op_")
        || command.after_sequence > MAX_SAFE_INTEGER
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_worker_prepare(value: &Value) -> Result<WorkerPrepareCommand, IpcError> {
    if !exact_keys(
        value,
        &[
            "generation",
            "protocolVersion",
            "queryKey",
            "requestId",
            "sessionId",
            "type",
        ],
    ) || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: WorkerPrepareCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != "prepare-aggregate-result"
        || !valid_id(&command.request_id, "req_")
        || !valid_id(&command.session_id, "ses_")
        || command.generation == 0
        || command.generation > MAX_SAFE_INTEGER
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    let Some(dataset_id) = serde_json::from_str::<Value>(&command.query_key)
        .ok()
        .and_then(|value| {
            value
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
    else {
        return Err(IpcError::invalid(Some(command.request_id)));
    };
    if parse_worker_query_key(&command.query_key, &dataset_id, command.generation).is_err() {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_export(value: &Value) -> Result<ExportCommand, IpcError> {
    let legacy_keys = [
        "generation",
        "protocolVersion",
        "reportFormat",
        "requestId",
        "resultId",
        "sessionId",
        "type",
    ];
    let production_keys = [
        "chartKey",
        "generation",
        "protocolVersion",
        "reportFormat",
        "requestId",
        "resultId",
        "sessionId",
        "type",
    ];
    if !(exact_keys(value, &legacy_keys) || exact_keys(value, &production_keys))
        || !all_json_integers_are_safe(value)
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
        || command.chart_key.as_deref().is_some_and(|chart_key| {
            crate::export_schema::ApprovedChartKey::parse(chart_key).is_none()
        })
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    Ok(command)
}

fn validate_aggregate_result(
    value: &Value,
) -> Result<
    (
        AggregateResultCommand,
        crate::export_schema::RendererAggregateInput,
    ),
    IpcError,
> {
    let expected_keys = [
        "generation",
        "protocolVersion",
        "requestId",
        "sessionId",
        "aggregate",
        "type",
    ];
    if !exact_keys(value, &expected_keys) || !all_json_integers_are_safe(value) {
        return Err(IpcError::invalid(string_field(value, "requestId")));
    }
    let command: AggregateResultCommand = parse(value)?;
    valid_protocol(&command.protocol_version)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    if command.command_type != "commit-aggregate-result"
        || !valid_id(&command.request_id, "req_")
        || !valid_id(&command.session_id, "ses_")
        || command.generation == 0
        || command.generation > MAX_SAFE_INTEGER
    {
        return Err(IpcError::invalid(Some(command.request_id)));
    }
    let aggregate = serde_json::from_value::<crate::export_schema::RendererAggregateInput>(
        command.aggregate.clone(),
    )
    .map_err(|_| {
        IpcError::with_code(
            Some(command.request_id.clone()),
            FailureCode::ExportSchemaInvalid,
        )
    })?;
    Ok((command, aggregate))
}

fn validate_worker_commit(
    value: &Value,
) -> Result<
    (
        WorkerCommitCommand,
        crate::export_schema::RendererAggregateInput,
    ),
    IpcError,
> {
    if !exact_keys(
        value,
        &["aggregate", "capability", "protocolVersion", "type"],
    ) || !all_json_integers_are_safe(value)
    {
        return Err(IpcError::invalid(None));
    }
    let command: WorkerCommitCommand = parse(value)?;
    if command.protocol_version != WORKER_CAPABILITY_PROTOCOL_VERSION
        || command.command_type != "commit-worker-result"
    {
        return Err(IpcError::invalid(None));
    }
    validate_worker_capability(&command.capability, &command.capability.window_id)
        .map_err(|code| IpcError::with_code(None, code))?;
    let aggregate = serde_json::from_value::<crate::export_schema::RendererAggregateInput>(
        command.aggregate.clone(),
    )
    .map_err(|_| IpcError::with_code(None, FailureCode::ExportSchemaInvalid))?;
    Ok((command, aggregate))
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
        "cancel-analysis" => validate_cancel(value).map(|command| command.request_id),
        "retry-analysis" | "discard-session" | "acknowledge-worker-stop" => {
            validate_session(value, &command_type).map(|command| command.request_id)
        }
        "get-analysis-status" => validate_status(value).map(|command| command.request_id),
        "export-aggregate" => validate_export(value).map(|command| command.request_id),
        "commit-aggregate-result" => {
            validate_aggregate_result(value).map(|(command, _)| command.request_id)
        }
        "prepare-aggregate-result" => {
            validate_worker_prepare(value).map(|command| command.request_id)
        }
        "cancel-aggregate-result" => {
            validate_session(value, &command_type).map(|command| command.request_id)
        }
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
            | "SIDECAR_SPAWN_FAILED"
            | "SIDECAR_START_FAILED"
            | "SIDECAR_HANDSHAKE_TIMEOUT"
            | "PREPROCESSING_STALLED"
            | "SIDECAR_PROTOCOL_MISMATCH"
            | "SIDECAR_PROTOCOL_FAILED"
            | "SIDECAR_EXITED"
            | "SIDECAR_EXITED_UNEXPECTEDLY"
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
            | "EXPORT_BUSY"
            | "EXPORT_RESULT_PENDING"
            | "EXPORT_STALE_RESULT"
            | "EXPORT_SCHEMA_INVALID"
            | "EXPORT_LIMIT_EXCEEDED"
            | "EXPORT_RENDER_FAILED"
            | "EXPORT_PERMISSION_DENIED"
            | "EXPORT_DISK_FULL"
            | "EXPORT_WRITE_FAILED"
            | "EXPORT_FLUSH_FAILED"
            | "EXPORT_DURABILITY_UNCERTAIN"
            | "EXPORT_RENAME_FAILED"
            | "EXPORT_CLEANUP_REQUIRED"
            | "EXPORT_RESULT_NOT_FOUND"
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

#[derive(Debug, Clone, PartialEq)]
pub struct SessionRecord {
    pub window_label: String,
    pub operation_id: String,
    pub session_id: String,
    pub generation: u64,
    pub expected_sequence: u64,
    pub state: String,
    pub terminal_outcome: Option<TerminalOutcome>,
    pub cleanup_status: Option<String>,
    pub closed: bool,
    pub started_at_millis: u64,
    pub last_progress: Option<ProgressPayload>,
    pub heartbeat_seen: bool,
    pub events: Vec<Value>,
}

impl SessionRecord {
    fn new_with_operation(
        window_label: &str,
        operation_id: &str,
        session_id: &str,
        generation: u64,
    ) -> Self {
        Self {
            window_label: window_label.to_string(),
            operation_id: operation_id.to_string(),
            session_id: session_id.to_string(),
            generation,
            expected_sequence: 1,
            state: "ready".to_string(),
            terminal_outcome: None,
            cleanup_status: None,
            closed: false,
            started_at_millis: now_unix_millis(),
            last_progress: None,
            heartbeat_seen: false,
            events: Vec::with_capacity(8),
        }
    }
}

#[derive(Debug, Default)]
struct SessionRegistry {
    active: Option<SessionRecord>,
    retained: Option<SessionRecord>,
}

struct RendererWorkerLease {
    window: tauri::WebviewWindow,
    session_id: String,
    generation: u64,
    dataset_id: String,
    query_key: String,
    cancellation_sent: AtomicBool,
    stop_acknowledged: Arc<(Mutex<bool>, Condvar)>,
}

impl RendererWorkerLease {
    fn emit_control(&self, kind: &'static str) {
        let _ = self.window.emit(
            "desktop-worker-control",
            serde_json::json!({
                "kind": kind,
                "sessionId": self.session_id,
                "generation": self.generation,
                "datasetId": self.dataset_id,
                "queryKey": self.query_key,
            }),
        );
    }
}

impl crate::session_supervisor::WorkerTermination for RendererWorkerLease {
    fn request_cancellation(&self) {
        if !self.cancellation_sent.swap(true, Ordering::AcqRel) {
            self.emit_control("cancel");
        }
    }

    fn force_terminate(&self) {
        self.emit_control("force-terminate");
    }

    fn wait_for_termination(&self, timeout: std::time::Duration) -> bool {
        let Ok(acknowledged) = self.stop_acknowledged.0.lock() else {
            return false;
        };
        if *acknowledged {
            return true;
        }
        let Ok((acknowledged, _)) = self.stop_acknowledged.1.wait_timeout(acknowledged, timeout)
        else {
            return false;
        };
        *acknowledged
    }

    fn acknowledge_termination(&self) {
        if let Ok(mut acknowledged) = self.stop_acknowledged.0.lock() {
            *acknowledged = true;
            self.stop_acknowledged.1.notify_all();
        }
    }
}

#[derive(Debug)]
pub struct IpcCoreState {
    registry: Arc<Mutex<SessionRegistry>>,
    selection: Arc<Mutex<crate::desktop_selection::SelectionRegistry>>,
    result_registry: crate::analytics_results::ResultRegistry,
    privacy_logger: crate::privacy_log::PrivacyLogger,
    session_correlation: Arc<Mutex<Option<crate::privacy_log::CorrelationId>>>,
    supervisor: crate::session_supervisor::SessionSupervisor,
    worker_operations: Arc<Mutex<HashMap<String, WorkerOperationRecord>>>,
    startup_cleanup_required: Arc<AtomicBool>,
    close_started: Arc<AtomicBool>,
}

impl Default for IpcCoreState {
    fn default() -> Self {
        Self {
            registry: Arc::new(Mutex::new(SessionRegistry::default())),
            selection: Arc::new(Mutex::new(
                crate::desktop_selection::SelectionRegistry::default(),
            )),
            result_registry: crate::analytics_results::ResultRegistry::default(),
            privacy_logger: crate::privacy_log::PrivacyLogger::default(),
            session_correlation: Arc::new(Mutex::new(None)),
            supervisor: crate::session_supervisor::SessionSupervisor::default(),
            worker_operations: Arc::new(Mutex::new(HashMap::new())),
            startup_cleanup_required: Arc::new(AtomicBool::new(false)),
            close_started: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Clone for IpcCoreState {
    fn clone(&self) -> Self {
        Self {
            registry: Arc::clone(&self.registry),
            selection: Arc::clone(&self.selection),
            result_registry: self.result_registry.clone(),
            privacy_logger: self.privacy_logger.clone(),
            session_correlation: Arc::clone(&self.session_correlation),
            supervisor: self.supervisor.clone(),
            worker_operations: Arc::clone(&self.worker_operations),
            startup_cleanup_required: Arc::clone(&self.startup_cleanup_required),
            close_started: Arc::clone(&self.close_started),
        }
    }
}

impl IpcCoreState {
    fn record_log(
        &self,
        code: crate::privacy_log::LogCode,
        phase: crate::privacy_log::LogPhase,
        state: crate::privacy_log::LogState,
        aggregate_count: u64,
        cleanup_status: Option<crate::privacy_log::CleanupStatus>,
    ) {
        let correlation_id = self
            .session_correlation
            .lock()
            .ok()
            .and_then(|correlation| correlation.clone())
            .or_else(crate::privacy_log::CorrelationId::random);
        let Some(correlation_id) = correlation_id else {
            return;
        };
        let mut event =
            crate::privacy_log::PrivacyLogEvent::new(code, phase, state, correlation_id);
        event.aggregate_count = aggregate_count.min(crate::privacy_log::MAX_LOG_AGGREGATE_COUNT);
        event.cleanup_status = cleanup_status;
        let _ = self.privacy_logger.record(event);
    }

    pub fn session_supervisor(&self) -> &crate::session_supervisor::SessionSupervisor {
        &self.supervisor
    }

    fn invalidate_worker_operations_for(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) {
        if let Ok(mut operations) = self.worker_operations.lock() {
            operations.retain(|_, record| {
                !(record.capability.window_id == window_label
                    && record.capability.session_id == session_id
                    && record.capability.generation == generation)
            });
        }
    }

    fn invalidate_all_worker_operations(&self) {
        if let Ok(mut operations) = self.worker_operations.lock() {
            operations.clear();
        }
    }

    pub fn renderer_disconnected(&self, window_label: &str) {
        let active = self
            .registry
            .lock()
            .ok()
            .and_then(|registry| registry.active.clone());
        if let Some(active) = active.filter(|active| active.window_label == window_label) {
            self.clear_result(&active.window_label, &active.session_id, active.generation);
        } else if let Ok(mut operations) = self.worker_operations.lock() {
            operations.retain(|_, record| record.capability.window_id != window_label);
        }
        if let Ok(mut correlation) = self.session_correlation.lock() {
            *correlation = None;
        }
        self.supervisor.renderer_disconnected(window_label);
    }

    pub fn shutdown(&self) {
        self.invalidate_all_worker_operations();
        self.result_registry.clear_all();
        if let Ok(mut correlation) = self.session_correlation.lock() {
            *correlation = None;
        }
        self.supervisor.shutdown();
    }

    /// CloseRequested/ExitRequested both use this host gate.  It fences
    /// exports, asks the real Worker lease to cancel, stops the sidecar, and
    /// only returns true once the session registry is empty.
    pub fn prepare_application_close(&self) -> bool {
        if self.close_started.swap(true, Ordering::AcqRel) {
            return true;
        }
        self.invalidate_all_worker_operations();
        self.result_registry.clear_all();
        self.supervisor.shutdown();
        if self.supervisor.active_snapshot().is_none() {
            if let Ok(mut correlation) = self.session_correlation.lock() {
                *correlation = None;
            }
            true
        } else {
            self.close_started.store(false, Ordering::Release);
            false
        }
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

    #[allow(clippy::too_many_arguments)]
    pub fn commit_dataset_result(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        dataset_id: &str,
        record_count: u64,
        minimum_calendar_date: &str,
        maximum_calendar_date: &str,
    ) -> Result<(), FailureCode> {
        self.result_registry
            .register_context(
                crate::analytics_results::ResultKey::new(window_label, session_id, generation),
                crate::export_schema::DatasetExportContext {
                    dataset_id: dataset_id.to_string(),
                    record_count,
                    minimum_calendar_date: minimum_calendar_date.to_string(),
                    maximum_calendar_date: maximum_calendar_date.to_string(),
                },
            )
            .map_err(map_result_registry_code)
    }

    pub fn prepare_aggregate_result(
        &self,
        window: &tauri::WebviewWindow,
        window_label: &str,
        session_id: &str,
        generation: u64,
        query_key: &str,
    ) -> Result<WorkerOperationCapability, FailureCode> {
        self.validate_owned_session(window_label, session_id, generation)?;
        let key = crate::analytics_results::ResultKey::new(window_label, session_id, generation);
        let dataset_id = self
            .result_registry
            .dataset_id_for(&key)
            .ok_or(FailureCode::InvalidState)?;
        parse_worker_query_key(query_key, &dataset_id, generation)?;
        // A replacement operation invalidates every earlier bearer before the
        // new pending result is registered.  This closes the old-operation
        // commit race even when the previous Worker has not acknowledged yet.
        self.invalidate_worker_operations_for(window_label, session_id, generation);
        self.result_registry
            .begin_pending(key.clone())
            .map_err(map_result_registry_code)?;
        let operation_id = match crate::session_supervisor::new_worker_operation_id() {
            Ok(operation_id) => operation_id,
            Err(_) => {
                let _ = self.result_registry.cancel_pending(&key);
                return Err(FailureCode::WorkerRuntimeFailed);
            }
        };
        let nonce = match crate::session_supervisor::new_worker_nonce() {
            Ok(nonce) => nonce,
            Err(_) => {
                let _ = self.result_registry.cancel_pending(&key);
                return Err(FailureCode::WorkerRuntimeFailed);
            }
        };
        let expires_at_millis = now_unix_millis().saturating_add(WORKER_CAPABILITY_TTL_MILLIS);
        let capability = WorkerOperationCapability {
            protocol_version: WORKER_CAPABILITY_PROTOCOL_VERSION.to_string(),
            operation_id: operation_id.clone(),
            nonce,
            window_id: window_label.to_string(),
            session_id: session_id.to_string(),
            generation,
            dataset_id: dataset_id.clone(),
            query_key: query_key.to_string(),
            analytics_contract_version: ANALYTICS_RESULT_CONTRACT_VERSION.to_string(),
            expires_at_millis,
        };
        let worker = Arc::new(RendererWorkerLease {
            window: window.clone(),
            session_id: session_id.to_string(),
            generation,
            dataset_id,
            query_key: query_key.to_string(),
            cancellation_sent: AtomicBool::new(false),
            stop_acknowledged: Arc::new((Mutex::new(false), Condvar::new())),
        });
        if let Err(error) =
            self.supervisor
                .attach_worker(window_label, session_id, generation, worker)
        {
            let _ = self.result_registry.cancel_pending(&key);
            return Err(map_supervisor_code(error.code));
        }
        if let Ok(mut operations) = self.worker_operations.lock() {
            let now = now_unix_millis();
            operations.retain(|_, record| record.capability.expires_at_millis >= now);
            operations.insert(
                operation_id.clone(),
                WorkerOperationRecord {
                    capability: capability.clone(),
                    state: WorkerOperationState::Ready,
                },
            );
        } else {
            let _ = self
                .supervisor
                .detach_worker(window_label, session_id, generation);
            let _ = self.result_registry.cancel_pending(&key);
            return Err(FailureCode::InvalidState);
        }
        self.record_log(
            crate::privacy_log::LogCode::ExportStarted,
            crate::privacy_log::LogPhase::Export,
            crate::privacy_log::LogState::Running,
            0,
            None,
        );
        Ok(capability)
    }

    pub fn cancel_aggregate_result(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        self.validate_owned_session(window_label, session_id, generation)?;
        self.invalidate_worker_operations_for(window_label, session_id, generation);
        let result = self
            .result_registry
            .cancel_pending(&crate::analytics_results::ResultKey::new(
                window_label,
                session_id,
                generation,
            ))
            .map_err(map_result_registry_code);
        if result.is_ok() {
            let _ = self
                .supervisor
                .detach_worker(window_label, session_id, generation);
        }
        result
    }

    pub fn commit_worker_operation(
        &self,
        window_label: &str,
        capability: WorkerOperationCapability,
        aggregate: crate::export_schema::RendererAggregateInput,
    ) -> Result<String, FailureCode> {
        validate_worker_capability(&capability, window_label)?;
        self.validate_owned_session(window_label, &capability.session_id, capability.generation)?;
        let expected_query_key = canonical_worker_query_key(
            &capability.dataset_id,
            capability.generation,
            &aggregate.filters,
        )?;
        if capability.query_key != expected_query_key {
            return Err(FailureCode::WorkerRuntimeFailed);
        }
        let key = crate::analytics_results::ResultKey::new(
            window_label,
            &capability.session_id,
            capability.generation,
        );
        let mut operations = self
            .worker_operations
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        let Some(record) = operations.get(&capability.operation_id).cloned() else {
            return Err(FailureCode::WorkerRuntimeFailed);
        };
        if record.capability != capability || record.state != WorkerOperationState::Ready {
            return Err(FailureCode::WorkerRuntimeFailed);
        }
        if let Some(record) = operations.get_mut(&capability.operation_id) {
            record.state = WorkerOperationState::Committing;
        }
        let result_id = match self.result_registry.commit_pending(&key, aggregate) {
            Ok(result_id) => result_id,
            Err(error) => {
                operations.remove(&capability.operation_id);
                return Err(map_result_registry_code(error));
            }
        };
        operations.remove(&capability.operation_id);
        drop(operations);
        if let Err(error) = self.supervisor.worker_result_committed(
            window_label,
            &capability.session_id,
            capability.generation,
        ) {
            self.clear_result(window_label, &capability.session_id, capability.generation);
            return Err(map_supervisor_code(error.code));
        }
        Ok(result_id)
    }

    pub fn acknowledge_worker_stop(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        self.validate_owned_session(window_label, session_id, generation)?;
        self.supervisor
            .acknowledge_worker_stop(window_label, session_id, generation)
            .map_err(|error| map_supervisor_code(error.code))
    }

    pub fn commit_aggregate_result(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        aggregate: crate::export_schema::RendererAggregateInput,
    ) -> Result<String, FailureCode> {
        self.validate_owned_session(window_label, session_id, generation)?;
        self.result_registry
            .commit_pending(
                &crate::analytics_results::ResultKey::new(window_label, session_id, generation),
                aggregate,
            )
            .map_err(map_result_registry_code)
    }

    pub fn clear_result(&self, window_label: &str, session_id: &str, generation: u64) {
        self.invalidate_worker_operations_for(window_label, session_id, generation);
        self.result_registry
            .clear_session(window_label, session_id, generation);
    }

    pub fn result_registry(&self) -> &crate::analytics_results::ResultRegistry {
        &self.result_registry
    }

    pub fn replace_registered_session(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        let operation_id = if valid_id(session_id, "ses_") {
            format!("op_{}", &session_id[4..])
        } else {
            String::new()
        };
        self.replace_registered_session_with_operation(
            trusted_window_label,
            &operation_id,
            session_id,
            generation,
        )
    }

    pub fn replace_registered_session_with_operation(
        &self,
        trusted_window_label: &str,
        operation_id: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        if !trusted_main_window_label(trusted_window_label)
            || !valid_id(operation_id, "op_")
            || !valid_id(session_id, "ses_")
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return Err(FailureCode::WindowNotAuthorized);
        }
        let correlation =
            crate::privacy_log::CorrelationId::random().ok_or(FailureCode::InvalidState)?;
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        let previous = registry.active.replace(SessionRecord::new_with_operation(
            trusted_window_label,
            operation_id,
            session_id,
            generation,
        ));
        registry.retained = previous.clone().or_else(|| registry.retained.take());
        drop(registry);
        if let Some(previous) = previous {
            self.clear_result(
                &previous.window_label,
                &previous.session_id,
                previous.generation,
            );
        }
        *self
            .session_correlation
            .lock()
            .map_err(|_| FailureCode::InvalidState)? = Some(correlation);
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
        self.publish_failure_with_reason(window, code, retryable, None)
    }

    pub fn publish_failure_with_reason(
        &self,
        window: &tauri::WebviewWindow,
        code: FailureCode,
        retryable: bool,
        reason_code: Option<&str>,
    ) -> Result<(), FailureCode> {
        if matches!(
            code,
            FailureCode::ExportBusy
                | FailureCode::ExportResultPending
                | FailureCode::ExportStaleResult
                | FailureCode::ExportSchemaInvalid
                | FailureCode::ExportLimitExceeded
                | FailureCode::ExportRenderFailed
                | FailureCode::ExportPermissionDenied
                | FailureCode::ExportDiskFull
                | FailureCode::ExportWriteFailed
                | FailureCode::ExportFlushFailed
                | FailureCode::ExportDurabilityUncertain
                | FailureCode::ExportRenameFailed
                | FailureCode::ExportCleanupRequired
                | FailureCode::ExportResultNotFound
        ) {
            self.record_log(
                crate::privacy_log::LogCode::ExportFailed,
                crate::privacy_log::LogPhase::Export,
                crate::privacy_log::LogState::Failed,
                0,
                None,
            );
        }
        let mut payload = serde_json::json!({
            "code": code,
            "retryable": retryable,
        });
        if let Some(reason_code) = reason_code {
            if let Some(object) = payload.as_object_mut() {
                object.insert(
                    "reasonCode".to_string(),
                    serde_json::Value::String(reason_code.to_string()),
                );
            }
        }
        self.publish_session_value(window, "failure", payload)
    }

    pub fn publish_cancelled(
        &self,
        window: &tauri::WebviewWindow,
        reason: &str,
    ) -> Result<(), FailureCode> {
        self.record_log(
            crate::privacy_log::LogCode::SessionCancelled,
            crate::privacy_log::LogPhase::Cleanup,
            crate::privacy_log::LogState::Cancelling,
            0,
            None,
        );
        self.publish_session_value(window, "cancelled", serde_json::json!({ "reason": reason }))
    }

    pub fn publish_cleanup(
        &self,
        window: &tauri::WebviewWindow,
        status: &str,
        removed_entry_count: u64,
    ) -> Result<(), FailureCode> {
        let (code, cleanup_status) = if status == "complete" {
            (
                crate::privacy_log::LogCode::CleanupComplete,
                Some(crate::privacy_log::CleanupStatus::Complete),
            )
        } else {
            (
                crate::privacy_log::LogCode::CleanupRequired,
                Some(crate::privacy_log::CleanupStatus::Required),
            )
        };
        self.record_log(
            code,
            crate::privacy_log::LogPhase::Cleanup,
            if status == "complete" {
                crate::privacy_log::LogState::Complete
            } else {
                crate::privacy_log::LogState::Failed
            },
            removed_entry_count,
            cleanup_status,
        );
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

    pub fn publish_exported(
        &self,
        window: &tauri::WebviewWindow,
        result_id: &str,
        report_format: &str,
    ) -> Result<(), FailureCode> {
        self.record_log(
            crate::privacy_log::LogCode::ExportComplete,
            crate::privacy_log::LogPhase::Export,
            crate::privacy_log::LogState::Complete,
            1,
            None,
        );
        self.publish_session_value(
            window,
            "exported",
            serde_json::json!({
                "resultId": result_id,
                "reportFormat": report_format,
            }),
        )
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
        let operation_id = if valid_id(session_id, "ses_") {
            format!("op_{}", &session_id[4..])
        } else {
            String::new()
        };
        self.register_session_with_operation(
            trusted_window_label,
            &operation_id,
            session_id,
            generation,
        )
    }

    pub fn register_session_with_operation(
        &self,
        trusted_window_label: &str,
        operation_id: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        if !trusted_main_window_label(trusted_window_label)
            || !valid_id(operation_id, "op_")
            || !valid_id(session_id, "ses_")
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return Err(FailureCode::WindowNotAuthorized);
        }
        let correlation =
            crate::privacy_log::CorrelationId::random().ok_or(FailureCode::InvalidState)?;
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        if let Some(active) = registry.active.take() {
            if active.terminal_outcome.is_some() && active.cleanup_status.is_some() {
                registry.retained = Some(active);
            } else {
                registry.active = Some(active);
                return Err(FailureCode::SessionBusy);
            }
        }
        registry.active = Some(SessionRecord::new_with_operation(
            trusted_window_label,
            operation_id,
            session_id,
            generation,
        ));
        *self
            .session_correlation
            .lock()
            .map_err(|_| FailureCode::InvalidState)? = Some(correlation);
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

    /// Retry is allowed to address the terminal generation that is either
    /// still visible in the active record or already moved to the retained
    /// terminal record by the idempotent finalizer.
    pub fn validate_retry_session(
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
        let record = registry
            .active
            .as_ref()
            .filter(|record| {
                record.window_label == trusted_window_label
                    && record.session_id == session_id
                    && record.generation == generation
            })
            .or_else(|| {
                registry.retained.as_ref().filter(|record| {
                    record.window_label == trusted_window_label
                        && record.session_id == session_id
                        && record.generation == generation
                })
            })
            .ok_or(FailureCode::InvalidSession)?;
        if record.closed {
            return Err(FailureCode::InvalidSession);
        }
        if record.generation != generation {
            return Err(FailureCode::StaleGeneration);
        }
        if record.terminal_outcome != Some(TerminalOutcome::Failure) {
            return Err(FailureCode::InvalidState);
        }
        Ok(())
    }

    pub fn resolve_owned_operation(
        &self,
        trusted_window_label: &str,
        operation_id: &str,
    ) -> Result<(String, u64), FailureCode> {
        if !trusted_main_window_label(trusted_window_label) {
            return Err(FailureCode::WindowNotAuthorized);
        }
        if !valid_id(operation_id, "op_") {
            return Err(FailureCode::InvalidRequest);
        }
        let registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        let Some(active) = registry.active.as_ref() else {
            return Err(FailureCode::InvalidSession);
        };
        if active.window_label != trusted_window_label || active.operation_id != operation_id {
            return Err(FailureCode::InvalidSession);
        }
        if active.closed {
            return Err(FailureCode::InvalidSession);
        }
        Ok((active.session_id.clone(), active.generation))
    }

    pub fn analysis_status(
        &self,
        trusted_window_label: &str,
        request_id: String,
        operation_id: &str,
        after_sequence: u64,
    ) -> Result<AnalysisStatusAck, FailureCode> {
        if !trusted_main_window_label(trusted_window_label) {
            return Err(FailureCode::WindowNotAuthorized);
        }
        if !valid_id(operation_id, "op_") || after_sequence > MAX_SAFE_INTEGER {
            return Err(FailureCode::InvalidRequest);
        }
        let registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        let record = registry
            .active
            .as_ref()
            .filter(|record| {
                record.window_label == trusted_window_label && record.operation_id == operation_id
            })
            .or_else(|| {
                registry.retained.as_ref().filter(|record| {
                    record.window_label == trusted_window_label
                        && record.operation_id == operation_id
                })
            });
        let Some(record) = record else {
            return Ok(AnalysisStatusAck {
                protocol_version: PROTOCOL_VERSION,
                request_id,
                accepted: true,
                registered: false,
                operation_id: None,
                session_id: None,
                generation: 0,
                state: "idle".to_string(),
                phase: "selection".to_string(),
                progress: None,
                heartbeat: AnalysisHeartbeat::Inactive,
                elapsed_bucket: "<1s".to_string(),
                cancel_available: false,
                terminal: None,
                cleanup_status: None,
                events: Vec::new(),
            });
        };
        let elapsed = now_unix_millis().saturating_sub(record.started_at_millis);
        let phase = record
            .last_progress
            .as_ref()
            .map(|progress| progress.phase.clone())
            .unwrap_or_else(|| phase_for_state_name(&record.state).to_string());
        let heartbeat = if record.terminal_outcome.is_some() {
            AnalysisHeartbeat::Terminal
        } else if record.heartbeat_seen {
            AnalysisHeartbeat::Active
        } else {
            AnalysisHeartbeat::Starting
        };
        let events = record
            .events
            .iter()
            .filter(|event| {
                event
                    .get("sequence")
                    .and_then(Value::as_u64)
                    .is_some_and(|sequence| sequence > after_sequence)
            })
            .cloned()
            .collect();
        Ok(AnalysisStatusAck {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            accepted: true,
            registered: true,
            operation_id: Some(record.operation_id.clone()),
            session_id: Some(record.session_id.clone()),
            generation: record.generation,
            state: record.state.clone(),
            phase,
            progress: record.last_progress.clone(),
            heartbeat,
            elapsed_bucket: elapsed_bucket_from_millis(elapsed),
            cancel_available: record.terminal_outcome.is_none()
                && matches!(
                    record.state.as_str(),
                    "preprocessing" | "handoff" | "analyzing"
                ),
            terminal: record.terminal_outcome.map(|outcome| match outcome {
                TerminalOutcome::Complete => AnalysisTerminal::Complete,
                TerminalOutcome::Failure => AnalysisTerminal::Failure,
                TerminalOutcome::Cancelled => AnalysisTerminal::Cancelled,
            }),
            cleanup_status: record.cleanup_status.clone(),
            events,
        })
    }

    pub fn release_terminal_session(
        &self,
        trusted_window_label: &str,
        operation_id: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), FailureCode> {
        if !trusted_main_window_label(trusted_window_label) {
            return Err(FailureCode::WindowNotAuthorized);
        }
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| FailureCode::InvalidState)?;
        let should_release = registry.active.as_ref().is_some_and(|active| {
            active.window_label == trusted_window_label
                && active.operation_id == operation_id
                && active.session_id == session_id
                && active.generation == generation
                && active.terminal_outcome.is_some()
                && active.cleanup_status.is_some()
        });
        if should_release {
            registry.retained = registry.active.take();
        }
        Ok(())
    }

    /// Last-resort fence for a renderer-disconnect/error path where a
    /// terminal event cannot be emitted. It deliberately records cleanup as
    /// required so the generation is recoverable without keeping `active` as
    /// a permanent busy slot.
    pub fn force_release_failed_session(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) {
        if !trusted_main_window_label(trusted_window_label) {
            return;
        }
        let Ok(mut registry) = self.registry.lock() else {
            return;
        };
        let should_release = registry.active.as_ref().is_some_and(|active| {
            active.window_label == trusted_window_label
                && active.session_id == session_id
                && active.generation == generation
                && active.cleanup_status.is_none()
        });
        if should_release {
            if let Some(active) = registry.active.as_mut() {
                if active.terminal_outcome.is_none() {
                    active.state = "failed".to_string();
                    active.terminal_outcome = Some(TerminalOutcome::Failure);
                }
                active.cleanup_status = Some("required".to_string());
            }
            registry.retained = registry.active.take();
        }
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
        if let EventPayload::Progress(payload) = &event.payload {
            active.last_progress = Some(payload.clone());
            active.heartbeat_seen = true;
        }
        if active.events.len() >= MAX_STATUS_EVENTS {
            active.events.remove(0);
        }
        active.events.push(value.clone());
        active.expected_sequence = active
            .expected_sequence
            .checked_add(1)
            .ok_or(FailureCode::InvalidState)?;
        let closed = active.closed;
        if closed {
            registry.retained = registry.active.take();
        }
        drop(registry);
        if closed {
            if let Ok(mut correlation) = self.session_correlation.lock() {
                *correlation = None;
            }
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

fn analysis_command_ack(
    request_id: String,
    snapshot: &crate::session_supervisor::SessionSnapshot,
) -> AnalysisCommandAck {
    AnalysisCommandAck {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        accepted: true,
        outcome: "registered",
        operation_id: snapshot.operation_id.clone(),
        session_id: snapshot.session_id.clone(),
        generation: snapshot.generation,
        initial_phase: "preprocessing",
        cancel_available: snapshot.cancel_available,
    }
}

fn selection_command_ack(
    request_id: String,
    outcome: SelectionOutcome,
    selection: Option<crate::desktop_selection::SelectionSummary>,
) -> SelectionCommandAck {
    SelectionCommandAck {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        accepted: true,
        outcome,
        selection,
    }
}

fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn elapsed_bucket_from_millis(elapsed: u64) -> String {
    match elapsed {
        value if value < 1_000 => "<1s",
        value if value < 5_000 => "1-5s",
        value if value < 30_000 => "5-30s",
        value if value < 60_000 => "30-60s",
        _ => "60s+",
    }
    .to_string()
}

fn phase_for_state_name(state: &str) -> &'static str {
    match state {
        "ready" => "selection",
        "preprocessing" => "preprocessing",
        "handoff" => "handoff",
        "analyzing" => "aggregation",
        "cancelling" | "discarding" | "closing" => "cleanup",
        "failed" => "cleanup",
        _ => "selection",
    }
}

fn canonical_worker_query_key(
    dataset_id: &str,
    generation: u64,
    filters: &crate::export_schema::ExportFilters,
) -> Result<String, FailureCode> {
    if !valid_id(dataset_id, "dat_") || generation == 0 || !filters.validate() {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    serde_json::to_string(&serde_json::json!([
        dataset_id,
        generation,
        filters.start_date,
        filters.end_date,
        filters.sender,
        filters.selected_year,
        filters.session_threshold_hours,
        WORKER_QUERY_TIMEZONE,
        WORKER_QUERY_REQUEST_VERSION,
        ANALYTICS_RESULT_CONTRACT_VERSION,
        WORKER_QUERY_METRIC_DEFINITIONS,
    ]))
    .map_err(|_| FailureCode::WorkerRuntimeFailed)
}

fn parse_worker_query_key(
    query_key: &str,
    expected_dataset_id: &str,
    expected_generation: u64,
) -> Result<crate::export_schema::ExportFilters, FailureCode> {
    let value: Value =
        serde_json::from_str(query_key).map_err(|_| FailureCode::WorkerRuntimeFailed)?;
    let items = value
        .as_array()
        .filter(|items| items.len() == 11)
        .ok_or(FailureCode::WorkerRuntimeFailed)?;
    let dataset_id = items[0].as_str().ok_or(FailureCode::WorkerRuntimeFailed)?;
    let generation = items[1].as_u64().ok_or(FailureCode::WorkerRuntimeFailed)?;
    if dataset_id != expected_dataset_id
        || generation != expected_generation
        || !valid_id(dataset_id, "dat_")
    {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    if items[7].as_str() != Some(WORKER_QUERY_TIMEZONE)
        || items[8].as_str() != Some(WORKER_QUERY_REQUEST_VERSION)
        || items[9].as_str() != Some(ANALYTICS_RESULT_CONTRACT_VERSION)
    {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    let metrics = items[10]
        .as_array()
        .ok_or(FailureCode::WorkerRuntimeFailed)?;
    if metrics.len() != WORKER_QUERY_METRIC_DEFINITIONS.len()
        || metrics
            .iter()
            .zip(WORKER_QUERY_METRIC_DEFINITIONS)
            .any(|(actual, expected)| actual.as_str() != Some(expected))
    {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    let selected_year = match &items[5] {
        Value::Null => None,
        Value::Number(value) => value
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| (1..=9999).contains(value)),
        _ => None,
    };
    if !items[5].is_null() && selected_year.is_none() {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    let session_threshold_hours = items[6]
        .as_u64()
        .and_then(|value| u8::try_from(value).ok())
        .filter(|value| matches!(value, 1 | 3 | 6 | 12 | 24))
        .ok_or(FailureCode::WorkerRuntimeFailed)?;
    let filters = crate::export_schema::ExportFilters {
        start_date: items[2]
            .as_str()
            .ok_or(FailureCode::WorkerRuntimeFailed)?
            .to_string(),
        end_date: items[3]
            .as_str()
            .ok_or(FailureCode::WorkerRuntimeFailed)?
            .to_string(),
        sender: items[4]
            .as_str()
            .ok_or(FailureCode::WorkerRuntimeFailed)?
            .to_string(),
        selected_year,
        session_threshold_hours,
    };
    if !filters.validate() {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    if canonical_worker_query_key(expected_dataset_id, expected_generation, &filters)? != query_key
    {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    Ok(filters)
}

fn validate_worker_capability(
    capability: &WorkerOperationCapability,
    window_label: &str,
) -> Result<(), FailureCode> {
    if capability.protocol_version != WORKER_CAPABILITY_PROTOCOL_VERSION
        || capability.window_id != window_label
        || !valid_id(&capability.operation_id, "wrk_")
        || !valid_id(&capability.nonce, "nonce_")
        || !valid_id(&capability.session_id, "ses_")
        || !valid_id(&capability.dataset_id, "dat_")
        || capability.generation == 0
        || capability.generation > MAX_SAFE_INTEGER
        || parse_worker_query_key(
            &capability.query_key,
            &capability.dataset_id,
            capability.generation,
        )
        .is_err()
        || capability.analytics_contract_version != ANALYTICS_RESULT_CONTRACT_VERSION
        || capability.expires_at_millis < now_unix_millis()
    {
        return Err(FailureCode::WorkerRuntimeFailed);
    }
    Ok(())
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

fn map_result_registry_code(code: crate::analytics_results::ResultRegistryError) -> FailureCode {
    use crate::analytics_results::ResultRegistryError;
    match code {
        ResultRegistryError::Busy => FailureCode::ExportBusy,
        ResultRegistryError::Pending => FailureCode::ExportResultPending,
        ResultRegistryError::Stale => FailureCode::ExportStaleResult,
        ResultRegistryError::SchemaInvalid => FailureCode::ExportSchemaInvalid,
        ResultRegistryError::LimitExceeded => FailureCode::ExportLimitExceeded,
        ResultRegistryError::NotFound => FailureCode::ExportResultNotFound,
        ResultRegistryError::InvalidState | ResultRegistryError::RandomUnavailable => {
            FailureCode::InvalidState
        }
    }
}

fn map_export_code(code: crate::export::ExportErrorCode) -> FailureCode {
    use crate::export::ExportErrorCode;
    match code {
        ExportErrorCode::Busy => FailureCode::ExportBusy,
        ExportErrorCode::ResultPending => FailureCode::ExportResultPending,
        ExportErrorCode::StaleResult => FailureCode::ExportStaleResult,
        ExportErrorCode::SchemaInvalid => FailureCode::ExportSchemaInvalid,
        ExportErrorCode::LimitExceeded => FailureCode::ExportLimitExceeded,
        ExportErrorCode::RenderFailed => FailureCode::ExportRenderFailed,
        ExportErrorCode::PermissionDenied => FailureCode::ExportPermissionDenied,
        ExportErrorCode::DiskFull => FailureCode::ExportDiskFull,
        ExportErrorCode::WriteFailed => FailureCode::ExportWriteFailed,
        ExportErrorCode::FlushFailed => FailureCode::ExportFlushFailed,
        ExportErrorCode::DurabilityUncertain => FailureCode::ExportDurabilityUncertain,
        ExportErrorCode::RenameFailed => FailureCode::ExportRenameFailed,
        ExportErrorCode::CleanupRequired => FailureCode::ExportCleanupRequired,
        ExportErrorCode::DialogUnavailable => FailureCode::DialogUnavailable,
        ExportErrorCode::ResultNotFound => FailureCode::ExportResultNotFound,
        ExportErrorCode::Cancelled => FailureCode::InvalidState,
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
        SupervisorErrorCode::SidecarSpawnFailed => FailureCode::SidecarSpawnFailed,
        SupervisorErrorCode::SidecarStartFailed => FailureCode::SidecarStartFailed,
        SupervisorErrorCode::SidecarHandshakeTimeout => FailureCode::SidecarHandshakeTimeout,
        SupervisorErrorCode::PreprocessingStalled => FailureCode::PreprocessingStalled,
        SupervisorErrorCode::SidecarProtocolMismatch => FailureCode::SidecarProtocolMismatch,
        SupervisorErrorCode::SidecarProtocolFailed => FailureCode::SidecarProtocolFailed,
        SupervisorErrorCode::SidecarProtocolInvalid => FailureCode::SidecarProtocolInvalid,
        SupervisorErrorCode::SidecarCrashed => FailureCode::SidecarCrashed,
        SupervisorErrorCode::SidecarExitedUnexpectedly => FailureCode::SidecarExitedUnexpectedly,
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
        "SOURCE_MUTATED" | "SOURCE_READ_FAILED" | "INVALID_UTF8" | "UTF8_BOM_NOT_SUPPORTED" => {
            FailureCode::SourceUnreadable
        }
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
        | "RAW_MESSAGE_LIMIT_EXCEEDED"
        | "ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED"
        | "AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED"
        | "UNSUPPORTED_EXPORT_FORMAT"
        | "UNSUPPORTED_TOP_LEVEL_STRUCTURE"
        | "UNSUPPORTED_SESSION"
        | "SOURCE_EVENT_INVALID"
        | "MESSAGE_TIME_INVALID"
        | "MESSAGE_TIME_RANGE_UNAVAILABLE"
        | "TIME_CONFLICT"
        | "NO_ELIGIBLE_TEXT_RECORDS" => FailureCode::SourceSetInvalid,
        "USER_CANCELLED" => FailureCode::SessionCancelled,
        "SIDECAR_CRASHED" => FailureCode::SidecarCrashed,
        "SIDECAR_SPAWN_FAILED" => FailureCode::SidecarSpawnFailed,
        "SIDECAR_HANDSHAKE_TIMEOUT" => FailureCode::SidecarHandshakeTimeout,
        "PREPROCESSING_STALLED" => FailureCode::PreprocessingStalled,
        "SIDECAR_PROTOCOL_FAILED" => FailureCode::SidecarProtocolFailed,
        "SIDECAR_EXITED_UNEXPECTEDLY" => FailureCode::SidecarExitedUnexpectedly,
        _ => FailureCode::SidecarProtocolInvalid,
    }
}

fn sidecar_reason_code(reason: &str) -> Option<&'static str> {
    match reason {
        "SOURCE_MUTATED" | "SOURCE_READ_FAILED" | "INVALID_UTF8" | "UTF8_BOM_NOT_SUPPORTED" => {
            Some("SOURCE_READ_FAILED")
        }
        "UNSUPPORTED_EXPORT_FORMAT" | "UNSUPPORTED_TOP_LEVEL_STRUCTURE" | "UNSUPPORTED_SESSION" => {
            Some("SOURCE_UNSUPPORTED_EXPORT")
        }
        "RAW_INPUT_FILE_LIMIT_EXCEEDED"
        | "RAW_MESSAGE_LIMIT_EXCEEDED"
        | "ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED"
        | "AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED" => Some("SOURCE_LIMIT_EXCEEDED"),
        "MESSAGE_TIME_INVALID" | "MESSAGE_TIME_RANGE_UNAVAILABLE" | "TIME_CONFLICT" => {
            Some("SOURCE_DATE_INVALID")
        }
        "SOURCE_EVENT_INVALID" => Some("SOURCE_EVENT_INVALID"),
        "INPUT_PREFLIGHT_FAILED"
        | "OUTPUT_IGNORE_POLICY_FAILED"
        | "INVALID_JSON"
        | "PARTICIPANT_INVALID"
        | "SESSION_IDENTITY_INVALID"
        | "UNSAFE_LOCAL_TYPE"
        | "DIFFERENT_CONVERSATION"
        | "NO_ELIGIBLE_TEXT_RECORDS" => Some("SOURCE_SCHEMA_INVALID"),
        "OUTPUT_DESTINATION_EXISTS"
        | "OUTPUT_PARENT_UNSAFE"
        | "OUTPUT_STAGING_FAILED"
        | "OUTPUT_WRITE_FAILED"
        | "OUTPUT_FLUSH_FAILED"
        | "OUTPUT_INTEGRITY_FAILED"
        | "OUTPUT_CLEANUP_FAILED"
        | "OUTPUT_PROMOTION_FAILED" => Some("HANDOFF_PUBLICATION_INCOMPLETE"),
        "CANONICAL_SCHEMA_INVALID"
        | "NORMALIZED_SCHEMA_INVALID"
        | "CANONICAL_PRIVACY_VALIDATION_FAILED"
        | "PRIVACY_VALIDATION_FAILED" => Some("HANDOFF_MANIFEST_SCHEMA_INVALID"),
        "CANONICAL_DATASET_LIMIT_EXCEEDED"
        | "CANONICAL_CHUNK_LIMIT_EXCEEDED"
        | "CANONICAL_EVENT_LIMIT_EXCEEDED"
        | "NORMALIZED_DATASET_LIMIT_EXCEEDED"
        | "NORMALIZED_RECORD_LIMIT_EXCEEDED"
        | "NORMALIZED_RECORD_TOO_LARGE" => Some("HANDOFF_DATASET_LIMIT_EXCEEDED"),
        "CANONICAL_NO_EVENTS" => Some("HANDOFF_EVENT_COUNT_MISMATCH"),
        _ => None,
    }
}

fn retryable_failure(code: &FailureCode) -> bool {
    matches!(
        code,
        FailureCode::SessionCleanupFailed
            | FailureCode::CleanupRequired
            | FailureCode::SidecarUnavailable
            | FailureCode::SidecarVerificationFailed
            | FailureCode::SidecarSpawnFailed
            | FailureCode::SidecarStartFailed
            | FailureCode::SidecarHandshakeTimeout
            | FailureCode::PreprocessingStalled
            | FailureCode::SidecarProtocolMismatch
            | FailureCode::SidecarProtocolFailed
            | FailureCode::SidecarExited
            | FailureCode::SidecarExitedUnexpectedly
            | FailureCode::SidecarProtocolInvalid
            | FailureCode::SidecarCrashed
            | FailureCode::DatasetHandoffInvalid
            | FailureCode::DatasetTampered
            | FailureCode::DiskSpaceInsufficient
            | FailureCode::MemoryPressure
            | FailureCode::WorkerRuntimeFailed
    )
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

fn release_terminal_snapshot(
    core: &IpcCoreState,
    window: &tauri::WebviewWindow,
    snapshot: &crate::session_supervisor::SessionSnapshot,
) {
    let _ = core.release_terminal_session(
        window.label(),
        &snapshot.operation_id,
        &snapshot.session_id,
        snapshot.generation,
    );
}

fn publish_unexpected_terminal(
    core: &IpcCoreState,
    window: &tauri::WebviewWindow,
    snapshot: Option<&crate::session_supervisor::SessionSnapshot>,
    session_id: &str,
    generation: u64,
    code: FailureCode,
) {
    let Some(snapshot) = snapshot else {
        let _ = core.publish_failure(window, code.clone(), retryable_failure(&code));
        core.force_release_failed_session(window.label(), session_id, generation);
        return;
    };
    match snapshot.terminal {
        Some(crate::session_supervisor::SessionTerminal::Complete(_)) => return,
        Some(crate::session_supervisor::SessionTerminal::Cancelled) => {
            let reason = match snapshot.cancel_reason {
                Some(crate::session_supervisor::CancelReason::Replacement) => "replacement",
                Some(crate::session_supervisor::CancelReason::ApplicationClose) => {
                    "application-close"
                }
                Some(crate::session_supervisor::CancelReason::User) | None => "user",
            };
            let _ = core.publish_cancelled(window, reason);
        }
        Some(crate::session_supervisor::SessionTerminal::Failed(_)) | None => {
            let _ = core.publish_failure(window, code.clone(), retryable_failure(&code));
        }
    }
    publish_snapshot_cleanup(core, window, snapshot);
    release_terminal_snapshot(core, window, snapshot);
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
            let finalized = core
                .supervisor
                .finalize_unexpected(window.label(), &session_id, generation, error.code)
                .ok();
            transport.close_session(window.label(), &session_id, generation);
            core.clear_result(window.label(), &session_id, generation);
            publish_unexpected_terminal(
                &core,
                &window,
                finalized.as_ref(),
                &session_id,
                generation,
                code,
            );
            return;
        }
    };
    match snapshot.terminal.clone() {
        Some(crate::session_supervisor::SessionTerminal::Complete(sidecar_result)) => {
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
                    let code = FailureCode::DatasetHandoffInvalid;
                    let reason_code = error.reason_code();
                    transport.close_session(window.label(), &session_id, generation);
                    core.clear_result(window.label(), &session_id, generation);
                    let _ = core.publish_failure_with_reason(
                        &window,
                        code.clone(),
                        true,
                        Some(reason_code),
                    );
                    if let Ok(cleaned) = core.supervisor.reject_handoff(
                        window.label(),
                        &session_id,
                        generation,
                        reason_code,
                    ) {
                        publish_snapshot_cleanup(&core, &window, &cleaned);
                        release_terminal_snapshot(&core, &window, &cleaned);
                    }
                    return;
                }
            };
            let count_reason = if sidecar_result.source_count != verified.source_count {
                Some(crate::dataset_handoff::HandoffReasonCode::SourceCountMismatch)
            } else if sidecar_result.event_count != verified.record_count {
                Some(crate::dataset_handoff::HandoffReasonCode::EventCountMismatch)
            } else if sidecar_result.chunk_count != verified.chunk_count {
                Some(crate::dataset_handoff::HandoffReasonCode::ChunkCountMismatch)
            } else if sidecar_result.duplicate_event_count != verified.duplicate_event_count
                || sidecar_result
                    .event_count
                    .saturating_add(sidecar_result.duplicate_event_count)
                    != verified.raw_accepted_event_count
            {
                Some(crate::dataset_handoff::HandoffReasonCode::DuplicateIdentityInvalid)
            } else {
                None
            };
            if let Some(reason) = count_reason {
                let reason_code = reason.as_str();
                transport.close_session(window.label(), &session_id, generation);
                core.clear_result(window.label(), &session_id, generation);
                let _ = core.publish_failure_with_reason(
                    &window,
                    FailureCode::DatasetHandoffInvalid,
                    true,
                    Some(reason_code),
                );
                if let Ok(cleaned) = core.supervisor.reject_handoff(
                    window.label(),
                    &session_id,
                    generation,
                    reason_code,
                ) {
                    publish_snapshot_cleanup(&core, &window, &cleaned);
                    release_terminal_snapshot(&core, &window, &cleaned);
                }
                return;
            }
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
                    transport.close_session(window.label(), &session_id, generation);
                    core.clear_result(window.label(), &session_id, generation);
                    let _ =
                        core.publish_failure(&window, FailureCode::DatasetTransportInvalid, true);
                    if let Ok(cleaned) = core.supervisor.reject_handoff(
                        window.label(),
                        &session_id,
                        generation,
                        "DATASET_TRANSPORT_INVALID",
                    ) {
                        publish_snapshot_cleanup(&core, &window, &cleaned);
                        release_terminal_snapshot(&core, &window, &cleaned);
                    }
                    return;
                }
            };
            if let Err(code) = core.commit_dataset_result(
                window.label(),
                &session_id,
                generation,
                &capability.dataset_id,
                verified.record_count,
                &verified.minimum_calendar_date,
                &verified.maximum_calendar_date,
            ) {
                transport.close_session(window.label(), &session_id, generation);
                core.clear_result(window.label(), &session_id, generation);
                let _ = core.publish_failure(&window, code.clone(), retryable_failure(&code));
                if let Ok(cleaned) = core.supervisor.reject_handoff(
                    window.label(),
                    &session_id,
                    generation,
                    "EXPORT_SCHEMA_INVALID",
                ) {
                    publish_snapshot_cleanup(&core, &window, &cleaned);
                    release_terminal_snapshot(&core, &window, &cleaned);
                }
                return;
            };
            if core
                .publish_dataset_ready(
                    &window,
                    &capability.dataset_id,
                    verified.record_count,
                    verified.chunk_count,
                    &verified.minimum_calendar_date,
                    &verified.maximum_calendar_date,
                )
                .is_err()
            {
                transport.close_session(window.label(), &session_id, generation);
                core.clear_result(window.label(), &session_id, generation);
                let _ = core.publish_failure(&window, FailureCode::DatasetTransportInvalid, true);
                if let Ok(cleaned) = core.supervisor.reject_handoff(
                    window.label(),
                    &session_id,
                    generation,
                    "DATASET_TRANSPORT_INVALID",
                ) {
                    publish_snapshot_cleanup(&core, &window, &cleaned);
                    release_terminal_snapshot(&core, &window, &cleaned);
                }
                return;
            }
            let _ = core.publish_state(&window, "analyzing");
        }
        Some(crate::session_supervisor::SessionTerminal::Failed(reason)) => {
            let code = map_sidecar_reason(&reason);
            transport.close_session(window.label(), &session_id, generation);
            core.clear_result(window.label(), &session_id, generation);
            let _ = core.publish_failure_with_reason(
                &window,
                code.clone(),
                retryable_failure(&code),
                sidecar_reason_code(&reason),
            );
            publish_snapshot_cleanup(&core, &window, &snapshot);
            release_terminal_snapshot(&core, &window, &snapshot);
        }
        Some(crate::session_supervisor::SessionTerminal::Cancelled) => {
            transport.close_session(window.label(), &session_id, generation);
            core.clear_result(window.label(), &session_id, generation);
            let reason = match snapshot.cancel_reason {
                Some(crate::session_supervisor::CancelReason::Replacement) => "replacement",
                Some(crate::session_supervisor::CancelReason::ApplicationClose) => {
                    "application-close"
                }
                Some(crate::session_supervisor::CancelReason::User) | None => "user",
            };
            let _ = core.publish_cancelled(&window, reason);
            publish_snapshot_cleanup(&core, &window, &snapshot);
            if reason == "user" {
                release_terminal_snapshot(&core, &window, &snapshot);
                // The IPC registry retains the terminal snapshot for status
                // recovery, while the supervisor must release its live slot
                // before a second analysis can start.
                let _ = core
                    .supervisor
                    .discard(window.label(), &session_id, generation);
            }
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
                release_terminal_snapshot(&core, &window, &snapshot);
                let _ = core
                    .supervisor
                    .discard(window.label(), &session_id, generation);
            }
        }
        None => {
            let finalized = core
                .supervisor
                .finalize_unexpected(
                    window.label(),
                    &session_id,
                    generation,
                    crate::session_supervisor::SupervisorErrorCode::SidecarCrashed,
                )
                .ok();
            core.clear_result(window.label(), &session_id, generation);
            transport.close_session(window.label(), &session_id, generation);
            publish_unexpected_terminal(
                &core,
                &window,
                finalized.as_ref(),
                &session_id,
                generation,
                FailureCode::SidecarCrashed,
            );
        }
    }
}

fn publish_sidecar_progress(
    core: &IpcCoreState,
    window: &tauri::WebviewWindow,
    progress: crate::session_supervisor::SidecarProgress,
) {
    let total = progress.capacity_value.max(1);
    let completed = progress.aggregate_count.min(total);
    let _ = core.publish_progress(
        window,
        phase_for_sidecar(&progress.phase),
        completed,
        total,
        f64::from(progress.percentage),
    );
}

fn prepare_source_selection(
    window: &tauri::WebviewWindow,
    state: &IpcCoreState,
) -> Result<(), IpcError> {
    let active = state.supervisor.active_snapshot();
    let retained = state.supervisor.retained_snapshot();
    let Some(existing) = active.clone().or(retained.clone()) else {
        return Ok(());
    };
    let registry_terminal = state.registry.lock().ok().and_then(|registry| {
        registry
            .active
            .as_ref()
            .filter(|record| {
                record.session_id == existing.session_id && record.generation == existing.generation
            })
            .map(|record| (record.terminal_outcome, record.cleanup_status.is_some()))
    });

    // A failed generation is already terminal. Keep its host-owned input
    // authority so a cancelled picker can still offer Retry; it is not an
    // active slot and therefore cannot block a future start.
    if active.is_none()
        && matches!(
            existing.terminal,
            Some(crate::session_supervisor::SessionTerminal::Failed(_))
        )
    {
        state.clear_result(window.label(), &existing.session_id, existing.generation);
        if !registry_terminal.is_some_and(|(_, cleanup_seen)| cleanup_seen) {
            publish_snapshot_cleanup(state, window, &existing);
        }
        release_terminal_snapshot(state, window, &existing);
        return Ok(());
    }

    let cleaned = state
        .supervisor
        .prepare_replacement(window.label(), &existing.session_id, existing.generation)
        .map_err(|error| IpcError::with_code(None, map_supervisor_code(error.code)))?;
    window
        .app_handle()
        .state::<crate::dataset_transport::DatasetTransportState>()
        .close_session(window.label(), &existing.session_id, existing.generation);
    state.clear_result(window.label(), &existing.session_id, existing.generation);

    // The old registry record is still active while these terminal events are
    // accepted. Only then move it to the retained registry slot.
    if registry_terminal.is_none_or(|(terminal, _)| terminal.is_none()) {
        let _ = state.publish_cancelled(&window, "replacement");
    }
    if !registry_terminal.is_some_and(|(_, cleanup_seen)| cleanup_seen) {
        publish_snapshot_cleanup(state, window, &cleaned);
    }
    release_terminal_snapshot(state, window, &cleaned);
    Ok(())
}

fn start_session(
    window: &tauri::WebviewWindow,
    state: &IpcCoreState,
    selection_id: &str,
) -> Result<crate::session_supervisor::SessionSnapshot, IpcError> {
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
    if let Err(code) = state.register_session_with_operation(
        window.label(),
        &snapshot.operation_id,
        &snapshot.session_id,
        snapshot.generation,
    ) {
        if let Ok(cleaned) =
            state
                .supervisor
                .discard(window.label(), &snapshot.session_id, snapshot.generation)
        {
            publish_snapshot_cleanup(state, window, &cleaned);
            release_terminal_snapshot(state, window, &cleaned);
        }
        return Err(IpcError::with_code(None, code));
    }
    if let Err(code) = state
        .publish_state(window, "ready")
        .and_then(|_| state.publish_state(window, "preprocessing"))
    {
        if let Ok(cleaned) =
            state
                .supervisor
                .discard(window.label(), &snapshot.session_id, snapshot.generation)
        {
            publish_snapshot_cleanup(state, window, &cleaned);
            release_terminal_snapshot(state, window, &cleaned);
        }
        return Err(IpcError::with_code(None, code));
    }
    let core = state.clone();
    let progress_core = state.clone();
    let watcher_window = window.clone();
    let progress_window = window.clone();
    let transport = window
        .app_handle()
        .state::<crate::dataset_transport::DatasetTransportState>()
        .inner()
        .clone();
    let cache_for_watcher = cache_root;
    let session_id = snapshot.session_id.clone();
    let generation = snapshot.generation;
    let watch_session = session_id.clone();
    if let Err(error) = state.supervisor.watch_with_progress(
        window.label(),
        &session_id,
        generation,
        move |progress| publish_sidecar_progress(&progress_core, &progress_window, progress),
        move |result| {
            handle_watched_session(
                core,
                watcher_window,
                transport,
                cache_for_watcher,
                watch_session,
                generation,
                result,
            );
        },
    ) {
        if let Ok(cleaned) = state
            .supervisor
            .discard(window.label(), &session_id, generation)
        {
            publish_snapshot_cleanup(state, window, &cleaned);
            release_terminal_snapshot(state, window, &cleaned);
        }
        return Err(IpcError::with_code(None, map_supervisor_code(error.code)));
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn select_annual_sources(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<SelectionCommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    if request.get("type").and_then(Value::as_str) != Some("select-annual-sources") {
        return Err(IpcError::invalid(Some(request_id)));
    }
    retry_startup_recovery(&window, state.inner()).map_err(|mut error| {
        error.request_id = Some(request_id.clone());
        error
    })?;
    prepare_source_selection(&window, state.inner()).map_err(|mut error| {
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
        return Ok(selection_command_ack(
            request_id,
            SelectionOutcome::Cancelled,
            None,
        ));
    };
    let summary = state
        .replace_selection(crate::desktop_selection::SourceRole::Annual, paths)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    state
        .publish_selection_ready(&window, &summary)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    Ok(selection_command_ack(
        request_id,
        SelectionOutcome::Registered,
        Some(summary),
    ))
}

#[tauri::command]
pub fn select_verification_sources(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<SelectionCommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    if request.get("type").and_then(Value::as_str) != Some("select-verification-sources") {
        return Err(IpcError::invalid(Some(request_id)));
    }
    retry_startup_recovery(&window, state.inner()).map_err(|mut error| {
        error.request_id = Some(request_id.clone());
        error
    })?;
    prepare_source_selection(&window, state.inner()).map_err(|mut error| {
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
        return Ok(selection_command_ack(
            request_id,
            SelectionOutcome::Cancelled,
            None,
        ));
    };
    let summary = state
        .replace_selection(crate::desktop_selection::SourceRole::Verification, paths)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    state
        .publish_selection_ready(&window, &summary)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    Ok(selection_command_ack(
        request_id,
        SelectionOutcome::Registered,
        Some(summary),
    ))
}

/// Test-only packaged UI assertion sink.  It accepts no renderer data and is
/// registered only in the dedicated synthetic native-dialog smoke build.
#[cfg(feature = "synthetic-dialog-adapter")]
#[tauri::command]
pub fn record_selection_smoke(window: tauri::WebviewWindow) -> Result<(), IpcError> {
    if !crate::security::trusted_main_window_label(window.label()) {
        return Err(IpcError::with_code(None, FailureCode::WindowNotAuthorized));
    }
    let root = std::env::var_os("CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| IpcError::with_code(None, FailureCode::InvalidState))?;
    std::fs::create_dir_all(&root)
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    std::fs::write(root.join("selection-smoke-passed"), b"passed\n")
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    // Keep the feature-gated process alive briefly after the marker so the
    // injected UI can exercise the real close-and-cleanup path before the
    // harness exits. Production builds do not compile this command.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(10));
        std::process::exit(0);
    });
    Ok(())
}

/// Test-only checkpoint sink for the packaged synthetic vertical smoke.  The
/// accepted values are a fixed allowlist so this command cannot be used to
/// write renderer-controlled paths or content. Production builds do not
/// compile this command.
#[cfg(feature = "synthetic-dialog-adapter")]
#[tauri::command]
pub fn record_selection_smoke_checkpoint(
    window: tauri::WebviewWindow,
    checkpoint: String,
) -> Result<(), IpcError> {
    if !crate::security::trusted_main_window_label(window.label()) {
        return Err(IpcError::with_code(None, FailureCode::WindowNotAuthorized));
    }
    let filename = if checkpoint == "resolution" {
        match window.app_handle().path().resource_dir() {
            Err(_) => "selection-smoke-resolution-resource-dir-failed",
            Ok(resource_directory) => {
                match crate::session_supervisor::SidecarResolution::packaged(&resource_directory) {
                    Ok(_) => "selection-smoke-resolution-passed",
                    Err(error) => match error.code {
                        crate::session_supervisor::SupervisorErrorCode::SidecarUnavailable => {
                            "selection-smoke-resolution-SIDECAR_UNAVAILABLE"
                        }
                        crate::session_supervisor::SupervisorErrorCode::SidecarVerificationFailed => {
                            "selection-smoke-resolution-SIDECAR_VERIFICATION_FAILED"
                        }
                        crate::session_supervisor::SupervisorErrorCode::SidecarStartFailed => {
                            "selection-smoke-resolution-SIDECAR_START_FAILED"
                        }
                        _ => "selection-smoke-resolution-other-failed",
                    },
                }
            }
        }
    } else {
        match checkpoint.as_str() {
            "page-loaded" => "selection-smoke-page-loaded",
            "onboarding-ready" => "selection-smoke-onboarding-ready",
            "selection-ready" => "selection-smoke-selection-ready",
            "start-clicked" => "selection-smoke-start-clicked",
            "start-status-visible" => "selection-smoke-start-status-visible",
            "start-status-missing" => "selection-smoke-start-status-missing",
            "cancel-available" => "selection-smoke-cancel-available",
            "cancel-clicked" => "selection-smoke-cancel-clicked",
            "cancelled-event" => "selection-smoke-cancelled-event",
            "cancelled-ready" => "selection-smoke-cancelled-ready",
            "retry-start-clicked" => "selection-smoke-retry-start-clicked",
            "worker-error-visible" => "selection-smoke-worker-error-visible",
            "worker-started" => "selection-smoke-worker-started",
            "worker-prepared" => "selection-smoke-worker-prepared",
            "worker-load-accepted" => "selection-smoke-worker-load-accepted",
            "worker-dashboard-model" => "selection-smoke-worker-dashboard-model",
            "worker-result-ready" => "selection-smoke-worker-result-ready",
            "dashboard-ready" => "selection-smoke-dashboard-ready",
            "home-ready" => "selection-smoke-home-ready",
            "annual-recap-ready" => "selection-smoke-annual-recap-ready",
            "core-sections-ready" => "selection-smoke-core-sections-ready",
            "word-evidence-ready" => "selection-smoke-word-evidence-ready",
            "word-cloud-ready" => "selection-smoke-word-cloud-ready",
            "error" => "selection-smoke-error",
            "SIDECAR_UNAVAILABLE" => "selection-smoke-failure-SIDECAR_UNAVAILABLE",
            "SIDECAR_VERIFICATION_FAILED" => "selection-smoke-failure-SIDECAR_VERIFICATION_FAILED",
            "SIDECAR_SPAWN_FAILED" => "selection-smoke-failure-SIDECAR_SPAWN_FAILED",
            "SIDECAR_START_FAILED" => "selection-smoke-failure-SIDECAR_START_FAILED",
            "SIDECAR_HANDSHAKE_TIMEOUT" => "selection-smoke-failure-SIDECAR_HANDSHAKE_TIMEOUT",
            "PREPROCESSING_STALLED" => "selection-smoke-failure-PREPROCESSING_STALLED",
            "SIDECAR_PROTOCOL_FAILED" => "selection-smoke-failure-SIDECAR_PROTOCOL_FAILED",
            "SIDECAR_EXITED_UNEXPECTEDLY" => "selection-smoke-failure-SIDECAR_EXITED_UNEXPECTEDLY",
            "SIDECAR_PROTOCOL_INVALID" => "selection-smoke-failure-SIDECAR_PROTOCOL_INVALID",
            "SIDECAR_CRASHED" => "selection-smoke-failure-SIDECAR_CRASHED",
            "DATASET_HANDOFF_INVALID" => "selection-smoke-failure-DATASET_HANDOFF_INVALID",
            "DATASET_TRANSPORT_INVALID" => "selection-smoke-failure-DATASET_TRANSPORT_INVALID",
            "WORKER_RUNTIME_FAILED" => "selection-smoke-failure-WORKER_RUNTIME_FAILED",
            "WORKER_TIMEOUT" => "selection-smoke-failure-WORKER_TIMEOUT",
            "INVALID_REQUEST" => "selection-smoke-failure-INVALID_REQUEST",
            "INVALID_STATE" => "selection-smoke-failure-INVALID_STATE",
            _ => return Err(IpcError::with_code(None, FailureCode::InvalidState)),
        }
    };
    let root = std::env::var_os("CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| IpcError::with_code(None, FailureCode::InvalidState))?;
    std::fs::create_dir_all(&root)
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    std::fs::write(root.join(filename), b"passed\n")
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    Ok(())
}

/// Test-only content-free snapshot sink for the packaged synthetic smoke.
/// It records only the host lifecycle state, never identifiers or private
/// filesystem data. Production builds do not compile this command.
#[cfg(feature = "synthetic-dialog-adapter")]
#[tauri::command]
pub fn record_selection_smoke_host_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
) -> Result<(), IpcError> {
    if !crate::security::trusted_main_window_label(window.label()) {
        return Err(IpcError::with_code(None, FailureCode::WindowNotAuthorized));
    }
    let filename = match state.session_supervisor().active_snapshot() {
        None => "selection-smoke-host-none".to_string(),
        Some(snapshot) => match snapshot.terminal {
            Some(crate::session_supervisor::SessionTerminal::Failed(reason)) => {
                if reason.len() <= 64
                    && reason.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                    })
                {
                    format!("selection-smoke-host-failure-{reason}")
                } else {
                    "selection-smoke-host-failure-other".to_string()
                }
            }
            Some(crate::session_supervisor::SessionTerminal::Complete(_)) => {
                "selection-smoke-host-complete".to_string()
            }
            Some(crate::session_supervisor::SessionTerminal::Cancelled) => {
                "selection-smoke-host-cancelled".to_string()
            }
            None => match snapshot.state.as_str() {
                "preprocessing" => "selection-smoke-host-preprocessing".to_string(),
                "handoff" => "selection-smoke-host-handoff".to_string(),
                "analyzing" => "selection-smoke-host-analyzing".to_string(),
                "complete" => "selection-smoke-host-complete".to_string(),
                "failed" => "selection-smoke-host-failed".to_string(),
                "cancelling" => "selection-smoke-host-cancelling".to_string(),
                "closing" => "selection-smoke-host-closing".to_string(),
                _ => "selection-smoke-host-other".to_string(),
            },
        },
    };
    let root = std::env::var_os("CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| IpcError::with_code(None, FailureCode::InvalidState))?;
    std::fs::create_dir_all(&root)
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    std::fs::write(root.join(filename), b"passed\n")
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    Ok(())
}

#[tauri::command]
pub fn start_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<AnalysisCommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    let selection_id = request
        .get("selectionId")
        .and_then(Value::as_str)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    let snapshot = start_session(&window, state.inner(), selection_id).map_err(|mut error| {
        if error.request_id.is_none() {
            error.request_id = Some(request_id.clone());
        }
        error
    })?;
    Ok(analysis_command_ack(request_id, &snapshot))
}

#[tauri::command]
pub fn cancel_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let command = validate_cancel(&request)?;
    let request_id = command.request_id.clone();
    let (session_id, generation) = if let Some(operation_id) = command.operation_id.as_deref() {
        state
            .resolve_owned_operation(window.label(), operation_id)
            .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?
    } else {
        (
            command
                .session_id
                .as_deref()
                .unwrap_or_default()
                .to_string(),
            command.generation.unwrap_or_default(),
        )
    };
    state
        .validate_owned_session(window.label(), &session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    let cancelled = state
        .supervisor
        .cancel(
            window.label(),
            &session_id,
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
pub fn get_analysis_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<AnalysisStatusAck, IpcError> {
    let command = validate_status(&request)?;
    state
        .analysis_status(
            window.label(),
            command.request_id.clone(),
            &command.operation_id,
            command.after_sequence,
        )
        .map_err(|code| IpcError::with_code(Some(command.request_id), code))
}

#[tauri::command]
pub fn retry_analysis(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<AnalysisCommandAck, IpcError> {
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
        .validate_retry_session(window.label(), session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    let resolution = resolve_sidecar(&window)?;
    let snapshot = state
        .supervisor
        .retry(window.label(), session_id, generation, resolution)
        .map_err(|error| {
            IpcError::with_code(Some(request_id.clone()), map_supervisor_code(error.code))
        })?;
    if let Err(code) = state.replace_registered_session_with_operation(
        window.label(),
        &snapshot.operation_id,
        &snapshot.session_id,
        snapshot.generation,
    ) {
        if let Ok(cleaned) =
            state
                .supervisor
                .discard(window.label(), &snapshot.session_id, snapshot.generation)
        {
            publish_snapshot_cleanup(state.inner(), &window, &cleaned);
            release_terminal_snapshot(state.inner(), &window, &cleaned);
        }
        return Err(IpcError::with_code(Some(request_id.clone()), code));
    }
    if let Err(code) = state
        .publish_state(&window, "ready")
        .and_then(|_| state.publish_state(&window, "preprocessing"))
    {
        if let Ok(cleaned) =
            state
                .supervisor
                .discard(window.label(), &snapshot.session_id, snapshot.generation)
        {
            publish_snapshot_cleanup(state.inner(), &window, &cleaned);
            release_terminal_snapshot(state.inner(), &window, &cleaned);
        }
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
    let progress_core = state.inner().clone();
    let progress_window = window.clone();
    if let Err(error) = state.supervisor.watch_with_progress(
        window.label(),
        &watch_session_arg,
        new_generation,
        move |progress| publish_sidecar_progress(&progress_core, &progress_window, progress),
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
        if let Ok(cleaned) =
            state
                .supervisor
                .discard(window.label(), &new_session_id, new_generation)
        {
            publish_snapshot_cleanup(state.inner(), &window, &cleaned);
            release_terminal_snapshot(state.inner(), &window, &cleaned);
        }
        return Err(IpcError::with_code(
            Some(request_id.clone()),
            map_supervisor_code(error.code),
        ));
    }
    Ok(analysis_command_ack(request_id, &snapshot))
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
    state.clear_result(window.label(), session_id, generation);
    window
        .app_handle()
        .state::<crate::dataset_transport::DatasetTransportState>()
        .close_session(window.label(), session_id, generation);
    if let Some(active) = state.supervisor.active_snapshot() {
        if active.session_id == session_id
            && active.generation == generation
            && (active.terminal.is_none()
                || matches!(
                    active.terminal,
                    Some(crate::session_supervisor::SessionTerminal::Complete(_))
                ) && active.state == crate::session_supervisor::SessionState::Analyzing)
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
    state.clear_result(window.label(), session_id, generation);
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn prepare_aggregate_result(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<WorkerPreparationAck, IpcError> {
    let request_id = validate_command(&request)?;
    let session_id = request
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    let generation = request
        .get("generation")
        .and_then(Value::as_u64)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    let query_key = request
        .get("queryKey")
        .and_then(Value::as_str)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    let capability = state
        .prepare_aggregate_result(&window, window.label(), session_id, generation, query_key)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    Ok(WorkerPreparationAck {
        protocol_version: WORKER_CAPABILITY_PROTOCOL_VERSION,
        request_id,
        accepted: true,
        capability,
    })
}

#[tauri::command]
pub fn cancel_aggregate_result(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let request_id = validate_command(&request)?;
    let session_id = request
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    let generation = request
        .get("generation")
        .and_then(Value::as_u64)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    state
        .cancel_aggregate_result(window.label(), session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    Ok(command_ack(request_id))
}

#[tauri::command]
pub fn commit_aggregate_result(
    _window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<ResultCommitAck, IpcError> {
    let (command, _) = validate_aggregate_result(&request)?;
    let _ = state;
    Err(IpcError::with_code(
        Some(command.request_id),
        FailureCode::ContractOnly,
    ))
}

#[tauri::command]
pub fn commit_worker_result(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<WorkerCommitAck, IpcError> {
    let (command, aggregate) = validate_worker_commit(&request)?;
    if command.capability.window_id != window.label() {
        return Err(IpcError::with_code(None, FailureCode::WindowNotAuthorized));
    }
    let result_id = state
        .commit_worker_operation(window.label(), command.capability, aggregate)
        .map_err(|code| IpcError::with_code(None, code))?;
    state
        .publish_state(&window, "complete")
        .map_err(|code| IpcError::with_code(None, code))?;
    Ok(WorkerCommitAck {
        protocol_version: WORKER_CAPABILITY_PROTOCOL_VERSION,
        accepted: true,
        result_id,
    })
}

#[tauri::command]
pub fn acknowledge_worker_stop(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let command = validate_session(&request, "acknowledge-worker-stop")?;
    state
        .acknowledge_worker_stop(window.label(), &command.session_id, command.generation)
        .map_err(|code| IpcError::with_code(Some(command.request_id.clone()), code))?;
    Ok(command_ack(command.request_id))
}

#[tauri::command]
pub fn export_aggregate(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<CommandAck, IpcError> {
    let command = validate_export(&request)?;
    let request_id = command.request_id.clone();
    let session_id = command.session_id.as_str();
    let generation = command.generation;
    state
        .validate_owned_session(window.label(), session_id, generation)
        .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
    let format = crate::export::ExportFormat::parse(&command.report_format)
        .ok_or_else(|| IpcError::invalid(Some(request_id.clone())))?;
    let chart_key = command
        .chart_key
        .as_deref()
        .and_then(crate::export_schema::ApprovedChartKey::parse)
        .unwrap_or(crate::export_schema::ApprovedChartKey::Trends);
    match crate::export::export_registered_result(
        &window,
        state.result_registry(),
        session_id,
        generation,
        &command.result_id,
        format,
        chart_key,
    ) {
        Ok(crate::export::ExportOutcome::Saved) => {
            state
                .publish_exported(&window, &command.result_id, &command.report_format)
                .map_err(|code| IpcError::with_code(Some(request_id.clone()), code))?;
            Ok(command_ack(request_id))
        }
        Ok(crate::export::ExportOutcome::Cancelled) => Ok(command_ack(request_id)),
        Err(error) => Err(IpcError::with_code(
            Some(request_id),
            map_export_code(error.code),
        )),
    }
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
            if (snapshot.terminal.is_none()
                || matches!(
                    snapshot.terminal,
                    Some(crate::session_supervisor::SessionTerminal::Complete(_))
                ) && snapshot.state == crate::session_supervisor::SessionState::Analyzing)
                && snapshot.state != crate::session_supervisor::SessionState::Closing
            {
                state.clear_result(window.label(), &snapshot.session_id, snapshot.generation);
                window
                    .app_handle()
                    .state::<crate::dataset_transport::DatasetTransportState>()
                    .close_session(window.label(), &snapshot.session_id, snapshot.generation);
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
            } else {
                let worker_running = matches!(
                    snapshot.terminal,
                    Some(crate::session_supervisor::SessionTerminal::Complete(_))
                ) && snapshot.state
                    == crate::session_supervisor::SessionState::Analyzing;
                if worker_running {
                    state.clear_result(window.label(), &snapshot.session_id, snapshot.generation);
                    window
                        .app_handle()
                        .state::<crate::dataset_transport::DatasetTransportState>()
                        .close_session(window.label(), &snapshot.session_id, snapshot.generation);
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
                }
                if let Ok(cleaned) = state.supervisor.close(
                    window.label(),
                    &snapshot.session_id,
                    snapshot.generation,
                ) {
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
                    state.clear_result(window.label(), &snapshot.session_id, snapshot.generation);
                }
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

    fn test_query_key(dataset_id: &str, generation: u64) -> String {
        canonical_worker_query_key(
            dataset_id,
            generation,
            &crate::export_schema::ExportFilters {
                start_date: "2025-01-01".to_string(),
                end_date: "2025-01-01".to_string(),
                sender: "both".to_string(),
                selected_year: None,
                session_threshold_hours: 6,
            },
        )
        .expect("valid synthetic query key")
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
    fn selection_command_ack_is_content_free_and_distinguishes_cancel() {
        let summary = crate::desktop_selection::SelectionSummary {
            selection_id: "sel_00000000000000000000000000000001".to_string(),
            annual_source_count: 1,
            verification_source_count: 0,
        };
        let registered = serde_json::to_value(selection_command_ack(
            "req_00000000000000000000000000000001".to_string(),
            SelectionOutcome::Registered,
            Some(summary),
        ))
        .expect("selection response serializes");
        assert_eq!(
            registered,
            serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "requestId": "req_00000000000000000000000000000001",
                "accepted": true,
                "outcome": "registered",
                "selection": {
                    "selectionId": "sel_00000000000000000000000000000001",
                    "annualSourceCount": 1,
                    "verificationSourceCount": 0,
                },
            })
        );
        let cancelled = serde_json::to_value(selection_command_ack(
            "req_00000000000000000000000000000002".to_string(),
            SelectionOutcome::Cancelled,
            None,
        ))
        .expect("cancel response serializes");
        assert_eq!(cancelled["outcome"], "cancelled");
        assert_eq!(cancelled["selection"], Value::Null);
        let encoded = cancelled.to_string();
        assert!(!encoded.contains("path"));
        assert!(!encoded.contains("filename"));
        assert!(!encoded.contains("body"));
    }

    #[test]
    fn worker_capability_identity_and_expiry_matrix_fails_closed() {
        let capability = WorkerOperationCapability {
            protocol_version: WORKER_CAPABILITY_PROTOCOL_VERSION.to_string(),
            operation_id: "wrk_00000000000000000000000000000001".to_string(),
            nonce: "nonce_00000000000000000000000000000001".to_string(),
            window_id: "main".to_string(),
            session_id: "ses_00000000000000000000000000000001".to_string(),
            generation: 1,
            dataset_id: "dat_00000000000000000000000000000001".to_string(),
            query_key: test_query_key("dat_00000000000000000000000000000001", 1),
            analytics_contract_version: ANALYTICS_RESULT_CONTRACT_VERSION.to_string(),
            expires_at_millis: now_unix_millis().saturating_add(60_000),
        };
        assert_eq!(validate_worker_capability(&capability, "main"), Ok(()));

        let mut wrong_window = capability.clone();
        wrong_window.window_id = "other".to_string();
        assert!(validate_worker_capability(&wrong_window, "main").is_err());
        let mut wrong_session = capability.clone();
        wrong_session.session_id = "ses_00000000000000000000000000000002".to_string();
        assert!(validate_worker_capability(&wrong_session, "main").is_ok());
        let state = IpcCoreState::default();
        state
            .register_session("main", &capability.session_id, 1)
            .unwrap();
        assert_eq!(
            state.validate_owned_session("main", &wrong_session.session_id, 1),
            Err(FailureCode::InvalidSession)
        );
        let mut wrong_query = capability.clone();
        wrong_query.query_key = "other-query".to_string();
        assert!(validate_worker_capability(&wrong_query, "main").is_err());
        let mut valid_but_wrong_query = capability.clone();
        valid_but_wrong_query.query_key = canonical_worker_query_key(
            &capability.dataset_id,
            capability.generation,
            &crate::export_schema::ExportFilters {
                start_date: "2025-01-01".to_string(),
                end_date: "2025-01-01".to_string(),
                sender: "owner".to_string(),
                selected_year: None,
                session_threshold_hours: 6,
            },
        )
        .unwrap();
        assert!(validate_worker_capability(&valid_but_wrong_query, "main").is_ok());
        let aggregate = vectors()
            .commands
            .into_iter()
            .find(|command| command.value["type"] == "commit-aggregate-result")
            .and_then(|command| serde_json::from_value(command.value["aggregate"].clone()).ok())
            .expect("synthetic aggregate vector");
        assert_eq!(
            state.commit_worker_operation("main", valid_but_wrong_query, aggregate),
            Err(FailureCode::WorkerRuntimeFailed)
        );
        let mut wrong_generation = capability.clone();
        wrong_generation.generation = 2;
        assert!(validate_worker_capability(&wrong_generation, "main").is_err());
        let mut wrong_nonce = capability.clone();
        wrong_nonce.nonce = "nonce_forged".to_string();
        assert!(validate_worker_capability(&wrong_nonce, "main").is_err());
        let mut expired = capability;
        expired.expires_at_millis = 0;
        assert!(validate_worker_capability(&expired, "main").is_err());
    }

    #[test]
    fn worker_operation_registry_is_empty_after_clear_disconnect_and_shutdown() {
        let session = "ses_00000000000000000000000000000001";
        let capability = WorkerOperationCapability {
            protocol_version: WORKER_CAPABILITY_PROTOCOL_VERSION.to_string(),
            operation_id: "wrk_00000000000000000000000000000001".to_string(),
            nonce: "nonce_00000000000000000000000000000001".to_string(),
            window_id: "main".to_string(),
            session_id: session.to_string(),
            generation: 1,
            dataset_id: "dat_00000000000000000000000000000001".to_string(),
            query_key: test_query_key("dat_00000000000000000000000000000001", 1),
            analytics_contract_version: ANALYTICS_RESULT_CONTRACT_VERSION.to_string(),
            expires_at_millis: now_unix_millis().saturating_add(60_000),
        };
        let state = IpcCoreState::default();
        state.register_session("main", session, 1).unwrap();
        state.worker_operations.lock().unwrap().insert(
            capability.operation_id.clone(),
            WorkerOperationRecord {
                capability: capability.clone(),
                state: WorkerOperationState::Ready,
            },
        );
        state.clear_result("main", session, 1);
        assert!(state.worker_operations.lock().unwrap().is_empty());

        state.worker_operations.lock().unwrap().insert(
            capability.operation_id.clone(),
            WorkerOperationRecord {
                capability: capability.clone(),
                state: WorkerOperationState::Ready,
            },
        );
        state.renderer_disconnected("main");
        assert!(state.worker_operations.lock().unwrap().is_empty());

        state.worker_operations.lock().unwrap().insert(
            capability.operation_id.clone(),
            WorkerOperationRecord {
                capability,
                state: WorkerOperationState::Ready,
            },
        );
        state.shutdown();
        assert!(state.worker_operations.lock().unwrap().is_empty());
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
    fn operation_status_replays_progress_and_retains_terminal_without_sensitive_fields() {
        let state = IpcCoreState::default();
        let operation = "op_00000000000000000000000000000011";
        let session = "ses_00000000000000000000000000000011";
        state
            .register_session_with_operation("main", operation, session, 1)
            .unwrap();

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
                &event(
                    2,
                    "progress",
                    serde_json::json!({
                        "phase":"preprocessing",
                        "completed":1,
                        "total":2,
                        "percentage":50
                    }),
                ),
            )
            .unwrap();

        let status = state
            .analysis_status(
                "main",
                "req_00000000000000000000000000000011".to_string(),
                operation,
                1,
            )
            .unwrap();
        assert!(status.registered);
        assert_eq!(status.operation_id.as_deref(), Some(operation));
        assert_eq!(status.session_id.as_deref(), Some(session));
        assert_eq!(status.generation, 1);
        assert_eq!(status.state, "preprocessing");
        assert_eq!(status.phase, "preprocessing");
        assert_eq!(status.heartbeat, AnalysisHeartbeat::Active);
        assert_eq!(status.events.len(), 1);
        assert!(status.events[0].get("path").is_none());
        assert!(status.events[0].get("body").is_none());

        state
            .accept_event(
                "main",
                &event(
                    3,
                    "failure",
                    serde_json::json!({
                        "code":"PREPROCESSING_STALLED",
                        "retryable":true
                    }),
                ),
            )
            .unwrap();
        state
            .accept_event(
                "main",
                &event(
                    4,
                    "cleanup",
                    serde_json::json!({"status":"complete","removedEntryCount":1}),
                ),
            )
            .unwrap();
        state
            .release_terminal_session("main", operation, session, 1)
            .unwrap();
        let terminal = state
            .analysis_status(
                "main",
                "req_00000000000000000000000000000012".to_string(),
                operation,
                3,
            )
            .unwrap();
        assert!(!terminal.cancel_available);
        assert_eq!(terminal.terminal, Some(AnalysisTerminal::Failure));
        assert_eq!(terminal.cleanup_status.as_deref(), Some("complete"));
        assert_eq!(terminal.events.len(), 1);
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
