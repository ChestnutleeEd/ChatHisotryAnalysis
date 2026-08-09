import {
  isDatasetId,
  type DatasetId,
  type Generation,
} from "../../desktop/ipc-contract";
import type { CanonicalSenderFilter, SessionThresholdHours } from "../../worker-analysis/analytics-contract";
import type { CanonicalMessageCategory } from "../../canonical-v2/schema";
import type { CanonicalWeekday } from "../../worker-analysis/activity-metrics";
import type { BetaReportScene, BetaReportSectionId } from "./report-sections";

export const BETA_REPORT_QUERY_SCHEMA_VERSION =
  "chat-history-analysis.beta-report-query.v1" as const;
export const BETA_REPORT_SCHEMA_VERSION =
  "chat-history-analysis.beta-report.v1" as const;
export const BETA_REPORT_VIEW_MODEL_SCHEMA_VERSION =
  "chat-history-analysis.beta-report-view-model.v1" as const;
export const BETA_REPORT_PRESENTER_VERSION =
  "chat-history-analysis.beta-report-presenter.zh-CN.v1" as const;
export const BETA_REPORT_TIMEZONE = "UTC+08:00" as const;

export type BetaReportMode = "annual" | "all-years" | "multi-year-overview";
export type BetaReportCalendarScope =
  | "full-calendar-query"
  | "partial-calendar-query"
  | "multi-year";
export type BetaReportSectionStatus =
  | "READY"
  | "EMPTY"
  | "INSUFFICIENT"
  | "PARTIAL"
  | "UNAVAILABLE";

export type BetaReportReasonCode =
  | "NO_USER_MESSAGES"
  | "NO_ACTIVE_DAYS"
  | "NO_STREAK"
  | "NO_PEAK_BUCKET"
  | "NO_ELIGIBLE_TEXT_SAMPLE"
  | "NO_SESSIONS"
  | "NO_REPLY_SAMPLE"
  | "NO_REPLY_DIRECTION_SAMPLE"
  | "PARTIAL_CALENDAR_SCOPE"
  | "MULTI_YEAR_SCOPE"
  | "SENDER_COMPARISON_IGNORES_FILTER"
  | "THRESHOLD_SENSITIVE"
  | "UNAVAILABLE";

export type BetaReportTemplateId =
  | "ANNUAL_OPENING_FULL"
  | "ANNUAL_OPENING_PARTIAL"
  | "ALL_YEARS_OPENING"
  | "TOTAL_MESSAGES_READY"
  | "TOTAL_MESSAGES_EMPTY"
  | "ACTIVE_DAYS_READY"
  | "ACTIVE_DAYS_EMPTY"
  | "LONGEST_STREAK_SINGLE"
  | "LONGEST_STREAK_TIE"
  | "LONGEST_STREAK_EMPTY"
  | "MOST_ACTIVE_MONTH_SINGLE"
  | "MOST_ACTIVE_MONTH_TIE"
  | "MOST_ACTIVE_MONTH_EMPTY"
  | "MOST_ACTIVE_WEEKDAY_SINGLE"
  | "MOST_ACTIVE_WEEKDAY_TIE"
  | "MOST_ACTIVE_WEEKDAY_EMPTY"
  | "MOST_ACTIVE_HOUR_SINGLE"
  | "MOST_ACTIVE_HOUR_TIE"
  | "MOST_ACTIVE_HOUR_EMPTY"
  | "SENDER_SHARE_READY"
  | "SENDER_SHARE_EMPTY"
  | "MESSAGE_LENGTH_READY"
  | "MESSAGE_LENGTH_INSUFFICIENT"
  | "MESSAGE_TYPES_READY"
  | "MESSAGE_TYPES_EMPTY"
  | "SESSIONS_READY"
  | "SESSIONS_EMPTY"
  | "REPLY_INTERVALS_READY"
  | "NO_REPLY_SAMPLE"
  | "UNAVAILABLE";

export type BetaReportFactKey =
  | "none"
  | "totalMessages"
  | "activeDays"
  | "longestStreak"
  | "peakMonth"
  | "peakWeekday"
  | "peakHour"
  | "senderShare"
  | "messageLength"
  | "messageTypes"
  | "sessions"
  | "replyIntervals";

export type BetaReportUnit =
  | "messages"
  | "days"
  | "months"
  | "weekdays"
  | "hours"
  | "share"
  | "code-points"
  | "categories"
  | "sessions"
  | "seconds";

