import type { CanonicalAnalysisResult } from "../../worker-analysis/analytics-contract";
import {
  WEEKDAY_LABELS,
  type CanonicalWeekday,
} from "../../worker-analysis/activity-metrics";
import {
  type CanonicalMessageCategory,
} from "../../canonical-v2/schema";
import { calendarDayOrdinal, daysInMonth } from "../../worker-analysis/calendar";
import {
  BETA_REPORT_SECTIONS,
  type BetaReportSectionId,
} from "./report-sections";
import {
  BETA_REPORT_SCHEMA_VERSION,
  BETA_REPORT_TIMEZONE,
  betaReportQueryKey,
  createBetaReportQuery,
  validateBetaReportDtoV1,
  type BetaMethodologyFactV1,
  type BetaReportAppliedFiltersV1,
  type BetaReportCalendarScope,
  type BetaReportDtoV1,
  type BetaReportFactKey,
  type BetaReportMode,
  type BetaReportReasonCode,
  type BetaReportSectionStatus,
  type BetaReportTemplateId,
  type BetaReportValueModelV1,
  type CoreReportFactsV1,
} from "./report-contract";

export interface BetaReportAdapterOptions {
  readonly mode: BetaReportMode;
  readonly year: number | null;
  readonly frequencyDtoKey?: string | null;
  readonly wordEvidenceStatus?: "not-requested" | "ready" | "empty";
}

const WEEKDAY_LABEL_ZH: Readonly<Record<CanonicalWeekday, string>> = {
  Monday: "星期一",
  Tuesday: "星期二",
  Wednesday: "星期三",
  Thursday: "星期四",
  Friday: "星期五",
  Saturday: "星期六",
  Sunday: "星期日",
};

const MESSAGE_CATEGORY_LABEL_ZH: Readonly<Record<CanonicalMessageCategory, string>> = {
  text: "文字",
  image: "图片",
  voice: "语音",
  video: "视频",
  file: "文件",
  "animated-emoji": "动态表情",
  structured: "结构化消息",
  location: "位置",
  call: "通话",
  "mini-program": "小程序",
  reply: "回复引用",
  "contact-card": "名片",
  system: "系统",
  other: "其他",
  unknown: "未知类型",
};

function calendarYearRange(year: number): { readonly startDate: string; readonly endDate: string } {
  const value = String(year).padStart(4, "0");
  return { startDate: `${value}-01-01`, endDate: `${value}-12-31` };
}

function representedYears(result: CanonicalAnalysisResult): readonly number[] {
  return result.activity.trends.yearly
    .filter((bucket) => bucket.count > 0 && /^[0-9]{4}$/u.test(bucket.key))
    .map((bucket) => Number(bucket.key))
    .sort((left, right) => left - right);
}

function calendarScope(
  result: CanonicalAnalysisResult,
  options: BetaReportAdapterOptions,
): BetaReportCalendarScope {
  if (options.mode !== "annual" || options.year === null) {
    return "multi-year";
  }
  const range = calendarYearRange(options.year);
  return result.filters.startDate === range.startDate && result.filters.endDate === range.endDate
    ? "full-calendar-query"
    : "partial-calendar-query";
}

function nonZeroPeak<T>(
  buckets: readonly T[],
  countOf: (bucket: T) => number,
  keyOf: (bucket: T) => string | number,
): { readonly maxCount: number | null; readonly ties: readonly (string | number)[] } {
  const maxCount = buckets.reduce((current, bucket) => Math.max(current, countOf(bucket)), 0);
  if (maxCount === 0) {
    return { maxCount: null, ties: [] };
  }
  return {
    maxCount,
    ties: buckets.filter((bucket) => countOf(bucket) === maxCount).map(keyOf),
  };
}

function statusFor(
  scope: BetaReportCalendarScope,
  ready: boolean,
  emptyStatus: BetaReportSectionStatus,
): BetaReportSectionStatus {
  if (!ready) {
    return emptyStatus;
  }
  return scope === "partial-calendar-query" ? "PARTIAL" : "READY";
}

function partialReason(scope: BetaReportCalendarScope): BetaReportReasonCode | null {
  return scope === "partial-calendar-query" ? "PARTIAL_CALENDAR_SCOPE" : null;
}

