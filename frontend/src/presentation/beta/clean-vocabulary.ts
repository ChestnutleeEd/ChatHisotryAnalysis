export const BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION =
  "beta-vocabulary-clean-presentation.v1" as const;

export const VOCABULARY_CLEAN_MODE_STORAGE_KEY =
  "chat-history-analysis.beta.vocabulary-clean-mode.v1";
export const VOCABULARY_CLEAN_MODE_STORAGE_VERSION =
  "chat-history-analysis.vocabulary-clean-mode.v1" as const;

const CHINESE_CLEAN_WORDS = [
  "但是", "不过", "可是", "虽然", "然后", "所以", "因为", "如果", "而且", "并且",
  "或者", "还是", "以及", "可以", "可能", "这个", "那个", "一个", "一下", "现在",
  "已经", "就是", "觉得", "知道", "看看", "感觉", "应该", "其实", "比较", "还有",
  "没有", "不是", "怎么", "什么", "这样", "那样", "之前", "之后", "以后", "刚刚",
  "刚才", "好的", "好像", "的话", "有点", "一点", "不会", "不要", "要是", "回来",
  "出去", "出来",
] as const;

const ENGLISH_CLEAN_WORDS = [
  "the", "a", "an", "and", "or", "but", "so", "because", "if", "then", "this", "that",
  "these", "those", "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "can", "could", "would", "should", "will", "just", "really",
  "maybe", "probably", "also", "still", "already", "very",
] as const;

export const BETA_VOCABULARY_CLEAN_CHINESE_COUNT = CHINESE_CLEAN_WORDS.length;
export const BETA_VOCABULARY_CLEAN_ENGLISH_COUNT = ENGLISH_CLEAN_WORDS.length;
export const BETA_VOCABULARY_CLEAN_LEXICON_SIZE =
  BETA_VOCABULARY_CLEAN_CHINESE_COUNT + BETA_VOCABULARY_CLEAN_ENGLISH_COUNT;

const CLEAN_WORD_SET: ReadonlySet<string> = new Set([
  ...CHINESE_CLEAN_WORDS,
  ...ENGLISH_CLEAN_WORDS,
]);

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

function normalizedToken(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

export function isCleanVocabularyToken(value: string): boolean {
  return CLEAN_WORD_SET.has(normalizedToken(value));
}

export function readVocabularyCleanMode(storage?: StorageLike): boolean {
  const target = storage ?? browserStorage();
  if (target === undefined) {
    return true;
  }
  try {
    const raw = target.getItem(VOCABULARY_CLEAN_MODE_STORAGE_KEY);
    if (raw === null) {
      return true;
    }
    const value = JSON.parse(raw) as unknown;
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "enabled,version"
    ) {
      return true;
    }
    const record = value as Record<string, unknown>;
    return record.version === VOCABULARY_CLEAN_MODE_STORAGE_VERSION &&
      typeof record.enabled === "boolean"
      ? record.enabled
      : true;
  } catch {
    return true;
  }
}

export function writeVocabularyCleanMode(
  enabled: boolean,
  storage?: StorageLike,
): boolean {
  const target = storage ?? browserStorage();
  if (target !== undefined) {
    try {
      target.setItem(VOCABULARY_CLEAN_MODE_STORAGE_KEY, JSON.stringify({
        version: VOCABULARY_CLEAN_MODE_STORAGE_VERSION,
        enabled,
      }));
    } catch {
      // Preference persistence failure leaves the in-memory presentation usable.
    }
  }
  return enabled;
}
