import {
  ANALYTICS_RESULT_SCHEMA_VERSION,
  canonicalQueryKey,
  type CanonicalAnalysisFilters,
  type CanonicalAnalysisResult,
} from "../../worker-analysis/analytics-contract";
import {
  ACTIVITY_METRICS_SCHEMA_VERSION,
  ACTIVITY_TIME_POLICY,
  ACTIVITY_USER_MESSAGE_POPULATION,
  WEEKDAY_LABELS,
} from "../../worker-analysis/activity-metrics";
import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  CANONICAL_MANIFEST_SCHEMA_VERSION,
  CANONICAL_MESSAGE_CATEGORIES,
  METRIC_DEFINITION_VERSIONS,
  type CanonicalMessageCategory,
} from "../../canonical-v2/schema";
import type { DatasetId, Generation } from "../../desktop/ipc-contract";
import {
  REPLY_INTERVAL_BIN_DEFINITIONS,
  REPLY_INTERVAL_DATE_BOUNDARY,
  REPLY_INTERVAL_DEFINITION_VERSION,
  REPLY_INTERVAL_EXCLUDED_GAP_RULE,
  REPLY_INTERVAL_FILTER_BEHAVIOR,
  REPLY_INTERVAL_UNIT,
  REPLY_SESSION_METRICS_SCHEMA_VERSION,
  SESSION_INITIATOR_DEFINITION_VERSION,
  SESSION_OPENING_DATE_BOUNDARY,
} from "../../worker-analysis/reply-session-metrics";
import {
  STAGE7_DEFINITION_VERSIONS,
  STAGE7_METRICS_SCHEMA_VERSION,
} from "../../worker-analysis/stage7-metrics";

export const SYNTHETIC_REPORT_DATASET_ID = "dat_000000000000000000000000000000f1" as DatasetId;
export const SYNTHETIC_REPORT_GENERATION = 1 as Generation;

function categoryCounts(): Record<string, number> {
  return Object.fromEntries(CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, category === "text" ? 930 : category === "image" ? 180 : category === "voice" ? 72 : 0]));
}

function zeroCategoryCounts(): Record<string, number> {
  return Object.fromEntries(CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, 0]));
}

