import {
  isDatasetId,
  type DatasetId,
  type Generation,
} from "../desktop/ipc-contract";
import type { WordScriptCategory } from "../worker-analysis/vocabulary-policy";

export const WORD_CLOUD_LAYOUT_REQUEST_SCHEMA_VERSION =
  "chat-history-analysis.word-cloud-layout-request.v1" as const;
export const WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION =
  "chat-history-analysis.word-cloud-layout-result.v1" as const;
export const WORD_CLOUD_LAYOUT_VERSION = "beta-wordcloud-layout.v1" as const;
export const WORD_CLOUD_METRICS_VERSION =
  "beta-wordcloud-synthetic-metrics.v1" as const;
export const WORD_CLOUD_PRESENTATION_VERSION =
  "chat-history-analysis.word-cloud-presentation.v1" as const;
export const WORD_CLOUD_COORDINATE_CONVENTION = "top-left" as const;

export const WORD_CLOUD_MAX_ATTEMPTS_PER_WORD = 4_096;
export const WORD_CLOUD_SPATIAL_HASH_CELL_SIZE = 16;
export const WORD_CLOUD_LAYOUT_CACHE_CAPACITY = 6;
export const WORD_CLOUD_MAX_WORDS = 100;
export const WORD_CLOUD_MIN_USABLE_WORDS = 20;
export const WORD_CLOUD_MAX_TOKEN_CODE_POINTS = 32;
export const WORD_CLOUD_PROGRESSIVE_LIMITS = [100, 80, 60, 40, 20] as const;

export type WordCloudViewportBucket =
  | "narrow"
  | "standard"
  | "wide"
  | "export";

export interface WordCloudViewportSpec {
  readonly bucket: WordCloudViewportBucket;
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly defaultWordLimit: number;
  readonly maximumWordLimit: number;
}

export const WORD_CLOUD_VIEWPORT_SPECS: Readonly<
  Record<WordCloudViewportBucket, WordCloudViewportSpec>
> = Object.freeze({
  narrow: Object.freeze({
    bucket: "narrow",
    width: 480,
    height: 520,
    padding: 18,
    defaultWordLimit: 40,
    maximumWordLimit: 50,
  }),
  standard: Object.freeze({
    bucket: "standard",
    width: 760,
    height: 560,
    padding: 24,
    defaultWordLimit: 60,
    maximumWordLimit: 80,
  }),
  wide: Object.freeze({
    bucket: "wide",
    width: 960,
    height: 620,
    padding: 28,
    defaultWordLimit: 80,
    maximumWordLimit: 100,
  }),
  export: Object.freeze({
    bucket: "export",
    width: 1_200,
    height: 1_500,
    padding: 48,
    defaultWordLimit: 100,
    maximumWordLimit: 100,
  }),
});

export type WordCloudPaletteSlot =
  | "cobalt"
  | "coral"
  | "teal"
  | "amber"
  | "violet";

export interface WordCloudLayoutWordV1 {
  readonly stableKey: string;
  readonly displayToken: string;
  readonly displayRank: number;
  readonly sourceRank: number;
  readonly weight: number;
  readonly count: number;
  readonly ratePer10000: number;
  readonly category: WordScriptCategory;
}

export interface WordCloudLayoutRequestV1 {
  readonly schemaVersion: typeof WORD_CLOUD_LAYOUT_REQUEST_SCHEMA_VERSION;
  readonly layoutVersion: typeof WORD_CLOUD_LAYOUT_VERSION;
  readonly metricsVersion: typeof WORD_CLOUD_METRICS_VERSION;
  readonly identity: {
    readonly datasetId: DatasetId | null;
    readonly generation: Generation;
    readonly frequencyDtoKey: string;
    readonly presentationDigest: string;
    readonly viewportBucket: WordCloudViewportBucket;
    readonly wordLimit: number;
  };
  readonly geometry: {
    readonly width: number;
    readonly height: number;
    readonly padding: number;
    readonly maxAttemptsPerWord: typeof WORD_CLOUD_MAX_ATTEMPTS_PER_WORD;
    readonly spatialHashCellSize: typeof WORD_CLOUD_SPATIAL_HASH_CELL_SIZE;
  };
  readonly words: readonly WordCloudLayoutWordV1[];
}

