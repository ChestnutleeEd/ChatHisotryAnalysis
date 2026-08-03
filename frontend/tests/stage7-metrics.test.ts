import { describe, expect, it } from "vitest";

import {
  CANONICAL_MESSAGE_CATEGORIES,
  type CanonicalEventV2,
} from "../src/canonical-v2/schema";
import {
  createSharedAggregate,
  type SharedAggregateAccumulator,
} from "../src/worker-analysis/analytics-aggregates";
import {
  deriveActivityMetrics,
} from "../src/worker-analysis/activity-metrics";
import type { CanonicalAnalysisFilters } from "../src/worker-analysis/analytics-contract";
import { CanonicalIndexBuilder } from "../src/worker-analysis/canonical-index";
import {
  deriveStage7Metrics,
  validateStage7Metrics,
} from "../src/worker-analysis/stage7-metrics";
import { toStage7Presentation } from "../src/presentation/stage7-presentation";
import { WorkerCancellation } from "../src/worker-analysis/worker-runtime";
import { canonicalEvent, canonicalFilters } from "./canonical-analytics-fixtures";

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

function stage7Context(
  events: readonly CanonicalEventV2[],
  tokens: readonly (readonly string[])[],
  filters: CanonicalAnalysisFilters,
) {
  const builder = new CanonicalIndexBuilder(events.length);
  events.forEach((event, index) => {
    builder.append(event, tokens[index] ?? []);
  });
  const index = builder.finish(datasetSummary(events));
  const shared: SharedAggregateAccumulator = createSharedAggregate(index, filters);
  const activity = deriveActivityMetrics(shared, filters);
  return { index, shared, activity, filters };
}

async function stage7(
  events: readonly CanonicalEventV2[],
  tokens: readonly (readonly string[])[],
  filters: CanonicalAnalysisFilters,
) {
  const { index, shared, activity } = stage7Context(events, tokens, filters);
  return deriveStage7Metrics(index, shared, activity, filters, async () => undefined);
}

