import {
  validateWordCloudLayoutRequestV1,
  validateWordCloudLayoutResultV1,
  type WordCloudLayoutRequestV1,
  type WordCloudLayoutResultV1,
} from "./contracts";
import type {
  WordCloudLayoutWorkerFailureCode,
  WordCloudLayoutWorkerRequest,
  WordCloudLayoutWorkerResponse,
} from "./protocol";

export interface WordCloudLayoutWorkerPort {
  onmessage: ((event: MessageEvent<WordCloudLayoutWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WordCloudLayoutWorkerRequest): void;
  terminate(): void;
}

export type WordCloudLayoutWorkerFactory = () => WordCloudLayoutWorkerPort;

export class WordCloudLayoutClientError extends Error {
  constructor(readonly code: WordCloudLayoutWorkerFailureCode | "WORKER_TERMINATED") {
    super(code);
    this.name = "WordCloudLayoutClientError";
  }
}

export class WordCloudLayoutClientCancelledError extends Error {
  constructor() {
    super("WORD_CLOUD_LAYOUT_CANCELLED");
    this.name = "WordCloudLayoutClientCancelledError";
  }
}

interface PendingLayout {
  readonly request: WordCloudLayoutRequestV1;
  readonly resolve: (result: WordCloudLayoutResultV1) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof globalThis.setTimeout>;
}

function defaultWorkerFactory(): WordCloudLayoutWorkerPort {
  return new Worker(new URL("./word-cloud-layout.worker.ts", import.meta.url), {
    name: "beta-word-cloud-layout",
    type: "module",
  });
}

export class WordCloudLayoutClient {
  private worker: WordCloudLayoutWorkerPort | undefined;
  private nextRequestId = 1;
  private activeRequestId: number | undefined;
  private readonly pending = new Map<number, PendingLayout>();

  constructor(
    private readonly workerFactory: WordCloudLayoutWorkerFactory = defaultWorkerFactory,
  ) {}

  layout(value: unknown): Promise<WordCloudLayoutResultV1> {
    const request = validateWordCloudLayoutRequestV1(value);
    const worker = this.ensureWorker();
    this.cancelActive();
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.activeRequestId = requestId;
    return new Promise<WordCloudLayoutResultV1>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.reject(requestId, new WordCloudLayoutClientError("LAYOUT_RUNTIME_FAILED"));
      }, 60_000);
      this.pending.set(requestId, { request, resolve, reject, timeout });
      try {
        worker.postMessage({
          type: "layout",
          requestId,
          datasetId: request.identity.datasetId,
          generation: request.identity.generation,
          request,
        });
      } catch {
        this.reject(
          requestId,
          new WordCloudLayoutClientError("LAYOUT_RUNTIME_FAILED"),
        );
      }
    });
  }

  cancelActive(): void {
    const requestId = this.activeRequestId;
    if (requestId === undefined) {
      return;
    }
    try {
      this.worker?.postMessage({ type: "cancel", requestId });
    } catch {
      // Rejecting the local operation is the publication fence.
    }
    this.reject(requestId, new WordCloudLayoutClientCancelledError());
  }

  dispose(): void {
    try {
      this.worker?.postMessage({ type: "dispose" });
    } catch {
      // Termination below is authoritative.
    }
    this.terminate(new WordCloudLayoutClientError("WORKER_TERMINATED"));
  }

  private ensureWorker(): WordCloudLayoutWorkerPort {
    if (this.worker !== undefined) {
      return this.worker;
    }
    const worker = this.workerFactory();
    worker.onmessage = (event): void => {
      this.handleMessage(event.data);
    };
    worker.onerror = (event): void => {
      event.preventDefault?.();
      this.terminate(new WordCloudLayoutClientError("LAYOUT_RUNTIME_FAILED"));
    };
    worker.onmessageerror = (): void => {
      this.terminate(new WordCloudLayoutClientError("LAYOUT_RUNTIME_FAILED"));
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(response: WordCloudLayoutWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (pending === undefined || response.requestId !== this.activeRequestId) {
      return;
    }
    if (response.type === "cancelled") {
      this.reject(response.requestId, new WordCloudLayoutClientCancelledError());
      return;
    }
    if (response.type === "error") {
      this.reject(response.requestId, new WordCloudLayoutClientError(response.code));
      return;
    }
    if (
      response.datasetId !== pending.request.identity.datasetId ||
      response.generation !== pending.request.identity.generation
    ) {
      return;
    }
    let result: WordCloudLayoutResultV1;
    try {
      result = validateWordCloudLayoutResultV1(response.result);
    } catch {
      this.reject(
        response.requestId,
        new WordCloudLayoutClientError("INVALID_LAYOUT_REQUEST"),
      );
      return;
    }
    if (
      result.presentationDigest !== pending.request.identity.presentationDigest ||
      result.viewportBucket !== pending.request.identity.viewportBucket ||
      result.requestedWordLimit !== pending.request.identity.wordLimit ||
      result.placed.length + result.omitted.length !== pending.request.words.length ||
      new Set([...result.placed, ...result.omitted].map((word) => word.stableKey)).size !==
        pending.request.words.length ||
      pending.request.words.some((word) =>
        ![...result.placed, ...result.omitted].some((item) =>
          item.stableKey === word.stableKey
        )
      )
    ) {
      this.reject(
        response.requestId,
        new WordCloudLayoutClientError("INVALID_LAYOUT_REQUEST"),
      );
      return;
    }
    globalThis.clearTimeout(pending.timeout);
    this.pending.delete(response.requestId);
    this.activeRequestId = undefined;
    pending.resolve(result);
  }

  private reject(requestId: number, error: Error): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }
    globalThis.clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    if (this.activeRequestId === requestId) {
      this.activeRequestId = undefined;
    }
    pending.reject(error);
  }

  private terminate(error: Error): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.activeRequestId = undefined;
    for (const requestId of [...this.pending.keys()]) {
      this.reject(requestId, error);
    }
  }
}
