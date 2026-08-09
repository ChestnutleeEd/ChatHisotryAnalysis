import type { DatasetId, Generation } from "../../desktop/ipc-contract";
import { canonicalQueryKey } from "../../worker-analysis/analytics-contract";
import {
  WORD_FREQUENCY_SCHEMA_VERSION,
  WORD_FREQUENCY_TIMEZONE,
  frequencyDtoKey,
  type WorkerWordFrequencyDtoV1,
  type WordFrequencyRole,
} from "../../worker-analysis/word-frequency-contract";
import {
  BETA_VOCABULARY_DENOMINATOR_DEFINITION,
  BETA_VOCABULARY_POLICY_HASH,
  BETA_VOCABULARY_POLICY_VERSION,
} from "../../worker-analysis/vocabulary-policy";

const FIXTURE_DATASET_ID =
  "dat_000000000000000000000000000000f1" as DatasetId;
const FIXTURE_GENERATION = 1 as Generation;

export function syntheticBetaWordCloudFrequency(
  year: number,
  role: WordFrequencyRole,
): WorkerWordFrequencyDtoV1 {
  const filters = {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    sender: "both" as const,
    selectedYear: year,
    sessionThresholdHours: 6 as const,
  };
  const baseQueryKey = canonicalQueryKey(
    FIXTURE_DATASET_ID,
    FIXTURE_GENERATION,
    filters,
  );
  const denominator = 9_500;
  const items = Array.from({ length: 42 }, (_, index) => {
    const count = 420 - index * 7 + (role === "owner" ? 18 : role === "other" ? 9 : 0);
    const category = index % 3 === 0 ? "han" : index % 3 === 1 ? "latin" : "mixed";
    const token = category === "han"
      ? `本地${String.fromCodePoint(0x4e00 + index)}`
      : category === "latin"
        ? `report${String(index).padStart(2, "0")}`
        : `版本v${String(index).padStart(2, "0")}`;
    return {
      normalizedToken: token,
      count,
      ratePer10000: (count * 10_000) / denominator,
      rank: index + 1,
      category,
      qualityFlags: [],
    } as const;
  });
  return {
    schemaVersion: WORD_FREQUENCY_SCHEMA_VERSION,
    identity: {
      datasetId: FIXTURE_DATASET_ID,
      generation: FIXTURE_GENERATION,
      baseQueryKey,
      frequencyDtoKey: frequencyDtoKey(
        FIXTURE_DATASET_ID,
        FIXTURE_GENERATION,
        baseQueryKey,
        role,
      ),
    },
    scope: {
      timezone: WORD_FREQUENCY_TIMEZONE,
      year,
      role,
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
