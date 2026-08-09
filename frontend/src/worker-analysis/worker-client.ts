import { invoke } from "@tauri-apps/api/core";

import type {
  AcceptedDatasetResult,
  AnalysisResult,
  AnalysisSettings,
  TokenizerSettings,
  WorkerFailureCode,
  WorkerProgress,
  WorkerRequest,
  WorkerResponse,
  DesktopTransportRequest,
  DesktopDatasetSourceRequest,
  WorkerOperationCapability,
} from "./protocol";
import { DEFAULT_TOKENIZER_SETTINGS } from "./protocol";
import type { ResultId } from "../desktop/ipc-contract";
import type {
  CanonicalAnalysisResult,
  CanonicalAnalysisSettings,
} from "./analytics-contract";
import type {
  WorkerWordFrequencyDtoV1,
  WorkerWordFrequencyQueryV1,
} from "./word-frequency-contract";

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
  readonly generation: number;
  lastSequence: number;
  readonly resolve: (result: Result) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: (progress: WorkerProgress) => void;
  readonly timeout: ReturnType<typeof globalThis.setTimeout>;
}

const DESKTOP_TRANSPORT_COMMANDS: ReadonlySet<DesktopTransportRequest["command"]> = new Set([
  "open_dataset_stream",
  "receive_dataset_chunk",
  "complete_dataset_stream",
  "cancel_dataset_stream",
  "close_dataset_stream",
  "commit_worker_result",
]);

