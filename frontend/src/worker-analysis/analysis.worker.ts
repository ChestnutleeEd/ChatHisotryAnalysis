import initJieba, { cut } from "jieba-wasm/web";

import stopWordAsset from "./assets/stopwords-zh-en-v1.txt?raw";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./protocol";
import {
  AnalysisWorkerRuntime,
  WorkerAnalysisError,
  WorkerCancellation,
} from "./worker-runtime";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  close(): void;
}

const workerScope = self as unknown as WorkerScope;
const runtime = new AnalysisWorkerRuntime(
  {
    async initialize(): Promise<void> {
      await initJieba();
    },
    cutWithoutHmm(text: string): readonly string[] {
      return cut(text, false);
    },
  },
  stopWordAsset,
  (progress) => {
    workerScope.postMessage(progress);
  },
);

function reportFailure(operationId: number, error: unknown): void {
  if (error instanceof WorkerCancellation) {
    workerScope.postMessage({
      type: "cancelled",
      operationId,
    });
    return;
  }
  const failure =
    error instanceof WorkerAnalysisError
      ? error
      : new WorkerAnalysisError("WORKER_RUNTIME_FAILED", "records");
  workerScope.postMessage({
    type: "error",
    operationId,
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

workerScope.onmessage = (event): void => {
  const request = event.data;
  if (request.type === "dispose") {
    runtime.dispose();
    workerScope.close();
    return;
  }
  if (request.type === "cancel") {
    runtime.cancel(request.operationId);
    return;
  }
  if (request.type === "load-dataset") {
    void runtime
      .loadDataset(
        request.operationId,
        request.files,
        request.tokenizerSettings,
      )
      .then((accepted) => {
        workerScope.postMessage({
          type: "accepted",
          operationId: request.operationId,
          summary: accepted.summary,
          result: accepted.result,
        });
      })
      .catch((error: unknown) => {
        reportFailure(request.operationId, error);
      });
    return;
  }
  void runtime
    .analyze(request.operationId, request.settings)
    .then((result) => {
      workerScope.postMessage({
        type: "result",
        operationId: request.operationId,
        result,
      });
    })
    .catch((error: unknown) => {
      reportFailure(request.operationId, error);
    });
};
