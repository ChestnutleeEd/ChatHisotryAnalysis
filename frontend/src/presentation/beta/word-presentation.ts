import type { CanonicalAnalysisResult } from "../../worker-analysis/analytics-contract";
import type {
  WorkerWordFrequencyDtoV1,
  WorkerWordFrequencyItemV1,
} from "../../worker-analysis/word-frequency-contract";
import {
  BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION,
  isCleanVocabularyToken,
} from "./clean-vocabulary";

export const CUSTOM_HIDDEN_WORDS_STORAGE_KEY =
  "chat-history-analysis.beta.custom-hidden-words.v1";
export const CUSTOM_HIDDEN_WORDS_STORAGE_VERSION =
  "chat-history-analysis.custom-hidden-words.v1" as const;
export const MAX_CUSTOM_HIDDEN_WORDS = 200;
export const MAX_WORD_EVIDENCE_ITEMS = 20;
export const MAX_KEYWORD_EVIDENCE_ITEMS = 10;

export type WordFrequencyMetric = "raw-count" | "per-10000-eligible-tokens";

export interface WordFrequencyPresentationItem {
  readonly displayToken: string;
  readonly normalizedToken: string;
  readonly count: number;
  readonly ratePer10000: number;
  readonly sourceRank: number;
  readonly displayRank: number;
  readonly category: WorkerWordFrequencyItemV1["category"];
  readonly qualityFlags: WorkerWordFrequencyItemV1["qualityFlags"];
}

export interface WordFrequencyPresentation {
  readonly status: "ready" | "empty" | "unavailable";
  readonly metric: WordFrequencyMetric;
  readonly denominator: WorkerWordFrequencyDtoV1["denominator"] | null;
  readonly role: WorkerWordFrequencyDtoV1["scope"]["role"];
  readonly year: number | null;
  readonly frequencyDtoKey: string | null;
  readonly items: readonly WordFrequencyPresentationItem[];
  readonly hiddenCandidateCount: number;
  readonly cleanHiddenCandidateCount: number;
  readonly customHiddenCandidateCount: number;
  readonly boundedPoolExhausted: boolean;
}

export interface KeywordPresentationItem {
  readonly displayToken: string;
  readonly normalizedToken: string;
  readonly count: number;
  readonly sourceRank: number;
  readonly displayRank: number;
}

