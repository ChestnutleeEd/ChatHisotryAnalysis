import type { CanonicalAnalysisFilters } from "./analytics-contract";
import {
  OWNER_SENDER_CODE,
  OTHER_SENDER_CODE,
  type CanonicalIndex,
} from "./canonical-index";
import { calendarDayOrdinal } from "./calendar";

export const REPLY_SESSION_METRICS_SCHEMA_VERSION =
  "chat-history-analysis.reply-session-metrics.v1" as const;

export const REPLY_INTERVAL_DEFINITION_VERSION =
  "chat-history-analysis.metric.reply-interval.v1" as const;
export const SESSION_INITIATOR_DEFINITION_VERSION =
  "chat-history-analysis.metric.session-initiator.v1" as const;

export const REPLY_INTERVAL_UNIT = "seconds" as const;
export const REPLY_INTERVAL_FILTER_BEHAVIOR =
  "ignores-global-sender-filter" as const;
export const REPLY_INTERVAL_DATE_BOUNDARY =
  "both-boundary-messages-inclusive" as const;
export const REPLY_INTERVAL_EXCLUDED_GAP_RULE =
  "strictly-greater-gap-starts-new-session" as const;
export const SESSION_OPENING_DATE_BOUNDARY =
  "opening-user-message-inclusive" as const;

export const UNKNOWN_SENDER_CODE = 3;

const REVIEWED_THRESHOLD_HOURS = [1, 3, 6, 12, 24] as const;

export const REPLY_INTERVAL_BIN_DEFINITIONS = [
  { id: "0-59-seconds", label: "0–59 seconds", minSeconds: 0, maxSeconds: 59 },
  { id: "60-299-seconds", label: "60–299 seconds", minSeconds: 60, maxSeconds: 299 },
  { id: "300-1799-seconds", label: "300–1,799 seconds", minSeconds: 300, maxSeconds: 1_799 },
  { id: "1800-3599-seconds", label: "1,800–3,599 seconds", minSeconds: 1_800, maxSeconds: 3_599 },
  { id: "3600-21599-seconds", label: "3,600–21,599 seconds", minSeconds: 3_600, maxSeconds: 21_599 },
  { id: "21600-43199-seconds", label: "21,600–43,199 seconds", minSeconds: 21_600, maxSeconds: 43_199 },
  { id: "43200-86399-seconds", label: "43,200–86,399 seconds", minSeconds: 43_200, maxSeconds: 86_399 },
  { id: "86400-seconds", label: "86,400 seconds", minSeconds: 86_400, maxSeconds: 86_400 },
] as const;

export type ReplyDirection = "owner-to-other" | "other-to-owner";
export type InitiatorScope = "owner" | "other" | "unknown";

interface GrowableUint32 {
  readonly length: number;
  push(value: number): void;
  finish(): Uint32Array;
}

class Uint32Builder implements GrowableUint32 {
  private storage = new Uint32Array(1024);
  private lengthValue = 0;

  get length(): number {
    return this.lengthValue;
  }

  push(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 4_294_967_295) {
      throw new Error("SESSION_INDEX_LIMIT");
    }
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

class Uint8Builder {
  private storage = new Uint8Array(1024);
  private lengthValue = 0;

  get length(): number {
    return this.lengthValue;
  }

  push(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
      throw new Error("SESSION_INDEX_LIMIT");
    }
    if (this.lengthValue === this.storage.length) {
      const next = new Uint8Array(this.storage.length * 2);
      next.set(this.storage);
      this.storage = next;
    }
    this.storage[this.lengthValue] = value;
    this.lengthValue += 1;
  }

  finish(): Uint8Array {
    return this.storage.slice(0, this.lengthValue);
  }
}

