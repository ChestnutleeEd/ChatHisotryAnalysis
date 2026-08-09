import { describe, expect, it } from "vitest";

import {
  WORD_CLOUD_LAYOUT_REQUEST_SCHEMA_VERSION,
  WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION,
  WORD_CLOUD_LAYOUT_VERSION,
  WORD_CLOUD_MAX_ATTEMPTS_PER_WORD,
  WORD_CLOUD_METRICS_VERSION,
  WORD_CLOUD_SPATIAL_HASH_CELL_SIZE,
  WORD_CLOUD_VIEWPORT_SPECS,
  compareUnicodeCodePoints,
  createWordCloudLayoutRequest,
  layoutCacheKey,
  presentationDigest,
  validateWordCloudLayoutRequestV1,
  validateWordCloudLayoutResultV1,
  viewportBucketForWidth,
  type WordCloudLayoutWordV1,
} from "../src/word-cloud-layout/contracts";
import { layoutWordCloud } from "../src/word-cloud-layout/layout-engine";
import {
  WORD_CLOUD_MAX_FONT_SIZE,
  WORD_CLOUD_MIN_FONT_SIZE,
  fitSyntheticFontSize,
  mapWordFontSizes,
  syntheticTextBox,
} from "../src/word-cloud-layout/synthetic-metrics";
import {
  LAYOUT_DATASET_A,
  LAYOUT_DATASET_B,
  LAYOUT_GENERATION,
  createSyntheticLayoutRequest,
} from "./word-cloud-layout-fixtures";

function noOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y;
}

