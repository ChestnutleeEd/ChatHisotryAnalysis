//! Host-owned aggregate result registry with revocable export leases.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::export_schema::{
    DatasetExportContext, PrivacySafeExportSnapshot, RendererAggregateInput,
};

const RESULT_ID_PREFIX: &str = "res_";
const MAX_RETIRED_RESULT_IDS: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResultKey {
    pub window_label: String,
    pub session_id: String,
    pub generation: u64,
}

impl ResultKey {
    pub fn new(
        window_label: impl Into<String>,
        session_id: impl Into<String>,
        generation: u64,
    ) -> Self {
        Self {
            window_label: window_label.into(),
            session_id: session_id.into(),
            generation,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultRegistryError {
    Busy,
    Pending,
    Stale,
    SchemaInvalid,
    LimitExceeded,
    NotFound,
    InvalidState,
    RandomUnavailable,
}

impl ResultRegistryError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Busy => "EXPORT_BUSY",
            Self::Pending => "EXPORT_RESULT_PENDING",
            Self::Stale => "EXPORT_STALE_RESULT",
            Self::SchemaInvalid => "EXPORT_SCHEMA_INVALID",
            Self::LimitExceeded => "EXPORT_LIMIT_EXCEEDED",
            Self::NotFound => "EXPORT_RESULT_NOT_FOUND",
            Self::InvalidState | Self::RandomUnavailable => "INVALID_STATE",
        }
    }
}

impl fmt::Display for ResultRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::error::Error for ResultRegistryError {}

#[derive(Debug, Clone)]
struct ReadyResult {
    result_id: String,
    snapshot: PrivacySafeExportSnapshot,
}

#[derive(Debug, Clone)]
struct ResultEntry {
    context: Option<DatasetExportContext>,
    ready: Option<ReadyResult>,
    pending: bool,
    active_export: Option<ActiveExport>,
    committed_result_epoch: u64,
    export_revocation_epoch: u64,
}

#[derive(Debug, Clone)]
struct ActiveExport {
    operation_id: String,
    token: u64,
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Default)]
struct RegistryInner {
    entries: HashMap<ResultKey, ResultEntry>,
    retired_ids: HashSet<String>,
    retired_order: VecDeque<String>,
    revocation_epoch: u64,
    next_export_token: u64,
    next_export_operation: u64,
}

/// Every transition is atomic with respect to Worker commit, replacement,
/// cleanup, and native export.
#[derive(Clone, Default)]
pub struct ResultRegistry {
    inner: Arc<Mutex<RegistryInner>>,
}

impl fmt::Debug for ResultRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (entry_count, retired_count, epoch) = self
            .inner
            .lock()
            .map(|inner| {
                (
                    inner.entries.len(),
                    inner.retired_ids.len(),
                    inner.revocation_epoch,
                )
            })
            .unwrap_or((0, 0, 0));
        formatter
            .debug_struct("ResultRegistry")
            .field("entry_count", &entry_count)
            .field("retired_count", &retired_count)
            .field("revocation_epoch", &epoch)
            .finish()
    }
}

impl ResultRegistry {
    /// Register host-verified dataset metadata before a Worker can prepare a
    /// result.  The context contains no source path or user content.
    pub fn register_context(
        &self,
        key: ResultKey,
        context: DatasetExportContext,
    ) -> Result<(), ResultRegistryError> {
        let mut inner = self.lock()?;
        let previous = {
            let entry = inner.entries.entry(key.clone()).or_insert_with(empty_entry);
            revoke_export_locked_mut(entry);
            entry.pending = false;
            entry.ready.take()
        };
        if let Some(ready) = previous {
            retire_id(&mut inner, ready.result_id);
        }
        let entry = inner
            .entries
            .get_mut(&key)
            .ok_or(ResultRegistryError::InvalidState)?;
        entry.context = Some(context);
        entry.pending = false;
        entry.committed_result_epoch = entry.committed_result_epoch.wrapping_add(1);
        Ok(())
    }