export interface ConversationSessionIndex {
  readonly thresholdHours: CanonicalAnalysisFilters["sessionThresholdHours"];
  readonly thresholdSeconds: number;
  readonly sessionStarts: Uint32Array;
  readonly sessionEnds: Uint32Array;
  readonly sessionInitiatorCodes: Uint8Array;
  readonly replyPreviousRecords: Uint32Array;
  readonly replyResponseRecords: Uint32Array;
  readonly replyFromSenderCodes: Uint8Array;
  readonly replyToSenderCodes: Uint8Array;
  readonly replyIntervals: Uint32Array;
}

function isKnownSender(code: number): code is 0 | 1 {
  return code === OWNER_SENDER_CODE || code === OTHER_SENDER_CODE;
}

function directionFor(
  from: number,
  to: number,
): ReplyDirection | undefined {
  if (from === OWNER_SENDER_CODE && to === OTHER_SENDER_CODE) {
    return "owner-to-other";
  }
  if (from === OTHER_SENDER_CODE && to === OWNER_SENDER_CODE) {
    return "other-to-owner";
  }
  return undefined;
}

function appendUserRecord(
  builder: SessionIndexBuilder,
  index: CanonicalIndex,
  record: number,
): void {
  builder.append(index, record);
}

class SessionIndexBuilder {
  private readonly sessionStarts = new Uint32Builder();
  private readonly sessionEnds = new Uint32Builder();
  private readonly sessionInitiators = new Uint8Builder();
  private readonly replyPreviousRecords = new Uint32Builder();
  private readonly replyResponseRecords = new Uint32Builder();
  private readonly replyFromSenders = new Uint8Builder();
  private readonly replyToSenders = new Uint8Builder();
  private readonly replyIntervals = new Uint32Builder();
  private previousRecord: number | undefined;
  private currentSessionStart: number | undefined;
  private previousBurstSender: number | undefined;
  private previousBurstLastRecord: number | undefined;

  constructor(
    private readonly thresholdHours: CanonicalAnalysisFilters["sessionThresholdHours"],
  ) {
    if (!REVIEWED_THRESHOLD_HOURS.includes(thresholdHours)) {
      throw new Error("INVALID_SESSION_THRESHOLD");
    }
  }

  append(index: CanonicalIndex, record: number): void {
    const sender = index.senderCodes[record];
    const previousRecord = this.previousRecord;
    if (previousRecord === undefined) {
      this.startSession(record, sender);
      return;
    }

    const gapSeconds = index.createTimes[record] - index.createTimes[previousRecord];
    if (!Number.isSafeInteger(gapSeconds) || gapSeconds < 0) {
      throw new Error("ANALYTICS_INTEGRITY_ERROR");
    }
    if (gapSeconds > this.thresholdHours * 3_600) {
      this.sessionEnds.push(previousRecord);
      this.startSession(record, sender);
      return;
    }

    if (sender === this.previousBurstSender) {
      this.previousBurstLastRecord = record;
    } else {
      const previousBurstLastRecord = this.previousBurstLastRecord;
      const previousBurstSender = this.previousBurstSender;
      if (previousBurstLastRecord !== undefined && previousBurstSender !== undefined) {
        const direction = directionFor(previousBurstSender, sender);
        if (direction !== undefined) {
          const interval = index.createTimes[record] - index.createTimes[previousBurstLastRecord];
          if (!Number.isSafeInteger(interval) || interval < 0) {
            throw new Error("ANALYTICS_INTEGRITY_ERROR");
          }
          this.replyPreviousRecords.push(previousBurstLastRecord);
          this.replyResponseRecords.push(record);
          this.replyFromSenders.push(previousBurstSender);
          this.replyToSenders.push(sender);
          this.replyIntervals.push(interval);
        }
      }
      this.previousBurstSender = sender;
      this.previousBurstLastRecord = record;
    }
    this.previousRecord = record;
  }

  private startSession(record: number, sender: number): void {
    this.sessionStarts.push(record);
    this.sessionInitiators.push(
      isKnownSender(sender) ? sender : UNKNOWN_SENDER_CODE,
    );
    this.currentSessionStart = record;
    this.previousBurstSender = sender;
    this.previousBurstLastRecord = record;
    this.previousRecord = record;
  }

