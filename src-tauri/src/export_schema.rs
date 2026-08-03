//! Closed, host-owned aggregate export contracts.
//!
//! The renderer can submit only bounded numeric aggregates.  The export
//! snapshot is intentionally not `Deserialize`: only this module can build
//! one, so labels, definitions, methodology, and serialization shape remain
//! host controlled.

use serde::{Deserialize, Serialize};

pub const EXPORT_SCHEMA_VERSION: &str = "chat-analysis-export.v2";
pub const PRIVACY_CLASSIFICATION: &str = "private-local-aggregate";
pub const TIMEZONE: &str = "UTC+08:00";
pub const METHODOLOGY_ID: &str = "post-dedup-canonical-user-message-aggregate.v1";
pub const MAX_EXPORT_ROWS: usize = 100_000;
pub const MAX_EXPORT_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_AGGREGATE_VALUE: u64 = 9_007_199_254_740_991;

pub const CATEGORY_KEYS: [&str; 15] = [
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

pub const WEEKDAY_KEYS: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

pub const REPLY_BIN_KEYS: [&str; 8] = [
    "0-59-seconds",
    "60-299-seconds",
    "300-1799-seconds",
    "1800-3599-seconds",
    "3600-21599-seconds",
    "21600-43199-seconds",
    "43200-86399-seconds",
    "86400-seconds",
];

pub const CSV_COLUMNS: [&str; 14] = [
    "schema_version",
    "metric_id",
    "definition_version",
    "timezone",
    "filter_start_date",
    "filter_end_date",
    "filter_sender",
    "selected_year",
    "session_threshold_hours",
    "domain_key",
    "numeric_value",
    "unit",
    "partial",
    "privacy_classification",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovedChartKey {
    Trends,
    SenderComparison,
    Hour,
    Weekday,
    MessageTypes,
    ReplyBins,
    InitiatorCounts,
}

impl ApprovedChartKey {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Trends => "trends",
            Self::SenderComparison => "sender-comparison",
            Self::Hour => "hour",
            Self::Weekday => "weekday",
            Self::MessageTypes => "message-types",
            Self::ReplyBins => "reply-bins",
            Self::InitiatorCounts => "initiator-counts",
        }
    }

    pub const fn metric_id(self) -> &'static str {
        match self {
            Self::Trends => "daily-trend",
            Self::SenderComparison => "sender-comparison",
            Self::Hour => "hour-activity",
            Self::Weekday => "weekday-activity",
            Self::MessageTypes => "message-type-count",
            Self::ReplyBins => "reply-interval-bin",
            Self::InitiatorCounts => "session-initiator",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "trends" => Self::Trends,
            "sender-comparison" => Self::SenderComparison,
            "hour" => Self::Hour,
            "weekday" => Self::Weekday,
            "message-types" => Self::MessageTypes,
            "reply-bins" => Self::ReplyBins,
            "initiator-counts" => Self::InitiatorCounts,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ExportFilters {
    pub start_date: String,
    pub end_date: String,
    pub sender: String,
    pub selected_year: Option<u16>,
    pub session_threshold_hours: u8,
}

impl ExportFilters {
    pub fn validate(&self) -> bool {
        is_calendar_date(&self.start_date)
            && is_calendar_date(&self.end_date)
            && self.start_date <= self.end_date
            && matches!(self.sender.as_str(), "both" | "owner" | "other")
            && matches!(self.session_threshold_hours, 1 | 3 | 6 | 12 | 24)
            && self
                .selected_year
                .is_none_or(|year| (1..=9999).contains(&year))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct LengthStatsInput {
    pub count: u64,
    pub total_code_points: u64,
    pub mean: Option<f64>,
    pub median: Option<f64>,
    pub p90: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct LengthMetricsInput {
    pub overall: LengthStatsInput,
    pub owner: LengthStatsInput,
    pub other: LengthStatsInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ReplyStatsInput {
    pub count: u64,
    pub mean_seconds: Option<f64>,
    pub median_seconds: Option<f64>,
    pub bins: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ReplyMetricsInput {
    pub overall: ReplyStatsInput,
    pub owner_to_other: ReplyStatsInput,
    pub other_to_owner: ReplyStatsInput,
}

/// The only aggregate payload accepted from the renderer.  It has no text,
/// paths, identifiers, labels, methodology, or export rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RendererAggregateInput {
    pub chart_key: ApprovedChartKey,
    pub filters: ExportFilters,
    pub user_message_count: u64,
    pub eligible_text_count: u64,
    pub sender_counts: [u64; 2],
    pub chat_days: u64,
    pub longest_streak_days: u64,
    pub daily_counts: Vec<u64>,
    pub monthly_counts: Vec<u64>,
    pub yearly_counts: Vec<u64>,
    pub hour_counts: Vec<u64>,
    pub weekday_counts: Vec<u64>,
    pub message_type_counts: Vec<u64>,
    pub system_count: u64,
    pub length: LengthMetricsInput,
    pub replies: ReplyMetricsInput,
    pub initiator_counts: [u64; 3],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatasetExportContext {
    pub dataset_id: String,
    pub record_count: u64,
    pub minimum_calendar_date: String,
    pub maximum_calendar_date: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChartPoint {
    pub label: String,
    pub value: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FooterContext<'a> {
    pub chart_key: &'static str,
    pub metric_definition_version: &'static str,
    pub start_date: &'a str,
    pub end_date: &'a str,
    pub sender: &'a str,
    pub threshold_hours: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostMetrics {
    user_message_count: u64,
    eligible_text_count: u64,
    sender_counts: [u64; 2],
    chat_days: u64,
    longest_streak_days: u64,
    daily_counts: Vec<u64>,
    monthly_counts: Vec<u64>,
    yearly_counts: Vec<u64>,
    hour_counts: Vec<u64>,
    weekday_counts: Vec<u64>,
    message_type_counts: Vec<u64>,
    system_count: u64,
    length: LengthMetricsInput,
    replies: ReplyMetricsInput,
    initiator_counts: [u64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostExportDocument<'a> {
    schema_version: &'static str,
    privacy_classification: &'static str,
    timezone: &'static str,
    methodology_id: &'static str,
    metric_definition_version: &'static str,
    chart_key: &'static str,
    filters: &'a ExportFilters,
    metrics: &'a HostMetrics,
}

/// Host-only export snapshot.  Deliberately not `Serialize`/`Deserialize`.
#[derive(Debug, Clone, PartialEq)]
pub struct PrivacySafeExportSnapshot {
    filters: ExportFilters,
    chart_key: ApprovedChartKey,
    metrics: HostMetrics,
}

impl PrivacySafeExportSnapshot {
    pub fn from_renderer_aggregate(
        input: RendererAggregateInput,
        context: &DatasetExportContext,
    ) -> Result<Self, &'static str> {
        validate_context(context)?;
        validate_input(&input, context)?;
        let snapshot = Self {
            filters: input.filters,
            chart_key: input.chart_key,
            metrics: HostMetrics {
                user_message_count: input.user_message_count,
                eligible_text_count: input.eligible_text_count,
                sender_counts: input.sender_counts,
                chat_days: input.chat_days,
                longest_streak_days: input.longest_streak_days,
                daily_counts: input.daily_counts,
                monthly_counts: input.monthly_counts,
                yearly_counts: input.yearly_counts,
                hour_counts: input.hour_counts,
                weekday_counts: input.weekday_counts,
                message_type_counts: input.message_type_counts,
                system_count: input.system_count,
                length: input.length,
                replies: input.replies,
                initiator_counts: input.initiator_counts,
            },
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    /// Host-created fallback used by synthetic and dataset handoff tests.
    pub fn from_dataset(
        record_count: u64,
        start_date: &str,
        end_date: &str,
    ) -> Result<Self, &'static str> {
        let context = DatasetExportContext {
            dataset_id: "dat_00000000000000000000000000000000".to_string(),
            record_count,
            minimum_calendar_date: start_date.to_string(),
            maximum_calendar_date: end_date.to_string(),
        };
        let daily_len = expected_daily_len(start_date, end_date).ok_or("EXPORT_SCHEMA_INVALID")?;
        let input = RendererAggregateInput {
            chart_key: ApprovedChartKey::Trends,
            filters: ExportFilters {
                start_date: start_date.to_string(),
                end_date: end_date.to_string(),
                sender: "both".to_string(),
                selected_year: None,
                session_threshold_hours: 6,
            },
            user_message_count: record_count,
            eligible_text_count: 0,
            sender_counts: [record_count, 0],
            chat_days: u64::from(record_count > 0),
            longest_streak_days: u64::from(record_count > 0),
            daily_counts: {
                let mut values = vec![0; daily_len];
                values[0] = record_count;
                values
            },
            monthly_counts: {
                let mut values = vec![
                    0;
                    expected_monthly_len(start_date, end_date)
                        .ok_or("EXPORT_SCHEMA_INVALID")?
                ];
                values[0] = record_count;
                values
            },
            yearly_counts: {
                let mut values = vec![
                    0;
                    expected_yearly_len(start_date, end_date)
                        .ok_or("EXPORT_SCHEMA_INVALID")?
                ];
                values[0] = record_count;
                values
            },
            hour_counts: {
                let mut values = vec![0; 24];
                values[0] = record_count;
                values
            },
            weekday_counts: {
                let mut values = vec![0; 7];
                values[0] = record_count;
                values
            },
            message_type_counts: {
                let mut values = vec![0; CATEGORY_KEYS.len()];
                values[0] = record_count;
                values
            },
            system_count: 0,
            length: empty_length_metrics(),
            replies: empty_reply_metrics(),
            initiator_counts: [0, 0, 0],
        };
        Self::from_renderer_aggregate(input, &context)
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if !self.filters.validate()
            || self.metrics.hour_counts.len() != 24
            || self.metrics.weekday_counts.len() != 7
            || self.metrics.message_type_counts.len() != CATEGORY_KEYS.len()
            || self.metrics.daily_counts.is_empty()
            || self.metrics.daily_counts.len() > MAX_EXPORT_ROWS
            || self.metrics.monthly_counts.len()
                != expected_monthly_len(&self.filters.start_date, &self.filters.end_date)
                    .unwrap_or(0)
            || self.metrics.yearly_counts.len()
                != expected_yearly_len(&self.filters.start_date, &self.filters.end_date)
                    .unwrap_or(0)
            || self.metrics.replies.overall.bins.len() != REPLY_BIN_KEYS.len()
            || self.metrics.replies.owner_to_other.bins.len() != REPLY_BIN_KEYS.len()
            || self.metrics.replies.other_to_owner.bins.len() != REPLY_BIN_KEYS.len()
            || !all_values_valid(&self.metrics.daily_counts)
            || !all_values_valid(&self.metrics.monthly_counts)
            || !all_values_valid(&self.metrics.yearly_counts)
            || !all_values_valid(&self.metrics.hour_counts)
            || !all_values_valid(&self.metrics.weekday_counts)
            || !all_values_valid(&self.metrics.message_type_counts)
            || !all_values_valid(&self.metrics.replies.overall.bins)
            || !all_values_valid(&self.metrics.replies.owner_to_other.bins)
            || !all_values_valid(&self.metrics.replies.other_to_owner.bins)
            || !validate_length_metrics(&self.metrics.length)
            || !validate_reply_stats(&self.metrics.replies.overall)
            || !validate_reply_stats(&self.metrics.replies.owner_to_other)
            || !validate_reply_stats(&self.metrics.replies.other_to_owner)
            || self.metrics.user_message_count > MAX_AGGREGATE_VALUE
            || self.metrics.eligible_text_count > self.metrics.user_message_count
            || self
                .metrics
                .sender_counts
                .iter()
                .any(|value| *value > MAX_AGGREGATE_VALUE)
            || self.metrics.sender_counts.iter().sum::<u64>() < self.metrics.user_message_count
            || self.metrics.chat_days > self.metrics.daily_counts.len() as u64
            || self.metrics.longest_streak_days > self.metrics.chat_days
            || self.metrics.system_count > MAX_AGGREGATE_VALUE
            || !self
                .metrics
                .initiator_counts
                .iter()
                .all(|value| *value <= MAX_AGGREGATE_VALUE)
        {
            return Err("EXPORT_SCHEMA_INVALID");
        }
        if sum(&self.metrics.daily_counts) != self.metrics.user_message_count
            || sum(&self.metrics.monthly_counts) != self.metrics.user_message_count
            || sum(&self.metrics.yearly_counts) != self.metrics.user_message_count
            || sum(&self.metrics.hour_counts) != self.metrics.user_message_count
            || sum(&self.metrics.weekday_counts) != self.metrics.user_message_count
            || sum(&self.metrics.message_type_counts) != self.metrics.user_message_count
            || self.metrics.message_type_counts[12] != 0
            || sum(&self.metrics.replies.overall.bins) != self.metrics.replies.overall.count
            || sum(&self.metrics.replies.owner_to_other.bins)
                != self.metrics.replies.owner_to_other.count
            || sum(&self.metrics.replies.other_to_owner.bins)
                != self.metrics.replies.other_to_owner.count
        {
            return Err("EXPORT_SCHEMA_INVALID");
        }
        Ok(())
    }

    pub fn to_json_bytes(&self) -> Result<Vec<u8>, &'static str> {
        self.validate()?;
        let document = HostExportDocument {
            schema_version: EXPORT_SCHEMA_VERSION,
            privacy_classification: PRIVACY_CLASSIFICATION,
            timezone: TIMEZONE,
            methodology_id: METHODOLOGY_ID,
            metric_definition_version: metric_definition_version(self.chart_key),
            chart_key: self.chart_key.as_str(),
            filters: &self.filters,
            metrics: &self.metrics,
        };
        let bytes = serde_json::to_vec(&document).map_err(|_| "EXPORT_SCHEMA_INVALID")?;
        if bytes.len() > MAX_EXPORT_BYTES {
            Err("EXPORT_LIMIT_EXCEEDED")
        } else {
            Ok(bytes)
        }
    }

    pub fn to_csv_bytes(&self) -> Result<Vec<u8>, &'static str> {
        self.validate()?;
        let mut output = CSV_COLUMNS.join(",");
        output.push('\n');
        let mut push_row = |metric_id: &'static str,
                            definition: &'static str,
                            domain_key: &str,
                            value: u64,
                            unit: &'static str,
                            partial: bool| {
            let selected_year = self
                .filters
                .selected_year
                .map(|year| year.to_string())
                .unwrap_or_default();
            let threshold_hours = self.filters.session_threshold_hours.to_string();
            let numeric_value = value.to_string();
            let values = [
                EXPORT_SCHEMA_VERSION,
                metric_id,
                definition,
                TIMEZONE,
                self.filters.start_date.as_str(),
                self.filters.end_date.as_str(),
                self.filters.sender.as_str(),
                selected_year.as_str(),
                threshold_hours.as_str(),
                domain_key,
                numeric_value.as_str(),
                unit,
                if partial { "true" } else { "false" },
                PRIVACY_CLASSIFICATION,
            ];
            output.push_str(
                &values
                    .iter()
                    .map(|value| csv_cell(value))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            output.push('\n');
        };
        push_row(
            "user-message-count",
            "chat-history-analysis.metric.population.v1",
            "aggregate",
            self.metrics.user_message_count,
            "messages",
            false,
        );
        push_row(
            "eligible-text-count",
            "chat-history-analysis.metric.population.v1",
            "aggregate",
            self.metrics.eligible_text_count,
            "messages",
            false,
        );
        push_row(
            "sender-count",
            "chat-history-analysis.metric.population.v1",
            "owner",
            self.metrics.sender_counts[0],
            "messages",
            false,
        );
        push_row(
            "sender-count",
            "chat-history-analysis.metric.population.v1",
            "other",
            self.metrics.sender_counts[1],
            "messages",
            false,
        );
        push_row(
            "chat-days",
            "chat-history-analysis.metric.time.utc-plus-8.v1",
            "aggregate",
            self.metrics.chat_days,
            "days",
            false,
        );
        push_row(
            "streak",
            "chat-history-analysis.metric.time.utc-plus-8.v1",
            "aggregate",
            self.metrics.longest_streak_days,
            "days",
            false,
        );
        for (index, value) in self.metrics.daily_counts.iter().enumerate() {
            let label = date_label(&self.filters.start_date, index).unwrap_or_default();
            push_row(
                "daily-trend",
                "chat-history-analysis.metric.time.utc-plus-8.v1",
                &label,
                *value,
                "messages",
                false,
            );
        }
        for (index, value) in self.metrics.monthly_counts.iter().enumerate() {
            let label = month_label(&self.filters.start_date, index).unwrap_or_default();
            push_row(
                "monthly-trend",
                "chat-history-analysis.metric.time.utc-plus-8.v1",
                &label,
                *value,
                "messages",
                false,
            );
        }
        for (index, value) in self.metrics.yearly_counts.iter().enumerate() {
            let label = year_label(&self.filters.start_date, index).unwrap_or_default();
            push_row(
                "yearly-trend",
                "chat-history-analysis.metric.time.utc-plus-8.v1",
                &label,
                *value,
                "messages",
                false,
            );
        }
        for (index, value) in self.metrics.hour_counts.iter().enumerate() {
            push_row(
                "hour-activity",
                "chat-history-analysis.metric.time.utc-plus-8.v1",
                hour_label(index),
                *value,
                "messages",
                false,
            );
        }
        for (index, value) in self.metrics.weekday_counts.iter().enumerate() {
            push_row(
                "weekday-activity",
                "chat-history-analysis.metric.time.utc-plus-8.v1",
                WEEKDAY_KEYS[index],
                *value,
                "messages",
                false,
            );
        }
        for (index, value) in self.metrics.message_type_counts.iter().enumerate() {
            push_row(
                "message-type-count",
                "chat-history-analysis.metric.types.v1",
                CATEGORY_KEYS[index],
                *value,
                "messages",
                false,
            );
        }
        for (index, value) in self.metrics.replies.overall.bins.iter().enumerate() {
            push_row(
                "reply-interval-bin-overall",
                "chat-history-analysis.metric.reply-interval.v1",
                REPLY_BIN_KEYS[index],
                *value,
                "count",
                false,
            );
        }
        for (label, stats) in [
            ("owner-to-other", &self.metrics.replies.owner_to_other),
            ("other-to-owner", &self.metrics.replies.other_to_owner),
        ] {
            for (index, value) in stats.bins.iter().enumerate() {
                push_row(
                    match label {
                        "owner-to-other" => "reply-interval-bin-owner-to-other",
                        _ => "reply-interval-bin-other-to-owner",
                    },
                    "chat-history-analysis.metric.reply-interval.v1",
                    REPLY_BIN_KEYS[index],
                    *value,
                    "count",
                    false,
                );
            }
        }
        for (label, value) in [
            ("owner", self.metrics.initiator_counts[0]),
            ("other", self.metrics.initiator_counts[1]),
            ("unknown", self.metrics.initiator_counts[2]),
        ] {
            push_row(
                "session-initiator",
                "chat-history-analysis.metric.session-initiator.v1",
                label,
                value,
                "sessions",
                false,
            );
        }
        push_row(
            "system-message-diagnostic-count",
            "chat-history-analysis.metric.types.v1",
            "aggregate",
            self.metrics.system_count,
            "messages",
            true,
        );
        for (label, stats) in [
            ("overall", &self.metrics.length.overall),
            ("owner", &self.metrics.length.owner),
            ("other", &self.metrics.length.other),
        ] {
            push_row(
                "eligible-length-count",
                "chat-history-analysis.metric.length.code-points.v1",
                label,
                stats.count,
                "messages",
                false,
            );
            push_row(
                "eligible-length-total-code-points",
                "chat-history-analysis.metric.length.code-points.v1",
                label,
                stats.total_code_points,
                "code-points",
                false,
            );
        }
        if output.len() > MAX_EXPORT_BYTES {
            return Err("EXPORT_LIMIT_EXCEEDED");
        }
        Ok(output.into_bytes())
    }

    pub fn chart_points(&self, chart_key: ApprovedChartKey) -> Vec<ChartPoint> {
        match chart_key {
            ApprovedChartKey::Trends => self
                .metrics
                .daily_counts
                .iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    date_label(&self.filters.start_date, index).map(|label| ChartPoint {
                        label,
                        value: *value,
                    })
                })
                .collect(),
            ApprovedChartKey::SenderComparison => vec![
                ChartPoint {
                    label: "owner".to_string(),
                    value: self.metrics.sender_counts[0],
                },
                ChartPoint {
                    label: "other".to_string(),
                    value: self.metrics.sender_counts[1],
                },
            ],
            ApprovedChartKey::Hour => self
                .metrics
                .hour_counts
                .iter()
                .enumerate()
                .map(|(index, value)| ChartPoint {
                    label: hour_label(index).to_string(),
                    value: *value,
                })
                .collect(),
            ApprovedChartKey::Weekday => self
                .metrics
                .weekday_counts
                .iter()
                .enumerate()
                .map(|(index, value)| ChartPoint {
                    label: WEEKDAY_KEYS[index].to_string(),
                    value: *value,
                })
                .collect(),
            ApprovedChartKey::MessageTypes => self
                .metrics
                .message_type_counts
                .iter()
                .enumerate()
                .map(|(index, value)| ChartPoint {
                    label: CATEGORY_KEYS[index].to_string(),
                    value: *value,
                })
                .collect(),
            ApprovedChartKey::ReplyBins => self
                .metrics
                .replies
                .overall
                .bins
                .iter()
                .enumerate()
                .map(|(index, value)| ChartPoint {
                    label: REPLY_BIN_KEYS[index].to_string(),
                    value: *value,
                })
                .collect(),
            ApprovedChartKey::InitiatorCounts => ["owner", "other", "unknown"]
                .into_iter()
                .zip(self.metrics.initiator_counts)
                .map(|(label, value)| ChartPoint {
                    label: label.to_string(),
                    value,
                })
                .collect(),
        }
    }

    pub fn footer_context(&self, chart_key: ApprovedChartKey) -> FooterContext<'_> {
        FooterContext {
            chart_key: chart_key.as_str(),
            metric_definition_version: metric_definition_version(chart_key),
            start_date: self.filters.start_date.as_str(),
            end_date: self.filters.end_date.as_str(),
            sender: self.filters.sender.as_str(),
            threshold_hours: self.filters.session_threshold_hours,
        }
    }
}

fn metric_definition_version(chart_key: ApprovedChartKey) -> &'static str {
    match chart_key {
        ApprovedChartKey::Trends
        | ApprovedChartKey::SenderComparison
        | ApprovedChartKey::Hour
        | ApprovedChartKey::Weekday => "chat-history-analysis.metric.time.utc-plus-8.v1",
        ApprovedChartKey::MessageTypes => "chat-history-analysis.metric.types.v1",
        ApprovedChartKey::ReplyBins => "chat-history-analysis.metric.reply-interval.v1",
        ApprovedChartKey::InitiatorCounts => "chat-history-analysis.metric.session-initiator.v1",
    }
}

fn validate_context(context: &DatasetExportContext) -> Result<(), &'static str> {
    if context.dataset_id.len() != 36
        || !context.dataset_id.starts_with("dat_")
        || !context
            .dataset_id
            .as_bytes()
            .get(4..)
            .is_some_and(|bytes| bytes.iter().all(|byte| byte.is_ascii_hexdigit()))
        || context.record_count > MAX_AGGREGATE_VALUE
        || !is_calendar_date(&context.minimum_calendar_date)
        || !is_calendar_date(&context.maximum_calendar_date)
        || context.minimum_calendar_date > context.maximum_calendar_date
    {
        return Err("EXPORT_SCHEMA_INVALID");
    }
    Ok(())
}

fn validate_input(
    input: &RendererAggregateInput,
    context: &DatasetExportContext,
) -> Result<(), &'static str> {
    if !input.filters.validate()
        || input.filters.start_date < context.minimum_calendar_date
        || input.filters.end_date > context.maximum_calendar_date
        || input.user_message_count > context.record_count
        || input.eligible_text_count > input.user_message_count
        || input
            .sender_counts
            .iter()
            .any(|value| *value > context.record_count)
        || input.sender_counts.iter().sum::<u64>() < input.user_message_count
        || input.filters.sender == "owner" && input.user_message_count != input.sender_counts[0]
        || input.filters.sender == "other" && input.user_message_count != input.sender_counts[1]
        || input.filters.sender == "both"
            && input.user_message_count != input.sender_counts.iter().sum::<u64>()
        || input.daily_counts.len()
            != expected_daily_len(&input.filters.start_date, &input.filters.end_date)
                .ok_or("EXPORT_SCHEMA_INVALID")?
        || input.monthly_counts.len() > 1200
        || input.yearly_counts.len() > 100
        || input.chat_days > input.daily_counts.len() as u64
        || input.longest_streak_days > input.chat_days
        || input.message_type_counts.len() != CATEGORY_KEYS.len()
        || input.hour_counts.len() != 24
        || input.weekday_counts.len() != 7
        || input.system_count > context.record_count
        || !all_values_valid(&input.daily_counts)
        || !all_values_valid(&input.monthly_counts)
        || !all_values_valid(&input.yearly_counts)
        || !all_values_valid(&input.hour_counts)
        || !all_values_valid(&input.weekday_counts)
        || !all_values_valid(&input.message_type_counts)
    {
        return Err("EXPORT_SCHEMA_INVALID");
    }
    validate_length_metrics(&input.length)
        .then_some(())
        .ok_or("EXPORT_SCHEMA_INVALID")?;
    validate_reply_stats(&input.replies.overall)
        .then_some(())
        .ok_or("EXPORT_SCHEMA_INVALID")?;
    validate_reply_stats(&input.replies.owner_to_other)
        .then_some(())
        .ok_or("EXPORT_SCHEMA_INVALID")?;
    validate_reply_stats(&input.replies.other_to_owner)
        .then_some(())
        .ok_or("EXPORT_SCHEMA_INVALID")?;
    if sum(&input.daily_counts) != input.user_message_count
        || sum(&input.monthly_counts) != input.user_message_count
        || sum(&input.yearly_counts) != input.user_message_count
        || sum(&input.hour_counts) != input.user_message_count
        || sum(&input.weekday_counts) != input.user_message_count
        || sum(&input.message_type_counts) != input.user_message_count
        || input.message_type_counts[12] != 0
        || sum(&input.replies.overall.bins) != input.replies.overall.count
        || sum(&input.replies.owner_to_other.bins) != input.replies.owner_to_other.count
        || sum(&input.replies.other_to_owner.bins) != input.replies.other_to_owner.count
    {
        return Err("EXPORT_SCHEMA_INVALID");
    }
    Ok(())
}

fn validate_length_metrics(metrics: &LengthMetricsInput) -> bool {
    let values = [&metrics.overall, &metrics.owner, &metrics.other];
    values.iter().all(|stats| {
        stats.count <= MAX_AGGREGATE_VALUE
            && stats.total_code_points <= MAX_AGGREGATE_VALUE
            && [stats.mean, stats.median, stats.p90]
                .into_iter()
                .flatten()
                .all(|value| value.is_finite() && value >= 0.0)
    }) && metrics.overall.count == metrics.owner.count + metrics.other.count
        && metrics.overall.total_code_points
            == metrics.owner.total_code_points + metrics.other.total_code_points
}

fn validate_reply_stats(stats: &ReplyStatsInput) -> bool {
    stats.count <= MAX_AGGREGATE_VALUE
        && stats.bins.len() == REPLY_BIN_KEYS.len()
        && stats.bins.iter().all(|value| *value <= MAX_AGGREGATE_VALUE)
        && [stats.mean_seconds, stats.median_seconds]
            .into_iter()
            .flatten()
            .all(|value| value.is_finite() && value >= 0.0)
}

fn all_values_valid(values: &[u64]) -> bool {
    values.iter().all(|value| *value <= MAX_AGGREGATE_VALUE)
}

fn sum(values: &[u64]) -> u64 {
    values
        .iter()
        .try_fold(0u64, |total, value| total.checked_add(*value))
        .unwrap_or(u64::MAX)
}

fn empty_length_metrics() -> LengthMetricsInput {
    let stats = LengthStatsInput {
        count: 0,
        total_code_points: 0,
        mean: None,
        median: None,
        p90: None,
    };
    LengthMetricsInput {
        overall: stats.clone(),
        owner: stats.clone(),
        other: stats,
    }
}

fn empty_reply_stats() -> ReplyStatsInput {
    ReplyStatsInput {
        count: 0,
        mean_seconds: None,
        median_seconds: None,
        bins: vec![0; REPLY_BIN_KEYS.len()],
    }
}

fn empty_reply_metrics() -> ReplyMetricsInput {
    let stats = empty_reply_stats();
    ReplyMetricsInput {
        overall: stats.clone(),
        owner_to_other: stats.clone(),
        other_to_owner: stats,
    }
}

fn csv_cell(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
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
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    year > 0 && day > 0 && day <= max_day
}

fn date_ordinal(value: &str) -> Option<i64> {
    if !is_calendar_date(value) {
        return None;
    }
    let year = value[0..4].parse::<i64>().ok()?;
    let month = value[5..7].parse::<i64>().ok()?;
    let day = value[8..10].parse::<i64>().ok()?;
    let mut days = 0i64;
    for current_year in 1..year {
        days += if current_year % 4 == 0 && (current_year % 100 != 0 || current_year % 400 == 0) {
            366
        } else {
            365
        };
    }
    for current_month in 1..month {
        days += match current_month {
            2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        };
    }
    Some(days + day)
}

fn expected_daily_len(start: &str, end: &str) -> Option<usize> {
    let length = date_ordinal(end)?
        .checked_sub(date_ordinal(start)?)?
        .checked_add(1)?;
    usize::try_from(length)
        .ok()
        .filter(|value| *value <= MAX_EXPORT_ROWS)
}

fn expected_monthly_len(start: &str, end: &str) -> Option<usize> {
    let (start_year, start_month, _) = date_parts(start)?;
    let (end_year, end_month, _) = date_parts(end)?;
    let start_index = start_year.checked_mul(12)?.checked_add(start_month)?;
    let end_index = end_year.checked_mul(12)?.checked_add(end_month)?;
    usize::try_from(end_index.checked_sub(start_index)?.checked_add(1)?).ok()
}

fn expected_yearly_len(start: &str, end: &str) -> Option<usize> {
    let (start_year, _, _) = date_parts(start)?;
    let (end_year, _, _) = date_parts(end)?;
    usize::try_from(end_year.checked_sub(start_year)?.checked_add(1)?).ok()
}

fn date_label(start: &str, offset: usize) -> Option<String> {
    let (mut year, mut month, mut day) = date_parts(start)?;
    for _ in 0..offset {
        day += 1;
        if day > days_in_month(year, month) {
            day = 1;
            month += 1;
            if month > 12 {
                month = 1;
                year += 1;
            }
        }
    }
    (year <= 9999).then(|| format!("{year:04}-{month:02}-{day:02}"))
}

fn month_label(start: &str, offset: usize) -> Option<String> {
    let (mut year, mut month, _) = date_parts(start)?;
    for _ in 0..offset {
        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }
    (year <= 9999).then(|| format!("{year:04}-{month:02}"))
}

fn year_label(start: &str, offset: usize) -> Option<String> {
    let (year, _, _) = date_parts(start)?;
    year.checked_add(u32::try_from(offset).ok()?)
        .filter(|year| *year <= 9999)
        .map(|year| format!("{year:04}"))
}

fn date_parts(value: &str) -> Option<(u32, u32, u32)> {
    if !is_calendar_date(value) {
        return None;
    }
    Some((
        value[0..4].parse().ok()?,
        value[5..7].parse().ok()?,
        value[8..10].parse().ok()?,
    ))
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn hour_label(index: usize) -> &'static str {
    match index {
        0 => "00",
        1 => "01",
        2 => "02",
        3 => "03",
        4 => "04",
        5 => "05",
        6 => "06",
        7 => "07",
        8 => "08",
        9 => "09",
        10 => "10",
        11 => "11",
        12 => "12",
        13 => "13",
        14 => "14",
        15 => "15",
        16 => "16",
        17 => "17",
        18 => "18",
        19 => "19",
        20 => "20",
        21 => "21",
        22 => "22",
        _ => "23",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_snapshot_is_not_renderer_deserializable_and_has_closed_csv() {
        let snapshot =
            PrivacySafeExportSnapshot::from_dataset(3, "2025-01-01", "2025-01-01").unwrap();
        let json = snapshot.to_json_bytes().unwrap();
        let csv = String::from_utf8(snapshot.to_csv_bytes().unwrap()).unwrap();
        assert!(String::from_utf8(json)
            .unwrap()
            .contains("chat-analysis-export.v2"));
        assert!(csv.starts_with(&format!("{}\n", CSV_COLUMNS.join(","))));
        assert!(!csv.contains("dimension_1"));
        assert!(!csv.contains("message body"));
        assert!(csv.contains("2025-01-01"));
        assert!(!csv.contains("selected-date"));
    }

    #[test]
    fn renderer_text_and_wrong_domains_are_rejected_before_snapshot() {
        let value = serde_json::json!({
            "chartKey": "trends",
            "filters": {
                "startDate": "2025-01-01",
                "endDate": "2025-01-01",
                "sender": "both",
                "selectedYear": null,
                "sessionThresholdHours": 6
            },
            "methodology": "message body",
        });
        assert!(serde_json::from_value::<RendererAggregateInput>(value).is_err());
        assert_eq!(ApprovedChartKey::parse("word-cloud"), None);
    }

    #[test]
    fn fixed_chart_points_and_footer_are_host_owned() {
        let snapshot =
            PrivacySafeExportSnapshot::from_dataset(3, "2025-01-01", "2025-01-01").unwrap();
        assert_eq!(snapshot.chart_points(ApprovedChartKey::Hour).len(), 24);
        let footer = snapshot.footer_context(ApprovedChartKey::Trends);
        assert_eq!(footer.sender, "both");
        assert_eq!(footer.threshold_hours, 6);
    }
}
