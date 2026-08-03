import type { CanonicalSenderFilter, CanonicalAnalysisFilters } from "./analytics-contract";
import type { SharedAggregateAccumulator } from "./analytics-aggregates";
import {
  calendarDateFromDayOrdinal,
  calendarDateParts,
  calendarDayOrdinal,
  daysInMonth,
} from "./calendar";

export const ACTIVITY_METRICS_SCHEMA_VERSION =
  "chat-history-analysis.activity-metrics.v1" as const;

export const ACTIVITY_TIME_POLICY = "UTC+08:00" as const;
export const ACTIVITY_USER_MESSAGE_POPULATION =
  "post-dedup-user-messages" as const;

export type TrendBucket = {
  readonly key: string;
  readonly count: number;
  readonly partial: boolean;
};

export interface SenderMetricBucket {
  readonly sender: "owner" | "other";
  readonly count: number;
  readonly share: number | null;
}

export interface HourActivityBucket {
  readonly hour: number;
  readonly count: number;
  readonly share: number | null;
}

export const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type CanonicalWeekday = (typeof WEEKDAY_LABELS)[number];

export interface WeekdayActivityBucket {
  readonly weekday: CanonicalWeekday;
  readonly count: number;
  readonly share: number | null;
}

export interface StreakInterval {
  readonly startDate: string;
  readonly endDate: string;
  readonly length: number;
}

export interface DistributionMetric<Bucket> {
  readonly sender: CanonicalSenderFilter;
  readonly denominator: number;
  readonly buckets: readonly Bucket[];
}

export interface CanonicalActivityMetrics {
  readonly schemaVersion: typeof ACTIVITY_METRICS_SCHEMA_VERSION;
  readonly timePolicy: typeof ACTIVITY_TIME_POLICY;
  readonly population: typeof ACTIVITY_USER_MESSAGE_POPULATION;
  readonly trends: {
    readonly daily: readonly TrendBucket[];
    readonly monthly: readonly TrendBucket[];
    readonly yearly: readonly TrendBucket[];
  };
  readonly senderComparison: {
    readonly filterBehavior: "ignores-global-sender-filter";
    readonly denominator: number;
    readonly owner: SenderMetricBucket;
    readonly other: SenderMetricBucket;
  };
  readonly hourActivity: DistributionMetric<HourActivityBucket>;
  readonly weekdayActivity: DistributionMetric<WeekdayActivityBucket>;
  readonly chatActivity: {
    readonly sender: CanonicalSenderFilter;
    readonly totalChatDays: number;
    readonly longestStreakLength: number;
    readonly longestStreaks: readonly StreakInterval[];
  };
}

