import type {
  DesktopDatasetSourceRequest,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";
import {
  AnalysisWorkerRuntime,
  WorkerAnalysisError,
  WorkerCancellation,
} from "./worker-runtime";
import {
  DatasetByteSourceError,
  type DatasetByteSource,
} from "./dataset-byte-source";
import {
  isDatasetId,
  isGeneration,
  isSessionId,
} from "../desktop/ipc-contract";
import type {
  CanonicalAnalysisResult,
  DatasetCorrelation,
} from "./analytics-contract";
import { isWorkerOperationCapability, type WorkerOperationCapability } from "./protocol";

export interface AnalysisWorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  close(): void;
}

export type DesktopDatasetSourceFactory = (
  request: DesktopDatasetSourceRequest,
) => Promise<DatasetByteSource>;

export type DesktopWorkerResultCommitter = (
  capability: WorkerOperationCapability,
  result: CanonicalAnalysisResult,
) => Promise<string>;

export interface AnalysisWorkerHandlerOptions {
  readonly createDesktopDatasetSource?: DesktopDatasetSourceFactory;
  readonly commitDesktopWorkerResult?: DesktopWorkerResultCommitter;
}

interface ResolvedDatasetSource {
  readonly source: DatasetByteSource | readonly File[];
  readonly correlation: DatasetCorrelation;
  readonly workerCapability?: WorkerOperationCapability;
}