export interface BetaReportQueryV1 {
  readonly schemaVersion: typeof BETA_REPORT_QUERY_SCHEMA_VERSION;
  readonly datasetId: DatasetId | null;
  readonly generation: Generation;
  readonly baseQueryKey: string;
  readonly mode: BetaReportMode;
  readonly year: number | null;
}

export interface BetaReportRangeV1 {
  readonly startDate: string;
  readonly endDate: string;
}

export interface BetaReportAppliedFiltersV1 {
  readonly sender: CanonicalSenderFilter;
  readonly sessionThresholdHours: SessionThresholdHours;
}

export interface BetaReportMetadataV1 {
  readonly mode: BetaReportMode;
  readonly year: number | null;
  readonly scope: BetaReportCalendarScope;
  readonly currentRange: BetaReportRangeV1;
  readonly timezone: typeof BETA_REPORT_TIMEZONE;
  readonly representedYears: readonly number[];
  readonly appliedFilters: BetaReportAppliedFiltersV1;
}

export interface BetaReportCountFactV1 {
  readonly value: number;
}

export interface BetaReportActiveDaysFactV1 extends BetaReportCountFactV1 {
  readonly calendarDays: number;
}

export interface BetaReportTotalMessagesFactV1 extends BetaReportCountFactV1 {
  readonly ownerCount: number;
  readonly otherCount: number;
  readonly denominator: number;
}

export interface BetaReportStreakIntervalV1 {
  readonly startDate: string;
  readonly endDate: string;
  readonly length: number;
}

export interface BetaReportLongestStreakFactV1 {
  readonly length: number;
  readonly intervals: readonly BetaReportStreakIntervalV1[];
}

export interface BetaReportMonthBucketV1 {
  readonly key: string;
  readonly count: number;
  readonly partial: boolean;
}

export interface BetaReportWeekdayBucketV1 {
  readonly weekday: CanonicalWeekday;
  readonly count: number;
  readonly share: number | null;
}

export interface BetaReportHourBucketV1 {
  readonly hour: number;
  readonly count: number;
  readonly share: number | null;
}

export interface BetaReportPeakMonthFactV1 {
  readonly buckets: readonly BetaReportMonthBucketV1[];
  readonly maxCount: number | null;
  readonly ties: readonly string[];
}

export interface BetaReportPeakWeekdayFactV1 {
  readonly buckets: readonly BetaReportWeekdayBucketV1[];
  readonly maxCount: number | null;
  readonly ties: readonly CanonicalWeekday[];
}

export interface BetaReportPeakHourFactV1 {
  readonly buckets: readonly BetaReportHourBucketV1[];
  readonly maxCount: number | null;
  readonly ties: readonly number[];
}

export interface BetaReportSenderBucketV1 {
  readonly count: number;
  readonly share: number | null;
}

export interface BetaReportSenderShareFactV1 {
  readonly denominator: number;
  readonly owner: BetaReportSenderBucketV1;
  readonly other: BetaReportSenderBucketV1;
  readonly filterBehavior: "ignores-global-sender-filter";
}

export interface BetaReportLengthStatsV1 {
  readonly count: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
}

export interface BetaReportMessageLengthFactV1 {
  readonly overall: BetaReportLengthStatsV1;
  readonly owner: BetaReportLengthStatsV1;
  readonly other: BetaReportLengthStatsV1;
  readonly definitionVersion: string;
}

export interface BetaReportMessageTypeBucketV1 {
  readonly category: CanonicalMessageCategory;
  readonly count: number;
  readonly share: number | null;
}

export interface BetaReportMessageTypesFactV1 {
  readonly denominator: number;
  readonly eligibleTextCount: number;
  readonly systemDiagnosticCount: number;
  readonly categories: readonly BetaReportMessageTypeBucketV1[];
  readonly definitionVersion: string;
}

export interface BetaReportInitiatorBucketV1 {
  readonly count: number;
  readonly share: number | null;
}

export interface BetaReportSessionsFactV1 {
  readonly thresholdHours: SessionThresholdHours;
  readonly sessionCount: number;
  readonly shareDenominator: number;
  readonly owner: BetaReportInitiatorBucketV1;
  readonly other: BetaReportInitiatorBucketV1;
  readonly unknown: BetaReportInitiatorBucketV1;
  readonly filterBehavior: "ignores-global-sender-filter";
  readonly definitionVersion: string;
  readonly sensitivityChanged: boolean;
}

