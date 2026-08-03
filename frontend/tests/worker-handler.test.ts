import { describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_RESULT_CONTRACT_VERSION,
  WORKER_CAPABILITY_PROTOCOL_VERSION,
  type WorkerRequest,
  type WorkerResponse,
} from "../src/worker-analysis/protocol";
import { createAnalysisWorkerHandler } from "../src/worker-analysis/worker-handler";
import { AnalysisWorkerRuntime } from "../src/worker-analysis/worker-runtime";
import { canonicalQueryKey } from "../src/worker-analysis/analytics-contract";
import type { DatasetByteSource } from "../src/worker-analysis/dataset-byte-source";
import type {
  DatasetId,
  Generation,
  SessionId,
} from "../src/desktop/ipc-contract";
import {
  browserFile,
  createSyntheticDataset,
  sha256,
} from "./synthetic-dataset";

function tokenizer(cut = (value: string) => value.split(/\s+/u)) {
  return {
    initialize: vi.fn(async () => undefined),
    cutWithoutHmm: vi.fn(cut),
  };
}

function workerCapability(generation: Generation) {
  const datasetId = "dat_00000000000000000000000000000001" as DatasetId;
  return {
    protocolVersion: WORKER_CAPABILITY_PROTOCOL_VERSION,
    operationId: "wrk_00000000000000000000000000000001",
    nonce: "nonce_00000000000000000000000000000001",
    windowId: "main",
    sessionId: "ses_00000000000000000000000000000001" as SessionId,
    generation,
    datasetId,
    queryKey: canonicalQueryKey(datasetId, generation, {
      startDate: "2025-01-01",
      endDate: "2025-01-01",
      sender: "both",
      selectedYear: null,
      sessionThresholdHours: 6,
    }),
    analyticsContractVersion: ANALYTICS_RESULT_CONTRACT_VERSION,
    expiresAtMillis: Date.now() + 60_000,
  } as const;
}

async function dispatch(
  handler: (event: MessageEvent<WorkerRequest>) => void,
  responses: WorkerResponse[],
  request: WorkerRequest,
): Promise<WorkerResponse> {
  const response = vi.waitFor(() => {
    const match = responses.find(
      (item) =>
        (item.type === "accepted" ||
          item.type === "result" ||
          item.type === "cancelled" ||
          item.type === "error") &&
        item.operationId ===
          (request.type === "dispose" ? -1 : request.operationId),
    );
    expect(match).toBeDefined();
    return match as WorkerResponse;
  });
  handler({ data: request } as MessageEvent<WorkerRequest>);
  return response;
}

function setup(cut?: (value: string) => string[]) {
  const responses: WorkerResponse[] = [];
  let closed = false;
  const scope = {
    onmessage: null,
    postMessage(message: WorkerResponse) {
      responses.push(message);
    },
    close() {
      closed = true;
    },
  };
  const runtime = new AnalysisWorkerRuntime(
    tokenizer(cut),
    "的\nthe\nand\n",
    (progress) => scope.postMessage(progress),
  );
  const handler = createAnalysisWorkerHandler(scope, runtime);
  return { closed: () => closed, handler, responses, scope };
}

