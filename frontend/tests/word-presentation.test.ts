import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  DatasetId,
  Generation,
} from "../src/desktop/ipc-contract";
import { BetaWordEvidenceSections } from "../src/presentation/beta/BetaWordEvidenceSections";
import {
  BETA_VOCABULARY_CLEAN_LEXICON_SIZE,
  BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION,
  VOCABULARY_CLEAN_MODE_STORAGE_KEY,
  isCleanVocabularyToken,
  readVocabularyCleanMode,
  writeVocabularyCleanMode,
} from "../src/presentation/beta/clean-vocabulary";
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
import { createWordCloudPresentation } from "../src/word-cloud-layout/presentation";

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
  datasetId: DATASET,
  generation: GENERATION,
  queryKey: baseQueryKey,
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
    const unclean = wordPresentationKey(dtoKey, "raw-count", [], 20, false);
    expect(normalized).not.toBe(raw);
    expect(hidden).not.toBe(raw);
    expect(unclean).not.toBe(raw);
    expect(frequency.identity.frequencyDtoKey).toBe(dtoKey);
    expect(baseQueryKey).not.toMatch(/raw-count|per-10000|alpha/u);
  });

  it("uses a conservative versioned clean lexicon with a default-on independent preference", () => {
    expect(BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION).toBe("beta-vocabulary-clean-presentation.v1");
    expect(BETA_VOCABULARY_CLEAN_LEXICON_SIZE).toBeGreaterThanOrEqual(80);
    expect(isCleanVocabularyToken("  但是 ")).toBe(true);
    expect(isCleanVocabularyToken("ＴＨＥ")).toBe(true);
    expect(isCleanVocabularyToken("API")).toBe(false);
    expect(isCleanVocabularyToken("ProjectAtlas")).toBe(false);

    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    expect(readVocabularyCleanMode(storage)).toBe(true);
    expect(writeVocabularyCleanMode(false, storage)).toBe(false);
    expect(readVocabularyCleanMode(storage)).toBe(false);
    expect(memory.get(VOCABULARY_CLEAN_MODE_STORAGE_KEY)).not.toMatch(/dataset|token|contact/u);
    expect(writeVocabularyCleanMode(true, storage)).toBe(true);
    expect(readVocabularyCleanMode(storage)).toBe(true);
  });

  it("refills after clean and custom filters without changing the analytical DTO", () => {
    const clean = ["但是", "然后", "所以", "这个", "已经", "the", "and", "really"];
    const meaningful = ["海边计划", "相册整理", "年度报告", "词云布局", "离线分析", "范围同步", "隐私边界"];
    const candidateDto: WorkerWordFrequencyDtoV1 = {
      ...frequency,
      items: [...clean, ...meaningful].map((normalizedToken, index) => ({
        normalizedToken,
        count: 100 - index,
        ratePer10000: 1_000 - index * 10,
        rank: index + 1,
        category: /^[a-z]+$/u.test(normalizedToken) ? "latin" : "han",
        qualityFlags: [],
      })),
    };
    const original = JSON.stringify(candidateDto);
    const cleaned = createWordFrequencyPresentation(
      candidateDto,
      ["相册整理"],
      "raw-count",
      5,
      true,
    );
    expect(cleaned.items.map((item) => item.normalizedToken)).toEqual([
      "海边计划", "年度报告", "词云布局", "离线分析", "范围同步",
    ]);
    expect(cleaned.items.map((item) => item.sourceRank)).toEqual([9, 11, 12, 13, 14]);
    expect(cleaned.items.map((item) => item.displayRank)).toEqual([1, 2, 3, 4, 5]);
    expect(cleaned.cleanHiddenCandidateCount).toBe(8);
    expect(cleaned.customHiddenCandidateCount).toBe(1);
    expect(cleaned.denominator).toBe(candidateDto.denominator);
    expect(cleaned.frequencyDtoKey).toBe(candidateDto.identity.frequencyDtoKey);
    expect(JSON.stringify(candidateDto)).toBe(original);

    const unclean = createWordFrequencyPresentation(candidateDto, ["相册整理"], "raw-count", 5, false);
    const cleanedAgain = createWordFrequencyPresentation(candidateDto, ["相册整理"], "raw-count", 5, true);
    expect(unclean.items[0]?.normalizedToken).toBe("但是");
    expect(cleanedAgain).toEqual(cleaned);
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

  it("refills keyword rows from unchanged Stage7 order and suppresses all-years claims", () => {
    const keywordTokens = [
      "但是", "然后", "所以", "这个", "已经", "就是", "其实", "还有", "the", "and",
      "海边计划", "相册整理", "年度报告", "词云布局", "离线分析", "范围同步", "隐私边界", "测试矩阵", "内容主题", "时间分布", "聊天节奏",
    ];
    const keywordResult = {
      ...result,
      stage7: {
        ...result.stage7,
        yearlyKeywords: {
          ...result.stage7.yearlyKeywords,
          activeYear: 2025,
          years: [{
            year: 2025,
            mode: "log-odds",
            keywords: keywordTokens.map((token, index) => ({
              token,
              count: 50 - index,
              score: 4 - index / 10,
              distinctMessageFrequency: 10,
              yearTokenTotal: 500,
              restCount: 2,
              restTokenTotal: 400,
            })),
          }],
        },
      },
    } as unknown as CanonicalAnalysisResult;
    const original = JSON.stringify(keywordResult.stage7.yearlyKeywords);
    const cleaned = createKeywordPresentation(keywordResult, ["相册整理"], 10, true);
    expect(cleaned.items).toHaveLength(10);
    expect(cleaned.items[0]).toMatchObject({ normalizedToken: "海边计划", sourceRank: 11, displayRank: 1 });
    expect(cleaned.items.at(-1)).toMatchObject({ normalizedToken: "聊天节奏", sourceRank: 21, displayRank: 10 });
    expect(JSON.stringify(keywordResult.stage7.yearlyKeywords)).toBe(original);

    const allYears = {
      ...keywordResult,
      filters: { ...keywordResult.filters, selectedYear: null },
    } as CanonicalAnalysisResult;
    expect(createKeywordPresentation(allYears, [], 10, true)).toMatchObject({
      year: null,
      mode: "unavailable",
      items: [],
    });
  });

  it("changes only cloud presentation/layout identity when Clean Mode toggles", () => {
    const candidateDto: WorkerWordFrequencyDtoV1 = {
      ...frequency,
      items: ["但是", "然后", "海边计划", "年度报告", "词云布局", "离线分析"].map((normalizedToken, index) => ({
        normalizedToken,
        count: 20 - index,
        ratePer10000: ((20 - index) * 10_000) / frequency.denominator.eligibleTokenCount,
        rank: index + 1,
        category: "han" as const,
        qualityFlags: [],
      })),
    };
    const clean = createWordCloudPresentation(candidateDto, [], "raw-count", 4, 1, true);
    const unclean = createWordCloudPresentation(candidateDto, [], "raw-count", 4, 1, false);
    expect(clean.frequencyDtoKey).toBe(candidateDto.identity.frequencyDtoKey);
    expect(unclean.frequencyDtoKey).toBe(candidateDto.identity.frequencyDtoKey);
    expect(clean.presentationDigest).not.toBe(unclean.presentationDigest);
    expect(clean.items.map((item) => item.normalizedToken)).toEqual(["海边计划", "年度报告", "词云布局", "离线分析"]);
    expect(unclean.items.map((item) => item.normalizedToken)).toEqual(["但是", "然后", "海边计划", "年度报告"]);
  });

  it.each([
    { role: "both" as const, year: 2025 },
    { role: "owner" as const, year: 2024 },
    { role: "other" as const, year: null },
  ])("applies identical clean semantics for $role / $year scope", ({ role, year }) => {
    const scoped = {
      ...frequency,
      scope: { ...frequency.scope, role, year },
      items: [
        { normalizedToken: "但是", count: 4, ratePer10000: 4_000, rank: 1, category: "han" as const, qualityFlags: [] },
        { normalizedToken: "内容主题", count: 3, ratePer10000: 3_000, rank: 2, category: "han" as const, qualityFlags: [] },
      ],
    };
    expect(createWordFrequencyPresentation(scoped, [], "raw-count", 1, true)).toMatchObject({
      role,
      year,
      items: [{ normalizedToken: "内容主题", sourceRank: 2, displayRank: 1 }],
    });
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
    expect(html).toContain("清空自定义隐藏");
    expect(html).toContain("已净化常用词");
    expect(html).toContain("频次回退");
    expect(html).toContain('id="word-cloud"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="beta-word-cloud-list-disclosure"');
    expect(html).not.toMatch(/beta-word-cloud-list-disclosure[^>]+open(?:=|\s|>)/u);
    expect(html).toContain("可读词频列表");
    expect(html).not.toMatch(/restCount|restTokenTotal|distinctMessageFrequency|raw score/u);
    expect(roleChange).not.toHaveBeenCalled();
  });

  it("withholds a frequency DTO whose committed query/year does not match the report", () => {
    const mismatched = {
      ...frequency,
      scope: { ...frequency.scope, year: 2024 },
    } as WorkerWordFrequencyDtoV1;
    const html = renderToStaticMarkup(createElement(BetaWordEvidenceSections, {
      result,
      frequency: mismatched,
      requestedRole: "both",
      requestedYear: 2025,
      pending: true,
      onRoleChange: () => undefined,
    }));
    expect(html).toContain("正在计算当前范围的有界词频列表");
    expect(html).not.toContain("4,000 / 万");
    expect(html).toContain("正在更新为双方2025 年范围");
    expect(html).toContain("旧范围词频与词云不会显示");
  });
});
