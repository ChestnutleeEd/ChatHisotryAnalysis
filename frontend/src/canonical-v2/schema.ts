import type {
  DatasetSummary,
  NormalizedTextRecord,
} from "../normalized/schema";
import {
  MANIFEST_SCHEMA_VERSION,
  NORMALIZED_RECORD_FIELDS,
} from "../normalized/schema";

export const CANONICAL_EVENT_SCHEMA_VERSION =
  "chat-history-analysis.canonical-event.v2" as const;
export const CANONICAL_MANIFEST_SCHEMA_VERSION =
  "chat-history-analysis.manifest.v2" as const;
export const CANONICAL_PREPROCESSOR_VERSION = "0.1.0" as const;
export const CANONICAL_TIME_POLICY = "UTC+08:00" as const;

export const MAX_CANONICAL_EVENTS = 2_000_000;
export const MAX_CANONICAL_DATASET_BYTES = 536_870_912;
export const MAX_CANONICAL_CHUNK_BYTES = 33_554_432;
export const MAX_CANONICAL_CHUNK_COUNT = 16_384;
export const MIN_CANONICAL_CREATE_TIME = 0;
export const MAX_CANONICAL_CREATE_TIME = 253_402_243_199;

export const CANONICAL_EVENT_FIELDS = [
  "createTime",
  "formattedTime",
  "calendarDate",
  "senderScope",
  "messageCategory",
  "textEligible",
  "content",
  "fileRank",
  "sourceIndex",
] as const;

export const CANONICAL_MESSAGE_CATEGORIES = [
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
] as const;

export type CanonicalMessageCategory =
  (typeof CANONICAL_MESSAGE_CATEGORIES)[number];
export type CanonicalSenderScope = "owner" | "other" | null;

export interface CanonicalEventV2 {
  readonly createTime: number;
  readonly formattedTime: string;
  readonly calendarDate: string;
  readonly senderScope: CanonicalSenderScope;
  readonly messageCategory: CanonicalMessageCategory;
  readonly textEligible: boolean;
  readonly content: string | null;
  readonly fileRank: number;
  readonly sourceIndex: number;
}

export const CANONICAL_MANIFEST_FIELDS = [
  "schemaVersion",
  "canonicalSchemaVersion",
  "preprocessorVersion",
  "timePolicy",
  "metricDefinitionVersions",
  "chunks",
  "aggregates",
  "limits",
  "privacyValidation",
] as const;

export const CANONICAL_CHUNK_FIELDS = [
  "ordinal",
  "name",
  "byteSize",
  "recordCount",
  "sha256",
] as const;

export const CANONICAL_AGGREGATE_FIELDS = [
  "eventCount",
  "userMessageCount",
  "eligibleTextCount",
  "systemEventCount",
  "chunkCount",
  "totalBytes",
  "warningCount",
  "messageCategoryCounts",
  "unknownSenderCount",
] as const;

export const CANONICAL_LIMIT_FIELDS = [
  "maxEvents",
  "maxDatasetBytes",
  "maxChunkBytes",
  "maxChunkCount",
] as const;

export const CANONICAL_PRIVACY_FIELDS = [
  "status",
  "forbiddenFieldCount",
  "contentPolicy",
] as const;

export const METRIC_DEFINITION_VERSIONS = {
  population: "chat-history-analysis.metric.population.v1",
  time: "chat-history-analysis.metric.time.utc-plus-8.v1",
  tokens: "chat-history-analysis.metric.tokens.jieba.v1",
  keywords: "chat-history-analysis.metric.keywords.log-odds.v1",
  sessions: "chat-history-analysis.metric.sessions.threshold.v1",
} as const;

export const METRIC_DEFINITION_FIELDS = [
  "population",
  "time",
  "tokens",
  "keywords",
  "sessions",
] as const;

export type MetricDefinitionVersions = typeof METRIC_DEFINITION_VERSIONS;

export interface CanonicalChunkDescriptorV2 {
  readonly ordinal: number;
  readonly name: string;
  readonly byteSize: number;
  readonly recordCount: number;
  readonly sha256: string;
}

export interface CanonicalAggregatesV2 {
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
}

