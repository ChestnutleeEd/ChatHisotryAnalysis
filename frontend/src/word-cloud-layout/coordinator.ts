import type { DatasetId, Generation } from "../desktop/ipc-contract";
import { WordCloudLayoutCache } from "./cache";
import {
  WORD_CLOUD_MIN_USABLE_WORDS,
  WORD_CLOUD_PROGRESSIVE_LIMITS,
  layoutCacheKey,
  requestWithWordLimit,
  validateWordCloudLayoutRequestV1,
  type PlacedWordCloudWordV1,
  type WordCloudLayoutRequestV1,
  type WordCloudLayoutResultV1,
} from "./contracts";
import {
  WordCloudLayoutClient,
  WordCloudLayoutClientCancelledError,
} from "./client";

export type WordCloudLayoutFallbackReason =
  | "REDUCED_WORD_LIMIT"
  | "MINIMUM_WORD_LIMIT_REACHED"
  | "NO_WORDS_PLACED";

export interface CoordinatedWordCloudLayoutResult {
  readonly result: WordCloudLayoutResultV1;
  readonly attemptedWordLimits: readonly number[];
  readonly effectiveWordLimit: number;
  readonly fallbackReason: WordCloudLayoutFallbackReason | null;
}

export interface ScaledWordCloudLayout {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly placed: readonly (Omit<
    PlacedWordCloudWordV1,
    "x" | "y" | "width" | "height" | "fontSize"
  > & {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly fontSize: number;
  })[];
}

function progressiveLimits(request: WordCloudLayoutRequestV1): readonly number[] {
  const available = request.words.length;
  const requested = Math.min(request.identity.wordLimit, available);
  if (available < WORD_CLOUD_MIN_USABLE_WORDS) {
    return [requested];
  }
  return [
    requested,
    ...WORD_CLOUD_PROGRESSIVE_LIMITS.filter((limit) =>
      limit < requested && limit >= WORD_CLOUD_MIN_USABLE_WORDS
    ),
  ].filter((limit, index, values) => values.indexOf(limit) === index);
}

export function scaleWordCloudLayout(
  result: WordCloudLayoutResultV1,
  cssWidth: number,
): ScaledWordCloudLayout {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) {
    throw new Error("INVALID_WORD_CLOUD_SCALE_WIDTH");
  }
  const scale = cssWidth / result.width;
  return {
    scale,
    width: cssWidth,
    height: result.height * scale,
    placed: result.placed.map((word) => ({
      ...word,
      x: word.x * scale,
      y: word.y * scale,
      width: word.width * scale,
      height: word.height * scale,
      fontSize: word.fontSize * scale,
    })),
  };
}

export class WordCloudLayoutCoordinator {
  private sequence = 0;
  private context: { datasetId: DatasetId | null; generation: Generation } | undefined;

  constructor(
    private readonly client = new WordCloudLayoutClient(),
    readonly cache = new WordCloudLayoutCache(),
  ) {}

  async layout(value: unknown): Promise<CoordinatedWordCloudLayoutResult> {
    const request = validateWordCloudLayoutRequestV1(value);
    this.updateContext(request.identity.datasetId, request.identity.generation);
    this.sequence += 1;
    const sequence = this.sequence;
    this.client.cancelActive();
    const attemptedWordLimits: number[] = [];
    let lastResult: WordCloudLayoutResultV1 | undefined;
    for (const wordLimit of progressiveLimits(request)) {
      if (sequence !== this.sequence) {
        throw new WordCloudLayoutClientCancelledError();
      }
      attemptedWordLimits.push(wordLimit);
      const attemptRequest = requestWithWordLimit(request, wordLimit);
      const key = layoutCacheKey(attemptRequest);
      const cached = this.cache.get(key);
      const result = cached ?? await this.client.layout(attemptRequest);
      if (cached === undefined) {
        this.cache.set(key, result);
      }
      if (sequence !== this.sequence) {
        throw new WordCloudLayoutClientCancelledError();
      }
      lastResult = result;
      if (result.omitted.length === 0) {
        return {
          result,
          attemptedWordLimits,
          effectiveWordLimit: wordLimit,
          fallbackReason: wordLimit < request.identity.wordLimit
            ? "REDUCED_WORD_LIMIT"
            : null,
        };
      }
    }
    if (lastResult === undefined) {
      throw new Error("WORD_CLOUD_LAYOUT_COORDINATION_FAILED");
    }
    return {
      result: lastResult,
      attemptedWordLimits,
      effectiveWordLimit: lastResult.requestedWordLimit,
      fallbackReason: lastResult.placed.length === 0
        ? "NO_WORDS_PLACED"
        : "MINIMUM_WORD_LIMIT_REACHED",
    };
  }

  cancel(): void {
    this.sequence += 1;
    this.client.cancelActive();
  }

  dispose(): void {
    this.sequence += 1;
    this.cache.clear();
    this.context = undefined;
    this.client.dispose();
  }

  private updateContext(
    datasetId: DatasetId | null,
    generation: Generation,
  ): void {
    if (
      this.context !== undefined &&
      (this.context.datasetId !== datasetId || this.context.generation !== generation)
    ) {
      this.cache.clear();
      this.client.cancelActive();
    }
    this.context = { datasetId, generation };
  }
}
