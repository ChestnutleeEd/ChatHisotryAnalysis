import {
  WORD_CLOUD_COORDINATE_CONVENTION,
  WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION,
  WORD_CLOUD_LAYOUT_VERSION,
  WORD_CLOUD_MAX_ATTEMPTS_PER_WORD,
  WORD_CLOUD_METRICS_VERSION,
  WORD_CLOUD_SPATIAL_HASH_CELL_SIZE,
  sortLayoutWords,
  validateWordCloudLayoutRequestV1,
  validateWordCloudLayoutResultV1,
  type PlacedWordCloudWordV1,
  type WordCloudLayoutRequestV1,
  type WordCloudLayoutResultV1,
  type WordCloudLayoutWordV1,
  type WordCloudPaletteSlot,
} from "./contracts";
import {
  fitSyntheticFontSize,
  mapWordFontSizes,
} from "./synthetic-metrics";

const SPIRAL_ANGLE_STEP_RADIANS = 0.52;
const SPIRAL_RADIAL_STEP_PIXELS = 0.19;
const PALETTE_SLOTS: readonly WordCloudPaletteSlot[] = [
  "cobalt",
  "coral",
  "teal",
  "amber",
  "violet",
];
const CATEGORY_PALETTE_OFFSET = Object.freeze({
  han: 0,
  latin: 1,
  mixed: 2,
  other: 3,
});

interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WordCloudLayoutEngineOptions {
  readonly isCancelled?: () => boolean;
  readonly yieldControl?: () => Promise<void>;
}

export class WordCloudLayoutCancellation extends Error {
  constructor() {
    super("WORD_CLOUD_LAYOUT_CANCELLED");
    this.name = "WordCloudLayoutCancellation";
  }
}

function overlaps(left: Rectangle, right: Rectangle): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

class SpatialHash {
  private readonly cells = new Map<string, PlacedWordCloudWordV1[]>();

  constructor(private readonly cellSize: number) {}

