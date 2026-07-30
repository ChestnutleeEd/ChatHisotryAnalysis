import { describe, expect, it, vi } from "vitest";

import type { NormalizedTextRecord } from "../src/normalized/schema";
import {
  AnalysisWorkerRuntime,
  WorkerAnalysisError,
  WorkerCancellation,
  buildStopWordSet,
  tokenizeNormalizedContent,
} from "../src/worker-analysis/worker-runtime";
import {
  browserFile,
  createSyntheticDataset,
  formattedTime,
  sha256,
  syntheticRecords,
} from "./synthetic-dataset";

const STOP_WORDS = "的\nthe\nand\n";

function tokenizer() {
  return {
    initialize: vi.fn(async () => undefined),
    cutWithoutHmm: vi.fn((value: string) => value.split(/\s+/u)),
  };
}

function runtimeWith(
  tokenizerDependencies = tokenizer(),
  onProgress: ConstructorParameters<typeof AnalysisWorkerRuntime>[2] = () =>
    undefined,
) {
  return {
    tokenizer: tokenizerDependencies,
    runtime: new AnalysisWorkerRuntime(
      tokenizerDependencies,
      STOP_WORDS,
      onProgress,
    ),
  };
}

describe("Worker text processing and compact cache", () => {
  it("normalizes multilingual text, separators, URLs, numbers, length, and stop words", () => {
    const stopWords = buildStopWordSet(STOP_WORDS, ["LOCAL"]);
    const tokens = tokenizeNormalizedContent(
      "中文，ＨＥＬＬＯ🙂 the 123 a https://example.invalid local 分析",
      (value) => value.split(/\s+/u),
      stopWords,
      2,
    );
    expect(tokens).toEqual(["中文", "hello", "分析"]);
  });

  it("tokenizes once and reuses one deterministic cache for settings changes", async () => {
    const dependency = tokenizer();
    const { runtime } = runtimeWith(dependency);
    const dataset = createSyntheticDataset();
    const accepted = await runtime.loadDataset(1, dataset.files, {
      minimumTokenLength: 2,
      additionalStopWords: [],
    });

    expect(dependency.initialize).toHaveBeenCalledOnce();
    expect(dependency.cutWithoutHmm).toHaveBeenCalledTimes(3);
    expect(accepted.summary.normalizedRecordCount).toBe(3);
    expect(accepted.result.words.slice(0, 5)).toEqual([
      { token: "hello", frequency: 2 },
      { token: "local", frequency: 2 },
      { token: "world", frequency: 2 },
      { token: "分析", frequency: 2 },
      { token: "本地", frequency: 2 },
    ]);

    const owner = await runtime.analyze(2, {
      sender: "owner",
      startDate: "2025-01-01",
      endDate: "2025-01-03",
      maximumWords: 100,
      minimumFrequency: 1,
    });
    expect(owner.analyzedMessageCount).toBe(2);
    expect(owner.cacheGeneration).toBe(accepted.result.cacheGeneration);
    expect(dependency.cutWithoutHmm).toHaveBeenCalledTimes(3);

    const inclusiveBoundary = await runtime.analyze(3, {
      sender: "all",
      startDate: "2025-01-02",
      endDate: "2025-01-02",
      maximumWords: 100,
      minimumFrequency: 1,
    });
    expect(inclusiveBoundary.analyzedMessageCount).toBe(1);
    expect(inclusiveBoundary.words.map((word) => word.token)).toEqual([
      "hello",
      "local",
      "分析",
      "测试",
    ]);
  });

  it("keeps the last accepted cache after a rejected replacement", async () => {
    const { runtime } = runtimeWith();
    const dataset = createSyntheticDataset();
    const accepted = await runtime.loadDataset(1, dataset.files, {
      minimumTokenLength: 2,
      additionalStopWords: [],
    });
    await expect(
      runtime.loadDataset(
        2,
        [
          dataset.files[0],
          browserFile(
            [dataset.chunkText.replace("本地", "异地")],
            "chunk-0001.ndjson",
          ),
        ],
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });

    const result = await runtime.analyze(3, {
      sender: "all",
      startDate: "2025-01-01",
      endDate: "2025-01-03",
      maximumWords: 100,
      minimumFrequency: 1,
    });
    expect(result.cacheGeneration).toBe(accepted.result.cacheGeneration);
  });

  it("cancels at a record checkpoint without committing the candidate", async () => {
    const start = 1_735_689_600;
    const records: NormalizedTextRecord[] = Array.from(
      { length: 5_000 },
      (_, sourceIndex) => ({
        createTime: start + sourceIndex,
        formattedTime: formattedTime(start + sourceIndex),
        calendarDate: formattedTime(start + sourceIndex).slice(0, 10),
        senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
        content: "本地 synthetic analysis",
        fileRank: 0,
        sourceIndex,
      }),
    );
    const dependency = tokenizer();
    const runtime = new AnalysisWorkerRuntime(
      dependency,
      STOP_WORDS,
      (progress) => {
        if (
          progress.phase === "tokenization" &&
          progress.completed >= 2048
        ) {
          runtime.cancel(1);
        }
      },
    );
    await expect(
      runtime.loadDataset(1, createSyntheticDataset(records).files, {
        minimumTokenLength: 2,
        additionalStopWords: [],
      }),
    ).rejects.toBeInstanceOf(WorkerCancellation);
    await expect(
      runtime.analyze(2, {
        sender: "all",
        startDate: "2025-01-01",
        endDate: "2025-01-01",
        maximumWords: 100,
        minimumFrequency: 1,
      }),
    ).rejects.toMatchObject({ code: "NO_ACCEPTED_DATASET" });
  });

  it("returns a content-free WASM initialization category", async () => {
    const dependency = {
      initialize: vi.fn(async () => {
        throw new Error("sensitive upstream detail");
      }),
      cutWithoutHmm: vi.fn(() => []),
    };
    const { runtime } = runtimeWith(dependency);
    await expect(
      runtime.loadDataset(1, createSyntheticDataset().files, {
        minimumTokenLength: 2,
        additionalStopWords: [],
      }),
    ).rejects.toEqual(
      new WorkerAnalysisError("WASM_INITIALIZATION_FAILED", "wasm"),
    );
  });

  it("maps allocation failures to memory pressure without accepting a cache", async () => {
    const dependency = {
      initialize: vi.fn(async () => undefined),
      cutWithoutHmm: vi.fn(() => {
        throw new RangeError("synthetic allocation failure");
      }),
    };
    const { runtime } = runtimeWith(dependency);
    await expect(
      runtime.loadDataset(1, createSyntheticDataset().files, {
        minimumTokenLength: 2,
        additionalStopWords: [],
      }),
    ).rejects.toMatchObject({ code: "MEMORY_PRESSURE" });
    await expect(
      runtime.analyze(2, {
        sender: "all",
        startDate: "2025-01-01",
        endDate: "2025-01-03",
        maximumWords: 100,
        minimumFrequency: 1,
      }),
    ).rejects.toMatchObject({ code: "NO_ACCEPTED_DATASET" });
  });

  it("cancels an in-flight reader during rapid replacement", async () => {
    const dataset = createSyntheticDataset();
    const manifest = dataset.files[0];
    let streamStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    const cancel = vi.fn();
    const gatedManifest = {
      name: manifest.name,
      size: manifest.size,
      arrayBuffer: () => manifest.arrayBuffer(),
      slice: (start?: number, end?: number) =>
        manifest.slice(start, end),
      stream: () => {
        streamStarted?.();
        return new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
          cancel,
        });
      },
    };
    const { runtime } = runtimeWith();
    const stale = runtime.loadDataset(
      1,
      [gatedManifest, dataset.files[1]],
      { minimumTokenLength: 2, additionalStopWords: [] },
    );
    await started;
    const replacement = runtime.loadDataset(2, dataset.files, {
      minimumTokenLength: 2,
      additionalStopWords: [],
    });
    await expect(replacement).resolves.toMatchObject({
      summary: { normalizedRecordCount: 3 },
    });
    streamController?.enqueue(
      new Uint8Array(await manifest.arrayBuffer()),
    );
    await expect(stale).rejects.toBeInstanceOf(WorkerCancellation);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels aggregation at a batch checkpoint and keeps the accepted cache reusable", async () => {
    const start = 1_735_689_600;
    const records: NormalizedTextRecord[] = Array.from(
      { length: 20_000 },
      (_, sourceIndex) => ({
        createTime: start + sourceIndex,
        formattedTime: formattedTime(start + sourceIndex),
        calendarDate: formattedTime(start + sourceIndex).slice(0, 10),
        senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
        content: "本地 synthetic analysis",
        fileRank: 0,
        sourceIndex,
      }),
    );
    const runtime = new AnalysisWorkerRuntime(
      tokenizer(),
      STOP_WORDS,
      (progress) => {
        if (
          progress.operationId === 2 &&
          progress.phase === "aggregation" &&
          progress.completed >= 8192
        ) {
          runtime.cancel(2);
        }
      },
    );
    await runtime.loadDataset(1, createSyntheticDataset(records).files, {
      minimumTokenLength: 2,
      additionalStopWords: [],
    });
    const settings = {
      sender: "all" as const,
      startDate: "2025-01-01",
      endDate: "2025-01-01",
      maximumWords: 100,
      minimumFrequency: 1,
    };
    await expect(runtime.analyze(2, settings)).rejects.toBeInstanceOf(
      WorkerCancellation,
    );
    await expect(runtime.analyze(3, settings)).resolves.toMatchObject({
      analyzedMessageCount: 20_000,
    });
  });

  it("rejects impossible calendar dates and dispose releases the cache", async () => {
    const start = 1_735_689_600;
    const end = 1_767_139_199;
    const dataset = createSyntheticDataset([
      {
        createTime: start,
        formattedTime: formattedTime(start),
        calendarDate: formattedTime(start).slice(0, 10),
        senderScope: "owner",
        content: "synthetic local",
        fileRank: 0,
        sourceIndex: 0,
      },
      {
        createTime: end,
        formattedTime: formattedTime(end),
        calendarDate: formattedTime(end).slice(0, 10),
        senderScope: "other",
        content: "synthetic local",
        fileRank: 0,
        sourceIndex: 1,
      },
    ]);
    const { runtime } = runtimeWith();
    await runtime.loadDataset(1, dataset.files, {
      minimumTokenLength: 2,
      additionalStopWords: [],
    });
    await expect(
      runtime.analyze(2, {
        sender: "all",
        startDate: "2025-02-30",
        endDate: "2025-12-31",
        maximumWords: 100,
        minimumFrequency: 1,
      }),
    ).rejects.toMatchObject({ code: "SETTINGS_INVALID" });
    runtime.dispose();
    await expect(
      runtime.analyze(3, {
        sender: "all",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        maximumWords: 100,
        minimumFrequency: 1,
      }),
    ).rejects.toMatchObject({ code: "NO_ACCEPTED_DATASET" });
  });
});

