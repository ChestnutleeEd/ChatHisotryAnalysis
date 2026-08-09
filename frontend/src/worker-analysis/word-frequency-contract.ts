import {
  isDatasetId,
  type DatasetId,
  type Generation,
} from "../desktop/ipc-contract";
import { isCanonicalWorkerQueryKey } from "./query-binding";
import {
  BETA_VOCABULARY_DENOMINATOR_DEFINITION,
  BETA_VOCABULARY_POLICY_HASH,
  BETA_VOCABULARY_POLICY_VERSION,
  compareUnicodeCodePoints,
  type WordQualityFlag,
  type WordScriptCategory,
} from "./vocabulary-policy";

export const WORD_FREQUENCY_QUERY_SCHEMA_VERSION =
  "chat-history-analysis.word-frequency-query.v1" as const;
export const WORD_FREQUENCY_SCHEMA_VERSION =
  "chat-history-analysis.word-frequency.v1" as const;
export const MAX_WORD_FREQUENCY_CANDIDATES = 400;
export const WORD_FREQUENCY_TIMEZONE = "UTC+08:00" as const;

export type WordFrequencyRole = "both" | "owner" | "other";

export interface WorkerWordFrequencyQueryV1 {
  readonly schemaVersion: typeof WORD_FREQUENCY_QUERY_SCHEMA_VERSION;
  readonly baseQueryKey: string;
  readonly role: WordFrequencyRole;
  readonly policy: {
    readonly version: typeof BETA_VOCABULARY_POLICY_VERSION;
    readonly builtInPolicyHash: typeof BETA_VOCABULARY_POLICY_HASH;
  };
}

export interface WorkerWordFrequencyItemV1 {
  readonly normalizedToken: string;
  readonly count: number;
  readonly ratePer10000: number;
  readonly rank: number;
  readonly category: WordScriptCategory;
  readonly qualityFlags: readonly WordQualityFlag[];
}