export interface CanonicalLimitsV2 {
  readonly maxEvents: typeof MAX_CANONICAL_EVENTS;
  readonly maxDatasetBytes: typeof MAX_CANONICAL_DATASET_BYTES;
  readonly maxChunkBytes: typeof MAX_CANONICAL_CHUNK_BYTES;
  readonly maxChunkCount: typeof MAX_CANONICAL_CHUNK_COUNT;
}

export interface CanonicalPrivacyValidationV2 {
  readonly status: "passed";
  readonly forbiddenFieldCount: 0;
  readonly contentPolicy: "eligible-text-only";
}

export interface CanonicalManifestV2 {
  readonly schemaVersion: typeof CANONICAL_MANIFEST_SCHEMA_VERSION;
  readonly canonicalSchemaVersion: typeof CANONICAL_EVENT_SCHEMA_VERSION;
  readonly preprocessorVersion: typeof CANONICAL_PREPROCESSOR_VERSION;
  readonly timePolicy: typeof CANONICAL_TIME_POLICY;
  readonly metricDefinitionVersions: MetricDefinitionVersions;
  readonly chunks: readonly CanonicalChunkDescriptorV2[];
  readonly aggregates: CanonicalAggregatesV2;
  readonly limits: CanonicalLimitsV2;
  readonly privacyValidation: CanonicalPrivacyValidationV2;
}

export type V1DatasetContract = {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly summary: DatasetSummary;
  readonly records: readonly NormalizedTextRecord[];
};

export type V2DatasetContract = {
  readonly schemaVersion: typeof CANONICAL_MANIFEST_SCHEMA_VERSION;
  readonly summary: CanonicalAggregatesV2;
  readonly events: readonly CanonicalEventV2[];
};

export type CompatibleDatasetContract =
  | V1DatasetContract
  | V2DatasetContract;

export class CanonicalContractValidationError extends TypeError {
  constructor(code: string) {
    super(code);
    this.name = "CanonicalContractValidationError";
  }
}

