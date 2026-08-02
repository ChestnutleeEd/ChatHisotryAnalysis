import { describe, expect, it, vi } from "vitest";

import type { DatasetTransportInvoker } from "../src/worker-analysis/desktop-dataset-source";
import { openTauriDatasetSource } from "../src/worker-analysis/desktop-dataset-source";
import type {
  DatasetId,
  Generation,
  SessionId,
} from "../src/desktop/ipc-contract";
import { AnalysisWorkerRuntime } from "../src/worker-analysis/worker-runtime";
import { createSyntheticDataset } from "./synthetic-dataset";

const SESSION = "ses_00000000000000000000000000000001" as SessionId;
const DATASET = "dat_00000000000000000000000000000001" as DatasetId;
const GENERATION = 1 as Generation;

describe("desktop source through the Worker runtime", () => {
  it("uses the finite invoke bridge for a real multi-stage Worker load", async () => {
    const dataset = createSyntheticDataset();
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
        const request = (args as { request: Record<string, unknown> }).request;
        expect(Object.keys(request)).not.toContain("path");
        expect(Object.keys(request)).not.toContain("cwd");
        if (command === "open_dataset_stream") {
          return {
            protocolVersion: "chat-history-analysis.desktop-ipc.v1",
            sessionId: SESSION,
            generation: GENERATION,
            datasetId: DATASET,
            manifestBytes: dataset.files[0].size,
            recordCount: 3,
            chunkCount: 1,
            chunkBytes: dataset.files[1].size,
          } as T;
        }
        if (command === "receive_dataset_chunk") {
          const bytes =
            request.kind === "manifest"
              ? await dataset.files[0].arrayBuffer()
              : await dataset.files[1].arrayBuffer();
          return bytes as T;
        }
        return { closed: true } as T;
      },
    };
    const { source } = await openTauriDatasetSource(invoker, {
      protocolVersion: "chat-history-analysis.desktop-ipc.v1",
      sessionId: SESSION,
      generation: GENERATION,
      datasetId: DATASET,
    });
    const runtime = new AnalysisWorkerRuntime(
      {
        initialize: vi.fn(async () => undefined),
        cutWithoutHmm: (value) => value.split(/\s+/u),
      },
      "的\nthe\n",
      () => undefined,
    );

    const accepted = await runtime.loadDataset(
      1,
      source,
      { minimumTokenLength: 2, additionalStopWords: [] },
      { generation: GENERATION, sequence: 1 },
    );
    expect(accepted.summary.normalizedRecordCount).toBe(3);
    expect(calls).toEqual([
      "open_dataset_stream",
      "receive_dataset_chunk",
      "receive_dataset_chunk",
      "complete_dataset_stream",
      "close_dataset_stream",
    ]);
  });
});
