import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  CANONICAL_MANIFEST_SCHEMA_VERSION,
  CANONICAL_MESSAGE_CATEGORIES,
  METRIC_DEFINITION_VERSIONS,
  type CanonicalMessageCategory,
  type MetricDefinitionVersions,
  type CanonicalEventV2,
} from "../canonical-v2/schema";
import {
  isDatasetId,
  isSessionId,
  type DatasetId,
  type Generation,
  type SessionId,
} from "../desktop/ipc-contract";

export const ANALYTICS_RESULT_SCHEMA_VERSION =
  "chat-history-analysis.analytics-result.v1" as const;

export type CanonicalSenderFilter = "both" | "owner" | "other";

export const SESSION_THRESHOLD_HOURS = [1, 3, 6, 12, 24] as const;
export type SessionThresholdHours = (typeof SESSION_THRESHOLD_HOURS)[number];
export const DEFAULT_SESSION_THRESHOLD_HOURS = 6 as const;
export const COMPARATIVE_SENDER_SCOPE = "both" as const;

export interface CanonicalAnalysisFilters {
  readonly startDate: string;
  readonly endDate: string;
  readonly sender: CanonicalSenderFilter;
  readonly selectedYear: number | null;
  readonly sessionThresholdHours: SessionThresholdHours;
}

export interface DatasetCorrelation {
  readonly sessionId: SessionId | null;
  readonly datasetId: DatasetId | null;
  readonly generation: Generation;
}

export interface CanonicalDatasetSummary {
  readonly schemaVersion: typeof CANONICAL_MANIFEST_SCHEMA_VERSION;
  readonly eventCount: number;
  readonly userMessageCount: number;
  readonly eligibleTextCount: number;
  readonly systemEventCount: number;
  readonly chunkCount: number;
  readonly totalBytes: number;
  readonly warningCount: number;
  readonly messageCategoryCounts: Readonly<
    Record<CanonicalMessageCategory, number>
  >;
  readonly unknownSenderCount: number;
  readonly minimumCalendarDate: string;
  readonly maximumCalendarDate: string;
  readonly pseudonymous: true;
}

export interface CanonicalIndexSummary {
  readonly indexedRecordCount: number;
  readonly eligibleTextCodePointCount: number;
  readonly tokenCount: number;
  readonly distinctTokenCount: number;
  readonly typedArrayBytes: number;
}

export interface CanonicalAggregateSummary {
  readonly eventCount: number;
  readonly userMessageCount: number;
  readonly eligibleTextCount: number;
  readonly systemEventCount: number;
  readonly messageCategoryCounts: Readonly<
    Record<CanonicalMessageCategory, number>
  >;
  readonly senderCounts: Readonly<{ owner: number; other: number }>;
  readonly unknownSenderCount: number;
  readonly eligibleTextCodePointCount: number;
  readonly tokenCount: number;
}

export interface CanonicalAnalysisResult {
  readonly schemaVersion: typeof ANALYTICS_RESULT_SCHEMA_VERSION;
  readonly datasetSchemaVersion: typeof CANONICAL_EVENT_SCHEMA_VERSION;
  readonly sessionId: SessionId | null;
  readonly datasetId: DatasetId | null;
  readonly generation: Generation;
  readonly metricDefinitionVersions: MetricDefinitionVersions;
  readonly queryKey: string;
  readonly filters: CanonicalAnalysisFilters;
  readonly dataset: CanonicalDatasetSummary;
  readonly index: CanonicalIndexSummary;
  readonly aggregate: CanonicalAggregateSummary;
}

export interface CanonicalAnalysisSettings extends CanonicalAnalysisFilters {
  readonly kind: "canonical-v2";
}

export function isCanonicalUserMessage(
  event: Pick<CanonicalEventV2, "messageCategory" | "senderScope">,
): boolean {
  return event.messageCategory !== "system" && event.senderScope !== null;
}

export function isCanonicalEligibleText(
  event: Pick<CanonicalEventV2, "textEligible" | "content">,
): boolean {
  return event.textEligible && event.content !== null;
}

export function isCanonicalSystemDiagnostic(
  event: Pick<CanonicalEventV2, "messageCategory">,
): boolean {
  return event.messageCategory === "system";
}

export function canonicalShare(
  numerator: number,
  denominator: number,
): number | null {
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function comparativeFilters(
  filters: CanonicalAnalysisFilters,
): CanonicalAnalysisFilters {
  return {
    ...filters,
    sender: COMPARATIVE_SENDER_SCOPE,
  };
}

export function canonicalDateCode(value: string): number {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    throw new Error("INVALID_DATE");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new Error("INVALID_DATE");
  }
  return year * 372 + month * 31 + day;
}