    pub fn begin_pending(&self, key: ResultKey) -> Result<(), ResultRegistryError> {
        let mut inner = self.lock()?;
        let entry = inner.entries.entry(key).or_insert_with(empty_entry);
        if entry.context.is_none() {
            return Err(ResultRegistryError::InvalidState);
        }
        revoke_export_locked_mut(entry);
        entry.pending = true;
        Ok(())
    }

    pub fn cancel_pending(&self, key: &ResultKey) -> Result<(), ResultRegistryError> {
        let mut inner = self.lock()?;
        let Some(entry) = inner.entries.get_mut(key) else {
            return Ok(());
        };
        revoke_export_locked_mut(entry);
        entry.pending = false;
        if entry.ready.is_none() && entry.active_export.is_none() {
            inner.entries.remove(key);
        }
        Ok(())
    }

    /// Test and host-only seam for an already constructed host snapshot.
    /// Renderer-facing production code uses `commit_pending` below.
    pub fn commit(
        &self,
        key: ResultKey,
        snapshot: PrivacySafeExportSnapshot,
    ) -> Result<String, ResultRegistryError> {
        self.validate_snapshot(&snapshot)?;
        let mut inner = self.lock()?;
        let (result_id, previous) = {
            let entry = inner.entries.entry(key).or_insert_with(empty_entry);
            if entry.pending {
                return Err(ResultRegistryError::Pending);
            }
            revoke_export_locked_mut(entry);
            let result_id = mint_result_id()?;
            let previous = entry.ready.replace(ReadyResult {
                result_id: result_id.clone(),
                snapshot,
            });
            entry.pending = false;
            entry.committed_result_epoch = entry.committed_result_epoch.wrapping_add(1);
            (result_id, previous)
        };
        if let Some(previous) = previous {
            retire_id(&mut inner, previous.result_id);
        }
        Ok(result_id)
    }

    /// Validate and derive the host snapshot before minting any opaque handle.
    pub fn commit_pending(
        &self,
        key: &ResultKey,
        input: RendererAggregateInput,
    ) -> Result<String, ResultRegistryError> {
        let context = {
            let inner = self.lock()?;
            let entry = inner.entries.get(key).ok_or(ResultRegistryError::Pending)?;
            if !entry.pending {
                return Err(ResultRegistryError::InvalidState);
            }
            if entry.active_export.is_some() {
                return Err(ResultRegistryError::Busy);
            }
            entry
                .context
                .clone()
                .ok_or(ResultRegistryError::InvalidState)?
        };
        let snapshot = PrivacySafeExportSnapshot::from_renderer_aggregate(input, &context)
            .map_err(|error| {
                if error == "EXPORT_LIMIT_EXCEEDED" {
                    ResultRegistryError::LimitExceeded
                } else {
                    ResultRegistryError::SchemaInvalid
                }
            })?;
        self.validate_snapshot(&snapshot)?;

        let mut inner = self.lock()?;
        let (result_id, previous) = {
            let entry = inner
                .entries
                .get_mut(key)
                .ok_or(ResultRegistryError::Pending)?;
            if !entry.pending {
                return Err(ResultRegistryError::Stale);
            }
            if entry.active_export.is_some() {
                return Err(ResultRegistryError::Busy);
            }
            let result_id = mint_result_id()?;
            let previous = entry.ready.replace(ReadyResult {
                result_id: result_id.clone(),
                snapshot,
            });
            entry.pending = false;
            entry.committed_result_epoch = entry.committed_result_epoch.wrapping_add(1);
            (result_id, previous)
        };
        if let Some(previous) = previous {
            retire_id(&mut inner, previous.result_id);
        }
        Ok(result_id)
    }

