import initJieba, { cut } from "jieba-wasm/web";

import stopWordAsset from "./assets/stopwords-zh-en-v1.txt?raw";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./protocol";
import { createAnalysisWorkerHandler } from "./worker-handler";
import { AnalysisWorkerRuntime } from "./worker-runtime";
import {
  openTauriDatasetSource,
  type DatasetTransportInvoker,
} from "./desktop-dataset-source";
import type { DesktopDatasetSourceRequest } from "./protocol";

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

interface TauriWorkerInternals {
  invoke<T>(command: string, args: unknown): Promise<T>;
}

function tauriDatasetInvoker(): DatasetTransportInvoker {
  const internals = (globalThis as typeof globalThis & {
    readonly __TAURI_INTERNALS__?: TauriWorkerInternals;
  }).__TAURI_INTERNALS__;
  if (internals === undefined) {
    throw new Error("DATASET_TRANSPORT_UNAVAILABLE");
  }
  return {
    invoke<T>(
      command:
        | "open_dataset_stream"
        | "receive_dataset_chunk"
        | "complete_dataset_stream"
        | "cancel_dataset_stream"
        | "close_dataset_stream",
      args: { readonly request: unknown },
    ) {
      return internals.invoke<T>(command, args);
    },
  };
}

async function createDesktopDatasetSource(
  request: DesktopDatasetSourceRequest,
) {
  return (
    await openTauriDatasetSource(tauriDatasetInvoker(), {
      protocolVersion: "chat-history-analysis.desktop-ipc.v1",
      sessionId: request.sessionId,
      generation: request.generation,
      datasetId: request.datasetId,
    })
  ).source;
}

workerScope.onmessage = createAnalysisWorkerHandler(workerScope, runtime, {
  createDesktopDatasetSource,
});