export function validateCanonicalFilters(
  filters: CanonicalAnalysisFilters,
  dataset: Pick<CanonicalDatasetSummary, "minimumCalendarDate" | "maximumCalendarDate">,
): void {
  if (
    !["both", "owner", "other"].includes(filters.sender) ||
    filters.startDate < dataset.minimumCalendarDate ||
    filters.endDate > dataset.maximumCalendarDate ||
    filters.startDate > filters.endDate ||
    (filters.selectedYear !== null &&
      (!Number.isSafeInteger(filters.selectedYear) ||
        filters.selectedYear < 1 ||
        filters.selectedYear > 9999)) ||
    !SESSION_THRESHOLD_HOURS.includes(filters.sessionThresholdHours)
  ) {
    throw new Error("INVALID_FILTERS");
  }
  canonicalDateCode(filters.startDate);
  canonicalDateCode(filters.endDate);
}

export function canonicalQueryKey(
  generation: Generation,
  filters: CanonicalAnalysisFilters,
): string {
  return JSON.stringify([
    generation,
    METRIC_DEFINITION_VERSIONS,
    filters.startDate,
    filters.endDate,
    filters.sender,
    filters.selectedYear,
    filters.sessionThresholdHours,
  ]);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function categoryTotal(
  value: Record<CanonicalMessageCategory, number>,
): number {
  return CANONICAL_MESSAGE_CATEGORIES.reduce(
    (total, category) => total + value[category],
    0,
  );
}

function exactCategoryCounts(
  value: unknown,
): value is Record<CanonicalMessageCategory, number> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(
      value as Record<string, unknown>,
      CANONICAL_MESSAGE_CATEGORIES,
    )
  ) {
    return false;
  }
  return CANONICAL_MESSAGE_CATEGORIES.every((category) =>
    safeInteger((value as Record<string, unknown>)[category]),
  );
}

function validateAggregate(value: unknown): CanonicalAggregateSummary {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("INVALID_RESULT");
  }
  const aggregate = value as Record<string, unknown>;
  if (
    !exactKeys(aggregate, [
      "eligibleTextCodePointCount",
      "eligibleTextCount",
      "eventCount",
      "messageCategoryCounts",
      "senderCounts",
      "systemEventCount",
      "tokenCount",
      "unknownSenderCount",
      "userMessageCount",
    ]) ||
    !safeInteger(aggregate.eventCount) ||
    !safeInteger(aggregate.userMessageCount) ||
    !safeInteger(aggregate.eligibleTextCount) ||
    !safeInteger(aggregate.systemEventCount) ||
    !safeInteger(aggregate.eligibleTextCodePointCount) ||
    !safeInteger(aggregate.tokenCount) ||
    !safeInteger(aggregate.unknownSenderCount) ||
    !exactCategoryCounts(aggregate.messageCategoryCounts) ||
    aggregate.senderCounts === null ||
    typeof aggregate.senderCounts !== "object" ||
    Array.isArray(aggregate.senderCounts) ||
    !exactKeys(aggregate.senderCounts as Record<string, unknown>, [
      "owner",
      "other",
    ]) ||
    !safeInteger(
      (aggregate.senderCounts as Record<string, unknown>).owner,
    ) ||
    !safeInteger(
      (aggregate.senderCounts as Record<string, unknown>).other,
    )
  ) {
    throw new Error("INVALID_RESULT");
  }
  const categoryCounts = aggregate.messageCategoryCounts as Record<
    CanonicalMessageCategory,
    number
  >;
  if (
    aggregate.eventCount !==
      aggregate.userMessageCount + aggregate.systemEventCount ||
    categoryTotal(categoryCounts) !== aggregate.userMessageCount
  ) {
    throw new Error("INVALID_RESULT");
  }
  return aggregate as unknown as CanonicalAggregateSummary;
}