function share(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function yearMonthFromParts(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function addCount(map: Map<string, number>, key: string, count: number): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function periodIsPartial(
  key: string,
  period: "month" | "year",
  filters: CanonicalAnalysisFilters,
): boolean {
  if (period === "year") {
    const startYear = filters.startDate.slice(0, 4);
    const endYear = filters.endDate.slice(0, 4);
    return (
      (key === startYear && filters.startDate.slice(5) !== "01-01") ||
      (key === endYear && filters.endDate.slice(5) !== "12-31")
    );
  }
  const startMonth = filters.startDate.slice(0, 7);
  const endMonth = filters.endDate.slice(0, 7);
  const startParts = calendarDateParts(filters.startDate);
  const endParts = calendarDateParts(filters.endDate);
  return (
    (key === startMonth && startParts.day !== 1) ||
    (key === endMonth && endParts.day !== daysInMonth(endParts.year, endParts.month))
  );
}

function buildTrends(
  dayCounts: ReadonlyMap<number, number>,
  filters: CanonicalAnalysisFilters,
): CanonicalActivityMetrics["trends"] {
  const startDay = calendarDayOrdinal(filters.startDate);
  const endDay = calendarDayOrdinal(filters.endDate);
  const daily: TrendBucket[] = [];
  const monthlyCounts = new Map<string, number>();
  const yearlyCounts = new Map<string, number>();
  for (let day = startDay; day <= endDay; day += 1) {
    const date = calendarDateFromDayOrdinal(day);
    const count = dayCounts.get(day) ?? 0;
    daily.push({ key: date, count, partial: false });
    addCount(monthlyCounts, date.slice(0, 7), count);
    addCount(yearlyCounts, date.slice(0, 4), count);
  }

  const start = calendarDateParts(filters.startDate);
  const end = calendarDateParts(filters.endDate);
  const monthly: TrendBucket[] = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    const key = yearMonthFromParts(year, month);
    monthly.push({
      key,
      count: monthlyCounts.get(key) ?? 0,
      partial: periodIsPartial(key, "month", filters),
    });
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }

  const yearly: TrendBucket[] = [];
  for (let currentYear = start.year; currentYear <= end.year; currentYear += 1) {
    const key = String(currentYear).padStart(4, "0");
    yearly.push({
      key,
      count: yearlyCounts.get(key) ?? 0,
      partial: periodIsPartial(key, "year", filters),
    });
  }
  return { daily, monthly, yearly };
}

function buildSenderComparison(
  senderCounts: Readonly<{ owner: number; other: number }>,
): CanonicalActivityMetrics["senderComparison"] {
  const denominator = senderCounts.owner + senderCounts.other;
  return {
    filterBehavior: "ignores-global-sender-filter",
    denominator,
    owner: {
      sender: "owner",
      count: senderCounts.owner,
      share: share(senderCounts.owner, denominator),
    },
    other: {
      sender: "other",
      count: senderCounts.other,
      share: share(senderCounts.other, denominator),
    },
  };
}

function buildActivityDistribution(
  shared: SharedAggregateAccumulator,
  filters: CanonicalAnalysisFilters,
): Pick<CanonicalActivityMetrics, "hourActivity" | "weekdayActivity"> {
  const denominator = shared.userMessageCount;
  return {
    hourActivity: {
      sender: filters.sender,
      denominator,
      buckets: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: shared.hourCounts[hour] ?? 0,
        share: share(shared.hourCounts[hour] ?? 0, denominator),
      })),
    },
    weekdayActivity: {
      sender: filters.sender,
      denominator,
      buckets: WEEKDAY_LABELS.map((weekday, index) => ({
        weekday,
        count: shared.weekdayCounts[index] ?? 0,
        share: share(shared.weekdayCounts[index] ?? 0, denominator),
      })),
    },
  };
}

function buildChatActivity(
  dayCounts: ReadonlyMap<number, number>,
  sender: CanonicalSenderFilter,
): CanonicalActivityMetrics["chatActivity"] {
  const activeDays = [...dayCounts.keys()].sort((left, right) => left - right);
  if (activeDays.length === 0) {
    return {
      sender,
      totalChatDays: 0,
      longestStreakLength: 0,
      longestStreaks: [],
    };
  }
  const intervals: Array<{ start: number; end: number }> = [];
  let start = activeDays[0];
  let previous = activeDays[0];
  for (const day of activeDays.slice(1)) {
    if (day !== previous + 1) {
      intervals.push({ start, end: previous });
      start = day;
    }
    previous = day;
  }
  intervals.push({ start, end: previous });
  const longestLength = Math.max(
    ...intervals.map((interval) => interval.end - interval.start + 1),
  );
  return {
    sender,
    totalChatDays: activeDays.length,
    longestStreakLength: longestLength,
    longestStreaks: intervals
      .filter((interval) => interval.end - interval.start + 1 === longestLength)
      .map((interval) => ({
        startDate: calendarDateFromDayOrdinal(interval.start),
        endDate: calendarDateFromDayOrdinal(interval.end),
        length: longestLength,
      })),
  };
}

export function deriveActivityMetrics(
  shared: SharedAggregateAccumulator,
  filters: CanonicalAnalysisFilters,
): CanonicalActivityMetrics {
  return {
    schemaVersion: ACTIVITY_METRICS_SCHEMA_VERSION,
    timePolicy: ACTIVITY_TIME_POLICY,
    population: ACTIVITY_USER_MESSAGE_POPULATION,
    trends: buildTrends(shared.selectedDayCounts, filters),
    senderComparison: buildSenderComparison(shared.senderCounts),
    ...buildActivityDistribution(shared, filters),
    chatActivity: buildChatActivity(shared.selectedDayCounts, filters.sender),
  };
}
