import { CANONICAL_MESSAGE_CATEGORIES } from "../canonical-v2/schema";
import type { ApprovedChartKey } from "./ipc-contract";
import type { CanonicalAnalysisResult } from "../worker-analysis/analytics-contract";

/**
 * Renderer-to-host export input.  This is deliberately numeric and closed:
 * the host derives all export labels, definitions, and serialization metadata.
 */
export interface RendererAggregateInput {
  readonly chartKey: ApprovedChartKey;
  readonly filters: {
    readonly startDate: string;
    readonly endDate: string;
    readonly sender: "both" | "owner" | "other";
    readonly selectedYear: number | null;
    readonly sessionThresholdHours: 1 | 3 | 6 | 12 | 24;
  };
  readonly userMessageCount: number;
  readonly eligibleTextCount: number;
  readonly senderCounts: readonly [number, number];
  readonly chatDays: number;
  readonly longestStreakDays: number;
  readonly dailyCounts: readonly number[];
  readonly monthlyCounts: readonly number[];
  readonly yearlyCounts: readonly number[];
  readonly hourCounts: readonly number[];
  readonly weekdayCounts: readonly number[];
  readonly messageTypeCounts: readonly number[];
  readonly systemCount: number;
  readonly length: {
    readonly overall: LengthStatsInput;
    readonly owner: LengthStatsInput;
    readonly other: LengthStatsInput;
  };
  readonly replies: {
    readonly overall: ReplyStatsInput;
    readonly ownerToOther: ReplyStatsInput;
    readonly otherToOwner: ReplyStatsInput;
  };
  readonly initiatorCounts: readonly [number, number, number];
}

interface LengthStatsInput {
  readonly count: number;
  readonly totalCodePoints: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
}

interface ReplyStatsInput {
  readonly count: number;
  readonly meanSeconds: number | null;
  readonly medianSeconds: number | null;
  readonly bins: readonly number[];
}

const APPROVED_CHART_KEYS: readonly ApprovedChartKey[] = [
  "trends",
  "sender-comparison",
  "hour",
  "weekday",
  "message-types",
  "reply-bins",
  "initiator-counts",
];
const APPROVED_THRESHOLDS = [1, 3, 6, 12, 24] as const;
const REPLY_BIN_COUNT = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isFilter(value: unknown): value is RendererAggregateInput["filters"] {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["endDate", "selectedYear", "sender", "sessionThresholdHours", "startDate"])
  ) {
    return false;
  }
  return (
    isDate(value.startDate) &&
    isDate(value.endDate) &&
    (value.sender === "both" || value.sender === "owner" || value.sender === "other") &&
    (value.selectedYear === null || (safeInteger(value.selectedYear) && value.selectedYear >= 1 && value.selectedYear <= 9999)) &&
    APPROVED_THRESHOLDS.includes(value.sessionThresholdHours as (typeof APPROVED_THRESHOLDS)[number])
  );
}

function isUintArray(value: unknown, length?: number): value is readonly number[] {
  return Array.isArray(value) &&
    (length === undefined || value.length === length) &&
    value.every(safeInteger);
}

function isLengthStats(value: unknown): value is LengthStatsInput {
  if (!isRecord(value) || !exactKeys(value, ["count", "mean", "median", "p90", "totalCodePoints"])) {
    return false;
  }
  return (
    safeInteger(value.count) &&
    safeInteger(value.totalCodePoints) &&
    [value.mean, value.median, value.p90].every((candidate) => candidate === null || finiteNonNegative(candidate))
  );
}

function isReplyStats(value: unknown): value is ReplyStatsInput {
  if (!isRecord(value) || !exactKeys(value, ["bins", "count", "meanSeconds", "medianSeconds"])) {
    return false;
  }
  return (
    safeInteger(value.count) &&
    isUintArray(value.bins, REPLY_BIN_COUNT) &&
    [value.meanSeconds, value.medianSeconds].every((candidate) => candidate === null || finiteNonNegative(candidate))
  );
}

