import { describe, expect, it, vi } from "vitest";

import {
  BrowserFileDatasetSource,
  DatasetByteSourceError,
} from "../src/worker-analysis/dataset-byte-source";
import {
  DesktopSessionDatasetSource,
  openTauriDatasetSource,
  type DatasetTransportInvoker,
  type DatasetTransportRequest,
  type OpaqueDatasetTransport,
} from "../src/worker-analysis/desktop-dataset-source";
import type { DatasetId, Generation, SessionId } from "../src/desktop/ipc-contract";
import {
  browserFile,
  createSyntheticDataset,
} from "./synthetic-dataset";

const SESSION = "ses_00000000000000000000000000000001" as SessionId;
const GENERATION = 1 as Generation;
const DATASET = "dat_00000000000000000000000000000001" as DatasetId;

describe("DatasetByteSource adapters", () => {
  it("keeps the browser File boundary behavior-preserving", async () => {
    const dataset = createSyntheticDataset();
    const source = new BrowserFileDatasetSource(dataset.files);
    const manifest = await source.readManifest();
    const chunk = await source.readChunk(1, new TextEncoder().encode(dataset.chunkText).byteLength);
    expect(new TextDecoder().decode(manifest)).toContain("manifest.v1");
    expect(new TextDecoder().decode(chunk)).toBe(dataset.chunkText);
    source.assertManifestChunks?.(["chunk-0001.ndjson"]);
    await source.close();
  });

  it("rejects an extra browser file only after manifest allow-list validation", () => {
    const dataset = createSyntheticDataset();
    const source = new BrowserFileDatasetSource([
      ...dataset.files,
      browserFile(["synthetic"], "chunk-0002.ndjson"),
    ]);
    expect(() => source.assertManifestChunks?.(["chunk-0001.ndjson"])).toThrow(
      new DatasetByteSourceError("FILE_SET_INVALID"),
    );
  });

  it("transports only opaque session/generation/ordinal requests", async () => {
    const requests: DatasetTransportRequest[] = [];
    let cancelled = false;
    let closed = false;
    const transport: OpaqueDatasetTransport = {
      read: vi.fn(async (request) => {
        requests.push(request);
        if (cancelled) {
          throw new DatasetByteSourceError("WORKER_TERMINATED");
        }
        if (request.kind === "manifest") {
          return new TextEncoder().encode("{}\n").buffer;
        }
        if (request.ordinal !== 1 || request.expectedBytes !== 5) {
          throw new DatasetByteSourceError("FILE_SET_INVALID");
        }
        return new TextEncoder().encode("one!\n").buffer;
      }),
      cancel: vi.fn(async () => {
        cancelled = true;
      }),
      close: vi.fn(async () => {
        closed = true;
      }),
    };
    const source = new DesktopSessionDatasetSource(
      transport,
      SESSION,
      GENERATION,
    );
    expect(new TextDecoder().decode(await source.readManifest())).toBe("{}\n");
    expect(new TextDecoder().decode(await source.readChunk(1, 5))).toBe("one!\n");
    await source.cancel();
    await expect(source.readManifest()).rejects.toMatchObject({
      code: "WORKER_TERMINATED",
    });
    await source.close();
    expect(cancelled).toBe(true);
    expect(closed).toBe(false);
    expect(requests.every((request) =>
      request.protocolVersion === "chat-history-analysis.desktop-ipc.v1" &&
      request.sessionId === SESSION &&
      request.generation === GENERATION &&
      !Object.hasOwn(request, "path") &&
      !Object.hasOwn(request, "url"),
    )).toBe(true);
  });

  it("uses the bounded Tauri command adapter for ordered multi-chunk reads", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const invoker: DatasetTransportInvoker = {
      async invoke<T>(command: string, args: unknown): Promise<T> {
        calls.push({ command, args });
        const request = (args as { request: Record<string, unknown> }).request;
        expect(Object.keys(request)).not.toContain("path");
        expect(Object.keys(request)).not.toContain("cwd");
        if (command === "open_dataset_stream") {
          return {
            protocolVersion: "chat-history-analysis.desktop-ipc.v1",
            sessionId: SESSION,
            generation: GENERATION,
            datasetId: DATASET,
            manifestBytes: 3,
            recordCount: 2,
            chunkCount: 2,
            chunkBytes: 4,
          } as T;
        }
        if (command === "receive_dataset_chunk") {
          return (request.kind === "manifest" ? [123, 10, 125] : [1, 2, 3, 4]) as T;
        }
        return { closed: true } as T;
      },
    };
    const { opened, source } = await openTauriDatasetSource(invoker, {
      protocolVersion: "chat-history-analysis.desktop-ipc.v1",
      sessionId: SESSION,
      generation: GENERATION,
      datasetId: DATASET,
    });
    expect(opened.chunkCount).toBe(2);
    expect(new Uint8Array(await source.readManifest())).toEqual(
      new Uint8Array([123, 10, 125]),
    );
    expect(new Uint8Array(await source.readChunk(1, 4))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(new Uint8Array(await source.readChunk(2, 4))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    await source.complete();
    await source.close();
    expect(calls.map((call) => call.command)).toEqual([
      "open_dataset_stream",
      "receive_dataset_chunk",
      "receive_dataset_chunk",
      "receive_dataset_chunk",
      "complete_dataset_stream",
      "close_dataset_stream",
    ]);
  });
});
