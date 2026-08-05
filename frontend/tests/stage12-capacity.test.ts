import { createHash } from "node:crypto";
import { totalmem } from "node:os";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  CANONICAL_MANIFEST_SCHEMA_VERSION,
  CANONICAL_MESSAGE_CATEGORIES,
  CANONICAL_PREPROCESSOR_VERSION,
  CANONICAL_TIME_POLICY,
  MAX_CANONICAL_CHUNK_BYTES,
  MAX_CANONICAL_CHUNK_COUNT,
  MAX_CANONICAL_DATASET_BYTES,
  MAX_CANONICAL_EVENTS,
  METRIC_DEFINITION_VERSIONS,
  type CanonicalEventV2,
} from "../src/canonical-v2/schema";
import { openTauriDatasetSource, type DatasetTransportInvoker } from "../src/worker-analysis/desktop-dataset-source";
import type { CanonicalAnalysisResult } from "../src/worker-analysis/analytics-contract";
import { AnalysisWorkerRuntime } from "../src/worker-analysis/worker-runtime";
import { canonicalFormattedTime } from "./canonical-analytics-fixtures";

const SESSION = "ses_00000000000000000000000000000001";
const DATASET = "dat_00000000000000000000000000000001";
const GENERATION = 1;
const START_TIME = Math.floor(Date.UTC(2023, 0, 1) / 1000) - 8 * 60 * 60;
const CAPACITY_ENABLED = process.env.STAGE12_RUN_CAPACITY === "1";

interface CapacityDataset {
  readonly manifestBytes: Uint8Array;
  readonly chunks: readonly CapacityChunk[];
  readonly contentLength: number;
  readonly eventCount: number;
  readonly chunkCount: number;
  readonly totalChunkBytes: number;
  readonly minimumCalendarDate: string;
  readonly maximumCalendarDate: string;
}

interface CapacityChunk {
  readonly startSourceIndex: number;
  readonly endSourceIndex: number;
  readonly recordCount: number;
  readonly byteSize: number;
  readonly sha256: string;
}

function syntheticContent(length: number): string {
  return "synthetic alpha beta gamma delta epsilon ".repeat(8).slice(0, length);
}

