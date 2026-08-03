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
import {
  ACTIVITY_METRICS_SCHEMA_VERSION,
  ACTIVITY_TIME_POLICY,
  ACTIVITY_USER_MESSAGE_POPULATION,
  WEEKDAY_LABELS,
  type CanonicalActivityMetrics,
  type CanonicalWeekday,
} from "./activity-metrics";
import {
  calendarDateFromDayOrdinal,
  calendarDateParts,
  calendarDayOrdinal,
  daysInMonth,
} from "./calendar";
import {
  validateStage7Metrics,
  type Stage7Metrics,
} from "./stage7-metrics";

export const ANALYTICS_RESULT_SCHEMA_VERSION =
  "chat-history-analysis.analytics-result.v2" as const;

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
  readonly activity: CanonicalActivityMetrics;
  readonly stage7: Stage7Metrics;
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

function safeShareValue(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1)
  );
}

function expectedShare(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function validateTrendBuckets(
  value: unknown,
  period: "daily" | "monthly" | "yearly",
): void {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error("INVALID_RESULT");
  }
  let previousKey: string | undefined;
  for (const bucket of value) {
    if (
      bucket === null ||
      typeof bucket !== "object" ||
      Array.isArray(bucket) ||
      !exactKeys(bucket as Record<string, unknown>, [
        "count",
        "key",
        "partial",
      ]) ||
      typeof (bucket as Record<string, unknown>).key !== "string" ||
      !safeInteger((bucket as Record<string, unknown>).count) ||
      typeof (bucket as Record<string, unknown>).partial !== "boolean"
    ) {
      throw new Error("INVALID_RESULT");
    }
    const key = (bucket as Record<string, unknown>).key as string;
    if (previousKey !== undefined && key <= previousKey) {
      throw new Error("INVALID_RESULT");
    }
    try {
      canonicalDateCode(
        period === "daily"
          ? key
          : period === "monthly"
            ? `${key}-01`
            : `${key}-01-01`,
      );
    } catch {
      throw new Error("INVALID_RESULT");
    }
    if (
      period === "daily" &&
      (bucket as Record<string, unknown>).partial !== false
    ) {
      throw new Error("INVALID_RESULT");
    }
    previousKey = key;
  }
}

function validateSenderMetricBucket(
  value: unknown,
  sender: "owner" | "other",
  denominator: number,
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, ["count", "sender", "share"])
  ) {
    throw new Error("INVALID_RESULT");
  }
  const bucket = value as Record<string, unknown>;
  if (
    bucket.sender !== sender ||
    !safeInteger(bucket.count) ||
    !safeShareValue(bucket.share) ||
    bucket.share !== expectedShare(bucket.count as number, denominator)
  ) {
    throw new Error("INVALID_RESULT");
  }
}

function validateDistribution(
  value: unknown,
  kind: "hour" | "weekday",
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, [
      "buckets",
      "denominator",
      "sender",
    ])
  ) {
    throw new Error("INVALID_RESULT");
  }
  const distribution = value as Record<string, unknown>;
  if (
    !["both", "owner", "other"].includes(distribution.sender as string) ||
    !safeInteger(distribution.denominator) ||
    !Array.isArray(distribution.buckets)
  ) {
    throw new Error("INVALID_RESULT");
  }
  const expected = kind === "hour" ? 24 : WEEKDAY_LABELS.length;
  if (distribution.buckets.length !== expected) {
    throw new Error("INVALID_RESULT");
  }
  let total = 0;
  distribution.buckets.forEach((value, index) => {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !exactKeys(value as Record<string, unknown>, [
        kind === "hour" ? "hour" : "weekday",
        "count",
        "share",
      ])
    ) {
      throw new Error("INVALID_RESULT");
    }
    const bucket = value as Record<string, unknown>;
    if (
      (kind === "hour" && bucket.hour !== index) ||
      (kind === "weekday" &&
        bucket.weekday !== (WEEKDAY_LABELS[index] as CanonicalWeekday)) ||
      !safeInteger(bucket.count) ||
      !safeShareValue(bucket.share) ||
      bucket.share !== expectedShare(bucket.count as number, distribution.denominator as number)
    ) {
      throw new Error("INVALID_RESULT");
    }
    total += bucket.count as number;
  });
  if (total !== distribution.denominator) {
    throw new Error("INVALID_RESULT");
  }
}

