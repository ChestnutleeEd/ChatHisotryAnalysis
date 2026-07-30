import type {
  AcceptedDatasetResult,
  AnalysisResult,
  AnalysisSettings,
  TokenizerSettings,
  WorkerFailureCode,
  WorkerProgress,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";
import { DEFAULT_TOKENIZER_SETTINGS } from "./protocol";

export interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerPort;

export class WorkerClientError extends Error {
  readonly code: WorkerFailureCode;

  constructor(code: WorkerFailureCode) {
    super(code);
    this.name = "WorkerClientError";
    this.code = code;
  }
}

export class WorkerClientCancelledError extends Error {
  constructor() {
    super("WORKER_OPERATION_CANCELLED");
    this.name = "WorkerClientCancelledError";
  }
}

interface PendingOperation<Result> {
  readonly resolve: (result: Result) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: (progress: WorkerProgress) => void;
  readonly timeout: ReturnType<typeof globalThis.setTimeout>;
}

function defaultWorkerFactory(): WorkerPort {
  return new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    name: "local-chat-analysis",
    type: "module",
  });
}

export class AnalysisWorkerClient {
  private worker: WorkerPort | undefined;
  private nextOperationId = 1;
  private activeOperationId: number | undefined;
  private readonly pending = new Map<
    number,
    PendingOperation<AcceptedDatasetResult | AnalysisResult>
  >();
  private readonly cancelWaiters = new Map<number, () => void>();

  constructor(
    private readonly workerFactory: WorkerFactory = defaultWorkerFactory,
  ) {}

  loadDataset(
    files: readonly File[],
    onProgress?: (progress: WorkerProgress) => void,
    tokenizerSettings: TokenizerSettings = DEFAULT_TOKENIZER_SETTINGS,
  ): Promise<AcceptedDatasetResult> {
    return this.startOperation<AcceptedDatasetResult>(
      (operationId) => ({
        type: "load-dataset",
        operationId,
        files,
        tokenizerSettings,
      }),
      onProgress,
    );
  }

  analyze(
    settings: AnalysisSettings,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<AnalysisResult> {
    return this.startOperation<AnalysisResult>(
      (operationId) => ({
        type: "analyze",
        operationId,
        settings,
      }),
      onProgress,
    );
  }

  cancelActive(): void {
    const worker = this.worker;
    const operationId = this.activeOperationId;
    if (worker === undefined || operationId === undefined) {
      return;
    }
    worker.postMessage({ type: "cancel", operationId });
    this.rejectOperation(operationId, new WorkerClientCancelledError());
  }

  async stop(timeoutMilliseconds = 2_000): Promise<void> {
    const worker = this.worker;
    const operationId = this.activeOperationId;
    if (worker === undefined || operationId === undefined) {
      this.terminateWorker(new WorkerClientError("WORKER_TERMINATED"));
      return;
    }

    const acknowledged = new Promise<void>((resolve) => {
      this.cancelWaiters.set(operationId, resolve);
    });
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timeout = globalThis.setTimeout(resolve, timeoutMilliseconds);
    });
    worker.postMessage({ type: "cancel", operationId });
    await Promise.race([acknowledged, timedOut]);
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout);
    }
    this.cancelWaiters.delete(operationId);
    this.terminateWorker(new WorkerClientCancelledError());
  }

  dispose(): void {
    const worker = this.worker;
    if (worker !== undefined) {
      try {
        worker.postMessage({ type: "dispose" });
      } catch {
        // Termination below is the authoritative release boundary.
      }
    }
    this.terminateWorker(new WorkerClientError("WORKER_TERMINATED"));
  }

  private startOperation<Result extends AcceptedDatasetResult | AnalysisResult>(
    request: (operationId: number) => WorkerRequest,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<Result> {
    let worker: WorkerPort;
    try {
      worker = this.ensureWorker();
    } catch {
      return Promise.reject(
        new WorkerClientError("WORKER_CREATION_FAILED"),
      );
    }

    if (this.activeOperationId !== undefined) {
      const staleId = this.activeOperationId;
      worker.postMessage({ type: "cancel", operationId: staleId });
      this.rejectOperation(staleId, new WorkerClientCancelledError());
    }

    const operationId = this.nextOperationId;
    this.nextOperationId += 1;
    this.activeOperationId = operationId;
    return new Promise<Result>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.rejectOperation(
          operationId,
          new WorkerClientError("WORKER_TIMEOUT"),
        );
        this.terminateWorker(new WorkerClientError("WORKER_TIMEOUT"));
      }, 300_000);
      this.pending.set(operationId, {
        resolve: resolve as (
          result: AcceptedDatasetResult | AnalysisResult,
        ) => void,
        reject,
        onProgress,
        timeout,
      });
      try {
        worker.postMessage(request(operationId));
      } catch {
        this.rejectOperation(
          operationId,
          new WorkerClientError("WORKER_RUNTIME_FAILED"),
        );
      }
    });
  }

  private ensureWorker(): WorkerPort {
    if (this.worker !== undefined) {
      return this.worker;
    }
    const worker = this.workerFactory();
    worker.onmessage = (event): void => {
      this.handleMessage(event.data);
    };
    worker.onerror = (event): void => {
      event.preventDefault?.();
      this.terminateWorker(
        new WorkerClientError("WORKER_RUNTIME_FAILED"),
      );
    };
    worker.onmessageerror = (): void => {
      this.terminateWorker(
        new WorkerClientError("WORKER_RUNTIME_FAILED"),
      );
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(response: WorkerResponse): void {
    if (response.type === "progress") {
      this.pending
        .get(response.operationId)
        ?.onProgress?.(response);
      return;
    }
    if (response.type === "cancelled") {
      this.rejectOperation(
        response.operationId,
        new WorkerClientCancelledError(),
      );
      this.cancelWaiters.get(response.operationId)?.();
      return;
    }
    if (response.type === "error") {
      this.rejectOperation(
        response.operationId,
        new WorkerClientError(response.code),
      );
      return;
    }
    const operation = this.pending.get(response.operationId);
    if (operation === undefined) {
      return;
    }
    globalThis.clearTimeout(operation.timeout);
    this.pending.delete(response.operationId);
    if (this.activeOperationId === response.operationId) {
      this.activeOperationId = undefined;
    }
    operation.resolve(
      response.type === "accepted"
        ? { summary: response.summary, result: response.result }
        : response.result,
    );
  }

  private rejectOperation(operationId: number, error: Error): void {
    const operation = this.pending.get(operationId);
    if (operation === undefined) {
      return;
    }
    globalThis.clearTimeout(operation.timeout);
    this.pending.delete(operationId);
    if (this.activeOperationId === operationId) {
      this.activeOperationId = undefined;
    }
    operation.reject(error);
  }

  private terminateWorker(error: Error): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.activeOperationId = undefined;
    for (const operationId of [...this.pending.keys()]) {
      this.rejectOperation(operationId, error);
    }
    for (const resolve of this.cancelWaiters.values()) {
      resolve();
    }
    this.cancelWaiters.clear();
  }
}