const V1_DATASET_FIELDS = ["records", "schemaVersion", "summary"] as const;
const V1_SUMMARY_FIELDS = [
  "chunkCount",
  "maximumCalendarDate",
  "minimumCalendarDate",
  "normalizedRecordCount",
  "pseudonymous",
  "warningCount",
  "warningsByReason",
] as const;
const V2_DATASET_FIELDS = ["events", "schemaVersion", "summary"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
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

function safeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function validDateParts(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    return false;
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
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function expectedTime(createTime: number): {
  readonly formatted: string;
  readonly calendar: string;
} {
  if (
    !safeInteger(createTime, MIN_CANONICAL_CREATE_TIME) ||
    createTime < MIN_CANONICAL_CREATE_TIME ||
    createTime > MAX_CANONICAL_CREATE_TIME
  ) {
    throw new CanonicalContractValidationError("CANONICAL_TIME_RANGE");
  }
  const date = new Date(createTime * 1000 + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new CanonicalContractValidationError("CANONICAL_TIME_RANGE");
  }
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  const calendar = `${year}-${month}-${day}`;
  if (!validDateParts(calendar)) {
    throw new CanonicalContractValidationError("CANONICAL_TIME_RANGE");
  }
  return {
    formatted: `${calendar} ${hour}:${minute}:${second}`,
    calendar,
  };
}

function isCategory(value: unknown): value is CanonicalMessageCategory {
  return (
    typeof value === "string" &&
    (CANONICAL_MESSAGE_CATEGORIES as readonly string[]).includes(value)
  );
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function validateCanonicalEventV2(
  value: unknown,
): CanonicalEventV2 {
  if (!isRecord(value) || !hasExactKeys(value, CANONICAL_EVENT_FIELDS)) {
    throw new CanonicalContractValidationError("CANONICAL_EVENT_FIELDS");
  }
  const createTime = value.createTime;
  const fileRank = value.fileRank;
  const sourceIndex = value.sourceIndex;
  if (
    !safeInteger(createTime) ||
    !safeInteger(fileRank) ||
    !safeInteger(sourceIndex) ||
    typeof value.formattedTime !== "string" ||
    typeof value.calendarDate !== "string" ||
    (value.senderScope !== null &&
      value.senderScope !== "owner" &&
      value.senderScope !== "other") ||
    !isCategory(value.messageCategory) ||
    typeof value.textEligible !== "boolean" ||
    (value.content !== null && typeof value.content !== "string")
  ) {
    throw new CanonicalContractValidationError("CANONICAL_EVENT_VALUE");
  }
  const expected = expectedTime(createTime);
  if (
    value.formattedTime !== expected.formatted ||
    value.calendarDate !== expected.calendar
  ) {
    throw new CanonicalContractValidationError("CANONICAL_EVENT_TIME");
  }
  if (value.messageCategory === "system") {
    if (
      value.senderScope !== null ||
      value.textEligible ||
      value.content !== null
    ) {
      throw new CanonicalContractValidationError("CANONICAL_EVENT_SYSTEM");
    }
  } else {
    if (
      value.senderScope === null ||
      (value.content === null) !== !value.textEligible ||
      (value.textEligible && value.messageCategory !== "text")
    ) {
      throw new CanonicalContractValidationError("CANONICAL_EVENT_PRIVACY");
    }
  }
  return {
    createTime,
    formattedTime: value.formattedTime,
    calendarDate: value.calendarDate,
    senderScope: value.senderScope,
    messageCategory: value.messageCategory,
    textEligible: value.textEligible,
    content: value.content,
    fileRank,
    sourceIndex,
  };
}

export function isCanonicalEventV2(value: unknown): value is CanonicalEventV2 {
  try {
    validateCanonicalEventV2(value);
    return true;
  } catch {
    return false;
  }
}

function validateV1DatasetContract(value: unknown): V1DatasetContract {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, V1_DATASET_FIELDS) ||
    value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !isRecord(value.summary) ||
    !hasExactKeys(value.summary, V1_SUMMARY_FIELDS) ||
    !Array.isArray(value.records) ||
    value.records.length === 0
  ) {
    throw new CanonicalContractValidationError("DATASET_V1_INVALID");
  }
  const summary = value.summary;
  for (const field of [
    "chunkCount",
    "normalizedRecordCount",
    "warningCount",
  ] as const) {
    if (!safeInteger(summary[field])) {
      throw new CanonicalContractValidationError("DATASET_V1_INVALID");
    }
  }
  if (
    typeof summary.minimumCalendarDate !== "string" ||
    typeof summary.maximumCalendarDate !== "string" ||
    !validDateParts(summary.minimumCalendarDate) ||
    !validDateParts(summary.maximumCalendarDate) ||
    summary.pseudonymous !== true ||
    !isRecord(summary.warningsByReason) ||
    !safeInteger(summary.chunkCount, 1) ||
    summary.normalizedRecordCount !== value.records.length
  ) {
    throw new CanonicalContractValidationError("DATASET_V1_INVALID");
  }
  let warningTotal = 0;
  for (const [reason, count] of Object.entries(summary.warningsByReason)) {
    if (!reason || !safeInteger(count)) {
      throw new CanonicalContractValidationError("DATASET_V1_INVALID");
    }
    warningTotal += count;
  }
  if (warningTotal !== summary.warningCount) {
    throw new CanonicalContractValidationError("DATASET_V1_INVALID");
  }
  for (const record of value.records) {
    if (
      !isRecord(record) ||
      !hasExactKeys(record, NORMALIZED_RECORD_FIELDS) ||
      !safeInteger(record.createTime) ||
      !safeInteger(record.fileRank) ||
      !safeInteger(record.sourceIndex) ||
      (record.senderScope !== "owner" && record.senderScope !== "other") ||
      typeof record.content !== "string" ||
      record.content.length === 0 ||
      typeof record.formattedTime !== "string" ||
      typeof record.calendarDate !== "string"
    ) {
      throw new CanonicalContractValidationError("DATASET_V1_INVALID");
    }
    const expected = expectedTime(record.createTime);
    if (
      record.formattedTime !== expected.formatted ||
      record.calendarDate !== expected.calendar
    ) {
      throw new CanonicalContractValidationError("DATASET_V1_INVALID");
    }
  }
  return value as unknown as V1DatasetContract;
}

function validateV2DatasetContract(value: unknown): V2DatasetContract {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, V2_DATASET_FIELDS) ||
    value.schemaVersion !== CANONICAL_MANIFEST_SCHEMA_VERSION ||
    !isRecord(value.summary) ||
    !hasExactKeys(value.summary, CANONICAL_AGGREGATE_FIELDS) ||
    !Array.isArray(value.events)
  ) {
    throw new CanonicalContractValidationError("DATASET_V2_INVALID");
  }
  const events = value.events.map((event) => validateCanonicalEventV2(event));
  const summary = value.summary;
  const scalarFields = [
    "eventCount",
    "userMessageCount",
    "eligibleTextCount",
    "systemEventCount",
    "chunkCount",
    "totalBytes",
    "warningCount",
    "unknownSenderCount",
  ] as const;
  if (
    scalarFields.some((field) => !safeInteger(summary[field])) ||
    !isRecord(summary.messageCategoryCounts) ||
    !hasExactKeys(summary.messageCategoryCounts, CANONICAL_MESSAGE_CATEGORIES)
  ) {
    throw new CanonicalContractValidationError("DATASET_V2_INVALID");
  }
  const eventCount = summary.eventCount as number;
  const userMessageCount = summary.userMessageCount as number;
  const systemEventCount = summary.systemEventCount as number;
  const eligibleTextCount = summary.eligibleTextCount as number;
  const chunkCount = summary.chunkCount as number;
  const totalBytes = summary.totalBytes as number;
  const unknownSenderCount = summary.unknownSenderCount as number;
  const categoryCounts = summary.messageCategoryCounts;
  const observedCategories = Object.fromEntries(
    CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<CanonicalMessageCategory, number>;
  let observedEligible = 0;
  let observedSystem = 0;
  for (const event of events) {
    observedCategories[event.messageCategory] += 1;
    observedEligible += event.textEligible ? 1 : 0;
    observedSystem += event.messageCategory === "system" ? 1 : 0;
  }
  if (
    eventCount !== events.length ||
    events.length === 0 ||
    userMessageCount + systemEventCount !== eventCount ||
    systemEventCount !== observedSystem ||
    eligibleTextCount !== observedEligible ||
    chunkCount < 1 ||
    totalBytes < 1 ||
    unknownSenderCount !== 0 ||
    CANONICAL_MESSAGE_CATEGORIES.some(
      (category) => categoryCounts[category] !== observedCategories[category],
    )
  ) {
    throw new CanonicalContractValidationError("DATASET_V2_INVALID");
  }
  return value as unknown as V2DatasetContract;
}

