import {
  MANIFEST_SCHEMA_VERSION,
  MAX_MANIFEST_BYTES,
  MAX_NORMALIZED_CHUNK_BYTES,
  MAX_NORMALIZED_RECORDS,
  NORMALIZED_RECORD_FIELDS,
  NORMALIZED_SCHEMA_VERSION,
  PREPROCESSOR_VERSION,
  TIME_POLICY,
  isNormalizedChunkName,
  type DatasetSummary,
  type NormalizedChunkDescriptor,
  type NormalizedTextRecord,
} from "../normalized/schema";
import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  CANONICAL_MANIFEST_SCHEMA_VERSION,
  CANONICAL_MESSAGE_CATEGORIES,
  METRIC_DEFINITION_VERSIONS,
  validateCanonicalEventV2,
  validateCanonicalManifestV2,
  type CanonicalEventV2,
  type CanonicalManifestV2,
} from "../canonical-v2/schema";
import {
  BrowserFileDatasetSource,
  DatasetByteSourceError,
  type DatasetByteSource,
  type RuntimeFile,
} from "./dataset-byte-source";
import type {
  AcceptedDatasetResult,
  AnalysisResult,
  AnalysisSettings,
  LegacyAcceptedDatasetResult,
  TokenizerSettings,
  WorkerFailureCode,
  WorkerPhase,
  WorkerProgress,
} from "./protocol";
import { parseStrictJson, type JsonValue } from "./strict-json";
import {
  ANALYTICS_RESULT_SCHEMA_VERSION,
  DEFAULT_SESSION_THRESHOLD_HOURS,
  canonicalQueryKey,
  isCanonicalEligibleText,
  isCanonicalSystemDiagnostic,
  isCanonicalUserMessage,
  validateCanonicalAnalyticsResult,
  validateCanonicalFilters,
  type CanonicalAnalysisFilters,
  type CanonicalAnalysisResult,
  type CanonicalAnalysisSettings,
  type CanonicalDatasetSummary,
  type DatasetCorrelation,
} from "./analytics-contract";
import {
  CanonicalIndexBuilder,
  type CanonicalIndex,
} from "./canonical-index";
import {
  buildConversationSessionIndexAsync,
  deriveReplySessionMetrics,
  type ConversationSessionIndex,
} from "./reply-session-metrics";
import {
  aggregateSummary,
  createSharedAggregateAsync,
  type SharedAggregateAccumulator,
} from "./analytics-aggregates";
import { deriveActivityMetrics } from "./activity-metrics";
import { deriveStage7Metrics } from "./stage7-metrics";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const TIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const URL_PATTERN =
  /(?<![A-Za-z0-9_])(?:https?:\/\/|www\.)[^\s<>"']+/giu;
const XML_PATTERN =
  /<\s*(?:[!?]|\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|\/?>))/u;
const TOKEN_RUN_PATTERN = /\p{Script=Han}+|[a-z]+|\p{N}+/gu;
const SEPARATOR_PATTERN = /[\p{P}\p{S}\s]+/gu;
const FORBIDDEN_KEYS = new Set(
  [
    "rawContent",
    "source",
    "senderUsername",
    "senderDisplayName",
    "senderAvatar",
    "nickname",
    "remark",
    "displayName",
    "wxid",
    "ownerId",
    "platformMessageId",
    "localId",
    "avatar",
    "url",
    "chatRecords",
    "replyToMessageId",
    "groupNickname",
    "media",
    "payload",
    "path",
    "basename",
  ].map((value) => value.toLocaleLowerCase("en")),
);

const MANIFEST_FIELDS = [
  "aggregates",
  "chunks",
  "conversationFingerprint",
  "inputs",
  "normalizedSchemaVersion",
  "preprocessorVersion",
  "privacyValidation",
  "schemaVersion",
  "timePolicy",
  "timeRange",
] as const;
const AGGREGATE_FIELDS = [
  "annualSourceCount",
  "duplicateRecordCount",
  "eligibleTextRecordCount",
  "normalizedRecordCount",
  "overlap",
  "overlapVerificationCount",
  "rawMessageCount",
  "senderCounts",
  "skippedByReason",
  "skippedRecordCount",
  "sourceCount",
  "warningCount",
  "warningsByReason",
] as const;
const OVERLAP_FIELDS = [
  "annualRangeOverlapCount",
  "matchedEligibleRecordCount",
  "suspiciousAnnualOverlapCount",
  "unmatchedEligibleRecordCount",
  "verificationSourceCount",
] as const;
const TIME_RANGE_FIELDS = [
  "maximumCalendarDate",
  "maximumCreateTime",
  "maximumFormattedTime",
  "minimumCalendarDate",
  "minimumCreateTime",
  "minimumFormattedTime",
] as const;

export const MAXIMUM_DISPLAYED_WORDS = 500;
export const MAXIMUM_MINIMUM_FREQUENCY = 1_000_000;

export interface TokenizerDependencies {
  initialize(): Promise<void>;
  cutWithoutHmm(text: string): readonly string[];
}

export type { RuntimeFile } from "./dataset-byte-source";

export class WorkerAnalysisError extends Error {
  readonly code: WorkerFailureCode;
  readonly phase: WorkerPhase;
  readonly chunkOrdinal?: number;
  readonly lineOrdinal?: number;

  constructor(
    code: WorkerFailureCode,
    phase: WorkerPhase,
    details: {
      readonly chunkOrdinal?: number;
      readonly lineOrdinal?: number;
    } = {},
  ) {
    super(code);
    this.name = "WorkerAnalysisError";
    this.code = code;
    this.phase = phase;
    this.chunkOrdinal = details.chunkOrdinal;
    this.lineOrdinal = details.lineOrdinal;
  }
}

export class WorkerCancellation extends Error {
  constructor() {
    super("WORKER_OPERATION_CANCELLED");
    this.name = "WorkerCancellation";
  }
}

interface ManifestInput {
  readonly role: "annual-source" | "overlap-verification";
  readonly suppliedOrdinal: number;
  readonly fileRank: number | null;
  readonly byteSize: number;
  readonly sha256: string;
}

interface ValidatedManifest {
  readonly chunks: readonly NormalizedChunkDescriptor[];
  readonly inputs: readonly ManifestInput[];
  readonly normalizedRecordCount: number;
  readonly annualSourceCount: number;
  readonly overlapVerificationCount: number;
  readonly senderCounts: {
    readonly owner: number;
    readonly other: number;
  };
  readonly warningCount: number;
  readonly warningsByReason: Readonly<Record<string, number>>;
  readonly minimumCreateTime: number;
  readonly maximumCreateTime: number;
  readonly minimumFormattedTime: string;
  readonly maximumFormattedTime: string;
  readonly minimumCalendarDate: string;
  readonly maximumCalendarDate: string;
}

interface TokenCache {
  readonly kind: "v1";
  readonly tokenIds: Uint32Array;
  readonly recordOffsets: Uint32Array;
  readonly senderScopes: Uint8Array;
  readonly calendarDates: Uint32Array;
  readonly tokenTable: readonly string[];
  readonly summary: DatasetSummary;
  readonly generation: number;
}

interface CanonicalCache {
  readonly kind: "v2";
  readonly index: CanonicalIndex;
  readonly correlation: DatasetCorrelation;
  readonly generation: number;
}

type AcceptedCache = TokenCache | CanonicalCache;

interface OperationMetadata {
  readonly generation?: number;
  readonly sequence?: number;
}

interface ActiveOperation {
  readonly operationId: number;
  readonly generation: number;
  readonly requestSequence: number;
  outputSequence: number;
  terminal: boolean;
}

class GrowableUint32 {
  private storage = new Uint32Array(1024);
  private lengthValue = 0;

  get length(): number {
    return this.lengthValue;
  }

  push(value: number): void {
    if (this.lengthValue === this.storage.length) {
      const next = new Uint32Array(this.storage.length * 2);
      next.set(this.storage);
      this.storage = next;
    }
    this.storage[this.lengthValue] = value;
    this.lengthValue += 1;
  }

  finish(): Uint32Array {
    return this.storage.slice(0, this.lengthValue);
  }
}