    pub fn snapshot_for_export(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        result_id: &str,
    ) -> Result<PrivacySafeExportSnapshot, ResultRegistryError> {
        let inner = self.lock()?;
        let key = ResultKey::new(window_label, session_id, generation);
        let Some(entry) = inner.entries.get(&key) else {
            return Err(if inner.retired_ids.contains(result_id) {
                ResultRegistryError::Stale
            } else {
                ResultRegistryError::NotFound
            });
        };
        if entry.pending {
            return Err(ResultRegistryError::Pending);
        }
        let Some(ready) = entry.ready.as_ref() else {
            return Err(ResultRegistryError::Pending);
        };
        if ready.result_id != result_id {
            return Err(ResultRegistryError::Stale);
        }
        Ok(ready.snapshot.clone())
    }

    /// Reserve a single export.  `revalidate` is required at every native
    /// save seam; `Drop` clears only this lease's token.
    pub fn begin_export(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
        result_id: &str,
    ) -> Result<ExportLease, ResultRegistryError> {
        let key = ResultKey::new(window_label, session_id, generation);
        let mut inner = self.lock()?;
        let stale = inner.retired_ids.contains(result_id);
        let snapshot = {
            let entry = inner.entries.get(&key).ok_or(if stale {
                ResultRegistryError::Stale
            } else {
                ResultRegistryError::NotFound
            })?;
            if entry.active_export.is_some() {
                return Err(ResultRegistryError::Busy);
            }
            if entry.pending {
                return Err(ResultRegistryError::Pending);
            }
            entry
                .ready
                .as_ref()
                .filter(|ready| ready.result_id == result_id)
                .map(|ready| ready.snapshot.clone())
                .ok_or(ResultRegistryError::Stale)?
        };
        inner.next_export_token = inner.next_export_token.wrapping_add(1).max(1);
        let token = inner.next_export_token;
        inner.next_export_operation = inner.next_export_operation.wrapping_add(1).max(1);
        let operation_id = format!("exp_{:032x}", inner.next_export_operation);
        let cancelled = Arc::new(AtomicBool::new(false));
        let epoch = inner
            .entries
            .get(&key)
            .ok_or(ResultRegistryError::Stale)?
            .export_revocation_epoch;
        inner
            .entries
            .get_mut(&key)
            .ok_or(ResultRegistryError::Stale)?
            .active_export = Some(ActiveExport {
            operation_id: operation_id.clone(),
            token,
            cancelled: cancelled.clone(),
        });
        Ok(ExportLease {
            registry: self.clone(),
            key,
            result_id: result_id.to_string(),
            epoch,
            token,
            operation_id,
            cancelled,
            snapshot,
        })
    }

