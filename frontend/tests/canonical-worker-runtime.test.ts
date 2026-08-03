import { describe, expect, it, vi } from "vitest";

import { BrowserFileDatasetSource } from "../src/worker-analysis/dataset-byte-source";
import {
  validateCanonicalAnalyticsResult,
  type CanonicalAnalysisResult,
} from "../src/worker-analysis/analytics-contract";
import {
  AnalysisWorkerRuntime,
  WorkerCancellation,
} from "../src/worker-analysis/worker-runtime";
import type {
  DatasetId,
  Generation,
  SessionId,
} from "../src/desktop/ipc-contract";
import {
  canonicalEvent,
  canonicalFilters,
  canonicalMixedEvents,
  createCanonicalDataset,
} from "./canonical-analytics-fixtures";
import { browserFile } from "./synthetic-dataset";

const SESSION = "ses_00000000000000000000000000000001" as SessionId;
const DATASET = "dat_00000000000000000000000000000001" as DatasetId;
const GENERATION = 1 as Generation;

function createRuntime(
  onProgress: ConstructorParameters<typeof AnalysisWorkerRuntime>[2] = () =>
    undefined,
  ) {
  const tokenizer = {
    initialize: vi.fn(async () => undefined),
    cutWithoutHmm: vi.fn((value: string) => value.split(/\s+/u)),
  };
  return {
    runtime: new AnalysisWorkerRuntime(
      tokenizer,
      "the\nand\n",
      onProgress,
    ),
    tokenizer,
  };
}

function asCanonicalResult(
  value: unknown,
): CanonicalAnalysisResult {
  if (
    value === null ||
    typeof value !== "object" ||
    !Object.hasOwn(value, "schemaVersion")
  ) {
    throw new Error("expected canonical result");
  }
  return validateCanonicalAnalyticsResult(value);
}

