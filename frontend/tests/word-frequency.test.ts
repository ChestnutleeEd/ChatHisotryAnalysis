import { describe, expect, it, vi } from "vitest";

import type {
  DatasetId,
  Generation,
  SessionId,
} from "../src/desktop/ipc-contract";
import { BrowserFileDatasetSource } from "../src/worker-analysis/dataset-byte-source";
import type { CanonicalAnalysisResult } from "../src/worker-analysis/analytics-contract";
import {
  AnalysisWorkerRuntime,
  WorkerCancellation,
} from "../src/worker-analysis/worker-runtime";
import {
  MAX_WORD_FREQUENCY_CANDIDATES,
  WORD_FREQUENCY_QUERY_SCHEMA_VERSION,
  frequencyDtoKey,
  validateWorkerWordFrequencyDtoV1,
  type WorkerWordFrequencyQueryV1,
  type WordFrequencyRole,
} from "../src/worker-analysis/word-frequency-contract";
import {
  BETA_VOCABULARY_POLICY_HASH,
  BETA_VOCABULARY_POLICY_VERSION,
  betaVocabularyPolicyDecision,
} from "../src/worker-analysis/vocabulary-policy";
import {
  canonicalEvent,
  canonicalFilters,
  createCanonicalDataset,
} from "./canonical-analytics-fixtures";

const SESSION = "ses_00000000000000000000000000000031" as SessionId;
const DATASET = "dat_00000000000000000000000000000031" as DatasetId;
const GENERATION = 1 as Generation;

function epoch(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 1_000;
}

function createRuntime(
  onProgress: ConstructorParameters<typeof AnalysisWorkerRuntime>[2] = () => undefined,
) {
  const tokenizer = {
    initialize: vi.fn(async () => undefined),
    cutWithoutHmm: vi.fn((value: string) => value.split(/\s+/u)),
  };
  return {
    runtime: new AnalysisWorkerRuntime(tokenizer, "the\nand\n的\n", onProgress),
    tokenizer,
  };
}

function query(
  baseQueryKey: string,
  role: WordFrequencyRole,
): WorkerWordFrequencyQueryV1 {
  return {
    schemaVersion: WORD_FREQUENCY_QUERY_SCHEMA_VERSION,
    baseQueryKey,
    role,
    policy: {
      version: BETA_VOCABULARY_POLICY_VERSION,
      builtInPolicyHash: BETA_VOCABULARY_POLICY_HASH,
    },
  };
}

async function loadScopedRuntime() {
  const { runtime, tokenizer } = createRuntime();
  const events = [
    canonicalEvent(epoch(2024, 1, 1), 0, {
      senderScope: "owner",
      content: "alpha alpha beta API",
    }),
    canonicalEvent(epoch(2024, 6, 30), 1, {
      senderScope: "other",
      content: "alpha gamma the",
    }),
    canonicalEvent(epoch(2025, 1, 1), 2, {
      senderScope: "owner",
      content: "beta beta delta png",
    }),
    canonicalEvent(epoch(2025, 8, 1), 3, {
      senderScope: "other",
      content: "beta delta epsilon",
    }),
    canonicalEvent(epoch(2026, 1, 1), 4, {
      senderScope: "owner",
      messageCategory: "image",
      textEligible: false,
      content: null,
    }),
  ];
  const accepted = await runtime.loadDataset(
    1,
    new BrowserFileDatasetSource(createCanonicalDataset(events).files),
    { minimumTokenLength: 2, additionalStopWords: [] },
    { generation: GENERATION, sequence: 1 },
    { sessionId: SESSION, datasetId: DATASET, generation: GENERATION },
  );
  return {
    runtime,
    tokenizer,
    initial: accepted.result as CanonicalAnalysisResult,
  };
}

