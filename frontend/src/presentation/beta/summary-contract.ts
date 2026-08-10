import {
  isDatasetId,
  type DatasetId,
  type Generation,
} from "../../desktop/ipc-contract";
import type { CanonicalSenderFilter } from "../../worker-analysis/analytics-contract";
import { BETA_REPORT_TIMEZONE } from "./report-contract";

export const BETA_SUMMARY_SCHEMA_VERSION =
  "chat-history-analysis.beta-summary.v1" as const;
export const SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION =
  "chat-history-analysis.share-card-view-model.v1" as const;
export const BETA_SUMMARY_PRESENTER_VERSION =
  "chat-history-analysis.beta-summary-presenter.zh-CN.v1" as const;
export const SHARE_CARD_COPY_VERSION =
  "chat-history-analysis.share-card-copy.v1" as const;
export const SHARE_CARD_ART_VERSION =
  "chat-history-analysis.share-card-art.v1" as const;
export const SHARE_CARD_RENDERER_VERSION =
  "chat-history-analysis.share-card-renderer.v1" as const;
export const SHARE_CARD_LAYOUT_VERSION =
  "chat-history-analysis.share-card-layout.v1" as const;
export const SHARE_CARD_MAX_VOCABULARY_ITEMS = 5 as const;

export type BetaSummaryScopeV1 =
  | {
      readonly kind: "single-year";
      readonly year: number;
      readonly startDate: string;
      readonly endDate: string;
      readonly partial: boolean;
    }
  | {
      readonly kind: "all-years";
      readonly year: null;
      readonly startDate: string;
      readonly endDate: string;
      readonly partial: boolean;
    };

export type BetaSummaryEvidenceStatusV1 =
  | "available"
  | "partial"
  | "unavailable";

export type BetaSummaryUnavailableReasonV1 =
  | "NO_PEAK_BUCKET"
  | "NO_STREAK"
  | "NO_SENDER_COMPARISON";

export type BetaSummaryFactV1<T> =
  | {
      readonly status: "available";
      readonly value: T;
    }
  | {
      readonly status: "partial";
      readonly value: T;
      readonly reason: "PARTIAL_DATE_RANGE";
    }
  | {
      readonly status: "unavailable";
      readonly value: null;
      readonly reason: BetaSummaryUnavailableReasonV1;
    };

export interface BetaSummaryCountFactV1 {
  readonly count: number;
}

export interface BetaSummaryMonthFactV1 {
  readonly monthKeys: readonly string[];
  readonly messageCount: number;
}

export interface BetaSummaryStreakIntervalV1 {
  readonly startDate: string;
  readonly endDate: string;
  readonly length: number;
}

export interface BetaSummaryStreakFactV1 {
  readonly length: number;
  readonly intervals: readonly BetaSummaryStreakIntervalV1[];
}

export interface BetaSummarySenderShareV1 {
  readonly role: "owner" | "other";
  readonly count: number;
  readonly share: number;
}

export interface BetaSummarySenderComparisonV1 {
  readonly denominator: number;
  readonly owner: BetaSummarySenderShareV1;
  readonly other: BetaSummarySenderShareV1;
  readonly filterBehavior: "ignores-global-sender-filter";
}

export interface BetaSummaryFactsV1 {
  readonly totalMessages: BetaSummaryFactV1<BetaSummaryCountFactV1>;
  readonly activeDays: BetaSummaryFactV1<BetaSummaryCountFactV1>;
  readonly mostActiveMonth: BetaSummaryFactV1<BetaSummaryMonthFactV1>;
  readonly longestStreak: BetaSummaryFactV1<BetaSummaryStreakFactV1>;
  readonly senderComparison: BetaSummaryFactV1<BetaSummarySenderComparisonV1>;
}

export interface BetaSummaryVocabularyItemV1 {
  readonly displayRank: number;
  readonly token: string;
}

