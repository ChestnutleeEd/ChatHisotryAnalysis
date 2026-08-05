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
#[cfg(test)]
use std::fs;
use std::path::Path;

use crate::dataset_transport::{
    MAX_CHUNK_BYTES, MAX_CHUNK_COUNT, MAX_DATASET_BYTES, MAX_MANIFEST_BYTES, MAX_RECORD_COUNT,
};
use crate::session_supervisor::ANALYSIS_SESSIONS_DIRECTORY;

const MANIFEST_NAME: &str = "manifest.json";
const PUBLICATION_MARKER_NAME: &str = ".canonical-dataset-complete-v2";
const PUBLICATION_MARKER: &[u8] = b"chat-history-analysis-canonical-dataset-v2-complete\n";
const SESSION_MARKER: &str = ".session-marker";
const SESSION_STATE: &str = "session-state";
#[cfg(test)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandoffReasonCode {
    ManifestSchemaInvalid,
    SchemaVersionMismatch,
    PublicationIncomplete,
    ChunkMissing,
    ChunkSequenceInvalid,
    ChunkCountMismatch,
    EventCountMismatch,
    ByteCountMismatch,
    HashMismatch,
    EventOrderInvalid,
    DuplicateIdentityInvalid,
    TimezoneInvalid,
    SourceCountMismatch,
    DatasetLimitExceeded,
    SessionStale,
    StorageIdentityInvalid,
    ChunkSchemaInvalid,
}

impl HandoffReasonCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ManifestSchemaInvalid => "HANDOFF_MANIFEST_SCHEMA_INVALID",
            Self::SchemaVersionMismatch => "HANDOFF_SCHEMA_VERSION_MISMATCH",
            Self::PublicationIncomplete => "HANDOFF_PUBLICATION_INCOMPLETE",
            Self::ChunkMissing => "HANDOFF_CHUNK_MISSING",
            Self::ChunkSequenceInvalid => "HANDOFF_CHUNK_SEQUENCE_INVALID",
            Self::ChunkCountMismatch => "HANDOFF_CHUNK_COUNT_MISMATCH",
            Self::EventCountMismatch => "HANDOFF_EVENT_COUNT_MISMATCH",
            Self::ByteCountMismatch => "HANDOFF_BYTE_COUNT_MISMATCH",
            Self::HashMismatch => "HANDOFF_HASH_MISMATCH",
            Self::EventOrderInvalid => "HANDOFF_EVENT_ORDER_INVALID",
            Self::DuplicateIdentityInvalid => "HANDOFF_DUPLICATE_IDENTITY_INVALID",
            Self::TimezoneInvalid => "HANDOFF_TIMEZONE_INVALID",
            Self::SourceCountMismatch => "HANDOFF_SOURCE_COUNT_MISMATCH",
            Self::DatasetLimitExceeded => "HANDOFF_DATASET_LIMIT_EXCEEDED",
            Self::SessionStale => "HANDOFF_SESSION_STALE",
            Self::StorageIdentityInvalid => "HANDOFF_STORAGE_IDENTITY_INVALID",
            Self::ChunkSchemaInvalid => "HANDOFF_CHUNK_SCHEMA_INVALID",
        }
    }
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
    pub reason: HandoffReasonCode,
}

impl fmt::Debug for HandoffError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HandoffError")
            .field("code", &self.code)
            .field("reason", &self.reason)
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
        Self {
            code,
            reason: default_reason(code),
        }
    }

    const fn with_reason(code: HandoffErrorCode, reason: HandoffReasonCode) -> Self {
        Self { code, reason }
    }

    pub const fn reason_code(self) -> &'static str {
        self.reason.as_str()
    }
}

