//! Rust-side verification of the opaque v2 dataset handoff.
//!
//! The sidecar writes a private, owner-only canonical directory. Before any
//! bytes enter the Worker transport this module re-checks the session
//! identity, exact file set, manifest, chunk hashes, event privacy contract,
//! order, and aggregate counts. Errors intentionally contain only a stable
//! code; no path or raw content is retained in a public value.

use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::io::Read;
use std::path::Path;

use crate::dataset_transport::{
    MAX_CHUNK_BYTES, MAX_CHUNK_COUNT, MAX_DATASET_BYTES, MAX_MANIFEST_BYTES, MAX_RECORD_COUNT,
};
use crate::session_supervisor::ANALYSIS_SESSIONS_DIRECTORY;

const MANIFEST_NAME: &str = "manifest.json";
const SESSION_MARKER: &str = ".session-marker";
const SESSION_STATE: &str = "session-state";
const NORMALIZED_DIRECTORY: &str = "normalized";
const CANONICAL_MANIFEST_VERSION: &str = "chat-history-analysis.manifest.v2";
const CANONICAL_EVENT_VERSION: &str = "chat-history-analysis.canonical-event.v2";
const PREPROCESSOR_VERSION: &str = "0.1.0";
const TIME_POLICY: &str = "UTC+08:00";
const MAX_CREATE_TIME: u64 = 253_402_243_199;
const EVENT_FIELDS: [&str; 9] = [
    "createTime",
    "formattedTime",
    "calendarDate",
    "senderScope",
    "messageCategory",
    "textEligible",
    "content",
    "fileRank",
    "sourceIndex",
];
const CATEGORIES: [&str; 15] = [
    "text",
    "image",
    "voice",
    "video",
    "file",
    "animated-emoji",
    "structured",
    "location",
    "call",
    "mini-program",
    "reply",
    "contact-card",
    "system",
    "other",
    "unknown",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandoffErrorCode {
    InvalidSession,
    UnsafeSessionRoot,
    MissingEntry,
    ExtraEntry,
    InvalidManifest,
    InvalidChunk,
    TamperedDataset,
    LimitExceeded,
}

impl HandoffErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidSession => "INVALID_SESSION",
            Self::UnsafeSessionRoot
            | Self::MissingEntry
            | Self::ExtraEntry
            | Self::InvalidManifest
            | Self::InvalidChunk
            | Self::LimitExceeded => "DATASET_HANDOFF_INVALID",
            Self::TamperedDataset => "DATASET_TAMPERED",
        }
    }
}

impl fmt::Display for HandoffErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct HandoffError {
    pub code: HandoffErrorCode,
}

impl fmt::Debug for HandoffError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HandoffError")
            .field("code", &self.code)
            .finish()
    }
}

impl fmt::Display for HandoffError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.code.fmt(formatter)
    }
}

impl std::error::Error for HandoffError {}

impl HandoffError {
    const fn new(code: HandoffErrorCode) -> Self {
        Self { code }
    }
}

impl From<HandoffErrorCode> for HandoffError {
    fn from(code: HandoffErrorCode) -> Self {
        Self::new(code)
    }
}

#[derive(Debug, Clone)]
pub struct VerifiedHandoff {
    pub manifest: Vec<u8>,
    pub chunks: Vec<Vec<u8>>,
    pub record_count: u64,
    pub chunk_count: u64,
    pub minimum_calendar_date: String,
    pub maximum_calendar_date: String,
    pub pseudonymous: bool,
}