export interface BetaReportReplyStatsV1 {
  readonly count: number;
  readonly meanSeconds: number | null;
  readonly medianSeconds: number | null;
  readonly p90Seconds: number | null;
}

export interface BetaReportReplyDirectionFactV1 {
  readonly direction: "owner-to-other" | "other-to-owner";
  readonly responder: "owner" | "other";
  readonly stats: BetaReportReplyStatsV1;
}

export interface BetaReportReplyIntervalsFactV1 {
  readonly thresholdHours: SessionThresholdHours;
  readonly overall: BetaReportReplyStatsV1;
  readonly directions: readonly [
    BetaReportReplyDirectionFactV1,
    BetaReportReplyDirectionFactV1,
  ];
  readonly filterBehavior: "ignores-global-sender-filter";
  readonly definitionVersion: string;
}

export interface CoreReportFactsV1 {
  readonly totalMessages: BetaReportTotalMessagesFactV1;
  readonly activeDays: BetaReportActiveDaysFactV1;
  readonly longestStreak: BetaReportLongestStreakFactV1;
  readonly peakMonth: BetaReportPeakMonthFactV1;
  readonly peakWeekday: BetaReportPeakWeekdayFactV1;
  readonly peakHour: BetaReportPeakHourFactV1;
  readonly senderShare: BetaReportSenderShareFactV1;
  readonly messageLength: BetaReportMessageLengthFactV1;
  readonly messageTypes: BetaReportMessageTypesFactV1;
  readonly sessions: BetaReportSessionsFactV1;
  readonly replyIntervals: BetaReportReplyIntervalsFactV1;
}

export interface BetaReportValueModelV1 {
  readonly value: number | null;
  readonly unit: BetaReportUnit;
  readonly denominator: number | null;
}

export interface SemanticReportSectionV1 {
  readonly id: BetaReportSectionId;
  readonly order: number;
  readonly scene: BetaReportScene;
  readonly factKey: BetaReportFactKey;
  readonly status: BetaReportSectionStatus;
  readonly value: BetaReportValueModelV1 | null;
  readonly templateId: BetaReportTemplateId;
  readonly reason: BetaReportReasonCode | null;
}

export type BetaMethodologyId =
  | "population"
  | "timezone"
  | "sender-filter-exception"
  | "session-threshold"
  | "partial-calendar"
  | "reply-limitation"
  | "non-evaluative-language"
  | "word-denominator";

export interface BetaMethodologyFactV1 {
  readonly id: BetaMethodologyId;
  readonly value: string;
}

export interface BetaReportPrivacyMetadataV1 {
  readonly localOnly: true;
  readonly containsMessageBodies: false;
  readonly containsContactIdentity: false;
}

export type BetaReportExportKind = "summary-card" | "word-cloud";

export interface BetaReportExportMetadataV1 {
  readonly localOnly: true;
  readonly supportedKinds: readonly BetaReportExportKind[];
  readonly anonymousRoleLabels: true;
  readonly containsMessageBodies: false;
  readonly containsContactIdentity: false;
}

export interface BetaReportDtoV1 {
  readonly schemaVersion: typeof BETA_REPORT_SCHEMA_VERSION;
  readonly identity: {
    readonly datasetId: DatasetId | null;
    readonly generation: Generation;
    readonly reportQueryKey: string;
  };
  readonly metadata: BetaReportMetadataV1;
  readonly facts: CoreReportFactsV1;
  readonly sections: readonly SemanticReportSectionV1[];
  readonly wordEvidence: {
    readonly status: "not-requested" | "ready" | "empty";
    readonly frequencyDtoKey: string | null;
  };
  readonly methodology: readonly BetaMethodologyFactV1[];
  readonly privacy: BetaReportPrivacyMetadataV1;
  readonly export: BetaReportExportMetadataV1;
}

export interface BetaLocalizedQueryChipV1 {
  readonly id: "date" | "sender" | "timezone" | "session" | "filtered";
  readonly label: string;
  readonly tone: "default" | "accent";
}

export interface BetaLocalizedMetricV1 {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly accessibleLabel: string;
}

export type BetaLocalizedVisualKind = "bars" | "segments" | "streaks" | "table";

export interface BetaLocalizedVisualRowV1 {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly displayValue: string;
  readonly secondaryLabel: string | null;
  readonly widthPercent: number;
  readonly tone: "primary" | "owner" | "other" | "supporting" | "warning";
}