  collides(candidate: Rectangle): boolean {
    const checked = new Set<PlacedWordCloudWordV1>();
    for (const key of this.cellKeys(candidate)) {
      for (const placed of this.cells.get(key) ?? []) {
        if (!checked.has(placed)) {
          checked.add(placed);
          if (overlaps(candidate, placed)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  insert(placed: PlacedWordCloudWordV1): void {
    for (const key of this.cellKeys(placed)) {
      const values = this.cells.get(key) ?? [];
      values.push(placed);
      this.cells.set(key, values);
    }
  }

  private cellKeys(rectangle: Rectangle): readonly string[] {
    const firstColumn = Math.floor(rectangle.x / this.cellSize);
    const lastColumn = Math.floor(
      (rectangle.x + rectangle.width - 1) / this.cellSize,
    );
    const firstRow = Math.floor(rectangle.y / this.cellSize);
    const lastRow = Math.floor(
      (rectangle.y + rectangle.height - 1) / this.cellSize,
    );
    const keys: string[] = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        keys.push(`${column}:${row}`);
      }
    }
    return keys;
  }
}

function paletteSlot(word: WordCloudLayoutWordV1): WordCloudPaletteSlot {
  const offset = CATEGORY_PALETTE_OFFSET[word.category];
  return PALETTE_SLOTS[(offset + word.displayRank - 1) % PALETTE_SLOTS.length]!;
}

function spiralCandidate(
  attemptIndex: number,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): Rectangle {
  if (attemptIndex === 0) {
    return {
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      width,
      height,
    };
  }
  const angle = attemptIndex * SPIRAL_ANGLE_STEP_RADIANS;
  const radius = attemptIndex * SPIRAL_RADIAL_STEP_PIXELS;
  return {
    x: Math.round(centerX + radius * Math.cos(angle) - width / 2),
    y: Math.round(centerY + radius * Math.sin(angle) - height / 2),
    width,
    height,
  };
}

function isWithinBounds(
  rectangle: Rectangle,
  request: WordCloudLayoutRequestV1,
): boolean {
  const { width, height, padding } = request.geometry;
  return rectangle.x >= padding &&
    rectangle.y >= padding &&
    rectangle.x + rectangle.width <= width - padding &&
    rectangle.y + rectangle.height <= height - padding;
}

async function checkpoint(
  options: WordCloudLayoutEngineOptions,
): Promise<void> {
  if (options.isCancelled?.() === true) {
    throw new WordCloudLayoutCancellation();
  }
  await options.yieldControl?.();
  if (options.isCancelled?.() === true) {
    throw new WordCloudLayoutCancellation();
  }
}

export async function layoutWordCloud(
  value: unknown,
  options: WordCloudLayoutEngineOptions = {},
): Promise<WordCloudLayoutResultV1> {
  const request = validateWordCloudLayoutRequestV1(value);
  const words = sortLayoutWords(request.words);
  const fontSizes = mapWordFontSizes(words);
  const spatialHash = new SpatialHash(WORD_CLOUD_SPATIAL_HASH_CELL_SIZE);
  const placed: PlacedWordCloudWordV1[] = [];
  const omitted: WordCloudLayoutResultV1["omitted"][number][] = [];
  const availableWidth = request.geometry.width - 2 * request.geometry.padding;
  const availableHeight = request.geometry.height - 2 * request.geometry.padding;
  const centerX = request.geometry.width / 2;
  const centerY = request.geometry.height / 2;

  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    await checkpoint(options);
    const word = words[wordIndex]!;
    const preferredFontSize = fontSizes.get(word.stableKey);
    if (preferredFontSize === undefined) {
      throw new Error("WORD_CLOUD_FONT_MAPPING_FAILED");
    }
    const fitted = fitSyntheticFontSize(
      word.displayToken,
      preferredFontSize,
      availableWidth,
      availableHeight,
    );
    if (fitted === null) {
      omitted.push({
        stableKey: word.stableKey,
        displayToken: word.displayToken,
        displayRank: word.displayRank,
        sourceRank: word.sourceRank,
        placementOrder: wordIndex + 1,
        reason: "TOKEN_TOO_WIDE",
      });
      continue;
    }
    let didPlace = false;
    for (
      let attemptIndex = 0;
      attemptIndex < WORD_CLOUD_MAX_ATTEMPTS_PER_WORD;
      attemptIndex += 1
    ) {
      if (attemptIndex > 0 && attemptIndex % 1_024 === 0) {
        await checkpoint(options);
      }
      const candidate = spiralCandidate(
        attemptIndex,
        centerX,
        centerY,
        fitted.box.width,
        fitted.box.height,
      );
      if (!isWithinBounds(candidate, request) || spatialHash.collides(candidate)) {
        continue;
      }
      const next: PlacedWordCloudWordV1 = {
        stableKey: word.stableKey,
        displayToken: word.displayToken,
        displayRank: word.displayRank,
        sourceRank: word.sourceRank,
        placementOrder: wordIndex + 1,
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
        fontSize: fitted.fontSize,
        rotation: 0,
        paletteSlot: paletteSlot(word),
        attempts: attemptIndex + 1,
      };
      placed.push(next);
      spatialHash.insert(next);
      didPlace = true;
      break;
    }
    if (!didPlace) {
      omitted.push({
        stableKey: word.stableKey,
        displayToken: word.displayToken,
        displayRank: word.displayRank,
        sourceRank: word.sourceRank,
        placementOrder: wordIndex + 1,
        reason: "NO_PLACEMENT",
      });
    }
  }
  await checkpoint(options);
  const total = placed.length + omitted.length;
  return validateWordCloudLayoutResultV1({
    schemaVersion: WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION,
    layoutVersion: WORD_CLOUD_LAYOUT_VERSION,
    metricsVersion: WORD_CLOUD_METRICS_VERSION,
    coordinateConvention: WORD_CLOUD_COORDINATE_CONVENTION,
    presentationDigest: request.identity.presentationDigest,
    viewportBucket: request.identity.viewportBucket,
    width: request.geometry.width,
    height: request.geometry.height,
    padding: request.geometry.padding,
    requestedWordLimit: request.identity.wordLimit,
    placedRatio: placed.length / total,
    degraded: omitted.length > 0,
    placed,
    omitted,
  });
}
