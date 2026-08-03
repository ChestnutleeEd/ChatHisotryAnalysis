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
    expect(result.activity).toMatchObject({
      schemaVersion: "chat-history-analysis.activity-metrics.v1",
      timePolicy: "UTC+08:00",
      population: "post-dedup-user-messages",
      senderComparison: {
        denominator: 4,
        owner: { count: 2, share: 0.5 },
        other: { count: 2, share: 0.5 },
      },
      chatActivity: {
        totalChatDays: 3,
        longestStreakLength: 2,
      },
    });
    expect(result.activity.trends.daily).toHaveLength(4);
    expect(result.activity.hourActivity.buckets).toHaveLength(24);
    expect(result.activity.weekdayActivity.buckets).toHaveLength(7);
    expect(result.replySessions).toMatchObject({
      schemaVersion: "chat-history-analysis.reply-session-metrics.v1",
      replyIntervals: {
        thresholdHours: 6,
        overall: { count: 1, medianSeconds: 3_600 },
      },
      conversationSessions: {
        thresholdHours: 6,
        sessionCount: 3,
      },
    });
    expect(JSON.stringify(result)).not.toContain("alpha beta");
    expect(JSON.stringify(result)).not.toContain("beta gamma");
    expect(JSON.stringify(result)).not.toContain('"content"');
    expect(tokenizer.initialize).toHaveBeenCalledOnce();
    expect(tokenizer.cutWithoutHmm).toHaveBeenCalledTimes(2);
  });

  it("rejects a Stage 8 DTO whose effective threshold diverges from the result filters", async () => {
    const { runtime } = createRuntime();
    const dataset = createCanonicalDataset(canonicalMixedEvents());
    const accepted = await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    const result = asCanonicalResult(accepted.result);
    const invalid = {
      ...result,
      replySessions: {
        ...result.replySessions,
        conversationSessions: {
          ...result.replySessions.conversationSessions,
          thresholdHours: 1,
        },
      },
    };
    expect(() => validateCanonicalAnalyticsResult(invalid)).toThrow(
      "INVALID_REPLY_SESSION_RESULT",
    );
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

  it("caches complete Stage 7 results and evicts the oldest canonical query", async () => {
    const phases: string[] = [];
    const { runtime } = createRuntime((progress) => {
      phases.push(progress.phase);
    });
    const dataset = createCanonicalDataset(canonicalMixedEvents());
    await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    const initialFilters = canonicalFilters();
    const first = await runtime.analyze(2, {
      kind: "canonical-v2",
      ...initialFilters,
    });
    phases.length = 0;
    const cached = await runtime.analyze(3, {
      kind: "canonical-v2",
      ...initialFilters,
    });
    expect(cached).toBe(first);
    expect(phases).toEqual(["derived"]);

    const distinctFilters = [
      { sender: "owner" as const },
      { sender: "other" as const },
      { sessionThresholdHours: 1 as const },
      { sessionThresholdHours: 3 as const },
      { sessionThresholdHours: 12 as const },
      { sessionThresholdHours: 24 as const },
      { sender: "owner" as const, sessionThresholdHours: 1 as const },
      { sender: "other" as const, sessionThresholdHours: 1 as const },
    ];
    for (const [index, overrides] of distinctFilters.entries()) {
      await runtime.analyze(index + 4, {
        kind: "canonical-v2",
        ...canonicalFilters(overrides),
      });
    }
    phases.length = 0;
    const recomputed = await runtime.analyze(12, {
      kind: "canonical-v2",
      ...initialFilters,
    });
    expect(recomputed).not.toBe(first);
    expect(phases).toContain("base");
    expect(recomputed.stage7).toEqual(first.stage7);
  });

  it("recomputes reply and initiator metrics for a new threshold and reuses one active threshold index", async () => {
    const phases: string[] = [];
    const { runtime } = createRuntime((progress) => {
      phases.push(progress.phase);
    });
    const dataset = createCanonicalDataset([
      canonicalEvent(1_735_689_600, 0, { senderScope: "owner" }),
      canonicalEvent(1_735_693_200, 1, { senderScope: "other" }),
      canonicalEvent(1_735_704_000, 2, { senderScope: "owner" }),
    ]);
    await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    phases.length = 0;
    const oneHour = await runtime.analyze(2, {
      kind: "canonical-v2",
      ...canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-01", sessionThresholdHours: 1 }),
    });
    expect(oneHour.replySessions.conversationSessions.sessionCount).toBe(2);
    expect(oneHour.replySessions.replyIntervals.overall.count).toBe(1);
    expect(phases).toContain("sessionization");

    phases.length = 0;
    const sixHours = await runtime.analyze(3, {
      kind: "canonical-v2",
      ...canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-01", sessionThresholdHours: 6 }),
    });
    expect(sixHours.replySessions.conversationSessions.sessionCount).toBe(1);
    expect(sixHours.replySessions.replyIntervals.overall.count).toBe(2);
    expect(phases).toContain("sessionization");

    phases.length = 0;
    const cached = await runtime.analyze(4, {
      kind: "canonical-v2",
      ...canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-01", sessionThresholdHours: 6 }),
    });
    expect(cached).toBe(sixHours);
    expect(phases).toEqual(["derived"]);
  });

  it("cancels threshold sessionization without publishing a mixed result", async () => {
    const runtimeRef: { current?: AnalysisWorkerRuntime } = {};
    const runtime = createRuntime((progress) => {
      if (progress.operationId === 2 && progress.phase === "sessionization" && progress.completed >= 4_096) {
        runtimeRef.current?.cancel(2);
      }
    }).runtime;
    runtimeRef.current = runtime;
    const events = Array.from({ length: 5_000 }, (_, sourceIndex) =>
      canonicalEvent(1_735_689_600 + sourceIndex * 3_600, sourceIndex, {
        senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
      }),
    );
    const dataset = createCanonicalDataset(events);
    await runtime.loadDataset(
      1,
      new BrowserFileDatasetSource(dataset.files),
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    await expect(
      runtime.analyze(2, {
        kind: "canonical-v2",
        ...canonicalFilters({ sessionThresholdHours: 1 }),
      }),
    ).rejects.toBeInstanceOf(WorkerCancellation);
    await expect(
      runtime.analyze(3, {
        kind: "canonical-v2",
        ...canonicalFilters({ sessionThresholdHours: 6 }),
      }),
    ).resolves.toMatchObject({
      replySessions: {
        conversationSessions: { thresholdHours: 6 },
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
    expect(() =>
      validateCanonicalAnalyticsResult({
        ...first,
        activity: {
          ...first.activity,
          unexpected: true,
        },
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
      new Set(["manifest", "transport", "hash", "parse", "wasm", "tokenization", "index", "sessionization", "base", "derived"]),
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
