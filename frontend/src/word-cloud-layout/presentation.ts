import {
  createWordFrequencyPresentation,
  type WordFrequencyMetric,
} from "../presentation/beta/word-presentation";
import {
  validateWorkerWordFrequencyDtoV1,
  type WorkerWordFrequencyDtoV1,
} from "../worker-analysis/word-frequency-contract";
import {
  WORD_CLOUD_MAX_WORDS,
  presentationDigest,
  sortLayoutWords,
  type WordCloudLayoutWordV1,
} from "./contracts";

export interface WordCloudPresentationV1 {
  readonly metric: WordFrequencyMetric;
  readonly frequencyDtoKey: string;
  readonly words: readonly WordCloudLayoutWordV1[];
  readonly presentationDigest: string;
  readonly boundedPoolExhausted: boolean;
}

export function createWordCloudPresentation(
  value: unknown,
  customHiddenWords: readonly string[],
  metric: WordFrequencyMetric,
  wordLimit: number,
): WordCloudPresentationV1 {
  const dto = validateWorkerWordFrequencyDtoV1(value) as WorkerWordFrequencyDtoV1;
  if (
    !Number.isSafeInteger(wordLimit) ||
    wordLimit <= 0 ||
    wordLimit > WORD_CLOUD_MAX_WORDS
  ) {
    throw new Error("INVALID_WORD_CLOUD_PRESENTATION_LIMIT");
  }
  const presentation = createWordFrequencyPresentation(
    dto,
    customHiddenWords,
    metric,
    wordLimit,
  );
  const words = sortLayoutWords(presentation.items.map((item) => ({
    stableKey: JSON.stringify([item.normalizedToken, item.sourceRank]),
    displayToken: item.displayToken,
    displayRank: item.displayRank,
    sourceRank: item.sourceRank,
    weight: metric === "raw-count" ? item.count : item.ratePer10000,
    count: item.count,
    ratePer10000: item.ratePer10000,
    category: item.category,
  })));
  return {
    metric,
    frequencyDtoKey: dto.identity.frequencyDtoKey,
    words,
    presentationDigest: presentationDigest(words),
    boundedPoolExhausted: presentation.boundedPoolExhausted,
  };
}
