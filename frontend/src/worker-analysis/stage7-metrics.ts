import {
  CANONICAL_MESSAGE_CATEGORIES,
  type CanonicalMessageCategory,
} from "../canonical-v2/schema";
import type { CanonicalAnalysisFilters, CanonicalSenderFilter } from "./analytics-contract";
import type {
  EligibleTextLengthAggregate,
  SharedAggregateAccumulator,
  YearTokenAggregate,
} from "./analytics-aggregates";
import { isCalendarDate } from "./calendar";
import type { CanonicalIndex } from "./canonical-index";
import type { CanonicalActivityMetrics } from "./activity-metrics";

export const STAGE7_METRICS_SCHEMA_VERSION =
  "chat-history-analysis.stage7-metrics.v1" as const;

export const STAGE7_DEFINITION_VERSIONS = {
  wordEvolution: "chat-history-analysis.metric.words.yearly.v1",
  averageLength: "chat-history-analysis.metric.length.code-point.v1",
  yearlyKeywords: "chat-history-analysis.metric.keywords.log-odds.v1",
  summary: "chat-history-analysis.metric.summary.traceable.v1",
  messageTypes: "chat-history-analysis.metric.types.v1",
} as const;

export const MAX_STAGE7_WORDS = 20;
export const MAX_STAGE7_KEYWORDS = 20;
export const KEYWORD_MIN_COUNT = 5;
export const KEYWORD_MIN_DISTINCT_MESSAGES = 3;

const PROHIBITED_SUMMARY_LANGUAGE_PATTERN =
  /sentiment|relationship|psychological|quality|affection|care|commitment|compatibility|mental\s+health|personality|conflict|neglect|initiative|emotion|关系|情感|心理|关怀|承诺|兼容性|性格|冲突|忽视/iu;

export type Stage7DefinitionVersions = typeof STAGE7_DEFINITION_VERSIONS;

export interface Stage7LengthStats {
  readonly count: number;
  readonly sum: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
}

export interface Stage7WordCell {
  readonly token: string;
  readonly count: number;
  readonly ratePer10000: number;
}

export interface Stage7WordYear {
  readonly year: number;
  readonly partial: boolean;
  readonly totalTokenCount: number;
  readonly values: readonly Stage7WordCell[];
}

export interface Stage7WordEvolution {
  readonly schemaVersion: typeof STAGE7_METRICS_SCHEMA_VERSION;
  readonly definitionVersion: typeof STAGE7_DEFINITION_VERSIONS.wordEvolution;
  readonly sender: CanonicalSenderFilter;
  readonly vocabulary: readonly string[];
  readonly years: readonly Stage7WordYear[];
}

export interface Stage7AverageLength {
  readonly schemaVersion: typeof STAGE7_METRICS_SCHEMA_VERSION;
  readonly definitionVersion: typeof STAGE7_DEFINITION_VERSIONS.averageLength;
  readonly sender: CanonicalSenderFilter;
  readonly overall: Stage7LengthStats;
  readonly owner: Stage7LengthStats;
  readonly other: Stage7LengthStats;
}

export interface Stage7KeywordEntry {
  readonly token: string;
  readonly count: number;
  readonly yearTokenTotal: number;
  readonly restCount: number;
  readonly restTokenTotal: number;
  readonly distinctMessageFrequency: number;
  readonly score: number | null;
}

export type Stage7KeywordMode =
  | "log-odds"
  | "frequency-fallback"
  | "insufficient-evidence";

export interface Stage7KeywordYear {
  readonly year: number;
  readonly partial: boolean;
  readonly mode: Stage7KeywordMode;
  readonly omissionReason: string | null;
  readonly minCount: typeof KEYWORD_MIN_COUNT;
  readonly minDistinctMessages: typeof KEYWORD_MIN_DISTINCT_MESSAGES;
  readonly maxResults: typeof MAX_STAGE7_KEYWORDS;
  readonly keywords: readonly Stage7KeywordEntry[];
}

export interface Stage7YearlyKeywords {
  readonly schemaVersion: typeof STAGE7_METRICS_SCHEMA_VERSION;
  readonly definitionVersion: typeof STAGE7_DEFINITION_VERSIONS.yearlyKeywords;
  readonly sender: CanonicalSenderFilter;
  readonly activeYear: number | null;
  readonly selection: "explicit" | "latest-represented" | "none";
  readonly years: readonly Stage7KeywordYear[];
}

export interface Stage7MessageTypeBucket {
  readonly category: CanonicalMessageCategory;
  readonly count: number;
  readonly share: number | null;
}

export interface Stage7MessageTypes {
  readonly schemaVersion: typeof STAGE7_METRICS_SCHEMA_VERSION;
  readonly definitionVersion: typeof STAGE7_DEFINITION_VERSIONS.messageTypes;
  readonly sender: CanonicalSenderFilter;
  readonly denominator: number;
  readonly eligibleTextCount: number;
  readonly systemDiagnosticCount: number;
  readonly categories: readonly Stage7MessageTypeBucket[];
}

export interface Stage7MetricTrace {
  readonly metricId: string;
  readonly definitionVersion: string;
  readonly filters: CanonicalAnalysisFilters;
  readonly values: Readonly<Record<string, number | string | null>>;
}