/// Verify exactly the session's normalized directory and return opaque bytes.
pub fn verify_session_dataset(
    session_root: &Path,
    session_id: &str,
    generation: u64,
) -> Result<VerifiedHandoff, HandoffError> {
    if !valid_session_id(session_id) || generation == 0 {
        return Err(HandoffError::new(HandoffErrorCode::InvalidSession));
    }
    if session_root.file_name().and_then(|value| value.to_str()) != Some(session_id)
        || session_root
            .parent()
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str())
            != Some(ANALYSIS_SESSIONS_DIRECTORY)
        || !absolute_no_parent(session_root)
        || !path_has_no_symlink_components(session_root)
        || !secure_directory(session_root)
        || !secure_directory(
            session_root
                .parent()
                .ok_or_else(|| HandoffError::new(HandoffErrorCode::UnsafeSessionRoot))?,
        )
    {
        return Err(HandoffError::new(HandoffErrorCode::UnsafeSessionRoot));
    }
    verify_session_marker(session_root, session_id, generation)?;
    let normalized = session_root.join(NORMALIZED_DIRECTORY);
    if !secure_directory(&normalized) {
        return Err(HandoffError::new(HandoffErrorCode::UnsafeSessionRoot));
    }
    let manifest_path = normalized.join(MANIFEST_NAME);
    let manifest = read_private_file(&manifest_path, MAX_MANIFEST_BYTES)
        .map_err(|_| HandoffError::new(HandoffErrorCode::MissingEntry))?;
    if !manifest.ends_with(b"\n") || manifest.starts_with(b"\xef\xbb\xbf") {
        return Err(HandoffError::new(HandoffErrorCode::InvalidManifest));
    }
    let manifest_value = parse_json_without_duplicates(&manifest[..manifest.len() - 1])
        .map_err(|_| HandoffError::new(HandoffErrorCode::InvalidManifest))?;
    let descriptors = validate_manifest(&manifest_value).map_err(HandoffError::new)?;

    let expected_names = std::iter::once(MANIFEST_NAME.to_string())
        .chain(descriptors.iter().map(|descriptor| descriptor.name.clone()))
        .collect::<BTreeSet<_>>();
    let observed_names = fs::read_dir(&normalized)
        .map_err(|_| HandoffError::new(HandoffErrorCode::UnsafeSessionRoot))?
        .map(|entry| {
            let entry =
                entry.map_err(|_| HandoffError::new(HandoffErrorCode::UnsafeSessionRoot))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|_| HandoffError::new(HandoffErrorCode::UnsafeSessionRoot))?;
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || !secure_regular_file(&entry.path())
            {
                return Err(HandoffError::new(HandoffErrorCode::ExtraEntry));
            }
            Ok(entry.file_name().to_string_lossy().into_owned())
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    if observed_names != expected_names {
        return Err(HandoffError::new(
            if expected_names.is_superset(&observed_names) {
                HandoffErrorCode::MissingEntry
            } else {
                HandoffErrorCode::ExtraEntry
            },
        ));
    }

    let mut chunks = Vec::with_capacity(descriptors.len());
    let mut event_count = 0u64;
    let mut eligible_count = 0u64;
    let mut system_count = 0u64;
    let mut unknown_sender_count = 0u64;
    let mut category_counts = CATEGORIES
        .iter()
        .map(|category| ((*category).to_string(), 0u64))
        .collect::<BTreeMap<_, _>>();
    let mut previous_order: Option<(u64, u64, u64)> = None;
    let mut minimum_date: Option<String> = None;
    let mut maximum_date: Option<String> = None;
    for descriptor in descriptors {
        let bytes = read_private_file(&normalized.join(&descriptor.name), MAX_CHUNK_BYTES)
            .map_err(|_| HandoffError::new(HandoffErrorCode::InvalidChunk))?;
        if bytes.len() != descriptor.byte_size {
            return Err(HandoffError::new(HandoffErrorCode::TamperedDataset));
        }
        if hex_digest(&bytes) != descriptor.sha256 {
            return Err(HandoffError::new(HandoffErrorCode::TamperedDataset));
        }
        let mut descriptor_count = 0u64;
        for line in bytes.split_inclusive(|byte| *byte == b'\n') {
            if line.is_empty() || !line.ends_with(b"\n") || line == b"\n" {
                return Err(HandoffError::new(HandoffErrorCode::InvalidChunk));
            }
            let value = parse_json_without_duplicates(&line[..line.len() - 1])
                .map_err(|_| HandoffError::new(HandoffErrorCode::InvalidChunk))?;
            let event = validate_event(&value)
                .map_err(|_| HandoffError::new(HandoffErrorCode::InvalidChunk))?;
            if event.source_index != event_count {
                return Err(HandoffError::new(HandoffErrorCode::InvalidChunk));
            }
            let order = (event.create_time, event.file_rank, event.source_index);
            if previous_order.is_some_and(|previous| order < previous) {
                return Err(HandoffError::new(HandoffErrorCode::InvalidChunk));
            }
            previous_order = Some(order);
            event_count = event_count
                .checked_add(1)
                .ok_or_else(|| HandoffError::new(HandoffErrorCode::LimitExceeded))?;
            descriptor_count = descriptor_count
                .checked_add(1)
                .ok_or_else(|| HandoffError::new(HandoffErrorCode::LimitExceeded))?;
            if event_count > MAX_RECORD_COUNT {
                return Err(HandoffError::new(HandoffErrorCode::LimitExceeded));
            }
            if event.text_eligible {
                eligible_count += 1;
            }
            if event.message_category == "system" {
                system_count += 1;
            }
            if event.sender_scope.is_none() && event.message_category != "system" {
                unknown_sender_count += 1;
            }
            *category_counts
                .get_mut(&event.message_category)
                .ok_or_else(|| HandoffError::new(HandoffErrorCode::InvalidChunk))? += 1;
            minimum_date = Some(minimum_date.map_or_else(
                || event.calendar_date.to_string(),
                |value| value.min(event.calendar_date.to_string()),
            ));
            maximum_date = Some(maximum_date.map_or_else(
                || event.calendar_date.to_string(),
                |value| value.max(event.calendar_date.to_string()),
            ));
        }
        if descriptor_count != descriptor.record_count {
            return Err(HandoffError::new(HandoffErrorCode::TamperedDataset));
        }
        chunks.push(bytes);
    }
    if event_count == 0 {
        return Err(HandoffError::new(HandoffErrorCode::InvalidManifest));
    }
    validate_aggregates(
        &manifest_value,
        event_count,
        eligible_count,
        system_count,
        unknown_sender_count,
        &category_counts,
        chunks.iter().map(Vec::len).sum(),
        expected_names.len() - 1,
    )?;
    Ok(VerifiedHandoff {
        manifest,
        chunks,
        record_count: event_count,
        chunk_count: expected_names.len() as u64 - 1,
        minimum_calendar_date: minimum_date.expect("event count checked"),
        maximum_calendar_date: maximum_date.expect("event count checked"),
        pseudonymous: true,
    })
}

