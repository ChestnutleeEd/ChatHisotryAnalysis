import { describe, expect, it, vi } from "vitest";

import {
  WordCloudLayoutClient,
  WordCloudLayoutClientCancelledError,
  type WordCloudLayoutWorkerPort,
} from "../src/word-cloud-layout/client";
import { WordCloudLayoutCache } from "../src/word-cloud-layout/cache";
import {
  WORD_CLOUD_LAYOUT_CACHE_CAPACITY,
  WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION,
  WORD_CLOUD_LAYOUT_VERSION,
  WORD_CLOUD_METRICS_VERSION,
  layoutCacheKey,
  type WordCloudLayoutRequestV1,
  type WordCloudLayoutResultV1,
} from "../src/word-cloud-layout/contracts";
import {
  WordCloudLayoutCoordinator,
  scaleWordCloudLayout,
} from "../src/word-cloud-layout/coordinator";
import type {
  WordCloudLayoutWorkerRequest,
  WordCloudLayoutWorkerResponse,
} from "../src/word-cloud-layout/protocol";
import { createWordCloudLayoutWorkerHandler } from "../src/word-cloud-layout/worker-handler";
import { WordCloudLayoutRuntime } from "../src/word-cloud-layout/worker-runtime";
import {
  createSyntheticLayoutRequest,
} from "./word-cloud-layout-fixtures";

class InMemoryLayoutWorker implements WordCloudLayoutWorkerPort {
  onmessage: ((event: MessageEvent<WordCloudLayoutWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: WordCloudLayoutWorkerRequest[] = [];
  private closed = false;
  private readonly handler;

  constructor() {
    const scope = {
      onmessage: null,
      postMessage: (message: WordCloudLayoutWorkerResponse): void => {
        queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<WordCloudLayoutWorkerResponse>));
      },
      close: (): void => { this.closed = true; },
    };
    this.handler = createWordCloudLayoutWorkerHandler(
      scope,
      new WordCloudLayoutRuntime(),
    );
  }

  postMessage(message: WordCloudLayoutWorkerRequest): void {
    if (this.closed) {
      throw new Error("closed");
    }
    this.messages.push(message);
    queueMicrotask(() => this.handler({ data: message } as MessageEvent<WordCloudLayoutWorkerRequest>));
  }

  terminate(): void {
    this.closed = true;
  }
}

function omittedResult(request: WordCloudLayoutRequestV1): WordCloudLayoutResultV1 {
  return {
    schemaVersion: WORD_CLOUD_LAYOUT_RESULT_SCHEMA_VERSION,
    layoutVersion: WORD_CLOUD_LAYOUT_VERSION,
    metricsVersion: WORD_CLOUD_METRICS_VERSION,
    coordinateConvention: "top-left",
    presentationDigest: request.identity.presentationDigest,
    viewportBucket: request.identity.viewportBucket,
    width: request.geometry.width,
    height: request.geometry.height,
    padding: request.geometry.padding,
    requestedWordLimit: request.identity.wordLimit,
    placedRatio: 0,
    degraded: true,
    placed: [],
    omitted: request.words.map((word, index) => ({
      stableKey: word.stableKey,
      displayToken: word.displayToken,
      displayRank: word.displayRank,
      sourceRank: word.sourceRank,
      placementOrder: index + 1,
      reason: "NO_PLACEMENT",
    })),
  };
}

class AlwaysOmitWorker implements WordCloudLayoutWorkerPort {
  onmessage: ((event: MessageEvent<WordCloudLayoutWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly limits: number[] = [];

  postMessage(message: WordCloudLayoutWorkerRequest): void {
    if (message.type !== "layout") {
      return;
    }
    this.limits.push(message.request.identity.wordLimit);
    const response: WordCloudLayoutWorkerResponse = {
      type: "result",
      requestId: message.requestId,
      datasetId: message.datasetId,
      generation: message.generation,
      result: omittedResult(message.request),
    };
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<WordCloudLayoutWorkerResponse>));
  }

  terminate(): void {}
}