class CompactCacheBuilder {
  private readonly tokenIds = new GrowableUint32();
  private tokenMap: Map<string, number> | undefined = new Map();
  private readonly tokenTable: string[] = [];
  private readonly recordOffsets: Uint32Array;
  private readonly senderScopes: Uint8Array;
  private readonly calendarDates: Uint32Array;
  private records = 0;

  constructor(private readonly expectedRecords: number) {
    this.recordOffsets = new Uint32Array(expectedRecords + 1);
    this.senderScopes = new Uint8Array(expectedRecords);
    this.calendarDates = new Uint32Array(expectedRecords);
  }

  append(record: NormalizedTextRecord, tokens: readonly string[]): void {
    if (this.records >= this.expectedRecords) {
      throw new WorkerAnalysisError("COUNT_MISMATCH", "records");
    }
    const tokenMap = this.tokenMap;
    if (tokenMap === undefined) {
      throw new WorkerAnalysisError("WORKER_RUNTIME_FAILED", "records");
    }
    this.recordOffsets[this.records] = this.tokenIds.length;
    this.senderScopes[this.records] = record.senderScope === "owner" ? 0 : 1;
    this.calendarDates[this.records] = calendarDateCode(record.calendarDate);
    for (const token of tokens) {
      let tokenId = tokenMap.get(token);
      if (tokenId === undefined) {
        tokenId = this.tokenTable.length;
        this.tokenTable.push(token);
        tokenMap.set(token, tokenId);
      }
      this.tokenIds.push(tokenId);
    }
    this.records += 1;
  }

  finish(summary: DatasetSummary, generation: number): TokenCache {
    if (this.records !== this.expectedRecords) {
      throw new WorkerAnalysisError("COUNT_MISMATCH", "records");
    }
    this.recordOffsets[this.records] = this.tokenIds.length;
    this.tokenMap = undefined;
    return {
      kind: "v1",
      tokenIds: this.tokenIds.finish(),
      recordOffsets: this.recordOffsets,
      senderScopes: this.senderScopes,
      calendarDates: this.calendarDates,
      tokenTable: this.tokenTable,
      summary,
      generation,
    };
  }
}

function isObject(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject<const Key extends string>(
  value: JsonValue | undefined,
  fields: readonly Key[],
): Record<Key, JsonValue> {
  if (!isObject(value)) {
    throw new Error("INVALID_OBJECT");
  }
  const observed = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    observed.length !== expected.length ||
    observed.some((key, index) => key !== expected[index])
  ) {
    throw new Error("INVALID_FIELDS");
  }
  return value as Record<Key, JsonValue>;
}

function integer(value: JsonValue, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error("INVALID_INTEGER");
  }
  return value as number;
}

function stringValue(value: JsonValue): string {
  if (typeof value !== "string") {
    throw new Error("INVALID_STRING");
  }
  return value;
}

function hashValue(value: JsonValue): string {
  const result = stringValue(value);
  if (!HASH_PATTERN.test(result)) {
    throw new Error("INVALID_HASH");
  }
  return result;
}

function validateCountMap(value: JsonValue): Readonly<Record<string, number>> {
  if (!isObject(value)) {
    throw new Error("INVALID_COUNT_MAP");
  }
  const result: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (const [key, count] of Object.entries(value)) {
    if (!REASON_PATTERN.test(key)) {
      throw new Error("INVALID_REASON");
    }
    result[key] = integer(count);
  }
  return result;
}

function sum(values: Iterable<number>): number {
  let result = 0;
  for (const value of values) {
    result += value;
  }
  return result;
}

function expectedTime(createTime: number): {
  readonly formatted: string;
  readonly calendar: string;
} {
  const milliseconds = createTime * 1000 + 8 * 60 * 60 * 1000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("INVALID_TIME");
  }
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  const calendar = `${year}-${month}-${day}`;
  return {
    formatted: `${calendar} ${hour}:${minute}:${second}`,
    calendar,
  };
}

function calendarDateCode(value: string): number {
  if (!DATE_PATTERN.test(value)) {
    throw new Error("INVALID_DATE");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
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
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]
  ) {
    throw new Error("INVALID_DATE");
  }
  return year * 372 + month * 31 + day;
}

function validateForbidden(value: JsonValue): void {
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase("en"))) {
        throw new WorkerAnalysisError(
          "PRIVACY_VALIDATION_FAILED",
          "manifest",
        );
      }
      validateForbidden(child);
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      validateForbidden(child);
    }
  } else if (typeof value === "string" && value.includes("\0")) {
    throw new WorkerAnalysisError(
      "PRIVACY_VALIDATION_FAILED",
      "manifest",
    );
  }
}

