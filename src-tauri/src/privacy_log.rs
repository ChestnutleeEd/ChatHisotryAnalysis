//! Content-free structured logging for the desktop Alpha.
//!
//! The public event type has no free-text field.  Stable enums, bounded
//! aggregate counts, duration buckets, version constants, and a validated
//! session-local correlation ID are the complete logging surface.  The
//! production logger returns a line to the caller; it never creates a
//! persistent log file.

use serde::Serialize;
use std::fmt;
use std::sync::{Arc, Mutex};

pub const LOG_SCHEMA_VERSION: &str = "chat-history-analysis.privacy-log.v1";
pub const MAX_LOG_AGGREGATE_COUNT: u64 = 2_000_000;
pub const MAX_LOG_LINES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LogCode {
    StartupRecovery,
    SessionStarted,
    SessionCancelled,
    WorkerReleased,
    SidecarEscalated,
    CleanupStarted,
    CleanupComplete,
    CleanupRequired,
    ExportStarted,
    ExportCancelled,
    ExportComplete,
    ExportFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LogPhase {
    Startup,
    Selection,
    Preprocessing,
    Handoff,
    Analysis,
    Cleanup,
    Export,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LogState {
    Idle,
    Running,
    Cancelling,
    Complete,
    Failed,
    Closing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DurationBucket {
    Immediate,
    Short,
    Medium,
    Long,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorrelationId(String);

impl CorrelationId {
    pub fn new(value: impl Into<String>) -> Option<Self> {
        let value = value.into();
        (value.len() == 36
            && value.starts_with("cor_")
            && value[4..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()))
        .then_some(Self(value))
    }

    pub fn random() -> Option<Self> {
        let mut bytes = [0u8; 16];
        #[cfg(unix)]
        {
            use std::io::Read;
            std::fs::File::open("/dev/urandom")
                .and_then(|mut file| file.read_exact(&mut bytes))
                .ok()?;
        }
        #[cfg(not(unix))]
        {
            let _ = bytes;
            return None;
        }
        let mut value = String::from("cor_");
        for byte in bytes {
            value.push_str(&format!("{byte:02x}"));
        }
        Some(Self(value))
    }

    #[cfg(test)]
    pub fn synthetic() -> Self {
        Self("cor_00000000000000000000000000000001".to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for CorrelationId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyLogEvent {
    pub schema_version: &'static str,
    pub code: LogCode,
    pub phase: LogPhase,
    pub state: LogState,
    pub correlation_id: CorrelationId,
    pub aggregate_count: u64,
    pub duration_bucket: DurationBucket,
    pub cleanup_status: Option<CleanupStatus>,
    pub build_version: &'static str,
    pub metric_schema_version: &'static str,
    pub platform: &'static str,
    pub architecture: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CleanupStatus {
    Complete,
    Required,
    Timeout,
    UnsafeEntry,
    OwnerMismatch,
    ModeMismatch,
    TypeMismatch,
}

impl PrivacyLogEvent {
    pub fn new(
        code: LogCode,
        phase: LogPhase,
        state: LogState,
        correlation_id: CorrelationId,
    ) -> Self {
        Self {
            schema_version: LOG_SCHEMA_VERSION,
            code,
            phase,
            state,
            correlation_id,
            aggregate_count: 0,
            duration_bucket: DurationBucket::Immediate,
            cleanup_status: None,
            build_version: env!("CARGO_PKG_VERSION"),
            metric_schema_version: "chat-analysis-export.v2",
            platform: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
        }
    }

    #[cfg(test)]
    pub fn synthetic(code: LogCode, phase: LogPhase, state: LogState) -> Self {
        Self {
            schema_version: LOG_SCHEMA_VERSION,
            code,
            phase,
            state,
            correlation_id: CorrelationId::synthetic(),
            aggregate_count: 0,
            duration_bucket: DurationBucket::Immediate,
            cleanup_status: None,
            build_version: env!("CARGO_PKG_VERSION"),
            metric_schema_version: "chat-analysis-export.v1",
            platform: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
        }
    }
}

#[derive(Clone, Default)]
pub struct PrivacyLogger {
    sink: Arc<Mutex<Vec<String>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivacyLogError {
    AggregateLimit,
    Serialization,
    LockPoisoned,
}

impl fmt::Debug for PrivacyLogger {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self.sink.lock().map(|sink| sink.len()).unwrap_or(0);
        formatter
            .debug_struct("PrivacyLogger")
            .field("line_count", &count)
            .finish()
    }
}

impl PrivacyLogger {
    /// Serialize one allow-listed event.  No arbitrary message, path, child
    /// output, identifier, token, or statistic can be supplied here.
    pub fn record(&self, event: PrivacyLogEvent) -> Result<String, PrivacyLogError> {
        if event.aggregate_count > MAX_LOG_AGGREGATE_COUNT {
            return Err(PrivacyLogError::AggregateLimit);
        }
        let line = serde_json::to_string(&event).map_err(|_| PrivacyLogError::Serialization)?;
        let mut sink = self
            .sink
            .lock()
            .map_err(|_| PrivacyLogError::LockPoisoned)?;
        if sink.len() >= MAX_LOG_LINES {
            sink.remove(0);
        }
        sink.push(line.clone());
        Ok(line)
    }

    pub fn lines(&self) -> Vec<String> {
        self.sink
            .lock()
            .map(|sink| sink.clone())
            .unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut sink) = self.sink.lock() {
            sink.clear();
        }
    }
}

pub fn contains_forbidden_content(line: &str) -> bool {
    [
        "synthetic-sensitive-body",
        "synthetic/contact.json",
        "synthetic-token",
        "traceback",
        "http://",
        "https://",
        "absolute-source-path",
    ]
    .iter()
    .any(|value| line.contains(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logger_serializes_only_allow_listed_fields() {
        let logger = PrivacyLogger::default();
        let line = logger
            .record(PrivacyLogEvent::synthetic(
                LogCode::CleanupComplete,
                LogPhase::Cleanup,
                LogState::Complete,
            ))
            .unwrap();
        assert!(line.contains("CLEANUP_COMPLETE"));
        assert!(!line.contains("message"));
        assert!(!line.contains("path"));
        assert!(!contains_forbidden_content(&line));
    }

    #[test]
    fn sensitive_string_injection_cannot_become_a_correlation_id() {
        assert!(CorrelationId::new("synthetic-sensitive-body").is_none());
        assert!(CorrelationId::new("/synthetic/contact.json").is_none());
        let logger = PrivacyLogger::default();
        let line = logger
            .record(PrivacyLogEvent::synthetic(
                LogCode::ExportFailed,
                LogPhase::Export,
                LogState::Failed,
            ))
            .unwrap();
        assert!(!contains_forbidden_content(&line));
    }

    #[test]
    fn logger_retains_only_a_bounded_recent_window() {
        let logger = PrivacyLogger::default();
        for _ in 0..(MAX_LOG_LINES + 8) {
            logger
                .record(PrivacyLogEvent::synthetic(
                    LogCode::WorkerReleased,
                    LogPhase::Analysis,
                    LogState::Complete,
                ))
                .unwrap();
        }
        assert_eq!(logger.lines().len(), MAX_LOG_LINES);
    }

    #[test]
    fn production_correlation_ids_are_random_short_lived_and_not_persisted() {
        let first = CorrelationId::random().expect("synthetic entropy source");
        let second = CorrelationId::random().expect("synthetic entropy source");
        assert_ne!(first.as_str(), second.as_str());
        assert_eq!(first.as_str().len(), 36);
        let logger = PrivacyLogger::default();
        logger.clear();
        assert!(logger.lines().is_empty());
    }
}
