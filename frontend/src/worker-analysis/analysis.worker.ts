import initJieba, { cut } from "jieba-wasm/web";

import stopWordAsset from "./assets/stopwords-zh-en-v1.txt?raw";
import type {
  DesktopTransportRequest,
  DesktopTransportResponse,
  WorkerRequest,
  WorkerResponse,
  WorkerOperationCapability,
} from "./protocol";
import {
  WORKER_CAPABILITY_PROTOCOL_VERSION,
} from "./protocol";
import { createAnalysisWorkerHandler } from "./worker-handler";
import { AnalysisWorkerRuntime } from "./worker-runtime";
import {
  openTauriDatasetSource,
  type DatasetTransportInvoker,
} from "./desktop-dataset-source";
import type { DesktopDatasetSourceRequest } from "./protocol";
import type { CanonicalAnalysisResult } from "./analytics-contract";
import { buildRendererAggregateInput } from "../desktop/export-contract";
import { isResultId } from "../desktop/ipc-contract";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest | DesktopTransportResponse>) => void) | null;
  postMessage(message: WorkerResponse | DesktopTransportRequest): void;
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

let nextDesktopTransportRequestId = 1;
const pendingDesktopTransport = new Map<
  number,
  { readonly resolve: (value: unknown) => void; readonly reject: () => void }
>();

function desktopTransportInvoke<T>(
  command: DesktopTransportRequest["command"],
  args: { readonly request: unknown },
): Promise<T> {
  const requestId = nextDesktopTransportRequestId;
  nextDesktopTransportRequestId += 1;
  return new Promise<T>((resolve, reject) => {
    pendingDesktopTransport.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject: () => reject(new Error("DESKTOP_TRANSPORT_UNAVAILABLE")),
    });
    workerScope.postMessage({
      type: "desktop-transport-request",
      requestId,
      command,
      args,
    });
  });
}

function tauriDatasetInvoker(): DatasetTransportInvoker {
  return {
    invoke<T>(
      command: DesktopTransportRequest["command"],
      args: { readonly request: unknown },
    ) {
      return desktopTransportInvoke<T>(command, args);
    },
  };
}

async function commitDesktopWorkerResult(
  capability: WorkerOperationCapability,
  result: CanonicalAnalysisResult,
): Promise<string> {
  const value = await desktopTransportInvoke<unknown>(
    "commit_worker_result",
    {
      request: {
        protocolVersion: WORKER_CAPABILITY_PROTOCOL_VERSION,
        type: "commit-worker-result",
        capability,
        aggregate: buildRendererAggregateInput(result),
      },
    },
  );
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "accepted,protocolVersion,resultId" ||
    (value as Record<string, unknown>).protocolVersion !==
      WORKER_CAPABILITY_PROTOCOL_VERSION ||
    (value as Record<string, unknown>).accepted !== true ||
    !isResultId((value as Record<string, unknown>).resultId)
  ) {
    throw new Error("WORKER_COMMIT_REJECTED");
  }
  return (value as { readonly resultId: string }).resultId;
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

const workerHandler = createAnalysisWorkerHandler(workerScope, runtime, {
  createDesktopDatasetSource,
  commitDesktopWorkerResult,
});

workerScope.onmessage = (event): void => {
  const message = event.data;
  if (message.type === "desktop-transport-response") {
    const pending = pendingDesktopTransport.get(message.requestId);
    if (pending === undefined) {
      return;
    }
    pendingDesktopTransport.delete(message.requestId);
    if (message.accepted) {
      pending.resolve(message.value);
    } else {
      pending.reject();
    }
    return;
  }
  workerHandler(event as MessageEvent<WorkerRequest>);
};