export function parseCompatibleDatasetContract(
  value: unknown,
): CompatibleDatasetContract {
  if (!isRecord(value) || typeof value.schemaVersion !== "string") {
    throw new CanonicalContractValidationError("DATASET_SCHEMA_VERSION");
  }
  if (value.schemaVersion === MANIFEST_SCHEMA_VERSION) {
    return validateV1DatasetContract(value);
  }
  if (value.schemaVersion === CANONICAL_MANIFEST_SCHEMA_VERSION) {
    return validateV2DatasetContract(value);
  }
  throw new CanonicalContractValidationError("DATASET_SCHEMA_VERSION");
}

export function isCompatibleDatasetContract(
  value: unknown,
): value is CompatibleDatasetContract {
  try {
    parseCompatibleDatasetContract(value);
    return true;
  } catch {
    return false;
  }
}

function validateMetricVersions(value: unknown): MetricDefinitionVersions {
  if (!isRecord(value) || !hasExactKeys(value, METRIC_DEFINITION_FIELDS)) {
    throw new CanonicalContractValidationError("CANONICAL_METRICS");
  }
  for (const field of METRIC_DEFINITION_FIELDS) {
    if (value[field] !== METRIC_DEFINITION_VERSIONS[field]) {
      throw new CanonicalContractValidationError("CANONICAL_METRICS");
    }
  }
  return METRIC_DEFINITION_VERSIONS;
}