const fn default_reason(code: HandoffErrorCode) -> HandoffReasonCode {
    match code {
        HandoffErrorCode::InvalidSession => HandoffReasonCode::SessionStale,
        HandoffErrorCode::UnsafeSessionRoot => HandoffReasonCode::StorageIdentityInvalid,
        HandoffErrorCode::MissingEntry => HandoffReasonCode::ChunkMissing,
        HandoffErrorCode::ExtraEntry => HandoffReasonCode::PublicationIncomplete,
        HandoffErrorCode::InvalidManifest => HandoffReasonCode::ManifestSchemaInvalid,
        HandoffErrorCode::InvalidChunk => HandoffReasonCode::ChunkSchemaInvalid,
        HandoffErrorCode::TamperedDataset => HandoffReasonCode::HashMismatch,
        HandoffErrorCode::LimitExceeded => HandoffReasonCode::DatasetLimitExceeded,
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
    pub source_count: u64,
    pub raw_accepted_event_count: u64,
    pub duplicate_event_count: u64,
}

/// Verify exactly the session's normalized directory and return opaque bytes.
pub fn verify_session_dataset(
    session_root: &Path,
    session_id: &str,
    generation: u64,
) -> Result<VerifiedHandoff, HandoffError> {
    if !valid_session_id(session_id) || generation == 0 {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::InvalidSession,
            HandoffReasonCode::SessionStale,
        ));
    }
    if session_root.file_name().and_then(|value| value.to_str()) != Some(session_id)
        || session_root
            .parent()
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str())
            != Some(ANALYSIS_SESSIONS_DIRECTORY)
        || !absolute_no_parent(session_root)
    {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::UnsafeSessionRoot,
            HandoffReasonCode::StorageIdentityInvalid,
        ));
    }
    let application_cache_root = session_root
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| {
            HandoffError::with_reason(
                HandoffErrorCode::UnsafeSessionRoot,
                HandoffReasonCode::StorageIdentityInvalid,
            )
        })?;
    let storage =
        crate::secure_storage::SecureStorage::new(application_cache_root).map_err(|_| {
            HandoffError::with_reason(
                HandoffErrorCode::UnsafeSessionRoot,
                HandoffReasonCode::StorageIdentityInvalid,
            )
        })?;
    verify_session_marker(&storage, session_id, generation)?;
    let publication_marker = storage
        .read_normalized_entry(
            session_id,
            PUBLICATION_MARKER_NAME,
            PUBLICATION_MARKER.len(),
        )
        .map_err(|_| {
            HandoffError::with_reason(
                HandoffErrorCode::MissingEntry,
                HandoffReasonCode::PublicationIncomplete,
            )
        })?;
    if publication_marker != PUBLICATION_MARKER {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::InvalidChunk,
            HandoffReasonCode::PublicationIncomplete,
        ));
    }
    let manifest = storage
        .read_normalized_entry(session_id, MANIFEST_NAME, MAX_MANIFEST_BYTES)
        .map_err(|_| {
            HandoffError::with_reason(
                HandoffErrorCode::MissingEntry,
                HandoffReasonCode::PublicationIncomplete,
            )
        })?;
    if !manifest.ends_with(b"\n") || manifest.starts_with(b"\xef\xbb\xbf") {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::InvalidManifest,
            HandoffReasonCode::ManifestSchemaInvalid,
        ));
    }
    let manifest_value =
        parse_json_without_duplicates(&manifest[..manifest.len() - 1]).map_err(|_| {
            HandoffError::with_reason(
                HandoffErrorCode::InvalidManifest,
                HandoffReasonCode::ManifestSchemaInvalid,
            )
        })?;
    let descriptors = validate_manifest(&manifest_value)
        .map_err(|code| HandoffError::with_reason(code, manifest_reason(&manifest_value, code)))?;

    let expected_names = std::iter::once(MANIFEST_NAME.to_string())
        .chain(std::iter::once(PUBLICATION_MARKER_NAME.to_string()))
        .chain(descriptors.iter().map(|descriptor| descriptor.name.clone()))
        .collect::<BTreeSet<_>>();
    let observed_names = storage
        .list_normalized_entries(session_id)
        .map_err(|_| {
            HandoffError::with_reason(
                HandoffErrorCode::UnsafeSessionRoot,
                HandoffReasonCode::StorageIdentityInvalid,
            )
        })?
        .into_iter()
        .collect::<BTreeSet<_>>();
    if observed_names != expected_names {
        let code = if expected_names.is_superset(&observed_names) {
            HandoffErrorCode::MissingEntry
        } else {
            HandoffErrorCode::ExtraEntry
        };
        let reason = if !observed_names.contains(PUBLICATION_MARKER_NAME) {
            HandoffReasonCode::PublicationIncomplete
        } else if expected_names.is_superset(&observed_names) {
            HandoffReasonCode::ChunkMissing
        } else {
            HandoffReasonCode::PublicationIncomplete
        };
        return Err(HandoffError::with_reason(code, reason));
    }

    let descriptor_count = descriptors.len();
    let mut chunks = Vec::with_capacity(descriptor_count);
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
        let bytes = storage
            .read_normalized_entry(session_id, &descriptor.name, MAX_CHUNK_BYTES)
            .map_err(|_| {
                HandoffError::with_reason(
                    HandoffErrorCode::MissingEntry,
                    HandoffReasonCode::ChunkMissing,
                )
            })?;
        if bytes.len() != descriptor.byte_size {
            return Err(HandoffError::with_reason(
                HandoffErrorCode::TamperedDataset,
                HandoffReasonCode::ByteCountMismatch,
            ));
        }
        if hex_digest(&bytes) != descriptor.sha256 {
            return Err(HandoffError::with_reason(
                HandoffErrorCode::TamperedDataset,
                HandoffReasonCode::HashMismatch,
            ));
        }
        let mut descriptor_count = 0u64;
        for line in bytes.split_inclusive(|byte| *byte == b'\n') {
            if line.is_empty() || !line.ends_with(b"\n") || line == b"\n" {
                return Err(HandoffError::with_reason(
                    HandoffErrorCode::InvalidChunk,
                    HandoffReasonCode::ChunkSchemaInvalid,
                ));
            }
            let value = parse_json_without_duplicates(&line[..line.len() - 1]).map_err(|_| {
                HandoffError::with_reason(
                    HandoffErrorCode::InvalidChunk,
                    HandoffReasonCode::ChunkSchemaInvalid,
                )
            })?;
            let event = validate_event(&value).map_err(|_| {
                HandoffError::with_reason(HandoffErrorCode::InvalidChunk, event_reason(&value))
            })?;
            if event.source_index != event_count {
                return Err(HandoffError::with_reason(
                    HandoffErrorCode::InvalidChunk,
                    HandoffReasonCode::EventOrderInvalid,
                ));
            }
            let order = (event.create_time, event.file_rank, event.source_index);
            if previous_order.is_some_and(|previous| order < previous) {
                return Err(HandoffError::with_reason(
                    HandoffErrorCode::InvalidChunk,
                    HandoffReasonCode::EventOrderInvalid,
                ));
            }
            previous_order = Some(order);
            event_count = event_count.checked_add(1).ok_or_else(|| {
                HandoffError::with_reason(
                    HandoffErrorCode::LimitExceeded,
                    HandoffReasonCode::DatasetLimitExceeded,
                )
            })?;
            descriptor_count = descriptor_count.checked_add(1).ok_or_else(|| {
                HandoffError::with_reason(
                    HandoffErrorCode::LimitExceeded,
                    HandoffReasonCode::DatasetLimitExceeded,
                )
            })?;
            if event_count > MAX_RECORD_COUNT {
                return Err(HandoffError::with_reason(
                    HandoffErrorCode::LimitExceeded,
                    HandoffReasonCode::DatasetLimitExceeded,
                ));
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
                .ok_or_else(|| {
                    HandoffError::with_reason(
                        HandoffErrorCode::InvalidChunk,
                        HandoffReasonCode::ChunkSchemaInvalid,
                    )
                })? += 1;
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
            return Err(HandoffError::with_reason(
                HandoffErrorCode::TamperedDataset,
                HandoffReasonCode::EventCountMismatch,
            ));
        }
        chunks.push(bytes);
    }
    if event_count == 0 {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::InvalidManifest,
            HandoffReasonCode::EventCountMismatch,
        ));
    }
    validate_aggregates(
        &manifest_value,
        event_count,
        eligible_count,
        system_count,
        unknown_sender_count,
        &category_counts,
        chunks.iter().map(Vec::len).sum(),
        descriptor_count,
    )?;
    Ok(VerifiedHandoff {
        manifest,
        chunks,
        record_count: event_count,
        chunk_count: descriptor_count as u64,
        minimum_calendar_date: minimum_date.expect("event count checked"),
        maximum_calendar_date: maximum_date.expect("event count checked"),
        pseudonymous: true,
        source_count: unsigned(
            manifest_value
                .get("publicationCounts")
                .and_then(Value::as_object)
                .expect("validated publication counts"),
            "sourceCount",
        )
        .expect("validated source count"),
        raw_accepted_event_count: unsigned(
            manifest_value
                .get("publicationCounts")
                .and_then(Value::as_object)
                .expect("validated publication counts"),
            "rawAcceptedEventCount",
        )
        .expect("validated raw accepted count"),
        duplicate_event_count: unsigned(
            manifest_value
                .get("publicationCounts")
                .and_then(Value::as_object)
                .expect("validated publication counts"),
            "duplicateEventCount",
        )
        .expect("validated duplicate count"),
    })
}