export interface Stage7SummaryClause {
  readonly id: string;
  readonly text: string;
  readonly trace: Stage7MetricTrace;
}

export interface Stage7SummaryOmission {
  readonly metricId: string;
  readonly reason: string;
  readonly definitionVersion: string;
}

export interface Stage7YearlySummary {
  readonly schemaVersion: typeof STAGE7_METRICS_SCHEMA_VERSION;
  readonly definitionVersion: typeof STAGE7_DEFINITION_VERSIONS.summary;
  readonly activeYear: number | null;
  readonly clauses: readonly Stage7SummaryClause[];
  readonly omissions: readonly Stage7SummaryOmission[];
}

export interface Stage7Metrics {
  readonly schemaVersion: typeof STAGE7_METRICS_SCHEMA_VERSION;
  readonly filters: CanonicalAnalysisFilters;
  readonly definitionVersions: Stage7DefinitionVersions;
  readonly wordEvolution: Stage7WordEvolution;
  readonly averageLength: Stage7AverageLength;
  readonly yearlyKeywords: Stage7YearlyKeywords;
  readonly summary: Stage7YearlySummary;
  readonly messageTypes: Stage7MessageTypes;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((value) => value.codePointAt(0) ?? 0);
  const rightPoints = [...right].map((value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index] ?? 0;
    const rightPoint = rightPoints[index] ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function share(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function isPartialYear(year: number, filters: CanonicalAnalysisFilters): boolean {
  const startYear = Number(filters.startDate.slice(0, 4));
  const endYear = Number(filters.endDate.slice(0, 4));
  return (
    (year === startYear && filters.startDate.slice(5) !== "01-01") ||
    (year === endYear && filters.endDate.slice(5) !== "12-31")
  );
}

function emptyYear(year: number): YearTokenAggregate {
  return {
    year,
    messageCount: 0,
    tokenTotal: 0,
    tokenCounts: new Map(),
    messageFrequencies: new Map(),
  };
}

function collectSelectedEvidence(
  shared: SharedAggregateAccumulator,
): {
  readonly years: readonly YearTokenAggregate[];
  readonly lengths: EligibleTextLengthAggregate;
} {
  return {
    years: [...shared.yearlyTokenEvidence.values()].sort(
      (left, right) => left.year - right.year,
    ),
    lengths: shared.eligibleTextLengths,
  };
}

function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * ordered.length));
  return ordered[rank - 1] ?? null;
}

function lengthStats(values: readonly number[]): Stage7LengthStats {
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    sum,
    mean: values.length === 0 ? null : sum / values.length,
    median: nearestRank(values, 0.5),
    p90: nearestRank(values, 0.9),
  };
}

function buildAverageLength(
  filters: CanonicalAnalysisFilters,
  lengths: EligibleTextLengthAggregate,
): Stage7AverageLength {
  return {
    schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
    definitionVersion: STAGE7_DEFINITION_VERSIONS.averageLength,
    sender: filters.sender,
    overall: lengthStats(lengths.overall),
    owner: lengthStats(lengths.owner),
    other: lengthStats(lengths.other),
  };
}

async function buildWordEvolution(
  filters: CanonicalAnalysisFilters,
  years: readonly YearTokenAggregate[],
  tokenTable: readonly string[],
  checkpoint: () => Promise<void>,
): Promise<Stage7WordEvolution> {
  const totals = new Map<number, number>();
  let inspected = 0;
  for (const year of years) {
    for (const [tokenId, count] of year.tokenCounts) {
      totals.set(tokenId, (totals.get(tokenId) ?? 0) + count);
      inspected += 1;
      if (inspected % 4_096 === 0) {
        await checkpoint();
      }
    }
  }
  const vocabulary = [...totals.entries()]
    .sort((left, right) => {
      const countOrder = right[1] - left[1];
      if (countOrder !== 0) {
        return countOrder;
      }
      return compareCodePoints(tokenTable[left[0]] ?? "", tokenTable[right[0]] ?? "");
    })
    .slice(0, MAX_STAGE7_WORDS)
    .map(([tokenId]) => tokenTable[tokenId] ?? "")
    .filter((token) => token !== "");
  const vocabularyIds = vocabulary.map((token) => tokenTable.indexOf(token));
  await checkpoint();
  return {
    schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
    definitionVersion: STAGE7_DEFINITION_VERSIONS.wordEvolution,
    sender: filters.sender,
    vocabulary,
    years: years.map((year) => ({
      year: year.year,
      partial: isPartialYear(year.year, filters),
      totalTokenCount: year.tokenTotal,
      values: vocabularyIds.map((tokenId, index) => {
        const token = vocabulary[index] ?? "";
        const count = year.tokenCounts.get(tokenId) ?? 0;
        return {
          token,
          count,
          ratePer10000: year.tokenTotal === 0 ? 0 : (count * 10_000) / year.tokenTotal,
        };
      }),
    })),
  };
}