export function createAnalysisWorkerHandler(
  scope: AnalysisWorkerScope,
  runtime: AnalysisWorkerRuntime,
  options: AnalysisWorkerHandlerOptions = {},
): (event: MessageEvent<WorkerRequest>) => void {
  let activeCorrelation: DatasetCorrelation | undefined;
  let activeWorkerCapability: WorkerOperationCapability | undefined;

  async function resolveDatasetSource(
    request: Extract<WorkerRequest, { readonly type: "load-dataset" }>,
  ): Promise<ResolvedDatasetSource> {
    if (request.source.kind === "browser-file-source") {
      if (!Array.isArray(request.source.files)) {
        throw new WorkerAnalysisError("FILE_SET_INVALID", "manifest");
      }
      return {
        source: request.source.files,
        correlation: {
          sessionId: null,
          datasetId: null,
          generation: request.generation as DatasetCorrelation["generation"],
        },
      };
    }
    if (
      !isSessionId(request.source.sessionId) ||
      !isGeneration(request.source.generation) ||
      request.source.generation === 0 ||
      !isDatasetId(request.source.datasetId) ||
      request.source.generation !== request.generation ||
      !isWorkerOperationCapability(request.source.workerCapability) ||
      request.source.workerCapability.sessionId !== request.source.sessionId ||
      request.source.workerCapability.generation !== request.source.generation ||
      request.source.workerCapability.datasetId !== request.source.datasetId
    ) {
      throw new WorkerAnalysisError("DATASET_TRANSPORT_INVALID", "manifest");
    }
    const factory = options.createDesktopDatasetSource;
    if (factory === undefined) {
      throw new WorkerAnalysisError("DATASET_TRANSPORT_INVALID", "manifest");
    }
    try {
      return {
        source: await factory(request.source),
        correlation: {
          sessionId: request.source.sessionId,
          datasetId: request.source.datasetId,
          generation: request.source.generation,
        },
        workerCapability: request.source.workerCapability,
      };
    } catch (error) {
      if (error instanceof DatasetByteSourceError) {
        throw new WorkerAnalysisError(error.code, "manifest");
      }
      throw new WorkerAnalysisError("DATASET_TRANSPORT_INVALID", "manifest");
    }
  }

  function reportFailure(
    request: Exclude<WorkerRequest, { readonly type: "dispose" }>,
    error: unknown,
    allowUnstarted = false,
  ): void {
    const operationId = request.operationId;
    if (error instanceof WorkerCancellation) {
      const metadata = runtime.nextResponseMetadata(
        operationId,
        request.generation,
      );
      if (metadata === undefined) {
        return;
      }
      scope.postMessage({
        type: "cancelled",
        operationId,
        ...metadata,
      });
      return;
    }
    const failure =
      error instanceof WorkerAnalysisError
        ? error
        : new WorkerAnalysisError("WORKER_RUNTIME_FAILED", "records");
    const metadata = runtime.nextResponseMetadata(
      operationId,
      request.generation,
    );
    if (
      metadata === undefined &&
      failure.code !== "STALE_OPERATION" &&
      !allowUnstarted
    ) {
      return;
    }
    scope.postMessage({
      type: "error",
      operationId,
      generation: metadata?.generation ?? request.generation,
      sequence: metadata?.sequence ?? request.sequence + 1,
      code: failure.code,
      phase: failure.phase,
      ...(failure.chunkOrdinal === undefined
        ? {}
        : { chunkOrdinal: failure.chunkOrdinal }),
      ...(failure.lineOrdinal === undefined
        ? {}
        : { lineOrdinal: failure.lineOrdinal }),
    });
  }

  return (event): void => {
    const request = event.data;
    if (request.type === "dispose") {
      runtime.dispose();
      scope.close();
      return;
    }
    if (request.type === "cancel") {
      runtime.cancel(request.operationId, request.generation, request.sequence);
      return;
    }
    if (request.type === "load-dataset") {
      activeCorrelation = undefined;
      activeWorkerCapability = undefined;
      void resolveDatasetSource(request).then(
        (resolved) =>
          runtime
            .loadDataset(
              request.operationId,
              resolved.source,
              request.tokenizerSettings,
              { generation: request.generation, sequence: request.sequence },
              resolved.correlation,
            )
            .then((accepted) => {
              activeCorrelation = resolved.correlation;
              activeWorkerCapability = resolved.workerCapability;
              const metadata = runtime.nextResponseMetadata(
                request.operationId,
                request.generation,
              );
              if (metadata === undefined) {
                return;
              }
              scope.postMessage({
                type: "accepted",
                operationId: request.operationId,
                ...metadata,
                summary: accepted.summary,
                result: accepted.result,
              });
            })
            .catch((error: unknown) => {
              reportFailure(request, error);
            }),
        (error: unknown) => {
          reportFailure(request, error, true);
        },
      );
      return;
    }
    void runtime
      .analyze(request.operationId, request.settings, {
        generation: request.generation,
        sequence: request.sequence,
      })
      .then(async (result) => {
        let resultId: string | undefined;
        const correlation = activeCorrelation;
        if (
          correlation !== undefined &&
          correlation.sessionId !== null &&
          correlation.datasetId !== null &&
          "activity" in result
        ) {
          const commit = options.commitDesktopWorkerResult;
          const capability = request.workerCapability ?? activeWorkerCapability;
          if (
            capability === undefined ||
            commit === undefined ||
            capability.sessionId !== correlation.sessionId ||
            capability.generation !== correlation.generation ||
            capability.datasetId !== correlation.datasetId
          ) {
            throw new WorkerAnalysisError("WORKER_COMMIT_REJECTED", "aggregation");
          }
          try {
            resultId = await commit(
              capability,
              result as CanonicalAnalysisResult,
            );
            activeWorkerCapability = capability;
          } catch {
            throw new WorkerAnalysisError("WORKER_COMMIT_REJECTED", "aggregation");
          }
        }
        const metadata = runtime.nextResponseMetadata(
          request.operationId,
          request.generation,
        );
        if (metadata === undefined) {
          return;
        }
        scope.postMessage({
          type: "result",
          operationId: request.operationId,
          ...metadata,
          result,
          ...(resultId === undefined ? {} : { resultId }),
        });
      })
      .catch((error: unknown) => {
        reportFailure(request, error);
      });
  };
}
