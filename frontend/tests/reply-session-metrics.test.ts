import { describe, expect, it } from "vitest";

import {
  CANONICAL_MESSAGE_CATEGORIES,
  type CanonicalEventV2,
} from "../src/canonical-v2/schema";
import { CanonicalIndexBuilder } from "../src/worker-analysis/canonical-index";
import {
  buildConversationSessionIndex,
  buildConversationSessionIndexAsync,
  deriveReplySessionMetrics,
} from "../src/worker-analysis/reply-session-metrics";
import { canonicalEvent, canonicalFilters } from "./canonical-analytics-fixtures";

function localTime(value: string): number {
  const [date, time] = value.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, hour - 8, minute, second) / 1000);
}

function summary(events: readonly CanonicalEventV2[]) {
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

function context(events: readonly CanonicalEventV2[]) {
  const builder = new CanonicalIndexBuilder(events.length);
  for (const event of events) {
    builder.append(event, event.textEligible ? ["synthetic"] : []);
  }
  return builder.finish(summary(events));
}

describe("Stage 8 reply interval and conversation session semantics", () => {
  it("uses strict-greater boundaries, ignores systems, collapses bursts, and crosses midnight", () => {
    const events = [
      canonicalEvent(localTime("2025-01-01 23:50:00"), 0, {
        senderScope: "owner",
      }),
      canonicalEvent(localTime("2025-01-01 23:55:00"), 1, {
        senderScope: "owner",
      }),
      canonicalEvent(localTime("2025-01-01 23:56:00"), 2, {
        senderScope: null,
        messageCategory: "system",
        textEligible: false,
        content: null,
      }),
      canonicalEvent(localTime("2025-01-02 00:55:00"), 3, {
        senderScope: "other",
      }),
      canonicalEvent(localTime("2025-01-02 00:56:00"), 4, {
        senderScope: "other",
      }),
      canonicalEvent(localTime("2025-01-02 00:56:00"), 5, {
        senderScope: "owner",
      }),
      canonicalEvent(localTime("2025-01-02 03:00:01"), 6, {
        senderScope: "owner",
      }),
    ];
    const index = context(events);
    const sessionIndex = buildConversationSessionIndex(index, 1);
    const filters = canonicalFilters({
      startDate: "2025-01-01",
      endDate: "2025-01-02",
      sender: "owner",
      sessionThresholdHours: 1,
    });
    const metrics = deriveReplySessionMetrics(index, sessionIndex, filters);

    expect(sessionIndex.sessionStarts).toHaveLength(2);
    expect(metrics.conversationSessions).toMatchObject({
      sessionCount: 2,
      sensitivityChanged: true,
      initiatorCounts: {
        owner: { count: 2, share: 1 },
        other: { count: 0, share: 0 },
        unknown: { count: 0, share: 0 },
      },
    });
    expect(metrics.replyIntervals.overall).toMatchObject({
      count: 2,
      medianSeconds: 0,
      p25Seconds: 0,
      p75Seconds: 3_600,
      p90Seconds: 3_600,
    });
    expect(metrics.replyIntervals.directions).toEqual([
      expect.objectContaining({
        direction: "owner-to-other",
        responder: "other",
        stats: expect.objectContaining({ count: 1, medianSeconds: 3_600 }),
      }),
      expect.objectContaining({
        direction: "other-to-owner",
        responder: "owner",
        stats: expect.objectContaining({ count: 1, medianSeconds: 0 }),
      }),
    ]);
  });

  it("keeps exact-threshold pairs, excludes long gaps, and filters by both boundary dates", () => {
    const events = [
      canonicalEvent(localTime("2024-12-31 23:59:00"), 0, { senderScope: "owner" }),
      canonicalEvent(localTime("2025-01-01 00:59:00"), 1, { senderScope: "other" }),
      canonicalEvent(localTime("2025-01-01 01:00:00"), 2, { senderScope: "owner" }),
      canonicalEvent(localTime("2025-01-01 08:01:01"), 3, { senderScope: "other" }),
      canonicalEvent(localTime("2025-01-02 08:01:01"), 4, { senderScope: "owner" }),
    ];
    const index = context(events);
    const sessionIndex = buildConversationSessionIndex(index, 1);
    const metrics = deriveReplySessionMetrics(
      index,
      sessionIndex,
      canonicalFilters({
        startDate: "2025-01-01",
        endDate: "2025-01-01",
        sender: "other",
        sessionThresholdHours: 1,
      }),
    );
    expect(metrics.replyIntervals.overall.count).toBe(1);
    expect(metrics.replyIntervals.directions[0]?.stats.count).toBe(0);
    expect(metrics.replyIntervals.directions[1]?.stats.count).toBe(1);
    expect(metrics.conversationSessions.sessionCount).toBe(1);
  });

  it("returns null statistics for a single sender and fixed zero bins for no replies", () => {
    const events = [
      canonicalEvent(localTime("2025-01-01 08:00:00"), 0),
      canonicalEvent(localTime("2025-01-01 08:01:00"), 1),
    ];
    const index = context(events);
    const metrics = deriveReplySessionMetrics(
      index,
      buildConversationSessionIndex(index, 6),
      canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-01" }),
    );
    expect(metrics.replyIntervals.overall).toMatchObject({
      count: 0,
      meanSeconds: null,
      medianSeconds: null,
    });
    expect(metrics.replyIntervals.overall.bins.every((bin) => bin.count === 0)).toBe(true);
    expect(metrics.conversationSessions).toMatchObject({
      sessionCount: 1,
      initiatorCounts: { owner: { count: 1, share: 1 } },
    });
    expect(() => buildConversationSessionIndex(index, 2 as never)).toThrow(
      "INVALID_SESSION_THRESHOLD",
    );
  });

  it("sorts canonical ties deterministically and repeats the same threshold byte-identically", async () => {
    const events = [
      canonicalEvent(localTime("2025-01-01 09:00:00"), 0, { senderScope: "other" }),
      canonicalEvent(localTime("2025-01-01 08:00:00"), 1, { senderScope: "owner" }),
    ];
    const index = context(events);
    const first = buildConversationSessionIndex(index, 6);
    const second = buildConversationSessionIndex(index, 6);
    expect(first.sessionStarts).toEqual(second.sessionStarts);
    expect(first.replyIntervals).toEqual(second.replyIntervals);
    const progress: number[] = [];
    const asyncIndex = await buildConversationSessionIndexAsync(index, 6, async (completed) => {
      progress.push(completed);
    });
    expect(asyncIndex).toEqual(first);
    expect(progress.at(-1)).toBe(2);
  });
});