    pub fn clear_session(&self, window_label: &str, session_id: &str, generation: u64) {
        let key = ResultKey::new(window_label, session_id, generation);
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(entry) = inner.entries.remove(&key) {
                revoke_export_locked(&entry);
                if let Some(ready) = entry.ready {
                    retire_id(&mut inner, ready.result_id);
                }
            }
        }
    }

    pub fn clear_all(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            let entries = std::mem::take(&mut inner.entries);
            for entry in entries.into_values() {
                revoke_export_locked(&entry);
                if let Some(ready) = entry.ready {
                    retire_id(&mut inner, ready.result_id);
                }
            }
        }
    }

    pub fn current_result_id(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Option<String> {
        let key = ResultKey::new(window_label, session_id, generation);
        self.inner.lock().ok().and_then(|inner| {
            inner
                .entries
                .get(&key)
                .and_then(|entry| entry.ready.as_ref().map(|ready| ready.result_id.clone()))
        })
    }

    pub fn entry_count(&self) -> usize {
        self.inner
            .lock()
            .map(|inner| inner.entries.len())
            .unwrap_or(0)
    }

    pub fn dataset_id_for(&self, key: &ResultKey) -> Option<String> {
        self.inner.lock().ok().and_then(|inner| {
            inner.entries.get(key).and_then(|entry| {
                entry
                    .context
                    .as_ref()
                    .map(|context| context.dataset_id.clone())
            })
        })
    }

    fn finish_export(&self, key: &ResultKey, token: u64) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(entry) = inner.entries.get_mut(key) {
                if entry
                    .active_export
                    .as_ref()
                    .is_some_and(|export| export.token == token)
                {
                    entry.active_export = None;
                }
            }
        }
    }

    fn lease_is_valid_locked(
        &self,
        inner: &RegistryInner,
        lease: &ExportLease,
    ) -> Result<(), ResultRegistryError> {
        let entry = inner
            .entries
            .get(&lease.key)
            .ok_or(ResultRegistryError::Stale)?;
        if entry.export_revocation_epoch != lease.epoch
            || lease.cancelled.load(Ordering::Acquire)
            || entry.active_export.as_ref().is_none_or(|export| {
                export.token != lease.token
                    || export.operation_id != lease.operation_id
                    || export.cancelled.load(Ordering::Acquire)
            })
            || entry
                .ready
                .as_ref()
                .is_none_or(|ready| ready.result_id != lease.result_id)
        {
            return Err(ResultRegistryError::Stale);
        }
        Ok(())
    }

    /// Hold the registry lock across the final storage mutation.  A commit,
    /// replacement, cleanup, or close cannot revoke this lease between the
    /// final validation and the descriptor-relative rename.
    pub fn with_critical_section<T, E, F>(
        &self,
        lease: &ExportLease,
        operation: F,
    ) -> Result<Result<T, E>, ResultRegistryError>
    where
        F: FnOnce() -> Result<T, E>,
    {
        let inner = self.lock()?;
        self.lease_is_valid_locked(&inner, lease)?;
        Ok(operation())
    }

    pub fn active_export_operation_id(
        &self,
        window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Option<String> {
        let key = ResultKey::new(window_label, session_id, generation);
        self.inner.lock().ok().and_then(|inner| {
            inner
                .entries
                .get(&key)
                .and_then(|entry| entry.active_export.as_ref())
                .map(|export| export.operation_id.clone())
        })
    }

    fn validate_snapshot(
        &self,
        snapshot: &PrivacySafeExportSnapshot,
    ) -> Result<(), ResultRegistryError> {
        snapshot.validate().map_err(|error| {
            if error == "EXPORT_LIMIT_EXCEEDED" {
                ResultRegistryError::LimitExceeded
            } else {
                ResultRegistryError::SchemaInvalid
            }
        })?;
        snapshot.to_json_bytes().map_err(|error| {
            if error == "EXPORT_LIMIT_EXCEEDED" {
                ResultRegistryError::LimitExceeded
            } else {
                ResultRegistryError::SchemaInvalid
            }
        })?;
        snapshot.to_csv_bytes().map_err(|error| {
            if error == "EXPORT_LIMIT_EXCEEDED" {
                ResultRegistryError::LimitExceeded
            } else {
                ResultRegistryError::SchemaInvalid
            }
        })?;
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RegistryInner>, ResultRegistryError> {
        self.inner
            .lock()
            .map_err(|_| ResultRegistryError::InvalidState)
    }
}

fn empty_entry() -> ResultEntry {
    ResultEntry {
        context: None,
        ready: None,
        pending: false,
        active_export: None,
        committed_result_epoch: 0,
        export_revocation_epoch: 0,
    }
}

fn revoke_export_locked(entry: &ResultEntry) {
    if let Some(export) = entry.active_export.as_ref() {
        export.cancelled.store(true, Ordering::Release);
    }
}

fn revoke_export_locked_mut(entry: &mut ResultEntry) {
    if let Some(export) = entry.active_export.take() {
        export.cancelled.store(true, Ordering::Release);
        entry.export_revocation_epoch = entry.export_revocation_epoch.wrapping_add(1);
    }
}

impl ExportLease {
    pub fn snapshot(&self) -> &PrivacySafeExportSnapshot {
        &self.snapshot
    }

    pub fn revalidate(&self) -> Result<(), ResultRegistryError> {
        let inner = self.registry.lock()?;
        self.registry.lease_is_valid_locked(&inner, self)
    }

    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
}

impl Drop for ExportLease {
    fn drop(&mut self) {
        self.registry.finish_export(&self.key, self.token);
    }
}

pub struct ExportLease {
    registry: ResultRegistry,
    key: ResultKey,
    result_id: String,
    epoch: u64,
    token: u64,
    operation_id: String,
    cancelled: Arc<AtomicBool>,
    snapshot: PrivacySafeExportSnapshot,
}

fn retire_id(inner: &mut RegistryInner, result_id: String) {
    if inner.retired_ids.insert(result_id.clone()) {
        inner.retired_order.push_back(result_id);
    }
    while inner.retired_order.len() > MAX_RETIRED_RESULT_IDS {
        if let Some(old) = inner.retired_order.pop_front() {
            inner.retired_ids.remove(&old);
        }
    }
}

fn mint_result_id() -> Result<String, ResultRegistryError> {
    let mut bytes = [0u8; 16];
    #[cfg(unix)]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(&mut bytes))
            .map_err(|_| ResultRegistryError::RandomUnavailable)?;
    }
    #[cfg(not(unix))]
    {
        let _ = bytes;
        return Err(ResultRegistryError::RandomUnavailable);
    }
    let mut value = String::from(RESULT_ID_PREFIX);
    for byte in bytes {
        value.push_str(&format!("{byte:02x}"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export_schema::ExportFilters;

    fn key() -> ResultKey {
        ResultKey::new("main", "ses_00000000000000000000000000000001", 1)
    }

    fn context() -> DatasetExportContext {
        DatasetExportContext {
            dataset_id: "dat_00000000000000000000000000000001".to_string(),
            record_count: 3,
            minimum_calendar_date: "2025-01-01".to_string(),
            maximum_calendar_date: "2025-01-01".to_string(),
        }
    }

    fn input() -> RendererAggregateInput {
        let snapshot =
            PrivacySafeExportSnapshot::from_dataset(3, "2025-01-01", "2025-01-01").unwrap();
        let bytes = snapshot.to_json_bytes().unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let filters = serde_json::from_value::<ExportFilters>(value["filters"].clone()).unwrap();
        RendererAggregateInput {
            chart_key: crate::export_schema::ApprovedChartKey::Trends,
            filters,
            user_message_count: 3,
            eligible_text_count: 0,
            sender_counts: [3, 0],
            chat_days: 1,
            longest_streak_days: 1,
            daily_counts: vec![3],
            monthly_counts: vec![3],
            yearly_counts: vec![3],
            hour_counts: {
                let mut values = vec![0; 24];
                values[0] = 3;
                values
            },
            weekday_counts: {
                let mut values = vec![0; 7];
                values[0] = 3;
                values
            },
            message_type_counts: {
                let mut values = vec![0; 15];
                values[0] = 3;
                values
            },
            system_count: 0,
            length: crate::export_schema::LengthMetricsInput {
                overall: crate::export_schema::LengthStatsInput {
                    count: 0,
                    total_code_points: 0,
                    mean: None,
                    median: None,
                    p90: None,
                },
                owner: crate::export_schema::LengthStatsInput {
                    count: 0,
                    total_code_points: 0,
                    mean: None,
                    median: None,
                    p90: None,
                },
                other: crate::export_schema::LengthStatsInput {
                    count: 0,
                    total_code_points: 0,
                    mean: None,
                    median: None,
                    p90: None,
                },
            },
            replies: crate::export_schema::ReplyMetricsInput {
                overall: empty_reply(),
                owner_to_other: empty_reply(),
                other_to_owner: empty_reply(),
            },
            initiator_counts: [0, 0, 0],
        }
    }

    fn empty_reply() -> crate::export_schema::ReplyStatsInput {
        crate::export_schema::ReplyStatsInput {
            count: 0,
            mean_seconds: None,
            median_seconds: None,
            bins: vec![0; 8],
        }
    }

    #[test]
    fn invalid_input_does_not_mint_result_id() {
        let registry = ResultRegistry::default();
        registry.register_context(key(), context()).unwrap();
        registry.begin_pending(key()).unwrap();
        let mut invalid = input();
        invalid.filters.sender = "not-approved".to_string();
        assert_eq!(
            registry.commit_pending(&key(), invalid),
            Err(ResultRegistryError::SchemaInvalid)
        );
        assert_eq!(
            registry.current_result_id("main", &key().session_id, 1),
            None
        );
    }

    #[test]
    fn production_numeric_attack_matrix_rejects_before_registry_commit() {
        let attacks: Vec<(&str, Box<dyn Fn(&mut RendererAggregateInput)>)> = vec![
            (
                "invalid-sender",
                Box::new(|input| input.filters.sender = "contact-name".to_string()),
            ),
            (
                "control-character-date",
                Box::new(|input| input.filters.start_date = "2025-01-01\n".to_string()),
            ),
            (
                "reversed-date-range",
                Box::new(|input| input.filters.end_date = "2024-12-31".to_string()),
            ),
            (
                "out-of-range-year",
                Box::new(|input| input.filters.selected_year = Some(10_000)),
            ),
            (
                "invalid-threshold",
                Box::new(|input| input.filters.session_threshold_hours = 2),
            ),
            (
                "oversized-daily-rows",
                Box::new(|input| {
                    input.daily_counts = vec![0; crate::export_schema::MAX_EXPORT_ROWS + 1]
                }),
            ),
            (
                "missing-daily-dimension",
                Box::new(|input| input.daily_counts.clear()),
            ),
            (
                "wrong-hour-dimension-order",
                Box::new(|input| input.hour_counts = vec![3]),
            ),
            (
                "wrong-weekday-dimension",
                Box::new(|input| input.weekday_counts[0] = 4),
            ),
            (
                "unknown-message-dimension",
                Box::new(|input| input.message_type_counts[12] = 1),
            ),
            (
                "unsafe-integer",
                Box::new(|input| input.user_message_count = u64::MAX),
            ),
            (
                "eligible-count-overflow",
                Box::new(|input| input.eligible_text_count = 4),
            ),
            ("chat-day-overflow", Box::new(|input| input.chat_days = 2)),
            (
                "streak-overflow",
                Box::new(|input| input.longest_streak_days = 2),
            ),
            (
                "nan-summary",
                Box::new(|input| input.length.overall.mean = Some(f64::NAN)),
            ),
            (
                "infinity-summary",
                Box::new(|input| input.replies.overall.mean_seconds = Some(f64::INFINITY)),
            ),
            (
                "missing-reply-dimension",
                Box::new(|input| {
                    let _ = input.replies.overall.bins.pop();
                }),
            ),
            (
                "duplicate-dimension-count",
                Box::new(|input| input.replies.overall.count = 1),
            ),
        ];

        for (label, attack) in attacks {
            let registry = ResultRegistry::default();
            registry.register_context(key(), context()).unwrap();
            registry.begin_pending(key()).unwrap();
            let mut input = input();
            attack(&mut input);
            assert!(
                registry.commit_pending(&key(), input).is_err(),
                "attack unexpectedly committed: {label}"
            );
            assert_eq!(
                registry.current_result_id("main", &key().session_id, 1),
                None,
                "attack minted a result: {label}"
            );
            registry.cancel_pending(&key()).unwrap();
            assert_eq!(
                registry.entry_count(),
                0,
                "attack left registry state: {label}"
            );
        }
    }

    #[test]
    fn renderer_string_domain_attack_matrix_rejects_before_registry_path() {
        let mut base = serde_json::to_value(input()).unwrap();
        let attacks = [
            ("chat-body", serde_json::json!("synthetic chat body")),
            (
                "absolute-path",
                serde_json::json!("/synthetic/private/source.json"),
            ),
            (
                "relative-path",
                serde_json::json!("../synthetic-source.json"),
            ),
            ("filename", serde_json::json!("contacts.tsv")),
            ("participant-id", serde_json::json!("participant-01")),
            ("token", serde_json::json!("token_01")),
            ("keyword", serde_json::json!("keyword")),
            ("summary-text", serde_json::json!("synthetic summary")),
            (
                "url",
                serde_json::json!("https://example.invalid/synthetic"),
            ),
            ("null-byte", serde_json::json!("synthetic\u{0000}value")),
            ("tab", serde_json::json!("synthetic\tvalue")),
            ("unicode-normalization", serde_json::json!("e\u{301}")),
            ("homoglyph", serde_json::json!("ѕynthetic")),
            ("bidi-control", serde_json::json!("synthetic\u{202e}")),
            ("unknown-metric-id", serde_json::json!("word-cloud")),
            (
                "invalid-schema-version",
                serde_json::json!("chat-analysis-export.v1"),
            ),
            (
                "invalid-methodology",
                serde_json::json!("raw-message-export"),
            ),
            ("invalid-timezone", serde_json::json!("UTC")),
            (
                "invalid-privacy-classification",
                serde_json::json!("raw-private-data"),
            ),
        ];

        for (field, value) in attacks {
            if let Some(object) = base.as_object_mut() {
                object.insert(field.to_string(), value);
            }
            assert!(
                serde_json::from_value::<RendererAggregateInput>(base.clone()).is_err(),
                "string-domain attack crossed the exact DTO boundary: {field}"
            );
            base = serde_json::to_value(input()).unwrap();
        }

        let unknown_field = serde_json::json!({
            "chartKey": "trends",
            "filters": {
                "startDate": "2025-01-01",
                "endDate": "2025-01-01",
                "sender": "both",
                "selectedYear": null,
                "sessionThresholdHours": 6
            },
            "summaryText": "synthetic summary",
        });
        assert!(serde_json::from_value::<RendererAggregateInput>(unknown_field).is_err());
    }

    #[test]
    fn lease_is_revoked_by_clear_and_new_result() {
        let registry = ResultRegistry::default();
        registry.register_context(key(), context()).unwrap();
        registry.begin_pending(key()).unwrap();
        let first = registry.commit_pending(&key(), input()).unwrap();
        let lease = registry
            .begin_export("main", &key().session_id, 1, &first)
            .unwrap();
        registry.clear_session("main", &key().session_id, 1);
        assert_eq!(lease.revalidate(), Err(ResultRegistryError::Stale));
    }

    #[test]
    fn stale_drop_cannot_clear_a_new_lease_token() {
        let registry = ResultRegistry::default();
        registry.register_context(key(), context()).unwrap();
        registry.begin_pending(key()).unwrap();
        let result_id = registry.commit_pending(&key(), input()).unwrap();
        let first = registry
            .begin_export("main", &key().session_id, 1, &result_id)
            .unwrap();
        registry.clear_session("main", &key().session_id, 1);
        registry.register_context(key(), context()).unwrap();
        registry.begin_pending(key()).unwrap();
        let replacement = registry.commit_pending(&key(), input()).unwrap();
        let second = registry
            .begin_export("main", &key().session_id, 1, &replacement)
            .unwrap();
        drop(first);
        assert_eq!(second.revalidate(), Ok(()));
    }

    #[test]
    fn pending_commit_revokes_active_export_before_minting_replacement() {
        let registry = ResultRegistry::default();
        registry.register_context(key(), context()).unwrap();
        registry.begin_pending(key()).unwrap();
        let first = registry.commit_pending(&key(), input()).unwrap();
        let lease = registry
            .begin_export("main", &key().session_id, 1, &first)
            .unwrap();

        registry.begin_pending(key()).unwrap();
        assert_eq!(lease.revalidate(), Err(ResultRegistryError::Stale));
        let replacement = registry.commit_pending(&key(), input()).unwrap();
        assert_ne!(replacement, first);
        assert_eq!(
            registry
                .begin_export("main", &key().session_id, 1, &replacement)
                .unwrap()
                .revalidate(),
            Ok(())
        );
    }
}