function validateCanonicalManifestInternal(
  value: unknown,
): CanonicalManifestV2 {
  if (!isRecord(value) || !hasExactKeys(value, CANONICAL_MANIFEST_FIELDS)) {
    throw new CanonicalContractValidationError("CANONICAL_MANIFEST_FIELDS");
  }
  if (
    value.schemaVersion !== CANONICAL_MANIFEST_SCHEMA_VERSION ||
    value.canonicalSchemaVersion !== CANONICAL_EVENT_SCHEMA_VERSION ||
    value.preprocessorVersion !== CANONICAL_PREPROCESSOR_VERSION ||
    value.timePolicy !== CANONICAL_TIME_POLICY
  ) {
    throw new CanonicalContractValidationError("CANONICAL_MANIFEST_VERSION");
  }
  const metricDefinitionVersions = validateMetricVersions(
    value.metricDefinitionVersions,
  );
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
    throw new CanonicalContractValidationError("CANONICAL_CHUNKS");
  }
  if (value.chunks.length > MAX_CANONICAL_CHUNK_COUNT) {
    throw new CanonicalContractValidationError("CANONICAL_CHUNK_LIMIT");
  }
  const chunks: CanonicalChunkDescriptorV2[] = [];
  let totalBytes = 0;
  let eventCount = 0;
  for (const [index, rawChunk] of value.chunks.entries()) {
    if (!isRecord(rawChunk) || !hasExactKeys(rawChunk, CANONICAL_CHUNK_FIELDS)) {
      throw new CanonicalContractValidationError("CANONICAL_CHUNK_FIELDS");
    }
    const ordinal = rawChunk.ordinal;
    const byteSize = rawChunk.byteSize;
    const recordCount = rawChunk.recordCount;
    const name = rawChunk.name;
    if (
      !safeInteger(ordinal, 0) ||
      ordinal !== index ||
      typeof name !== "string" ||
      name !== `chunk-${String(index).padStart(4, "0")}.ndjson` ||
      !safeInteger(byteSize, 1) ||
      byteSize > MAX_CANONICAL_CHUNK_BYTES ||
      !safeInteger(recordCount, 1) ||
      recordCount > MAX_CANONICAL_EVENTS ||
      !sha256(rawChunk.sha256)
    ) {
      throw new CanonicalContractValidationError("CANONICAL_CHUNK_VALUE");
    }
    totalBytes += byteSize;
    eventCount += recordCount;
    if (
      totalBytes > MAX_CANONICAL_DATASET_BYTES ||
      eventCount > MAX_CANONICAL_EVENTS
    ) {
      throw new CanonicalContractValidationError("CANONICAL_LIMIT");
    }
    chunks.push({
      ordinal,
      name,
      byteSize,
      recordCount,
      sha256: rawChunk.sha256,
    });
  }

  if (
    !isRecord(value.aggregates) ||
    !hasExactKeys(value.aggregates, CANONICAL_AGGREGATE_FIELDS)
  ) {
    throw new CanonicalContractValidationError("CANONICAL_AGGREGATES");
  }
  const aggregateObject = value.aggregates;
  const scalarAggregateFields = [
    "eventCount",
    "userMessageCount",
    "eligibleTextCount",
    "systemEventCount",
    "chunkCount",
    "totalBytes",
    "warningCount",
    "unknownSenderCount",
  ] as const;
  const categoryCountsValue = aggregateObject.messageCategoryCounts;
  if (!isRecord(categoryCountsValue)) {
    throw new CanonicalContractValidationError("CANONICAL_AGGREGATES");
  }
  if (
    scalarAggregateFields.some((field) => !safeInteger(aggregateObject[field])) ||
    !hasExactKeys(
      categoryCountsValue,
      CANONICAL_MESSAGE_CATEGORIES,
    ) ||
    CANONICAL_MESSAGE_CATEGORIES.some(
      (category) => !safeInteger(categoryCountsValue[category]),
    )
  ) {
    throw new CanonicalContractValidationError("CANONICAL_AGGREGATES");
  }
  const messageCategoryCounts = Object.fromEntries(
    CANONICAL_MESSAGE_CATEGORIES.map((category) => [
      category,
      categoryCountsValue[category] as number,
    ]),
  ) as Record<CanonicalMessageCategory, number>;
  const aggregates: CanonicalAggregatesV2 = {
    eventCount: aggregateObject.eventCount as number,
    userMessageCount: aggregateObject.userMessageCount as number,
    eligibleTextCount: aggregateObject.eligibleTextCount as number,
    systemEventCount: aggregateObject.systemEventCount as number,
    chunkCount: aggregateObject.chunkCount as number,
    totalBytes: aggregateObject.totalBytes as number,
    warningCount: aggregateObject.warningCount as number,
    messageCategoryCounts,
    unknownSenderCount: aggregateObject.unknownSenderCount as number,
  };
  const categoryTotal = CANONICAL_MESSAGE_CATEGORIES.reduce(
    (total, category) => total + messageCategoryCounts[category],
    0,
  );
  const nonSystemCategoryTotal = categoryTotal - messageCategoryCounts.system;
  if (
    eventCount === 0 ||
    aggregates.eventCount !== eventCount ||
    aggregates.userMessageCount + aggregates.systemEventCount !==
      aggregates.eventCount ||
    aggregates.userMessageCount > aggregates.eventCount ||
    aggregates.eligibleTextCount > aggregates.userMessageCount ||
    aggregates.eligibleTextCount > messageCategoryCounts.text ||
    aggregates.systemEventCount > aggregates.eventCount ||
    categoryTotal !== aggregates.eventCount ||
    messageCategoryCounts.system !== aggregates.systemEventCount ||
    nonSystemCategoryTotal !== aggregates.userMessageCount ||
    aggregates.unknownSenderCount > aggregates.userMessageCount ||
    aggregates.chunkCount !== chunks.length ||
    aggregates.totalBytes !== totalBytes ||
    aggregates.totalBytes > MAX_CANONICAL_DATASET_BYTES
  ) {
    throw new CanonicalContractValidationError("CANONICAL_AGGREGATES");
  }

  if (
    !isRecord(value.limits) ||
    !hasExactKeys(value.limits, CANONICAL_LIMIT_FIELDS) ||
    value.limits.maxEvents !== MAX_CANONICAL_EVENTS ||
    value.limits.maxDatasetBytes !== MAX_CANONICAL_DATASET_BYTES ||
    value.limits.maxChunkBytes !== MAX_CANONICAL_CHUNK_BYTES ||
    value.limits.maxChunkCount !== MAX_CANONICAL_CHUNK_COUNT
  ) {
    throw new CanonicalContractValidationError("CANONICAL_LIMITS");
  }
  if (
    !isRecord(value.privacyValidation) ||
    !hasExactKeys(value.privacyValidation, CANONICAL_PRIVACY_FIELDS) ||
    value.privacyValidation.status !== "passed" ||
    value.privacyValidation.forbiddenFieldCount !== 0 ||
    value.privacyValidation.contentPolicy !== "eligible-text-only"
  ) {
    throw new CanonicalContractValidationError("CANONICAL_PRIVACY");
  }
  return {
    schemaVersion: CANONICAL_MANIFEST_SCHEMA_VERSION,
    canonicalSchemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
    preprocessorVersion: CANONICAL_PREPROCESSOR_VERSION,
    timePolicy: CANONICAL_TIME_POLICY,
    metricDefinitionVersions,
    chunks,
    aggregates,
    limits: {
      maxEvents: MAX_CANONICAL_EVENTS,
      maxDatasetBytes: MAX_CANONICAL_DATASET_BYTES,
      maxChunkBytes: MAX_CANONICAL_CHUNK_BYTES,
      maxChunkCount: MAX_CANONICAL_CHUNK_COUNT,
    },
    privacyValidation: {
      status: "passed",
      forbiddenFieldCount: 0,
      contentPolicy: "eligible-text-only",
    },
  };
}

export function validateCanonicalManifestV2(
  value: unknown,
): CanonicalManifestV2 {
  return validateCanonicalManifestInternal(value);
}

export function isCanonicalManifestV2(
  value: unknown,
): value is CanonicalManifestV2 {
  try {
    validateCanonicalManifestInternal(value);
    return true;
  } catch {
    return false;
  }
}

export function serializeCanonicalEventV2(event: CanonicalEventV2): string {
  const validated = validateCanonicalEventV2(event);
  return JSON.stringify(validated);
}

export function serializeCanonicalManifestV2(
  manifest: CanonicalManifestV2,
): string {
  const validated = validateCanonicalManifestV2(manifest);
  return JSON.stringify(validated);
}