async function buildKeywordsForYear(
  year: YearTokenAggregate,
  tokenTable: readonly string[],
  filters: CanonicalAnalysisFilters,
  globalTokenCounts: ReadonlyMap<number, number>,
  globalTokenTotal: number,
  representedYearCount: number,
  checkpoint: () => Promise<void>,
): Promise<Stage7KeywordYear> {
  const restTokenTotal = globalTokenTotal - year.tokenTotal;
  const candidates: number[] = [];
  let inspected = 0;
  for (const [tokenId, count] of year.tokenCounts) {
    if (
      count >= KEYWORD_MIN_COUNT &&
      (year.messageFrequencies.get(tokenId) ?? 0) >= KEYWORD_MIN_DISTINCT_MESSAGES
    ) {
      candidates.push(tokenId);
    }
    inspected += 1;
    if (inspected % 4_096 === 0) {
      await checkpoint();
    }
  }
  const fallback = representedYearCount < 2;
  if (candidates.length === 0) {
    return {
      year: year.year,
      partial: isPartialYear(year.year, filters),
      mode: "insufficient-evidence",
      omissionReason: year.tokenTotal === 0 ? "NO_ELIGIBLE_TOKENS" : "NO_CANDIDATE_TOKENS",
      minCount: KEYWORD_MIN_COUNT,
      minDistinctMessages: KEYWORD_MIN_DISTINCT_MESSAGES,
      maxResults: MAX_STAGE7_KEYWORDS,
      keywords: [],
    };
  }
  const keywords = candidates.map((tokenId) => {
    const count = year.tokenCounts.get(tokenId) ?? 0;
    const restCount = (globalTokenCounts.get(tokenId) ?? 0) - count;
    let score: number | null = null;
    if (!fallback) {
      score =
        Math.log((count + 0.5) / (year.tokenTotal - count + 0.5)) -
        Math.log((restCount + 0.5) / (restTokenTotal - restCount + 0.5));
    }
    return {
      token: tokenTable[tokenId] ?? "",
      count,
      yearTokenTotal: year.tokenTotal,
      restCount,
      restTokenTotal,
      distinctMessageFrequency: year.messageFrequencies.get(tokenId) ?? 0,
      score,
    };
  }).filter((entry) => entry.token !== "");
  await checkpoint();
  const ranked = keywords
    .filter((entry) => fallback || (entry.score !== null && entry.score > 0))
    .sort((left, right) => {
      if (!fallback) {
        const scoreOrder = (right.score ?? 0) - (left.score ?? 0);
        if (scoreOrder !== 0) {
          return scoreOrder;
        }
      }
      return right.count - left.count || compareCodePoints(left.token, right.token);
    })
    .slice(0, MAX_STAGE7_KEYWORDS);
  return {
    year: year.year,
    partial: isPartialYear(year.year, filters),
    mode: fallback ? "frequency-fallback" : "log-odds",
    omissionReason: ranked.length === 0 ? "NO_POSITIVE_CANDIDATE" : null,
    minCount: KEYWORD_MIN_COUNT,
    minDistinctMessages: KEYWORD_MIN_DISTINCT_MESSAGES,
    maxResults: MAX_STAGE7_KEYWORDS,
    keywords: ranked,
  };
}

async function buildYearlyKeywords(
  filters: CanonicalAnalysisFilters,
  years: readonly YearTokenAggregate[],
  tokenTable: readonly string[],
  checkpoint: () => Promise<void>,
): Promise<Stage7YearlyKeywords> {
  const activeYear =
    filters.selectedYear ?? years.at(-1)?.year ?? null;
  const activeExists = activeYear !== null && years.some((year) => year.year === activeYear);
  const keywordYears = [...years];
  if (activeYear !== null && !activeExists) {
    keywordYears.push(emptyYear(activeYear));
    keywordYears.sort((left, right) => left.year - right.year);
  }
  const globalTokenCounts = new Map<number, number>();
  let globalTokenTotal = 0;
  let representedYearCount = 0;
  for (const year of keywordYears) {
    globalTokenTotal += year.tokenTotal;
    if (year.tokenTotal > 0) {
      representedYearCount += 1;
    }
    for (const [tokenId, count] of year.tokenCounts) {
      globalTokenCounts.set(tokenId, (globalTokenCounts.get(tokenId) ?? 0) + count);
    }
  }
  const keywordResults: Stage7KeywordYear[] = [];
  for (const year of keywordYears) {
    keywordResults.push(
      await buildKeywordsForYear(
        year,
        tokenTable,
        filters,
        globalTokenCounts,
        globalTokenTotal,
        representedYearCount,
        checkpoint,
      ),
    );
    await checkpoint();
  }
  return {
    schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
    definitionVersion: STAGE7_DEFINITION_VERSIONS.yearlyKeywords,
    sender: filters.sender,
    activeYear,
    selection: filters.selectedYear === null
      ? activeYear === null ? "none" : "latest-represented"
      : "explicit",
    years: keywordResults,
  };
}

function buildMessageTypes(
  filters: CanonicalAnalysisFilters,
  shared: SharedAggregateAccumulator,
): Stage7MessageTypes {
  return {
    schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
    definitionVersion: STAGE7_DEFINITION_VERSIONS.messageTypes,
    sender: filters.sender,
    denominator: shared.userMessageCount,
    eligibleTextCount: shared.eligibleTextCount,
    systemDiagnosticCount: shared.systemEventCount,
    categories: CANONICAL_MESSAGE_CATEGORIES.map((category) => {
      const count = shared.messageCategoryCounts[category];
      return {
        category,
        count,
        share: share(count, shared.userMessageCount),
      };
    }),
  };
}