function validateManifest(
  value: JsonValue,
): ValidatedManifest {
  if (
    isObject(value) &&
    Object.hasOwn(value, "exportInfo") &&
    Object.hasOwn(value, "session") &&
    Object.hasOwn(value, "messages")
  ) {
    throw new WorkerAnalysisError("RAW_EXPORT_UNSUPPORTED", "manifest");
  }

  try {
    const root = exactObject(value, MANIFEST_FIELDS);
    if (
      root.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
      root.normalizedSchemaVersion !== NORMALIZED_SCHEMA_VERSION ||
      root.preprocessorVersion !== PREPROCESSOR_VERSION
    ) {
      throw new WorkerAnalysisError(
        "MANIFEST_VERSION_UNSUPPORTED",
        "manifest",
      );
    }
    if (
      root.timePolicy !== TIME_POLICY ||
      !HASH_PATTERN.test(stringValue(root.conversationFingerprint))
    ) {
      throw new Error("INVALID_IDENTITY");
    }

    if (!Array.isArray(root.inputs) || root.inputs.length === 0) {
      throw new Error("INVALID_INPUTS");
    }
    const inputs: ManifestInput[] = [];
    const roleOrdinals = {
      "annual-source": new Set<number>(),
      "overlap-verification": new Set<number>(),
    };
    const ranks = new Set<number>();
    for (const descriptor of root.inputs) {
      const item = exactObject(descriptor, [
        "byteSize",
        "fileRank",
        "role",
        "sha256",
        "suppliedOrdinal",
      ]);
      const role = stringValue(item.role);
      if (role !== "annual-source" && role !== "overlap-verification") {
        throw new Error("INVALID_ROLE");
      }
      const suppliedOrdinal = integer(item.suppliedOrdinal, 1);
      if (roleOrdinals[role].has(suppliedOrdinal)) {
        throw new Error("DUPLICATE_ORDINAL");
      }
      roleOrdinals[role].add(suppliedOrdinal);
      let fileRank: number | null;
      if (role === "annual-source") {
        fileRank = integer(item.fileRank);
        if (ranks.has(fileRank)) {
          throw new Error("DUPLICATE_RANK");
        }
        ranks.add(fileRank);
      } else {
        if (item.fileRank !== null) {
          throw new Error("INVALID_RANK");
        }
        fileRank = null;
      }
      inputs.push({
        role,
        suppliedOrdinal,
        fileRank,
        byteSize: integer(item.byteSize),
        sha256: hashValue(item.sha256),
      });
    }
    const annualCount = roleOrdinals["annual-source"].size;
    const verificationCount =
      roleOrdinals["overlap-verification"].size;
    if (
      ranks.size !== annualCount ||
      [...ranks].some((rank) => rank >= annualCount)
    ) {
      throw new Error("INVALID_RANK_SET");
    }
    const expectedInputOrder = [
      ...Array.from(
        { length: annualCount },
        (_, index) => `annual-source:${index + 1}`,
      ),
      ...Array.from(
        { length: verificationCount },
        (_, index) => `overlap-verification:${index + 1}`,
      ),
    ];
    if (
      inputs.some(
        (input, index) =>
          `${input.role}:${input.suppliedOrdinal}` !==
          expectedInputOrder[index],
      )
    ) {
      throw new Error("INVALID_INPUT_ORDER");
    }

    if (!Array.isArray(root.chunks) || root.chunks.length === 0) {
      throw new Error("INVALID_CHUNKS");
    }
    const chunks: NormalizedChunkDescriptor[] = [];
    for (const [index, descriptor] of root.chunks.entries()) {
      const item = exactObject(descriptor, [
        "byteSize",
        "name",
        "recordCount",
        "sha256",
      ]);
      const name = stringValue(item.name);
      if (
        name !== `chunk-${String(index + 1).padStart(4, "0")}.ndjson` ||
        !isNormalizedChunkName(name) ||
        name.includes("/") ||
        name.includes("\\") ||
        name.includes("..")
      ) {
        throw new WorkerAnalysisError("FILE_NAME_INVALID", "manifest");
      }
      const byteSize = integer(item.byteSize, 1);
      if (byteSize > MAX_NORMALIZED_CHUNK_BYTES) {
        throw new WorkerAnalysisError(
          "CHUNK_LIMIT_EXCEEDED",
          "manifest",
        );
      }
      chunks.push({
        name,
        byteSize,
        recordCount: integer(item.recordCount, 1),
        sha256: hashValue(item.sha256),
      });
    }

    const aggregates = exactObject(root.aggregates, AGGREGATE_FIELDS);
    const sourceCount = integer(aggregates.sourceCount);
    const manifestAnnualCount = integer(aggregates.annualSourceCount);
    const manifestVerificationCount = integer(
      aggregates.overlapVerificationCount,
    );
    const rawMessageCount = integer(aggregates.rawMessageCount);
    const eligibleTextRecordCount = integer(
      aggregates.eligibleTextRecordCount,
    );
    const normalizedRecordCount = integer(
      aggregates.normalizedRecordCount,
      1,
    );
    const skippedRecordCount = integer(aggregates.skippedRecordCount);
    const duplicateRecordCount = integer(
      aggregates.duplicateRecordCount,
    );
    const warningCount = integer(aggregates.warningCount);
    if (
      manifestAnnualCount !== annualCount ||
      manifestVerificationCount !== verificationCount ||
      sourceCount !== inputs.length ||
      normalizedRecordCount > MAX_NORMALIZED_RECORDS ||
      normalizedRecordCount !==
        sum(chunks.map((chunk) => chunk.recordCount)) ||
      eligibleTextRecordCount !==
        normalizedRecordCount + duplicateRecordCount ||
      eligibleTextRecordCount + skippedRecordCount > rawMessageCount
    ) {
      throw new Error("INVALID_AGGREGATES");
    }

    const senderCountsObject = exactObject(aggregates.senderCounts, [
      "other",
      "owner",
    ]);
    const senderCounts = {
      owner: integer(senderCountsObject.owner),
      other: integer(senderCountsObject.other),
    };
    if (
      senderCounts.owner + senderCounts.other !== normalizedRecordCount
    ) {
      throw new Error("INVALID_SENDERS");
    }
    const skippedByReason = validateCountMap(aggregates.skippedByReason);
    const warningsByReason = validateCountMap(aggregates.warningsByReason);
    if (
      sum(Object.values(skippedByReason)) !== skippedRecordCount ||
      sum(Object.values(warningsByReason)) !== warningCount
    ) {
      throw new Error("INVALID_REASON_COUNTS");
    }
    const overlap = exactObject(aggregates.overlap, OVERLAP_FIELDS);
    const annualRangeOverlapCount = integer(
      overlap.annualRangeOverlapCount,
    );
    const suspiciousAnnualOverlapCount = integer(
      overlap.suspiciousAnnualOverlapCount,
    );
    const verificationSourceCount = integer(
      overlap.verificationSourceCount,
    );
    const matchedEligibleRecordCount = integer(
      overlap.matchedEligibleRecordCount,
    );
    const unmatchedEligibleRecordCount = integer(
      overlap.unmatchedEligibleRecordCount,
    );
    if (
      verificationSourceCount !== verificationCount ||
      suspiciousAnnualOverlapCount > annualRangeOverlapCount ||
      annualRangeOverlapCount >
        (annualCount * (annualCount - 1)) / 2 ||
      matchedEligibleRecordCount + unmatchedEligibleRecordCount >
        rawMessageCount ||
      (warningsByReason.SUSPICIOUS_ANNUAL_OVERLAP ?? 0) !==
        suspiciousAnnualOverlapCount
    ) {
      throw new Error("INVALID_OVERLAP");
    }

    const timeRange = exactObject(root.timeRange, TIME_RANGE_FIELDS);
    const minimumCreateTime = integer(
      timeRange.minimumCreateTime,
      Number.MIN_SAFE_INTEGER,
    );
    const maximumCreateTime = integer(
      timeRange.maximumCreateTime,
      Number.MIN_SAFE_INTEGER,
    );
    const minimumFormattedTime = stringValue(
      timeRange.minimumFormattedTime,
    );
    const maximumFormattedTime = stringValue(
      timeRange.maximumFormattedTime,
    );
    const minimumCalendarDate = stringValue(
      timeRange.minimumCalendarDate,
    );
    const maximumCalendarDate = stringValue(
      timeRange.maximumCalendarDate,
    );
    const expectedMinimum = expectedTime(minimumCreateTime);
    const expectedMaximum = expectedTime(maximumCreateTime);
    if (
      minimumCreateTime > maximumCreateTime ||
      minimumFormattedTime !== expectedMinimum.formatted ||
      minimumCalendarDate !== expectedMinimum.calendar ||
      maximumFormattedTime !== expectedMaximum.formatted ||
      maximumCalendarDate !== expectedMaximum.calendar
    ) {
      throw new Error("INVALID_RANGE");
    }

    const privacy = exactObject(root.privacyValidation, [
      "forbiddenFieldCount",
      "status",
    ]);
    if (
      privacy.forbiddenFieldCount !== 0 ||
      privacy.status !== "passed"
    ) {
      throw new WorkerAnalysisError(
        "PRIVACY_VALIDATION_FAILED",
        "manifest",
      );
    }
    validateForbidden(value);
    return {
      chunks,
      inputs,
      normalizedRecordCount,
      annualSourceCount: annualCount,
      overlapVerificationCount: verificationCount,
      senderCounts,
      warningCount,
      warningsByReason,
      minimumCreateTime,
      maximumCreateTime,
      minimumFormattedTime,
      maximumFormattedTime,
      minimumCalendarDate,
      maximumCalendarDate,
    };
  } catch (error) {
    if (error instanceof WorkerAnalysisError) {
      throw error;
    }
    throw new WorkerAnalysisError("MANIFEST_INVALID", "manifest");
  }
}

function validateRecord(
  value: JsonValue,
  lineOrdinal: number,
  chunkOrdinal: number,
): NormalizedTextRecord {
  try {
    if (!isObject(value)) {
      throw new Error("INVALID_RECORD");
    }
    const keys = Object.keys(value);
    if (
      keys.length !== NORMALIZED_RECORD_FIELDS.length ||
      keys.some((key, index) => key !== NORMALIZED_RECORD_FIELDS[index])
    ) {
      throw new Error("INVALID_RECORD_FIELDS");
    }
    const createTime = integer(
      value.createTime,
      Number.MIN_SAFE_INTEGER,
    );
    const formattedTime = stringValue(value.formattedTime);
    const calendarDate = stringValue(value.calendarDate);
    const senderScope = value.senderScope;
    const content = stringValue(value.content);
    const fileRank = integer(value.fileRank);
    const sourceIndex = integer(value.sourceIndex);
    const expected = expectedTime(createTime);
    if (
      !TIME_PATTERN.test(formattedTime) ||
      !DATE_PATTERN.test(calendarDate) ||
      formattedTime !== expected.formatted ||
      calendarDate !== expected.calendar ||
      (senderScope !== "owner" && senderScope !== "other") ||
      content.length === 0 ||
      content.includes("\0") ||
      URL_PATTERN.test(content) ||
      XML_PATTERN.test(content)
    ) {
      throw new Error("INVALID_RECORD_VALUE");
    }
    URL_PATTERN.lastIndex = 0;
    validateForbidden(value);
    return {
      createTime,
      formattedTime,
      calendarDate,
      senderScope,
      content,
      fileRank,
      sourceIndex,
    };
  } catch (error) {
    URL_PATTERN.lastIndex = 0;
    if (
      error instanceof WorkerAnalysisError &&
      error.code === "PRIVACY_VALIDATION_FAILED"
    ) {
      throw new WorkerAnalysisError(
        "PRIVACY_VALIDATION_FAILED",
        "records",
        { chunkOrdinal, lineOrdinal },
      );
    }
    throw new WorkerAnalysisError("RECORD_SCHEMA_INVALID", "records", {
      chunkOrdinal,
      lineOrdinal,
    });
  }
}

