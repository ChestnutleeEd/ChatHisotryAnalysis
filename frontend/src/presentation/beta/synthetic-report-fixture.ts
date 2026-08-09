import {
  canonicalQueryKey,
  type CanonicalAnalysisResult,
} from "../../worker-analysis/analytics-contract";
import {
  WEEKDAY_LABELS,
} from "../../worker-analysis/activity-metrics";
import { CANONICAL_MESSAGE_CATEGORIES } from "../../canonical-v2/schema";
import type { DatasetId, Generation } from "../../desktop/ipc-contract";

export const SYNTHETIC_REPORT_DATASET_ID = "dat_000000000000000000000000000000f1" as DatasetId;
export const SYNTHETIC_REPORT_GENERATION = 1 as Generation;

function categoryCounts(): Record<string, number> {
  return Object.fromEntries(CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, category === "text" ? 930 : category === "image" ? 180 : category === "voice" ? 72 : 0]));
}

export function syntheticBetaAnnualReportResult(year: number): CanonicalAnalysisResult {
  const partial = year === 2025;
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
      eventCount: 1_248,
      userMessageCount: 1_248,
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
      eventCount: 1_248,
      userMessageCount: 1_248,
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
            { token: "本地", count: 86 },
            { token: "版本", count: 70 },
            { token: "计划", count: 58 },
          ],
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
    activity: { ...annual.activity, filters },
    stage7: { ...annual.stage7, filters },
    replySessions: { ...annual.replySessions, filters },
  } as unknown as CanonicalAnalysisResult;
}