describe("deterministic word-cloud layout contracts and geometry", () => {
  it("returns byte-equal geometry for equal words independent of dataset identity", async () => {
    const firstRequest = createSyntheticLayoutRequest(40, "wide", LAYOUT_DATASET_A);
    const secondRequest = createWordCloudLayoutRequest({
      datasetId: LAYOUT_DATASET_B,
      generation: LAYOUT_GENERATION,
      frequencyDtoKey: "synthetic-frequency-b",
      viewportBucket: "wide",
      wordLimit: 40,
      words: firstRequest.words,
    });
    const first = await layoutWordCloud(firstRequest);
    const repeated = await layoutWordCloud(firstRequest);
    const otherDataset = await layoutWordCloud(secondRequest);
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
    expect(JSON.stringify(otherDataset)).toBe(JSON.stringify(first));
    expect(first.layoutVersion).toBe(WORD_CLOUD_LAYOUT_VERSION);
    expect(first.metricsVersion).toBe(WORD_CLOUD_METRICS_VERSION);
  });

  it("uses weight, count, then Unicode code-point ordering with a fixed center", async () => {
    const words: WordCloudLayoutWordV1[] = [
      { stableKey: "z", displayToken: "zeta", displayRank: 3, sourceRank: 3, weight: 5, count: 5, ratePer10000: 5, category: "latin" },
      { stableKey: "han", displayToken: "本地", displayRank: 2, sourceRank: 2, weight: 5, count: 5, ratePer10000: 5, category: "han" },
      { stableKey: "a", displayToken: "alpha", displayRank: 1, sourceRank: 1, weight: 5, count: 5, ratePer10000: 5, category: "latin" },
    ];
    const request = createWordCloudLayoutRequest({
      datasetId: LAYOUT_DATASET_A,
      generation: LAYOUT_GENERATION,
      frequencyDtoKey: "tie-fixture",
      viewportBucket: "wide",
      wordLimit: 3,
      words,
    });
    const result = await layoutWordCloud(request);
    expect(result.placed.map((word) => word.displayToken)).toEqual([
      "alpha",
      "zeta",
      "本地",
    ]);
    const first = result.placed[0]!;
    expect(first.x).toBe(Math.round(result.width / 2 - first.width / 2));
    expect(first.y).toBe(Math.round(result.height / 2 - first.height / 2));
    expect(result.placed.every((word) => word.rotation === 0)).toBe(true);
    expect(compareUnicodeCodePoints("a", "本")).toBeLessThan(0);
  });

  it.each([
    [20, "narrow"],
    [40, "narrow"],
    [60, "standard"],
    [80, "standard"],
    [100, "wide"],
  ] as const)("keeps %i synthetic words bounded and collision-free", async (count, bucket) => {
    const request = createSyntheticLayoutRequest(count, bucket);
    const result = await layoutWordCloud(request);
    expect(validateWordCloudLayoutResultV1(result)).toBe(result);
    for (const word of result.placed) {
      expect(Number.isInteger(word.x)).toBe(true);
      expect(Number.isInteger(word.y)).toBe(true);
      expect(Number.isFinite(word.fontSize)).toBe(true);
      expect(word.x).toBeGreaterThanOrEqual(result.padding);
      expect(word.y).toBeGreaterThanOrEqual(result.padding);
      expect(word.x + word.width).toBeLessThanOrEqual(result.width - result.padding);
      expect(word.y + word.height).toBeLessThanOrEqual(result.height - result.padding);
    }
    for (let left = 0; left < result.placed.length; left += 1) {
      for (let right = left + 1; right < result.placed.length; right += 1) {
        expect(noOverlap(result.placed[left]!, result.placed[right]!)).toBe(true);
      }
    }
  });

  it("freezes Han, Latin, digit, punctuation, and mixed synthetic rectangles", () => {
    expect(syntheticTextBox("本地", 20)).toEqual({ width: 56, height: 36 });
    expect(syntheticTextBox("ab", 20)).toEqual({ width: 39, height: 36 });
    expect(syntheticTextBox("A1", 20)).toEqual({ width: 41, height: 36 });
    expect(syntheticTextBox("a-b", 20)).toEqual({ width: 46, height: 36 });
    expect(syntheticTextBox("本a1", 20)).toEqual({ width: 59, height: 36 });
  });

  it("maps weights monotonically with frozen min/max and identical-weight behavior", () => {
    const words: WordCloudLayoutWordV1[] = [1, 10, 100].map((weight, index) => ({
      stableKey: String(index),
      displayToken: `w${index}`,
      displayRank: index + 1,
      sourceRank: index + 1,
      weight,
      count: 100 - index,
      ratePer10000: weight,
      category: "latin",
    }));
    const sizes = mapWordFontSizes(words);
    expect(sizes.get("0")).toBe(WORD_CLOUD_MIN_FONT_SIZE);
    expect(sizes.get("2")).toBe(WORD_CLOUD_MAX_FONT_SIZE);
    expect(sizes.get("0")!).toBeLessThanOrEqual(sizes.get("1")!);
    expect(sizes.get("1")!).toBeLessThanOrEqual(sizes.get("2")!);
    expect(mapWordFontSizes([words[0]!]).get("0")).toBe(WORD_CLOUD_MAX_FONT_SIZE);
    expect(new Set(mapWordFontSizes(words.map((word) => ({ ...word, weight: 1 }))).values())).toEqual(new Set([WORD_CLOUD_MIN_FONT_SIZE]));
  });

  it("shrinks a defensive long token to minimum then rejects when still too wide", async () => {
    const longToken = "界".repeat(32);
    expect(fitSyntheticFontSize(longToken, WORD_CLOUD_MAX_FONT_SIZE, 600, 200)?.fontSize).toBe(WORD_CLOUD_MIN_FONT_SIZE);
    expect(fitSyntheticFontSize(longToken, WORD_CLOUD_MAX_FONT_SIZE, 400, 200)).toBeNull();
    const word: WordCloudLayoutWordV1 = {
      stableKey: "long",
      displayToken: longToken,
      displayRank: 1,
      sourceRank: 1,
      weight: 100,
      count: 100,
      ratePer10000: 100,
      category: "han",
    };
    const request = createWordCloudLayoutRequest({
      datasetId: LAYOUT_DATASET_A,
      generation: LAYOUT_GENERATION,
      frequencyDtoKey: "long-token",
      viewportBucket: "narrow",
      wordLimit: 1,
      words: [word],
    });
    const result = await layoutWordCloud(request);
    expect(result.placed).toEqual([]);
    expect(result.omitted[0]).toMatchObject({ reason: "TOKEN_TOO_WIDE" });
  });

  it("allows touching half-open AABB edges in result validation", () => {
    const result = {
      schemaVersion: WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION,
      layoutVersion: WORD_CLOUD_LAYOUT_VERSION,
      metricsVersion: WORD_CLOUD_METRICS_VERSION,
      coordinateConvention: "top-left",
      presentationDigest: "touching",
      viewportBucket: "narrow",
      width: 480,
      height: 520,
      padding: 18,
      requestedWordLimit: 2,
      placedRatio: 1,
      degraded: false,
      placed: [
        { stableKey: "a", displayToken: "a", displayRank: 1, sourceRank: 1, placementOrder: 1, x: 18, y: 18, width: 20, height: 20, fontSize: 16, rotation: 0, paletteSlot: "cobalt", attempts: 1 },
        { stableKey: "b", displayToken: "b", displayRank: 2, sourceRank: 2, placementOrder: 2, x: 38, y: 18, width: 20, height: 20, fontSize: 16, rotation: 0, paletteSlot: "coral", attempts: 1 },
      ],
      omitted: [],
    };
    expect(validateWordCloudLayoutResultV1(result)).toBe(result);
    expect(() => validateWordCloudLayoutResultV1({
      ...result,
      placed: [result.placed[0], { ...result.placed[1], x: 37 }],
    })).toThrow("INVALID_WORD_CLOUD_LAYOUT_RESULT");
  });

  it("keeps duplicate display values distinguishable through stable keys", async () => {
    const shared = "same";
    const request = createWordCloudLayoutRequest({
      datasetId: LAYOUT_DATASET_A,
      generation: LAYOUT_GENERATION,
      frequencyDtoKey: "duplicate-display",
      viewportBucket: "narrow",
      wordLimit: 2,
      words: [
        { stableKey: "normalized-a", displayToken: shared, displayRank: 1, sourceRank: 1, weight: 2, count: 2, ratePer10000: 2, category: "latin" },
        { stableKey: "normalized-b", displayToken: shared, displayRank: 2, sourceRank: 2, weight: 1, count: 1, ratePer10000: 1, category: "latin" },
      ],
    });
    const result = await layoutWordCloud(request);
    expect(new Set([...result.placed, ...result.omitted].map((word) => word.stableKey))).toEqual(new Set(["normalized-a", "normalized-b"]));
  });

  it("fails closed for duplicate keys, NaN/Infinity, excessive counts, and malformed geometry", () => {
    const request = createSyntheticLayoutRequest(20, "narrow");
    expect(() => validateWordCloudLayoutRequestV1({
      ...request,
      words: [request.words[0], request.words[0]],
      identity: {
        ...request.identity,
        wordLimit: 2,
        presentationDigest: presentationDigest([request.words[0]!, request.words[0]!]),
      },
    })).toThrow("INVALID_WORD_CLOUD_LAYOUT_REQUEST");
    for (const weight of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const words = [{ ...request.words[0]!, weight }];
      expect(() => validateWordCloudLayoutRequestV1({
        ...request,
        words,
        identity: { ...request.identity, wordLimit: 1, presentationDigest: presentationDigest(words) },
      })).toThrow();
    }
    expect(() => validateWordCloudLayoutRequestV1({
      ...request,
      geometry: { ...request.geometry, width: 481 },
    })).toThrow();
    expect(() => validateWordCloudLayoutRequestV1({
      ...request,
      reducedMotion: true,
    })).toThrow();
    expect(() => validateWordCloudLayoutRequestV1({
      ...request,
      identity: { ...request.identity, route: "annual" },
    })).toThrow();
    expect(() => createSyntheticLayoutRequest(101, "wide")).toThrow();
  });

  it("freezes bucket/fixed-export bounds and excludes exact CSS width from cache identity", () => {
    expect(viewportBucketForWidth(639)).toBe("narrow");
    expect(viewportBucketForWidth(640)).toBe("standard");
    expect(viewportBucketForWidth(959)).toBe("standard");
    expect(viewportBucketForWidth(960)).toBe("wide");
    expect(WORD_CLOUD_VIEWPORT_SPECS.export).toMatchObject({ width: 1_200, height: 1_500, maximumWordLimit: 100 });
    const request = createSyntheticLayoutRequest(20, "standard");
    expect(viewportBucketForWidth(700)).toBe(viewportBucketForWidth(900));
    expect(layoutCacheKey(request)).toBe(layoutCacheKey(request));
    expect(request.geometry.maxAttemptsPerWord).toBe(WORD_CLOUD_MAX_ATTEMPTS_PER_WORD);
    expect(request.geometry.spatialHashCellSize).toBe(WORD_CLOUD_SPATIAL_HASH_CELL_SIZE);
    expect(request.schemaVersion).toBe(WORD_CLOUD_LAYOUT_REQUEST_SCHEMA_VERSION);
  });

  it("produces fixed 1200×1500 export geometry and leaves reduced motion outside identity", async () => {
    const request = createSyntheticLayoutRequest(100, "export");
    const normal = await layoutWordCloud(request);
    const reducedMotion = await layoutWordCloud(request);
    expect(normal).toMatchObject({ width: 1_200, height: 1_500, viewportBucket: "export" });
    expect(JSON.stringify(reducedMotion)).toBe(JSON.stringify(normal));
  });
});
