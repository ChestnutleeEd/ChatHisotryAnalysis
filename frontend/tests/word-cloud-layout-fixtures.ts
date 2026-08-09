import type { DatasetId, Generation } from "../src/desktop/ipc-contract";
import { canonicalQueryKey } from "../src/worker-analysis/analytics-contract";
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
import {
  createWordCloudLayoutRequest,
  type WordCloudLayoutRequestV1,
  type WordCloudViewportBucket,
} from "../src/word-cloud-layout/contracts";
import { createWordCloudPresentation } from "../src/word-cloud-layout/presentation";

export const LAYOUT_DATASET_A =
  "dat_000000000000000000000000000000a1" as DatasetId;
export const LAYOUT_DATASET_B =
  "dat_000000000000000000000000000000b2" as DatasetId;
export const LAYOUT_GENERATION = 1 as Generation;

export function syntheticToken(index: number): {
  readonly token: string;
  readonly category: "han" | "latin" | "mixed";
} {
  if (index % 3 === 0) {
    return { token: `本地${String.fromCodePoint(0x4e00 + index)}`, category: "han" };
  }
  if (index % 3 === 1) {
    return { token: `alpha${index.toString().padStart(3, "0")}`, category: "latin" };
  }
  return { token: `版本v${index.toString().padStart(3, "0")}`, category: "mixed" };
}

export function createSyntheticFrequencyDto(
  count: number,
  datasetId = LAYOUT_DATASET_A,
  generation = LAYOUT_GENERATION,
): WorkerWordFrequencyDtoV1 {
  const filters = {
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    sender: "both" as const,
    selectedYear: 2025,
    sessionThresholdHours: 6 as const,
  };
  const baseQueryKey = canonicalQueryKey(datasetId, generation, filters);
  const denominator = Math.max(10_000, count * (count + 1));
  const items = Array.from({ length: count }, (_, index) => {
    const value = syntheticToken(index);
    const itemCount = count - index;
    return {
      normalizedToken: value.token,
      count: itemCount,
      ratePer10000: (itemCount * 10_000) / denominator,
      rank: index + 1,
      category: value.category,
      qualityFlags: [] as const,
    };
  });
  return {
    schemaVersion: WORD_FREQUENCY_SCHEMA_VERSION,
    identity: {
      datasetId,
      generation,
      baseQueryKey,
      frequencyDtoKey: frequencyDtoKey(
        datasetId,
        generation,
        baseQueryKey,
        "both",
      ),
    },
    scope: {
      timezone: WORD_FREQUENCY_TIMEZONE,
      year: 2025,
      role: "both",
    },
    denominator: {
      eligibleTokenCount: denominator,
      definition: BETA_VOCABULARY_DENOMINATOR_DEFINITION,
      status: "ready",
      emptyReason: null,
    },
    policy: {
      version: BETA_VOCABULARY_POLICY_VERSION,
      builtInPolicyHash: BETA_VOCABULARY_POLICY_HASH,
    },
    items,
  };
}

export function createSyntheticLayoutRequest(
  count: number,
  viewportBucket: WordCloudViewportBucket = "wide",
  datasetId = LAYOUT_DATASET_A,
  generation = LAYOUT_GENERATION,
): WordCloudLayoutRequestV1 {
  const dto = createSyntheticFrequencyDto(count, datasetId, generation);
  const presentation = createWordCloudPresentation(
    dto,
    [],
    "raw-count",
    count,
  );
  return createWordCloudLayoutRequest({
    datasetId,
    generation,
    frequencyDtoKey: presentation.frequencyDtoKey,
    viewportBucket,
    wordLimit: count,
    words: presentation.words,
  });
}