export interface WorkerWordFrequencyDtoV1 {
  readonly schemaVersion: typeof WORD_FREQUENCY_SCHEMA_VERSION;
  readonly identity: {
    readonly datasetId: DatasetId | null;
    readonly generation: Generation;
    readonly baseQueryKey: string;
    readonly frequencyDtoKey: string;
  };
  readonly scope: {
    readonly timezone: typeof WORD_FREQUENCY_TIMEZONE;
    readonly year: number | null;
    readonly role: WordFrequencyRole;
  };
  readonly denominator: {
    readonly eligibleTokenCount: number;
    readonly definition: typeof BETA_VOCABULARY_DENOMINATOR_DEFINITION;
    readonly status: "ready" | "empty";
    readonly emptyReason: "NO_ELIGIBLE_TOKENS" | null;
  };
  readonly policy: {
    readonly version: typeof BETA_VOCABULARY_POLICY_VERSION;
    readonly builtInPolicyHash: typeof BETA_VOCABULARY_POLICY_HASH;
  };
  readonly items: readonly WorkerWordFrequencyItemV1[];
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRole(value: unknown): value is WordFrequencyRole {
  return value === "both" || value === "owner" || value === "other";
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPolicy(value: unknown): boolean {
  const policy = objectValue(value);
  return policy !== undefined &&
    exactKeys(policy, ["builtInPolicyHash", "version"]) &&
    policy.version === BETA_VOCABULARY_POLICY_VERSION &&
    policy.builtInPolicyHash === BETA_VOCABULARY_POLICY_HASH;
}

export function frequencyDtoKey(
  datasetId: DatasetId | null,
  generation: Generation,
  baseQueryKey: string,
  role: WordFrequencyRole,
  policyVersion = BETA_VOCABULARY_POLICY_VERSION,
  builtInPolicyHash = BETA_VOCABULARY_POLICY_HASH,
): string {
  return JSON.stringify([
    WORD_FREQUENCY_SCHEMA_VERSION,
    datasetId,
    generation,
    baseQueryKey,
    role,
    policyVersion,
    builtInPolicyHash,
  ]);
}

export function validateWorkerWordFrequencyQueryV1(
  value: unknown,
): WorkerWordFrequencyQueryV1 {
  const query = objectValue(value);
  if (
    query === undefined ||
    !exactKeys(query, ["baseQueryKey", "policy", "role", "schemaVersion"]) ||
    query.schemaVersion !== WORD_FREQUENCY_QUERY_SCHEMA_VERSION ||
    !isCanonicalWorkerQueryKey(query.baseQueryKey) ||
    !isRole(query.role) ||
    !validPolicy(query.policy)
  ) {
    throw new Error("INVALID_WORD_FREQUENCY_QUERY");
  }
  return query as unknown as WorkerWordFrequencyQueryV1;
}

export function validateWorkerWordFrequencyDtoV1(
  value: unknown,
): WorkerWordFrequencyDtoV1 {
  const envelope = objectValue(value);
  const identity = objectValue(envelope?.identity);
  const scope = objectValue(envelope?.scope);
  const denominator = objectValue(envelope?.denominator);
  if (
    envelope === undefined ||
    !exactKeys(envelope, ["denominator", "identity", "items", "policy", "schemaVersion", "scope"]) ||
    envelope.schemaVersion !== WORD_FREQUENCY_SCHEMA_VERSION ||
    identity === undefined ||
    !exactKeys(identity, ["baseQueryKey", "datasetId", "frequencyDtoKey", "generation"]) ||
    (identity.datasetId !== null && !isDatasetId(identity.datasetId)) ||
    !safeNonNegativeInteger(identity.generation) ||
    identity.generation === 0 ||
    !isCanonicalWorkerQueryKey(identity.baseQueryKey) ||
    typeof identity.frequencyDtoKey !== "string" ||
    scope === undefined ||
    !exactKeys(scope, ["role", "timezone", "year"]) ||
    scope.timezone !== WORD_FREQUENCY_TIMEZONE ||
    !isRole(scope.role) ||
    (scope.year !== null && (!Number.isSafeInteger(scope.year) || (scope.year as number) < 1 || (scope.year as number) > 9999)) ||
    denominator === undefined ||
    !exactKeys(denominator, ["definition", "eligibleTokenCount", "emptyReason", "status"]) ||
    !safeNonNegativeInteger(denominator.eligibleTokenCount) ||
    denominator.definition !== BETA_VOCABULARY_DENOMINATOR_DEFINITION ||
    (denominator.status !== "ready" && denominator.status !== "empty") ||
    (denominator.status === "empty"
      ? denominator.emptyReason !== "NO_ELIGIBLE_TOKENS" || denominator.eligibleTokenCount !== 0
      : denominator.emptyReason !== null || denominator.eligibleTokenCount === 0) ||
    !validPolicy(envelope.policy) ||
    !Array.isArray(envelope.items) ||
    envelope.items.length > MAX_WORD_FREQUENCY_CANDIDATES
  ) {
    throw new Error("INVALID_WORD_FREQUENCY_DTO");
  }
  const expectedKey = frequencyDtoKey(
    identity.datasetId as DatasetId | null,
    identity.generation as Generation,
    identity.baseQueryKey as string,
    scope.role as WordFrequencyRole,
  );
  if (identity.frequencyDtoKey !== expectedKey) {
    throw new Error("INVALID_WORD_FREQUENCY_DTO");
  }
  const baseQueryParts = JSON.parse(identity.baseQueryKey as string) as unknown[];
  if (
    baseQueryParts[0] !== identity.datasetId ||
    baseQueryParts[1] !== identity.generation ||
    baseQueryParts[5] !== scope.year
  ) {
    throw new Error("INVALID_WORD_FREQUENCY_DTO");
  }
  const denominatorCount = denominator.eligibleTokenCount as number;
  let previousCount = Number.POSITIVE_INFINITY;
  let previousToken = "";
  for (const [index, itemValue] of envelope.items.entries()) {
    const item = objectValue(itemValue);
    if (
      item === undefined ||
      !exactKeys(item, ["category", "count", "normalizedToken", "qualityFlags", "rank", "ratePer10000"]) ||
      typeof item.normalizedToken !== "string" ||
      item.normalizedToken === "" ||
      !safeNonNegativeInteger(item.count) ||
      item.count === 0 ||
      typeof item.ratePer10000 !== "number" ||
      !Number.isFinite(item.ratePer10000) ||
      item.ratePer10000 < 0 ||
      item.rank !== index + 1 ||
      !["han", "latin", "mixed", "other"].includes(String(item.category)) ||
      !Array.isArray(item.qualityFlags) ||
      item.qualityFlags.length > 1 ||
      item.qualityFlags.some((flag) => flag !== "uncertain-fragment") ||
      Math.abs(item.ratePer10000 - ((item.count as number) * 10_000) / denominatorCount) > Number.EPSILON * 10_000 ||
      (item.count as number) > previousCount ||
      ((item.count as number) === previousCount && compareUnicodeCodePoints(previousToken, item.normalizedToken as string) >= 0)
    ) {
      throw new Error("INVALID_WORD_FREQUENCY_DTO");
    }
    previousCount = item.count as number;
    previousToken = item.normalizedToken;
  }
  if (denominatorCount === 0 && envelope.items.length !== 0) {
    throw new Error("INVALID_WORD_FREQUENCY_DTO");
  }
  return envelope as unknown as WorkerWordFrequencyDtoV1;
}
