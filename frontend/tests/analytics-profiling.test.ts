import { describe, expect, it } from "vitest";

import { BrowserFileDatasetSource } from "../src/worker-analysis/dataset-byte-source";
import { AnalysisWorkerRuntime } from "../src/worker-analysis/worker-runtime";
import {
  canonicalFilters,
  createCanonicalDataset,
  syntheticAnalyticsEvents,
} from "./canonical-analytics-fixtures";

function createProfileRuntime(): AnalysisWorkerRuntime {
  return new AnalysisWorkerRuntime(
    {
      initialize: async () => undefined,
      cutWithoutHmm: (value) => value.split(/\s+/u),
    },
    "the\nand\n",
    () => undefined,
  );
}

describe("synthetic analytics profiling harness", () => {
  it("exercises multi-year chunks, category mixes, filter churn, and threshold churn in memory", async () => {
    const events = syntheticAnalyticsEvents();
    const dataset = createCanonicalDataset(events, 4_096);
    const runtime = createProfileRuntime();
    const started = performance.now();
    const accepted = await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    const summary = accepted.summary;
    if (!("schemaVersion" in summary)) {
      throw new Error("synthetic profiling dataset must use v2");
    }
    const firstDate = summary.minimumCalendarDate;
    const lastDate = summary.maximumCalendarDate;
    const firstYear = Number(firstDate.slice(0, 4));
    const lastYear = Number(lastDate.slice(0, 4));
    const settings = [
      ...(["both", "owner", "other"] as const).map((sender) => ({
        kind: "canonical-v2" as const,
        ...canonicalFilters({
          startDate: firstDate,
          endDate: lastDate,
          sender,
          selectedYear: null,
          sessionThresholdHours: 6,
        }),
      })),
      ...([1, 3, 6, 12, 24] as const).map((sessionThresholdHours) => ({
        kind: "canonical-v2" as const,
        ...canonicalFilters({
          startDate: firstDate,
          endDate: lastDate,
          selectedYear: firstYear,
          sessionThresholdHours,
        }),
      })),
      {
        kind: "canonical-v2" as const,
        ...canonicalFilters({
          startDate: `${firstYear}-01-01`,
          endDate: lastDate,
          selectedYear: lastYear,
          sessionThresholdHours: 6,
        }),
      },
    ];
    const results = [];
    for (const [index, setting] of settings.entries()) {
      results.push(await runtime.analyze(index + 2, setting));
    }
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(results).toHaveLength(settings.length);
    expect(results[0]).toMatchObject({
      aggregate: {
        eventCount: summary.eventCount,
        userMessageCount: summary.userMessageCount,
        systemEventCount: summary.systemEventCount,
      },
    });
    expect(new Set(results.map((result) => result.queryKey)).size).toBe(
      settings.length,
    );
  });
});