fn verify_session_marker(
    session_root: &Path,
    session_id: &str,
    generation: u64,
) -> Result<(), HandoffError> {
    let marker = read_private_file(&session_root.join(SESSION_MARKER), 128)
        .map_err(|_| HandoffError::new(HandoffErrorCode::MissingEntry))?;
    if marker != b"chat-history-analysis-session-v1\n" {
        return Err(HandoffError::new(HandoffErrorCode::UnsafeSessionRoot));
    }
    let state = read_private_file(&session_root.join(SESSION_STATE), 256)
        .map_err(|_| HandoffError::new(HandoffErrorCode::MissingEntry))?;
    let state = std::str::from_utf8(&state)
        .map_err(|_| HandoffError::new(HandoffErrorCode::UnsafeSessionRoot))?;
    if state != format!("sessionId={session_id}\ngeneration={generation}\n") {
        return Err(HandoffError::new(HandoffErrorCode::InvalidSession));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct ChunkDescriptor {
    name: String,
    byte_size: usize,
    record_count: u64,
    sha256: String,
}

fn validate_manifest(value: &Value) -> Result<Vec<ChunkDescriptor>, HandoffErrorCode> {
    let object = exact_object(
        value,
        &[
            "aggregates",
            "canonicalSchemaVersion",
            "chunks",
            "limits",
            "metricDefinitionVersions",
            "preprocessorVersion",
            "privacyValidation",
            "schemaVersion",
            "timePolicy",
        ],
    )?;
    if string(object, "schemaVersion")? != CANONICAL_MANIFEST_VERSION
        || string(object, "canonicalSchemaVersion")? != CANONICAL_EVENT_VERSION
        || string(object, "preprocessorVersion")? != PREPROCESSOR_VERSION
        || string(object, "timePolicy")? != TIME_POLICY
    {
        return Err(HandoffErrorCode::InvalidManifest);
    }
    let metrics = exact_object(
        object
            .get("metricDefinitionVersions")
            .ok_or(HandoffErrorCode::InvalidManifest)?,
        &["keywords", "population", "sessions", "time", "tokens"],
    )?;
    for (key, expected) in [
        ("population", "chat-history-analysis.metric.population.v1"),
        ("time", "chat-history-analysis.metric.time.utc-plus-8.v1"),
        ("tokens", "chat-history-analysis.metric.tokens.jieba.v1"),
        (
            "keywords",
            "chat-history-analysis.metric.keywords.log-odds.v1",
        ),
        (
            "sessions",
            "chat-history-analysis.metric.sessions.threshold.v1",
        ),
    ] {
        if string(metrics, key)? != expected {
            return Err(HandoffErrorCode::InvalidManifest);
        }
    }
    let chunks = object
        .get("chunks")
        .and_then(Value::as_array)
        .ok_or(HandoffErrorCode::InvalidManifest)?;
    if chunks.is_empty() || chunks.len() > MAX_CHUNK_COUNT {
        return Err(HandoffErrorCode::LimitExceeded);
    }
    let mut descriptors = Vec::with_capacity(chunks.len());
    let mut total_bytes = 0usize;
    let mut total_records = 0u64;
    for (index, raw) in chunks.iter().enumerate() {
        let item = exact_object(
            raw,
            &["byteSize", "name", "ordinal", "recordCount", "sha256"],
        )?;
        let ordinal = unsigned(item, "ordinal")?;
        let byte_size = usize::try_from(unsigned(item, "byteSize")?)
            .map_err(|_| HandoffErrorCode::LimitExceeded)?;
        let record_count = unsigned(item, "recordCount")?;
        let name = string(item, "name")?.to_string();
        let sha256 = string(item, "sha256")?.to_string();
        if ordinal != index as u64
            || name != format!("chunk-{index:04}.ndjson")
            || byte_size == 0
            || byte_size > MAX_CHUNK_BYTES
            || record_count == 0
            || record_count > MAX_RECORD_COUNT
            || sha256.len() != 64
            || !sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(HandoffErrorCode::InvalidManifest);
        }
        total_bytes = total_bytes
            .checked_add(byte_size)
            .ok_or(HandoffErrorCode::LimitExceeded)?;
        total_records = total_records
            .checked_add(record_count)
            .ok_or(HandoffErrorCode::LimitExceeded)?;
        if total_bytes > MAX_DATASET_BYTES || total_records > MAX_RECORD_COUNT {
            return Err(HandoffErrorCode::LimitExceeded);
        }
        descriptors.push(ChunkDescriptor {
            name,
            byte_size,
            record_count,
            sha256,
        });
    }
    validate_limits(
        object
            .get("limits")
            .ok_or(HandoffErrorCode::InvalidManifest)?,
    )?;
    validate_privacy(
        object
            .get("privacyValidation")
            .ok_or(HandoffErrorCode::InvalidManifest)?,
    )?;
    Ok(descriptors)
}

fn validate_limits(value: &Value) -> Result<(), HandoffErrorCode> {
    let object = exact_object(
        value,
        &[
            "maxChunkBytes",
            "maxChunkCount",
            "maxDatasetBytes",
            "maxEvents",
        ],
    )?;
    if unsigned(object, "maxEvents")? != MAX_RECORD_COUNT
        || unsigned(object, "maxDatasetBytes")? != MAX_DATASET_BYTES as u64
        || unsigned(object, "maxChunkBytes")? != MAX_CHUNK_BYTES as u64
        || unsigned(object, "maxChunkCount")? != MAX_CHUNK_COUNT as u64
    {
        return Err(HandoffErrorCode::InvalidManifest);
    }
    Ok(())
}

fn validate_privacy(value: &Value) -> Result<(), HandoffErrorCode> {
    let object = exact_object(value, &["contentPolicy", "forbiddenFieldCount", "status"])?;
    if string(object, "status")? != "passed"
        || unsigned(object, "forbiddenFieldCount")? != 0
        || string(object, "contentPolicy")? != "eligible-text-only"
    {
        return Err(HandoffErrorCode::InvalidManifest);
    }
    Ok(())
}

fn validate_aggregates(
    manifest: &Value,
    event_count: u64,
    eligible_count: u64,
    system_count: u64,
    unknown_sender_count: u64,
    category_counts: &BTreeMap<String, u64>,
    total_bytes: usize,
    chunk_count: usize,
) -> Result<(), HandoffError> {
    let object = exact_object(
        manifest
            .get("aggregates")
            .ok_or(HandoffErrorCode::InvalidManifest)?,
        &[
            "chunkCount",
            "eligibleTextCount",
            "eventCount",
            "messageCategoryCounts",
            "systemEventCount",
            "totalBytes",
            "unknownSenderCount",
            "userMessageCount",
            "warningCount",
        ],
    )?;
    if unsigned(object, "eventCount")? != event_count
        || unsigned(object, "userMessageCount")? != event_count - system_count
        || unsigned(object, "eligibleTextCount")? != eligible_count
        || unsigned(object, "systemEventCount")? != system_count
        || unsigned(object, "chunkCount")? != chunk_count as u64
        || unsigned(object, "totalBytes")? != total_bytes as u64
        || unsigned(object, "unknownSenderCount")? != unknown_sender_count
    {
        return Err(HandoffError::new(HandoffErrorCode::TamperedDataset));
    }
    let counts = exact_object(
        object
            .get("messageCategoryCounts")
            .ok_or(HandoffErrorCode::InvalidManifest)?,
        &CATEGORIES,
    )?;
    let mut sum = 0u64;
    for category in CATEGORIES {
        let value = unsigned(counts, category)?;
        if value != category_counts.get(category).copied().unwrap_or(0) {
            return Err(HandoffError::new(HandoffErrorCode::TamperedDataset));
        }
        sum = sum
            .checked_add(value)
            .ok_or(HandoffErrorCode::LimitExceeded)?;
    }
    if sum != event_count || event_count == 0 || total_bytes == 0 {
        return Err(HandoffError::new(HandoffErrorCode::TamperedDataset));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct EventValue {
    create_time: u64,
    calendar_date: String,
    sender_scope: Option<String>,
    message_category: String,
    text_eligible: bool,
    source_index: u64,
    file_rank: u64,
}

fn validate_event(value: &Value) -> Result<EventValue, ()> {
    let object = exact_object(value, &EVENT_FIELDS).map_err(|_| ())?;
    let create_time = unsigned(object, "createTime").map_err(|_| ())?;
    let file_rank = unsigned(object, "fileRank").map_err(|_| ())?;
    let source_index = unsigned(object, "sourceIndex").map_err(|_| ())?;
    if create_time > MAX_CREATE_TIME {
        return Err(());
    }
    let formatted_time = string(object, "formattedTime").map_err(|_| ())?;
    let calendar_date = string(object, "calendarDate").map_err(|_| ())?;
    let (expected_formatted, expected_calendar) = expected_time(create_time).ok_or(())?;
    if formatted_time != expected_formatted || calendar_date != expected_calendar {
        return Err(());
    }
    let sender_scope = match object.get("senderScope").ok_or(())? {
        Value::Null => None,
        Value::String(value) if value == "owner" || value == "other" => Some(value.clone()),
        _ => return Err(()),
    };
    let message_category = string(object, "messageCategory").map_err(|_| ())?;
    if !CATEGORIES.contains(&message_category) {
        return Err(());
    }
    let text_eligible = object
        .get("textEligible")
        .and_then(Value::as_bool)
        .ok_or(())?;
    let content = match object.get("content").ok_or(())? {
        Value::Null => None,
        Value::String(value) => Some(value.as_str()),
        _ => return Err(()),
    };
    if message_category == "system" {
        if sender_scope.is_some() || text_eligible || content.is_some() {
            return Err(());
        }
    } else if sender_scope.is_none()
        || content.is_none() != !text_eligible
        || (text_eligible && message_category != "text")
        || (text_eligible
            && content.is_none_or(|value| {
                value.is_empty() || value.contains('\0') || contains_forbidden_content(value)
            }))
    {
        return Err(());
    }
    Ok(EventValue {
        create_time,
        calendar_date: calendar_date.to_string(),
        sender_scope,
        message_category: message_category.to_string(),
        text_eligible,
        source_index,
        file_rank,
    })
}

fn contains_forbidden_content(value: &str) -> bool {
    let lowercase = value.to_ascii_lowercase();
    lowercase.contains("http://")
        || lowercase.contains("https://")
        || lowercase.contains("www.")
        || value.contains('<')
}

fn expected_time(seconds: u64) -> Option<(String, String)> {
    let local_seconds = seconds.checked_add(8 * 60 * 60)?;
    let days = (local_seconds / 86_400) as i64;
    let remaining = local_seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    if !(0..=9999).contains(&year) {
        return None;
    }
    let hour = remaining / 3_600;
    let minute = (remaining % 3_600) / 60;
    let second = remaining % 60;
    Some((
        format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}"),
        format!("{year:04}-{month:02}-{day:02}"),
    ))
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn exact_object<'a>(
    value: &'a Value,
    expected: &[&str],
) -> Result<&'a Map<String, Value>, HandoffErrorCode> {
    let object = value.as_object().ok_or(HandoffErrorCode::InvalidManifest)?;
    if object.len() != expected.len() || !expected.iter().all(|key| object.contains_key(*key)) {
        return Err(HandoffErrorCode::InvalidManifest);
    }
    Ok(object)
}

fn string<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a str, HandoffErrorCode> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or(HandoffErrorCode::InvalidManifest)
}