export function syntheticBetaAnnualReportResult(year: number): CanonicalAnalysisResult {
  const partial = year === 2025;
  const scopedMessageCount = year === 2024 ? 824 : 1_248;
  const filters = {
    startDate: partial ? `${year}-02-01` : `${year}-01-01`,
    endDate: `${year}-12-31`,
    sender: "both" as const,
    selectedYear: year,
    sessionThresholdHours: 6 as const,
  };
  const queryKey = canonicalQueryKey(SYNTHETIC_REPORT_DATASET_ID, SYNTHETIC_REPORT_GENERATION, filters);
  const monthly = Array.from({ length: 12 }, (_, index) => ({
    key: `${year}-${String(index + 1).padStart(2, "0")}`,
    count: [82, 110, 96, 124, 88, 138, 76, 106, 132, 118, 92, 86][index] ?? 0,
    partial: partial && index === 0,
  }));
  const weekdayCounts = [210, 210, 156, 182, 198, 152, 140];
  const hourCounts = Array.from({ length: 24 }, (_, hour) => (
    hour === 20 || hour === 21 ? 116 : hour === 22 ? 108 : hour === 9 ? 74 : 28 + (hour % 5) * 4
  ));
  const messageTypeCategories = [
    { category: "text", count: 930, share: 930 / 1_248 },
    { category: "image", count: 180, share: 180 / 1_248 },
    { category: "voice", count: 72, share: 72 / 1_248 },
    { category: "video", count: 36, share: 36 / 1_248 },
    { category: "file", count: 30, share: 30 / 1_248 },
  ];
  return {
    schemaVersion: "chat-history-analysis.analytics-result.v2",
    datasetSchemaVersion: "chat-history-analysis.canonical-event.v2",
    sessionId: null,
    datasetId: SYNTHETIC_REPORT_DATASET_ID,
    generation: SYNTHETIC_REPORT_GENERATION,
    metricDefinitionVersions: {} as CanonicalAnalysisResult["metricDefinitionVersions"],
    queryKey,
    filters,
    dataset: {
      schemaVersion: "chat-history-analysis.canonical-manifest.v2",
      eventCount: scopedMessageCount,
      userMessageCount: scopedMessageCount,
      eligibleTextCount: 930,
      systemEventCount: 0,
      chunkCount: 1,
      totalBytes: 0,
      warningCount: 0,
      messageCategoryCounts: categoryCounts(),
      unknownSenderCount: 0,
      minimumCalendarDate: "2024-01-01",
      maximumCalendarDate: "2025-12-31",
      pseudonymous: true,
    },
    index: {
      indexedRecordCount: 1_248,
      eligibleTextCodePointCount: 13_700,
      tokenCount: 9_500,
      distinctTokenCount: 420,
      typedArrayBytes: 0,
    },
    aggregate: {
      eventCount: scopedMessageCount,
      userMessageCount: scopedMessageCount,
      eligibleTextCount: 930,
      systemEventCount: 0,
      messageCategoryCounts: categoryCounts(),
      senderCounts: { owner: 720, other: 528 },
      unknownSenderCount: 0,
      eligibleTextCodePointCount: 13_700,
      tokenCount: 9_500,
    },
    activity: {
      schemaVersion: "chat-history-analysis.activity-metrics.v1",
      filters,
      timePolicy: "UTC+08:00",
      trends: {
        daily: [],
        monthly,
        yearly: [
          { key: "2024", count: 620, partial: false },
          { key: "2025", count: 1_248, partial: true },
        ],
      },
      weekdayActivity: {
        buckets: WEEKDAY_LABELS.map((weekday, index) => ({
          weekday,
          count: weekdayCounts[index] ?? 0,
          share: (weekdayCounts[index] ?? 0) / 1_248,
        })),
        total: 1_248,
      },
      hourActivity: {
        buckets: hourCounts.map((count, hour) => ({ hour, count, share: count / 1_248 })),
        total: 1_248,
      },
      chatActivity: {
        totalChatDays: 112,
        longestStreakLength: 14,
        longestStreaks: [
          { startDate: `${year}-04-03`, endDate: `${year}-04-16`, length: 14 },
          { startDate: `${year}-09-10`, endDate: `${year}-09-23`, length: 14 },
        ],
      },
      senderComparison: {
        denominator: 1_248,
        owner: { count: 720, share: 720 / 1_248 },
        other: { count: 528, share: 528 / 1_248 },
        filterBehavior: "ignores-global-sender-filter",
        definitionVersion: "chat-history-analysis.metric.sender-comparison.v1",
      },
    },
    stage7: {
      schemaVersion: "chat-history-analysis.stage7-metrics.v1",
      filters,
      averageLength: {
        overall: { count: 930, mean: 14.7, median: 10, p90: 31 },
        owner: { count: 530, mean: 15.2, median: 10, p90: 32 },
        other: { count: 400, mean: 14.1, median: 9, p90: 30 },
        definitionVersion: "chat-history-analysis.metric.average-length.v1",
      },
      messageTypes: {
        denominator: 1_248,
        eligibleTextCount: 930,
        systemDiagnosticCount: 0,
        categories: messageTypeCategories,
        definitionVersion: "chat-history-analysis.metric.message-types.v1",
      },
      yearlyKeywords: {
        definitionVersion: "chat-history-analysis.metric.keywords.log-odds.v1",
        activeYear: year,
        years: [{
          year,
          mode: "frequency-fallback",
          keywords: [
            "但是", "然后", "所以", "这个", "已经", "就是", "其实", "还有", "the", "and",
            ...(year === 2024
              ? ["海边计划", "相册整理", "冬日散步", "旧城地图", "周末路线", "照片备份", "晚餐清单", "阅读笔记", "电影片单", "旅行手册"]
              : ["本地版本", "年度报告", "词云布局", "发布计划", "测试矩阵", "界面修订", "离线分析", "范围同步", "性能记录", "隐私边界"]),
          ].map((token, index) => ({ token, count: 100 - index * 3 })),
        }],
      },
    },
    replySessions: {
      schemaVersion: "chat-history-analysis.reply-session-metrics.v1",
      filters,
      conversationSessions: {
        thresholdHours: 6,
        sessionCount: 86,
        shareDenominator: 86,
        initiatorCounts: {
          owner: { count: 50, share: 50 / 86 },
          other: { count: 34, share: 34 / 86 },
          unknown: { count: 2, share: 2 / 86 },
        },
        filterBehavior: "ignores-global-sender-filter",
        definitionVersion: "chat-history-analysis.metric.conversation-sessions.v1",
        sensitivityChanged: false,
      },
      replyIntervals: {
        thresholdHours: 6,
        overall: { count: 420, meanSeconds: 2_480, medianSeconds: 1_320, p90Seconds: 7_200 },
        directions: [
          { direction: "owner-to-other", responder: "other", stats: { count: 220, meanSeconds: 2_600, medianSeconds: 1_400, p90Seconds: 7_600 } },
          { direction: "other-to-owner", responder: "owner", stats: { count: 200, meanSeconds: 2_350, medianSeconds: 1_250, p90Seconds: 7_000 } },
        ],
        filterBehavior: "ignores-global-sender-filter",
        definitionVersion: "chat-history-analysis.metric.reply-intervals.v1",
      },
    },
  } as unknown as CanonicalAnalysisResult;
}