describe("production Worker message path", () => {
  it("returns the accepted v1 result through the real handler", async () => {
    const { handler, responses } = setup();
    const dataset = createSyntheticDataset();
    const response = await dispatch(handler, responses, {
      type: "load-dataset",
      operationId: 1,
      generation: 1,
      sequence: 1,
      source: { kind: "browser-file-source", files: dataset.files },
      tokenizerSettings: {
        minimumTokenLength: 2,
        additionalStopWords: [],
      },
    });
    expect(response).toMatchObject({
      type: "accepted",
      operationId: 1,
      summary: { normalizedRecordCount: 3 },
    });
  });

  it.each([
    {
      name: "raw export prefix over the manifest limit",
      makeFiles: () => [
        browserFile(
          [
            JSON.stringify({
              exportInfo: { format: "detailed-json" },
              session: { type: "private" },
              messages: [{ content: "synthetic" }],
            }),
            new Uint8Array(4 * 1024 * 1024 + 1),
          ],
          "manifest.json",
        ),
        browserFile(["{}\n"], "chunk-0001.ndjson"),
      ],
      code: "RAW_EXPORT_UNSUPPORTED",
    },
    {
      name: "malformed manifest",
      makeFiles: () => [
        browserFile(['{"schemaVersion":true}\n'], "manifest.json"),
        browserFile(["{}\n"], "chunk-0001.ndjson"),
      ],
      code: "MANIFEST_INVALID",
    },
    {
      name: "bad hash",
      makeFiles: () => {
        const dataset = createSyntheticDataset();
        const manifest = structuredClone(dataset.manifest);
        const chunks = manifest.chunks as Record<string, unknown>[];
        chunks[0].sha256 = "f".repeat(64);
        return [
          browserFile([`${JSON.stringify(manifest)}\n`], "manifest.json"),
          dataset.files[1],
        ];
      },
      code: "HASH_MISMATCH",
    },
    {
      name: "truncated chunk",
      makeFiles: () => {
        const dataset = createSyntheticDataset();
        return [dataset.files[0], browserFile(["truncated"], "chunk-0001.ndjson")];
      },
      code: "FILE_SET_INVALID",
    },
    {
      name: "invalid utf8",
      makeFiles: () => {
        const bytes = new Uint8Array([0xc3, 0x28, 0x0a]);
        const dataset = createSyntheticDataset();
        const manifest = structuredClone(dataset.manifest);
        const chunks = manifest.chunks as Record<string, unknown>[];
        chunks[0].byteSize = bytes.byteLength;
        chunks[0].sha256 = sha256(bytes);
        return [
          browserFile([`${JSON.stringify(manifest)}\n`], "manifest.json"),
          browserFile([bytes], "chunk-0001.ndjson"),
        ];
      },
      code: "UTF8_INVALID",
    },
  ])("keeps $name classification through the handler", async ({ makeFiles, code }) => {
    const { handler, responses } = setup();
    const response = await dispatch(handler, responses, {
      type: "load-dataset",
      operationId: 1,
      generation: 1,
      sequence: 1,
      source: { kind: "browser-file-source", files: makeFiles() },
      tokenizerSettings: {
        minimumTokenLength: 2,
        additionalStopWords: [],
      },
    });
    expect(response).toMatchObject({ type: "error", operationId: 1, code });
  });

  it("maps memory pressure and unknown runtime failures without detail leakage", async () => {
    const memory = setup(() => {
      throw new RangeError("synthetic allocation detail");
    });
    const memoryResponse = await dispatch(memory.handler, memory.responses, {
      type: "load-dataset",
      operationId: 1,
      generation: 1,
      sequence: 1,
      source: {
        kind: "browser-file-source",
        files: createSyntheticDataset().files,
      },
      tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
    });
    expect(memoryResponse).toMatchObject({
      type: "error",
      code: "MEMORY_PRESSURE",
    });
    expect(JSON.stringify(memoryResponse)).not.toContain("synthetic allocation detail");

    const runtime = setup(() => {
      throw new Error("sensitive runtime detail");
    });
    const runtimeResponse = await dispatch(runtime.handler, runtime.responses, {
      type: "load-dataset",
      operationId: 2,
      generation: 2,
      sequence: 1,
      source: {
        kind: "browser-file-source",
        files: createSyntheticDataset().files,
      },
      tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
    });
    expect(runtimeResponse).toMatchObject({
      type: "error",
      operationId: 2,
      code: "WORKER_RUNTIME_FAILED",
    });
    expect(JSON.stringify(runtimeResponse)).not.toContain("sensitive runtime detail");
  });

  it("closes the runtime through the production dispose message", async () => {
    const { handler, closed } = setup();
    handler({ data: { type: "dispose" } } as MessageEvent<WorkerRequest>);
    expect(closed()).toBe(true);
  });

  it("rejects a reused generation and carries monotonic response metadata", async () => {
    const { handler, responses } = setup();
    await dispatch(handler, responses, {
      type: "load-dataset",
      operationId: 1,
      generation: 1,
      sequence: 1,
      source: {
        kind: "browser-file-source",
        files: createSyntheticDataset().files,
      },
      tokenizerSettings: {
        minimumTokenLength: 2,
        additionalStopWords: [],
      },
    });
    const accepted = responses.find((response) => response.type === "accepted");
    expect(accepted).toMatchObject({
      generation: 1,
      sequence: expect.any(Number),
    });
    handler({
      data: {
        type: "analyze",
        operationId: 1,
        generation: 1,
        sequence: 1,
        settings: {
          sender: "all",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
          maximumWords: 100,
          minimumFrequency: 1,
        },
      },
    } as MessageEvent<WorkerRequest>);
    await vi.waitFor(() => {
      expect(
        responses.some(
          (response) =>
            response.type === "error" && response.code === "STALE_OPERATION",
        ),
      ).toBe(true);
    });
    const stale = responses.find(
      (response) => response.type === "error" && response.code === "STALE_OPERATION",
    );
    expect(stale).toMatchObject({ generation: 1, sequence: 2 });
  });

  it("suppresses replaced production work and acknowledges the latest cancel", async () => {
    const responses: WorkerResponse[] = [];
    let closed = false;
    let releaseInitialization: (() => void) | undefined;
    let releaseManifest: (() => void) | undefined;
    const scope = {
      onmessage: null,
      postMessage(message: WorkerResponse) {
        responses.push(message);
      },
      close() {
        closed = true;
      },
    };
    const runtime = new AnalysisWorkerRuntime(
      {
        initialize: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseInitialization = resolve;
            }),
        ),
        cutWithoutHmm: (value) => value.split(/\s+/u),
      },
      "的\nthe\nand\n",
      (progress) => scope.postMessage(progress),
    );
    const slowDataset = createSyntheticDataset();
    const slowSource: DatasetByteSource = {
      async readManifest(checkpoint) {
        await new Promise<void>((resolve) => {
          releaseManifest = resolve;
        });
        await checkpoint?.();
        return slowDataset.files[0].arrayBuffer();
      },
      async readChunk(ordinal, expectedBytes, checkpoint) {
        await checkpoint?.();
        if (ordinal !== 1 || expectedBytes !== slowDataset.files[1].size) {
          throw new Error("synthetic-size-mismatch");
        }
        return slowDataset.files[1].arrayBuffer();
      },
      async close() {},
      async cancel() {},
    };
    const handler = createAnalysisWorkerHandler(scope, runtime, {
      createDesktopDatasetSource: async () => slowSource,
    });
    const load = (
      operationId: number,
      generation: number,
      desktop = false,
    ): WorkerRequest => ({
      type: "load-dataset",
      operationId,
      generation,
      sequence: 1,
      source: desktop
        ? {
            kind: "desktop-dataset-source",
            sessionId: "ses_00000000000000000000000000000001" as SessionId,
            generation: generation as Generation,
            datasetId: "dat_00000000000000000000000000000001" as DatasetId,
            workerCapability: workerCapability(generation as Generation),
          }
        : {
            kind: "browser-file-source",
            files: createSyntheticDataset().files,
          },
      tokenizerSettings: {
        minimumTokenLength: 2,
        additionalStopWords: [],
      },
    });

    handler({ data: load(1, 1) } as MessageEvent<WorkerRequest>);
    await vi.waitFor(() => {
      expect(responses.some((response) => response.operationId === 1)).toBe(true);
    });
    handler({ data: load(2, 2) } as MessageEvent<WorkerRequest>);
    releaseInitialization?.();
    await vi.waitFor(() => {
      expect(
        responses.some(
          (response) =>
            response.operationId === 2 && response.type === "accepted",
        ),
      ).toBe(true);
    });
    expect(
      responses.some(
        (response) =>
          response.operationId === 1 &&
          ["accepted", "cancelled", "error"].includes(response.type),
      ),
    ).toBe(false);

    handler({ data: load(3, 3, true) } as MessageEvent<WorkerRequest>);
    await vi.waitFor(() => {
      expect(
        responses.some(
          (response) => response.operationId === 3 && response.type === "progress",
        ),
      ).toBe(true);
    });
    handler({
      data: {
        type: "cancel",
        operationId: 3,
        generation: 3,
        sequence: 3,
      },
    } as MessageEvent<WorkerRequest>);
    releaseManifest?.();
    await vi.waitFor(() => {
      expect(
        responses
          .filter((response) => response.operationId === 3)
          .map((response) => response.type),
      ).toEqual(expect.arrayContaining(["cancelled"]));
    });

    handler({ data: load(4, 3) } as MessageEvent<WorkerRequest>);
    await vi.waitFor(() => {
      expect(
        responses.some(
          (response) =>
            response.operationId === 4 &&
            response.type === "error" &&
            response.code === "STALE_OPERATION",
        ),
      ).toBe(true);
    });
    expect(closed).toBe(false);
  });
});