fn unsigned(object: &Map<String, Value>, key: &str) -> Result<u64, HandoffErrorCode> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value <= 9_007_199_254_740_991)
        .ok_or(HandoffErrorCode::InvalidManifest)
}

fn valid_session_id(value: &str) -> bool {
    value.len() == 36
        && value.starts_with("ses_")
        && value[4..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn absolute_no_parent(path: &Path) -> bool {
    path.is_absolute()
        && path.to_str().is_some()
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
}

fn path_has_no_symlink_components(path: &Path) -> bool {
    if !absolute_no_parent(path) {
        return false;
    }
    let mut current = Path::new("").to_path_buf();
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
            Err(_) => return false,
        }
    }
    true
}

fn secure_directory(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
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

fn secure_regular_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    secure_regular_metadata(&metadata)
}

fn secure_regular_metadata(metadata: &fs::Metadata) -> bool {
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

fn read_private_file(path: &Path, maximum: usize) -> Result<Vec<u8>, ()> {
    if !secure_regular_file(path) {
        return Err(());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|_| ())?;
    let metadata = file.metadata().map_err(|_| ())?;
    if !secure_regular_metadata(&metadata) || metadata.len() > maximum as u64 {
        return Err(());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes).map_err(|_| ())?;
    if bytes.len() > maximum {
        return Err(());
    }
    Ok(bytes)
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_json_without_duplicates(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = DuplicateRejectSeed
        .deserialize(&mut deserializer)
        .map_err(|error| {
            serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                error.to_string(),
            ))
        })?;
    deserializer.end()?;
    Ok(value)
}

