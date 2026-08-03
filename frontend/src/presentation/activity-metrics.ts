import type {
  CanonicalActivityMetrics,
  HourActivityBucket,
  StreakInterval,
  TrendBucket,
  WeekdayActivityBucket,
} from "../worker-analysis/activity-metrics";

export interface ActivityTable<Row> {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
}

export interface TrendTableRow {
  readonly key: string;
  readonly count: number;
  readonly partial: boolean;
}

export interface SenderTableRow {
  readonly sender: "owner" | "other";
  readonly count: number;
  readonly share: number | null;
  readonly displayShare: string;
}

export interface DistributionTableRow {
  readonly key: string;
  readonly count: number;
  readonly share: number | null;
  readonly displayShare: string;
}

export interface StreakTableRow {
  readonly startDate: string;
  readonly endDate: string;
  readonly length: number;
}

export interface ActivityPresentation {
  readonly definitions: {
    readonly population: string;
    readonly timezone: string;
    readonly comparativeSenderScope: string;
    readonly chatDay: string;
    readonly streak: string;
  };
  readonly trends: {
    readonly daily: ActivityTable<TrendTableRow>;
    readonly monthly: ActivityTable<TrendTableRow>;
    readonly yearly: ActivityTable<TrendTableRow>;
  };
  readonly senderComparison: ActivityTable<SenderTableRow> & {
    readonly denominator: number;
  };
  readonly hourActivity: ActivityTable<DistributionTableRow> & {
    readonly denominator: number;
  };
  readonly weekdayActivity: ActivityTable<DistributionTableRow> & {
    readonly denominator: number;
  };
  readonly chatActivity: {
    readonly totalChatDays: number;
    readonly longestStreakLength: number;
    readonly streaks: ActivityTable<StreakTableRow>;
  };
}

const WEEKDAY_LABELS_ZH = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
] as const;

function formatShare(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function trendTable(
  caption: string,
  buckets: readonly TrendBucket[],
): ActivityTable<TrendTableRow> {
  return {
    caption,
    columns: ["period", "count", "partial"],
    rows: buckets.map((bucket) => ({
      key: bucket.key,
      count: bucket.count,
      partial: bucket.partial,
    })),
  };
}

function senderTable(
  activity: CanonicalActivityMetrics,
): ActivityPresentation["senderComparison"] {
  return {
    caption: "Sender comparison",
    columns: ["sender", "count", "share"],
    denominator: activity.senderComparison.denominator,
    rows: [activity.senderComparison.owner, activity.senderComparison.other].map(
      (bucket) => ({
        sender: bucket.sender,
        count: bucket.count,
        share: bucket.share,
        displayShare: formatShare(bucket.share),
      }),
    ),
  };
}

function distributionTable(
  caption: string,
  denominator: number,
  rows: readonly DistributionTableRow[],
): ActivityTable<DistributionTableRow> & { readonly denominator: number } {
  return {
    caption,
    columns: ["bucket", "count", "share"],
    denominator,
    rows,
  };
}

function hourRows(
  buckets: readonly HourActivityBucket[],
): readonly DistributionTableRow[] {
  return buckets.map((bucket) => ({
    key: String(bucket.hour).padStart(2, "0"),
    count: bucket.count,
    share: bucket.share,
    displayShare: formatShare(bucket.share),
  }));
}

function weekdayRows(
  buckets: readonly WeekdayActivityBucket[],
): readonly DistributionTableRow[] {
  return buckets.map((bucket, index) => ({
    key: WEEKDAY_LABELS_ZH[index] ?? bucket.weekday,
    count: bucket.count,
    share: bucket.share,
    displayShare: formatShare(bucket.share),
  }));
}

function streakTable(
  intervals: readonly StreakInterval[],
): ActivityTable<StreakTableRow> {
  return {
    caption: "Longest consecutive chat days",
    columns: ["start", "end", "length"],
    rows: intervals.map((interval) => ({
      startDate: interval.startDate,
      endDate: interval.endDate,
      length: interval.length,
    })),
  };
}

export function toActivityPresentation(
  activity: CanonicalActivityMetrics,
): ActivityPresentation {
  return {
    definitions: {
      population: "去重后的 user messages；包含媒体、未知类型和不符合 eligible text 的 text；排除 system events。",
      timezone: "所有日期、月份、年份、小时和星期使用 UTC+08:00。",
      comparativeSenderScope: "Sender comparison 固定同时包含 owner 与 other，忽略全局 sender filter。",
      chatDay: "UTC+08:00 calendar day 内至少一条符合筛选条件的 user message。",
      streak: "相邻自然日组成连续段；筛选边界会裁剪连续段，并返回所有并列最长段。",
    },
    trends: {
      daily: trendTable("Daily user-message trend", activity.trends.daily),
      monthly: trendTable("Monthly user-message trend", activity.trends.monthly),
      yearly: trendTable("Yearly user-message trend", activity.trends.yearly),
    },
    senderComparison: senderTable(activity),
    hourActivity: distributionTable(
      "Hour activity (UTC+08:00)",
      activity.hourActivity.denominator,
      hourRows(activity.hourActivity.buckets),
    ),
    weekdayActivity: distributionTable(
      "Weekday activity (Monday–Sunday)",
      activity.weekdayActivity.denominator,
      weekdayRows(activity.weekdayActivity.buckets),
    ),
    chatActivity: {
      totalChatDays: activity.chatActivity.totalChatDays,
      longestStreakLength: activity.chatActivity.longestStreakLength,
      streaks: streakTable(activity.chatActivity.longestStreaks),
    },
  };
}