export function syntheticBetaAllYearsReportResult(): CanonicalAnalysisResult {
  const priorYear = syntheticBetaAnnualReportResult(2024);
  const annual = syntheticBetaAnnualReportResult(2025);
  const filters = {
    startDate: "2024-01-01",
    endDate: "2025-12-31",
    sender: "both" as const,
    selectedYear: null,
    sessionThresholdHours: 6 as const,
  };
  return {
    ...annual,
    queryKey: canonicalQueryKey(SYNTHETIC_REPORT_DATASET_ID, SYNTHETIC_REPORT_GENERATION, filters),
    filters,
    aggregate: {
      ...annual.aggregate,
      eventCount: 2_072,
      userMessageCount: 2_072,
    },
    activity: {
      ...annual.activity,
      filters,
      trends: {
        ...annual.activity.trends,
        monthly: [...priorYear.activity.trends.monthly, ...annual.activity.trends.monthly],
      },
    },
    stage7: { ...annual.stage7, filters },
    replySessions: { ...annual.replySessions, filters },
  } as unknown as CanonicalAnalysisResult;
}

/** Empty synthetic edge fixture for presentation-only sparse-state browser QA. */
export function syntheticBetaSparseAnnualReportResult(): CanonicalAnalysisResult {
  const base = syntheticBetaAnnualReportResult(2025);
  const emptyStats = () => ({ count: 0, mean: null, median: null, p90: null });
  const filters = { ...base.filters, startDate: "2025-01-01", endDate: "2025-12-31" };
  return {
    ...base,
    queryKey: canonicalQueryKey(SYNTHETIC_REPORT_DATASET_ID, SYNTHETIC_REPORT_GENERATION, filters),
    filters,
    dataset: {
      ...base.dataset,
      eventCount: 0,
      userMessageCount: 0,
      eligibleTextCount: 0,
      messageCategoryCounts: zeroCategoryCounts(),
    },
    index: {
      ...base.index,
      indexedRecordCount: 0,
      eligibleTextCodePointCount: 0,
      tokenCount: 0,
      distinctTokenCount: 0,
    },
    aggregate: {
      ...base.aggregate,
      eventCount: 0,
      userMessageCount: 0,
      eligibleTextCount: 0,
      messageCategoryCounts: zeroCategoryCounts(),
      senderCounts: { owner: 0, other: 0 },
      eligibleTextCodePointCount: 0,
      tokenCount: 0,
    },
    activity: {
      ...base.activity,
      filters,
      trends: {
        ...base.activity.trends,
        monthly: base.activity.trends.monthly.map((bucket) => ({ ...bucket, count: 0, partial: false })),
        yearly: base.activity.trends.yearly.map((bucket) => ({ ...bucket, count: 0, partial: false })),
      },
      weekdayActivity: {
        ...base.activity.weekdayActivity,
        total: 0,
        buckets: base.activity.weekdayActivity.buckets.map((bucket) => ({ ...bucket, count: 0, share: null })),
      },
      hourActivity: {
        ...base.activity.hourActivity,
        total: 0,
        buckets: base.activity.hourActivity.buckets.map((bucket) => ({ ...bucket, count: 0, share: null })),
      },
      chatActivity: {
        ...base.activity.chatActivity,
        totalChatDays: 0,
        longestStreakLength: 0,
        longestStreaks: [],
      },
      senderComparison: {
        ...base.activity.senderComparison,
        denominator: 0,
        owner: { count: 0, share: null },
        other: { count: 0, share: null },
      },
    },
    stage7: {
      ...base.stage7,
      filters,
      averageLength: {
        ...base.stage7.averageLength,
        overall: emptyStats(),
        owner: emptyStats(),
        other: emptyStats(),
      },
      messageTypes: {
        ...base.stage7.messageTypes,
        denominator: 0,
        eligibleTextCount: 0,
        systemDiagnosticCount: 0,
        categories: base.stage7.messageTypes.categories.map((bucket) => ({ ...bucket, count: 0, share: null })),
      },
    },
    replySessions: {
      ...base.replySessions,
      filters,
      conversationSessions: {
        ...base.replySessions.conversationSessions,
        sessionCount: 0,
        shareDenominator: 0,
        owner: { count: 0, share: null },
        other: { count: 0, share: null },
        unknown: { count: 0, share: null },
      },
      replyIntervals: {
        ...base.replySessions.replyIntervals,
        overall: emptyStats(),
        directions: base.replySessions.replyIntervals.directions.map((direction) => ({
          ...direction,
          stats: emptyStats(),
        })),
      },
    },
  } as unknown as CanonicalAnalysisResult;
}