export type BetaSummaryVocabularyV1 =
  | {
      readonly mode: "off";
      readonly items: readonly [];
    }
  | {
      readonly mode: "on";
      readonly items: readonly BetaSummaryVocabularyItemV1[];
    }
  | {
      readonly mode: "unavailable";
      readonly items: readonly [];
      readonly reason: "NO_VISIBLE_CANDIDATES";
    };

export interface BetaSummaryVersionsV1 {
  readonly presenter: typeof BETA_SUMMARY_PRESENTER_VERSION;
  readonly copy: typeof SHARE_CARD_COPY_VERSION;
  readonly artwork: typeof SHARE_CARD_ART_VERSION;
}

export type BetaSummaryExportAvailabilityV1 =
  | {
      readonly status: "ready";
      readonly reason: null;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "NO_USER_MESSAGES";
    };

export interface BetaSummaryDtoV1 {
  readonly schemaVersion: typeof BETA_SUMMARY_SCHEMA_VERSION;
  readonly identity: {
    readonly datasetId: DatasetId | null;
    readonly generation: Generation;
    readonly reportQueryKey: string;
  };
  readonly scope: BetaSummaryScopeV1;
  readonly timezone: typeof BETA_REPORT_TIMEZONE;
  readonly senderFilter: CanonicalSenderFilter;
  readonly facts: BetaSummaryFactsV1;
  readonly vocabulary: BetaSummaryVocabularyV1;
  readonly exportAvailability: BetaSummaryExportAvailabilityV1;
  readonly footer: {
    readonly localOnlyLabel: "本地生成 · 不上传";
    readonly productSignature: "聊天记录分析";
  };
  readonly versions: BetaSummaryVersionsV1;
}

export interface ShareCardMetricViewModelV1 {
  readonly status: "available" | "unavailable";
  readonly label: string;
  readonly value: string | null;
  readonly unit: string;
  readonly detail: string;
}

export interface ShareCardSenderRoleViewModelV1 {
  readonly label: "Owner" | "Other";
  readonly count: string | null;
  readonly share: string | null;
}

export type ShareCardSenderComparisonViewModelV1 =
  | {
      readonly status: "available";
      readonly owner: ShareCardSenderRoleViewModelV1;
      readonly other: ShareCardSenderRoleViewModelV1;
      readonly denominator: string;
      readonly detail: string;
    }
  | {
      readonly status: "unavailable";
      readonly owner: ShareCardSenderRoleViewModelV1;
      readonly other: ShareCardSenderRoleViewModelV1;
      readonly denominator: null;
      readonly detail: "证据不足";
    };

export interface ShareCardVocabularyItemViewModelV1 {
  readonly displayRank: number;
  readonly token: string;
}

export type ShareCardVocabularyModeV1 = "off" | "on" | "unavailable";

export type ShareCardVocabularyViewModelV1 =
  | {
      readonly mode: "off";
      readonly label: "未包含词汇摘要";
      readonly items: readonly [];
    }
  | {
      readonly mode: "on";
      readonly label: "常见词包括";
      readonly items: readonly ShareCardVocabularyItemViewModelV1[];
    }
  | {
      readonly mode: "unavailable";
      readonly label: "当前没有可用词汇摘要";
      readonly items: readonly [];
      readonly reason: "NO_VISIBLE_CANDIDATES";
    };

export type ShareCardExportAvailabilityViewModelV1 =
  | {
      readonly status: "ready";
      readonly reason: null;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "NO_USER_MESSAGES";
    };