function sectionValue(
  value: number | null,
  unit: BetaReportValueModelV1["unit"],
  denominator: number | null = null,
): BetaReportValueModelV1 | null {
  return { value, unit, denominator };
}

function lengthStats(value: {
  readonly count: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
}): CoreReportFactsV1["messageLength"]["overall"] {
  return {
    count: value.count,
    mean: value.mean,
    median: value.median,
    p90: value.p90,
  };
}

function replyStats(value: {
  readonly count: number;
  readonly meanSeconds: number | null;
  readonly medianSeconds: number | null;
  readonly p90Seconds: number | null;
}): CoreReportFactsV1["replyIntervals"]["overall"] {
  return {
    count: value.count,
    meanSeconds: value.meanSeconds,
    medianSeconds: value.medianSeconds,
    p90Seconds: value.p90Seconds,
  };
}

function buildFacts(result: CanonicalAnalysisResult): CoreReportFactsV1 {
  const monthPeak = nonZeroPeak(
    result.activity.trends.monthly,
    (bucket) => bucket.count,
    (bucket) => bucket.key,
  );
  const weekdayPeak = nonZeroPeak(
    result.activity.weekdayActivity.buckets,
    (bucket) => bucket.count,
    (bucket) => bucket.weekday,
  );
  const hourPeak = nonZeroPeak(
    result.activity.hourActivity.buckets,
    (bucket) => bucket.count,
    (bucket) => bucket.hour,
  );
  const averageLength = result.stage7.averageLength;
  const messageTypes = result.stage7.messageTypes;
  const sessions = result.replySessions.conversationSessions;
  const replies = result.replySessions.replyIntervals;
  const replyDirections = replies.directions.map((direction) => ({
    direction: direction.direction,
    responder: direction.responder,
    stats: replyStats(direction.stats),
  }));
  if (replyDirections.length !== 2) {
    throw new Error("BETA_REPORT_REPLY_DIRECTION_SHAPE");
  }
  return {
    totalMessages: {
      value: result.aggregate.userMessageCount,
      ownerCount: result.aggregate.senderCounts.owner,
      otherCount: result.aggregate.senderCounts.other,
      denominator: result.aggregate.userMessageCount,
    },
    activeDays: {
      value: result.activity.chatActivity.totalChatDays,
      calendarDays: betaReportCalendarDays(result.filters.startDate, result.filters.endDate),
    },
    longestStreak: {
      length: result.activity.chatActivity.longestStreakLength,
      intervals: result.activity.chatActivity.longestStreaks.map((interval) => ({ ...interval })),
    },
    peakMonth: {
      buckets: result.activity.trends.monthly.map((bucket) => ({ ...bucket })),
      maxCount: monthPeak.maxCount,
      ties: monthPeak.ties as readonly string[],
    },
    peakWeekday: {
      buckets: result.activity.weekdayActivity.buckets.map((bucket) => ({ ...bucket })),
      maxCount: weekdayPeak.maxCount,
      ties: weekdayPeak.ties as readonly CanonicalWeekday[],
    },
    peakHour: {
      buckets: result.activity.hourActivity.buckets.map((bucket) => ({ ...bucket })),
      maxCount: hourPeak.maxCount,
      ties: hourPeak.ties as readonly number[],
    },
    senderShare: {
      denominator: result.activity.senderComparison.denominator,
      owner: {
        count: result.activity.senderComparison.owner.count,
        share: result.activity.senderComparison.owner.share,
      },
      other: {
        count: result.activity.senderComparison.other.count,
        share: result.activity.senderComparison.other.share,
      },
      filterBehavior: result.activity.senderComparison.filterBehavior,
    },
    messageLength: {
      overall: lengthStats(averageLength.overall),
      owner: lengthStats(averageLength.owner),
      other: lengthStats(averageLength.other),
      definitionVersion: averageLength.definitionVersion,
    },
    messageTypes: {
      denominator: messageTypes.denominator,
      eligibleTextCount: messageTypes.eligibleTextCount,
      systemDiagnosticCount: messageTypes.systemDiagnosticCount,
      categories: messageTypes.categories.map((bucket) => ({ ...bucket })),
      definitionVersion: messageTypes.definitionVersion,
    },
    sessions: {
      thresholdHours: sessions.thresholdHours,
      sessionCount: sessions.sessionCount,
      shareDenominator: sessions.shareDenominator,
      owner: { count: sessions.initiatorCounts.owner.count, share: sessions.initiatorCounts.owner.share },
      other: { count: sessions.initiatorCounts.other.count, share: sessions.initiatorCounts.other.share },
      unknown: { count: sessions.initiatorCounts.unknown.count, share: sessions.initiatorCounts.unknown.share },
      filterBehavior: sessions.filterBehavior,
      definitionVersion: sessions.definitionVersion,
      sensitivityChanged: sessions.sensitivityChanged,
    },
    replyIntervals: {
      thresholdHours: replies.thresholdHours,
      overall: replyStats(replies.overall),
      directions: [replyDirections[0]!, replyDirections[1]!],
      filterBehavior: replies.filterBehavior,
      definitionVersion: replies.definitionVersion,
    },
  };
}