  finish(): ConversationSessionIndex {
    if (this.currentSessionStart !== undefined && this.previousRecord !== undefined) {
      this.sessionEnds.push(this.previousRecord);
    }
    const sessionStarts = this.sessionStarts.finish();
    const sessionEnds = this.sessionEnds.finish();
    const sessionInitiatorCodes = this.sessionInitiators.finish();
    if (
      sessionStarts.length !== sessionEnds.length ||
      sessionStarts.length !== sessionInitiatorCodes.length
    ) {
      throw new Error("ANALYTICS_INTEGRITY_ERROR");
    }
    const replyPreviousRecords = this.replyPreviousRecords.finish();
    const replyResponseRecords = this.replyResponseRecords.finish();
    const replyFromSenderCodes = this.replyFromSenders.finish();
    const replyToSenderCodes = this.replyToSenders.finish();
    const replyIntervals = this.replyIntervals.finish();
    if (
      replyPreviousRecords.length !== replyResponseRecords.length ||
      replyPreviousRecords.length !== replyFromSenderCodes.length ||
      replyPreviousRecords.length !== replyToSenderCodes.length ||
      replyPreviousRecords.length !== replyIntervals.length
    ) {
      throw new Error("ANALYTICS_INTEGRITY_ERROR");
    }
    return {
      thresholdHours: this.thresholdHours,
      thresholdSeconds: this.thresholdHours * 3_600,
      sessionStarts,
      sessionEnds,
      sessionInitiatorCodes,
      replyPreviousRecords,
      replyResponseRecords,
      replyFromSenderCodes,
      replyToSenderCodes,
      replyIntervals,
    };
  }
}

export function buildConversationSessionIndex(
  index: CanonicalIndex,
  thresholdHours: CanonicalAnalysisFilters["sessionThresholdHours"],
): ConversationSessionIndex {
  const builder = new SessionIndexBuilder(thresholdHours);
  for (const record of index.sessionIndex.sortedUserRecordIndexes) {
    appendUserRecord(builder, index, record);
  }
  return builder.finish();
}

export async function buildConversationSessionIndexAsync(
  index: CanonicalIndex,
  thresholdHours: CanonicalAnalysisFilters["sessionThresholdHours"],
  checkpoint: (completed: number, total: number) => Promise<void>,
): Promise<ConversationSessionIndex> {
  const builder = new SessionIndexBuilder(thresholdHours);
  const records = index.sessionIndex.sortedUserRecordIndexes;
  for (let position = 0; position < records.length; position += 1) {
    const record = records[position];
    if (record === undefined) {
      throw new Error("ANALYTICS_INTEGRITY_ERROR");
    }
    appendUserRecord(builder, index, record);
    if ((position + 1) % 4_096 === 0) {
      await checkpoint(position + 1, records.length);
    }
  }
  await checkpoint(records.length, records.length);
  return builder.finish();
}

export interface ReplyIntervalBin {
  readonly id: (typeof REPLY_INTERVAL_BIN_DEFINITIONS)[number]["id"];
  readonly label: string;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly count: number;
}

export interface ReplyIntervalStats {
  readonly count: number;
  readonly meanSeconds: number | null;
  readonly p25Seconds: number | null;
  readonly medianSeconds: number | null;
  readonly p75Seconds: number | null;
  readonly p90Seconds: number | null;
  readonly bins: readonly ReplyIntervalBin[];
}

export interface ReplyDirectionMetrics {
  readonly direction: ReplyDirection;
  readonly from: "owner" | "other";
  readonly to: "owner" | "other";
  readonly responder: "owner" | "other";
  readonly stats: ReplyIntervalStats;
}

