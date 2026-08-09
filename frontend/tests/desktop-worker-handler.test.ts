import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DatasetTransportInvoker } from "../src/worker-analysis/desktop-dataset-source";
import { openTauriDatasetSource } from "../src/worker-analysis/desktop-dataset-source";
import { createAnalysisWorkerHandler } from "../src/worker-analysis/worker-handler";
import { AnalysisWorkerRuntime } from "../src/worker-analysis/worker-runtime";
import { canonicalQueryKey } from "../src/worker-analysis/analytics-contract";
import {
  ANALYTICS_RESULT_CONTRACT_VERSION,
  WORKER_CAPABILITY_PROTOCOL_VERSION,
  type WorkerRequest,
  type WorkerResponse,
} from "../src/worker-analysis/protocol";
import type {
  DatasetId,
  Generation,
  SessionId,
} from "../src/desktop/ipc-contract";
import {
  createSyntheticDataset,
  sha256,
  syntheticRecords,
} from "./synthetic-dataset";
import {
  canonicalMixedEvents,
  createCanonicalDataset,
} from "./canonical-analytics-fixtures";
import { createDashboardViewModel } from "../src/presentation/desktop-dashboard";
import { DesktopDashboard } from "../src/presentation/DesktopDashboard";
import {
  buildRendererAggregateInput,
  isRendererAggregateInput,
} from "../src/desktop/export-contract";
import { WORD_FREQUENCY_QUERY_SCHEMA_VERSION } from "../src/worker-analysis/word-frequency-contract";
import {
  BETA_VOCABULARY_POLICY_HASH,
  BETA_VOCABULARY_POLICY_VERSION,
} from "../src/worker-analysis/vocabulary-policy";

const PROTOCOL = "chat-history-analysis.desktop-ipc.v1" as const;
const SESSION = "ses_00000000000000000000000000000001" as SessionId;
const DATASET = "dat_00000000000000000000000000000001" as DatasetId;
const GENERATION = 1 as Generation;