function validateActivityMetrics(value: unknown): CanonicalActivityMetrics {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, [
      "chatActivity",
      "hourActivity",
      "population",
      "schemaVersion",
      "senderComparison",
      "timePolicy",
      "trends",
      "weekdayActivity",
    ])
  ) {
    throw new Error("INVALID_RESULT");
  }
  const activity = value as Record<string, unknown>;
  if (
    activity.schemaVersion !== ACTIVITY_METRICS_SCHEMA_VERSION ||
    activity.timePolicy !== ACTIVITY_TIME_POLICY ||
    activity.population !== ACTIVITY_USER_MESSAGE_POPULATION
  ) {
    throw new Error("INVALID_RESULT");
  }
  if (
    activity.trends === null ||
    typeof activity.trends !== "object" ||
    Array.isArray(activity.trends) ||
    !exactKeys(activity.trends as Record<string, unknown>, [
      "daily",
      "monthly",
      "yearly",
    ])
  ) {
    throw new Error("INVALID_RESULT");
  }
  const trends = activity.trends as Record<string, unknown>;
  validateTrendBuckets(trends.daily, "daily");
  validateTrendBuckets(trends.monthly, "monthly");
  validateTrendBuckets(trends.yearly, "yearly");

  if (
    activity.senderComparison === null ||
    typeof activity.senderComparison !== "object" ||
    Array.isArray(activity.senderComparison) ||
    !exactKeys(activity.senderComparison as Record<string, unknown>, [
      "denominator",
      "filterBehavior",
      "other",
      "owner",
    ])
  ) {
    throw new Error("INVALID_RESULT");
  }
  const senderComparison = activity.senderComparison as Record<string, unknown>;
  if (
    senderComparison.filterBehavior !== "ignores-global-sender-filter" ||
    !safeInteger(senderComparison.denominator)
  ) {
    throw new Error("INVALID_RESULT");
  }
  validateSenderMetricBucket(
    senderComparison.owner,
    "owner",
    senderComparison.denominator as number,
  );
  validateSenderMetricBucket(
    senderComparison.other,
    "other",
    senderComparison.denominator as number,
  );
  const owner = senderComparison.owner as Record<string, unknown>;
  const other = senderComparison.other as Record<string, unknown>;
  if (
    (owner.count as number) + (other.count as number) !==
    senderComparison.denominator
  ) {
    throw new Error("INVALID_RESULT");
  }
  validateDistribution(activity.hourActivity, "hour");
  validateDistribution(activity.weekdayActivity, "weekday");

  if (
    activity.chatActivity === null ||
    typeof activity.chatActivity !== "object" ||
    Array.isArray(activity.chatActivity) ||
    !exactKeys(activity.chatActivity as Record<string, unknown>, [
      "longestStreakLength",
      "longestStreaks",
      "sender",
      "totalChatDays",
    ])
  ) {
    throw new Error("INVALID_RESULT");
  }
  const chatActivity = activity.chatActivity as Record<string, unknown>;
  if (
    !["both", "owner", "other"].includes(chatActivity.sender as string) ||
    !safeInteger(chatActivity.totalChatDays) ||
    !safeInteger(chatActivity.longestStreakLength) ||
    !Array.isArray(chatActivity.longestStreaks)
  ) {
    throw new Error("INVALID_RESULT");
  }
  let previousStart: string | undefined;
  for (const value of chatActivity.longestStreaks) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !exactKeys(value as Record<string, unknown>, [
        "endDate",
        "length",
        "startDate",
      ])
    ) {
      throw new Error("INVALID_RESULT");
    }
    const interval = value as Record<string, unknown>;
    if (
      typeof interval.startDate !== "string" ||
      typeof interval.endDate !== "string" ||
      !safeInteger(interval.length)
    ) {
      throw new Error("INVALID_RESULT");
    }
    try {
      const start = calendarDayOrdinal(interval.startDate);
      const end = calendarDayOrdinal(interval.endDate);
      if (
        start > end ||
        interval.length !== end - start + 1 ||
        interval.length !== chatActivity.longestStreakLength
      ) {
        throw new Error("INVALID_RESULT");
      }
    } catch {
      throw new Error("INVALID_RESULT");
    }
    if (previousStart !== undefined && interval.startDate <= previousStart) {
      throw new Error("INVALID_RESULT");
    }
    previousStart = interval.startDate;
  }
  if (
    (chatActivity.longestStreakLength === 0 &&
      chatActivity.longestStreaks.length !== 0) ||
    (chatActivity.longestStreakLength > 0 &&
      chatActivity.longestStreaks.length === 0)
  ) {
    throw new Error("INVALID_RESULT");
  }
  return activity as unknown as CanonicalActivityMetrics;
}