export interface ShareCardViewModelV1 {
  readonly schemaVersion: typeof SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION;
  readonly locale: "zh-CN";
  readonly scope: BetaSummaryScopeV1;
  readonly headline: string;
  readonly rangeLabel: string;
  readonly partialLabel: "部分日期范围" | null;
  readonly senderFilterContext: {
    readonly appliedFilterLabel: string;
    readonly disclosure: string | null;
  };
  readonly metrics: {
    readonly totalMessages: ShareCardMetricViewModelV1;
    readonly activeDays: ShareCardMetricViewModelV1;
    readonly mostActiveMonth: ShareCardMetricViewModelV1;
    readonly longestStreak: ShareCardMetricViewModelV1;
  };
  readonly senderComparison: ShareCardSenderComparisonViewModelV1;
  readonly vocabulary: ShareCardVocabularyViewModelV1;
  readonly exportAvailability: ShareCardExportAvailabilityViewModelV1;
  readonly privacyLine: "本地生成 · 不上传";
  readonly timezoneLabel: typeof BETA_REPORT_TIMEZONE;
  readonly productSignature: "聊天记录分析";
  readonly versions: {
    readonly renderer: typeof SHARE_CARD_RENDERER_VERSION;
    readonly copy: typeof SHARE_CARD_COPY_VERSION;
    readonly artwork: typeof SHARE_CARD_ART_VERSION;
    readonly layout: typeof SHARE_CARD_LAYOUT_VERSION;
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function safeYear(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 9999;
}

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safePositiveCount(value: unknown): value is number {
  return safeCount(value) && value > 0;
}

function safeShare(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function validateScope(value: unknown): asserts value is BetaSummaryScopeV1 {
  if (!record(value) || !exactKeys(value, ["endDate", "kind", "partial", "startDate", "year"])) {
    throw new Error("INVALID_BETA_SUMMARY_SCOPE");
  }
  if (!safeDate(value.startDate) || !safeDate(value.endDate) || value.startDate > value.endDate || typeof value.partial !== "boolean") {
    throw new Error("INVALID_BETA_SUMMARY_SCOPE");
  }
  if (value.kind === "single-year") {
    if (!safeYear(value.year)) {
      throw new Error("INVALID_BETA_SUMMARY_SCOPE");
    }
    return;
  }
  if (value.kind !== "all-years" || value.year !== null) {
    throw new Error("INVALID_BETA_SUMMARY_SCOPE");
  }
}

function validateFact<T>(
  value: unknown,
  validateValue: (candidate: unknown) => candidate is T,
  unavailableReasons: readonly BetaSummaryUnavailableReasonV1[],
): void {
  if (!record(value) || typeof value.status !== "string") {
    throw new Error("INVALID_BETA_SUMMARY_FACT");
  }
  if (value.status === "available") {
    if (!exactKeys(value, ["status", "value"]) || !validateValue(value.value)) {
      throw new Error("INVALID_BETA_SUMMARY_FACT");
    }
    return;
  }
  if (value.status === "partial") {
    if (!exactKeys(value, ["reason", "status", "value"]) || value.reason !== "PARTIAL_DATE_RANGE" || !validateValue(value.value)) {
      throw new Error("INVALID_BETA_SUMMARY_FACT");
    }
    return;
  }
  if (value.status !== "unavailable" || !exactKeys(value, ["reason", "status", "value"]) || value.value !== null || !unavailableReasons.includes(value.reason as BetaSummaryUnavailableReasonV1)) {
    throw new Error("INVALID_BETA_SUMMARY_FACT");
  }
}

function validateCountFact(value: unknown): value is BetaSummaryCountFactV1 {
  return record(value) && exactKeys(value, ["count"]) && safeCount(value.count);
}

function validateMonthFact(value: unknown): value is BetaSummaryMonthFactV1 {
  if (!record(value) || !exactKeys(value, ["messageCount", "monthKeys"]) || !safePositiveCount(value.messageCount) || !Array.isArray(value.monthKeys) || value.monthKeys.length === 0 || value.monthKeys.length > 12) {
    return false;
  }
  let previous = "";
  return value.monthKeys.every((month) => {
    const valid = typeof month === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month) && month > previous;
    previous = typeof month === "string" ? month : previous;
    return valid;
  });
}

function validateStreakFact(value: unknown): value is BetaSummaryStreakFactV1 {
  if (!record(value) || !exactKeys(value, ["intervals", "length"]) || !safePositiveCount(value.length) || !Array.isArray(value.intervals) || value.intervals.length === 0) {
    return false;
  }
  let previousStart = "";
  return value.intervals.every((interval) => {
    if (!record(interval) || !exactKeys(interval, ["endDate", "length", "startDate"]) || !safePositiveCount(interval.length) || interval.length !== value.length || !safeDate(interval.startDate) || !safeDate(interval.endDate) || interval.startDate > interval.endDate || interval.startDate <= previousStart) {
      return false;
    }
    previousStart = interval.startDate;
    return true;
  });
}

function validateSenderShare(value: unknown, role: "owner" | "other"): value is BetaSummarySenderShareV1 {
  return record(value) && exactKeys(value, ["count", "role", "share"]) && value.role === role && safeCount(value.count) && safeShare(value.share);
}

function validateSenderFact(value: unknown): value is BetaSummarySenderComparisonV1 {
  if (!record(value) || !exactKeys(value, ["denominator", "filterBehavior", "other", "owner"]) || !safePositiveCount(value.denominator) || value.filterBehavior !== "ignores-global-sender-filter" || !validateSenderShare(value.owner, "owner") || !validateSenderShare(value.other, "other")) {
    return false;
  }
  const owner = value.owner as unknown as Record<string, unknown>;
  const other = value.other as unknown as Record<string, unknown>;
  return owner.count as number + (other.count as number) === value.denominator &&
    Math.abs((owner.share as number) - (owner.count as number) / (value.denominator as number)) <= Number.EPSILON * 10_000 &&
    Math.abs((other.share as number) - (other.count as number) / (value.denominator as number)) <= Number.EPSILON * 10_000;
}

function validateVocabulary(value: unknown): value is BetaSummaryVocabularyV1 {
  if (!record(value) || typeof value.mode !== "string" || !Array.isArray(value.items)) {
    return false;
  }
  if (value.mode === "off") {
    return exactKeys(value, ["items", "mode"]) && value.items.length === 0;
  }
  if (value.mode === "unavailable") {
    return exactKeys(value, ["items", "mode", "reason"]) && value.reason === "NO_VISIBLE_CANDIDATES" && value.items.length === 0;
  }
  if (value.mode !== "on" || !exactKeys(value, ["items", "mode"]) || value.items.length === 0 || value.items.length > SHARE_CARD_MAX_VOCABULARY_ITEMS) {
    return false;
  }
  return value.items.every((item, index) => record(item) && exactKeys(item, ["displayRank", "token"]) && item.displayRank === index + 1 && safeText(item.token) && [...item.token].length <= 32);
}

function validateSummaryFacts(value: unknown): value is BetaSummaryFactsV1 {
  if (!record(value) || !exactKeys(value, ["activeDays", "longestStreak", "mostActiveMonth", "senderComparison", "totalMessages"])) {
    return false;
  }
  validateFact(value.totalMessages, validateCountFact, []);
  validateFact(value.activeDays, validateCountFact, []);
  validateFact(value.mostActiveMonth, validateMonthFact, ["NO_PEAK_BUCKET"]);
  validateFact(value.longestStreak, validateStreakFact, ["NO_STREAK"]);
  validateFact(value.senderComparison, validateSenderFact, ["NO_SENDER_COMPARISON"]);
  const total = value.totalMessages as Record<string, unknown>;
  const active = value.activeDays as Record<string, unknown>;
  return total.status !== "unavailable" && active.status !== "unavailable";
}

function validateSummaryAvailability(value: unknown): value is BetaSummaryExportAvailabilityV1 {
  if (!record(value) || !exactKeys(value, ["reason", "status"])) {
    return false;
  }
  return value.status === "ready"
    ? value.reason === null
    : value.status === "unavailable" && value.reason === "NO_USER_MESSAGES";
}

function validateSummaryVersions(value: unknown): value is BetaSummaryVersionsV1 {
  return record(value) && exactKeys(value, ["artwork", "copy", "presenter"]) && value.presenter === BETA_SUMMARY_PRESENTER_VERSION && value.copy === SHARE_CARD_COPY_VERSION && value.artwork === SHARE_CARD_ART_VERSION;
}

export function validateBetaSummaryDtoV1(value: unknown): BetaSummaryDtoV1 {
  if (!record(value) || !exactKeys(value, ["exportAvailability", "facts", "footer", "identity", "schemaVersion", "scope", "senderFilter", "timezone", "versions", "vocabulary"])) {
    throw new Error("INVALID_BETA_SUMMARY_DTO");
  }
  if (value.schemaVersion !== BETA_SUMMARY_SCHEMA_VERSION || !record(value.identity) || !exactKeys(value.identity, ["datasetId", "generation", "reportQueryKey"])) {
    throw new Error("INVALID_BETA_SUMMARY_DTO");
  }
  const identity = value.identity as Record<string, unknown>;
  if ((identity.datasetId !== null && !isDatasetId(identity.datasetId)) || typeof identity.generation !== "number" || !Number.isSafeInteger(identity.generation) || identity.generation < 1 || typeof identity.reportQueryKey !== "string" || identity.reportQueryKey.length === 0 || identity.reportQueryKey.length > 4096) {
    throw new Error("INVALID_BETA_SUMMARY_DTO");
  }
  validateScope(value.scope);
  if (value.timezone !== BETA_REPORT_TIMEZONE || !["both", "owner", "other"].includes(value.senderFilter as string) || !validateSummaryFacts(value.facts) || !validateVocabulary(value.vocabulary) || !validateSummaryAvailability(value.exportAvailability) || !record(value.footer) || !exactKeys(value.footer, ["localOnlyLabel", "productSignature"]) || value.footer.localOnlyLabel !== "本地生成 · 不上传" || value.footer.productSignature !== "聊天记录分析" || !validateSummaryVersions(value.versions)) {
    throw new Error("INVALID_BETA_SUMMARY_DTO");
  }
  return value as unknown as BetaSummaryDtoV1;
}

function validateMetric(value: unknown): value is ShareCardMetricViewModelV1 {
  if (!record(value) || !exactKeys(value, ["detail", "label", "status", "unit", "value"]) || !safeText(value.label) || !safeText(value.detail) || typeof value.unit !== "string") {
    return false;
  }
  if (value.status === "available") {
    return safeText(value.value);
  }
  return value.status === "unavailable" && value.value === null && value.unit === "" && value.detail === "证据不足";
}

function validateSenderRoleModel(value: unknown, label: "Owner" | "Other"): value is ShareCardSenderRoleViewModelV1 {
  return record(value) && exactKeys(value, ["count", "label", "share"]) && value.label === label && (value.count === null || safeText(value.count)) && (value.share === null || safeText(value.share));
}

function validateSenderComparisonModel(value: unknown): value is ShareCardSenderComparisonViewModelV1 {
  if (!record(value) || !validateSenderRoleModel(value.owner, "Owner") || !validateSenderRoleModel(value.other, "Other") || !exactKeys(value, ["detail", "denominator", "other", "owner", "status"])) {
    return false;
  }
  if (value.status === "available") {
    return safeText(value.denominator) && safeText(value.detail) && value.owner.count !== null && value.owner.share !== null && value.other.count !== null && value.other.share !== null;
  }
  return value.status === "unavailable" && value.denominator === null && value.detail === "证据不足" && value.owner.count === null && value.owner.share === null && value.other.count === null && value.other.share === null;
}

function validateVocabularyModel(value: unknown): value is ShareCardVocabularyViewModelV1 {
  if (!record(value) || !Array.isArray(value.items) || typeof value.mode !== "string") {
    return false;
  }
  if (value.mode === "off") {
    return exactKeys(value, ["items", "label", "mode"]) && value.label === "未包含词汇摘要" && value.items.length === 0;
  }
  if (value.mode === "unavailable") {
    return exactKeys(value, ["items", "label", "mode", "reason"]) && value.label === "当前没有可用词汇摘要" && value.reason === "NO_VISIBLE_CANDIDATES" && value.items.length === 0;
  }
  if (value.mode !== "on" || !exactKeys(value, ["items", "label", "mode"]) || value.label !== "常见词包括" || value.items.length === 0 || value.items.length > SHARE_CARD_MAX_VOCABULARY_ITEMS) {
    return false;
  }
  return value.items.every((item, index) => record(item) && exactKeys(item, ["displayRank", "token"]) && item.displayRank === index + 1 && safeText(item.token) && [...item.token].length <= 32);
}

function validateViewAvailability(value: unknown): value is ShareCardExportAvailabilityViewModelV1 {
  return validateSummaryAvailability(value);
}

function validateViewVersions(value: unknown): boolean {
  return record(value) && exactKeys(value, ["artwork", "copy", "layout", "renderer"]) && value.renderer === SHARE_CARD_RENDERER_VERSION && value.copy === SHARE_CARD_COPY_VERSION && value.artwork === SHARE_CARD_ART_VERSION && value.layout === SHARE_CARD_LAYOUT_VERSION;
}

const FORBIDDEN_VIEW_MODEL_KEY = /^(?:source|sourceFile|sourceFilename|sourcePath|filename|fileName|path|raw|messageBody|messageText|contact|contactIdentity|accountId|datasetId|generation|sessionId|resultId|queryKey|frequencyDtoKey|canonicalQueryKey|reportQueryKey|sessionThreshold|customHidden|hiddenTokens|internal|trace)$/iu;
const FORBIDDEN_VIEW_MODEL_VALUE = /(?:data[\\/]private|(?:^|[\\/])Users[\\/]|(?:^|[\\/])home[\\/]|\.json$)/iu;

function assertNoForbiddenViewModelData(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenViewModelData);
    return;
  }
  if (!record(value)) {
    if (typeof value === "string" && FORBIDDEN_VIEW_MODEL_VALUE.test(value)) {
      throw new Error("SHARE_CARD_PRIVACY_VIOLATION");
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_VIEW_MODEL_KEY.test(key)) {
      throw new Error("SHARE_CARD_PRIVACY_VIOLATION");
    }
    assertNoForbiddenViewModelData(nested);
  }
}