export interface PlacedWordCloudWordV1 {
  readonly stableKey: string;
  readonly displayToken: string;
  readonly displayRank: number;
  readonly sourceRank: number;
  readonly placementOrder: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly rotation: 0;
  readonly paletteSlot: WordCloudPaletteSlot;
  readonly attempts: number;
}

export type WordCloudOmissionReason = "NO_PLACEMENT" | "TOKEN_TOO_WIDE";

export interface OmittedWordCloudWordV1 {
  readonly stableKey: string;
  readonly displayToken: string;
  readonly displayRank: number;
  readonly sourceRank: number;
  readonly placementOrder: number;
  readonly reason: WordCloudOmissionReason;
}

export interface WordCloudLayoutResultV1 {
  readonly schemaVersion: typeof WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION;
  readonly layoutVersion: typeof WORD_CLOUD_LAYOUT_VERSION;
  readonly metricsVersion: typeof WORD_CLOUD_METRICS_VERSION;
  readonly coordinateConvention: typeof WORD_CLOUD_COORDINATE_CONVENTION;
  readonly presentationDigest: string;
  readonly viewportBucket: WordCloudViewportBucket;
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly requestedWordLimit: number;
  readonly placedRatio: number;
  readonly degraded: boolean;
  readonly placed: readonly PlacedWordCloudWordV1[];
  readonly omitted: readonly OmittedWordCloudWordV1[];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isViewportBucket(value: unknown): value is WordCloudViewportBucket {
  return value === "narrow" || value === "standard" || value === "wide" ||
    value === "export";
}

function isWordCategory(value: unknown): value is WordScriptCategory {
  return value === "han" || value === "latin" || value === "mixed" ||
    value === "other";
}

function isPaletteSlot(value: unknown): value is WordCloudPaletteSlot {
  return value === "cobalt" || value === "coral" || value === "teal" ||
    value === "amber" || value === "violet";
}

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

export function compareLayoutWords(
  left: WordCloudLayoutWordV1,
  right: WordCloudLayoutWordV1,
): number {
  return right.weight - left.weight ||
    right.count - left.count ||
    compareUnicodeCodePoints(left.displayToken, right.displayToken) ||
    compareUnicodeCodePoints(left.stableKey, right.stableKey);
}

export function sortLayoutWords(
  words: readonly WordCloudLayoutWordV1[],
): readonly WordCloudLayoutWordV1[] {
  return [...words].sort(compareLayoutWords);
}

export function viewportBucketForWidth(cssContentWidth: number): WordCloudViewportBucket {
  if (!Number.isFinite(cssContentWidth) || cssContentWidth <= 0) {
    throw new Error("INVALID_WORD_CLOUD_VIEWPORT_WIDTH");
  }
  if (cssContentWidth < 640) {
    return "narrow";
  }
  return cssContentWidth < 960 ? "standard" : "wide";
}

export function presentationDigest(
  words: readonly WordCloudLayoutWordV1[],
): string {
  return JSON.stringify([
    WORD_CLOUD_PRESENTATION_VERSION,
    ...words.map((word) => [
      word.stableKey,
      word.displayToken,
      word.displayRank,
      word.sourceRank,
      word.weight,
      word.count,
      word.ratePer10000,
      word.category,
    ]),
  ]);
}

export function layoutCacheKey(
  request: Pick<
    WordCloudLayoutRequestV1,
    "layoutVersion" | "metricsVersion" | "identity"
  >,
): string {
  return JSON.stringify([
    request.identity.presentationDigest,
    request.layoutVersion,
    request.metricsVersion,
    request.identity.viewportBucket,
    request.identity.wordLimit,
  ]);
}

function validateLayoutWord(value: unknown): WordCloudLayoutWordV1 {
  const word = objectValue(value);
  if (
    word === undefined ||
    !exactKeys(word, [
      "category",
      "count",
      "displayRank",
      "displayToken",
      "ratePer10000",
      "sourceRank",
      "stableKey",
      "weight",
    ]) ||
    typeof word.stableKey !== "string" ||
    word.stableKey.length === 0 ||
    word.stableKey.length > 160 ||
    typeof word.displayToken !== "string" ||
    word.displayToken.trim() !== word.displayToken ||
    [...word.displayToken].length === 0 ||
    [...word.displayToken].length > WORD_CLOUD_MAX_TOKEN_CODE_POINTS ||
    !isSafePositiveInteger(word.displayRank) ||
    !isSafePositiveInteger(word.sourceRank) ||
    !isFiniteNonNegative(word.weight) ||
    word.weight === 0 ||
    !isSafePositiveInteger(word.count) ||
    !isFiniteNonNegative(word.ratePer10000) ||
    !isWordCategory(word.category)
  ) {
    throw new Error("INVALID_WORD_CLOUD_LAYOUT_WORD");
  }
  return word as unknown as WordCloudLayoutWordV1;
}

export function validateWordCloudLayoutRequestV1(
  value: unknown,
): WordCloudLayoutRequestV1 {
  const request = objectValue(value);
  const identity = objectValue(request?.identity);
  const geometry = objectValue(request?.geometry);
  if (
    request === undefined ||
    !exactKeys(request, [
      "geometry",
      "identity",
      "layoutVersion",
      "metricsVersion",
      "schemaVersion",
      "words",
    ]) ||
    request.schemaVersion !== WORD_CLOUD_LAYOUT_REQUEST_SCHEMA_VERSION ||
    request.layoutVersion !== WORD_CLOUD_LAYOUT_VERSION ||
    request.metricsVersion !== WORD_CLOUD_METRICS_VERSION ||
    identity === undefined ||
    !exactKeys(identity, [
      "datasetId",
      "frequencyDtoKey",
      "generation",
      "presentationDigest",
      "viewportBucket",
      "wordLimit",
    ]) ||
    (identity.datasetId !== null && !isDatasetId(identity.datasetId)) ||
    !isSafePositiveInteger(identity.generation) ||
    typeof identity.frequencyDtoKey !== "string" ||
    identity.frequencyDtoKey.length === 0 ||
    identity.frequencyDtoKey.length > 8_192 ||
    typeof identity.presentationDigest !== "string" ||
    identity.presentationDigest.length === 0 ||
    identity.presentationDigest.length > 64_000 ||
    !isViewportBucket(identity.viewportBucket) ||
    !isSafePositiveInteger(identity.wordLimit) ||
    identity.wordLimit > WORD_CLOUD_MAX_WORDS ||
    geometry === undefined ||
    !exactKeys(geometry, [
      "height",
      "maxAttemptsPerWord",
      "padding",
      "spatialHashCellSize",
      "width",
    ]) ||
    !Array.isArray(request.words)
  ) {
    throw new Error("INVALID_WORD_CLOUD_LAYOUT_REQUEST");
  }
  const spec = WORD_CLOUD_VIEWPORT_SPECS[identity.viewportBucket];
  if (
    geometry.width !== spec.width ||
    geometry.height !== spec.height ||
    geometry.padding !== spec.padding ||
    geometry.maxAttemptsPerWord !== WORD_CLOUD_MAX_ATTEMPTS_PER_WORD ||
    geometry.spatialHashCellSize !== WORD_CLOUD_SPATIAL_HASH_CELL_SIZE ||
    identity.wordLimit > spec.maximumWordLimit ||
    request.words.length === 0 ||
    request.words.length > identity.wordLimit
  ) {
    throw new Error("INVALID_WORD_CLOUD_LAYOUT_REQUEST");
  }
  const words = request.words.map(validateLayoutWord);
  const keys = new Set(words.map((word) => word.stableKey));
  const ranks = new Set(words.map((word) => word.displayRank));
  if (
    keys.size !== words.length ||
    ranks.size !== words.length ||
    identity.presentationDigest !== presentationDigest(words)
  ) {
    throw new Error("INVALID_WORD_CLOUD_LAYOUT_REQUEST");
  }
  return request as unknown as WordCloudLayoutRequestV1;
}

function rectanglesOverlap(
  left: Pick<PlacedWordCloudWordV1, "x" | "y" | "width" | "height">,
  right: Pick<PlacedWordCloudWordV1, "x" | "y" | "width" | "height">,
): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

export function validateWordCloudLayoutResultV1(
  value: unknown,
): WordCloudLayoutResultV1 {
  const result = objectValue(value);
  if (
    result === undefined ||
    !exactKeys(result, [
      "coordinateConvention",
      "degraded",
      "height",
      "layoutVersion",
      "metricsVersion",
      "omitted",
      "padding",
      "placed",
      "placedRatio",
      "presentationDigest",
      "requestedWordLimit",
      "schemaVersion",
      "viewportBucket",
      "width",
    ]) ||
    result.schemaVersion !== WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION ||
    result.layoutVersion !== WORD_CLOUD_LAYOUT_VERSION ||
    result.metricsVersion !== WORD_CLOUD_METRICS_VERSION ||
    result.coordinateConvention !== WORD_CLOUD_COORDINATE_CONVENTION ||
    typeof result.presentationDigest !== "string" ||
    !isViewportBucket(result.viewportBucket) ||
    !isSafePositiveInteger(result.width) ||
    !isSafePositiveInteger(result.height) ||
    !isSafeNonNegativeInteger(result.padding) ||
    !isSafePositiveInteger(result.requestedWordLimit) ||
    typeof result.degraded !== "boolean" ||
    typeof result.placedRatio !== "number" ||
    !Number.isFinite(result.placedRatio) ||
    result.placedRatio < 0 ||
    result.placedRatio > 1 ||
    !Array.isArray(result.placed) ||
    !Array.isArray(result.omitted)
  ) {
    throw new Error("INVALID_WORD_CLOUD_LAYOUT_RESULT");
  }
  const resultWidth = result.width;
  const resultHeight = result.height;
  const resultPadding = result.padding;
  const spec = WORD_CLOUD_VIEWPORT_SPECS[result.viewportBucket];
  if (
    result.width !== spec.width ||
    result.height !== spec.height ||
    result.padding !== spec.padding ||
    result.requestedWordLimit > spec.maximumWordLimit ||
    result.placed.length + result.omitted.length > result.requestedWordLimit ||
    result.degraded !== (result.omitted.length > 0) ||
    result.placedRatio !== result.placed.length /
      (result.placed.length + result.omitted.length)
  ) {
    throw new Error("INVALID_WORD_CLOUD_LAYOUT_RESULT");
  }
  const placed = result.placed.map((value) => {
    const word = objectValue(value);
    if (
      word === undefined ||
      !exactKeys(word, [
        "attempts",
        "displayRank",
        "displayToken",
        "fontSize",
        "height",
        "paletteSlot",
        "placementOrder",
        "rotation",
        "sourceRank",
        "stableKey",
        "width",
        "x",
        "y",
      ]) ||
      typeof word.stableKey !== "string" ||
      typeof word.displayToken !== "string" ||
      !isSafePositiveInteger(word.displayRank) ||
      !isSafePositiveInteger(word.sourceRank) ||
      !isSafePositiveInteger(word.placementOrder) ||
      !isSafeNonNegativeInteger(word.x) ||
      !isSafeNonNegativeInteger(word.y) ||
      !isSafePositiveInteger(word.width) ||
      !isSafePositiveInteger(word.height) ||
      !isSafePositiveInteger(word.fontSize) ||
      word.rotation !== 0 ||
      !isPaletteSlot(word.paletteSlot) ||
      !isSafePositiveInteger(word.attempts) ||
      word.attempts > WORD_CLOUD_MAX_ATTEMPTS_PER_WORD ||
      word.x < resultPadding ||
      word.y < resultPadding ||
      word.x + word.width > resultWidth - resultPadding ||
      word.y + word.height > resultHeight - resultPadding
    ) {
      throw new Error("INVALID_WORD_CLOUD_LAYOUT_RESULT");
    }
    return word as unknown as PlacedWordCloudWordV1;
  });
  const omitted = result.omitted.map((value) => {
    const word = objectValue(value);
    if (
      word === undefined ||
      !exactKeys(word, [
        "displayRank",
        "displayToken",
        "placementOrder",
        "reason",
        "sourceRank",
        "stableKey",
      ]) ||
      typeof word.stableKey !== "string" ||
      typeof word.displayToken !== "string" ||
      !isSafePositiveInteger(word.displayRank) ||
      !isSafePositiveInteger(word.sourceRank) ||
      !isSafePositiveInteger(word.placementOrder) ||
      (word.reason !== "NO_PLACEMENT" && word.reason !== "TOKEN_TOO_WIDE")
    ) {
      throw new Error("INVALID_WORD_CLOUD_LAYOUT_RESULT");
    }
    return word as unknown as OmittedWordCloudWordV1;
  });
  const stableKeys = [...placed, ...omitted].map((word) => word.stableKey);
  const displayRanks = [...placed, ...omitted].map((word) => word.displayRank);
  const placementOrders = [...placed, ...omitted]
    .map((word) => word.placementOrder)
    .sort((left, right) => left - right);
  if (
    new Set(stableKeys).size !== stableKeys.length ||
    new Set(displayRanks).size !== displayRanks.length ||
    placementOrders.some((order, index) => order !== index + 1)
  ) {
    throw new Error("INVALID_WORD_CLOUD_LAYOUT_RESULT");
  }
  for (let left = 0; left < placed.length; left += 1) {
    for (let right = left + 1; right < placed.length; right += 1) {
      if (rectanglesOverlap(placed[left]!, placed[right]!)) {
        throw new Error("INVALID_WORD_CLOUD_LAYOUT_RESULT");
      }
    }
  }
  return result as unknown as WordCloudLayoutResultV1;
}

export interface CreateWordCloudLayoutRequestInput {
  readonly datasetId: DatasetId | null;
  readonly generation: Generation;
  readonly frequencyDtoKey: string;
  readonly viewportBucket: WordCloudViewportBucket;
  readonly wordLimit: number;
  readonly words: readonly WordCloudLayoutWordV1[];
}

export function createWordCloudLayoutRequest(
  input: CreateWordCloudLayoutRequestInput,
): WordCloudLayoutRequestV1 {
  const words = sortLayoutWords(input.words).slice(0, input.wordLimit);
  const spec = WORD_CLOUD_VIEWPORT_SPECS[input.viewportBucket];
  return validateWordCloudLayoutRequestV1({
    schemaVersion: WORD_CLOUD_LAYOUT_REQUEST_SCHEMA_VERSION,
    layoutVersion: WORD_CLOUD_LAYOUT_VERSION,
    metricsVersion: WORD_CLOUD_METRICS_VERSION,
    identity: {
      datasetId: input.datasetId,
      generation: input.generation,
      frequencyDtoKey: input.frequencyDtoKey,
      presentationDigest: presentationDigest(words),
      viewportBucket: input.viewportBucket,
      wordLimit: input.wordLimit,
    },
    geometry: {
      width: spec.width,
      height: spec.height,
      padding: spec.padding,
      maxAttemptsPerWord: WORD_CLOUD_MAX_ATTEMPTS_PER_WORD,
      spatialHashCellSize: WORD_CLOUD_SPATIAL_HASH_CELL_SIZE,
    },
    words,
  });
}

export function requestWithWordLimit(
  request: WordCloudLayoutRequestV1,
  wordLimit: number,
): WordCloudLayoutRequestV1 {
  return createWordCloudLayoutRequest({
    datasetId: request.identity.datasetId,
    generation: request.identity.generation,
    frequencyDtoKey: request.identity.frequencyDtoKey,
    viewportBucket: request.identity.viewportBucket,
    wordLimit,
    words: request.words,
  });
}