function section(
  id: BetaReportSectionId,
  factKey: BetaReportFactKey,
  status: BetaReportSectionStatus,
  value: BetaReportValueModelV1 | null,
  templateId: BetaReportTemplateId,
  reason: BetaReportReasonCode | null,
): BetaReportDtoV1["sections"][number] {
  const definition = BETA_REPORT_SECTIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error("UNKNOWN_BETA_REPORT_SECTION");
  }
  return {
    id,
    order: definition.order,
    scene: definition.scene,
    factKey,
    status,
    value,
    templateId,
    reason,
  };
}

function buildSections(
  facts: CoreReportFactsV1,
  scope: BetaReportCalendarScope,
  mode: BetaReportMode,
): BetaReportDtoV1["sections"] {
  const partial = scope === "partial-calendar-query";
  const totalReady = facts.totalMessages.value > 0;
  const activeReady = facts.activeDays.value > 0;
  const streakReady = facts.longestStreak.length > 0;
  const monthReady = facts.peakMonth.maxCount !== null;
  const weekdayReady = facts.peakWeekday.maxCount !== null;
  const hourReady = facts.peakHour.maxCount !== null;
  const senderReady = facts.senderShare.denominator > 0;
  const lengthReady = facts.messageLength.overall.count > 0;
  const typesReady = facts.messageTypes.denominator > 0;
  const sessionsReady = facts.sessions.sessionCount > 0;
  const repliesReady = facts.replyIntervals.overall.count > 0;
  const openingTemplate: BetaReportTemplateId = mode === "annual"
    ? partial ? "ANNUAL_OPENING_PARTIAL" : "ANNUAL_OPENING_FULL"
    : "ALL_YEARS_OPENING";
  const openingReason: BetaReportReasonCode | null = partial
    ? "PARTIAL_CALENDAR_SCOPE"
    : mode === "annual" ? null : "MULTI_YEAR_SCOPE";
  const partialOrNull = (ready: boolean): BetaReportReasonCode | null => ready ? partialReason(scope) : null;
  return [
    section("opening", "none", partial ? "PARTIAL" : "READY", null, openingTemplate, openingReason),
    section(
      "messages",
      "totalMessages",
      statusFor(scope, totalReady, "EMPTY"),
      sectionValue(totalReady ? facts.totalMessages.value : 0, "messages", facts.totalMessages.denominator),
      totalReady ? "TOTAL_MESSAGES_READY" : "TOTAL_MESSAGES_EMPTY",
      totalReady ? partialOrNull(true) : "NO_USER_MESSAGES",
    ),
    section(
      "active-days",
      "activeDays",
      statusFor(scope, activeReady, "EMPTY"),
      sectionValue(activeReady ? facts.activeDays.value : 0, "days"),
      activeReady ? "ACTIVE_DAYS_READY" : "ACTIVE_DAYS_EMPTY",
      activeReady ? partialOrNull(true) : "NO_ACTIVE_DAYS",
    ),
    section(
      "longest-streak",
      "longestStreak",
      statusFor(scope, streakReady, "EMPTY"),
      sectionValue(streakReady ? facts.longestStreak.length : 0, "days"),
      !streakReady ? "LONGEST_STREAK_EMPTY" : facts.longestStreak.intervals.length > 1 ? "LONGEST_STREAK_TIE" : "LONGEST_STREAK_SINGLE",
      streakReady ? partialOrNull(true) : "NO_STREAK",
    ),
    section(
      "peak-month",
      "peakMonth",
      statusFor(scope, monthReady, "EMPTY"),
      sectionValue(facts.peakMonth.maxCount, "messages"),
      !monthReady ? "MOST_ACTIVE_MONTH_EMPTY" : facts.peakMonth.ties.length > 1 ? "MOST_ACTIVE_MONTH_TIE" : "MOST_ACTIVE_MONTH_SINGLE",
      monthReady ? partialOrNull(true) : "NO_PEAK_BUCKET",
    ),
    section(
      "peak-weekday",
      "peakWeekday",
      statusFor(scope, weekdayReady, "EMPTY"),
      sectionValue(facts.peakWeekday.maxCount, "messages"),
      !weekdayReady ? "MOST_ACTIVE_WEEKDAY_EMPTY" : facts.peakWeekday.ties.length > 1 ? "MOST_ACTIVE_WEEKDAY_TIE" : "MOST_ACTIVE_WEEKDAY_SINGLE",
      weekdayReady ? partialOrNull(true) : "NO_PEAK_BUCKET",
    ),
    section(
      "peak-hour",
      "peakHour",
      statusFor(scope, hourReady, "EMPTY"),
      sectionValue(facts.peakHour.maxCount, "messages"),
      !hourReady ? "MOST_ACTIVE_HOUR_EMPTY" : facts.peakHour.ties.length > 1 ? "MOST_ACTIVE_HOUR_TIE" : "MOST_ACTIVE_HOUR_SINGLE",
      hourReady ? partialOrNull(true) : "NO_PEAK_BUCKET",
    ),
    section(
      "sender-share",
      "senderShare",
      statusFor(scope, senderReady, "EMPTY"),
      sectionValue(senderReady ? facts.senderShare.denominator : null, "share", facts.senderShare.denominator),
      senderReady ? "SENDER_SHARE_READY" : "SENDER_SHARE_EMPTY",
      senderReady ? "SENDER_COMPARISON_IGNORES_FILTER" : "NO_USER_MESSAGES",
    ),
    section(
      "message-length",
      "messageLength",
      statusFor(scope, lengthReady, "INSUFFICIENT"),
      sectionValue(facts.messageLength.overall.mean, "code-points", facts.messageLength.overall.count),
      lengthReady ? "MESSAGE_LENGTH_READY" : "MESSAGE_LENGTH_INSUFFICIENT",
      lengthReady ? partialOrNull(true) : "NO_ELIGIBLE_TEXT_SAMPLE",
    ),
    section(
      "message-types",
      "messageTypes",
      statusFor(scope, typesReady, "EMPTY"),
      sectionValue(typesReady ? facts.messageTypes.denominator : null, "categories", facts.messageTypes.denominator),
      typesReady ? "MESSAGE_TYPES_READY" : "MESSAGE_TYPES_EMPTY",
      typesReady ? partialOrNull(true) : "NO_USER_MESSAGES",
    ),
    section(
      "sessions",
      "sessions",
      statusFor(scope, sessionsReady, "EMPTY"),
      sectionValue(sessionsReady ? facts.sessions.sessionCount : null, "sessions", facts.sessions.shareDenominator),
      sessionsReady ? "SESSIONS_READY" : "SESSIONS_EMPTY",
      sessionsReady ? "THRESHOLD_SENSITIVE" : "NO_SESSIONS",
    ),
    section(
      "replies",
      "replyIntervals",
      statusFor(scope, repliesReady, "INSUFFICIENT"),
      sectionValue(repliesReady ? facts.replyIntervals.overall.medianSeconds : null, "seconds", facts.replyIntervals.overall.count),
      repliesReady ? "REPLY_INTERVALS_READY" : "NO_REPLY_SAMPLE",
      repliesReady ? "THRESHOLD_SENSITIVE" : "NO_REPLY_SAMPLE",
    ),
    section("frequent-words", "none", "UNAVAILABLE", null, "UNAVAILABLE", "UNAVAILABLE"),
    section("distinctive-keywords", "none", "UNAVAILABLE", null, "UNAVAILABLE", "UNAVAILABLE"),
    section("word-cloud", "none", "UNAVAILABLE", null, "UNAVAILABLE", "UNAVAILABLE"),
    section("summary-share", "none", "UNAVAILABLE", null, "UNAVAILABLE", "UNAVAILABLE"),
  ];
}