fn verify_session_marker(
    storage: &crate::secure_storage::SecureStorage,
    session_id: &str,
    generation: u64,
) -> Result<(), HandoffError> {
    let marker = storage
        .read_session_entry(session_id, SESSION_MARKER, 128)
        .map_err(|_| {
            HandoffError::with_reason(
                HandoffErrorCode::MissingEntry,
                HandoffReasonCode::SessionStale,
            )
        })?;
    if marker != b"chat-history-analysis-session-v1\n" {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::UnsafeSessionRoot,
            HandoffReasonCode::StorageIdentityInvalid,
        ));
    }
    let state = storage
        .read_session_entry(session_id, SESSION_STATE, 256)
        .map_err(|_| {
            HandoffError::with_reason(
                HandoffErrorCode::MissingEntry,
                HandoffReasonCode::SessionStale,
            )
        })?;
    let state = std::str::from_utf8(&state).map_err(|_| {
        HandoffError::with_reason(
            HandoffErrorCode::UnsafeSessionRoot,
            HandoffReasonCode::StorageIdentityInvalid,
        )
    })?;
    if state != format!("sessionId={session_id}\ngeneration={generation}\n") {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::InvalidSession,
            HandoffReasonCode::SessionStale,
        ));
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
            "publicationCounts",
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
    if chunks.is_empty() {
        return Err(HandoffErrorCode::InvalidManifest);
    }
    if chunks.len() > MAX_CHUNK_COUNT {
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
    validate_publication_counts(
        object
            .get("publicationCounts")
            .ok_or(HandoffErrorCode::InvalidManifest)?,
        total_records,
    )?;
    Ok(descriptors)
}