export interface BetaLocalizedVisualV1 {
  readonly kind: BetaLocalizedVisualKind;
  readonly ariaLabel: string;
  readonly rows: readonly BetaLocalizedVisualRowV1[];
  readonly legend: readonly string[];
}

export interface BetaLocalizedDetailRowV1 {
  readonly label: string;
  readonly value: string;
}

export interface BetaLocalizedReportSectionV1 {
  readonly id: BetaReportSectionId;
  readonly order: number;
  readonly scene: BetaReportScene;
  readonly status: BetaReportSectionStatus;
  readonly templateId: BetaReportTemplateId;
  readonly eyebrow: string;
  readonly heading: string;
  readonly lead: string;
  readonly statusLabel: string;
  readonly reason: BetaReportReasonCode | null;
  readonly scopeNote: string | null;
  readonly metric: BetaLocalizedMetricV1 | null;
  readonly visual: BetaLocalizedVisualV1 | null;
  readonly details: readonly BetaLocalizedDetailRowV1[];
}

export interface BetaLocalizedMethodologyFactV1 {
  readonly id: BetaMethodologyId;
  readonly label: string;
  readonly value: string;
}

export interface BetaReportViewModelV1 {
  readonly schemaVersion: typeof BETA_REPORT_VIEW_MODEL_SCHEMA_VERSION;
  readonly locale: "zh-CN";
  readonly presenterVersion: typeof BETA_REPORT_PRESENTER_VERSION;
  readonly reportQueryKey: string;
  readonly customFilteringActive: boolean;
  readonly metadata: {
    readonly mode: BetaReportMode;
    readonly year: number | null;
    readonly scope: BetaReportCalendarScope;
    readonly scopeLabel: string;
    readonly currentRangeLabel: string;
    readonly timezoneLabel: string;
    readonly partialLabel: string | null;
    readonly queryChips: readonly BetaLocalizedQueryChipV1[];
  };
  readonly sections: readonly BetaLocalizedReportSectionV1[];
  readonly methodology: readonly BetaLocalizedMethodologyFactV1[];
  readonly privacy: {
    readonly badgeLabel: string;
    readonly localOnlyLabel: string;
  };
}

const BETA_REPORT_MODES: readonly BetaReportMode[] = [
  "annual",
  "all-years",
  "multi-year-overview",
];
const BETA_REPORT_SCOPES: readonly BetaReportCalendarScope[] = [
  "full-calendar-query",
  "partial-calendar-query",
  "multi-year",
];
const BETA_REPORT_STATUSES: readonly BetaReportSectionStatus[] = [
  "READY",
  "EMPTY",
  "INSUFFICIENT",
  "PARTIAL",
  "UNAVAILABLE",
];
const BETA_REPORT_REASONS: readonly BetaReportReasonCode[] = [
  "NO_USER_MESSAGES",
  "NO_ACTIVE_DAYS",
  "NO_STREAK",
  "NO_PEAK_BUCKET",
  "NO_ELIGIBLE_TEXT_SAMPLE",
  "NO_SESSIONS",
  "NO_REPLY_SAMPLE",
  "NO_REPLY_DIRECTION_SAMPLE",
  "PARTIAL_CALENDAR_SCOPE",
  "MULTI_YEAR_SCOPE",
  "SENDER_COMPARISON_IGNORES_FILTER",
  "THRESHOLD_SENSITIVE",
  "UNAVAILABLE",
];
const BETA_REPORT_TEMPLATES: readonly BetaReportTemplateId[] = [
  "ANNUAL_OPENING_FULL",
  "ANNUAL_OPENING_PARTIAL",
  "ALL_YEARS_OPENING",
  "TOTAL_MESSAGES_READY",
  "TOTAL_MESSAGES_EMPTY",
  "ACTIVE_DAYS_READY",
  "ACTIVE_DAYS_EMPTY",
  "LONGEST_STREAK_SINGLE",
  "LONGEST_STREAK_TIE",
  "LONGEST_STREAK_EMPTY",
  "MOST_ACTIVE_MONTH_SINGLE",
  "MOST_ACTIVE_MONTH_TIE",
  "MOST_ACTIVE_MONTH_EMPTY",
  "MOST_ACTIVE_WEEKDAY_SINGLE",
  "MOST_ACTIVE_WEEKDAY_TIE",
  "MOST_ACTIVE_WEEKDAY_EMPTY",
  "MOST_ACTIVE_HOUR_SINGLE",
  "MOST_ACTIVE_HOUR_TIE",
  "MOST_ACTIVE_HOUR_EMPTY",
  "SENDER_SHARE_READY",
  "SENDER_SHARE_EMPTY",
  "MESSAGE_LENGTH_READY",
  "MESSAGE_LENGTH_INSUFFICIENT",
  "MESSAGE_TYPES_READY",
  "MESSAGE_TYPES_EMPTY",
  "SESSIONS_READY",
  "SESSIONS_EMPTY",
  "REPLY_INTERVALS_READY",
  "NO_REPLY_SAMPLE",
  "UNAVAILABLE",
];

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function safeYear(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 9999;
}