struct DuplicateRejectSeed;

impl<'de> DeserializeSeed<'de> for DuplicateRejectSeed {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(DuplicateRejectVisitor)
    }
}

struct DuplicateRejectVisitor;

impl<'de> Visitor<'de> for DuplicateRejectVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value without duplicate object keys")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Value::Null)
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("non-finite number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(Value::String(value.to_string()))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(Value::String(value))
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(DuplicateRejectSeed)? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(de::Error::custom("duplicate object key"));
            }
            let value = map.next_value_seed(DuplicateRejectSeed)?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

#[cfg(unix)]
unsafe fn libc_getuid() -> u32 {
    unsafe extern "C" {
        fn getuid() -> u32;
    }
    unsafe { getuid() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (PathBuf, String) {
        let root = std::env::temp_dir().join(format!(
            "chat-history-handoff-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let sessions = root.join(ANALYSIS_SESSIONS_DIRECTORY);
        let session_id = "ses_00000000000000000000000000000001".to_string();
        let session = sessions.join(&session_id);
        let normalized = session.join(NORMALIZED_DIRECTORY);
        fs::create_dir_all(&normalized).expect("directories");
        set_private(&root);
        set_private(&sessions);
        set_private(&session);
        set_private(&normalized);
        write_private(
            &session.join(SESSION_MARKER),
            b"chat-history-analysis-session-v1\n",
        );
        write_private(
            &session.join(SESSION_STATE),
            format!("sessionId={session_id}\ngeneration=1\n").as_bytes(),
        );
        let chunk = br#"{"createTime":1735689600,"formattedTime":"2025-01-01 08:00:00","calendarDate":"2025-01-01","senderScope":"owner","messageCategory":"text","textEligible":true,"content":"synthetic","fileRank":0,"sourceIndex":0}
"#;
        write_private(&normalized.join("chunk-0000.ndjson"), chunk);
        let digest = hex_digest(chunk);
        let manifest = format!(
            "{{\"schemaVersion\":\"chat-history-analysis.manifest.v2\",\"canonicalSchemaVersion\":\"chat-history-analysis.canonical-event.v2\",\"preprocessorVersion\":\"0.1.0\",\"timePolicy\":\"UTC+08:00\",\"metricDefinitionVersions\":{{\"population\":\"chat-history-analysis.metric.population.v1\",\"time\":\"chat-history-analysis.metric.time.utc-plus-8.v1\",\"tokens\":\"chat-history-analysis.metric.tokens.jieba.v1\",\"keywords\":\"chat-history-analysis.metric.keywords.log-odds.v1\",\"sessions\":\"chat-history-analysis.metric.sessions.threshold.v1\"}},\"chunks\":[{{\"ordinal\":0,\"name\":\"chunk-0000.ndjson\",\"byteSize\":{},\"recordCount\":1,\"sha256\":\"{}\"}}],\"aggregates\":{{\"eventCount\":1,\"userMessageCount\":1,\"eligibleTextCount\":1,\"systemEventCount\":0,\"chunkCount\":1,\"totalBytes\":{},\"warningCount\":0,\"messageCategoryCounts\":{{\"text\":1,\"image\":0,\"voice\":0,\"video\":0,\"file\":0,\"animated-emoji\":0,\"structured\":0,\"location\":0,\"call\":0,\"mini-program\":0,\"reply\":0,\"contact-card\":0,\"system\":0,\"other\":0,\"unknown\":0}},\"unknownSenderCount\":0}},\"limits\":{{\"maxEvents\":2000000,\"maxDatasetBytes\":536870912,\"maxChunkBytes\":33554432,\"maxChunkCount\":16384}},\"privacyValidation\":{{\"status\":\"passed\",\"forbiddenFieldCount\":0,\"contentPolicy\":\"eligible-text-only\"}}}}\n",
            chunk.len(),
            digest,
            chunk.len()
        );
        write_private(&normalized.join(MANIFEST_NAME), manifest.as_bytes());
        (root, session_id)
    }

    fn set_private(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).expect("directory mode");
        }
    }

    fn write_private(path: &Path, bytes: &[u8]) {
        let mut file = fs::File::create(path).expect("file");
        file.write_all(bytes).expect("bytes");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).expect("file mode");
        }
    }

    #[test]
    fn valid_handoff_is_opaque_and_tamper_or_extra_entries_fail() {
        let (root, session_id) = fixture();
        let session = root.join(ANALYSIS_SESSIONS_DIRECTORY).join(&session_id);
        let verified = verify_session_dataset(&session, &session_id, 1).expect("valid handoff");
        assert_eq!(verified.record_count, 1);
        assert_eq!(verified.chunk_count, 1);
        assert_eq!(verified.minimum_calendar_date, "2025-01-01");
        assert!(!format!("{verified:?}").contains(root.to_string_lossy().as_ref()));
        let chunk = session.join(NORMALIZED_DIRECTORY).join("chunk-0000.ndjson");
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(&chunk)
            .expect("append");
        file.write_all(b"tamper\n").expect("tamper");
        assert_eq!(
            verify_session_dataset(&session, &session_id, 1)
                .unwrap_err()
                .code,
            HandoffErrorCode::TamperedDataset
        );
        fs::remove_file(chunk).expect("remove chunk");
        fs::remove_file(session.join(NORMALIZED_DIRECTORY).join(MANIFEST_NAME))
            .expect("remove manifest");
        fs::remove_dir(session.join(NORMALIZED_DIRECTORY)).expect("remove normalized");
        fs::remove_file(session.join(SESSION_MARKER)).expect("remove marker");
        fs::remove_file(session.join(SESSION_STATE)).expect("remove state");
        fs::remove_dir(session).expect("remove session");
        fs::remove_dir(root.join(ANALYSIS_SESSIONS_DIRECTORY)).expect("remove sessions");
        fs::remove_dir(root).expect("remove root");
    }
}