export interface ReplyIntervalMetrics {
  readonly schemaVersion: typeof REPLY_SESSION_METRICS_SCHEMA_VERSION;
  readonly definitionVersion: typeof REPLY_INTERVAL_DEFINITION_VERSION;
  readonly unit: typeof REPLY_INTERVAL_UNIT;
  readonly thresholdHours: CanonicalAnalysisFilters["sessionThresholdHours"];
  readonly filterBehavior: typeof REPLY_INTERVAL_FILTER_BEHAVIOR;
  readonly dateBoundary: typeof REPLY_INTERVAL_DATE_BOUNDARY;
  readonly excludedGapRule: typeof REPLY_INTERVAL_EXCLUDED_GAP_RULE;
  readonly overall: ReplyIntervalStats;
  readonly directions: readonly [ReplyDirectionMetrics, ReplyDirectionMetrics];
}

export interface InitiatorBucket {
  readonly initiator: InitiatorScope;
  readonly count: number;
  readonly share: number | null;
}

export interface ConversationSessionMetrics {
  readonly schemaVersion: typeof REPLY_SESSION_METRICS_SCHEMA_VERSION;
  readonly definitionVersion: typeof SESSION_INITIATOR_DEFINITION_VERSION;
  readonly thresholdHours: CanonicalAnalysisFilters["sessionThresholdHours"];
  readonly filterBehavior: typeof REPLY_INTERVAL_FILTER_BEHAVIOR;
  readonly openingDateBoundary: typeof SESSION_OPENING_DATE_BOUNDARY;
  readonly sensitivityChanged: boolean;
  readonly sessionCount: number;
  readonly shareDenominator: number;
  readonly initiatorCounts: Readonly<{
    readonly owner: InitiatorBucket;
    readonly other: InitiatorBucket;
    readonly unknown: InitiatorBucket;
  }>;
}

export interface ReplySessionMetrics {
  readonly schemaVersion: typeof REPLY_SESSION_METRICS_SCHEMA_VERSION;
  readonly replyIntervals: ReplyIntervalMetrics;
  readonly conversationSessions: ConversationSessionMetrics;
}

function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const rank = Math.max(1, Math.ceil(percentile * values.length));
  return values[rank - 1] ?? null;
}

function emptyStats(): ReplyIntervalStats {
  return {
    count: 0,
    meanSeconds: null,
    p25Seconds: null,
    medianSeconds: null,
    p75Seconds: null,
    p90Seconds: null,
    bins: REPLY_INTERVAL_BIN_DEFINITIONS.map((bin) => ({ ...bin, count: 0 })),
  };
}

function deriveStats(values: readonly number[]): ReplyIntervalStats {
  if (values.length === 0) {
    return emptyStats();
  }
  const ordered = [...values].sort((left, right) => left - right);
  const sum = ordered.reduce((total, value) => total + value, 0);
  const bins = REPLY_INTERVAL_BIN_DEFINITIONS.map((bin) => ({
    ...bin,
    count: ordered.filter(
      (value) => value >= bin.minSeconds && value <= bin.maxSeconds,
    ).length,
  }));
  if (!Number.isFinite(sum) || !Number.isFinite(sum / ordered.length)) {
    throw new Error("ANALYTICS_INTEGRITY_ERROR");
  }
  return {
    count: ordered.length,
    meanSeconds: sum / ordered.length,
    p25Seconds: nearestRank(ordered, 0.25),
    medianSeconds: nearestRank(ordered, 0.5),
    p75Seconds: nearestRank(ordered, 0.75),
    p90Seconds: nearestRank(ordered, 0.9),
    bins,
  };
}

function selectedDay(
  index: CanonicalIndex,
  record: number,
  startDay: number,
  endDay: number,
): boolean {
  const day = index.calendarDays[record];
  return day >= startDay && day <= endDay;
}

function bucket(
  initiator: InitiatorScope,
  count: number,
  denominator: number,
): InitiatorBucket {
  return {
    initiator,
    count,
    share: denominator === 0 ? null : count / denominator,
  };
}