describe("canonical v2 analytics Worker core", () => {
  it("validates and indexes mixed user/system/media/unknown events once", async () => {
    const { runtime, tokenizer } = createRuntime();
    const dataset = createCanonicalDataset(canonicalMixedEvents(), 3);
    const accepted = await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION, sequence: 1 },
      { sessionId: SESSION, datasetId: DATASET, generation: GENERATION },
    );
    if (!("eventCount" in accepted.summary)) {
      throw new Error("expected canonical summary");
    }
    const result = asCanonicalResult(accepted.result);
    expect(accepted.summary).toMatchObject({
      eventCount: 5,
      userMessageCount: 4,
      eligibleTextCount: 2,
      systemEventCount: 1,
      chunkCount: 2,
    });
    expect(result).toMatchObject({
      sessionId: SESSION,
      datasetId: DATASET,
      generation: GENERATION,
      filters: {
        sender: "both",
        startDate: "2025-01-01",
        endDate: "2025-01-04",
      },
      aggregate: {
        eventCount: 5,
        userMessageCount: 4,
        eligibleTextCount: 2,
        systemEventCount: 1,
        senderCounts: { owner: 2, other: 2 },
        tokenCount: 4,
      },
      index: {
        indexedRecordCount: 5,
        tokenCount: 4,
        distinctTokenCount: 3,
      },
    });
    expect(result.aggregate.messageCategoryCounts).toMatchObject({
      text: 2,
      image: 1,
      system: 0,
      unknown: 1,
    });
    expect(JSON.stringify(result)).not.toContain("alpha");
    expect(tokenizer.initialize).toHaveBeenCalledOnce();
    expect(tokenizer.cutWithoutHmm).toHaveBeenCalledTimes(2);
  });

  it("keeps system diagnostics while applying an owner filter", async () => {
    const { runtime } = createRuntime();
    const dataset = createCanonicalDataset(canonicalMixedEvents());
    await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION, sequence: 1 },
      { sessionId: SESSION, datasetId: DATASET, generation: GENERATION },
    );
    const result = await runtime.analyze(2, {
      kind: "canonical-v2",
      ...canonicalFilters({ sender: "owner" }),
    });
    expect(result).toMatchObject({
      aggregate: {
        eventCount: 3,
        userMessageCount: 2,
        systemEventCount: 1,
        eligibleTextCount: 1,
        senderCounts: { owner: 2, other: 2 },
      },
    });
  });

  it("accepts media-only data without initializing the tokenizer", async () => {
    const { runtime, tokenizer } = createRuntime();
    const dataset = createCanonicalDataset([
      canonicalEvent(1_735_689_600, 0, {
        messageCategory: "voice",
        textEligible: false,
        content: null,
      }),
    ]);
    const accepted = await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION, sequence: 1 },
      { sessionId: SESSION, datasetId: DATASET, generation: GENERATION },
    );
    const result = asCanonicalResult(accepted.result);
    expect(result.aggregate).toMatchObject({
      eventCount: 1,
      userMessageCount: 1,
      eligibleTextCount: 0,
      tokenCount: 0,
    });
    expect(tokenizer.initialize).not.toHaveBeenCalled();
    expect(tokenizer.cutWithoutHmm).not.toHaveBeenCalled();
  });

  it("rejects a v2 event with an unknown field and preserves no candidate cache", async () => {
    const event = {
      ...canonicalMixedEvents()[0],
      leaked: "synthetic-only field",
    };
    const dataset = createCanonicalDataset([event as never]);
    const { runtime } = createRuntime();
    await expect(
      runtime.loadDataset(
        1,
        new BrowserFileDatasetSource(dataset.files),
        { minimumTokenLength: 2, additionalStopWords: [] },
        { generation: GENERATION, sequence: 1 },
        { sessionId: SESSION, datasetId: DATASET, generation: GENERATION },
      ),
    ).rejects.toMatchObject({ code: "RECORD_SCHEMA_INVALID" });
    await expect(
      runtime.analyze(2, {
        kind: "canonical-v2",
        ...canonicalFilters({ endDate: "2025-01-01" }),
      }),
    ).rejects.toMatchObject({ code: "NO_ACCEPTED_DATASET" });
  });

  it("cancels v2 indexing at a checkpoint and accepts a newer generation", async () => {
    const events = Array.from({ length: 5_000 }, (_, sourceIndex) =>
      canonicalEvent(1_735_689_600 + sourceIndex, sourceIndex),
    );
    const runtimeRef: { current?: AnalysisWorkerRuntime } = {};
    const runtime = createRuntime((progress) => {
      if (progress.phase === "index" && progress.completed >= 1_024) {
        runtimeRef.current?.cancel(1);
      }
    }).runtime;
    runtimeRef.current = runtime;
    const dataset = createCanonicalDataset(events);
    await expect(
      runtime.loadDataset(
        1,
        new BrowserFileDatasetSource(dataset.files),
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toBeInstanceOf(WorkerCancellation);

    const replacement = createCanonicalDataset(canonicalMixedEvents());
    await expect(
      runtime.loadDataset(
        2,
        new BrowserFileDatasetSource(replacement.files),
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).resolves.toMatchObject({ summary: { eventCount: 5 } });
  });

  it("returns byte-stable results for repeated queries and validates the DTO", async () => {
    const { runtime } = createRuntime();
    const dataset = createCanonicalDataset(canonicalMixedEvents());
    await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    const settings = {
      kind: "canonical-v2" as const,
      ...canonicalFilters(),
    };
    const first = await runtime.analyze(2, settings);
    const second = await runtime.analyze(3, settings);
    expect(second).toEqual(first);
    expect(validateCanonicalAnalyticsResult(first)).toEqual(first);
    expect(() =>
      validateCanonicalAnalyticsResult({
        ...first,
        unexpected: true,
      }),
    ).toThrow();
  });

  it("maps tokenizer exceptions to a content-free Worker failure", async () => {
    const tokenizer = {
      initialize: vi.fn(async () => undefined),
      cutWithoutHmm: vi.fn(() => {
        throw new Error("synthetic tokenizer detail");
      }),
    };
    const failingRuntime = new AnalysisWorkerRuntime(
      tokenizer,
      "the\n",
      () => undefined,
    );
    const dataset = createCanonicalDataset(canonicalMixedEvents());
    await expect(
      failingRuntime.loadDataset(
        1,
        new BrowserFileDatasetSource(dataset.files),
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "WORKER_RUNTIME_FAILED" });
  });

  it("rejects v2 tamper, order, and unsafe-time cases before accepting a cache", async () => {
    const sourceDataset = createCanonicalDataset(canonicalMixedEvents(), 3);
    const firstChunk = sourceDataset.files[1];
    if (firstChunk === undefined) {
      throw new Error("synthetic chunk missing");
    }
    const tampered = new Uint8Array(await firstChunk.arrayBuffer());
    tampered[0] ^= 1;
    const tamperedFiles = [
      sourceDataset.files[0],
      browserFile([tampered], firstChunk.name),
      ...sourceDataset.files.slice(2),
    ];
    const { runtime } = createRuntime();
    await expect(
      runtime.loadDataset(
        1,
        new BrowserFileDatasetSource(tamperedFiles),
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });

    const outOfOrder = createCanonicalDataset([
      canonicalEvent(1_735_689_600, 7),
    ]);
    await expect(
      runtime.loadDataset(
        2,
        new BrowserFileDatasetSource(outOfOrder.files),
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "RECORD_ORDER_INVALID" });

    const unsafeTime = createCanonicalDataset([
      canonicalEvent(Number.MAX_SAFE_INTEGER, 0),
    ]);
    await expect(
      runtime.loadDataset(
        3,
        new BrowserFileDatasetSource(unsafeTime.files),
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "RECORD_SCHEMA_INVALID" });
  });

  it("reports every canonical core phase and cancels a derived base scan atomically", async () => {
    const phases = new Set<string>();
    const runtimeRef: { current?: AnalysisWorkerRuntime } = {};
    const runtime = createRuntime((progress) => {
      phases.add(progress.phase);
      if (progress.operationId === 2 && progress.phase === "base") {
        runtimeRef.current?.cancel(2);
      }
    }).runtime;
    runtimeRef.current = runtime;
    const dataset = createCanonicalDataset(
      Array.from({ length: 5_000 }, (_, sourceIndex) =>
        canonicalEvent(1_735_689_600 + sourceIndex, sourceIndex),
      ),
    );
    await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    expect(phases).toEqual(
      new Set(["manifest", "transport", "hash", "parse", "wasm", "tokenization", "index", "base", "derived"]),
    );
    await expect(
      runtime.analyze(2, {
        kind: "canonical-v2",
        ...canonicalFilters({ endDate: "2025-01-01" }),
      }),
    ).rejects.toBeInstanceOf(WorkerCancellation);
    await expect(
      runtime.analyze(3, {
        kind: "canonical-v2",
        ...canonicalFilters({ endDate: "2025-01-01" }),
      }),
    ).resolves.toMatchObject({ aggregate: { userMessageCount: 5_000 } });
  });

  it.each([
    "transport",
    "hash",
    "parse",
    "wasm",
    "tokenization",
    "index",
    "base",
    "derived",
  ] as const)("cancels before committing at the %s boundary", async (phase) => {
    const runtimeRef: { current?: AnalysisWorkerRuntime } = {};
    const runtime = createRuntime((progress) => {
      if (progress.phase === phase) {
        runtimeRef.current?.cancel(1);
      }
    }).runtime;
    runtimeRef.current = runtime;
    const dataset = createCanonicalDataset(
      Array.from({ length: 2_048 }, (_, sourceIndex) =>
        canonicalEvent(1_735_689_600 + sourceIndex, sourceIndex),
      ),
    );
    await expect(
      runtime.loadDataset(
        1,
        new BrowserFileDatasetSource(dataset.files),
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toBeInstanceOf(WorkerCancellation);
  });
});
