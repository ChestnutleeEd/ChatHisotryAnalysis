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

export interface AnalysisWorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  close(): void;
}

export type DesktopDatasetSourceFactory = (
  request: DesktopDatasetSourceRequest,
) => Promise<DatasetByteSource>;

export interface AnalysisWorkerHandlerOptions {
  readonly createDesktopDatasetSource?: DesktopDatasetSourceFactory;
}

export function createAnalysisWorkerHandler(
  scope: AnalysisWorkerScope,
  runtime: AnalysisWorkerRuntime,
  options: AnalysisWorkerHandlerOptions = {},
): (event: MessageEvent<WorkerRequest>) => void {
  async function resolveDatasetSource(
    request: Extract<WorkerRequest, { readonly type: "load-dataset" }>,
  ): Promise<DatasetByteSource | readonly File[]> {
    if (request.source.kind === "browser-file-source") {
      if (!Array.isArray(request.source.files)) {
        throw new WorkerAnalysisError("FILE_SET_INVALID", "manifest");
      }
      return request.source.files;
    }
    if (
      !isSessionId(request.source.sessionId) ||
      !isGeneration(request.source.generation) ||
      request.source.generation === 0 ||
      !isDatasetId(request.source.datasetId) ||
      request.source.generation !== request.generation
    ) {
      throw new WorkerAnalysisError("DATASET_TRANSPORT_INVALID", "manifest");
    }
    const factory = options.createDesktopDatasetSource;
    if (factory === undefined) {
      throw new WorkerAnalysisError("DATASET_TRANSPORT_INVALID", "manifest");
    }
    try {
      return await factory(request.source);
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
      void resolveDatasetSource(request).then(
        (source) =>
          runtime
            .loadDataset(
              request.operationId,
              source,
              request.tokenizerSettings,
              { generation: request.generation, sequence: request.sequence },
            )
            .then((accepted) => {
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
      .then((result) => {
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
        });
      })
      .catch((error: unknown) => {
        reportFailure(request, error);
      });
  };
}