export function betaReportQueryKey(query: BetaReportQueryV1): string {
  return JSON.stringify([
    query.schemaVersion,
    query.datasetId,
    query.generation,
    query.baseQueryKey,
    query.mode,
    query.year,
  ]);
}

export function createBetaReportQuery(
  datasetId: DatasetId | null,
  generation: Generation,
  baseQueryKey: string,
  mode: BetaReportMode,
  year: number | null,
): BetaReportQueryV1 {
  const query: BetaReportQueryV1 = {
    schemaVersion: BETA_REPORT_QUERY_SCHEMA_VERSION,
    datasetId,
    generation,
    baseQueryKey,
    mode,
    year,
  };
  validateBetaReportQueryV1(query);
  return query;
}

export function validateBetaReportQueryV1(value: unknown): BetaReportQueryV1 {
  if (!record(value) || !exactKeys(value, ["baseQueryKey", "datasetId", "generation", "mode", "schemaVersion", "year"])) {
    throw new Error("INVALID_BETA_REPORT_QUERY");
  }
  const query = value as Record<string, unknown>;
  if (
    query.schemaVersion !== BETA_REPORT_QUERY_SCHEMA_VERSION ||
    (query.datasetId !== null && !isDatasetId(query.datasetId)) ||
    !Number.isSafeInteger(query.generation) ||
    (query.generation as number) < 1 ||
    typeof query.baseQueryKey !== "string" ||
    query.baseQueryKey.length === 0 ||
    query.baseQueryKey.length > 2048 ||
    !BETA_REPORT_MODES.includes(query.mode as BetaReportMode) ||
    (query.year !== null && !safeYear(query.year)) ||
    (query.mode === "annual" && query.year === null) ||
    (query.mode !== "annual" && query.year !== null)
  ) {
    throw new Error("INVALID_BETA_REPORT_QUERY");
  }
  return value as unknown as BetaReportQueryV1;
}

function validateRange(value: unknown): void {
  if (!record(value) || !exactKeys(value, ["endDate", "startDate"]) || !safeDate(value.startDate) || !safeDate(value.endDate) || value.startDate > value.endDate) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
}

function validateFactShape(value: unknown): void {
  if (!record(value)) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  for (const nested of Object.values(value)) {
    if (typeof nested === "number" && !Number.isFinite(nested)) {
      throw new Error("INVALID_BETA_REPORT_DTO");
    }
  }
}

