import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  AnalysisWorkerClient,
  WorkerClientCancelledError,
  WorkerClientError,
  type WorkerPort,
} from "../src/worker-analysis/worker-client";
import type {
  AnalysisResult,
  WorkerOperationCapability,
  WorkerRequest,
  WorkerResponse,
} from "../src/worker-analysis/protocol";
import {
  ANALYTICS_RESULT_CONTRACT_VERSION,
  WORKER_CAPABILITY_PROTOCOL_VERSION,
} from "../src/worker-analysis/protocol";
import { canonicalQueryKey } from "../src/worker-analysis/analytics-contract";
import type {
  DatasetId,
  Generation,
  SessionId,
} from "../src/desktop/ipc-contract";
import type { CanonicalAnalysisResult } from "../src/worker-analysis/analytics-contract";
import {
  WORD_FREQUENCY_QUERY_SCHEMA_VERSION,
  WORD_FREQUENCY_SCHEMA_VERSION,
  WORD_FREQUENCY_TIMEZONE,
  frequencyDtoKey,
  type WorkerWordFrequencyDtoV1,
} from "../src/worker-analysis/word-frequency-contract";
import {
  BETA_VOCABULARY_DENOMINATOR_DEFINITION,
  BETA_VOCABULARY_POLICY_HASH,
  BETA_VOCABULARY_POLICY_VERSION,
} from "../src/worker-analysis/vocabulary-policy";

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