export function isRendererAggregateInput(value: unknown): value is RendererAggregateInput {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "chartKey",
      "chatDays",
      "dailyCounts",
      "eligibleTextCount",
      "filters",
      "hourCounts",
      "initiatorCounts",
      "length",
      "longestStreakDays",
      "messageTypeCounts",
      "monthlyCounts",
      "replies",
      "senderCounts",
      "systemCount",
      "userMessageCount",
      "weekdayCounts",
      "yearlyCounts",
    ]) ||
    !APPROVED_CHART_KEYS.includes(value.chartKey as ApprovedChartKey) ||
    !isFilter(value.filters) ||
    !safeInteger(value.userMessageCount) ||
    !safeInteger(value.eligibleTextCount) ||
    !Array.isArray(value.senderCounts) ||
    value.senderCounts.length !== 2 ||
    !value.senderCounts.every(safeInteger) ||
    !safeInteger(value.chatDays) ||
    !safeInteger(value.longestStreakDays) ||
    !isUintArray(value.dailyCounts) ||
    value.dailyCounts.length === 0 ||
    value.dailyCounts.length > 100_000 ||
    !isUintArray(value.monthlyCounts) ||
    value.monthlyCounts.length === 0 ||
    value.monthlyCounts.length > 1_200 ||
    !isUintArray(value.yearlyCounts) ||
    value.yearlyCounts.length === 0 ||
    value.yearlyCounts.length > 100 ||
    !isUintArray(value.hourCounts, 24) ||
    !isUintArray(value.weekdayCounts, 7) ||
    !isUintArray(value.messageTypeCounts, CANONICAL_MESSAGE_CATEGORIES.length) ||
    !safeInteger(value.systemCount) ||
    !Array.isArray(value.initiatorCounts) ||
    value.initiatorCounts.length !== 3 ||
    !value.initiatorCounts.every(safeInteger) ||
    !isRecord(value.length) ||
    !exactKeys(value.length, ["other", "owner", "overall"]) ||
    !isLengthStats(value.length.overall) ||
    !isLengthStats(value.length.owner) ||
    !isLengthStats(value.length.other) ||
    !isRecord(value.replies) ||
    !exactKeys(value.replies, ["otherToOwner", "overall", "ownerToOther"]) ||
    !isReplyStats(value.replies.overall) ||
    !isReplyStats(value.replies.ownerToOther) ||
    !isReplyStats(value.replies.otherToOwner)
  ) {
    return false;
  }
  return value.filters.startDate <= value.filters.endDate;
}

function lengthStats(stats: {
  readonly count: number;
  readonly sum: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
}): LengthStatsInput {
  return {
    count: stats.count,
    totalCodePoints: stats.sum,
    mean: stats.mean,
    median: stats.median,
    p90: stats.p90,
  };
}

function replyStats(stats: {
  readonly count: number;
  readonly meanSeconds: number | null;
  readonly medianSeconds: number | null;
  readonly bins: readonly { readonly count: number }[];
}): ReplyStatsInput {
  return {
    count: stats.count,
    meanSeconds: stats.meanSeconds,
    medianSeconds: stats.medianSeconds,
    bins: stats.bins.map((bin) => bin.count),
  };
}

function categoryCounts(result: CanonicalAnalysisResult): readonly number[] {
  return CANONICAL_MESSAGE_CATEGORIES.map((category) => {
    const bucket = result.stage7.messageTypes.categories.find((candidate) => candidate.category === category);
    if (bucket === undefined) {
      throw new Error("EXPORT_SCHEMA_INVALID");
    }
    return bucket.count;
  });
}

export function buildRendererAggregateInput(result: CanonicalAnalysisResult): RendererAggregateInput {
  const directions = result.replySessions.replyIntervals.directions;
  const ownerToOther = directions.find((direction) => direction.direction === "owner-to-other");
  const otherToOwner = directions.find((direction) => direction.direction === "other-to-owner");
  if (ownerToOther === undefined || otherToOwner === undefined) {
    throw new Error("EXPORT_SCHEMA_INVALID");
  }
  return {
    chartKey: "trends",
    filters: { ...result.filters },
    userMessageCount: result.aggregate.userMessageCount,
    eligibleTextCount: result.aggregate.eligibleTextCount,
    senderCounts: [result.aggregate.senderCounts.owner, result.aggregate.senderCounts.other],
    chatDays: result.activity.chatActivity.totalChatDays,
    longestStreakDays: result.activity.chatActivity.longestStreakLength,
    dailyCounts: result.activity.trends.daily.map((bucket) => bucket.count),
    monthlyCounts: result.activity.trends.monthly.map((bucket) => bucket.count),
    yearlyCounts: result.activity.trends.yearly.map((bucket) => bucket.count),
    hourCounts: result.activity.hourActivity.buckets.map((bucket) => bucket.count),
    weekdayCounts: result.activity.weekdayActivity.buckets.map((bucket) => bucket.count),
    messageTypeCounts: categoryCounts(result),
    systemCount: result.stage7.messageTypes.systemDiagnosticCount,
    length: {
      overall: lengthStats(result.stage7.averageLength.overall),
      owner: lengthStats(result.stage7.averageLength.owner),
      other: lengthStats(result.stage7.averageLength.other),
    },
    replies: {
      overall: replyStats(result.replySessions.replyIntervals.overall),
      ownerToOther: replyStats(ownerToOther.stats),
      otherToOwner: replyStats(otherToOwner.stats),
    },
    initiatorCounts: [
      result.replySessions.conversationSessions.initiatorCounts.owner.count,
      result.replySessions.conversationSessions.initiatorCounts.other.count,
      result.replySessions.conversationSessions.initiatorCounts.unknown.count,
    ],
  };
}

/** Synthetic category helper retained for callers that render labels. */
export function safeExportCategory(value: string): string {
  return CANONICAL_MESSAGE_CATEGORIES.includes(value as (typeof CANONICAL_MESSAGE_CATEGORIES)[number])
    ? value
    : "unknown";
}
