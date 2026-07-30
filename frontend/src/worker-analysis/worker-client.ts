import {
  SYNTHETIC_SEGMENTATION_PROBE,
  type WorkerFailureCode,
  type WorkerProbeResult,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";
import { WorkerProbeError } from "./worker-runtime";

export interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerPort;

function defaultWorkerFactory(): WorkerPort {
  return new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    name: "chat-analysis-probe",
    type: "module",
  });
}

export class AnalysisWorkerClient {
  private readonly workerFactory: WorkerFactory;
  private activeWorker: WorkerPort | undefined;
  private nextId = 1;

  constructor(workerFactory: WorkerFactory = defaultWorkerFactory) {
    this.workerFactory = workerFactory;
  }

  async runSyntheticProbe(timeoutMilliseconds = 20_000): Promise<WorkerProbeResult> {
    let worker: WorkerPort;
    try {
      worker = this.workerFactory();
    } catch {
      throw new WorkerProbeError("WORKER_CREATION_FAILED");
    }

    this.activeWorker = worker;
    const initializeId = this.nextId++;
    const probeId = this.nextId++;

    return new Promise<WorkerProbeResult>((resolve, reject) => {
      let settled = false;
      const finish = (
        outcome:
          | { readonly ok: true; readonly result: WorkerProbeResult }
          | { readonly ok: false; readonly code: WorkerFailureCode },
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeout);
        worker.terminate();
        if (this.activeWorker === worker) {
          this.activeWorker = undefined;
        }
        if (outcome.ok) {
          resolve(outcome.result);
        } else {
          reject(new WorkerProbeError(outcome.code));
        }
      };

      const timeout = globalThis.setTimeout(() => {
        finish({ ok: false, code: "WORKER_TIMEOUT" });
      }, timeoutMilliseconds);

      worker.onerror = (): void => {
        finish({ ok: false, code: "WORKER_RUNTIME_FAILED" });
      };

      worker.onmessage = (event): void => {
        const response = event.data;
        if (response.type === "error") {
          finish({ ok: false, code: response.code });
          return;
        }

        if (response.type === "ready" && response.id === initializeId) {
          worker.postMessage({
            type: "segment-probe",
            id: probeId,
            text: SYNTHETIC_SEGMENTATION_PROBE,
          });
          return;
        }

        if (response.type === "probe-result" && response.id === probeId) {
          finish({ ok: true, result: { tokens: response.tokens } });
        }
      };

      worker.postMessage({ type: "initialize", id: initializeId });
    });
  }

  dispose(): void {
    this.activeWorker?.terminate();
    this.activeWorker = undefined;
  }
}