fn validate_publication_counts(
    value: &Value,
    canonical_event_count: u64,
) -> Result<(), HandoffErrorCode> {
    let object = exact_object(
        value,
        &[
            "canonicalEventCount",
            "duplicateEventCount",
            "rawAcceptedEventCount",
            "sourceCount",
        ],
    )?;
    let source_count = unsigned(object, "sourceCount")?;
    let raw_accepted = unsigned(object, "rawAcceptedEventCount")?;
    let canonical = unsigned(object, "canonicalEventCount")?;
    let duplicate = unsigned(object, "duplicateEventCount")?;
    if source_count == 0
        || raw_accepted == 0
        || canonical != canonical_event_count
        || raw_accepted > MAX_RECORD_COUNT
        || raw_accepted != canonical.saturating_add(duplicate)
    {
        return Err(HandoffErrorCode::InvalidManifest);
    }
    Ok(())
}

fn manifest_reason(value: &Value, code: HandoffErrorCode) -> HandoffReasonCode {
    if code == HandoffErrorCode::LimitExceeded {
        return HandoffReasonCode::DatasetLimitExceeded;
    }
    let Some(object) = value.as_object() else {
        return HandoffReasonCode::ManifestSchemaInvalid;
    };
    if object.get("schemaVersion").and_then(Value::as_str) != Some(CANONICAL_MANIFEST_VERSION)
        || object.get("canonicalSchemaVersion").and_then(Value::as_str)
            != Some(CANONICAL_EVENT_VERSION)
        || object.get("preprocessorVersion").and_then(Value::as_str) != Some(PREPROCESSOR_VERSION)
    {
        return HandoffReasonCode::SchemaVersionMismatch;
    }
    if object.get("timePolicy").and_then(Value::as_str) != Some(TIME_POLICY) {
        return HandoffReasonCode::TimezoneInvalid;
    }
    if let Some(chunks) = object.get("chunks").and_then(Value::as_array) {
        if chunks.is_empty() {
            return HandoffReasonCode::ChunkCountMismatch;
        }
        for (index, chunk) in chunks.iter().enumerate() {
            let Some(chunk) = chunk.as_object() else {
                return HandoffReasonCode::ManifestSchemaInvalid;
            };
            let expected_name = format!("chunk-{index:04}.ndjson");
            if chunk.get("ordinal").and_then(Value::as_u64) != Some(index as u64)
                || chunk.get("name").and_then(Value::as_str) != Some(expected_name.as_str())
            {
                return HandoffReasonCode::ChunkSequenceInvalid;
            }
        }
    }
    if let Some(publication) = object.get("publicationCounts") {
        let canonical_event_count = object
            .get("chunks")
            .and_then(Value::as_array)
            .map(|chunks| {
                chunks
                    .iter()
                    .filter_map(|chunk| chunk.get("recordCount").and_then(Value::as_u64))
                    .sum()
            })
            .unwrap_or(0);
        let reason = publication_reason(publication, canonical_event_count);
        if reason != HandoffReasonCode::ManifestSchemaInvalid {
            return reason;
        }
    }
    HandoffReasonCode::ManifestSchemaInvalid
}

