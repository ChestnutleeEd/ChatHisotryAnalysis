import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  DatasetId,
  Generation,
} from "../src/desktop/ipc-contract";
import { BetaWordEvidenceSections } from "../src/presentation/beta/BetaWordEvidenceSections";
import {
  CUSTOM_HIDDEN_WORDS_STORAGE_KEY,
  MAX_CUSTOM_HIDDEN_WORDS,
  createKeywordPresentation,
  createWordFrequencyPresentation,
  mergeCustomHiddenWords,
  parseCustomHiddenWords,
  readCustomHiddenWords,
  wordPresentationKey,
  writeCustomHiddenWords,
} from "../src/presentation/beta/word-presentation";
import {
  canonicalQueryKey,
  type CanonicalAnalysisResult,
} from "../src/worker-analysis/analytics-contract";
import {
  WORD_FREQUENCY_SCHEMA_VERSION,
  WORD_FREQUENCY_TIMEZONE,
  frequencyDtoKey,
  type WorkerWordFrequencyDtoV1,
} from "../src/worker-analysis/word-frequency-contract";
import {
  BETA_VOCABULARY_DENOMINATOR_DEFINITION,
  BETA_VOCABULARY_POLICY_HASH,
  BETA_VOCABULARY_POLICY_VERSION,
} from "../src/worker-analysis/vocabulary-policy";

const DATASET = "dat_00000000000000000000000000000041" as DatasetId;
const GENERATION = 1 as Generation;
const filters = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  sender: "both" as const,
  selectedYear: 2025,
  sessionThresholdHours: 6 as const,
};
const baseQueryKey = canonicalQueryKey(DATASET, GENERATION, filters);
const dtoKey = frequencyDtoKey(DATASET, GENERATION, baseQueryKey, "both");

const frequency: WorkerWordFrequencyDtoV1 = {
  schemaVersion: WORD_FREQUENCY_SCHEMA_VERSION,
  identity: {
    datasetId: DATASET,
    generation: GENERATION,
    baseQueryKey,
    frequencyDtoKey: dtoKey,
  },
  scope: { timezone: WORD_FREQUENCY_TIMEZONE, year: 2025, role: "both" },
  denominator: {
    eligibleTokenCount: 10,
    definition: BETA_VOCABULARY_DENOMINATOR_DEFINITION,
    status: "ready",
    emptyReason: null,
  },
  policy: {
    version: BETA_VOCABULARY_POLICY_VERSION,
    builtInPolicyHash: BETA_VOCABULARY_POLICY_HASH,
  },
  items: [
    { normalizedToken: "alpha", count: 4, ratePer10000: 4_000, rank: 1, category: "latin", qualityFlags: [] },
    { normalizedToken: "beta", count: 3, ratePer10000: 3_000, rank: 2, category: "latin", qualityFlags: [] },
    { normalizedToken: "本地", count: 2, ratePer10000: 2_000, rank: 3, category: "han", qualityFlags: [] },
    { normalizedToken: "api", count: 1, ratePer10000: 1_000, rank: 4, category: "latin", qualityFlags: [] },
  ],
};

const result = {
  filters,
  stage7: {
    yearlyKeywords: {
      activeYear: 2025,
      years: [{
        year: 2025,
        mode: "frequency-fallback",
        omissionReason: null,
        keywords: [
          {
            token: "alpha",
            count: 7,
            yearTokenTotal: 20,
            restCount: 0,
            restTokenTotal: 0,
            distinctMessageFrequency: 4,
            score: null,
          },
          {
            token: "本地",
            count: 5,
            yearTokenTotal: 20,
            restCount: 0,
            restTokenTotal: 0,
            distinctMessageFrequency: 3,
            score: null,
          },
        ],
      }],
    },
  },
} as unknown as CanonicalAnalysisResult;