function detailedCategoryCounts(): Record<CanonicalMessageCategory, number> {
  return Object.fromEntries(
    CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, category === "text" ? 8 : 0]),
  ) as Record<CanonicalMessageCategory, number>;
}

function detailedEmptyReplyStats() {
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

function detailedFilters(): CanonicalAnalysisFilters {
  return {
    startDate: "2025-01-01",
    endDate: "2025-01-04",
    sender: "both",
    selectedYear: null,
    sessionThresholdHours: 6,
  };
}

/**
 * A complete, validator-safe fixture for the Detailed shell only.
 * It remains synthetic and intentionally independent from the Annual Recap DTO fixture above.
 */
export function syntheticBetaDetailedResult(): CanonicalAnalysisResult {
  const filters = detailedFilters();
  const categoryCountsValue = detailedCategoryCounts();
  const emptyStats = detailedEmptyReplyStats();
  const queryKey = canonicalQueryKey(SYNTHETIC_REPORT_DATASET_ID, SYNTHETIC_REPORT_GENERATION, filters);
  const hourlyCounts = Array.from({ length: 24 }, (_, hour) => (hour === 20 ? 8 : 0));
  const weekdayCounts = WEEKDAY_LABELS.map((_, index) => (index < 2 ? 4 : 0));
  const wordValues = [
    { token: "report", count: 8, ratePer10000: 5_000 },
    { token: "synthetic", count: 8, ratePer10000: 5_000 },
  ];

  return {
    schemaVersion: ANALYTICS_RESULT_SCHEMA_VERSION,
    datasetSchemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
    sessionId: null,
    datasetId: SYNTHETIC_REPORT_DATASET_ID,
    generation: SYNTHETIC_REPORT_GENERATION,
    metricDefinitionVersions: METRIC_DEFINITION_VERSIONS,
    queryKey,
    filters,
    dataset: {
      schemaVersion: CANONICAL_MANIFEST_SCHEMA_VERSION,
      eventCount: 8,
      userMessageCount: 8,
      eligibleTextCount: 8,
      systemEventCount: 0,
      chunkCount: 1,
      totalBytes: 0,
      warningCount: 0,
      messageCategoryCounts: categoryCountsValue,
      unknownSenderCount: 0,
      minimumCalendarDate: filters.startDate,
      maximumCalendarDate: filters.endDate,
      pseudonymous: true,
    },
    index: {
      indexedRecordCount: 8,
      eligibleTextCodePointCount: 64,
      tokenCount: 16,
      distinctTokenCount: 2,
      typedArrayBytes: 0,
    },
    aggregate: {
      eventCount: 8,
      userMessageCount: 8,
      eligibleTextCount: 8,
      systemEventCount: 0,
      messageCategoryCounts: categoryCountsValue,
      senderCounts: { owner: 4, other: 4 },
      unknownSenderCount: 0,
      eligibleTextCodePointCount: 64,
      tokenCount: 16,
    },
    activity: {
      schemaVersion: ACTIVITY_METRICS_SCHEMA_VERSION,
      timePolicy: ACTIVITY_TIME_POLICY,
      population: ACTIVITY_USER_MESSAGE_POPULATION,
      trends: {
        daily: [
          { key: "2025-01-01", count: 2, partial: false },
          { key: "2025-01-02", count: 2, partial: false },
          { key: "2025-01-03", count: 2, partial: false },
          { key: "2025-01-04", count: 2, partial: false },
        ],
        monthly: [{ key: "2025-01", count: 8, partial: true }],
        yearly: [{ key: "2025", count: 8, partial: true }],
      },
      senderComparison: {
        filterBehavior: "ignores-global-sender-filter",
        denominator: 8,
        owner: { sender: "owner", count: 4, share: 0.5 },
        other: { sender: "other", count: 4, share: 0.5 },
      },
      hourActivity: {
        sender: filters.sender,
        denominator: 8,
        buckets: hourlyCounts.map((count, hour) => ({ hour, count, share: count / 8 })),
      },
      weekdayActivity: {
        sender: filters.sender,
        denominator: 8,
        buckets: WEEKDAY_LABELS.map((weekday, index) => ({
          weekday,
          count: weekdayCounts[index] ?? 0,
          share: (weekdayCounts[index] ?? 0) / 8,
        })),
      },
      chatActivity: {
        sender: filters.sender,
        totalChatDays: 4,
        longestStreakLength: 4,
        longestStreaks: [{ startDate: filters.startDate, endDate: filters.endDate, length: 4 }],
      },
    },
    stage7: {
      schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
      filters,
      definitionVersions: STAGE7_DEFINITION_VERSIONS,
      wordEvolution: {
        schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
        definitionVersion: STAGE7_DEFINITION_VERSIONS.wordEvolution,
        sender: filters.sender,
        vocabulary: wordValues.map((value) => value.token),
        years: [{ year: 2025, partial: true, totalTokenCount: 16, values: wordValues }],
      },
      averageLength: {
        schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
        definitionVersion: STAGE7_DEFINITION_VERSIONS.averageLength,
        sender: filters.sender,
        overall: { count: 8, sum: 64, mean: 8, median: 8, p90: 10 },
        owner: { count: 4, sum: 32, mean: 8, median: 8, p90: 10 },
        other: { count: 4, sum: 32, mean: 8, median: 8, p90: 10 },
      },
      yearlyKeywords: {
        schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
        definitionVersion: STAGE7_DEFINITION_VERSIONS.yearlyKeywords,
        sender: filters.sender,
        activeYear: 2025,
        selection: "explicit",
        years: [{
          year: 2025,
          partial: true,
          mode: "frequency-fallback",
          omissionReason: null,
          minCount: 5,
          minDistinctMessages: 3,
          maxResults: 20,
          keywords: [{
            token: "report",
            count: 8,
            yearTokenTotal: 16,
            restCount: 0,
            restTokenTotal: 0,
            distinctMessageFrequency: 8,
            score: null,
          }],
        }],
      },
      summary: {
        schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
        definitionVersion: STAGE7_DEFINITION_VERSIONS.summary,
        activeYear: 2025,
        clauses: [],
        omissions: [],
      },
      messageTypes: {
        schemaVersion: STAGE7_METRICS_SCHEMA_VERSION,
        definitionVersion: STAGE7_DEFINITION_VERSIONS.messageTypes,
        sender: filters.sender,
        denominator: 8,
        eligibleTextCount: 8,
        systemDiagnosticCount: 0,
        categories: CANONICAL_MESSAGE_CATEGORIES.map((category) => ({
          category,
          count: category === "text" ? 8 : 0,
          share: category === "text" ? 1 : 0,
        })),
      },
    },
    replySessions: {
      schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
      replyIntervals: {
        schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
        definitionVersion: REPLY_INTERVAL_DEFINITION_VERSION,
        unit: REPLY_INTERVAL_UNIT,
        thresholdHours: filters.sessionThresholdHours,
        filterBehavior: REPLY_INTERVAL_FILTER_BEHAVIOR,
        dateBoundary: REPLY_INTERVAL_DATE_BOUNDARY,
        excludedGapRule: REPLY_INTERVAL_EXCLUDED_GAP_RULE,
        overall: emptyStats,
        directions: [
          { direction: "owner-to-other", from: "owner", to: "other", responder: "other", stats: emptyStats },
          { direction: "other-to-owner", from: "other", to: "owner", responder: "owner", stats: emptyStats },
        ],
      },
      conversationSessions: {
        schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
        definitionVersion: SESSION_INITIATOR_DEFINITION_VERSION,
        thresholdHours: filters.sessionThresholdHours,
        filterBehavior: REPLY_INTERVAL_FILTER_BEHAVIOR,
        openingDateBoundary: SESSION_OPENING_DATE_BOUNDARY,
        sensitivityChanged: false,
        sessionCount: 4,
        shareDenominator: 4,
        initiatorCounts: {
          owner: { initiator: "owner", count: 2, share: 0.5 },
          other: { initiator: "other", count: 2, share: 0.5 },
          unknown: { initiator: "unknown", count: 0, share: 0 },
        },
      },
    },
  };
}