describe("Worker manifest, chunk, and record trust boundary", () => {
  it.each([
    {
      name: "unknown manifest version",
      dataset: () =>
        createSyntheticDataset(undefined, (manifest) => {
          manifest.schemaVersion = "unknown";
        }).files,
      code: "MANIFEST_VERSION_UNSUPPORTED",
    },
    {
      name: "missing chunk",
      dataset: () => [createSyntheticDataset().files[0]],
      code: "FILE_SET_INVALID",
    },
    {
      name: "extra file",
      dataset: () => [
        ...createSyntheticDataset().files,
        browserFile(["x"], "chunk-0002.ndjson"),
      ],
      code: "FILE_SET_INVALID",
    },
    {
      name: "path traversal chunk name",
      dataset: () =>
        createSyntheticDataset(undefined, (manifest) => {
          const chunks = manifest.chunks as Record<string, unknown>[];
          chunks[0].name = "../chunk-0001.ndjson";
        }).files,
      code: "FILE_NAME_INVALID",
    },
    {
      name: "aggregate mismatch",
      dataset: () =>
        createSyntheticDataset(undefined, (manifest) => {
          const aggregate = manifest.aggregates as Record<string, unknown>;
          aggregate.normalizedRecordCount = 4;
        }).files,
      code: "MANIFEST_INVALID",
    },
    {
      name: "privacy declaration failure",
      dataset: () =>
        createSyntheticDataset(undefined, (manifest) => {
          manifest.privacyValidation = {
            status: "failed",
            forbiddenFieldCount: 1,
          };
        }).files,
      code: "PRIVACY_VALIDATION_FAILED",
    },
  ])("rejects $name", async ({ dataset, code }) => {
    const { runtime } = runtimeWith();
    await expect(
      runtime.loadDataset(1, dataset(), {
        minimumTokenLength: 2,
        additionalStopWords: [],
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects a raw export prefix before tokenizer initialization", async () => {
    const dependency = tokenizer();
    const { runtime } = runtimeWith(dependency);
    const rawManifest = browserFile(
      [
        `${JSON.stringify({
          exportInfo: { format: "detailed-json" },
          session: { type: "private" },
          messages: [{ content: "synthetic forbidden body" }],
        })}\n`,
      ],
      "manifest.json",
    );
    await expect(
      runtime.loadDataset(
        1,
        [rawManifest, browserFile(["{}\n"], "chunk-0001.ndjson")],
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "RAW_EXPORT_UNSUPPORTED" });
    expect(dependency.initialize).not.toHaveBeenCalled();
    expect(dependency.cutWithoutHmm).not.toHaveBeenCalled();
  });

  it("rejects duplicate manifest keys before validating values", async () => {
    const dataset = createSyntheticDataset();
    const duplicateManifest = browserFile(
      [
        '{"schemaVersion":"chat-history-analysis.manifest.v1","schemaVersion":"chat-history-analysis.manifest.v1"}\n',
      ],
      "manifest.json",
    );
    const { runtime } = runtimeWith();
    await expect(
      runtime.loadDataset(
        1,
        [duplicateManifest, dataset.files[1]],
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });

  it.each([
    {
      name: "declared chunk bytes",
      mutate: (manifest: Record<string, unknown>) => {
        const chunks = manifest.chunks as Record<string, unknown>[];
        chunks[0].byteSize = Number(chunks[0].byteSize) + 1;
      },
      code: "FILE_SET_INVALID",
    },
    {
      name: "actual record count",
      mutate: (manifest: Record<string, unknown>) => {
        const chunks = manifest.chunks as Record<string, unknown>[];
        chunks[0].recordCount = 2;
        const aggregates = manifest.aggregates as Record<string, unknown>;
        aggregates.rawMessageCount = 2;
        aggregates.eligibleTextRecordCount = 2;
        aggregates.normalizedRecordCount = 2;
        aggregates.senderCounts = { owner: 1, other: 1 };
      },
      code: "COUNT_MISMATCH",
    },
    {
      name: "actual date range",
      mutate: (manifest: Record<string, unknown>) => {
        const range = manifest.timeRange as Record<string, unknown>;
        const second = syntheticRecords()[1];
        range.maximumCreateTime = second.createTime;
        range.maximumFormattedTime = second.formattedTime;
        range.maximumCalendarDate = second.calendarDate;
      },
      code: "RANGE_MISMATCH",
    },
  ])("rejects mismatch in $name", async ({ mutate, code }) => {
    const dataset = createSyntheticDataset(undefined, mutate);
    const { runtime } = runtimeWith();
    await expect(
      runtime.loadDataset(1, dataset.files, {
        minimumTokenLength: 2,
        additionalStopWords: [],
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects non-canonical source indexes and record order", async () => {
    const records = syntheticRecords().map((record, index) => ({
      ...record,
      sourceIndex: index === 0 ? 9 : record.sourceIndex,
    }));
    const dataset = createSyntheticDataset(records);
    const { runtime } = runtimeWith();
    await expect(
      runtime.loadDataset(1, dataset.files, {
        minimumTokenLength: 2,
        additionalStopWords: [],
      }),
    ).rejects.toMatchObject({ code: "RECORD_ORDER_INVALID" });
  });

  it.each([
    {
      name: "BOM",
      value: (line: string) =>
        new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(line)]),
      code: "UTF8_INVALID",
    },
    {
      name: "invalid UTF-8",
      value: () => new Uint8Array([0xc3, 0x28, 0x0a]),
      code: "UTF8_INVALID",
    },
    {
      name: "truncated final line",
      value: (line: string) => line.slice(0, -1),
      code: "NDJSON_INVALID",
    },
    {
      name: "malformed JSON",
      value: () => "{]\n",
      code: "NDJSON_INVALID",
    },
    {
      name: "duplicate record field",
      value: () =>
        '{"createTime":1,"createTime":1,"formattedTime":"x","calendarDate":"x","senderScope":"owner","content":"x","fileRank":0,"sourceIndex":0}\n',
      code: "NDJSON_INVALID",
    },
  ])("rejects $name after a matching hash", async ({ value, code }) => {
    const original = createSyntheticDataset();
    const nextChunk = value(original.chunkText);
    const bytes =
      typeof nextChunk === "string"
        ? new TextEncoder().encode(nextChunk)
        : nextChunk;
    const manifest = structuredClone(original.manifest);
    const chunks = manifest.chunks as Record<string, unknown>[];
    chunks[0].byteSize = bytes.byteLength;
    chunks[0].sha256 = sha256(bytes);
    const files = [
      browserFile([`${JSON.stringify(manifest)}\n`], "manifest.json"),
      browserFile([bytes], "chunk-0001.ndjson"),
    ];
    const { runtime } = runtimeWith();
    await expect(
      runtime.loadDataset(1, files, {
        minimumTokenLength: 2,
        additionalStopWords: [],
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects unknown and forbidden record fields", async () => {
    const records = syntheticRecords().map((record) => ({ ...record }));
    const line = `${JSON.stringify({
      ...records[0],
      senderUsername: "synthetic-secret",
    })}\n`;
    const bytes = new TextEncoder().encode(line);
    const original = createSyntheticDataset([records[0]]);
    const manifest = structuredClone(original.manifest);
    const chunks = manifest.chunks as Record<string, unknown>[];
    chunks[0].byteSize = bytes.byteLength;
    chunks[0].sha256 = sha256(bytes);
    const { runtime } = runtimeWith();
    await expect(
      runtime.loadDataset(
        1,
        [
          browserFile([`${JSON.stringify(manifest)}\n`], "manifest.json"),
          browserFile([bytes], "chunk-0001.ndjson"),
        ],
        { minimumTokenLength: 2, additionalStopWords: [] },
      ),
    ).rejects.toMatchObject({ code: "RECORD_SCHEMA_INVALID" });
  });
});