function trace(
  metricId: string,
  definitionVersion: string,
  filters: CanonicalAnalysisFilters,
  values: Readonly<Record<string, number | string | null>>,
): Stage7MetricTrace {
  return { metricId, definitionVersion, filters, values };
}

function formatShare(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function buildSummary(
  filters: CanonicalAnalysisFilters,
  activity: CanonicalActivityMetrics,
  messageTypes: Stage7MessageTypes,
  yearlyKeywords: Stage7YearlyKeywords,
): Stage7YearlySummary {
  const clauses: Stage7SummaryClause[] = [];
  const omissions: Stage7SummaryOmission[] = [];
  const add = (id: string, text: string, metric: Stage7MetricTrace): void => {
    clauses.push({ id, text, trace: metric });
  };
  add(
    "user-message-total",
    `用户消息总数：${messageTypes.denominator}`,
    trace("user-message-total", STAGE7_DEFINITION_VERSIONS.messageTypes, filters, {
      count: messageTypes.denominator,
    }),
  );
  add(
    "sender-comparison",
    `发送方计数：owner ${activity.senderComparison.owner.count}（${formatShare(activity.senderComparison.owner.share)}），other ${activity.senderComparison.other.count}（${formatShare(activity.senderComparison.other.share)}）`,
    trace("sender-comparison", "chat-history-analysis.activity-metrics.v1", filters, {
      ownerCount: activity.senderComparison.owner.count,
      otherCount: activity.senderComparison.other.count,
      denominator: activity.senderComparison.denominator,
    }),
  );
  add(
    "chat-days",
    `聊天日期：${activity.chatActivity.totalChatDays} 天；最长连续：${activity.chatActivity.longestStreakLength} 天`,
    trace("chat-days", "chat-history-analysis.activity-metrics.v1", filters, {
      totalChatDays: activity.chatActivity.totalChatDays,
      longestStreakLength: activity.chatActivity.longestStreakLength,
    }),
  );
  if (messageTypes.denominator > 0) {
    const monthly = activity.trends.monthly;
    const peakMonthCount = Math.max(...monthly.map((bucket) => bucket.count));
    const peakMonths = monthly
      .filter((bucket) => bucket.count === peakMonthCount)
      .map((bucket) => bucket.key);
    add(
      "peak-month",
      `高峰月份：${peakMonths.join("、")}（${peakMonthCount} 条）`,
      trace("peak-month", "chat-history-analysis.activity-metrics.v1", filters, {
        labels: peakMonths.join(","),
        count: peakMonthCount,
      }),
    );
    const peakHourCount = Math.max(...activity.hourActivity.buckets.map((bucket) => bucket.count));
    const peakHours = activity.hourActivity.buckets
      .filter((bucket) => bucket.count === peakHourCount)
      .map((bucket) => String(bucket.hour).padStart(2, "0"));
    add(
      "peak-hour",
      `高峰小时：${peakHours.join("、")}（${peakHourCount} 条）`,
      trace("peak-hour", "chat-history-analysis.activity-metrics.v1", filters, {
        labels: peakHours.join(","),
        count: peakHourCount,
      }),
    );
    const topTypes = messageTypes.categories
      .filter((bucket) => bucket.count > 0)
      .slice()
      .sort((left, right) => right.count - left.count || CANONICAL_MESSAGE_CATEGORIES.indexOf(left.category) - CANONICAL_MESSAGE_CATEGORIES.indexOf(right.category))
      .slice(0, 3);
    if (topTypes.length > 0) {
      add(
        "message-types",
        `消息类型：${topTypes.map((bucket) => `${bucket.category} ${bucket.count}`).join("、")}`,
        trace("message-types", STAGE7_DEFINITION_VERSIONS.messageTypes, filters, {
          labels: topTypes.map((bucket) => bucket.category).join(","),
          counts: topTypes.map((bucket) => String(bucket.count)).join(","),
        }),
      );
    } else {
      omissions.push({
        metricId: "message-types",
        reason: "EMPTY_USER_MESSAGE_SCOPE",
        definitionVersion: STAGE7_DEFINITION_VERSIONS.messageTypes,
      });
    }
  } else {
    omissions.push(
      {
        metricId: "peak-month",
        reason: "EMPTY_USER_MESSAGE_SCOPE",
        definitionVersion: "chat-history-analysis.activity-metrics.v1",
      },
      {
        metricId: "peak-hour",
        reason: "EMPTY_USER_MESSAGE_SCOPE",
        definitionVersion: "chat-history-analysis.activity-metrics.v1",
      },
      {
        metricId: "message-types",
        reason: "EMPTY_USER_MESSAGE_SCOPE",
        definitionVersion: STAGE7_DEFINITION_VERSIONS.messageTypes,
      },
    );
  }
  const activeKeywords = yearlyKeywords.years.find(
    (year) => year.year === yearlyKeywords.activeYear,
  );
  if (activeKeywords !== undefined && activeKeywords.keywords.length > 0) {
    const words = activeKeywords.keywords.slice(0, 3).map((keyword) => keyword.token);
    add(
      "yearly-keywords",
      `${activeKeywords.year} 年关键词：${words.join("、")}${activeKeywords.mode === "frequency-fallback" ? "（频率回退）" : ""}`,
      trace("yearly-keywords", STAGE7_DEFINITION_VERSIONS.yearlyKeywords, filters, {
        year: activeKeywords.year,
        mode: activeKeywords.mode,
        keywordCount: activeKeywords.keywords.length,
      }),
    );
  } else {
    omissions.push({
      metricId: "yearly-keywords",
      reason: activeKeywords?.omissionReason ?? "YEAR_NOT_SELECTED",
      definitionVersion: STAGE7_DEFINITION_VERSIONS.yearlyKeywords,
    });
  }
  omissions.push(
    {
      metricId: "reply-interval",
      reason: "DEFERRED_TO_STAGE_8",
      definitionVersion: "deferred",
    },
    {
      metricId: "session-initiator",
      reason: "DEFERRED_TO_STAGE_8",
      definitionVersion: "deferred",
    },
  );
  return {
    schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
    definitionVersion: STAGE7_DEFINITION_VERSIONS.summary,
    activeYear: yearlyKeywords.activeYear,
    clauses,
    omissions,
  };
}

export async function deriveStage7Metrics(
  index: CanonicalIndex,
  shared: SharedAggregateAccumulator,
  activity: CanonicalActivityMetrics,
  filters: CanonicalAnalysisFilters,
  checkpoint: () => Promise<void>,
): Promise<Stage7Metrics> {
  const evidence = collectSelectedEvidence(shared);
  await checkpoint();
  const averageLength = buildAverageLength(filters, evidence.lengths);
  await checkpoint();
  const wordEvolution = await buildWordEvolution(
    filters,
    evidence.years,
    index.tokenTable,
    checkpoint,
  );
  await checkpoint();
  const yearlyKeywords = await buildYearlyKeywords(
    filters,
    evidence.years,
    index.tokenTable,
    checkpoint,
  );
  await checkpoint();
  const messageTypes = buildMessageTypes(filters, shared);
  const summary = buildSummary(filters, activity, messageTypes, yearlyKeywords);
  await checkpoint();
  return {
    schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
    filters,
    definitionVersions: STAGE7_DEFINITION_VERSIONS,
    wordEvolution,
    averageLength,
    yearlyKeywords,
    summary,
    messageTypes,
  };
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sameFilters(left: unknown, right: CanonicalAnalysisFilters): boolean {
  if (left === null || typeof left !== "object" || Array.isArray(left)) {
    return false;
  }
  const value = left as Record<string, unknown>;
  return (
    exactKeys(value, ["endDate", "selectedYear", "sender", "sessionThresholdHours", "startDate"]) &&
    value.startDate === right.startDate &&
    value.endDate === right.endDate &&
    value.sender === right.sender &&
    value.selectedYear === right.selectedYear &&
    value.sessionThresholdHours === right.sessionThresholdHours
  );
}

function validateLengthStats(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const stats = value as Record<string, unknown>;
  if (
    !exactKeys(stats, ["count", "sum", "mean", "median", "p90"]) ||
    !safeInteger(stats.count) ||
    !safeInteger(stats.sum) ||
    !["mean", "median", "p90"].every((key) => stats[key] === null || finiteNonNegative(stats[key]))
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  if (stats.count === 0 && (stats.sum !== 0 || stats.mean !== null || stats.median !== null || stats.p90 !== null)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  if (stats.count > 0) {
    if (stats.mean !== (stats.sum as number) / (stats.count as number)) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    for (const key of ["median", "p90"] as const) {
      const percentile = stats[key];
      if (percentile !== null && !safeInteger(percentile)) {
        throw new Error("INVALID_STAGE7_RESULT");
      }
    }
  }
}

function validateWordEvolution(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const metric = value as Record<string, unknown>;
  if (
    !exactKeys(metric, ["definitionVersion", "schemaVersion", "sender", "vocabulary", "years"]) ||
    metric.schemaVersion !== STAGE7_METRICS_SCHEMA_VERSION ||
    metric.definitionVersion !== STAGE7_DEFINITION_VERSIONS.wordEvolution ||
    !["both", "owner", "other"].includes(metric.sender as string) ||
    !Array.isArray(metric.vocabulary) ||
    metric.vocabulary.length > MAX_STAGE7_WORDS ||
    !metric.vocabulary.every((token) => typeof token === "string" && token !== "" && !token.includes("\0")) ||
    !Array.isArray(metric.years) ||
    metric.years.length > 9_999
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const vocabulary = metric.vocabulary as readonly unknown[];
  const vocabularyTokens = vocabulary as readonly string[];
  const vocabularyTotals = vocabularyTokens.map(() => 0);
  for (let index = 1; index < vocabularyTokens.length; index += 1) {
    if (vocabularyTokens[index - 1] === vocabularyTokens[index]) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
  }
  let previousYear = 0;
  for (const yearValue of metric.years) {
    if (yearValue === null || typeof yearValue !== "object" || Array.isArray(yearValue)) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    const year = yearValue as Record<string, unknown>;
    if (
      !exactKeys(year, ["partial", "totalTokenCount", "values", "year"]) ||
      !safeInteger(year.year) ||
      (year.year as number) < 1 ||
      (year.year as number) > 9_999 ||
      (previousYear !== 0 && year.year <= previousYear) ||
      typeof year.partial !== "boolean" ||
      !safeInteger(year.totalTokenCount) ||
      !Array.isArray(year.values) ||
      year.values.length !== vocabulary.length
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    previousYear = year.year as number;
    year.values.forEach((cellValue, index) => {
      if (cellValue === null || typeof cellValue !== "object" || Array.isArray(cellValue)) {
        throw new Error("INVALID_STAGE7_RESULT");
      }
      const cell = cellValue as Record<string, unknown>;
      if (
        !exactKeys(cell, ["count", "ratePer10000", "token"]) ||
        cell.token !== vocabularyTokens[index] ||
        !safeInteger(cell.count) ||
        !finiteNonNegative(cell.ratePer10000) ||
        (cell.count as number) > (year.totalTokenCount as number) ||
        cell.ratePer10000 !== ((year.totalTokenCount as number) === 0
          ? 0
          : ((cell.count as number) * 10_000) / (year.totalTokenCount as number))
      ) {
        throw new Error("INVALID_STAGE7_RESULT");
      }
      vocabularyTotals[index] += cell.count as number;
    });
  }
  for (let index = 1; index < vocabularyTokens.length; index += 1) {
    const previousTotal = vocabularyTotals[index - 1] ?? 0;
    const currentTotal = vocabularyTotals[index] ?? 0;
    if (
      previousTotal < currentTotal ||
      (previousTotal === currentTotal &&
        compareCodePoints(vocabularyTokens[index - 1] ?? "", vocabularyTokens[index] ?? "") > 0)
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
  }
}

function validateKeywords(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const metric = value as Record<string, unknown>;
  if (
    !exactKeys(metric, ["activeYear", "definitionVersion", "schemaVersion", "selection", "sender", "years"]) ||
    metric.schemaVersion !== STAGE7_METRICS_SCHEMA_VERSION ||
    metric.definitionVersion !== STAGE7_DEFINITION_VERSIONS.yearlyKeywords ||
    !["both", "owner", "other"].includes(metric.sender as string) ||
    !["explicit", "latest-represented", "none"].includes(metric.selection as string) ||
    (metric.activeYear !== null &&
      (!safeInteger(metric.activeYear) || metric.activeYear < 1 || metric.activeYear > 9_999)) ||
    !Array.isArray(metric.years) ||
    metric.years.length > 9_999
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  if (
    (metric.selection === "none" && metric.activeYear !== null) ||
    (metric.selection !== "none" && metric.activeYear === null)
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  let previousYear = 0;
  let hasActiveYear = false;
  for (const yearValue of metric.years) {
    if (yearValue === null || typeof yearValue !== "object" || Array.isArray(yearValue)) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    const year = yearValue as Record<string, unknown>;
    if (
      !exactKeys(year, ["keywords", "maxResults", "minCount", "minDistinctMessages", "mode", "omissionReason", "partial", "year"]) ||
      !safeInteger(year.year) ||
      (year.year as number) < 1 ||
      (year.year as number) > 9_999 ||
      (previousYear !== 0 && year.year <= previousYear) ||
      typeof year.partial !== "boolean" ||
      !["log-odds", "frequency-fallback", "insufficient-evidence"].includes(year.mode as string) ||
      (year.omissionReason !== null && typeof year.omissionReason !== "string") ||
      year.minCount !== KEYWORD_MIN_COUNT ||
      year.minDistinctMessages !== KEYWORD_MIN_DISTINCT_MESSAGES ||
      year.maxResults !== MAX_STAGE7_KEYWORDS ||
      !Array.isArray(year.keywords) ||
      year.keywords.length > MAX_STAGE7_KEYWORDS
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    previousYear = year.year as number;
    hasActiveYear ||= year.year === metric.activeYear;
    if (
      (year.mode === "insufficient-evidence" &&
        (year.keywords.length !== 0 || year.omissionReason === null)) ||
      (year.keywords.length === 0 && year.omissionReason === null) ||
      (year.keywords.length > 0 && year.omissionReason !== null)
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    let previousEntry: Record<string, unknown> | undefined;
    for (const entryValue of year.keywords) {
      if (entryValue === null || typeof entryValue !== "object" || Array.isArray(entryValue)) {
        throw new Error("INVALID_STAGE7_RESULT");
      }
      const entry = entryValue as Record<string, unknown>;
      if (
        !exactKeys(entry, ["count", "distinctMessageFrequency", "restCount", "restTokenTotal", "score", "token", "yearTokenTotal"]) ||
        typeof entry.token !== "string" ||
        entry.token === "" ||
        (previousEntry !== undefined && entry.token === previousEntry.token) ||
        !safeInteger(entry.count) ||
        !safeInteger(entry.distinctMessageFrequency) ||
        !safeInteger(entry.restCount) ||
        !safeInteger(entry.restTokenTotal) ||
        !safeInteger(entry.yearTokenTotal) ||
        (entry.score !== null && !Number.isFinite(entry.score)) ||
        (entry.count as number) < KEYWORD_MIN_COUNT ||
        (entry.distinctMessageFrequency as number) < KEYWORD_MIN_DISTINCT_MESSAGES ||
        (entry.distinctMessageFrequency as number) > (entry.count as number) ||
        (entry.count as number) > (entry.yearTokenTotal as number) ||
        (entry.restCount as number) > (entry.restTokenTotal as number)
      ) {
        throw new Error("INVALID_STAGE7_RESULT");
      }
      if (year.mode === "frequency-fallback") {
        if (entry.score !== null) {
          throw new Error("INVALID_STAGE7_RESULT");
        }
        if (
          previousEntry !== undefined &&
          ((previousEntry.count as number) < (entry.count as number) ||
            (previousEntry.count === entry.count &&
              compareCodePoints(previousEntry.token as string, entry.token as string) > 0))
        ) {
          throw new Error("INVALID_STAGE7_RESULT");
        }
      } else if (year.mode === "log-odds") {
        if (typeof entry.score !== "number" || !Number.isFinite(entry.score) || entry.score <= 0) {
          throw new Error("INVALID_STAGE7_RESULT");
        }
        if (
          previousEntry !== undefined &&
          ((previousEntry.score as number) < (entry.score as number) ||
            (previousEntry.score === entry.score &&
              ((previousEntry.count as number) < (entry.count as number) ||
                (previousEntry.count === entry.count &&
                  compareCodePoints(previousEntry.token as string, entry.token as string) > 0))))
        ) {
          throw new Error("INVALID_STAGE7_RESULT");
        }
      }
      previousEntry = entry;
    }
  }
  if (metric.activeYear !== null && !hasActiveYear) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
}

function filterShape(value: unknown): value is CanonicalAnalysisFilters {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const filters = value as Record<string, unknown>;
  return (
    exactKeys(filters, ["endDate", "selectedYear", "sender", "sessionThresholdHours", "startDate"]) &&
    typeof filters.startDate === "string" &&
    typeof filters.endDate === "string" &&
    isCalendarDate(filters.startDate) &&
    isCalendarDate(filters.endDate) &&
    filters.startDate <= filters.endDate &&
    ["both", "owner", "other"].includes(filters.sender as string) &&
    (filters.selectedYear === null || (safeInteger(filters.selectedYear) && filters.selectedYear >= 1 && filters.selectedYear <= 9_999)) &&
    [1, 3, 6, 12, 24].includes(filters.sessionThresholdHours as number)
  );
}

function validateSummary(
  value: unknown,
  expectedFilters?: CanonicalAnalysisFilters,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const summary = value as Record<string, unknown>;
  if (
    !exactKeys(summary, ["activeYear", "clauses", "definitionVersion", "omissions", "schemaVersion"]) ||
    summary.schemaVersion !== STAGE7_METRICS_SCHEMA_VERSION ||
    summary.definitionVersion !== STAGE7_DEFINITION_VERSIONS.summary ||
    (summary.activeYear !== null &&
      (!safeInteger(summary.activeYear) || summary.activeYear < 1 || summary.activeYear > 9_999)) ||
    !Array.isArray(summary.clauses) ||
    summary.clauses.length > 16 ||
    !Array.isArray(summary.omissions) ||
    summary.omissions.length > 16
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const summaryOrder = [
    "user-message-total",
    "sender-comparison",
    "chat-days",
    "peak-month",
    "peak-hour",
    "message-types",
    "yearly-keywords",
  ];
  const seenClauseIds = new Set<string>();
  let previousClauseOrder = -1;
  for (const clauseValue of summary.clauses) {
    if (clauseValue === null || typeof clauseValue !== "object" || Array.isArray(clauseValue)) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    const clause = clauseValue as Record<string, unknown>;
    if (
      !exactKeys(clause, ["id", "text", "trace"]) ||
      typeof clause.id !== "string" ||
      typeof clause.text !== "string" ||
      clause.text === "" ||
      clause.text.includes("\0") ||
      PROHIBITED_SUMMARY_LANGUAGE_PATTERN.test(clause.text) ||
      clause.trace === null ||
      typeof clause.trace !== "object" ||
      Array.isArray(clause.trace)
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    const clauseOrder = summaryOrder.indexOf(clause.id);
    if (clauseOrder < 0 || seenClauseIds.has(clause.id) || clauseOrder < previousClauseOrder) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    seenClauseIds.add(clause.id);
    previousClauseOrder = clauseOrder;
    const trace = clause.trace as Record<string, unknown>;
    if (
      !exactKeys(trace, ["definitionVersion", "filters", "metricId", "values"]) ||
      typeof trace.metricId !== "string" ||
      typeof trace.definitionVersion !== "string" ||
      (expectedFilters === undefined
        ? !filterShape(trace.filters)
        : !sameFilters(trace.filters, expectedFilters)) ||
      trace.values === null ||
      typeof trace.values !== "object" ||
      Array.isArray(trace.values)
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    for (const value of Object.values(trace.values as Record<string, unknown>)) {
      if (value !== null && typeof value !== "string" && !finiteNonNegative(value)) {
        throw new Error("INVALID_STAGE7_RESULT");
      }
    }
  }
  for (const omissionValue of summary.omissions) {
    if (omissionValue === null || typeof omissionValue !== "object" || Array.isArray(omissionValue)) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    const omission = omissionValue as Record<string, unknown>;
    if (
      !exactKeys(omission, ["definitionVersion", "metricId", "reason"]) ||
      typeof omission.metricId !== "string" ||
      typeof omission.reason !== "string" ||
      typeof omission.definitionVersion !== "string"
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
  }
}

function validateMessageTypes(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const metric = value as Record<string, unknown>;
  if (
    !exactKeys(metric, ["categories", "definitionVersion", "denominator", "eligibleTextCount", "schemaVersion", "sender", "systemDiagnosticCount"]) ||
    metric.schemaVersion !== STAGE7_METRICS_SCHEMA_VERSION ||
    metric.definitionVersion !== STAGE7_DEFINITION_VERSIONS.messageTypes ||
    !["both", "owner", "other"].includes(metric.sender as string) ||
    !safeInteger(metric.denominator) ||
    !safeInteger(metric.eligibleTextCount) ||
    !safeInteger(metric.systemDiagnosticCount) ||
    !Array.isArray(metric.categories) ||
    metric.categories.length !== CANONICAL_MESSAGE_CATEGORIES.length
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  let total = 0;
  metric.categories.forEach((bucketValue, index) => {
    if (bucketValue === null || typeof bucketValue !== "object" || Array.isArray(bucketValue)) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    const bucket = bucketValue as Record<string, unknown>;
    if (
      !exactKeys(bucket, ["category", "count", "share"]) ||
      bucket.category !== CANONICAL_MESSAGE_CATEGORIES[index] ||
      !safeInteger(bucket.count) ||
      (bucket.share !== null && !Number.isFinite(bucket.share)) ||
      bucket.share !== share(bucket.count, metric.denominator as number)
    ) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    total += bucket.count as number;
  });
  const textBucket = (metric.categories as readonly Record<string, unknown>[]).find(
    (bucket) => bucket.category === "text",
  );
  if (
    total !== metric.denominator ||
    metric.eligibleTextCount > metric.denominator ||
    textBucket === undefined ||
    (metric.eligibleTextCount as number) > (textBucket.count as number)
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
}

export function validateStage7Metrics(
  value: unknown,
  expectedFilters?: CanonicalAnalysisFilters,
): Stage7Metrics {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const metric = value as Record<string, unknown>;
  if (
    !exactKeys(metric, ["averageLength", "definitionVersions", "filters", "messageTypes", "schemaVersion", "summary", "wordEvolution", "yearlyKeywords"]) ||
    metric.schemaVersion !== STAGE7_METRICS_SCHEMA_VERSION ||
    !filterShape(metric.filters) ||
    (expectedFilters !== undefined && !sameFilters(metric.filters, expectedFilters)) ||
    metric.definitionVersions === null ||
    typeof metric.definitionVersions !== "object" ||
    Array.isArray(metric.definitionVersions) ||
    !exactKeys(metric.definitionVersions as Record<string, unknown>, Object.keys(STAGE7_DEFINITION_VERSIONS)) ||
    Object.entries(STAGE7_DEFINITION_VERSIONS).some(([key, version]) => (metric.definitionVersions as Record<string, unknown>)[key] !== version)
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  validateWordEvolution(metric.wordEvolution);
  if (metric.averageLength === null || typeof metric.averageLength !== "object" || Array.isArray(metric.averageLength)) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  const lengthMetric = metric.averageLength as Record<string, unknown>;
  if (
    !exactKeys(lengthMetric, ["definitionVersion", "other", "overall", "owner", "schemaVersion", "sender"]) ||
    lengthMetric.schemaVersion !== STAGE7_METRICS_SCHEMA_VERSION ||
    lengthMetric.definitionVersion !== STAGE7_DEFINITION_VERSIONS.averageLength ||
    !["both", "owner", "other"].includes(lengthMetric.sender as string)
  ) {
    throw new Error("INVALID_STAGE7_RESULT");
  }
  validateLengthStats(lengthMetric.overall);
  validateLengthStats(lengthMetric.owner);
  validateLengthStats(lengthMetric.other);
  validateKeywords(metric.yearlyKeywords);
  validateSummary(metric.summary, expectedFilters);
  validateMessageTypes(metric.messageTypes);
  if (expectedFilters !== undefined) {
    if (!sameFilters(metric.filters, expectedFilters)) {
      throw new Error("INVALID_STAGE7_RESULT");
    }
    const nested = [metric.wordEvolution, metric.averageLength, metric.yearlyKeywords, metric.messageTypes] as readonly unknown[];
    for (const nestedValue of nested) {
      if (nestedValue === null || typeof nestedValue !== "object" || (nestedValue as Record<string, unknown>).sender !== expectedFilters.sender) {
        throw new Error("INVALID_STAGE7_RESULT");
      }
    }
  }
  return metric as unknown as Stage7Metrics;
}