function normalizeStopWord(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

export function buildStopWordSet(
  asset: string,
  additional: readonly string[],
): ReadonlySet<string> {
  const result = new Set(
    asset
      .split("\n")
      .map(normalizeStopWord)
      .filter((value) => value !== ""),
  );
  for (const value of additional) {
    const normalized = normalizeStopWord(value);
    if (normalized === "" || normalized.includes("\0")) {
      throw new WorkerAnalysisError("SETTINGS_INVALID", "manifest");
    }
    result.add(normalized);
  }
  return result;
}

export function tokenizeNormalizedContent(
  content: string,
  cutWithoutHmm: (text: string) => readonly string[],
  stopWords: ReadonlySet<string>,
  minimumTokenLength: number,
): readonly string[] {
  const normalized = content
    .normalize("NFKC")
    .toLowerCase()
    .replace(URL_PATTERN, " ")
    .replace(SEPARATOR_PATTERN, " ")
    .trim();
  URL_PATTERN.lastIndex = 0;
  if (normalized === "") {
    return [];
  }
  const result: string[] = [];
  for (const piece of cutWithoutHmm(normalized)) {
    for (const match of piece.matchAll(TOKEN_RUN_PATTERN)) {
      const token = match[0];
      if (
        /^\p{N}+$/u.test(token) ||
        [...token].length < minimumTokenLength ||
        stopWords.has(token)
      ) {
        continue;
      }
      result.push(token);
    }
  }
  return result;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((value) => value.codePointAt(0) ?? 0);
  const rightPoints = [...right].map((value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function decodeUtf8(
  buffer: ArrayBuffer,
  phase: WorkerPhase,
  chunkOrdinal?: number,
): string {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new WorkerAnalysisError("UTF8_INVALID", phase, {
      chunkOrdinal,
    });
  }
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new WorkerAnalysisError("UTF8_INVALID", phase, {
      chunkOrdinal,
    });
  }
}

function looksLikeRawExportPrefix(value: string): boolean {
  return (
    /"exportInfo"\s*:/u.test(value) &&
    /"session"\s*:/u.test(value) &&
    /"messages"\s*:/u.test(value)
  );
}

export class AnalysisWorkerRuntime {
  private activeOperationId = 0;
  private readonly cancelled = new Set<number>();
  private activeOperation: ActiveOperation | undefined;
  private lastStartedGeneration = 0;
  private initialized = false;
  private initializationPromise: Promise<void> | undefined;
  private acceptedCache: AcceptedCache | undefined;
  private activeSessionIndex:
    | {
        readonly cacheGeneration: number;
        readonly index: ConversationSessionIndex;
      }
    | undefined;
  private cacheGeneration = 0;
  private readonly canonicalResultCache = new Map<
    string,
    CanonicalAnalysisResult
  >();

  constructor(
    private readonly tokenizer: TokenizerDependencies,
    private readonly stopWordAsset: string,
    private readonly reportProgress: (progress: WorkerProgress) => void,
  ) {}

  cancel(operationId: number, generation = operationId, sequence?: number): void {
    const active = this.activeOperation;
    const effectiveSequence = sequence ?? (active?.outputSequence ?? 1) + 1;
    if (
      active?.operationId === operationId &&
      active.generation === generation &&
      Number.isSafeInteger(effectiveSequence) &&
      effectiveSequence > active.outputSequence
    ) {
      active.outputSequence = effectiveSequence;
      this.cancelled.add(operationId);
    }
  }

  dispose(): void {
    this.activeOperationId += 1;
    this.activeOperation = undefined;
    this.cancelled.clear();
    this.acceptedCache = undefined;
    this.activeSessionIndex = undefined;
    this.canonicalResultCache.clear();
    this.initialized = false;
    this.initializationPromise = undefined;
  }

  loadDataset(
    operationId: number,
    sourceOrFiles: readonly RuntimeFile[],
    tokenizerSettings: TokenizerSettings,
    metadata?: OperationMetadata,
    correlation?: DatasetCorrelation,
  ): Promise<LegacyAcceptedDatasetResult>;
  loadDataset(
    operationId: number,
    sourceOrFiles: DatasetByteSource,
    tokenizerSettings: TokenizerSettings,
    metadata?: OperationMetadata,
    correlation?: DatasetCorrelation,
  ): Promise<AcceptedDatasetResult>;
  loadDataset(
    operationId: number,
    sourceOrFiles: DatasetByteSource | readonly RuntimeFile[],
    tokenizerSettings: TokenizerSettings,
    metadata?: OperationMetadata,
    correlation?: DatasetCorrelation,
  ): Promise<AcceptedDatasetResult>;
  async loadDataset(
    operationId: number,
    sourceOrFiles: DatasetByteSource | readonly RuntimeFile[],
    tokenizerSettings: TokenizerSettings,
    metadata: OperationMetadata = {},
    correlation: DatasetCorrelation = {
      sessionId: null,
      datasetId: null,
      generation: (metadata.generation ?? operationId) as DatasetCorrelation["generation"],
    },
  ): Promise<AcceptedDatasetResult> {
    this.begin(operationId, metadata);
    let source: DatasetByteSource | undefined;
    try {
      const activeSource: DatasetByteSource = Array.isArray(sourceOrFiles)
        ? new BrowserFileDatasetSource(sourceOrFiles)
        : (sourceOrFiles as DatasetByteSource);
      source = activeSource;
      if (
        !Number.isSafeInteger(tokenizerSettings.minimumTokenLength) ||
        tokenizerSettings.minimumTokenLength < 1 ||
        tokenizerSettings.minimumTokenLength > 32 ||
        !Array.isArray(tokenizerSettings.additionalStopWords) ||
        tokenizerSettings.additionalStopWords.some(
          (value) => typeof value !== "string",
        )
      ) {
        throw new WorkerAnalysisError("SETTINGS_INVALID", "manifest");
      }
      const stopWords = buildStopWordSet(
        this.stopWordAsset,
        tokenizerSettings.additionalStopWords,
      );
      this.progress(operationId, "manifest", 0, 1, 1);
      let manifestBuffer: ArrayBuffer;
      try {
        manifestBuffer = await activeSource.readManifest(() =>
          this.checkpoint(operationId, false),
        );
      } catch (error) {
        throw this.mapSourceError(error, "manifest");
      }
      await this.checkpoint(operationId, false);
      if (manifestBuffer.byteLength > MAX_MANIFEST_BYTES) {
        throw new WorkerAnalysisError(
          "DATASET_LIMIT_EXCEEDED",
          "manifest",
        );
      }
      const manifestBytes = new Uint8Array(manifestBuffer);
      if (
        manifestBytes.length === 0 ||
        manifestBytes[manifestBytes.length - 1] !== 0x0a
      ) {
        throw new WorkerAnalysisError("MANIFEST_INVALID", "manifest");
      }
      const manifestText = decodeUtf8(manifestBuffer, "manifest");
      if (looksLikeRawExportPrefix(manifestText.slice(0, 65_536))) {
        throw new WorkerAnalysisError(
          "RAW_EXPORT_UNSUPPORTED",
          "manifest",
        );
      }
      let manifestJson: JsonValue;
      try {
        manifestJson = parseStrictJson(manifestText);
      } catch {
        throw new WorkerAnalysisError("MANIFEST_INVALID", "manifest");
      }
      if (
        isObject(manifestJson) &&
        manifestJson.schemaVersion === CANONICAL_MANIFEST_SCHEMA_VERSION
      ) {
        return await this.loadCanonicalDataset(
          operationId,
          activeSource,
          manifestJson,
          stopWords,
          tokenizerSettings,
          metadata,
          correlation,
        );
      }
      const manifest = validateManifest(manifestJson);
      try {
        activeSource.assertManifestChunks?.(
          manifest.chunks.map((chunk) => chunk.name),
        );
      } catch (error) {
        throw this.mapSourceError(error, "manifest");
      }
      this.progress(operationId, "manifest", 1, 1, 4);
      await this.checkpoint(operationId, true);

      const builder = new CompactCacheBuilder(
        manifest.normalizedRecordCount,
      );
      let globalRecordCount = 0;
      let ownerCount = 0;
      let otherCount = 0;
      let minimumRecord: NormalizedTextRecord | undefined;
      let maximumRecord: NormalizedTextRecord | undefined;
      let previousOrder: readonly [number, number] | undefined;
      let initializedForCandidate = false;

      for (const [chunkIndex, chunk] of manifest.chunks.entries()) {
        const chunkOrdinal = chunkIndex + 1;
        let buffer: ArrayBuffer;
        try {
          buffer = await activeSource.readChunk(
            chunkOrdinal,
            chunk.byteSize,
            () => this.checkpoint(operationId, false),
          );
        } catch (error) {
          throw this.mapSourceError(error, "hash", chunkOrdinal);
        }
        await this.checkpoint(operationId, false);
        const digest = bytesToHex(
          await crypto.subtle.digest("SHA-256", buffer),
        );
        if (digest !== chunk.sha256) {
          throw new WorkerAnalysisError("HASH_MISMATCH", "hash", {
            chunkOrdinal,
          });
        }
        this.progress(
          operationId,
          "hash",
          chunkOrdinal,
          manifest.chunks.length,
          5 + Math.floor((chunkOrdinal / manifest.chunks.length) * 20),
          chunkOrdinal,
          manifest.chunks.length,
        );

        if (!initializedForCandidate) {
          await this.initializeTokenizer(operationId);
          initializedForCandidate = true;
        }

        const bytes = new Uint8Array(buffer);
        if (
          bytes.length === 0 ||
          bytes[bytes.length - 1] !== 0x0a
        ) {
          throw new WorkerAnalysisError("NDJSON_INVALID", "records", {
            chunkOrdinal,
          });
        }
        const text = decodeUtf8(buffer, "records", chunkOrdinal);
        let start = 0;
        let lineOrdinal = 0;
        let chunkRecordCount = 0;
        while (start < text.length) {
          const end = text.indexOf("\n", start);
          if (end < 0) {
            throw new WorkerAnalysisError(
              "NDJSON_INVALID",
              "records",
              { chunkOrdinal, lineOrdinal: lineOrdinal + 1 },
            );
          }
          lineOrdinal += 1;
          const line = text.slice(start, end);
          start = end + 1;
          if (line === "" || line.endsWith("\r")) {
            throw new WorkerAnalysisError(
              "NDJSON_INVALID",
              "records",
              { chunkOrdinal, lineOrdinal },
            );
          }
          let parsed: JsonValue;
          try {
            parsed = parseStrictJson(line);
          } catch {
            throw new WorkerAnalysisError(
              "NDJSON_INVALID",
              "records",
              { chunkOrdinal, lineOrdinal },
            );
          }
          const record = validateRecord(
            parsed,
            lineOrdinal,
            chunkOrdinal,
          );
          if (
            record.sourceIndex !== globalRecordCount ||
            record.fileRank >= manifest.annualSourceCount
          ) {
            throw new WorkerAnalysisError(
              "RECORD_ORDER_INVALID",
              "records",
              { chunkOrdinal, lineOrdinal },
            );
          }
          const order: readonly [number, number] = [
            record.createTime,
            record.fileRank,
          ];
          if (
            previousOrder !== undefined &&
            (order[0] < previousOrder[0] ||
              (order[0] === previousOrder[0] &&
                order[1] < previousOrder[1]))
          ) {
            throw new WorkerAnalysisError(
              "RECORD_ORDER_INVALID",
              "records",
              { chunkOrdinal, lineOrdinal },
            );
          }
          previousOrder = order;
          minimumRecord ??= record;
          maximumRecord = record;
          if (record.senderScope === "owner") {
            ownerCount += 1;
          } else {
            otherCount += 1;
          }
          const tokens = tokenizeNormalizedContent(
            record.content,
            (value) => this.tokenizer.cutWithoutHmm(value),
            stopWords,
            tokenizerSettings.minimumTokenLength,
          );
          builder.append(record, tokens);
          globalRecordCount += 1;
          chunkRecordCount += 1;

          if (globalRecordCount % 2048 === 0) {
            this.progress(
              operationId,
              "tokenization",
              globalRecordCount,
              manifest.normalizedRecordCount,
              25 +
                Math.floor(
                  (globalRecordCount /
                    manifest.normalizedRecordCount) *
                    60,
                ),
              chunkOrdinal,
              manifest.chunks.length,
            );
            await this.checkpoint(operationId, true);
          }
        }
        if (chunkRecordCount !== chunk.recordCount) {
          throw new WorkerAnalysisError(
            "COUNT_MISMATCH",
            "records",
            { chunkOrdinal },
          );
        }
        await this.checkpoint(operationId, true);
      }

      if (
        minimumRecord === undefined ||
        maximumRecord === undefined ||
        globalRecordCount !== manifest.normalizedRecordCount ||
        ownerCount !== manifest.senderCounts.owner ||
        otherCount !== manifest.senderCounts.other
      ) {
        throw new WorkerAnalysisError("COUNT_MISMATCH", "records");
      }
      if (
        minimumRecord.createTime !== manifest.minimumCreateTime ||
        minimumRecord.formattedTime !== manifest.minimumFormattedTime ||
        minimumRecord.calendarDate !== manifest.minimumCalendarDate ||
        maximumRecord.createTime !== manifest.maximumCreateTime ||
        maximumRecord.formattedTime !== manifest.maximumFormattedTime ||
        maximumRecord.calendarDate !== manifest.maximumCalendarDate
      ) {
        throw new WorkerAnalysisError("RANGE_MISMATCH", "records");
      }

      const summary: DatasetSummary = {
        normalizedRecordCount: manifest.normalizedRecordCount,
        minimumCalendarDate: manifest.minimumCalendarDate,
        maximumCalendarDate: manifest.maximumCalendarDate,
        warningCount: manifest.warningCount,
        warningsByReason: manifest.warningsByReason,
        chunkCount: manifest.chunks.length,
        pseudonymous: true,
      };
      const generation = this.cacheGeneration + 1;
      const candidateCache = builder.finish(summary, generation);
      const defaultSettings: AnalysisSettings = {
        sender: "all",
        startDate: summary.minimumCalendarDate,
        endDate: summary.maximumCalendarDate,
        maximumWords: 100,
        minimumFrequency: 1,
      };
      const result = await this.aggregate(
        operationId,
        candidateCache,
        defaultSettings,
      );
      await this.checkpoint(operationId, false);
      await activeSource.complete?.();
      await this.checkpoint(operationId, false);
      this.acceptedCache = candidateCache;
      this.cacheGeneration = generation;
      this.finish(operationId, metadata.generation ?? operationId);
      this.cancelled.delete(operationId);
      return { summary, result };
    } catch (error) {
      try {
        await source?.cancel?.();
      } catch {
        // The original operation result remains authoritative.
      }
      this.finish(operationId, metadata.generation ?? operationId);
      this.cancelled.delete(operationId);
      if (
        error instanceof WorkerAnalysisError ||
        error instanceof WorkerCancellation
      ) {
        throw error;
      }
      if (error instanceof DatasetByteSourceError) {
        throw this.mapSourceError(error, "manifest");
      }
      if (
        error instanceof RangeError ||
        (error instanceof DOMException &&
          error.name === "QuotaExceededError")
      ) {
        throw new WorkerAnalysisError("MEMORY_PRESSURE", "records");
      }
      throw new WorkerAnalysisError("WORKER_RUNTIME_FAILED", "records");
    } finally {
      try {
        await source?.close();
      } catch {
        // A source close cannot replace a content-free operation result.
      }
    }
  }

  private async loadCanonicalDataset(
    operationId: number,
    source: DatasetByteSource,
    manifestValue: JsonValue,
    stopWords: ReadonlySet<string>,
    tokenizerSettings: TokenizerSettings,
    metadata: OperationMetadata,
    correlation: DatasetCorrelation,
  ): Promise<AcceptedDatasetResult> {
    let manifest: CanonicalManifestV2;
    try {
      manifest = validateCanonicalManifestV2(manifestValue);
    } catch {
      throw new WorkerAnalysisError("MANIFEST_INVALID", "manifest");
    }
    try {
      source.assertManifestChunks?.(
        manifest.chunks.map((chunk) => chunk.name),
      );
    } catch (error) {
      throw this.mapSourceError(error, "manifest");
    }
    const expectedRecords = manifest.aggregates.eventCount;
    const builder = new CanonicalIndexBuilder(expectedRecords);
    const categoryCounts = Object.fromEntries(
      CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, 0]),
    ) as Record<(typeof CANONICAL_MESSAGE_CATEGORIES)[number], number>;
    let eventCount = 0;
    let systemEventCount = 0;
    let eligibleTextCount = 0;
    let unknownSenderCount = 0;
    let minimumCalendarDate: string | undefined;
    let maximumCalendarDate: string | undefined;
    let previousOrder: readonly [number, number, number] | undefined;
    let initializedForCandidate = false;

    this.progress(operationId, "parse", 0, expectedRecords, 5);
    for (const [chunkIndex, chunk] of manifest.chunks.entries()) {
      const chunkOrdinal = chunkIndex + 1;
      this.progress(
        operationId,
        "transport",
        chunkIndex,
        manifest.chunks.length,
        5 + Math.floor((chunkIndex / manifest.chunks.length) * 15),
        chunkOrdinal,
        manifest.chunks.length,
      );
      let buffer: ArrayBuffer;
      try {
        buffer = await (source.readChunkByName === undefined
          ? source.readChunk(
              chunk.ordinal + 1,
              chunk.byteSize,
              () => this.checkpoint(operationId, false),
            )
          : source.readChunkByName(
              chunk.name,
              chunk.byteSize,
              () => this.checkpoint(operationId, false),
            ));
      } catch (error) {
        throw this.mapSourceError(error, "transport", chunkOrdinal);
      }
      await this.checkpoint(operationId, false);
      this.progress(
        operationId,
        "transport",
        chunkIndex + 1,
        manifest.chunks.length,
        5 + Math.floor(((chunkIndex + 1) / manifest.chunks.length) * 15),
        chunkOrdinal,
        manifest.chunks.length,
      );
      const digest = bytesToHex(
        await crypto.subtle.digest("SHA-256", buffer),
      );
      if (digest !== chunk.sha256) {
        throw new WorkerAnalysisError("HASH_MISMATCH", "hash", {
          chunkOrdinal,
        });
      }
      this.progress(
        operationId,
        "hash",
        chunkIndex + 1,
        manifest.chunks.length,
        5 + Math.floor(((chunkIndex + 1) / manifest.chunks.length) * 15),
        chunkOrdinal,
        manifest.chunks.length,
      );
      const bytes = new Uint8Array(buffer);
      if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
        throw new WorkerAnalysisError("NDJSON_INVALID", "parse", {
          chunkOrdinal,
        });
      }
      const text = decodeUtf8(buffer, "parse", chunkOrdinal);
      let start = 0;
      let lineOrdinal = 0;
      let chunkRecordCount = 0;
      while (start < text.length) {
        const end = text.indexOf("\n", start);
        if (end < 0) {
          throw new WorkerAnalysisError("NDJSON_INVALID", "parse", {
            chunkOrdinal,
            lineOrdinal: lineOrdinal + 1,
          });
        }
        lineOrdinal += 1;
        const line = text.slice(start, end);
        start = end + 1;
        if (line === "" || line.endsWith("\r")) {
          throw new WorkerAnalysisError("NDJSON_INVALID", "parse", {
            chunkOrdinal,
            lineOrdinal,
          });
        }
        let value: JsonValue;
        try {
          value = parseStrictJson(line);
        } catch {
          throw new WorkerAnalysisError("NDJSON_INVALID", "parse", {
            chunkOrdinal,
            lineOrdinal,
          });
        }
        let event: CanonicalEventV2;
        try {
          event = validateCanonicalEventV2(value);
        } catch {
          throw new WorkerAnalysisError("RECORD_SCHEMA_INVALID", "parse", {
            chunkOrdinal,
            lineOrdinal,
          });
        }
        if (event.sourceIndex !== eventCount) {
          throw new WorkerAnalysisError("RECORD_ORDER_INVALID", "index", {
            chunkOrdinal,
            lineOrdinal,
          });
        }
        const order: readonly [number, number, number] = [
          event.createTime,
          event.fileRank,
          event.sourceIndex,
        ];
        if (
          previousOrder !== undefined &&
          (order[0] < previousOrder[0] ||
            (order[0] === previousOrder[0] && order[1] < previousOrder[1]) ||
            (order[0] === previousOrder[0] &&
              order[1] === previousOrder[1] &&
              order[2] < previousOrder[2]))
        ) {
          throw new WorkerAnalysisError("RECORD_ORDER_INVALID", "index", {
            chunkOrdinal,
            lineOrdinal,
          });
        }
        previousOrder = order;
        categoryCounts[event.messageCategory] += 1;
        if (isCanonicalSystemDiagnostic(event)) {
          systemEventCount += 1;
        } else if (!isCanonicalUserMessage(event)) {
          unknownSenderCount += 1;
        }
        if (isCanonicalEligibleText(event)) {
          eligibleTextCount += 1;
          if (!initializedForCandidate) {
            await this.initializeTokenizer(operationId);
            initializedForCandidate = true;
          }
        }
        const tokens = event.textEligible
          ? tokenizeNormalizedContent(
              event.content ?? "",
              (valueToTokenize) =>
                this.tokenizer.cutWithoutHmm(valueToTokenize),
              stopWords,
              tokenizerSettings.minimumTokenLength,
            )
          : [];
        builder.append(event, tokens);
        minimumCalendarDate =
          minimumCalendarDate === undefined ||
          event.calendarDate < minimumCalendarDate
            ? event.calendarDate
            : minimumCalendarDate;
        maximumCalendarDate =
          maximumCalendarDate === undefined ||
          event.calendarDate > maximumCalendarDate
            ? event.calendarDate
            : maximumCalendarDate;
        eventCount += 1;
        chunkRecordCount += 1;
        if (eventCount % 1024 === 0) {
          this.progress(
            operationId,
            "tokenization",
            eventCount,
            expectedRecords,
            20 + Math.floor((eventCount / expectedRecords) * 60),
            chunkOrdinal,
            manifest.chunks.length,
          );
          this.progress(
            operationId,
            "index",
            eventCount,
            expectedRecords,
            20 + Math.floor((eventCount / expectedRecords) * 60),
            chunkOrdinal,
            manifest.chunks.length,
          );
          await this.checkpoint(operationId, true);
        }
      }
      if (chunkRecordCount !== chunk.recordCount) {
        throw new WorkerAnalysisError("COUNT_MISMATCH", "index", {
          chunkOrdinal,
        });
      }
      await this.checkpoint(operationId, true);
    }
    this.progress(
      operationId,
      "parse",
      expectedRecords,
      expectedRecords,
      80,
    );
    this.progress(
      operationId,
      "index",
      expectedRecords,
      expectedRecords,
      80,
    );
    this.progress(
      operationId,
      "tokenization",
      expectedRecords,
      expectedRecords,
      80,
    );
    const aggregate = manifest.aggregates;
    if (
      eventCount !== aggregate.eventCount ||
      aggregate.userMessageCount !== eventCount - systemEventCount ||
      aggregate.eligibleTextCount !== eligibleTextCount ||
      aggregate.systemEventCount !== systemEventCount ||
      aggregate.unknownSenderCount !== unknownSenderCount ||
      CANONICAL_MESSAGE_CATEGORIES.some(
        (category) => categoryCounts[category] !== aggregate.messageCategoryCounts[category],
      )
    ) {
      throw new WorkerAnalysisError("COUNT_MISMATCH", "index");
    }
    if (minimumCalendarDate === undefined || maximumCalendarDate === undefined) {
      throw new WorkerAnalysisError("COUNT_MISMATCH", "index");
    }
    const dataset: CanonicalDatasetSummary = {
      schemaVersion: CANONICAL_MANIFEST_SCHEMA_VERSION,
      eventCount: aggregate.eventCount,
      userMessageCount: aggregate.userMessageCount,
      eligibleTextCount: aggregate.eligibleTextCount,
      systemEventCount: aggregate.systemEventCount,
      chunkCount: aggregate.chunkCount,
      totalBytes: aggregate.totalBytes,
      warningCount: aggregate.warningCount,
      messageCategoryCounts: aggregate.messageCategoryCounts,
      unknownSenderCount: aggregate.unknownSenderCount,
      minimumCalendarDate,
      maximumCalendarDate,
      pseudonymous: true,
    };
    const index = builder.finish(dataset);
    const cacheGeneration = this.cacheGeneration + 1;
    const candidateCache: CanonicalCache = {
      kind: "v2",
      index,
      correlation,
      generation: cacheGeneration,
    };
    const filters: CanonicalAnalysisFilters = {
      startDate: dataset.minimumCalendarDate,
      endDate: dataset.maximumCalendarDate,
      sender: "both",
      selectedYear: null,
      sessionThresholdHours: DEFAULT_SESSION_THRESHOLD_HOURS,
    };
    const result = await this.aggregateCanonical(
      operationId,
      candidateCache,
      filters,
    );
    await this.checkpoint(operationId, false);
    await source.complete?.();
    await this.checkpoint(operationId, false);
    this.acceptedCache = candidateCache;
    this.cacheGeneration = cacheGeneration;
    this.canonicalResultCache.clear();
    this.finish(operationId, metadata.generation ?? operationId);
    this.cancelled.delete(operationId);
    return { summary: dataset, result };
  }

  analyze(
    operationId: number,
    settings: AnalysisSettings,
    metadata?: OperationMetadata,
  ): Promise<AnalysisResult>;
  analyze(
    operationId: number,
    settings: CanonicalAnalysisSettings,
    metadata?: OperationMetadata,
  ): Promise<CanonicalAnalysisResult>;
  analyze(
    operationId: number,
    settings: AnalysisSettings | CanonicalAnalysisSettings,
    metadata?: OperationMetadata,
  ): Promise<AnalysisResult | CanonicalAnalysisResult>;
  async analyze(
    operationId: number,
    settings: AnalysisSettings | CanonicalAnalysisSettings,
    metadata: OperationMetadata = {},
  ): Promise<AnalysisResult | CanonicalAnalysisResult> {
    this.begin(operationId, metadata);
    const cache = this.acceptedCache;
    if (cache === undefined) {
      const error = new WorkerAnalysisError(
        "NO_ACCEPTED_DATASET",
        "aggregation",
      );
      this.finish(operationId, metadata.generation ?? operationId);
      throw error;
    }
    try {
      if (cache.kind === "v2") {
        if (!("kind" in settings) || settings.kind !== "canonical-v2") {
          throw new WorkerAnalysisError("SETTINGS_INVALID", "aggregation");
        }
        const result = await this.aggregateCanonical(operationId, cache, {
          sender: settings.sender,
          startDate: settings.startDate,
          endDate: settings.endDate,
          selectedYear: settings.selectedYear,
          sessionThresholdHours: settings.sessionThresholdHours,
        });
        this.finish(operationId, metadata.generation ?? operationId);
        this.cancelled.delete(operationId);
        return result;
      }
      if ("kind" in settings) {
        throw new WorkerAnalysisError("SETTINGS_INVALID", "aggregation");
      }
      const result = await this.aggregate(operationId, cache, settings);
      this.finish(operationId, metadata.generation ?? operationId);
      this.cancelled.delete(operationId);
      return result;
    } catch (error) {
      this.finish(operationId, metadata.generation ?? operationId);
      this.cancelled.delete(operationId);
      if (
        error instanceof WorkerAnalysisError ||
        error instanceof WorkerCancellation
      ) {
        throw error;
      }
      if (error instanceof RangeError) {
        throw new WorkerAnalysisError(
          "MEMORY_PRESSURE",
          "aggregation",
        );
      }
      throw new WorkerAnalysisError(
        "WORKER_RUNTIME_FAILED",
        "aggregation",
      );
    }
  }

  private mapSourceError(
    error: unknown,
    phase: WorkerPhase,
    chunkOrdinal?: number,
  ): WorkerAnalysisError | WorkerCancellation {
    if (
      error instanceof WorkerAnalysisError ||
      error instanceof WorkerCancellation
    ) {
      return error;
    }
    if (error instanceof DatasetByteSourceError) {
      return new WorkerAnalysisError(error.code, phase, { chunkOrdinal });
    }
    if (
      error instanceof RangeError ||
      (typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "QuotaExceededError")
    ) {
      return new WorkerAnalysisError("MEMORY_PRESSURE", phase, {
        chunkOrdinal,
      });
    }
    return new WorkerAnalysisError("WORKER_RUNTIME_FAILED", phase, {
      chunkOrdinal,
    });
  }

  isCurrentOperation(operationId: number, generation = operationId): boolean {
    return (
      this.activeOperation?.operationId === operationId &&
      this.activeOperation.generation === generation
    );
  }

  nextResponseMetadata(
    operationId: number,
    generation = operationId,
  ): { readonly generation: number; readonly sequence: number } | undefined {
    const active = this.activeOperation;
    if (
      active === undefined ||
      active.operationId !== operationId ||
      active.generation !== generation ||
      !active.terminal
    ) {
      return undefined;
    }
    active.outputSequence = Math.max(
      active.outputSequence + 1,
      active.requestSequence + 1,
    );
    const metadata = {
      generation: active.generation,
      sequence: active.outputSequence,
    };
    this.activeOperation = undefined;
    return metadata;
  }

  private finish(operationId: number, generation: number): void {
    const active = this.activeOperation;
    if (
      active !== undefined &&
      active.operationId === operationId &&
      active.generation === generation
    ) {
      active.terminal = true;
    }
  }

  private begin(operationId: number, metadata: OperationMetadata): void {
    const generation = metadata.generation ?? operationId;
    const requestSequence = metadata.sequence ?? 1;
    if (
      !Number.isSafeInteger(operationId) ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      !Number.isSafeInteger(requestSequence) ||
      requestSequence < 1 ||
      generation <= this.lastStartedGeneration
    ) {
      throw new WorkerAnalysisError("STALE_OPERATION", "manifest");
    }
    if (this.activeOperation !== undefined) {
      this.cancelled.add(this.activeOperation.operationId);
    }
    this.activeOperationId = operationId;
    this.lastStartedGeneration = generation;
    this.activeOperation = {
      operationId,
      generation,
      requestSequence,
      outputSequence: requestSequence,
      terminal: false,
    };
    for (const stale of this.cancelled) {
      if (stale < operationId) {
        this.cancelled.delete(stale);
      }
    }
  }

  private async initializeTokenizer(operationId: number): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.progress(operationId, "wasm", 0, 1, 25);
    if (this.initializationPromise !== undefined) {
      try {
        await this.initializationPromise;
        return;
      } catch {
        throw new WorkerAnalysisError(
          "WASM_INITIALIZATION_FAILED",
          "wasm",
        );
      }
    }
    try {
      this.initializationPromise = this.tokenizer.initialize();
      await this.initializationPromise;
      this.initialized = true;
      this.progress(operationId, "wasm", 1, 1, 25);
    } catch {
      this.initialized = false;
      throw new WorkerAnalysisError(
        "WASM_INITIALIZATION_FAILED",
        "wasm",
      );
    } finally {
      this.initializationPromise = undefined;
    }
  }

  private async aggregateCanonical(
    operationId: number,
    cache: CanonicalCache,
    filters: CanonicalAnalysisFilters,
  ): Promise<CanonicalAnalysisResult> {
    try {
      validateCanonicalFilters(filters, cache.index.dataset);
    } catch {
      throw new WorkerAnalysisError("SETTINGS_INVALID", "base");
    }
    const queryKey = canonicalQueryKey(
      cache.correlation.generation,
      filters,
    );
    const cached = this.canonicalResultCache.get(queryKey);
    if (cached !== undefined) {
      await this.checkpoint(operationId, false);
      this.progress(operationId, "derived", 1, 1, 100);
      return cached;
    }
    const conversationIndex = await this.getConversationSessionIndex(
      operationId,
      cache,
      filters.sessionThresholdHours,
    );
    this.progress(
      operationId,
      "base",
      0,
      cache.index.summary.indexedRecordCount,
      85,
    );
    const shared: SharedAggregateAccumulator =
      await createSharedAggregateAsync(
        cache.index,
        filters,
        async () => {
          await this.checkpoint(operationId, true);
        },
        conversationIndex,
      );
    await this.checkpoint(operationId, false);
    this.progress(
      operationId,
      "base",
      cache.index.summary.indexedRecordCount,
      cache.index.summary.indexedRecordCount,
      90,
    );
    const aggregate = aggregateSummary(shared);
    const activity = deriveActivityMetrics(shared, filters);
    const replySessions = deriveReplySessionMetrics(
      cache.index,
      shared.conversationIndex,
      filters,
    );
    const stage7 = await deriveStage7Metrics(
      cache.index,
      shared,
      activity,
      filters,
      async () => {
        await this.checkpoint(operationId, true);
      },
      replySessions,
    );
    const result: CanonicalAnalysisResult = {
      schemaVersion: ANALYTICS_RESULT_SCHEMA_VERSION,
      datasetSchemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
      sessionId: cache.correlation.sessionId,
      datasetId: cache.correlation.datasetId,
      generation: cache.correlation.generation,
      metricDefinitionVersions: METRIC_DEFINITION_VERSIONS,
      queryKey,
      filters,
      dataset: cache.index.dataset,
      index: cache.index.summary,
      aggregate,
      activity,
      stage7,
      replySessions,
    };
    try {
      validateCanonicalAnalyticsResult(result);
    } catch {
      throw new WorkerAnalysisError("WORKER_RUNTIME_FAILED", "derived");
    }
    this.progress(operationId, "derived", 1, 1, 100);
    await this.checkpoint(operationId, false);
    if (this.canonicalResultCache.size >= 8) {
      const oldest = this.canonicalResultCache.keys().next().value;
      if (oldest !== undefined) {
        this.canonicalResultCache.delete(oldest);
      }
    }
    this.canonicalResultCache.set(queryKey, result);
    return result;
  }

  private async getConversationSessionIndex(
    operationId: number,
    cache: CanonicalCache,
    thresholdHours: CanonicalAnalysisFilters["sessionThresholdHours"],
  ): Promise<ConversationSessionIndex> {
    const active = this.activeSessionIndex;
    if (
      active !== undefined &&
      active.cacheGeneration === cache.generation &&
      active.index.thresholdHours === thresholdHours
    ) {
      return active.index;
    }
    const total = cache.index.sessionIndex.sortedUserRecordIndexes.length;
    this.progress(operationId, "sessionization", 0, total, 80);
    const next = await buildConversationSessionIndexAsync(
      cache.index,
      thresholdHours,
      async (completed, count) => {
        this.progress(
          operationId,
          "sessionization",
          completed,
          count,
          count === 0 ? 85 : 80 + Math.floor((completed / count) * 5),
        );
        await this.checkpoint(operationId, true);
      },
    );
    this.activeSessionIndex = {
      cacheGeneration: cache.generation,
      index: next,
    };
    this.progress(operationId, "sessionization", total, total, 85);
    return next;
  }

  private async aggregate(
    operationId: number,
    cache: TokenCache,
    settings: AnalysisSettings,
  ): Promise<AnalysisResult> {
    this.validateAnalysisSettings(cache.summary, settings);
    const start = calendarDateCode(settings.startDate);
    const end = calendarDateCode(settings.endDate);
    const frequencies = new Uint32Array(cache.tokenTable.length);
    let analyzedMessageCount = 0;
    let totalTokenCount = 0;
    const recordCount = cache.senderScopes.length;
    for (let record = 0; record < recordCount; record += 1) {
      const senderMatches =
        settings.sender === "all" ||
        (settings.sender === "owner" &&
          cache.senderScopes[record] === 0) ||
        (settings.sender === "other" &&
          cache.senderScopes[record] === 1);
      const date = cache.calendarDates[record];
      if (senderMatches && date >= start && date <= end) {
        analyzedMessageCount += 1;
        for (
          let cursor = cache.recordOffsets[record];
          cursor < cache.recordOffsets[record + 1];
          cursor += 1
        ) {
          frequencies[cache.tokenIds[cursor]] += 1;
          totalTokenCount += 1;
        }
      }
      if ((record + 1) % 8192 === 0) {
        this.progress(
          operationId,
          "aggregation",
          record + 1,
          recordCount,
          85 + Math.floor(((record + 1) / recordCount) * 15),
        );
        await this.checkpoint(operationId, true);
      }
    }
    const ranked = cache.tokenTable
      .map((token, tokenId) => ({
        token,
        frequency: frequencies[tokenId],
      }))
      .filter((item) => item.frequency > 0)
      .sort(
        (left, right) =>
          right.frequency - left.frequency ||
          compareCodePoints(left.token, right.token),
      );
    const uniqueTokenCount = ranked.length;
    const words = ranked
      .filter((item) => item.frequency >= settings.minimumFrequency)
      .slice(0, settings.maximumWords);
    this.progress(
      operationId,
      "aggregation",
      recordCount,
      recordCount,
      100,
    );
    return {
      words,
      analyzedMessageCount,
      uniqueTokenCount,
      totalTokenCount,
      sender: settings.sender,
      startDate: settings.startDate,
      endDate: settings.endDate,
      maximumWords: settings.maximumWords,
      minimumFrequency: settings.minimumFrequency,
      cacheGeneration: cache.generation,
    };
  }

  private validateAnalysisSettings(
    summary: DatasetSummary,
    settings: AnalysisSettings,
  ): void {
    let calendarDatesValid = true;
    try {
      calendarDateCode(settings.startDate);
      calendarDateCode(settings.endDate);
    } catch {
      calendarDatesValid = false;
    }
    if (
      !["all", "owner", "other"].includes(settings.sender) ||
      !calendarDatesValid ||
      !DATE_PATTERN.test(settings.startDate) ||
      !DATE_PATTERN.test(settings.endDate) ||
      settings.startDate < summary.minimumCalendarDate ||
      settings.endDate > summary.maximumCalendarDate ||
      settings.startDate > settings.endDate ||
      !Number.isSafeInteger(settings.maximumWords) ||
      settings.maximumWords < 1 ||
      settings.maximumWords > MAXIMUM_DISPLAYED_WORDS ||
      !Number.isSafeInteger(settings.minimumFrequency) ||
      settings.minimumFrequency < 1 ||
      settings.minimumFrequency > MAXIMUM_MINIMUM_FREQUENCY
    ) {
      throw new WorkerAnalysisError(
        "SETTINGS_INVALID",
        "aggregation",
      );
    }
  }

  private progress(
    operationId: number,
    phase: WorkerPhase,
    completed: number,
    total: number,
    percentage: number,
    chunkOrdinal?: number,
    chunkCount?: number,
  ): void {
    const active = this.activeOperation;
    if (
      active === undefined ||
      active.operationId !== operationId ||
      active.terminal
    ) {
      return;
    }
    active.outputSequence = Math.max(
      active.outputSequence + 1,
      active.requestSequence + 1,
    );
    this.reportProgress({
      type: "progress",
      operationId,
      generation: active.generation,
      sequence: active.outputSequence,
      phase,
      completed,
      total,
      percentage: Math.max(0, Math.min(100, percentage)),
      ...(chunkOrdinal === undefined ? {} : { chunkOrdinal }),
      ...(chunkCount === undefined ? {} : { chunkCount }),
    });
  }

  private async checkpoint(
    operationId: number,
    yieldToMessages: boolean,
  ): Promise<void> {
    if (yieldToMessages) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    if (
      this.activeOperationId !== operationId ||
      this.activeOperation?.operationId !== operationId ||
      this.activeOperation.terminal ||
      this.cancelled.has(operationId)
    ) {
      throw new WorkerCancellation();
    }
  }
}
