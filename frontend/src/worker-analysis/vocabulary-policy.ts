import { STOP_WORDS_SHA256 } from "./protocol";

export const BETA_VOCABULARY_POLICY_VERSION =
  "beta-vocabulary-policy.v1" as const;
export const BETA_VOCABULARY_POLICY_HASH =
  "35c7eaba0dfa2531db6d0ebc7b6b05b5fd53eaf1555f52a44496ea60eef10871" as const;
export const BETA_VOCABULARY_STOP_WORDS_SHA256 =
  "a967184c888afe1fe52a430ba7bf838b39390c1902e6c5b35951a6633068e54b" as const;
export const BETA_VOCABULARY_DENOMINATOR_DEFINITION =
  "eligible-token-after-built-in-policy.v1" as const;
export const MAX_BETA_TOKEN_CODE_POINTS = 32;

export const BETA_EXCLUDED_FILE_EXTENSIONS = [
  "7z",
  "avi",
  "doc",
  "docx",
  "gif",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "rar",
  "webp",
  "xls",
  "xlsx",
  "zip",
] as const;

export type WordScriptCategory = "han" | "latin" | "mixed" | "other";
export type WordQualityFlag = "uncertain-fragment";

export interface BetaVocabularyPolicyDecision {
  readonly eligible: boolean;
  readonly category: WordScriptCategory;
  readonly qualityFlags: readonly WordQualityFlag[];
}

const EXTENSIONS = new Set<string>(BETA_EXCLUDED_FILE_EXTENSIONS);
const INVISIBLE_OR_CONTROL_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const HAN_PATTERN = /^\p{Script=Han}+$/u;
const LATIN_PATTERN = /^[a-z]+$/u;
const VALID_MIXED_PATTERN = /^(?=.*\p{Script=Han})(?=.*[a-z])[\p{Script=Han}a-z]+$/u;
const NUMBER_PATTERN = /^\p{N}+$/u;
const PUNCTUATION_OR_SYMBOL_PATTERN = /[\p{P}\p{S}]/u;

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (leftPoints[index]?.codePointAt(0) ?? 0) -
      (rightPoints[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

export function betaVocabularyPolicyDecision(
  token: string,
  builtInStopWords: ReadonlySet<string>,
): BetaVocabularyPolicyDecision {
  const codePointLength = [...token].length;
  const normalized = token.normalize("NFKC").toLowerCase();
  const commonInvalid =
    token !== normalized ||
    token.trim() !== token ||
    codePointLength < 2 ||
    codePointLength > MAX_BETA_TOKEN_CODE_POINTS ||
    INVISIBLE_OR_CONTROL_PATTERN.test(token) ||
    NUMBER_PATTERN.test(token) ||
    PUNCTUATION_OR_SYMBOL_PATTERN.test(token) ||
    builtInStopWords.has(token) ||
    EXTENSIONS.has(token);
  if (commonInvalid) {
    return { eligible: false, category: "other", qualityFlags: [] };
  }
  if (HAN_PATTERN.test(token)) {
    return { eligible: true, category: "han", qualityFlags: [] };
  }
  if (LATIN_PATTERN.test(token)) {
    return { eligible: true, category: "latin", qualityFlags: [] };
  }
  if (VALID_MIXED_PATTERN.test(token)) {
    return {
      eligible: true,
      category: "mixed",
      qualityFlags: ["uncertain-fragment"],
    };
  }
  return { eligible: false, category: "other", qualityFlags: [] };
}

// This assertion keeps the frozen policy digest visibly coupled to the
// existing stopword asset identity without introducing runtime hashing.
export function assertBetaVocabularyPolicyIdentity(): void {
  if (STOP_WORDS_SHA256 !== BETA_VOCABULARY_STOP_WORDS_SHA256) {
    throw new Error("INVALID_STOP_WORD_POLICY_IDENTITY");
  }
}