function capacityEvent(sourceIndex: number, contentLength: number): CanonicalEventV2 {
  const createTime = START_TIME + sourceIndex * 6 * 60 * 60;
  const formattedTime = canonicalFormattedTime(createTime);
  const base: CanonicalEventV2 = {
    createTime,
    formattedTime,
    calendarDate: formattedTime.slice(0, 10),
    senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
    messageCategory: "text",
    textEligible: true,
    content: syntheticContent(contentLength),
    fileRank: 0,
    sourceIndex,
  };
  if (sourceIndex % 17 === 0) {
    return { ...base, senderScope: null, messageCategory: "system", textEligible: false, content: null };
  }
  if (sourceIndex % 7 === 0) {
    return { ...base, messageCategory: "image", textEligible: false, content: null };
  }
  if (sourceIndex % 11 === 0) {
    return { ...base, messageCategory: "unknown", textEligible: false, content: null };
  }
  return base;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildCapacityDataset(eventCount: number, contentLength: number): CapacityDataset {
  const encoder = new TextEncoder();
  const chunks: CapacityChunk[] = [];
  let buffer = new Uint8Array(MAX_CANONICAL_CHUNK_BYTES);
  let offset = 0;
  let chunkStartSourceIndex = 0;
  let recordCount = 0;
  let minimumCalendarDate = "";
  let maximumCalendarDate = "";
  const categoryCounts = Object.fromEntries(
    CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<(typeof CANONICAL_MESSAGE_CATEGORIES)[number], number>;
  let systemEventCount = 0;
  let eligibleTextCount = 0;

  const flush = (endSourceIndex: number): void => {
    if (recordCount === 0) {
      return;
    }
    const bytes = buffer.slice(0, offset);
    chunks.push({
      startSourceIndex: chunkStartSourceIndex,
      endSourceIndex,
      recordCount,
      byteSize: bytes.byteLength,
      sha256: sha256(bytes),
    });
    buffer = new Uint8Array(MAX_CANONICAL_CHUNK_BYTES);
    offset = 0;
    chunkStartSourceIndex = endSourceIndex;
    recordCount = 0;
  };

  for (let sourceIndex = 0; sourceIndex < eventCount; sourceIndex += 1) {
    const event = capacityEvent(sourceIndex, contentLength);
    const line = encoder.encode(`${JSON.stringify(event)}\n`);
    if (line.byteLength > MAX_CANONICAL_CHUNK_BYTES) {
      throw new Error("SYNTHETIC_LINE_EXCEEDS_CHUNK_LIMIT");
    }
    if (offset > 0 && offset + line.byteLength > MAX_CANONICAL_CHUNK_BYTES) {
      flush(sourceIndex);
    }
    buffer.set(line, offset);
    offset += line.byteLength;
    recordCount += 1;
    categoryCounts[event.messageCategory] += 1;
    systemEventCount += event.messageCategory === "system" ? 1 : 0;
    eligibleTextCount += event.textEligible ? 1 : 0;
    minimumCalendarDate ||= event.calendarDate;
    maximumCalendarDate = event.calendarDate;
  }
  flush(eventCount);

  const totalChunkBytes = chunks.reduce((total, chunk) => total + chunk.byteSize, 0);
  if (totalChunkBytes > MAX_CANONICAL_DATASET_BYTES || chunks.length > MAX_CANONICAL_CHUNK_COUNT) {
    throw new Error("SYNTHETIC_DATASET_LIMIT_EXCEEDED");
  }
  const manifest = {
    schemaVersion: CANONICAL_MANIFEST_SCHEMA_VERSION,
    canonicalSchemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
    preprocessorVersion: CANONICAL_PREPROCESSOR_VERSION,
    timePolicy: CANONICAL_TIME_POLICY,
    metricDefinitionVersions: METRIC_DEFINITION_VERSIONS,
    publicationCounts: {
      sourceCount: 1,
      rawAcceptedEventCount: eventCount,
      canonicalEventCount: eventCount,
      duplicateEventCount: 0,
    },
    chunks: chunks.map((chunk, ordinal) => ({
      ordinal,
      name: `chunk-${String(ordinal).padStart(4, "0")}.ndjson`,
      byteSize: chunk.byteSize,
      recordCount: chunk.recordCount,
      sha256: chunk.sha256,
    })),
    aggregates: {
      eventCount,
      userMessageCount: eventCount - systemEventCount,
      eligibleTextCount,
      systemEventCount,
      chunkCount: chunks.length,
      totalBytes: totalChunkBytes,
      warningCount: 0,
      messageCategoryCounts: categoryCounts,
      unknownSenderCount: 0,
    },
    limits: {
      maxEvents: MAX_CANONICAL_EVENTS,
      maxDatasetBytes: MAX_CANONICAL_DATASET_BYTES,
      maxChunkBytes: MAX_CANONICAL_CHUNK_BYTES,
      maxChunkCount: MAX_CANONICAL_CHUNK_COUNT,
    },
    privacyValidation: {
      status: "passed" as const,
      forbiddenFieldCount: 0,
      contentPolicy: "eligible-text-only" as const,
    },
  };
  const manifestBytes = encoder.encode(`${JSON.stringify(manifest)}\n`);
  return {
    manifestBytes,
    chunks,
    contentLength,
    eventCount,
    chunkCount: chunks.length,
    totalChunkBytes,
    minimumCalendarDate,
    maximumCalendarDate,
  };
}

function encodeCapacityChunk(
  dataset: CapacityDataset,
  ordinal: number,
): Uint8Array {
  const chunk = dataset.chunks[ordinal];
  if (chunk === undefined) {
    throw new Error("SYNTHETIC_CHUNK_NOT_FOUND");
  }
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(chunk.byteSize);
  let offset = 0;
  for (let sourceIndex = chunk.startSourceIndex; sourceIndex < chunk.endSourceIndex; sourceIndex += 1) {
    const line = encoder.encode(`${JSON.stringify(capacityEvent(sourceIndex, dataset.contentLength))}\n`);
    bytes.set(line, offset);
    offset += line.byteLength;
  }
  if (offset !== bytes.byteLength) {
    throw new Error("SYNTHETIC_CHUNK_SIZE_MISMATCH");
  }
  return bytes;
}

function createInvoker(dataset: CapacityDataset): DatasetTransportInvoker {
  return {
    async invoke<T>(
      command:
        | "open_dataset_stream"
        | "receive_dataset_chunk"
        | "complete_dataset_stream"
        | "cancel_dataset_stream"
        | "close_dataset_stream",
      args: { readonly request: unknown },
    ): Promise<T> {
      const request = (args as { readonly request: Record<string, unknown> }).request;
      if (command === "open_dataset_stream") {
        return {
          protocolVersion: "chat-history-analysis.desktop-ipc.v1",
          sessionId: SESSION,
          generation: GENERATION,
          datasetId: DATASET,
          manifestBytes: dataset.manifestBytes.byteLength,
          recordCount: dataset.eventCount,
          chunkCount: dataset.chunkCount,
          chunkBytes: Math.max(...dataset.chunks.map((chunk) => chunk.byteSize)),
        } as T;
      }
      if (command === "receive_dataset_chunk") {
        if (request.kind === "manifest") {
          return dataset.manifestBytes.buffer.slice(
            dataset.manifestBytes.byteOffset,
            dataset.manifestBytes.byteOffset + dataset.manifestBytes.byteLength,
          ) as T;
        }
        const bytes = encodeCapacityChunk(dataset, Number(request.ordinal) - 1);
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as T;
      }
      return { closed: true } as T;
    },
  };
}

function createRuntime(onProgress: (progress: { readonly operationId: number; readonly phase: string; readonly completed: number }) => void): AnalysisWorkerRuntime {
  return new AnalysisWorkerRuntime(
    {
      initialize: async () => undefined,
      cutWithoutHmm: (value) => value.split(/\s+/u),
    },
    "the\nand\n",
    onProgress,
  );
}

describe("Stage 12 synthetic supported-scale gate", () => {
  it.skipIf(!CAPACITY_ENABLED)("runs the bounded desktop v2 capacity profile", async () => {
    const eventCount = Number(process.env.STAGE12_CAPACITY_EVENTS ?? "100000");
    const contentLength = Number(process.env.STAGE12_CAPACITY_CONTENT_LENGTH ?? "81");
    expect(Number.isSafeInteger(eventCount)).toBe(true);
    expect(eventCount).toBeGreaterThan(0);
    expect(eventCount).toBeLessThanOrEqual(MAX_CANONICAL_EVENTS);

    const runtimeRef: { current?: AnalysisWorkerRuntime } = {};
    let peakRss = process.memoryUsage().rss;
    const phases = new Set<string>();
    let cancelCapacityOperation = false;
    let maxHeartbeatGapMilliseconds = 0;
    let lastHeartbeat = performance.now();
    const heartbeatTimer = setInterval(() => {
      const now = performance.now();
      maxHeartbeatGapMilliseconds = Math.max(
        maxHeartbeatGapMilliseconds,
        now - lastHeartbeat,
      );
      lastHeartbeat = now;
    }, 10);
    const reportProgress = (progress: { readonly operationId: number; readonly phase: string; readonly completed: number }): void => {
      phases.add(progress.phase);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (
        cancelCapacityOperation &&
        progress.completed > 0
      ) {
        runtimeRef.current?.cancel(progress.operationId);
      }
    };
    const runtime = createRuntime(reportProgress);
    runtimeRef.current = runtime;

    const buildStarted = performance.now();
    const dataset = buildCapacityDataset(eventCount, contentLength);
    const buildMilliseconds = performance.now() - buildStarted;
    const source = await openTauriDatasetSource(
      createInvoker(dataset),
      {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        sessionId: SESSION as never,
        generation: GENERATION as never,
        datasetId: DATASET as never,
      },
    );
    const baselineRss = process.memoryUsage().rss;
    const loadStarted = performance.now();
    const accepted = await runtime.loadDataset(
      1,
      source.source,
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION },
      { sessionId: SESSION as never, datasetId: DATASET as never, generation: GENERATION as never },
    );
    const loadMilliseconds = performance.now() - loadStarted;
    const firstYear = Number(dataset.minimumCalendarDate.slice(0, 4));
    const settings = {
      kind: "canonical-v2" as const,
      startDate: dataset.minimumCalendarDate,
      endDate: dataset.maximumCalendarDate,
      sender: "both" as const,
      selectedYear: null,
      sessionThresholdHours: 6 as const,
    };
    const queryStarted = performance.now();
    const result = await runtime.analyze(2, settings);
    const queryMilliseconds = performance.now() - queryStarted;
    const cachedStarted = performance.now();
    const cached = await runtime.analyze(3, settings);
    const cachedQueryMilliseconds = performance.now() - cachedStarted;
    const cachedQuerySamplesMilliseconds: number[] = [];
    let nextOperationId = 3;
    const nextOperation = (): number => {
      nextOperationId += 1;
      return nextOperationId;
    };
    for (let sample = 0; sample < 20; sample += 1) {
      const sampleStarted = performance.now();
      const repeated = await runtime.analyze(nextOperation(), settings);
      cachedQuerySamplesMilliseconds.push(performance.now() - sampleStarted);
      expect(repeated).toBe(result);
    }
    const cachedQueryP95Milliseconds = [...cachedQuerySamplesMilliseconds].sort(
      (left, right) => left - right,
    )[Math.ceil(cachedQuerySamplesMilliseconds.length * 0.95) - 1] ?? 0;
    const filtered = await runtime.analyze(nextOperation(), { ...settings, sender: "owner", selectedYear: firstYear });
    const thresholdChanged = await runtime.analyze(nextOperation(), { ...settings, sessionThresholdHours: 1 });

    cancelCapacityOperation = true;
    const cancellationOperationId = nextOperation();
    const cancellationStarted = performance.now();
    await expect(runtime.analyze(cancellationOperationId, { ...settings, sender: "other" })).rejects.toMatchObject({
      name: "WorkerCancellation",
    });
    const cancellationMilliseconds = performance.now() - cancellationStarted;
    cancelCapacityOperation = false;
    const afterCancel = await runtime.analyze(nextOperation(), settings);
    runtime.dispose();

    const restartRuntime = createRuntime(() => undefined);
    const restartSource = await openTauriDatasetSource(
      createInvoker(dataset),
      {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        sessionId: SESSION as never,
        generation: GENERATION as never,
        datasetId: DATASET as never,
      },
    );
    const restartStarted = performance.now();
    const restartAccepted = await restartRuntime.loadDataset(
      8,
      restartSource.source,
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION },
      { sessionId: SESSION as never, datasetId: DATASET as never, generation: GENERATION as never },
    );
    const restartMilliseconds = performance.now() - restartStarted;
    restartRuntime.dispose();
    clearInterval(heartbeatTimer);

    expect(accepted.summary).toMatchObject({ eventCount, chunkCount: dataset.chunkCount });
    expect(result.aggregate.eventCount).toBe(eventCount);
    expect(cached).toBe(result);
    expect(filtered.aggregate.senderCounts.owner).toBeGreaterThan(0);
    expect(thresholdChanged.replySessions.conversationSessions.thresholdHours).toBe(1);
    expect(afterCancel).toBe(result);
    expect(dataset.totalChunkBytes).toBeLessThanOrEqual(MAX_CANONICAL_DATASET_BYTES);
    expect(dataset.chunkCount).toBeGreaterThan(0);
    expect(dataset.chunks.every((chunk) => chunk.byteSize <= MAX_CANONICAL_CHUNK_BYTES)).toBe(true);
    expect([...phases]).toEqual(expect.arrayContaining(["transport", "hash", "parse", "index", "tokenization", "base", "sessionization", "derived"]));
    const acceptedCanonicalResult = accepted.result as CanonicalAnalysisResult;
    const restartCanonicalResult = restartAccepted.result as CanonicalAnalysisResult;
    const retainedTypedArrayBytes = acceptedCanonicalResult.index.typedArrayBytes;
    expect(retainedTypedArrayBytes).toBeLessThan(256 * 1024 * 1024);
    expect(cancellationMilliseconds).toBeLessThan(1000);
    expect(cachedQueryP95Milliseconds).toBeLessThan(2000);
    expect(peakRss).toBeLessThan(1.5 * 1024 * 1024 * 1024);
    expect(restartCanonicalResult.index.typedArrayBytes).toBe(retainedTypedArrayBytes);

    process.stdout.write(`STAGE12_CAPACITY_EVIDENCE ${JSON.stringify({
      eventCount,
      chunkCount: dataset.chunkCount,
      totalChunkBytes: dataset.totalChunkBytes,
      totalChunkMiB: Number((dataset.totalChunkBytes / 1024 / 1024).toFixed(2)),
      years: [firstYear, Number(dataset.maximumCalendarDate.slice(0, 4))],
      buildMilliseconds: Math.round(buildMilliseconds),
      loadMilliseconds: Math.round(loadMilliseconds),
      queryMilliseconds: Math.round(queryMilliseconds),
      cachedQueryMilliseconds: Math.round(cachedQueryMilliseconds),
      cachedQueryP95Milliseconds: Math.round(cachedQueryP95Milliseconds),
      restartMilliseconds: Math.round(restartMilliseconds),
      baselineRssBytes: baselineRss,
      peakRssBytes: peakRss,
      retainedTypedArrayBytes,
      mainThreadHeartbeatGapMilliseconds: null,
      directRuntimeHarnessEventLoopGapMilliseconds: Number(maxHeartbeatGapMilliseconds.toFixed(2)),
      mainThreadHeartbeatNote: "not-measured-direct-runtime-harness; production runtime executes in a Web Worker",
      cancellationMilliseconds: Number(cancellationMilliseconds.toFixed(2)),
      applicationEngine: `node-${process.version}/vitest`,
      operatingSystem: process.platform,
      architecture: process.arch,
      hardwareMemoryBytes: totalmem(),
      tokenCount: acceptedCanonicalResult.index.tokenCount,
      cancellation: "passed",
      restart: "passed",
      deterministicCache: "passed",
      phases: [...phases].sort(),
    })}\n`);
  }, 900_000);
});