describe("dedicated word-cloud layout Worker lifecycle and cache", () => {
  it("executes geometry through the dedicated Worker protocol", async () => {
    const worker = new InMemoryLayoutWorker();
    const client = new WordCloudLayoutClient(() => worker);
    const request = createSyntheticLayoutRequest(40, "narrow");
    const result = await client.layout(request);
    expect(result.presentationDigest).toBe(request.identity.presentationDigest);
    expect(worker.messages.some((message) => message.type === "layout")).toBe(true);
    expect(worker.messages.every((message) =>
      message.type !== "layout" || !Object.hasOwn(message.request, "dataset")
    )).toBe(true);
    client.dispose();
    expect(worker.messages.at(-1)).toEqual({ type: "dispose" });
  });

  it("cancels replacement work and suppresses a stale role/year result", async () => {
    const worker = new InMemoryLayoutWorker();
    const client = new WordCloudLayoutClient(() => worker);
    const stale = client.layout(createSyntheticLayoutRequest(100, "wide"));
    const currentRequest = createSyntheticLayoutRequest(20, "narrow");
    const current = client.layout(currentRequest);
    await expect(stale).rejects.toBeInstanceOf(WordCloudLayoutClientCancelledError);
    await expect(current).resolves.toMatchObject({
      presentationDigest: currentRequest.identity.presentationDigest,
      viewportBucket: "narrow",
    });
    expect(worker.messages.some((message) => message.type === "cancel")).toBe(true);
    client.dispose();
  });

  it("supports explicit cancellation without publishing late geometry", async () => {
    const worker = new InMemoryLayoutWorker();
    const client = new WordCloudLayoutClient(() => worker);
    const pending = client.layout(createSyntheticLayoutRequest(100, "wide"));
    client.cancelActive();
    await expect(pending).rejects.toBeInstanceOf(WordCloudLayoutClientCancelledError);
    client.dispose();
  });

  it("keeps a six-entry LRU with hit refresh, miss, and deterministic eviction", async () => {
    const cache = new WordCloudLayoutCache();
    expect(cache.capacity).toBe(WORD_CLOUD_LAYOUT_CACHE_CAPACITY);
    const requests = Array.from({ length: 7 }, (_, index) =>
      createSyntheticLayoutRequest(20 + index, "wide")
    );
    const results = await Promise.all(requests.map((request) =>
      import("../src/word-cloud-layout/layout-engine").then(({ layoutWordCloud }) =>
        layoutWordCloud(request)
      )
    ));
    for (let index = 0; index < 6; index += 1) {
      cache.set(layoutCacheKey(requests[index]!), results[index]!);
    }
    expect(cache.size).toBe(6);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.get(layoutCacheKey(requests[0]!))).toBe(results[0]);
    cache.set(layoutCacheKey(requests[6]!), results[6]!);
    expect(cache.size).toBe(6);
    expect(cache.has(layoutCacheKey(requests[1]!))).toBe(false);
    expect(cache.has(layoutCacheKey(requests[0]!))).toBe(true);
  });

  it("invalidates cache identity on layout/metrics/bucket changes but not exact within-bucket width", () => {
    const standard = createSyntheticLayoutRequest(20, "standard");
    const wide = createSyntheticLayoutRequest(20, "wide");
    const base = layoutCacheKey(standard);
    expect(layoutCacheKey(wide)).not.toBe(base);
    expect(layoutCacheKey({ ...standard, layoutVersion: "test-v2" as never })).not.toBe(base);
    expect(layoutCacheKey({ ...standard, metricsVersion: "metrics-v2" as never })).not.toBe(base);
    expect(layoutCacheKey(standard)).toBe(base);
  });

  it("coordinates frozen 100→80→60→40→20 degradation outside the placement engine", async () => {
    const worker = new AlwaysOmitWorker();
    const client = new WordCloudLayoutClient(() => worker);
    const coordinator = new WordCloudLayoutCoordinator(client);
    const outcome = await coordinator.layout(createSyntheticLayoutRequest(100, "wide"));
    expect(worker.limits).toEqual([100, 80, 60, 40, 20]);
    expect(outcome.attemptedWordLimits).toEqual([100, 80, 60, 40, 20]);
    expect(outcome.effectiveWordLimit).toBe(20);
    expect(outcome.fallbackReason).toBe("NO_WORDS_PLACED");
    coordinator.dispose();
  });

  it("degrades a dense real synthetic cloud until every selected word fits", async () => {
    const worker = new InMemoryLayoutWorker();
    const coordinator = new WordCloudLayoutCoordinator(
      new WordCloudLayoutClient(() => worker),
    );
    const outcome = await coordinator.layout(createSyntheticLayoutRequest(80, "standard"));
    expect(outcome.attemptedWordLimits).toEqual([80, 60, 40]);
    expect(outcome.effectiveWordLimit).toBe(40);
    expect(outcome.fallbackReason).toBe("REDUCED_WORD_LIMIT");
    expect(outcome.result.placed).toHaveLength(40);
    expect(outcome.result.omitted).toEqual([]);
    coordinator.dispose();
  });

  it("returns byte-identical cache hits and scales inside a bucket without relayout", async () => {
    const worker = new InMemoryLayoutWorker();
    const client = new WordCloudLayoutClient(() => worker);
    const coordinator = new WordCloudLayoutCoordinator(client);
    const request = createSyntheticLayoutRequest(20, "standard");
    const first = await coordinator.layout(request);
    const layoutMessages = worker.messages.filter((message) => message.type === "layout").length;
    const cached = await coordinator.layout(request);
    expect(JSON.stringify(cached.result)).toBe(JSON.stringify(first.result));
    expect(worker.messages.filter((message) => message.type === "layout")).toHaveLength(layoutMessages);
    const scaled = scaleWordCloudLayout(cached.result, 900);
    expect(scaled.width).toBe(900);
    expect(scaled.height).toBeCloseTo(900 * 560 / 760);
    expect(worker.messages.filter((message) => message.type === "layout")).toHaveLength(layoutMessages);
    coordinator.dispose();
  });

  it("clears cached geometry on dataset/generation replacement", async () => {
    const worker = new InMemoryLayoutWorker();
    const client = new WordCloudLayoutClient(() => worker);
    const cache = new WordCloudLayoutCache();
    const clear = vi.spyOn(cache, "clear");
    const coordinator = new WordCloudLayoutCoordinator(client, cache);
    await coordinator.layout(createSyntheticLayoutRequest(20, "standard"));
    await coordinator.layout(createSyntheticLayoutRequest(20, "standard", undefined, 2 as never));
    expect(clear).toHaveBeenCalled();
    coordinator.dispose();
  });
});