export function validateCanonicalAnalyticsResult(
  value: unknown,
): CanonicalAnalysisResult {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("INVALID_RESULT");
  }
  const result = value as Record<string, unknown>;
  if (
    !exactKeys(result, [
      "aggregate",
      "dataset",
      "datasetId",
      "datasetSchemaVersion",
      "filters",
      "generation",
      "index",
      "metricDefinitionVersions",
      "queryKey",
      "schemaVersion",
      "sessionId",
    ]) ||
    result.schemaVersion !== ANALYTICS_RESULT_SCHEMA_VERSION ||
    result.datasetSchemaVersion !== CANONICAL_EVENT_SCHEMA_VERSION ||
    !Number.isSafeInteger(result.generation) ||
    (result.generation as number) < 1 ||
    typeof result.queryKey !== "string" ||
    (result.sessionId !== null && !isSessionId(result.sessionId)) ||
    (result.datasetId !== null && !isDatasetId(result.datasetId)) ||
    result.metricDefinitionVersions === null ||
    typeof result.metricDefinitionVersions !== "object" ||
    Array.isArray(result.metricDefinitionVersions) ||
    !exactKeys(
      result.metricDefinitionVersions as Record<string, unknown>,
      Object.keys(METRIC_DEFINITION_VERSIONS),
    ) ||
    Object.entries(METRIC_DEFINITION_VERSIONS).some(
      ([key, value]) =>
        (result.metricDefinitionVersions as Record<string, unknown>)[key] !==
        value,
    )
  ) {
    throw new Error("INVALID_RESULT");
  }
  if (
    result.filters === null ||
    typeof result.filters !== "object" ||
    Array.isArray(result.filters)
  ) {
    throw new Error("INVALID_RESULT");
  }
  const filters = result.filters as Record<string, unknown>;
  if (
    !exactKeys(filters, [
      "endDate",
      "selectedYear",
      "sender",
      "sessionThresholdHours",
      "startDate",
    ]) ||
    typeof filters.startDate !== "string" ||
    typeof filters.endDate !== "string" ||
    !["both", "owner", "other"].includes(filters.sender as string) ||
    (filters.selectedYear !== null &&
      (!Number.isSafeInteger(filters.selectedYear) ||
        (filters.selectedYear as number) < 1 ||
        (filters.selectedYear as number) > 9999)) ||
    !SESSION_THRESHOLD_HOURS.includes(
      filters.sessionThresholdHours as SessionThresholdHours,
    )
  ) {
    throw new Error("INVALID_RESULT");
  }
  canonicalDateCode(filters.startDate);
  canonicalDateCode(filters.endDate);
  if (
    result.dataset === null ||
    typeof result.dataset !== "object" ||
    Array.isArray(result.dataset)
  ) {
    throw new Error("INVALID_RESULT");
  }
  const dataset = result.dataset as Record<string, unknown>;
  if (
    !exactKeys(dataset, [
      "chunkCount",
      "eligibleTextCount",
      "eventCount",
      "maximumCalendarDate",
      "messageCategoryCounts",
      "minimumCalendarDate",
      "pseudonymous",
      "systemEventCount",
      "totalBytes",
      "unknownSenderCount",
      "userMessageCount",
      "warningCount",
      "schemaVersion",
    ]) ||
    dataset.schemaVersion !== CANONICAL_MANIFEST_SCHEMA_VERSION ||
    dataset.pseudonymous !== true ||
    typeof dataset.minimumCalendarDate !== "string" ||
    typeof dataset.maximumCalendarDate !== "string" ||
    !safeInteger(dataset.eventCount) ||
    !safeInteger(dataset.userMessageCount) ||
    !safeInteger(dataset.eligibleTextCount) ||
    !safeInteger(dataset.systemEventCount) ||
    !safeInteger(dataset.chunkCount) ||
    !safeInteger(dataset.totalBytes) ||
    !safeInteger(dataset.warningCount) ||
    !safeInteger(dataset.unknownSenderCount) ||
    !exactCategoryCounts(dataset.messageCategoryCounts)
  ) {
    throw new Error("INVALID_RESULT");
  }
  canonicalDateCode(dataset.minimumCalendarDate);
  canonicalDateCode(dataset.maximumCalendarDate);
  if (dataset.minimumCalendarDate > dataset.maximumCalendarDate) {
    throw new Error("INVALID_RESULT");
  }
  const datasetCategoryCounts = dataset.messageCategoryCounts as Record<
    CanonicalMessageCategory,
    number
  >;
  if (
    dataset.eventCount !==
      dataset.userMessageCount + dataset.systemEventCount ||
    categoryTotal(datasetCategoryCounts) !== dataset.eventCount
  ) {
    throw new Error("INVALID_RESULT");
  }
  try {
    validateCanonicalFilters(
      filters as unknown as CanonicalAnalysisFilters,
      dataset as unknown as Pick<
        CanonicalDatasetSummary,
        "minimumCalendarDate" | "maximumCalendarDate"
      >,
    );
  } catch {
    throw new Error("INVALID_RESULT");
  }
  if (
    result.queryKey !==
    canonicalQueryKey(
      result.generation as Generation,
      filters as unknown as CanonicalAnalysisFilters,
    )
  ) {
    throw new Error("INVALID_RESULT");
  }
  if (
    result.index === null ||
    typeof result.index !== "object" ||
    Array.isArray(result.index)
  ) {
    throw new Error("INVALID_RESULT");
  }
  validateAggregate(result.aggregate);
  const index = result.index as Record<string, unknown>;
  if (
    !exactKeys(index, [
      "distinctTokenCount",
      "eligibleTextCodePointCount",
      "indexedRecordCount",
      "tokenCount",
      "typedArrayBytes",
    ]) ||
    !safeInteger(index.distinctTokenCount) ||
    !safeInteger(index.eligibleTextCodePointCount) ||
    !safeInteger(index.indexedRecordCount) ||
    !safeInteger(index.tokenCount) ||
    !safeInteger(index.typedArrayBytes)
  ) {
    throw new Error("INVALID_RESULT");
  }
  return result as unknown as CanonicalAnalysisResult;
}
