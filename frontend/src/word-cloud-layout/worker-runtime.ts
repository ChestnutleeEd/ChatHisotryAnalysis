import {
  validateWordCloudLayoutRequestV1,
  type WordCloudLayoutRequestV1,
  type WordCloudLayoutResultV1,
} from "./contracts";
import {
  layoutWordCloud,
  WordCloudLayoutCancellation,
} from "./layout-engine";

export class WordCloudLayoutRuntime {
  private activeRequestId: number | undefined;
  private readonly cancelled = new Set<number>();
  private disposed = false;
  private checkpointCount = 0;

  async layout(
    requestId: number,
    value: unknown,
  ): Promise<WordCloudLayoutResultV1> {
    if (this.disposed || !Number.isSafeInteger(requestId) || requestId <= 0) {
      throw new Error("INVALID_LAYOUT_REQUEST");
    }
    const request = validateWordCloudLayoutRequestV1(value);
    if (this.activeRequestId !== undefined && this.activeRequestId !== requestId) {
      this.cancelled.add(this.activeRequestId);
    }
    this.activeRequestId = requestId;
    this.cancelled.delete(requestId);
    try {
      return await layoutWordCloud(request, {
        isCancelled: () => this.disposed || this.cancelled.has(requestId) ||
          this.activeRequestId !== requestId,
        yieldControl: async () => {
          this.checkpointCount += 1;
          if (this.checkpointCount % 4 === 0) {
            await new Promise<void>((resolve) => {
              globalThis.setTimeout(resolve, 0);
            });
          }
        },
      });
    } finally {
      this.cancelled.delete(requestId);
      if (this.activeRequestId === requestId) {
        this.activeRequestId = undefined;
      }
    }
  }

  cancel(requestId: number): void {
    if (Number.isSafeInteger(requestId) && requestId > 0) {
      this.cancelled.add(requestId);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.activeRequestId !== undefined) {
      this.cancelled.add(this.activeRequestId);
    }
  }
}

export function isWordCloudLayoutCancellation(
  error: unknown,
): error is WordCloudLayoutCancellation {
  return error instanceof WordCloudLayoutCancellation;
}

export function requestCorrelationMatches(
  request: WordCloudLayoutRequestV1,
  datasetId: unknown,
  generation: unknown,
): boolean {
  return request.identity.datasetId === datasetId &&
    request.identity.generation === generation;
}
