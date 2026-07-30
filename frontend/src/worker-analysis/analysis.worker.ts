import initJieba, { cut } from "jieba-wasm/web";

import type { WorkerRequest, WorkerResponse } from "./protocol";
import {
  createTokenizerProbeRuntime,
  toWorkerFailureCode,
} from "./worker-runtime";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  close(): void;
}

const workerScope = self as unknown as WorkerScope;
const runtime = createTokenizerProbeRuntime({
  async initialize(): Promise<void> {
    await initJieba();
  },
  cutWithoutHmm(text: string): readonly string[] {
    return cut(text, false);
  },
});

workerScope.onmessage = (event): void => {
  const request = event.data;

  if (request.type === "dispose") {
    workerScope.close();
    return;
  }

  if (request.type === "initialize") {
    void runtime
      .initialize()
      .then(() => {
        workerScope.postMessage({ type: "ready", id: request.id });
      })
      .catch((error: unknown) => {
        workerScope.postMessage({
          type: "error",
          id: request.id,
          code: toWorkerFailureCode(error),
        });
      });
    return;
  }

  try {
    const tokens = runtime.segmentSyntheticProbe(request.text);
    workerScope.postMessage({
      type: "probe-result",
      id: request.id,
      tokens,
    });
  } catch (error: unknown) {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      code: toWorkerFailureCode(error),
    });
  }
};