describe("Stage 7 deterministic metrics", () => {
  it("reuses cached code-point lengths and excludes media from the length domain", async () => {
    const events = [
      canonicalEvent(localTime("2024-01-01 08:00:00"), 0, {
        content: "A😀",
      }),
      canonicalEvent(localTime("2024-01-02 08:00:00"), 1, {
        senderScope: "other",
        content: "🙂‍↔️",
      }),
      canonicalEvent(localTime("2024-01-03 08:00:00"), 2, {
        messageCategory: "image",
        textEligible: false,
        content: null,
      }),
      canonicalEvent(localTime("2024-01-04 08:00:00"), 3, {
        content: "x",
      }),
    ];
    const result = await stage7(
      events,
      [["emoji"], ["emoji"], [], ["x"]],
      canonicalFilters({ startDate: "2024-01-01", endDate: "2024-01-04" }),
    );

    expect(result.averageLength.overall).toEqual({
      count: 3,
      sum: 7,
      mean: 7 / 3,
      median: 2,
      p90: 4,
    });
    expect(result.averageLength.owner).toMatchObject({ count: 2, sum: 3, median: 1, p90: 2 });
    expect(result.averageLength.other).toMatchObject({ count: 1, sum: 4, mean: 4 });
  });

  it("builds a zero-filled cross-year top-20 vocabulary with deterministic Unicode ties", async () => {
    const events = [
      canonicalEvent(localTime("2023-01-01 08:00:00"), 0, { content: "aa bb" }),
      canonicalEvent(localTime("2023-01-02 08:00:00"), 1, { content: "aa bb" }),
      canonicalEvent(localTime("2024-01-01 08:00:00"), 2, { content: "aa cc" }),
      canonicalEvent(localTime("2025-01-01 08:00:00"), 3, {
        messageCategory: "voice",
        textEligible: false,
        content: null,
      }),
    ];
    const result = await stage7(
      events,
      [["aa", "bb"], ["aa", "bb"], ["aa", "cc"], []],
      canonicalFilters({ startDate: "2023-01-01", endDate: "2025-12-31" }),
    );

    expect(result.wordEvolution.vocabulary).toEqual(["aa", "bb", "cc"]);
    expect(result.wordEvolution.years).toEqual([
      {
        year: 2023,
        partial: false,
        totalTokenCount: 4,
        values: [
          { token: "aa", count: 2, ratePer10000: 5_000 },
          { token: "bb", count: 2, ratePer10000: 5_000 },
          { token: "cc", count: 0, ratePer10000: 0 },
        ],
      },
      {
        year: 2024,
        partial: false,
        totalTokenCount: 2,
        values: [
          { token: "aa", count: 1, ratePer10000: 5_000 },
          { token: "bb", count: 0, ratePer10000: 0 },
          { token: "cc", count: 1, ratePer10000: 5_000 },
        ],
      },
      {
        year: 2025,
        partial: false,
        totalTokenCount: 0,
        values: [
          { token: "aa", count: 0, ratePer10000: 0 },
          { token: "bb", count: 0, ratePer10000: 0 },
          { token: "cc", count: 0, ratePer10000: 0 },
        ],
      },
    ]);
  });

  it("bounds the vocabulary and returns explicit empty-scope values", async () => {
    const events = Array.from({ length: 25 }, (_, sourceIndex) =>
      canonicalEvent(localTime("2025-01-01 08:00:00") + sourceIndex, sourceIndex),
    );
    const result = await stage7(
      events,
      events.map((_, index) => [`word${String(index).padStart(2, "0")}`]),
      canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-01" }),
    );
    expect(result.wordEvolution.vocabulary).toHaveLength(20);
    expect(result.wordEvolution.vocabulary).toEqual(
      Array.from({ length: 20 }, (_, index) => `word${String(index).padStart(2, "0")}`),
    );

    const empty = await stage7(
      [canonicalEvent(localTime("2025-01-01 08:00:00"), 0, {
        messageCategory: "image",
        textEligible: false,
        content: null,
      })],
      [[]],
      canonicalFilters({ startDate: "2026-01-01", endDate: "2026-01-01" }),
    );
    expect(empty.wordEvolution).toMatchObject({ vocabulary: [], years: [] });
    expect(empty.averageLength.overall).toEqual({
      count: 0,
      sum: 0,
      mean: null,
      median: null,
      p90: null,
    });
    expect(empty.messageTypes).toMatchObject({ denominator: 0, eligibleTextCount: 0 });
    expect(empty.messageTypes.categories.every((bucket) => bucket.share === null)).toBe(true);
  });

  it("applies keyword count/DF thresholds and exposes positive log-odds traces", async () => {
    const events: CanonicalEventV2[] = [];
    const tokens: string[][] = [];
    let sourceIndex = 0;
    for (let index = 0; index < 5; index += 1) {
      events.push(canonicalEvent(localTime(`2023-01-0${index + 1} 08:00:00`), sourceIndex));
      tokens.push(["spike"]);
      sourceIndex += 1;
    }
    events.push(canonicalEvent(localTime("2023-01-06 08:00:00"), sourceIndex));
    tokens.push(["burst", "burst", "burst", "burst", "burst"]);
    sourceIndex += 1;
    for (let index = 0; index < 5; index += 1) {
      events.push(
        canonicalEvent(localTime(`2024-01-0${index + 1} 08:00:00`), sourceIndex, {
          senderScope: "other",
        }),
      );
      tokens.push(["rest"]);
      sourceIndex += 1;
    }
    const filters = canonicalFilters({
      startDate: "2023-01-01",
      endDate: "2024-12-31",
      selectedYear: 2023,
    });
    const result = await stage7(events, tokens, filters);
    const selected = result.yearlyKeywords.years.find((year) => year.year === 2023);
    expect(selected).toMatchObject({ mode: "log-odds", omissionReason: null });
    expect(selected?.keywords[0]).toMatchObject({
      token: "spike",
      count: 5,
      distinctMessageFrequency: 5,
      yearTokenTotal: 10,
      restCount: 0,
      restTokenTotal: 5,
    });
    expect(selected?.keywords[0]?.score).toBeGreaterThan(0);
    expect(selected?.keywords.some((keyword) => keyword.token === "burst")).toBe(false);

    const fallback = await stage7(
      events.slice(0, 6),
      tokens.slice(0, 6),
      canonicalFilters({
        startDate: "2023-01-01",
        endDate: "2023-12-31",
        selectedYear: 2023,
      }),
    );
    expect(fallback.yearlyKeywords.years[0]).toMatchObject({
      mode: "frequency-fallback",
    });
    expect(fallback.yearlyKeywords.years[0]?.keywords[0]?.score).toBeNull();
  });

  it("uses Unicode order for keyword ties and labels no-candidate years", async () => {
    const events: CanonicalEventV2[] = [];
    const tokens: string[][] = [];
    for (let index = 0; index < 3; index += 1) {
      events.push(canonicalEvent(localTime(`2023-01-0${index + 1} 08:00:00`), index));
      tokens.push(["😀", "😀", "😀", "😀", "😀", "α", "α", "α", "α", "α"]);
    }
    for (let index = 0; index < 3; index += 1) {
      const sourceIndex = index + 3;
      events.push(canonicalEvent(localTime(`2024-01-0${index + 1} 08:00:00`), sourceIndex));
      tokens.push(["beta"]);
    }
    const result = await stage7(
      events,
      tokens,
      canonicalFilters({ startDate: "2023-01-01", endDate: "2024-12-31" }),
    );
    const year2023 = result.yearlyKeywords.years.find((year) => year.year === 2023);
    const year2024 = result.yearlyKeywords.years.find((year) => year.year === 2024);
    expect(year2023?.keywords.map((keyword) => keyword.token)).toEqual(["α", "😀"]);
    expect(year2024).toMatchObject({ mode: "insufficient-evidence", omissionReason: "NO_CANDIDATE_TOKENS", keywords: [] });
  });

  it("reconciles every stable category, unknown, eligible subset, and system diagnostic", async () => {
    const events: CanonicalEventV2[] = [];
    const tokens: string[][] = [];
    let sourceIndex = 0;
    for (const category of CANONICAL_MESSAGE_CATEGORIES) {
      const isSystem = category === "system";
      events.push(
        canonicalEvent(localTime("2025-01-01 08:00:00") + sourceIndex, sourceIndex, {
          senderScope: isSystem ? null : sourceIndex % 2 === 0 ? "owner" : "other",
          messageCategory: category,
          textEligible: category === "text" && sourceIndex === 0,
          content: category === "text" && sourceIndex === 0 ? "eligible" : null,
        }),
      );
      tokens.push(category === "text" && sourceIndex === 0 ? ["eligible"] : []);
      sourceIndex += 1;
    }
    events.push(
      canonicalEvent(localTime("2025-01-01 09:00:00"), sourceIndex, {
        senderScope: "owner",
        messageCategory: "text",
        textEligible: false,
        content: null,
      }),
    );
    tokens.push([]);
    const filters = canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-01" });
    const result = await stage7(events, tokens, filters);
    expect(result.messageTypes.denominator).toBe(CANONICAL_MESSAGE_CATEGORIES.length);
    expect(result.messageTypes.systemDiagnosticCount).toBe(1);
    expect(result.messageTypes.categories.map((bucket) => bucket.count)).toEqual(
      CANONICAL_MESSAGE_CATEGORIES.map((category) => (category === "text" ? 2 : category === "system" ? 0 : 1)),
    );
    expect(result.messageTypes.eligibleTextCount).toBe(1);

    const owner = await stage7(events, tokens, { ...filters, sender: "owner" });
    expect(owner.messageTypes.denominator).toBe(8);
    expect(owner.messageTypes.systemDiagnosticCount).toBe(1);
    expect(owner.messageTypes.categories.reduce((total, bucket) => total + bucket.count, 0)).toBe(8);
  });

  it("keeps summary clauses fixed, traceable, local, and content-free", async () => {
    const filters = canonicalFilters({ selectedYear: 2025 });
    const result = await stage7(
      [canonicalEvent(localTime("2025-01-01 08:00:00"), 0, { content: "safe token" })],
      [["safe", "token"]],
      filters,
    );
    validateStage7Metrics(result, filters);
    const presentation = toStage7Presentation(result);
    expect(presentation.length.columns).toEqual(["scope", "count", "sum", "mean", "median", "p90"]);
    expect(presentation.length.rows.map((row) => row.scope)).toEqual(["overall", "owner", "other"]);
    expect(presentation.words.columns).toEqual(["year", "partial", "token total", "values"]);
    expect(presentation.types.rows).toHaveLength(CANONICAL_MESSAGE_CATEGORIES.length);
    expect(presentation.types.rows[0]).toMatchObject({ category: "text", count: 1, displayShare: "100.0%" });
    expect(result.summary.clauses.map((clause) => clause.id)).toEqual([
      "user-message-total",
      "sender-comparison",
      "chat-days",
      "peak-month",
      "peak-hour",
      "message-types",
    ]);
    expect(JSON.stringify(result.summary)).not.toMatch(/sentiment|relationship|psychological|quality|affection|care/iu);
    expect(JSON.stringify(result.summary)).not.toMatch(/\/|\\|\.json|\/Users|C:\\?/u);
    expect(() => validateStage7Metrics({ ...result, messageTypes: { ...result.messageTypes, denominator: 9 } }, filters)).toThrow();
    expect(() => validateStage7Metrics({
      ...result,
      summary: {
        ...result.summary,
        clauses: [{ ...result.summary.clauses[0]!, text: "关系质量结论" }, ...result.summary.clauses.slice(1)],
      },
    }, filters)).toThrow();
  });

  it("lists tied monthly and hourly peaks in canonical order", async () => {
    const filters = canonicalFilters({ startDate: "2025-01-01", endDate: "2025-02-01", selectedYear: 2025 });
    const result = await stage7(
      [
        canonicalEvent(localTime("2025-01-01 08:00:00"), 0),
        canonicalEvent(localTime("2025-02-01 09:00:00"), 1),
      ],
      [["alpha"], ["beta"]],
      filters,
    );
    expect(result.summary.clauses.find((clause) => clause.id === "peak-month")?.text).toContain("2025-01、2025-02");
    expect(result.summary.clauses.find((clause) => clause.id === "peak-hour")?.text).toContain("08、09");
  });

  it("checks cancellation between Stage 7 derivation phases", async () => {
    const filters = canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-02" });
    const context = stage7Context(
      [
        canonicalEvent(localTime("2025-01-01 08:00:00"), 0, { content: "alpha beta" }),
        canonicalEvent(localTime("2025-01-02 08:00:00"), 1, { content: "beta gamma" }),
      ],
      [["alpha", "beta"], ["beta", "gamma"]],
      filters,
    );
    let checkpoints = 0;
    await expect(
      deriveStage7Metrics(
        context.index,
        context.shared,
        context.activity,
        filters,
        async () => {
          checkpoints += 1;
          if (checkpoints === 3) {
            throw new WorkerCancellation();
          }
        },
      ),
    ).rejects.toBeInstanceOf(WorkerCancellation);
    expect(checkpoints).toBe(3);
  });
});