function validateTrendRange(
  trends: CanonicalActivityMetrics["trends"],
  filters: CanonicalAnalysisFilters,
): void {
  const startDay = calendarDayOrdinal(filters.startDate);
  const endDay = calendarDayOrdinal(filters.endDate);
  if (trends.daily.length !== endDay - startDay + 1) {
    throw new Error("INVALID_RESULT");
  }
  trends.daily.forEach((bucket, index) => {
    if (bucket.key !== calendarDateFromDayOrdinal(startDay + index)) {
      throw new Error("INVALID_RESULT");
    }
  });

  const start = calendarDateParts(filters.startDate);
  const end = calendarDateParts(filters.endDate);
  const expectedMonthly: Array<{ key: string; partial: boolean }> = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    expectedMonthly.push({
      key,
      partial:
        (key === filters.startDate.slice(0, 7) && start.day !== 1) ||
        (key === filters.endDate.slice(0, 7) &&
          end.day !== daysInMonth(end.year, end.month)),
    });
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  if (trends.monthly.length !== expectedMonthly.length) {
    throw new Error("INVALID_RESULT");
  }
  trends.monthly.forEach((bucket, index) => {
    const expected = expectedMonthly[index];
    if (expected === undefined || bucket.key !== expected.key || bucket.partial !== expected.partial) {
      throw new Error("INVALID_RESULT");
    }
  });

  const expectedYearly = Array.from(
    { length: end.year - start.year + 1 },
    (_, index) => {
      const key = String(start.year + index).padStart(4, "0");
      return {
        key,
        partial:
          (key === filters.startDate.slice(0, 4) && filters.startDate.slice(5) !== "01-01") ||
          (key === filters.endDate.slice(0, 4) && filters.endDate.slice(5) !== "12-31"),
      };
    },
  );
  if (trends.yearly.length !== expectedYearly.length) {
    throw new Error("INVALID_RESULT");
  }
  trends.yearly.forEach((bucket, index) => {
    const expected = expectedYearly[index];
    if (expected === undefined || bucket.key !== expected.key || bucket.partial !== expected.partial) {
      throw new Error("INVALID_RESULT");
    }
  });
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
      "activity",
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
      "stage7",
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
  const aggregate = validateAggregate(result.aggregate);
  const activity = validateActivityMetrics(result.activity);
  const stage7 = validateStage7Metrics(result.stage7, filters as unknown as CanonicalAnalysisFilters);
  validateTrendRange(
    activity.trends,
    filters as unknown as CanonicalAnalysisFilters,
  );
  if (
    activity.senderComparison.denominator !==
      aggregate.senderCounts.owner + aggregate.senderCounts.other ||
    activity.senderComparison.owner.count !== aggregate.senderCounts.owner ||
    activity.senderComparison.other.count !== aggregate.senderCounts.other ||
    activity.hourActivity.denominator !== aggregate.userMessageCount ||
    activity.weekdayActivity.denominator !== aggregate.userMessageCount ||
    activity.hourActivity.sender !== filters.sender ||
    activity.weekdayActivity.sender !== filters.sender ||
    activity.chatActivity.sender !== filters.sender ||
    activity.trends.daily.reduce((total, bucket) => total + bucket.count, 0) !==
      aggregate.userMessageCount ||
    activity.trends.monthly.reduce((total, bucket) => total + bucket.count, 0) !==
      aggregate.userMessageCount ||
    activity.trends.yearly.reduce((total, bucket) => total + bucket.count, 0) !==
      aggregate.userMessageCount ||
    stage7.messageTypes.denominator !== aggregate.userMessageCount ||
    stage7.messageTypes.eligibleTextCount !== aggregate.eligibleTextCount
  ) {
    throw new Error("INVALID_RESULT");
  }
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
  return { ...result, aggregate, activity, stage7 } as unknown as CanonicalAnalysisResult;
}