function workerCapability(
  sessionId: SessionId = SESSION,
  generation: Generation = GENERATION,
  ordinal = 1,
) {
  return {
    protocolVersion: WORKER_CAPABILITY_PROTOCOL_VERSION,
    operationId: `wrk_${String(ordinal).padStart(32, "0")}`,
    nonce: `nonce_${String(ordinal).padStart(32, "0")}`,
    windowId: "main",
    sessionId,
    generation,
    datasetId: DATASET,
    queryKey: canonicalQueryKey(DATASET, generation, {
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

type HarnessRequest = Record<string, unknown>;

class HostRegistryHarness implements DatasetTransportInvoker {
  readonly calls: Array<{ command: string; request: HarnessRequest }> = [];
  private readonly manifest: ArrayBuffer;
  private readonly chunks: readonly ArrayBuffer[];
  private nextOrdinal = 1;
  private opened = false;
  private completed = false;
  private cancelled = false;

  constructor(
    manifest: ArrayBuffer,
    chunks: readonly ArrayBuffer[],
    private readonly trustedWindow = "main",
  ) {
    this.manifest = manifest;
    this.chunks = chunks;
  }

  async invoke<T>(
    command:
      | "open_dataset_stream"
      | "receive_dataset_chunk"
      | "complete_dataset_stream"
      | "cancel_dataset_stream"
      | "close_dataset_stream",
    args: { readonly request: unknown },
  ): Promise<T> {
    const request = args.request as HarnessRequest;
    this.calls.push({ command, request });
    if (command === "open_dataset_stream") {
      if (this.trustedWindow !== "main") {
        throw new Error("wrong-window");
      }
      expect(Object.keys(request).sort()).toEqual([
        "datasetId",
        "generation",
        "protocolVersion",
        "sessionId",
      ]);
      expect(request).toMatchObject({
        protocolVersion: PROTOCOL,
        sessionId: SESSION,
        generation: GENERATION,
        datasetId: DATASET,
      });
      if (this.opened) {
        throw new Error("duplicate-open");
      }
      this.opened = true;
      const manifestBytes = this.manifest.byteLength;
      const recordCount = 3;
      return {
        protocolVersion: PROTOCOL,
        sessionId: SESSION,
        generation: GENERATION,
        datasetId: DATASET,
        manifestBytes,
        recordCount,
        chunkCount: this.chunks.length,
        chunkBytes: Math.max(...this.chunks.map((chunk) => chunk.byteLength)),
      } as T;
    }
    if (command === "receive_dataset_chunk") {
      if (this.cancelled || !this.opened || this.completed) {
        throw new Error("closed");
      }
      if (request.kind === "manifest") {
        return this.manifest as T;
      }
      const ordinal = request.ordinal;
      const expectedBytes = request.expectedBytes;
      if (
        typeof ordinal !== "number" ||
        ordinal !== this.nextOrdinal ||
        typeof expectedBytes !== "number"
      ) {
        throw new Error("ordering");
      }
      const chunk = this.chunks[ordinal - 1];
      if (chunk === undefined || chunk.byteLength !== expectedBytes) {
        throw new Error("size");
      }
      this.nextOrdinal += 1;
      return chunk as T;
    }
    if (command === "complete_dataset_stream") {
      if (this.completed) {
        throw new Error("duplicate-completion");
      }
      if (this.nextOrdinal !== this.chunks.length + 1) {
        throw new Error("missing-ordinal");
      }
      this.completed = true;
      return { closed: false } as T;
    }
    if (command === "cancel_dataset_stream") {
      this.cancelled = true;
      return { closed: true } as T;
    }
    this.cancelled = true;
    return { closed: true } as T;
  }

  duplicateCompletion(): Promise<unknown> {
    return this.invoke("complete_dataset_stream", {
      request: {
        protocolVersion: PROTOCOL,
        sessionId: SESSION,
        generation: GENERATION,
        datasetId: DATASET,
      },
    });
  }
}

function createHarness() {
  const dataset = createSyntheticDataset();
  const manifestPromise = dataset.files[0].arrayBuffer();
  const chunkPromise = dataset.files[1].arrayBuffer();
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
    {
      initialize: vi.fn(async () => undefined),
      cutWithoutHmm: (value) => value.split(/\s+/u),
    },
    "的\nthe\nand\n",
    (progress) => scope.postMessage(progress),
  );
  return { chunkPromise, closed: () => closed, manifestPromise, responses, runtime, scope, dataset };
}

function createMultiChunkHostSource(): {
  readonly manifest: ArrayBuffer;
  readonly chunks: readonly ArrayBuffer[];
} {
  const records = syntheticRecords();
  const chunks = [
    records.slice(0, 2),
    records.slice(2),
  ].map((part) =>
    new TextEncoder().encode(
      part.map((record) => `${JSON.stringify(record)}\n`).join(""),
    ),
  );
  const manifest = structuredClone(createSyntheticDataset().manifest);
  manifest.chunks = chunks.map((chunk, index) => ({
    name: `chunk-${String(index + 1).padStart(4, "0")}.ndjson`,
    byteSize: chunk.byteLength,
    recordCount: index === 0 ? 2 : 1,
    sha256: sha256(chunk),
  }));
  return {
    manifest: new TextEncoder().encode(`${JSON.stringify(manifest)}\n`).buffer,
    chunks: chunks.map((chunk) => chunk.buffer),
  };
}

async function waitForTerminal(
  responses: readonly WorkerResponse[],
  operationId: number,
): Promise<WorkerResponse> {
  return vi.waitFor(() => {
    const response = responses.find(
      (candidate) =>
        candidate.operationId === operationId &&
        ["accepted", "result", "cancelled", "error"].includes(candidate.type),
    );
    expect(response).toBeDefined();
    return response as WorkerResponse;
  });
}

describe("desktop dataset source through the production Worker handler", () => {
  it("uses host metadata and the real handler/runtime path for multi-chunk delivery", async () => {
    const { responses, runtime } = createHarness();
    const hostSource = createMultiChunkHostSource();
    const host = new HostRegistryHarness(hostSource.manifest, hostSource.chunks);
    const handler = createAnalysisWorkerHandler(
      {
        onmessage: null,
        postMessage(message: WorkerResponse) {
          responses.push(message);
        },
        close() {
          // The test does not dispose the Worker before inspecting the stream.
        },
      },
      runtime,
      {
        async createDesktopDatasetSource(sourceRequest) {
          return (
            await openTauriDatasetSource(host, {
              protocolVersion: PROTOCOL,
              sessionId: sourceRequest.sessionId,
              generation: sourceRequest.generation,
              datasetId: sourceRequest.datasetId,
            })
          ).source;
        },
      },
    );
    const request: WorkerRequest = {
      type: "load-dataset",
      operationId: 1,
      generation: 1,
      sequence: 1,
      source: {
        kind: "desktop-dataset-source",
        sessionId: SESSION,
        generation: GENERATION,
        datasetId: DATASET,
        workerCapability: workerCapability(),
      },
      tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
    };

    handler({ data: request } as MessageEvent<WorkerRequest>);
    const response = await waitForTerminal(responses, 1);
    expect(response).toMatchObject({
      type: "accepted",
      operationId: 1,
      summary: { normalizedRecordCount: 3 },
    });
    expect(host.calls.map(({ command }) => command)).toEqual([
      "open_dataset_stream",
      "receive_dataset_chunk",
      "receive_dataset_chunk",
      "receive_dataset_chunk",
      "complete_dataset_stream",
      "close_dataset_stream",
    ]);
    expect(host.calls[0]?.request).not.toHaveProperty("recordCount");
    expect(host.calls[0]?.request).not.toHaveProperty("chunkCount");
  });

  it("runs Stage 6 metrics through the opaque desktop v2 Worker path", async () => {
    const dataset = createCanonicalDataset(canonicalMixedEvents(), 3);
    const responses: WorkerResponse[] = [];
    const calls: string[] = [];
    const invoker: DatasetTransportInvoker = {
      async invoke<T>(
        command:
          | "open_dataset_stream"
          | "receive_dataset_chunk"
          | "complete_dataset_stream"
          | "cancel_dataset_stream"
          | "close_dataset_stream",
        args: { readonly request: unknown },
      ): Promise<T> {
        calls.push(command);
        const request = (args as { readonly request: Record<string, unknown> }).request;
        if (command === "open_dataset_stream") {
          return {
            protocolVersion: PROTOCOL,
            sessionId: SESSION,
            generation: GENERATION,
            datasetId: DATASET,
            manifestBytes: dataset.files[0].size,
            recordCount: canonicalMixedEvents().length,
            chunkCount: dataset.files.length - 1,
            chunkBytes: Math.max(...dataset.files.slice(1).map((file) => file.size)),
          } as T;
        }
        if (command === "receive_dataset_chunk") {
          if (request.kind === "manifest") {
            return (await dataset.files[0].arrayBuffer()) as T;
          }
          const ordinal = request.ordinal;
          if (typeof ordinal !== "number") {
            throw new Error("missing-ordinal");
          }
          return (await dataset.files[ordinal].arrayBuffer()) as T;
        }
        return { closed: true } as T;
      },
    };
    const runtime = new AnalysisWorkerRuntime(
      {
        initialize: vi.fn(async () => undefined),
        cutWithoutHmm: (value) => value.split(/\s+/u),
      },
      "的\nthe\nand\n",
      (progress) => responses.push(progress),
    );
    const handler = createAnalysisWorkerHandler(
      {
        onmessage: null,
        postMessage(message: WorkerResponse) {
          responses.push(message);
        },
        close() {},
      },
      runtime,
      {
        async createDesktopDatasetSource(sourceRequest) {
          return (
            await openTauriDatasetSource(invoker, {
              protocolVersion: PROTOCOL,
              sessionId: sourceRequest.sessionId,
              generation: sourceRequest.generation,
              datasetId: sourceRequest.datasetId,
            })
          ).source;
        },
      },
    );
    handler({
      data: {
        type: "load-dataset",
        operationId: 1,
        generation: GENERATION,
        sequence: 1,
        source: {
          kind: "desktop-dataset-source",
          sessionId: SESSION,
          generation: GENERATION,
          datasetId: DATASET,
          workerCapability: workerCapability(),
        },
        tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
      },
    } as unknown as MessageEvent<WorkerRequest>);
    const response = await waitForTerminal(responses, 1);
    expect(response).toMatchObject({
      type: "accepted",
      result: {
        activity: {
          senderComparison: { denominator: 4 },
          hourActivity: { buckets: expect.any(Array) },
          weekdayActivity: { buckets: expect.any(Array) },
        },
      },
    });
    const dashboard = createDashboardViewModel(
      (response as Extract<WorkerResponse, { readonly type: "accepted" }>).result as never,
    );
    expect(dashboard.correlation.generation).toBe(1);
    expect(dashboard.overview.selectedUserMessages).toBe(4);
    expect(dashboard.overview.totalChatDays).toBeGreaterThan(0);
    expect(dashboard.yearOptions).toEqual([2025]);
    const markup = renderToStaticMarkup(
      createElement(DesktopDashboard, {
        result: dashboard.result,
        pending: false,
        onFilterChange: () => undefined,
        onAnalyzeOtherFiles: () => undefined,
        onExport: () => undefined,
        initialRoute: "Words & Years",
      }),
    );
    expect((markup.match(/role="tab"/gu) ?? []).length).toBe(8);
    expect(markup).toContain("编辑筛选");
    expect(markup).toContain("dashboard-tab-rail");
    expect(markup).toContain("dashboard-filter-toolbar");
    expect(markup).toContain('aria-label="当前已提交分析范围"');
    expect(markup).toContain("查看逐年明细");
    expect(markup).toContain("查看关键词统计明细");
    expect(markup).not.toMatch(/<details[^>]+open(?:=|\s|>)/u);
    expect(markup).toContain("方法与隐私");
    expect(markup).toContain("所有处理均在本地完成");
    expect(calls).toContain("open_dataset_stream");
    expect(calls.filter((command) => command === "receive_dataset_chunk")).toHaveLength(3);
    expect(JSON.stringify(response)).not.toContain("alpha beta");
    expect(JSON.stringify(response)).not.toContain("beta gamma");
    expect(JSON.stringify(response)).not.toContain('"content"');

    const baseResult = (response as Extract<WorkerResponse, { readonly type: "accepted" }>).result;
    if (!("queryKey" in baseResult)) {
      throw new Error("expected canonical result");
    }
    handler({
      data: {
        type: "word-frequency",
        operationId: 2,
        generation: 2,
        sequence: 1,
        query: {
          schemaVersion: WORD_FREQUENCY_QUERY_SCHEMA_VERSION,
          baseQueryKey: baseResult.queryKey,
          role: "both",
          policy: {
            version: BETA_VOCABULARY_POLICY_VERSION,
            builtInPolicyHash: BETA_VOCABULARY_POLICY_HASH,
          },
        },
      },
    } as MessageEvent<WorkerRequest>);
    const frequencyResponse = await waitForTerminal(responses, 2);
    expect(frequencyResponse).toMatchObject({
      type: "result",
      result: {
        scope: { role: "both", year: null },
        denominator: { eligibleTokenCount: 4 },
        items: [
          { normalizedToken: "beta", count: 2, rank: 1 },
          { normalizedToken: "alpha", count: 1, rank: 2 },
          { normalizedToken: "gamma", count: 1, rank: 3 },
        ],
      },
    });
    expect(JSON.stringify(frequencyResponse)).not.toMatch(/content|source|contact|context/iu);
  });

  it("keeps 128 production Worker generations bounded at the numeric export seam", async () => {
    const dataset = createCanonicalDataset(canonicalMixedEvents(), 3);
    const manifest = await dataset.files[0].arrayBuffer();
    const chunks = await Promise.all(
      dataset.files.slice(1).map((file) => file.arrayBuffer()),
    );
    const recordCount = canonicalMixedEvents().length;

    for (let ordinal = 1; ordinal <= 128; ordinal += 1) {
      const sessionId = `ses_${String(ordinal).padStart(32, "0")}` as SessionId;
      const generation = ordinal as Generation;
      const responses: WorkerResponse[] = [];
      let closed = false;
      let opened = false;
      let nextOrdinal = 1;
      const invoker: DatasetTransportInvoker = {
        async invoke<T>(
          command:
            | "open_dataset_stream"
            | "receive_dataset_chunk"
            | "complete_dataset_stream"
            | "cancel_dataset_stream"
            | "close_dataset_stream",
          args: { readonly request: unknown },
        ): Promise<T> {
          const request = args.request as Record<string, unknown>;
          if (command === "open_dataset_stream") {
            expect(opened).toBe(false);
            opened = true;
            return {
              protocolVersion: PROTOCOL,
              sessionId,
              generation,
              datasetId: DATASET,
              manifestBytes: manifest.byteLength,
              recordCount,
              chunkCount: chunks.length,
              chunkBytes: Math.max(...chunks.map((chunk) => chunk.byteLength)),
            } as T;
          }
          if (command === "receive_dataset_chunk") {
            expect(opened).toBe(true);
            if (request.kind === "manifest") {
              return manifest as T;
            }
            expect(request.ordinal).toBe(nextOrdinal);
            const chunk = chunks[nextOrdinal - 1];
            expect(chunk).toBeDefined();
            expect(request.expectedBytes).toBe(chunk.byteLength);
            nextOrdinal += 1;
            return chunk as T;
          }
          if (command === "complete_dataset_stream") {
            expect(nextOrdinal).toBe(chunks.length + 1);
            return { closed: false } as T;
          }
          closed = true;
          return { closed: true } as T;
        },
      };
      const runtime = new AnalysisWorkerRuntime(
        {
          initialize: vi.fn(async () => undefined),
          cutWithoutHmm: (value) => value.split(/\s+/u),
        },
        "的\nthe\nand\n",
        (progress) => responses.push(progress),
      );
      const scope = {
        onmessage: null,
        postMessage(message: WorkerResponse) {
          responses.push(message);
        },
        close() {
          closed = true;
        },
      };
      const handler = createAnalysisWorkerHandler(scope, runtime, {
        async createDesktopDatasetSource(sourceRequest) {
          return (
            await openTauriDatasetSource(invoker, {
              protocolVersion: PROTOCOL,
              sessionId: sourceRequest.sessionId,
              generation: sourceRequest.generation,
              datasetId: sourceRequest.datasetId,
            })
          ).source;
        },
        async commitDesktopWorkerResult(capability, result) {
          expect(capability.sessionId).toBe(sessionId);
          expect(capability.generation).toBe(generation);
          const aggregate = buildRendererAggregateInput(result);
          expect(isRendererAggregateInput(aggregate)).toBe(true);
          expect(JSON.stringify(aggregate)).not.toMatch(
            /synthetic-secret|source\.json|contact|token|keyword|[/\\]/u,
          );
          return `res_${String(ordinal).padStart(32, "0")}`;
        },
      });
      handler({
        data: {
          type: "load-dataset",
          operationId: 1,
          generation,
          sequence: 1,
          source: {
            kind: "desktop-dataset-source",
            sessionId,
            generation,
            datasetId: DATASET,
            workerCapability: workerCapability(sessionId, generation, ordinal),
          },
          tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
        },
      } as unknown as MessageEvent<WorkerRequest>);
      const response = await waitForTerminal(responses, 1);
      expect(response.type).toBe("accepted");
      const accepted = response as Extract<WorkerResponse, { readonly type: "accepted" }>;
      const aggregate = buildRendererAggregateInput(accepted.result as never);
      expect(isRendererAggregateInput(aggregate)).toBe(true);
      expect(JSON.stringify(aggregate)).not.toMatch(
        /synthetic-secret|source\.json|contact|token|keyword|[/\\]/u,
      );
      handler({
        data: {
          type: "analyze",
          operationId: 2,
          generation: generation + 1,
          sequence: 1,
          settings: { kind: "canonical-v2", ...(accepted.result as { filters: object }).filters },
        },
      } as unknown as MessageEvent<WorkerRequest>);
      await vi.waitFor(() => {
        const result = responses.find(
          (candidate) => candidate.type === "result" && candidate.operationId === 2,
        );
        expect(result).toMatchObject({
          type: "result",
          resultId: `res_${String(ordinal).padStart(32, "0")}`,
        });
      });
      handler({ data: { type: "dispose" } } as unknown as MessageEvent<WorkerRequest>);
      expect(closed).toBe(true);
    }
  }, 30_000);

  it("rejects an invalid opaque capability before invoking the host", async () => {
    const { responses, runtime } = createHarness();
    const calls: string[] = [];
    const handler = createAnalysisWorkerHandler(
      {
        onmessage: null,
        postMessage(message: WorkerResponse) {
          responses.push(message);
        },
        close() {},
      },
      runtime,
      {
        async createDesktopDatasetSource() {
          calls.push("invoked");
          throw new Error("should-not-run");
        },
      },
    );
    handler({
      data: {
        type: "load-dataset",
        operationId: 1,
        generation: 1,
        sequence: 1,
        source: {
          kind: "desktop-dataset-source",
          sessionId: "not-opaque",
          generation: 1,
          datasetId: DATASET,
        },
        tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
      },
    } as unknown as MessageEvent<WorkerRequest>);
    await expect(waitForTerminal(responses, 1)).resolves.toMatchObject({
      type: "error",
      code: "DATASET_TRANSPORT_INVALID",
    });
    expect(calls).toEqual([]);
  });

  it("requires the host-issued Worker capability before opening desktop data", async () => {
    const { responses, runtime } = createHarness();
    const calls: string[] = [];
    const handler = createAnalysisWorkerHandler(
      {
        onmessage: null,
        postMessage(message: WorkerResponse) {
          responses.push(message);
        },
        close() {},
      },
      runtime,
      {
        async createDesktopDatasetSource() {
          calls.push("invoked");
          throw new Error("should-not-run");
        },
      },
    );
    handler({
      data: {
        type: "load-dataset",
        operationId: 1,
        generation: GENERATION,
        sequence: 1,
        source: {
          kind: "desktop-dataset-source",
          sessionId: SESSION,
          generation: GENERATION,
          datasetId: DATASET,
        },
        tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
      },
    } as unknown as MessageEvent<WorkerRequest>);
    await expect(waitForTerminal(responses, 1)).resolves.toMatchObject({
      type: "error",
      code: "DATASET_TRANSPORT_INVALID",
    });
    expect(calls).toEqual([]);
  });

  it("rejects stale generation and oversize host metadata", async () => {
    const { responses, runtime } = createHarness();
    const handler = createAnalysisWorkerHandler(
      {
        onmessage: null,
        postMessage(message: WorkerResponse) {
          responses.push(message);
        },
        close() {},
      },
      runtime,
      {
        async createDesktopDatasetSource(sourceRequest) {
          return (
            await openTauriDatasetSource(
              {
                async invoke<T>() {
                  return {
                    protocolVersion: PROTOCOL,
                    sessionId: SESSION,
                    generation: 2,
                    datasetId: DATASET,
                    manifestBytes: 1,
                    recordCount: 3,
                    chunkCount: 1,
                    chunkBytes: 1,
                  } as T;
                },
              },
              {
                protocolVersion: PROTOCOL,
                sessionId: sourceRequest.sessionId,
                generation: sourceRequest.generation,
                datasetId: sourceRequest.datasetId,
              },
            )
          ).source;
        },
      },
    );
    handler({
      data: {
        type: "load-dataset",
        operationId: 1,
        generation: 1,
        sequence: 1,
        source: {
          kind: "desktop-dataset-source",
          sessionId: SESSION,
          generation: 2,
          datasetId: DATASET,
        },
        tokenizerSettings: { minimumTokenLength: 2, additionalStopWords: [] },
      },
    } as unknown as MessageEvent<WorkerRequest>);
    await expect(waitForTerminal(responses, 1)).resolves.toMatchObject({
      type: "error",
      code: "DATASET_TRANSPORT_INVALID",
    });
  });
});