fn publication_reason(value: &Value, canonical_event_count: u64) -> HandoffReasonCode {
    let Some(object) = value.as_object() else {
        return HandoffReasonCode::ManifestSchemaInvalid;
    };
    let Some(source_count) = object.get("sourceCount").and_then(Value::as_u64) else {
        return HandoffReasonCode::ManifestSchemaInvalid;
    };
    let Some(raw_accepted) = object.get("rawAcceptedEventCount").and_then(Value::as_u64) else {
        return HandoffReasonCode::ManifestSchemaInvalid;
    };
    let Some(canonical) = object.get("canonicalEventCount").and_then(Value::as_u64) else {
        return HandoffReasonCode::ManifestSchemaInvalid;
    };
    let Some(duplicate) = object.get("duplicateEventCount").and_then(Value::as_u64) else {
        return HandoffReasonCode::ManifestSchemaInvalid;
    };
    if source_count == 0 {
        return HandoffReasonCode::SourceCountMismatch;
    }
    if canonical != canonical_event_count {
        return HandoffReasonCode::EventCountMismatch;
    }
    if raw_accepted == 0 || raw_accepted > MAX_RECORD_COUNT {
        return HandoffReasonCode::DatasetLimitExceeded;
    }
    if raw_accepted != canonical.saturating_add(duplicate) {
        return HandoffReasonCode::DuplicateIdentityInvalid;
    }
    HandoffReasonCode::ManifestSchemaInvalid
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
        || unsigned(object, "unknownSenderCount")? != unknown_sender_count
    {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::TamperedDataset,
            HandoffReasonCode::EventCountMismatch,
        ));
    }
    if unsigned(object, "chunkCount")? != chunk_count as u64 {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::TamperedDataset,
            HandoffReasonCode::ChunkCountMismatch,
        ));
    }
    if unsigned(object, "totalBytes")? != total_bytes as u64 {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::TamperedDataset,
            HandoffReasonCode::ByteCountMismatch,
        ));
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
            return Err(HandoffError::with_reason(
                HandoffErrorCode::TamperedDataset,
                HandoffReasonCode::EventCountMismatch,
            ));
        }
        sum = sum
            .checked_add(value)
            .ok_or(HandoffErrorCode::LimitExceeded)?;
    }
    if sum != event_count || event_count == 0 || total_bytes == 0 {
        return Err(HandoffError::with_reason(
            HandoffErrorCode::TamperedDataset,
            HandoffReasonCode::EventCountMismatch,
        ));
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

fn event_reason(value: &Value) -> HandoffReasonCode {
    let Some(object) = value.as_object() else {
        return HandoffReasonCode::ChunkSchemaInvalid;
    };
    let Some(create_time) = object.get("createTime").and_then(Value::as_u64) else {
        return HandoffReasonCode::ChunkSchemaInvalid;
    };
    let Some((expected_formatted, expected_calendar)) = expected_time(create_time) else {
        return HandoffReasonCode::TimezoneInvalid;
    };
    let formatted = object.get("formattedTime").and_then(Value::as_str);
    let calendar = object.get("calendarDate").and_then(Value::as_str);
    if formatted.is_some_and(|value| value != expected_formatted)
        || calendar.is_some_and(|value| value != expected_calendar)
    {
        return HandoffReasonCode::TimezoneInvalid;
    }
    HandoffReasonCode::ChunkSchemaInvalid
}

fn contains_forbidden_content(value: &str) -> bool {
    contains_url_like(value) || contains_xml_like(value)
}

fn contains_url_like(value: &str) -> bool {
    for (index, _) in value.char_indices() {
        let previous = value[..index].chars().next_back();
        if previous.is_some_and(|character| character.is_ascii_alphanumeric() || character == '_') {
            continue;
        }
        let rest = &value[index..];
        let prefix_length = ["https://", "http://", "www."]
            .into_iter()
            .find(|prefix| {
                rest.get(..prefix.len())
                    .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
            })
            .map(str::len);
        let Some(prefix_length) = prefix_length else {
            continue;
        };
        if rest[prefix_length..]
            .chars()
            .next()
            .is_some_and(|character| {
                !character.is_whitespace()
                    && character != '<'
                    && character != '>'
                    && character != '"'
                    && character != '\''
            })
        {
            return true;
        }
    }
    false
}

fn contains_xml_like(value: &str) -> bool {
    for (index, _) in value.match_indices('<') {
        let rest = value[index + 1..].trim_start_matches(char::is_whitespace);
        if rest.starts_with('!') || rest.starts_with('?') {
            return true;
        }
        let rest = rest.strip_prefix('/').unwrap_or(rest);
        let mut name_length = 0usize;
        for character in rest.chars() {
            if name_length == 0 {
                if !(character.is_ascii_alphabetic() || character == '_') {
                    break;
                }
            } else if !(character.is_ascii_alphanumeric()
                || matches!(character, '_' | '.' | ':' | '-'))
            {
                break;
            }
            name_length += character.len_utf8();
        }
        if name_length > 0
            && rest[name_length..].chars().next().is_some_and(|character| {
                character.is_whitespace() || character == '/' || character == '>'
            })
        {
            return true;
        }
    }
    false
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
        write_private(
            &normalized.join(PUBLICATION_MARKER_NAME),
            PUBLICATION_MARKER,
        );
        let chunk = br#"{"createTime":1735689600,"formattedTime":"2025-01-01 08:00:00","calendarDate":"2025-01-01","senderScope":"owner","messageCategory":"text","textEligible":true,"content":"synthetic","fileRank":0,"sourceIndex":0}
"#;
        write_private(&normalized.join("chunk-0000.ndjson"), chunk);
        let digest = hex_digest(chunk);
        let manifest = format!(
            "{{\"schemaVersion\":\"chat-history-analysis.manifest.v2\",\"canonicalSchemaVersion\":\"chat-history-analysis.canonical-event.v2\",\"preprocessorVersion\":\"0.1.0\",\"timePolicy\":\"UTC+08:00\",\"metricDefinitionVersions\":{{\"population\":\"chat-history-analysis.metric.population.v1\",\"time\":\"chat-history-analysis.metric.time.utc-plus-8.v1\",\"tokens\":\"chat-history-analysis.metric.tokens.jieba.v1\",\"keywords\":\"chat-history-analysis.metric.keywords.log-odds.v1\",\"sessions\":\"chat-history-analysis.metric.sessions.threshold.v1\"}},\"publicationCounts\":{{\"sourceCount\":1,\"rawAcceptedEventCount\":1,\"canonicalEventCount\":1,\"duplicateEventCount\":0}},\"chunks\":[{{\"ordinal\":0,\"name\":\"chunk-0000.ndjson\",\"byteSize\":{},\"recordCount\":1,\"sha256\":\"{}\"}}],\"aggregates\":{{\"eventCount\":1,\"userMessageCount\":1,\"eligibleTextCount\":1,\"systemEventCount\":0,\"chunkCount\":1,\"totalBytes\":{},\"warningCount\":0,\"messageCategoryCounts\":{{\"text\":1,\"image\":0,\"voice\":0,\"video\":0,\"file\":0,\"animated-emoji\":0,\"structured\":0,\"location\":0,\"call\":0,\"mini-program\":0,\"reply\":0,\"contact-card\":0,\"system\":0,\"other\":0,\"unknown\":0}},\"unknownSenderCount\":0}},\"limits\":{{\"maxEvents\":2000000,\"maxDatasetBytes\":536870912,\"maxChunkBytes\":33554432,\"maxChunkCount\":16384}},\"privacyValidation\":{{\"status\":\"passed\",\"forbiddenFieldCount\":0,\"contentPolicy\":\"eligible-text-only\"}}}}\n",
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
    fn canonical_content_policy_allows_literal_comparison_delimiter() {
        let value = serde_json::json!({
            "createTime": 1735689600,
            "formattedTime": "2025-01-01 08:00:00",
            "calendarDate": "2025-01-01",
            "senderScope": "owner",
            "messageCategory": "text",
            "textEligible": true,
            "content": "synthetic 1 < 2",
            "fileRank": 0,
            "sourceIndex": 0,
        });
        validate_event(&value).expect("literal comparison delimiter is not XML-like");
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
        let original = fs::read(&chunk).expect("read chunk");
        let mut tampered = original.clone();
        let offset = tampered
            .windows(b"synthetic".len())
            .position(|window| window == b"synthetic")
            .expect("synthetic fixture content");
        tampered[offset] = b't';
        let mut file = fs::OpenOptions::new()
            .write(true)
            .open(&chunk)
            .expect("open chunk");
        file.write_all(&tampered).expect("tamper");
        let tamper_error = verify_session_dataset(&session, &session_id, 1).unwrap_err();
        assert_eq!(tamper_error.code, HandoffErrorCode::TamperedDataset);
        assert_eq!(tamper_error.reason_code(), "HANDOFF_HASH_MISMATCH");
        fs::remove_file(chunk).expect("remove chunk");
        fs::remove_file(session.join(NORMALIZED_DIRECTORY).join(MANIFEST_NAME))
            .expect("remove manifest");
        fs::remove_file(
            session
                .join(NORMALIZED_DIRECTORY)
                .join(PUBLICATION_MARKER_NAME),
        )
        .expect("remove publication marker");
        fs::remove_dir(session.join(NORMALIZED_DIRECTORY)).expect("remove normalized");
        fs::remove_file(session.join(SESSION_MARKER)).expect("remove marker");
        fs::remove_file(session.join(SESSION_STATE)).expect("remove state");
        fs::remove_dir(session).expect("remove session");
        fs::remove_dir(root.join(ANALYSIS_SESSIONS_DIRECTORY)).expect("remove sessions");
        fs::remove_dir(root).expect("remove root");
    }
}
