import { describe, expect, it } from "vitest";

import {
  CANONICAL_MESSAGE_CATEGORIES,
  type CanonicalEventV2,
} from "../src/canonical-v2/schema";
import { canonicalDateCode } from "../src/worker-analysis/analytics-contract";
import {
  createSharedAggregate,
  type SharedAggregateAccumulator,
} from "../src/worker-analysis/analytics-aggregates";
import {
  deriveActivityMetrics,
  WEEKDAY_LABELS,
} from "../src/worker-analysis/activity-metrics";
import {
  calendarDateFromDayOrdinal,
  calendarDayOrdinal,
} from "../src/worker-analysis/calendar";
import { CanonicalIndexBuilder } from "../src/worker-analysis/canonical-index";
import {
  canonicalEvent,
  canonicalFilters,
} from "./canonical-analytics-fixtures";

function localTime(value: string): number {
  const [date, time] = value.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, hour - 8, minute, second) / 1000);
}

function datasetSummary(events: readonly CanonicalEventV2[]) {
  const categoryCounts = Object.fromEntries(
    CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<(typeof CANONICAL_MESSAGE_CATEGORIES)[number], number>;
  let eligibleTextCount = 0;
  let systemEventCount = 0;
  for (const event of events) {
    categoryCounts[event.messageCategory] += 1;
    eligibleTextCount += event.textEligible ? 1 : 0;
    systemEventCount += event.messageCategory === "system" ? 1 : 0;
  }
  const dates = events.map((event) => event.calendarDate).sort();
  return {
    schemaVersion: "chat-history-analysis.manifest.v2" as const,
    eventCount: events.length,
    userMessageCount: events.length - systemEventCount,
    eligibleTextCount,
    systemEventCount,
    chunkCount: 1,
    totalBytes: 1,
    warningCount: 0,
    messageCategoryCounts: categoryCounts,
    unknownSenderCount: 0,
    minimumCalendarDate: dates[0] as string,
    maximumCalendarDate: dates.at(-1) as string,
    pseudonymous: true as const,
  };
}

function makeShared(
  events: readonly CanonicalEventV2[],
  filters: ReturnType<typeof canonicalFilters>,
): SharedAggregateAccumulator {
  const builder = new CanonicalIndexBuilder(events.length);
  for (const event of events) {
    builder.append(event, event.textEligible ? ["synthetic"] : []);
  }
  return createSharedAggregate(
    builder.finish(datasetSummary(events)),
    filters,
  );
}

describe("Stage 6 trend, comparison, and activity metrics", () => {
  it("round-trips UTC+08 calendar days across leap, month, and year boundaries", () => {
    for (const date of [
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-12-31",
      "2025-01-01",
    ]) {
      expect(calendarDateFromDayOrdinal(calendarDayOrdinal(date))).toBe(date);
    }
  });

  it("derives zero-filled trends, mixed-category counts, distributions, and streaks once", () => {
    const events = [
      canonicalEvent(localTime("2024-02-28 23:00:00"), 0),
      canonicalEvent(localTime("2024-02-29 00:00:00"), 1, {
        senderScope: "other",
        messageCategory: "image",
        textEligible: false,
        content: null,
      }),
      canonicalEvent(localTime("2024-03-01 12:00:00"), 2, {
        messageCategory: "unknown",
        textEligible: false,
        content: null,
      }),
      canonicalEvent(localTime("2024-03-03 00:00:00"), 3, {
        senderScope: "other",
      }),
      canonicalEvent(localTime("2024-12-31 12:00:00"), 4),
      canonicalEvent(localTime("2025-01-01 12:00:00"), 5, {
        senderScope: "other",
      }),
      canonicalEvent(localTime("2025-01-03 12:00:00"), 6, {
        messageCategory: "image",
        textEligible: false,
        content: null,
      }),
      canonicalEvent(localTime("2025-01-03 13:00:00"), 7, {
        senderScope: null,
        messageCategory: "system",
        textEligible: false,
        content: null,
      }),
    ];
    const filters = canonicalFilters({
      startDate: "2024-02-28",
      endDate: "2025-01-03",
    });
    const activity = deriveActivityMetrics(makeShared(events, filters), filters);

    expect(activity.trends.monthly).toEqual(
      expect.arrayContaining([
        { key: "2024-02", count: 2, partial: true },
        { key: "2024-03", count: 2, partial: false },
        { key: "2024-04", count: 0, partial: false },
        { key: "2024-12", count: 1, partial: false },
        { key: "2025-01", count: 2, partial: true },
      ]),
    );
    expect(activity.trends.monthly).toHaveLength(12);
    expect(activity.trends.yearly).toEqual([
      { key: "2024", count: 5, partial: true },
      { key: "2025", count: 2, partial: true },
    ]);
    expect(
      activity.trends.daily.find((bucket) => bucket.key === "2024-03-02"),
    ).toEqual({ key: "2024-03-02", count: 0, partial: false });
    expect(activity.senderComparison).toMatchObject({
      denominator: 7,
      owner: { count: 4, share: 4 / 7 },
      other: { count: 3, share: 3 / 7 },
    });
    expect(activity.hourActivity.buckets).toHaveLength(24);
    expect(activity.hourActivity.buckets[0]).toMatchObject({ count: 2, share: 2 / 7 });
    expect(activity.hourActivity.buckets[23]).toMatchObject({ count: 1, share: 1 / 7 });
    expect(activity.weekdayActivity.buckets).toHaveLength(7);
    expect(activity.weekdayActivity.buckets.map((bucket) => bucket.weekday)).toEqual(
      WEEKDAY_LABELS,
    );
    expect(activity.chatActivity).toMatchObject({
      totalChatDays: 7,
      longestStreakLength: 3,
      longestStreaks: [
        { startDate: "2024-02-28", endDate: "2024-03-01", length: 3 },
      ],
    });
  });

  it("ignores the sender filter for comparison and recomputes activity for owner scope", () => {
    const events = [
      canonicalEvent(localTime("2025-01-01 08:00:00"), 0),
      canonicalEvent(localTime("2025-01-01 09:00:00"), 1, {
        senderScope: "other",
      }),
      canonicalEvent(localTime("2025-01-02 08:00:00"), 2, {
        senderScope: "other",
      }),
    ];
    const filters = canonicalFilters({
      startDate: "2025-01-01",
      endDate: "2025-01-02",
      sender: "owner",
    });
    const activity = deriveActivityMetrics(makeShared(events, filters), filters);
    expect(activity.senderComparison).toMatchObject({
      denominator: 3,
      owner: { count: 1, share: 1 / 3 },
      other: { count: 2, share: 2 / 3 },
    });
    expect(activity.hourActivity.denominator).toBe(1);
    expect(activity.chatActivity.totalChatDays).toBe(1);
    expect(activity.chatActivity.longestStreaks).toEqual([
      { startDate: "2025-01-01", endDate: "2025-01-01", length: 1 },
    ]);
  });

  it("returns a deterministic 100/0 comparison for a single-sender population", () => {
    const events = [
      canonicalEvent(localTime("2025-01-01 08:00:00"), 0),
      canonicalEvent(localTime("2025-01-02 08:00:00"), 1),
    ];
    const filters = canonicalFilters({
      startDate: "2025-01-01",
      endDate: "2025-01-02",
    });
    const activity = deriveActivityMetrics(makeShared(events, filters), filters);
    expect(activity.senderComparison).toMatchObject({
      denominator: 2,
      owner: { count: 2, share: 1 },
      other: { count: 0, share: 0 },
    });
  });

  it("returns all tied longest streaks and null shares for an empty filtered domain", () => {
    const events = [
      canonicalEvent(localTime("2025-01-01 08:00:00"), 0),
      canonicalEvent(localTime("2025-01-02 08:00:00"), 1),
      canonicalEvent(localTime("2025-01-05 08:00:00"), 2),
      canonicalEvent(localTime("2025-01-06 08:00:00"), 3),
      canonicalEvent(localTime("2025-01-07 08:00:00"), 4, {
        senderScope: null,
        messageCategory: "system",
        textEligible: false,
        content: null,
      }),
    ];
    const filters = canonicalFilters({
      startDate: "2025-01-01",
      endDate: "2025-01-07",
    });
    const activity = deriveActivityMetrics(makeShared(events, filters), filters);
    expect(activity.chatActivity.longestStreaks).toEqual([
      { startDate: "2025-01-01", endDate: "2025-01-02", length: 2 },
      { startDate: "2025-01-05", endDate: "2025-01-06", length: 2 },
    ]);

    const emptyFilters = canonicalFilters({
      startDate: "2025-01-07",
      endDate: "2025-01-07",
    });
    const empty = deriveActivityMetrics(makeShared(events, emptyFilters), emptyFilters);
    expect(empty.senderComparison).toMatchObject({
      denominator: 0,
      owner: { count: 0, share: null },
      other: { count: 0, share: null },
    });
    expect(empty.hourActivity.buckets.every((bucket) => bucket.count === 0 && bucket.share === null)).toBe(true);
    expect(empty.weekdayActivity.buckets.every((bucket) => bucket.count === 0 && bucket.share === null)).toBe(true);
    expect(empty.chatActivity).toMatchObject({
      totalChatDays: 0,
      longestStreakLength: 0,
      longestStreaks: [],
    });
    expect(empty.trends.daily).toEqual([
      { key: "2025-01-07", count: 0, partial: false },
    ]);
    expect(canonicalDateCode("2025-01-07")).toBeLessThan(
      canonicalDateCode("2025-01-08"),
    );
  });
});
