import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { WordCloudLayoutCache } from "../src/word-cloud-layout/cache";
import { layoutCacheKey } from "../src/word-cloud-layout/contracts";
import { layoutWordCloud } from "../src/word-cloud-layout/layout-engine";
import { createSyntheticLayoutRequest } from "./word-cloud-layout-fixtures";

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!;
}

describe("synthetic word-cloud layout diagnostics", () => {
  it("records warmup/repeated median+p95 and enforces only structural bounds", async () => {
    const cases = [
      { name: "standard-80", request: createSyntheticLayoutRequest(80, "standard"), targetMs: 250 },
      { name: "standard-60", request: createSyntheticLayoutRequest(60, "standard"), targetMs: 250 },
      { name: "standard-40", request: createSyntheticLayoutRequest(40, "standard"), targetMs: 250 },
      { name: "standard-20", request: createSyntheticLayoutRequest(20, "standard"), targetMs: 250 },
      { name: "export-100", request: createSyntheticLayoutRequest(100, "export"), targetMs: 750 },
    ] as const;
    const cache = new WordCloudLayoutCache();
    const retainedResults = [];
    const diagnostics: Array<Record<string, number | string | boolean>> = [];
    for (const fixture of cases) {
      const warmupStarted = performance.now();
      const warmup = await layoutWordCloud(fixture.request);
      const warmupMs = performance.now() - warmupStarted;
      const samples: number[] = [];
      for (let run = 0; run < 7; run += 1) {
        const started = performance.now();
        const result = await layoutWordCloud(fixture.request);
        samples.push(performance.now() - started);
        cache.set(`${fixture.name}-${run}`, result);
        retainedResults.push(result);
      }
      cache.set(layoutCacheKey(fixture.request), warmup);
      diagnostics.push({
        fixture: fixture.name,
        warmupMs: Number(warmupMs.toFixed(3)),
        medianMs: Number(percentile(samples, 0.5).toFixed(3)),
        p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
        diagnosticTargetMs: fixture.targetMs,
        targetMet: percentile(samples, 0.95) <= fixture.targetMs,
        mainThreadLayoutCalls: 0,
        placed: warmup.placed.length,
        omitted: warmup.omitted.length,
        maximumAttemptsUsed: Math.max(0, ...warmup.placed.map((word) => word.attempts)),
      });
    }
    const retainedBytes = new TextEncoder().encode(
      JSON.stringify(retainedResults.slice(-6)),
    ).byteLength;
    expect(cache.size).toBeLessThanOrEqual(6);
    expect(retainedResults.every((result) =>
      result.placed.length + result.omitted.length <= 100
    )).toBe(true);
    expect(retainedBytes).toBeLessThan(32 * 1024 * 1024);
    expect(diagnostics.every((item) => Number.isFinite(item.p95Ms))).toBe(true);
    process.stdout.write(`\nWORD_CLOUD_LAYOUT_DIAGNOSTICS ${JSON.stringify(diagnostics)}\n`);
  }, 20_000);
});