function buildMethodology(
  filters: BetaReportAppliedFiltersV1,
  scope: BetaReportCalendarScope,
): readonly BetaMethodologyFactV1[] {
  return [
    { id: "population", value: "post-dedup-user-messages" },
    { id: "timezone", value: BETA_REPORT_TIMEZONE },
    { id: "sender-filter-exception", value: "sender-comparison-reply-interval-and-session-ignore-global-sender-filter" },
    { id: "session-threshold", value: String(filters.sessionThresholdHours) },
    { id: "partial-calendar", value: scope },
    { id: "reply-limitation", value: "eligible-cross-sender-reply-pairs" },
    { id: "non-evaluative-language", value: "descriptive-distributions-and-intervals-only" },
    { id: "word-denominator", value: "raw-count-and-per-10000-eligible-token-after-built-in-policy.v1" },
  ];
}

export function buildBetaReportDto(
  result: CanonicalAnalysisResult,
  options: BetaReportAdapterOptions,
): BetaReportDtoV1 {
  if (
    (options.mode === "annual" && (options.year === null || result.filters.selectedYear !== options.year)) ||
    (options.mode !== "annual" && (options.year !== null || result.filters.selectedYear !== null))
  ) {
    throw new Error("BETA_REPORT_RESULT_MISMATCH");
  }
  const query = createBetaReportQuery(
    result.datasetId,
    result.generation,
    result.queryKey,
    options.mode,
    options.year,
  );
  const scope = calendarScope(result, options);
  const appliedFilters: BetaReportAppliedFiltersV1 = {
    sender: result.filters.sender,
    sessionThresholdHours: result.filters.sessionThresholdHours,
  };
  const facts = buildFacts(result);
  const dto: BetaReportDtoV1 = {
    schemaVersion: BETA_REPORT_SCHEMA_VERSION,
    identity: {
      datasetId: result.datasetId,
      generation: result.generation,
      reportQueryKey: betaReportQueryKey(query),
    },
    metadata: {
      mode: options.mode,
      year: options.year,
      scope,
      currentRange: {
        startDate: result.filters.startDate,
        endDate: result.filters.endDate,
      },
      timezone: BETA_REPORT_TIMEZONE,
      representedYears: representedYears(result),
      appliedFilters,
    },
    facts,
    sections: buildSections(facts, scope, options.mode),
    wordEvidence: {
      status: options.wordEvidenceStatus ?? "not-requested",
      frequencyDtoKey: options.frequencyDtoKey ?? null,
    },
    methodology: buildMethodology(appliedFilters, scope),
    privacy: {
      localOnly: true,
      containsMessageBodies: false,
      containsContactIdentity: false,
    },
    export: {
      localOnly: true,
      supportedKinds: [],
      anonymousRoleLabels: true,
      containsMessageBodies: false,
      containsContactIdentity: false,
    },
  };
  validateBetaReportDtoV1(dto);
  return dto;
}

export function betaReportMetricCategoryLabel(category: CanonicalMessageCategory): string {
  return MESSAGE_CATEGORY_LABEL_ZH[category];
}

export function betaReportWeekdayLabel(weekday: CanonicalWeekday): string {
  return WEEKDAY_LABEL_ZH[weekday];
}

export function betaReportWeekdayOrder(): readonly CanonicalWeekday[] {
  return WEEKDAY_LABELS;
}

export function betaReportMonthDays(year: number, month: number): number {
  return daysInMonth(year, month);
}

export function betaReportCalendarDays(startDate: string, endDate: string): number {
  return calendarDayOrdinal(endDate) - calendarDayOrdinal(startDate) + 1;
}