const workerCapability: WorkerOperationCapability = {
  protocolVersion: WORKER_CAPABILITY_PROTOCOL_VERSION,
  operationId: "wrk_00000000000000000000000000000001",
  nonce: "nonce_00000000000000000000000000000001",
  windowId: "main",
  sessionId: "ses_00000000000000000000000000000001" as SessionId,
  generation: 41 as Generation,
  datasetId: "dat_00000000000000000000000000000001" as DatasetId,
  queryKey: canonicalQueryKey(
    "dat_00000000000000000000000000000001" as DatasetId,
    41 as Generation,
    {
      startDate: "2025-01-01",
      endDate: "2025-01-01",
      sender: "both",
      selectedYear: null,
      sessionThresholdHours: 6,
    },
  ),
  analyticsContractVersion: ANALYTICS_RESULT_CONTRACT_VERSION,
  expiresAtMillis: Date.now() + 60_000,
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
  it("bridges only an allow-listed opaque desktop request through Tauri", async () => {
    const tauriInvoke = vi.mocked(invoke);
    tauriInvoke.mockReset();
    tauriInvoke.mockResolvedValueOnce({ accepted: true });
    const worker = new FakeWorker();
    const client = new AnalysisWorkerClient(() => worker);
    const pending = client.loadDataset([]);

    worker.onmessage?.({
      data: {
        type: "desktop-transport-request",
        requestId: 1,
        command: "open_dataset_stream",
        args: {
          request: {
            protocolVersion: "chat-history-analysis.desktop-ipc.v1",
            sessionId: "ses_00000000000000000000000000000001",
            generation: 41,
            datasetId: "dat_00000000000000000000000000000001",
          },
        },
      },
    } as unknown as MessageEvent<WorkerResponse>);

    await vi.waitFor(() => {
      expect(worker.messages.at(-1)).toMatchObject({
        type: "desktop-transport-response",
        requestId: 1,
        accepted: true,
        value: { accepted: true },
      });
    });
    expect(tauriInvoke).toHaveBeenCalledWith(
      "open_dataset_stream",
      expect.objectContaining({ request: expect.any(Object) }),
    );
    client.dispose();
    await expect(pending).rejects.toBeInstanceOf(WorkerClientError);
  });

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
      workerCapability,
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
      workerCapability,
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

  it("advances filter-operation generation after a host-owned generation", async () => {
    const worker = new FakeWorker();
    const client = new AnalysisWorkerClient(() => worker);
    const loaded = client.loadDesktopDataset({
      sessionId: "ses_00000000000000000000000000000001" as SessionId,
      generation: 41 as Generation,
      datasetId: "dat_00000000000000000000000000000001" as DatasetId,
      workerCapability,
    });
    const loadRequest = worker.messages[0] as Extract<
      WorkerRequest,
      { type: "load-dataset" }
    >;
    worker.respond({
      type: "accepted",
      operationId: loadRequest.operationId,
      generation: loadRequest.generation,
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
    await loaded;

    const analyzed = client.analyzeCanonical({
      kind: "canonical-v2",
      startDate: "2025-01-01",
      endDate: "2025-01-01",
      sender: "both",
      selectedYear: null,
      sessionThresholdHours: 6,
    }, undefined, workerCapability);
    const analyzeRequest = worker.messages.at(-1) as Extract<
      WorkerRequest,
      { type: "analyze" }
    >;
    expect(analyzeRequest.generation).toBe(42);
    expect(analyzeRequest.workerCapability).toEqual(workerCapability);
    worker.respond({
      type: "result",
      operationId: analyzeRequest.operationId,
      generation: analyzeRequest.generation,
      sequence: 2,
      result: result as unknown as CanonicalAnalysisResult,
    });
    await expect(analyzed).resolves.toEqual(result);
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

  it("waits for a cancellation acknowledgement without terminating a same-dataset Worker", async () => {
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

    await expect(client.cancelActiveAndWait()).resolves.toBe(true);
    await expect(pending).rejects.toBeInstanceOf(WorkerClientCancelledError);
    expect(worker.terminate).not.toHaveBeenCalled();

    const replacement = client.loadDataset([]);
    expect(worker.messages.at(-1)).toMatchObject({ type: "load-dataset" });
    const request = worker.messages.at(-1) as Extract<WorkerRequest, { type: "load-dataset" }>;
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
    await expect(replacement).resolves.toMatchObject({ result });
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

  it("suppresses stale frequency results and keeps the committed aggregate identity", async () => {
    const worker = new FakeWorker();
    const client = new AnalysisWorkerClient(() => worker);
    const analyzed = client.analyzeCanonical({
      kind: "canonical-v2",
      startDate: "2025-01-01",
      endDate: "2025-01-01",
      sender: "both",
      selectedYear: null,
      sessionThresholdHours: 6,
    });
    const analyzeRequest = worker.messages.at(-1) as Extract<WorkerRequest, { type: "analyze" }>;
    worker.respond({
      type: "result",
      operationId: analyzeRequest.operationId,
      generation: analyzeRequest.generation,
      sequence: 2,
      result: result as unknown as CanonicalAnalysisResult,
      resultId: "res_00000000000000000000000000000001",
    });
    await analyzed;
    expect(client.committedResultId).toBe("res_00000000000000000000000000000001");

    const frequencyQuery = {
      schemaVersion: WORD_FREQUENCY_QUERY_SCHEMA_VERSION,
      baseQueryKey: workerCapability.queryKey,
      role: "owner" as const,
      policy: {
        version: BETA_VOCABULARY_POLICY_VERSION,
        builtInPolicyHash: BETA_VOCABULARY_POLICY_HASH,
      },
    };
    const pending = client.analyzeWordFrequency(frequencyQuery);
    const frequencyRequest = worker.messages.at(-1) as Extract<WorkerRequest, { type: "word-frequency" }>;
    expect(client.committedResultId).toBe("res_00000000000000000000000000000001");
    expect(frequencyRequest.query).toEqual(frequencyQuery);

    const frequencyResult: WorkerWordFrequencyDtoV1 = {
      schemaVersion: WORD_FREQUENCY_SCHEMA_VERSION,
      identity: {
        datasetId: workerCapability.datasetId,
        generation: workerCapability.generation,
        baseQueryKey: workerCapability.queryKey,
        frequencyDtoKey: frequencyDtoKey(
          workerCapability.datasetId,
          workerCapability.generation,
          workerCapability.queryKey,
          "owner",
        ),
      },
      scope: { timezone: WORD_FREQUENCY_TIMEZONE, year: null, role: "owner" },
      denominator: {
        eligibleTokenCount: 1,
        definition: BETA_VOCABULARY_DENOMINATOR_DEFINITION,
        status: "ready",
        emptyReason: null,
      },
      policy: {
        version: BETA_VOCABULARY_POLICY_VERSION,
        builtInPolicyHash: BETA_VOCABULARY_POLICY_HASH,
      },
      items: [{
        normalizedToken: "synthetic",
        count: 1,
        ratePer10000: 10_000,
        rank: 1,
        category: "latin",
        qualityFlags: [],
      }],
    };
    worker.respond({
      type: "result",
      operationId: frequencyRequest.operationId,
      generation: frequencyRequest.generation - 1,
      sequence: 3,
      result: frequencyResult,
    });
    let settled = false;
    void pending.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    worker.respond({
      type: "result",
      operationId: frequencyRequest.operationId,
      generation: frequencyRequest.generation,
      sequence: 2,
      result: frequencyResult,
    });
    await expect(pending).resolves.toBe(frequencyResult);
    expect(client.committedResultId).toBe("res_00000000000000000000000000000001");
  });
});