export function deriveReplySessionMetrics(
  index: CanonicalIndex,
  sessionIndex: ConversationSessionIndex,
  filters: CanonicalAnalysisFilters,
): ReplySessionMetrics {
  if (!REVIEWED_THRESHOLD_HOURS.includes(filters.sessionThresholdHours)) {
    throw new Error("INVALID_SESSION_THRESHOLD");
  }
  if (sessionIndex.thresholdHours !== filters.sessionThresholdHours) {
    throw new Error("SESSION_INDEX_THRESHOLD_MISMATCH");
  }
  const startDay = calendarDayOrdinal(filters.startDate);
  const endDay = calendarDayOrdinal(filters.endDate);
  const overallIntervals: number[] = [];
  const ownerToOther: number[] = [];
  const otherToOwner: number[] = [];
  for (let pair = 0; pair < sessionIndex.replyIntervals.length; pair += 1) {
    const previousRecord = sessionIndex.replyPreviousRecords[pair];
    const responseRecord = sessionIndex.replyResponseRecords[pair];
    const interval = sessionIndex.replyIntervals[pair];
    if (
      previousRecord === undefined ||
      responseRecord === undefined ||
      interval === undefined ||
      !selectedDay(index, previousRecord, startDay, endDay) ||
      !selectedDay(index, responseRecord, startDay, endDay)
    ) {
      continue;
    }
    const from = sessionIndex.replyFromSenderCodes[pair];
    const to = sessionIndex.replyToSenderCodes[pair];
    overallIntervals.push(interval);
    if (from === OWNER_SENDER_CODE && to === OTHER_SENDER_CODE) {
      ownerToOther.push(interval);
    } else if (from === OTHER_SENDER_CODE && to === OWNER_SENDER_CODE) {
      otherToOwner.push(interval);
    }
  }

  const directions: [ReplyDirectionMetrics, ReplyDirectionMetrics] = [
    {
      direction: "owner-to-other",
      from: "owner",
      to: "other",
      responder: "other",
      stats: deriveStats(ownerToOther),
    },
    {
      direction: "other-to-owner",
      from: "other",
      to: "owner",
      responder: "owner",
      stats: deriveStats(otherToOwner),
    },
  ];

  let ownerCount = 0;
  let otherCount = 0;
  let unknownCount = 0;
  for (let session = 0; session < sessionIndex.sessionStarts.length; session += 1) {
    const startRecord = sessionIndex.sessionStarts[session];
    if (
      startRecord === undefined ||
      !selectedDay(index, startRecord, startDay, endDay)
    ) {
      continue;
    }
    const initiator = sessionIndex.sessionInitiatorCodes[session];
    if (initiator === OWNER_SENDER_CODE) {
      ownerCount += 1;
    } else if (initiator === OTHER_SENDER_CODE) {
      otherCount += 1;
    } else {
      unknownCount += 1;
    }
  }
  const sessionCount = ownerCount + otherCount + unknownCount;
  return {
    schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
    replyIntervals: {
      schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
      definitionVersion: REPLY_INTERVAL_DEFINITION_VERSION,
      unit: REPLY_INTERVAL_UNIT,
      thresholdHours: filters.sessionThresholdHours,
      filterBehavior: REPLY_INTERVAL_FILTER_BEHAVIOR,
      dateBoundary: REPLY_INTERVAL_DATE_BOUNDARY,
      excludedGapRule: REPLY_INTERVAL_EXCLUDED_GAP_RULE,
      overall: deriveStats(overallIntervals),
      directions,
    },
    conversationSessions: {
      schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
      definitionVersion: SESSION_INITIATOR_DEFINITION_VERSION,
      thresholdHours: filters.sessionThresholdHours,
      filterBehavior: REPLY_INTERVAL_FILTER_BEHAVIOR,
      openingDateBoundary: SESSION_OPENING_DATE_BOUNDARY,
      sensitivityChanged: filters.sessionThresholdHours !== 6,
      sessionCount,
      shareDenominator: sessionCount,
      initiatorCounts: {
        owner: bucket("owner", ownerCount, sessionCount),
        other: bucket("other", otherCount, sessionCount),
        unknown: bucket("unknown", unknownCount, sessionCount),
      },
    },
  };
}