export function validateBetaReportDtoV1(value: unknown): BetaReportDtoV1 {
  if (!record(value) || !exactKeys(value, ["export", "facts", "identity", "metadata", "methodology", "privacy", "schemaVersion", "sections", "wordEvidence"])) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  const dto = value as Record<string, unknown>;
  if (dto.schemaVersion !== BETA_REPORT_SCHEMA_VERSION || !record(dto.identity) || !record(dto.metadata) || !record(dto.privacy) || !record(dto.export) || !record(dto.wordEvidence) || !Array.isArray(dto.sections) || !Array.isArray(dto.methodology)) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  const identity = dto.identity as Record<string, unknown>;
  if (!exactKeys(identity, ["datasetId", "generation", "reportQueryKey"]) || (identity.datasetId !== null && !isDatasetId(identity.datasetId)) || !Number.isSafeInteger(identity.generation) || (identity.generation as number) < 1 || typeof identity.reportQueryKey !== "string") {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  if (!exactKeys(dto.metadata, ["appliedFilters", "currentRange", "mode", "representedYears", "scope", "timezone", "year"]) || !BETA_REPORT_MODES.includes(dto.metadata.mode as BetaReportMode) || !BETA_REPORT_SCOPES.includes(dto.metadata.scope as BetaReportCalendarScope) || dto.metadata.timezone !== BETA_REPORT_TIMEZONE || !Array.isArray(dto.metadata.representedYears) || dto.metadata.representedYears.some((year) => !safeYear(year)) || (dto.metadata.year !== null && !safeYear(dto.metadata.year))) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  validateRange(dto.metadata.currentRange);
  if (!record(dto.metadata.appliedFilters) || !exactKeys(dto.metadata.appliedFilters, ["sender", "sessionThresholdHours"]) || !["both", "owner", "other"].includes(dto.metadata.appliedFilters.sender as string) || ![1, 3, 6, 12, 24].includes(dto.metadata.appliedFilters.sessionThresholdHours as number)) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  if (!record(dto.facts)) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  const expectedFacts: readonly BetaReportFactKey[] = ["activeDays", "longestStreak", "messageLength", "messageTypes", "peakHour", "peakMonth", "peakWeekday", "replyIntervals", "senderShare", "sessions", "totalMessages"];
  if (!exactKeys(dto.facts, expectedFacts)) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  for (const fact of Object.values(dto.facts)) {
    validateFactShape(fact);
  }
  const sections = dto.sections as readonly unknown[];
  if (sections.length !== 16) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  sections.forEach((sectionValue, index) => {
    if (!record(sectionValue) || !exactKeys(sectionValue, ["factKey", "id", "order", "reason", "scene", "status", "templateId", "value"]) || sectionValue.order !== index + 1 || !BETA_REPORT_STATUSES.includes(sectionValue.status as BetaReportSectionStatus) || (sectionValue.reason !== null && !BETA_REPORT_REASONS.includes(sectionValue.reason as BetaReportReasonCode)) || !BETA_REPORT_TEMPLATES.includes(sectionValue.templateId as BetaReportTemplateId)) {
      throw new Error("INVALID_BETA_REPORT_DTO");
    }
  });
  if (!exactKeys(dto.wordEvidence, ["frequencyDtoKey", "status"]) || !["not-requested", "ready", "empty"].includes(dto.wordEvidence.status as string) || (dto.wordEvidence.frequencyDtoKey !== null && typeof dto.wordEvidence.frequencyDtoKey !== "string")) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  if (!exactKeys(dto.privacy, ["containsContactIdentity", "containsMessageBodies", "localOnly"]) || dto.privacy.localOnly !== true || dto.privacy.containsMessageBodies !== false || dto.privacy.containsContactIdentity !== false || !exactKeys(dto.export, ["anonymousRoleLabels", "containsContactIdentity", "containsMessageBodies", "localOnly", "supportedKinds"]) || dto.export.localOnly !== true || dto.export.anonymousRoleLabels !== true || dto.export.containsMessageBodies !== false || dto.export.containsContactIdentity !== false || !Array.isArray(dto.export.supportedKinds)) {
    throw new Error("INVALID_BETA_REPORT_DTO");
  }
  return value as unknown as BetaReportDtoV1;
}

export function validateBetaReportViewModelV1(value: unknown): BetaReportViewModelV1 {
  if (!record(value) || !exactKeys(value, ["customFilteringActive", "locale", "metadata", "methodology", "privacy", "presenterVersion", "reportQueryKey", "schemaVersion", "sections"])) {
    throw new Error("INVALID_BETA_REPORT_VIEW_MODEL");
  }
  const model = value as Record<string, unknown>;
  if (model.schemaVersion !== BETA_REPORT_VIEW_MODEL_SCHEMA_VERSION || model.locale !== "zh-CN" || model.presenterVersion !== BETA_REPORT_PRESENTER_VERSION || typeof model.reportQueryKey !== "string" || typeof model.customFilteringActive !== "boolean" || !record(model.metadata) || !Array.isArray(model.sections) || model.sections.length !== 16 || !Array.isArray(model.methodology) || !record(model.privacy)) {
    throw new Error("INVALID_BETA_REPORT_VIEW_MODEL");
  }
  if (!exactKeys(model.privacy, ["badgeLabel", "localOnlyLabel"]) || typeof model.privacy.badgeLabel !== "string" || typeof model.privacy.localOnlyLabel !== "string") {
    throw new Error("INVALID_BETA_REPORT_VIEW_MODEL");
  }
  return value as unknown as BetaReportViewModelV1;
}