export function validateShareCardViewModelV1(value: unknown): ShareCardViewModelV1 {
  if (!record(value) || !exactKeys(value, ["exportAvailability", "headline", "locale", "metrics", "partialLabel", "privacyLine", "productSignature", "rangeLabel", "schemaVersion", "scope", "senderComparison", "senderFilterContext", "timezoneLabel", "versions", "vocabulary"])) {
    throw new Error("INVALID_SHARE_CARD_VIEW_MODEL");
  }
  if (value.schemaVersion !== SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION || value.locale !== "zh-CN" || !safeText(value.headline) || !safeText(value.rangeLabel) || (value.partialLabel !== null && value.partialLabel !== "部分日期范围") || value.privacyLine !== "本地生成 · 不上传" || value.timezoneLabel !== BETA_REPORT_TIMEZONE || value.productSignature !== "聊天记录分析") {
    throw new Error("INVALID_SHARE_CARD_VIEW_MODEL");
  }
  validateScope(value.scope);
  if (!record(value.senderFilterContext) || !exactKeys(value.senderFilterContext, ["appliedFilterLabel", "disclosure"]) || !safeText(value.senderFilterContext.appliedFilterLabel) || (value.senderFilterContext.disclosure !== null && !safeText(value.senderFilterContext.disclosure))) {
    throw new Error("INVALID_SHARE_CARD_VIEW_MODEL");
  }
  if (!record(value.metrics) || !exactKeys(value.metrics, ["activeDays", "longestStreak", "mostActiveMonth", "totalMessages"]) || !validateMetric(value.metrics.totalMessages) || !validateMetric(value.metrics.activeDays) || !validateMetric(value.metrics.mostActiveMonth) || !validateMetric(value.metrics.longestStreak) || !validateSenderComparisonModel(value.senderComparison) || !validateVocabularyModel(value.vocabulary) || !validateViewAvailability(value.exportAvailability) || !validateViewVersions(value.versions)) {
    throw new Error("INVALID_SHARE_CARD_VIEW_MODEL");
  }
  assertNoForbiddenViewModelData(value);
  return value as unknown as ShareCardViewModelV1;
}

export function validateShareCardViewModelPrivacyV1(value: unknown): ShareCardViewModelV1 {
  return validateShareCardViewModelV1(value);
}
