import { describe, expect, it, vi } from "vitest";

import {
  AnalysisWorkerClient,
  WorkerClientCancelledError,
  WorkerClientError,
  type WorkerPort,
} from "../src/worker-analysis/worker-client";
import type {
  AnalysisResult,
  WorkerRequest,
  WorkerResponse,
} from "../src/worker-analysis/protocol";
import type {
  DatasetId,
  Generation,
  SessionId,
} from "../src/desktop/ipc-contract";

const result: AnalysisResult = {
  words: [{ token: "synthetic", frequency: 2 }],
  analyzedMessageCount: 1,
  uniqueTokenCount: 1,
  totalTokenCount: 2,
  sender: "all",
  startDate: "2025-01-01",
  endDate: "2025-01-01",
  maximumWords: 100,
  minimumFrequency: 1,
  cacheGeneration: 1,
};

class FakeWorker implements WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: WorkerRequest[] = [];
  readonly terminate = vi.fn();
  onPost?: (message: WorkerRequest) => void;

  postMessage(message: WorkerRequest): void {
    this.messages.push(message);
    this.onPost?.(message);
  }

  respond(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
}

describe("analysis Worker client lifecycle", () => {
  it("reports Worker creation failure without a main-thread fallback", async () => {
    const factory = vi.fn(() => {
      throw new Error("sensitive detail");
    });
    const client = new AnalysisWorkerClient(factory);

    await expect(client.loadDataset([])).rejects.toEqual(
      new WorkerClientError("WORKER_CREATION_FAILED"),
    );
  });

  it("suppresses a stale operation during rapid replacement", async () => {
    const worker = new FakeWorker();
    const client = new AnalysisWorkerClient(() => worker);
    const first = client.loadDataset([]);
    const firstId = (
      worker.messages[0] as Extract<
        WorkerRequest,
        { type: "load-dataset" }
      >
    ).operationId;
    const second = client.loadDataset([]);
    const secondRequest = [...worker.messages]
      .reverse()
      .find(
        (message: WorkerRequest) => message.type === "load-dataset",
      ) as Extract<WorkerRequest, { type: "load-dataset" }>;

    await expect(first).rejects.toBeInstanceOf(
      WorkerClientCancelledError,
    );
    expect(worker.messages).toContainEqual({
      type: "cancel",
      operationId: firstId,
      generation: firstId,
      sequence: 2,
    });

    worker.respond({
      type: "accepted",
      operationId: firstId,
      generation: firstId,
      sequence: 2,
      summary: {
        normalizedRecordCount: 1,
        minimumCalendarDate: "2025-01-01",
        maximumCalendarDate: "2025-01-01",
        warningCount: 0,
        warningsByReason: {},
        chunkCount: 1,
        pseudonymous: true,
      },
      result,
    });
    worker.respond({
      type: "accepted",
      operationId: secondRequest.operationId,
      generation: secondRequest.generation,
      sequence: 2,
      summary: {
        normalizedRecordCount: 1,
        minimumCalendarDate: "2025-01-01",
        maximumCalendarDate: "2025-01-01",
        warningCount: 0,
        warningsByReason: {},
        chunkCount: 1,
        pseudonymous: true,
      },
      result,
    });
    await expect(second).resolves.toMatchObject({ result });
  });

  it("sends only the opaque desktop source capability through the client", async () => {
    const worker = new FakeWorker();
    const client = new AnalysisWorkerClient(() => worker);
    const pending = client.loadDesktopDataset({
      sessionId: "ses_00000000000000000000000000000001" as SessionId,
      generation: 41 as Generation,
      datasetId: "dat_00000000000000000000000000000001" as DatasetId,
    });
    const request = worker.messages[0] as Extract<
      WorkerRequest,
      { type: "load-dataset" }
    >;
    expect(request.source).toEqual({
      kind: "desktop-dataset-source",
      sessionId: "ses_00000000000000000000000000000001",
      generation: 41,
      datasetId: "dat_00000000000000000000000000000001",
    });
    expect(request.generation).toBe(41);
    expect(JSON.stringify(request)).not.toMatch(/path|cwd|argv|env/u);
    worker.respond({
      type: "accepted",
      operationId: request.operationId,
      generation: request.generation,
      sequence: 2,
      summary: {
        normalizedRecordCount: 1,
        minimumCalendarDate: "2025-01-01",
        maximumCalendarDate: "2025-01-01",
        warningCount: 0,
        warningsByReason: {},
        chunkCount: 1,
        pseudonymous: true,
      },
      result,
    });
    await expect(pending).resolves.toMatchObject({ result });
  });

  it("cooperatively cancels and then terminates the Worker on Stop", async () => {
    const worker = new FakeWorker();
    worker.onPost = (message) => {
      if (message.type === "cancel") {
        queueMicrotask(() => {
          worker.respond({
            type: "cancelled",
            operationId: message.operationId,
            generation: message.generation,
            sequence: message.sequence + 1,
          });
        });
      }
    };
    const client = new AnalysisWorkerClient(() => worker);
    const pending = client.loadDataset([]);

    await client.stop();
    await expect(pending).rejects.toBeInstanceOf(
      WorkerClientCancelledError,
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("maps a Worker crash to one content-free category", async () => {
    const worker = new FakeWorker();
    const client = new AnalysisWorkerClient(() => worker);
    const pending = client.loadDataset([]);
    const preventDefault = vi.fn();
    worker.onerror?.({ preventDefault } as unknown as ErrorEvent);

    await expect(pending).rejects.toEqual(
      new WorkerClientError("WORKER_RUNTIME_FAILED"),
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
