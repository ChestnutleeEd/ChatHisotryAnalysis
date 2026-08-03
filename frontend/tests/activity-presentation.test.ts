import { describe, expect, it } from "vitest";

import { toActivityPresentation } from "../src/presentation/activity-metrics";
import {
  ACTIVITY_METRICS_SCHEMA_VERSION,
  ACTIVITY_TIME_POLICY,
  ACTIVITY_USER_MESSAGE_POPULATION,
  type CanonicalActivityMetrics,
  WEEKDAY_LABELS,
} from "../src/worker-analysis/activity-metrics";

function activityFixture(): CanonicalActivityMetrics {
  return {
    schemaVersion: ACTIVITY_METRICS_SCHEMA_VERSION,
    timePolicy: ACTIVITY_TIME_POLICY,
    population: ACTIVITY_USER_MESSAGE_POPULATION,
    trends: {
      daily: [{ key: "2025-01-01", count: 2, partial: false }],
      monthly: [{ key: "2025-01", count: 2, partial: true }],
      yearly: [{ key: "2025", count: 2, partial: true }],
    },
    senderComparison: {
      filterBehavior: "ignores-global-sender-filter",
      denominator: 2,
      owner: { sender: "owner", count: 2, share: 1 },
      other: { sender: "other", count: 0, share: 0 },
    },
    hourActivity: {
      sender: "both",
      denominator: 2,
      buckets: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: hour === 8 ? 2 : 0,
        share: hour === 8 ? 1 : 0,
      })),
    },
    weekdayActivity: {
      sender: "both",
      denominator: 2,
      buckets: WEEKDAY_LABELS.map((weekday, index) => ({
        weekday,
        count: index === 2 ? 2 : 0,
        share: index === 2 ? 1 : 0,
      })),
    },
    chatActivity: {
      sender: "both",
      totalChatDays: 1,
      longestStreakLength: 1,
      longestStreaks: [
        { startDate: "2025-01-01", endDate: "2025-01-01", length: 1 },
      ],
    },
  };
}

describe("Stage 6 presentation adapters", () => {
  it("preserves exact DTO order and values for accessible tables", () => {
    const presentation = toActivityPresentation(activityFixture());
    expect(presentation.trends.daily.rows).toEqual([
      { key: "2025-01-01", count: 2, partial: false },
    ]);
    expect(presentation.trends.monthly.rows[0]).toEqual({
      key: "2025-01",
      count: 2,
      partial: true,
    });
    expect(presentation.senderComparison.rows).toEqual([
      { sender: "owner", count: 2, share: 1, displayShare: "100.0%" },
      { sender: "other", count: 0, share: 0, displayShare: "0.0%" },
    ]);
    expect(presentation.hourActivity.rows[8]).toEqual({
      key: "08",
      count: 2,
      share: 1,
      displayShare: "100.0%",
    });
    expect(presentation.weekdayActivity.rows.map((row) => row.key)).toEqual([
      "周一",
      "周二",
      "周三",
      "周四",
      "周五",
      "周六",
      "周日",
    ]);
    expect(presentation.chatActivity.streaks.rows).toEqual([
      { startDate: "2025-01-01", endDate: "2025-01-01", length: 1 },
    ]);
    expect(presentation.definitions.timezone).toContain("UTC+08:00");
    expect(presentation.definitions.comparativeSenderScope).toContain("忽略");
  });

  it("rounds shares only in display fields and keeps null unavailable", () => {
    const fixture = activityFixture();
    const presentation = toActivityPresentation({
      ...fixture,
      senderComparison: {
        ...fixture.senderComparison,
        owner: { sender: "owner", count: 1, share: null },
        other: { sender: "other", count: 1, share: null },
        denominator: 2,
      },
    });
    expect(presentation.senderComparison.rows[0]).toEqual({
      sender: "owner",
      count: 1,
      share: null,
      displayShare: "—",
    });
  });
});