describe("Beta B3 word presentation boundary", () => {
  it("filters custom-hidden candidates synchronously without changing analytics", () => {
    const original = JSON.stringify(frequency);
    const presented = createWordFrequencyPresentation(
      frequency,
      ["beta"],
      "per-10000-eligible-tokens",
      3,
    );
    expect(presented.items).toMatchObject([
      { normalizedToken: "alpha", sourceRank: 1, displayRank: 1, count: 4, ratePer10000: 4_000 },
      { normalizedToken: "本地", sourceRank: 3, displayRank: 2, count: 2, ratePer10000: 2_000 },
      { normalizedToken: "api", sourceRank: 4, displayRank: 3, count: 1, ratePer10000: 1_000 },
    ]);
    expect(presented.denominator).toBe(frequency.denominator);
    expect(presented.frequencyDtoKey).toBe(dtoKey);
    expect(JSON.stringify(frequency)).toBe(original);
  });

  it("keeps display metric/custom-hidden state only in the presentation key", () => {
    const raw = wordPresentationKey(dtoKey, "raw-count", [], 20);
    const normalized = wordPresentationKey(dtoKey, "per-10000-eligible-tokens", [], 20);
    const hidden = wordPresentationKey(dtoKey, "raw-count", ["alpha"], 20);
    expect(normalized).not.toBe(raw);
    expect(hidden).not.toBe(raw);
    expect(frequency.identity.frequencyDtoKey).toBe(dtoKey);
    expect(baseQueryKey).not.toMatch(/raw-count|per-10000|alpha/u);
  });

  it("normalizes, bounds, persists, reviews, restores, and resets local hidden words", () => {
    const values = Array.from({ length: MAX_CUSTOM_HIDDEN_WORDS + 20 }, (_, index) => `word${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`);
    expect(parseCustomHiddenWords(" Alpha，ＢＥＴＡ\n本地,alpha ")).toEqual([
      "alpha",
      "beta",
      "本地",
    ]);
    expect(mergeCustomHiddenWords([], values)).toHaveLength(MAX_CUSTOM_HIDDEN_WORDS);

    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    expect(writeCustomHiddenWords([" Alpha ", "本地"], storage)).toEqual(["alpha", "本地"]);
    expect(readCustomHiddenWords(storage)).toEqual(["alpha", "本地"]);
    expect(memory.get(CUSTOM_HIDDEN_WORDS_STORAGE_KEY)).not.toContain("dataset");
    expect(writeCustomHiddenWords([], storage)).toEqual([]);
    expect(readCustomHiddenWords(storage)).toEqual([]);
  });

  it("keeps keyword distinctiveness separate and labels single-year frequency fallback", () => {
    const keywords = createKeywordPresentation(result, ["alpha"]);
    expect(keywords.mode).toBe("frequency-fallback");
    expect(keywords.explanation).toContain("频次回退");
    expect(keywords.items).toEqual([
      {
        displayToken: "本地",
        normalizedToken: "本地",
        count: 5,
        sourceRank: 2,
        displayRank: 1,
      },
    ]);
    expect(JSON.stringify(keywords)).not.toMatch(/score|restCount|distinctMessageFrequency/u);
  });

  it("renders word evidence with a real Canvas section without keyword trace fields", () => {
    const roleChange = vi.fn();
    const html = renderToStaticMarkup(createElement(BetaWordEvidenceSections, {
      result,
      frequency,
      requestedRole: "both",
      pending: false,
      onRoleChange: roleChange,
    }));
    expect(html).toContain('id="frequent-words"');
    expect(html).toContain('id="distinctive-keywords"');
    expect(html).toContain("原始次数");
    expect(html).toContain("每万词频率");
    expect(html).toContain("管理自定义隐藏词");
    expect(html).toContain("恢复默认过滤");
    expect(html).toContain("频次回退");
    expect(html).toContain('id="word-cloud"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("可读词频列表");
    expect(html).not.toMatch(/restCount|restTokenTotal|distinctMessageFrequency|raw score/u);
    expect(roleChange).not.toHaveBeenCalled();
  });
});