describe("Beta B3 scoped word-frequency Worker DTO", () => {
  it("returns global both/owner/other counts with role-specific denominators", async () => {
    const { runtime, initial, tokenizer } = await loadScopedRuntime();
    const both = await runtime.analyzeWordFrequency(2, query(initial.queryKey, "both"));
    const owner = await runtime.analyzeWordFrequency(3, query(initial.queryKey, "owner"));
    const other = await runtime.analyzeWordFrequency(4, query(initial.queryKey, "other"));

    expect(both.denominator).toEqual({
      eligibleTokenCount: 12,
      definition: "eligible-token-after-built-in-policy.v1",
      status: "ready",
      emptyReason: null,
    });
    expect(owner.denominator.eligibleTokenCount).toBe(7);
    expect(other.denominator.eligibleTokenCount).toBe(5);
    expect(both.items.slice(0, 3)).toMatchObject([
      { normalizedToken: "beta", count: 4, rank: 1 },
      { normalizedToken: "alpha", count: 3, rank: 2 },
      { normalizedToken: "delta", count: 2, rank: 3 },
    ]);
    expect(both.items[0]?.ratePer10000).toBe((4 * 10_000) / 12);
    expect(owner.items.find((item) => item.normalizedToken === "api")?.count).toBe(1);
    expect(both.items.some((item) => item.normalizedToken === "png")).toBe(false);
    expect(tokenizer.cutWithoutHmm).toHaveBeenCalledTimes(4);
  });

  it("uses the committed effective range and exact represented year without cross-year fallback", async () => {
    const { runtime } = await loadScopedRuntime();
    const year2025 = await runtime.analyze(2, {
      kind: "canonical-v2",
      ...canonicalFilters({
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        selectedYear: 2025,
      }),
    }) as CanonicalAnalysisResult;
    const annual = await runtime.analyzeWordFrequency(3, query(year2025.queryKey, "both"));
    const annualOwner = await runtime.analyzeWordFrequency(4, query(year2025.queryKey, "owner"));
    const annualOther = await runtime.analyzeWordFrequency(5, query(year2025.queryKey, "other"));
    expect(annual.scope.year).toBe(2025);
    expect(annual.denominator.eligibleTokenCount).toBe(6);
    expect(annual.items).toMatchObject([
      { normalizedToken: "beta", count: 3 },
      { normalizedToken: "delta", count: 2 },
      { normalizedToken: "epsilon", count: 1 },
    ]);
    expect(annualOwner.denominator.eligibleTokenCount).toBe(3);
    expect(annualOwner.items).toMatchObject([
      { normalizedToken: "beta", count: 2 },
      { normalizedToken: "delta", count: 1 },
    ]);
    expect(annualOther.denominator.eligibleTokenCount).toBe(3);
    expect(annualOther.items).toMatchObject([
      { normalizedToken: "beta", count: 1 },
      { normalizedToken: "delta", count: 1 },
      { normalizedToken: "epsilon", count: 1 },
    ]);

    const partial = await runtime.analyze(6, {
      kind: "canonical-v2",
      ...canonicalFilters({
        startDate: "2025-08-01",
        endDate: "2025-08-01",
        selectedYear: 2025,
      }),
    }) as CanonicalAnalysisResult;
    const partialDto = await runtime.analyzeWordFrequency(7, query(partial.queryKey, "both"));
    expect(partialDto.denominator.eligibleTokenCount).toBe(3);
    expect(partialDto.items.map((item) => item.normalizedToken)).toEqual([
      "beta",
      "delta",
      "epsilon",
    ]);

    const absent = await runtime.analyze(8, {
      kind: "canonical-v2",
      ...canonicalFilters({
        startDate: "2024-01-01",
        endDate: "2026-01-01",
        selectedYear: 2030,
      }),
    }) as CanonicalAnalysisResult;
    const empty = await runtime.analyzeWordFrequency(9, query(absent.queryKey, "both"));
    expect(empty.denominator).toMatchObject({
      eligibleTokenCount: 0,
      status: "empty",
      emptyReason: "NO_ELIGIBLE_TOKENS",
    });
    expect(empty.items).toEqual([]);
    expect(JSON.stringify(empty)).not.toMatch(/NaN|Infinity/u);
  });

  it("has exact envelope/item keys, stable identity/order, and no duplicated or private fields", async () => {
    const { runtime, initial } = await loadScopedRuntime();
    const first = await runtime.analyzeWordFrequency(2, query(initial.queryKey, "both"));
    const cached = await runtime.analyzeWordFrequency(3, query(initial.queryKey, "both"));
    expect(cached).toBe(first);
    expect(validateWorkerWordFrequencyDtoV1(first)).toBe(first);
    expect(Object.keys(first).sort()).toEqual([
      "denominator",
      "identity",
      "items",
      "policy",
      "schemaVersion",
      "scope",
    ]);
    expect(Object.keys(first.items[0] ?? {}).sort()).toEqual([
      "category",
      "count",
      "normalizedToken",
      "qualityFlags",
      "rank",
      "ratePer10000",
    ]);
    expect(first.identity.frequencyDtoKey).toBe(
      frequencyDtoKey(DATASET, GENERATION, initial.queryKey, "both"),
    );
    expect(JSON.stringify(first)).not.toMatch(
      /content|canonicalEvents|sourceName|sourcePath|contact|context|displayToken|customHidden/iu,
    );
  });

  it("keeps the frequency cache bounded to eight complete envelopes", async () => {
    const { runtime, initial } = await loadScopedRuntime();
    const first = await runtime.analyzeWordFrequency(2, query(initial.queryKey, "both"));
    await runtime.analyzeWordFrequency(3, query(initial.queryKey, "owner"));
    await runtime.analyzeWordFrequency(4, query(initial.queryKey, "other"));
    const ownerBase = await runtime.analyze(5, {
      kind: "canonical-v2",
      ...canonicalFilters({
        startDate: "2024-01-01",
        endDate: "2026-01-01",
        sender: "owner",
      }),
    }) as CanonicalAnalysisResult;
    await runtime.analyzeWordFrequency(6, query(ownerBase.queryKey, "both"));
    await runtime.analyzeWordFrequency(7, query(ownerBase.queryKey, "owner"));
    await runtime.analyzeWordFrequency(8, query(ownerBase.queryKey, "other"));
    const yearBase = await runtime.analyze(9, {
      kind: "canonical-v2",
      ...canonicalFilters({
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        selectedYear: 2025,
      }),
    }) as CanonicalAnalysisResult;
    await runtime.analyzeWordFrequency(10, query(yearBase.queryKey, "both"));
    await runtime.analyzeWordFrequency(11, query(yearBase.queryKey, "owner"));
    await runtime.analyzeWordFrequency(12, query(yearBase.queryKey, "other"));
    const recomputed = await runtime.analyzeWordFrequency(13, query(initial.queryKey, "both"));
    expect(recomputed).not.toBe(first);
    expect(recomputed).toEqual(first);
  });

  it("bounds candidates at 400 and breaks equal-count ties by Unicode code point", async () => {
    function token(index: number): string {
      let value = index;
      let suffix = "";
      do {
        suffix = String.fromCharCode(97 + (value % 26)) + suffix;
        value = Math.floor(value / 26) - 1;
      } while (value >= 0);
      return `term${suffix}`;
    }
    const content = Array.from({ length: 405 }, (_, index) => token(index)).reverse().join(" ");
    const events = [canonicalEvent(epoch(2025, 1, 1), 0, { content })];
    const { runtime } = createRuntime();
    const accepted = await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(createCanonicalDataset(events).files),
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION, sequence: 1 },
      { sessionId: SESSION, datasetId: DATASET, generation: GENERATION },
    );
    const base = accepted.result as CanonicalAnalysisResult;
    const result = await runtime.analyzeWordFrequency(2, query(base.queryKey, "both"));
    expect(result.items).toHaveLength(MAX_WORD_FREQUENCY_CANDIDATES);
    expect(result.items.map((item) => item.normalizedToken)).toEqual(
      [...result.items.map((item) => item.normalizedToken)].sort(),
    );
    expect(result.items[0]?.rank).toBe(1);
    expect(result.items.at(-1)?.rank).toBe(400);
  });

  it("freezes built-in quality exclusions while preserving abbreviations", () => {
    const stopWords = new Set(["the", "的"]);
    for (const token of [
      "the",
      "42",
      "png",
      "a",
      "a".repeat(33),
      "ab\u200bcd",
      "bad_fragment",
      "https://example.com",
      "emoji😀",
    ]) {
      expect(betaVocabularyPolicyDecision(token, stopWords).eligible).toBe(false);
    }
    expect(betaVocabularyPolicyDecision("ＡＰＩ", stopWords).eligible).toBe(false);
    expect(betaVocabularyPolicyDecision("api", stopWords)).toMatchObject({
      eligible: true,
      category: "latin",
    });
    expect(betaVocabularyPolicyDecision("项目api", stopWords)).toEqual({
      eligible: true,
      category: "mixed",
      qualityFlags: ["uncertain-fragment"],
    });
  });

  it("keeps metric and presentation-only state out of the analytical identity", async () => {
    const { initial } = await loadScopedRuntime();
    const key = frequencyDtoKey(DATASET, GENERATION, initial.queryKey, "both");
    expect(key).not.toMatch(/raw-count|per-10000|hidden|route|viewport|layout/u);
    expect(frequencyDtoKey(DATASET, GENERATION, initial.queryKey, "owner")).not.toBe(key);
    expect(
      frequencyDtoKey(
        DATASET,
        GENERATION,
        initial.queryKey,
        "both",
        "beta-vocabulary-policy.v2" as never,
      ),
    ).not.toBe(key);
  });

  it("cancels a superseded frequency scan and allows the newer role result", async () => {
    const runtimeRef: { current?: AnalysisWorkerRuntime } = {};
    const runtime = createRuntime((progress) => {
      if (progress.operationId === 2 && progress.phase === "aggregation" && progress.completed >= 4_096) {
        runtimeRef.current?.cancel(2);
      }
    }).runtime;
    runtimeRef.current = runtime;
    const events = Array.from({ length: 5_000 }, (_, sourceIndex) =>
      canonicalEvent(epoch(2025, 1, 1) + sourceIndex, sourceIndex, {
        senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
        content: "alpha beta",
      }),
    );
    const accepted = await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(createCanonicalDataset(events).files),
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION, sequence: 1 },
      { sessionId: SESSION, datasetId: DATASET, generation: GENERATION },
    );
    const base = accepted.result as CanonicalAnalysisResult;
    await expect(runtime.analyzeWordFrequency(2, query(base.queryKey, "both")))
      .rejects.toBeInstanceOf(WorkerCancellation);
    const owner = await runtime.analyzeWordFrequency(3, query(base.queryKey, "owner"));
    expect(owner.scope.role).toBe("owner");
    expect(owner.denominator.eligibleTokenCount).toBe(5_000);
  });
});