function isDesktopTransportRequest(
  value: DesktopTransportRequest,
): boolean {
  return (
    Number.isSafeInteger(value.requestId) &&
    value.requestId > 0 &&
    DESKTOP_TRANSPORT_COMMANDS.has(value.command) &&
    value.args !== null &&
    typeof value.args === "object" &&
    !Array.isArray(value.args) &&
    Object.keys(value.args).length === 1 &&
    Object.hasOwn(value.args, "request")
  );
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
  private nextGeneration = 1;
  private activeOperationId: number | undefined;
  private lastCommittedResultId: ResultId | undefined;
  private readonly pending = new Map<
    number,
    PendingOperation<
      AcceptedDatasetResult | AnalysisResult | CanonicalAnalysisResult
      | WorkerWordFrequencyDtoV1
    >
  >();
  private readonly cancelWaiters = new Map<number, () => void>();

  constructor(
    private readonly workerFactory: WorkerFactory = defaultWorkerFactory,
  ) {}

  get committedResultId(): ResultId | undefined {
    return this.lastCommittedResultId;
  }

  loadDataset(
    files: readonly File[],
    onProgress?: (progress: WorkerProgress) => void,
    tokenizerSettings: TokenizerSettings = DEFAULT_TOKENIZER_SETTINGS,
  ): Promise<AcceptedDatasetResult> {
    return this.startOperation<AcceptedDatasetResult>(
      (operationId, generation, sequence) => ({
        type: "load-dataset",
        operationId,
        generation,
        sequence,
        source: {
          kind: "browser-file-source",
          files,
        },
        tokenizerSettings,
      }),
      onProgress,
    );
  }

  loadDesktopDataset(
    source: Omit<DesktopDatasetSourceRequest, "kind">,
    onProgress?: (progress: WorkerProgress) => void,
    tokenizerSettings: TokenizerSettings = DEFAULT_TOKENIZER_SETTINGS,
  ): Promise<AcceptedDatasetResult> {
    return this.startOperation<AcceptedDatasetResult>(
      (operationId, generation, sequence) => ({
        type: "load-dataset",
        operationId,
        generation,
        sequence,
        source: {
          kind: "desktop-dataset-source",
          ...source,
        },
        tokenizerSettings,
      }),
      onProgress,
      source.generation,
    );
  }

  analyze(
    settings: AnalysisSettings,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<AnalysisResult> {
    return this.startOperation<AnalysisResult>(
      (operationId, generation, sequence) => ({
        type: "analyze",
        operationId,
        generation,
        sequence,
        settings,
      }),
      onProgress,
    );
  }

  analyzeCanonical(
    settings: CanonicalAnalysisSettings,
    onProgress?: (progress: WorkerProgress) => void,
    workerCapability?: WorkerOperationCapability,
  ): Promise<CanonicalAnalysisResult> {
    return this.startOperation<CanonicalAnalysisResult>(
      (operationId, generation, sequence) => ({
        type: "analyze",
        operationId,
        generation,
        sequence,
        settings,
        ...(workerCapability === undefined ? {} : { workerCapability }),
      }),
      onProgress,
    );
  }

  analyzeWordFrequency(
    query: WorkerWordFrequencyQueryV1,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<WorkerWordFrequencyDtoV1> {
    return this.startOperation<WorkerWordFrequencyDtoV1>(
      (operationId, generation, sequence) => ({
        type: "word-frequency",
        operationId,
        generation,
        sequence,
        query,
      }),
      onProgress,
      undefined,
      true,
    );
  }

  cancelActive(): void {
    const worker = this.worker;
    const operationId = this.activeOperationId;
    if (worker === undefined || operationId === undefined) {
      return;
    }
    const pending = this.pending.get(operationId);
    worker.postMessage({
      type: "cancel",
      operationId,
      generation: pending?.generation ?? operationId,
      sequence: (pending?.lastSequence ?? 1) + 1,
    });
    this.rejectOperation(operationId, new WorkerClientCancelledError());
  }

  /**
   * Cancel the active operation and wait for the Worker acknowledgement while
   * keeping the Worker/runtime alive for a same-dataset replacement.  A
   * timeout is a hard lifecycle boundary: the Worker is terminated and the
   * caller must fence the host operation before starting another one.
   */
  async cancelActiveAndWait(timeoutMilliseconds = 2_000): Promise<boolean> {
    const worker = this.worker;
    const operationId = this.activeOperationId;
    if (worker === undefined || operationId === undefined) {
      return true;
    }
    let didAcknowledge = false;
    const acknowledged = new Promise<void>((resolve) => {
      this.cancelWaiters.set(operationId, () => {
        didAcknowledge = true;
        resolve();
      });
    });
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timeout = globalThis.setTimeout(resolve, timeoutMilliseconds);
    });
    const pending = this.pending.get(operationId);
    try {
      worker.postMessage({
        type: "cancel",
        operationId,
        generation: pending?.generation ?? operationId,
        sequence: (pending?.lastSequence ?? 1) + 1,
      });
    } catch {
      if (timeout !== undefined) {
        globalThis.clearTimeout(timeout);
      }
      this.cancelWaiters.delete(operationId);
      this.terminateWorker(new WorkerClientError("WORKER_RUNTIME_FAILED"));
      return false;
    }
    await Promise.race([acknowledged, timedOut]);
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout);
    }
    this.cancelWaiters.delete(operationId);
    if (!didAcknowledge || this.activeOperationId === operationId) {
      this.terminateWorker(new WorkerClientError("WORKER_TIMEOUT"));
      return false;
    }
    return true;
  }

  async stop(timeoutMilliseconds = 2_000): Promise<void> {
    const worker = this.worker;
    const operationId = this.activeOperationId;
    if (worker === undefined || operationId === undefined) {
      this.terminateWorker(new WorkerClientError("WORKER_TERMINATED"));
      return;
    }

    await this.cancelActiveAndWait(timeoutMilliseconds);
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

  private startOperation<
    Result extends
      | AcceptedDatasetResult
      | AnalysisResult
      | CanonicalAnalysisResult
      | WorkerWordFrequencyDtoV1,
  >(
    request: (
      operationId: number,
      generation: number,
      sequence: number,
    ) => WorkerRequest,
    onProgress?: (progress: WorkerProgress) => void,
    requestedGeneration?: number,
    preserveCommittedResultId = false,
  ): Promise<Result> {
    if (!preserveCommittedResultId) {
      this.lastCommittedResultId = undefined;
    }
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
      const stalePending = this.pending.get(staleId);
      worker.postMessage({
        type: "cancel",
        operationId: staleId,
        generation: stalePending?.generation ?? staleId,
        sequence: (stalePending?.lastSequence ?? 1) + 1,
      });
      this.rejectOperation(staleId, new WorkerClientCancelledError());
    }

    const operationId = this.nextOperationId;
    this.nextOperationId += 1;
    const generation = requestedGeneration ?? Math.max(this.nextGeneration, operationId);
    this.nextGeneration = generation + 1;
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
        generation,
        lastSequence: 1,
        resolve: resolve as (
          result:
            | AcceptedDatasetResult
            | AnalysisResult
            | CanonicalAnalysisResult
            | WorkerWordFrequencyDtoV1,
        ) => void,
        reject,
        onProgress,
        timeout,
      });
      try {
        worker.postMessage(request(operationId, generation, 1));
      } catch {
        this.rejectOperation(
          operationId,
          new WorkerClientError("WORKER_RUNTIME_FAILED"),
        );
      }
    });
  }

  private async handleDesktopTransportRequest(
    request: DesktopTransportRequest,
  ): Promise<void> {
    const worker = this.worker;
    if (worker === undefined || !isDesktopTransportRequest(request)) {
      return;
    }
    try {
      const value = await invoke<unknown>(request.command, request.args);
      worker.postMessage({
        type: "desktop-transport-response",
        requestId: request.requestId,
        accepted: true,
        value,
      } as unknown as WorkerRequest);
    } catch {
      try {
        worker.postMessage({
          type: "desktop-transport-response",
          requestId: request.requestId,
          accepted: false,
        } as unknown as WorkerRequest);
      } catch {
        // Worker termination is the lifecycle authority.
      }
    }
  }

  private handleMessage(
    response: WorkerResponse | DesktopTransportRequest,
  ): void {
    if (response.type === "desktop-transport-request") {
      void this.handleDesktopTransportRequest(response);
      return;
    }
    const operation = this.pending.get(response.operationId);
    if (
      operation !== undefined &&
      (response.generation !== operation.generation ||
        response.sequence <= operation.lastSequence)
    ) {
      return;
    }
    if (response.type === "progress") {
      if (operation === undefined) {
        return;
      }
      operation.lastSequence = response.sequence;
      operation.onProgress?.(response);
      return;
    }
    if (response.type === "cancelled") {
      if (operation === undefined) {
        return;
      }
      operation.lastSequence = response.sequence;
      this.rejectOperation(
        response.operationId,
        new WorkerClientCancelledError(),
      );
      this.cancelWaiters.get(response.operationId)?.();
      return;
    }
    if (response.type === "error") {
      if (operation === undefined) {
        return;
      }
      operation.lastSequence = response.sequence;
      this.rejectOperation(
        response.operationId,
        new WorkerClientError(response.code),
      );
      return;
    }
    if (operation === undefined) {
      return;
    }
    operation.lastSequence = response.sequence;
    if (response.type === "result" && response.resultId !== undefined) {
      this.lastCommittedResultId = response.resultId as ResultId;
    }
    globalThis.clearTimeout(operation.timeout);
    this.pending.delete(response.operationId);
    if (this.activeOperationId === response.operationId) {
      this.activeOperationId = undefined;
    }
    const resolved =
      response.type === "accepted"
        ? ({
            summary: response.summary,
            result: response.result,
          } as AcceptedDatasetResult)
        : response.result;
    operation.resolve(resolved);
  }

  private ensureWorker(): WorkerPort {
    if (this.worker !== undefined) {
      return this.worker;
    }
    const worker = this.workerFactory();
    worker.onmessage = (event): void => {
      this.handleMessage(event.data as WorkerResponse | DesktopTransportRequest);
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
    this.lastCommittedResultId = undefined;
    this.nextGeneration = 1;
    for (const operationId of [...this.pending.keys()]) {
      this.rejectOperation(operationId, error);
    }
    for (const resolve of this.cancelWaiters.values()) {
      resolve();
    }
    this.cancelWaiters.clear();
  }
}