export interface KeywordPresentation {
  readonly year: number | null;
  readonly mode: "log-odds" | "frequency-fallback" | "insufficient-evidence" | "unavailable";
  readonly explanation: string;
  readonly items: readonly KeywordPresentationItem[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

const CONTROL_OR_INVISIBLE_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function normalizeCustomHiddenWord(value: string): string | null {
  const normalized = value.normalize("NFKC").toLowerCase().trim();
  if (
    normalized === "" ||
    [...normalized].length > 32 ||
    CONTROL_OR_INVISIBLE_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function parseCustomHiddenWords(value: string): readonly string[] {
  const result = new Set<string>();
  for (const piece of value.split(/[\n,，]+/u)) {
    const normalized = normalizeCustomHiddenWord(piece);
    if (normalized !== null) {
      result.add(normalized);
      if (result.size >= MAX_CUSTOM_HIDDEN_WORDS) {
        break;
      }
    }
  }
  return [...result].sort();
}

export function mergeCustomHiddenWords(
  current: readonly string[],
  additions: readonly string[],
): readonly string[] {
  const result = new Set<string>();
  for (const candidate of [...current, ...additions]) {
    const normalized = normalizeCustomHiddenWord(candidate);
    if (normalized !== null) {
      result.add(normalized);
      if (result.size >= MAX_CUSTOM_HIDDEN_WORDS) {
        break;
      }
    }
  }
  return [...result].sort();
}

export function readCustomHiddenWords(
  storage?: StorageLike,
): readonly string[] {
  const target = storage ?? browserStorage();
  if (target === undefined) {
    return [];
  }
  try {
    const raw = target.getItem(CUSTOM_HIDDEN_WORDS_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const value = JSON.parse(raw) as unknown;
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "version,words"
    ) {
      return [];
    }
    const record = value as Record<string, unknown>;
    if (
      record.version !== CUSTOM_HIDDEN_WORDS_STORAGE_VERSION ||
      !Array.isArray(record.words) ||
      record.words.length > MAX_CUSTOM_HIDDEN_WORDS ||
      record.words.some((word) => typeof word !== "string")
    ) {
      return [];
    }
    return mergeCustomHiddenWords([], record.words as string[]);
  } catch {
    return [];
  }
}

export function writeCustomHiddenWords(
  words: readonly string[],
  storage?: StorageLike,
): readonly string[] {
  const normalized = mergeCustomHiddenWords([], words);
  const target = storage ?? browserStorage();
  if (target !== undefined) {
    try {
      target.setItem(CUSTOM_HIDDEN_WORDS_STORAGE_KEY, JSON.stringify({
        version: CUSTOM_HIDDEN_WORDS_STORAGE_VERSION,
        words: normalized,
      }));
    } catch {
      // Preference persistence failure does not alter the analytical result.
    }
  }
  return normalized;
}

function hiddenSet(words: readonly string[]): ReadonlySet<string> {
  return new Set(mergeCustomHiddenWords([], words));
}

export function createWordFrequencyPresentation(
  dto: WorkerWordFrequencyDtoV1 | undefined,
  customHiddenWords: readonly string[],
  metric: WordFrequencyMetric,
  visibleLimit = MAX_WORD_EVIDENCE_ITEMS,
  cleanMode = true,
): WordFrequencyPresentation {
  if (dto === undefined) {
    return {
      status: "unavailable",
      metric,
      denominator: null,
      role: "both",
      year: null,
      frequencyDtoKey: null,
      items: [],
      hiddenCandidateCount: 0,
      cleanHiddenCandidateCount: 0,
      customHiddenCandidateCount: 0,
      boundedPoolExhausted: false,
    };
  }
  const hidden = hiddenSet(customHiddenWords);
  const afterClean = cleanMode
    ? dto.items.filter((item) => !isCleanVocabularyToken(item.normalizedToken))
    : dto.items;
  const visible = afterClean.filter((item) => !hidden.has(item.normalizedToken));
  const cleanHiddenCandidateCount = dto.items.length - afterClean.length;
  const customHiddenCandidateCount = afterClean.length - visible.length;
  const items = visible.slice(0, visibleLimit).map((item, index) => ({
    displayToken: item.normalizedToken,
    normalizedToken: item.normalizedToken,
    count: item.count,
    ratePer10000: item.ratePer10000,
    sourceRank: item.rank,
    displayRank: index + 1,
    category: item.category,
    qualityFlags: item.qualityFlags,
  }));
  return {
    status: dto.denominator.status === "empty" ? "empty" : "ready",
    metric,
    denominator: dto.denominator,
    role: dto.scope.role,
    year: dto.scope.year,
    frequencyDtoKey: dto.identity.frequencyDtoKey,
    items,
    hiddenCandidateCount: cleanHiddenCandidateCount + customHiddenCandidateCount,
    cleanHiddenCandidateCount,
    customHiddenCandidateCount,
    boundedPoolExhausted:
      dto.items.length > 0 &&
      visible.length < visibleLimit &&
      cleanHiddenCandidateCount + customHiddenCandidateCount > 0,
  };
}

export function createKeywordPresentation(
  result: CanonicalAnalysisResult,
  customHiddenWords: readonly string[],
  visibleLimit = MAX_KEYWORD_EVIDENCE_ITEMS,
  cleanMode = true,
): KeywordPresentation {
  const evidence = result.stage7.yearlyKeywords;
  const year = result.filters.selectedYear;
  if (year === null) {
    return {
      year: null,
      mode: "unavailable",
      explanation: "全部年份范围不定义年度区分词；请选择一个具体年份。",
      items: [],
    };
  }
  const active = evidence.years.find((candidate) => candidate.year === year);
  if (active === undefined || evidence.activeYear !== year) {
    return {
      year,
      mode: "unavailable",
      explanation: "当前范围没有可用于年度关键词的年份证据。",
      items: [],
    };
  }
  const hidden = hiddenSet(customHiddenWords);
  const items = active.keywords
    .map((item, index) => ({ item, sourceRank: index + 1 }))
    .filter(({ item }) => !cleanMode || !isCleanVocabularyToken(item.token))
    .filter(({ item }) => !hidden.has(item.token))
    .slice(0, visibleLimit)
    .map(({ item, sourceRank }, index) => ({
      displayToken: item.token,
      normalizedToken: item.token,
      count: item.count,
      sourceRank,
      displayRank: index + 1,
    }));
  const explanation = active.mode === "log-odds"
    ? "按既有平滑的年度对比统计选出更具年度区分度的词；这里不把它们当作最高频词。"
    : active.mode === "frequency-fallback"
      ? "当前只有一个有词频证据的年份，以下内容明确使用频次回退，不宣称年度区分度。"
      : "当前年度没有达到既有候选阈值的关键词证据。";
  return {
    year,
    mode: active.mode,
    explanation,
    items,
  };
}

export function wordPresentationKey(
  frequencyDtoKeyValue: string,
  metric: WordFrequencyMetric,
  customHiddenWords: readonly string[],
  visibleLimit: number,
  cleanMode = true,
): string {
  const normalized = mergeCustomHiddenWords([], customHiddenWords);
  let hash = 2_166_136_261;
  for (const codePoint of JSON.stringify(normalized)) {
    hash ^= codePoint.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return JSON.stringify([
    "chat-history-analysis.word-presentation.v2",
    frequencyDtoKeyValue,
    metric,
    BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION,
    cleanMode,
    hash.toString(16).padStart(8, "0"),
    visibleLimit,
  ]);
}