export function replyDirectionLabel(direction: ReplyDirection): string {
  return direction === "owner-to-other" ? "Owner → Other" : "Other → Owner";
}

export function replyStatsHaveData(stats: ReplyIntervalStats): boolean {
  return stats.count > 0;
}

export function validateReplySessionMetrics(
  value: unknown,
): ReplySessionMetrics {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  const root = value as Record<string, unknown>;
  if (
    Object.keys(root).sort().join(",") !==
      ["conversationSessions", "replyIntervals", "schemaVersion"].sort().join(",") ||
    root.schemaVersion !== REPLY_SESSION_METRICS_SCHEMA_VERSION
  ) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  validateReplyIntervals(root.replyIntervals);
  validateConversationSessions(root.conversationSessions);
  const replyIntervals = root.replyIntervals as ReplyIntervalMetrics;
  const sessions = root.conversationSessions as ConversationSessionMetrics;
  if (replyIntervals.thresholdHours !== sessions.thresholdHours) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  return value as ReplySessionMetrics;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeMetricValue(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function validateStats(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  const stats = value as Record<string, unknown>;
  if (
    !exactKeys(stats, ["bins", "count", "meanSeconds", "medianSeconds", "p25Seconds", "p75Seconds", "p90Seconds"]) ||
    !safeInteger(stats.count) ||
    !safeMetricValue(stats.meanSeconds) ||
    !safeMetricValue(stats.p25Seconds) ||
    !safeMetricValue(stats.medianSeconds) ||
    !safeMetricValue(stats.p75Seconds) ||
    !safeMetricValue(stats.p90Seconds) ||
    !Array.isArray(stats.bins) ||
    stats.bins.length !== REPLY_INTERVAL_BIN_DEFINITIONS.length
  ) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  let count = 0;
  stats.bins.forEach((binValue, index) => {
    if (
      binValue === null ||
      typeof binValue !== "object" ||
      Array.isArray(binValue) ||
      !exactKeys(binValue as Record<string, unknown>, ["count", "id", "label", "maxSeconds", "minSeconds"])
    ) {
      throw new Error("INVALID_REPLY_SESSION_RESULT");
    }
    const bin = binValue as Record<string, unknown>;
    const expected = REPLY_INTERVAL_BIN_DEFINITIONS[index];
    if (
      expected === undefined ||
      bin.id !== expected.id ||
      bin.label !== expected.label ||
      bin.minSeconds !== expected.minSeconds ||
      bin.maxSeconds !== expected.maxSeconds ||
      !safeInteger(bin.count)
    ) {
      throw new Error("INVALID_REPLY_SESSION_RESULT");
    }
    count += bin.count as number;
  });
  if (count !== stats.count) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  if (
    stats.count === 0 &&
    [stats.meanSeconds, stats.p25Seconds, stats.medianSeconds, stats.p75Seconds, stats.p90Seconds].some(
      (metric) => metric !== null,
    )
  ) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  if (
    stats.count > 0 &&
    [stats.meanSeconds, stats.p25Seconds, stats.medianSeconds, stats.p75Seconds, stats.p90Seconds].some(
      (metric) => metric === null,
    )
  ) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
}

function validateReplyIntervals(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  const metric = value as Record<string, unknown>;
  if (
    !exactKeys(metric, ["dateBoundary", "definitionVersion", "directions", "excludedGapRule", "filterBehavior", "overall", "schemaVersion", "thresholdHours", "unit"]) ||
    metric.schemaVersion !== REPLY_SESSION_METRICS_SCHEMA_VERSION ||
    metric.definitionVersion !== REPLY_INTERVAL_DEFINITION_VERSION ||
    metric.unit !== REPLY_INTERVAL_UNIT ||
    ![1, 3, 6, 12, 24].includes(metric.thresholdHours as number) ||
    metric.filterBehavior !== REPLY_INTERVAL_FILTER_BEHAVIOR ||
    metric.dateBoundary !== REPLY_INTERVAL_DATE_BOUNDARY ||
    metric.excludedGapRule !== REPLY_INTERVAL_EXCLUDED_GAP_RULE ||
    !Array.isArray(metric.directions) ||
    metric.directions.length !== 2
  ) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  validateStats(metric.overall);
  const expectedDirections: readonly [ReplyDirection, ReplyDirection] = [
    "owner-to-other",
    "other-to-owner",
  ];
  let directionTotal = 0;
  metric.directions.forEach((directionValue, index) => {
    if (directionValue === null || typeof directionValue !== "object" || Array.isArray(directionValue)) {
      throw new Error("INVALID_REPLY_SESSION_RESULT");
    }
    const direction = directionValue as Record<string, unknown>;
    if (
      !exactKeys(direction, ["direction", "from", "responder", "stats", "to"]) ||
      direction.direction !== expectedDirections[index] ||
      !["owner", "other"].includes(direction.from as string) ||
      !["owner", "other"].includes(direction.to as string) ||
      direction.from === direction.to ||
      direction.responder !== direction.to
    ) {
      throw new Error("INVALID_REPLY_SESSION_RESULT");
    }
    validateStats(direction.stats);
    directionTotal += (direction.stats as ReplyIntervalStats).count;
  });
  if (directionTotal !== (metric.overall as ReplyIntervalStats).count) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
}

function validateConversationSessions(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  const metric = value as Record<string, unknown>;
  if (
    !exactKeys(metric, ["definitionVersion", "filterBehavior", "initiatorCounts", "openingDateBoundary", "schemaVersion", "sensitivityChanged", "sessionCount", "shareDenominator", "thresholdHours"]) ||
    metric.schemaVersion !== REPLY_SESSION_METRICS_SCHEMA_VERSION ||
    metric.definitionVersion !== SESSION_INITIATOR_DEFINITION_VERSION ||
    metric.filterBehavior !== REPLY_INTERVAL_FILTER_BEHAVIOR ||
    metric.openingDateBoundary !== SESSION_OPENING_DATE_BOUNDARY ||
    typeof metric.sensitivityChanged !== "boolean" ||
    ![1, 3, 6, 12, 24].includes(metric.thresholdHours as number) ||
    !safeInteger(metric.sessionCount) ||
    !safeInteger(metric.shareDenominator) ||
    metric.shareDenominator !== metric.sessionCount ||
    metric.initiatorCounts === null ||
    typeof metric.initiatorCounts !== "object" ||
    Array.isArray(metric.initiatorCounts) ||
    !exactKeys(metric.initiatorCounts as Record<string, unknown>, ["other", "owner", "unknown"])
  ) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  if (metric.sensitivityChanged !== (metric.thresholdHours !== 6)) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
  const initiatorCounts = metric.initiatorCounts as Record<string, unknown>;
  let total = 0;
  for (const initiator of ["owner", "other", "unknown"] as const) {
    const valueForInitiator = initiatorCounts[initiator];
    if (valueForInitiator === null || typeof valueForInitiator !== "object" || Array.isArray(valueForInitiator)) {
      throw new Error("INVALID_REPLY_SESSION_RESULT");
    }
    const bucketValue = valueForInitiator as Record<string, unknown>;
    if (
      !exactKeys(bucketValue, ["count", "initiator", "share"]) ||
      bucketValue.initiator !== initiator ||
      !safeInteger(bucketValue.count) ||
      !safeMetricValue(bucketValue.share) ||
      bucketValue.share !== ((metric.sessionCount as number) === 0 ? null : (bucketValue.count as number) / (metric.sessionCount as number))
    ) {
      throw new Error("INVALID_REPLY_SESSION_RESULT");
    }
    total += bucketValue.count as number;
  }
  if (total !== metric.sessionCount) {
    throw new Error("INVALID_REPLY_SESSION_RESULT");
  }
}
