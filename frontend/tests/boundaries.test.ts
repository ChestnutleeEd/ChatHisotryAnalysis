import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BrowserSelectionError,
  stageBrowserCandidate,
} from "../src/browser-input/port";
import {
  MAX_MANIFEST_BYTES,
  MAX_NORMALIZED_CHUNK_BYTES,
  MAX_NORMALIZED_DATASET_BYTES,
  NORMALIZED_RECORD_FIELDS,
} from "../src/normalized/schema";
import { MAIN_THREAD_ANALYSIS_FALLBACK } from "../src/privacy/constraints";

function metadataFile(name: string, size: number): File {
  return { name, size } as File;
}

describe("browser normalized-file input boundary", () => {
  it("stages one manifest and normalized chunks without reading bytes", () => {
    const manifest = metadataFile("manifest.json", 100);
    const chunk = metadataFile("chunk-0001.ndjson", 200);
    const staged = stageBrowserCandidate([chunk, manifest]);

    expect(staged.manifest).toBe(manifest);
    expect(staged.chunks).toEqual([chunk]);
    expect(staged.aggregateBytes).toBe(300);
  });

  it("accepts exact aggregate and per-chunk limits", () => {
    const remainder =
      MAX_NORMALIZED_DATASET_BYTES -
      3 * MAX_NORMALIZED_CHUNK_BYTES -
      1;
    const staged = stageBrowserCandidate([
      metadataFile("manifest.json", 1),
      metadataFile("chunk-0001.ndjson", MAX_NORMALIZED_CHUNK_BYTES),
      metadataFile("chunk-0002.ndjson", MAX_NORMALIZED_CHUNK_BYTES),
      metadataFile("chunk-0003.ndjson", MAX_NORMALIZED_CHUNK_BYTES),
      metadataFile("chunk-0004.ndjson", remainder),
    ]);
    expect(staged.aggregateBytes).toBe(MAX_NORMALIZED_DATASET_BYTES);
  });

  it.each([
    {
      files: [],
      code: "NO_FILES_SELECTED",
    },
    {
      files: [metadataFile("manifest.json", 10)],
      code: "MANIFEST_MISSING",
    },
    {
      files: [metadataFile("chunk-0001.ndjson", 10)],
      code: "MANIFEST_MISSING",
    },
    {
      files: [
        metadataFile("manifest.json", 1),
        metadataFile(
          "chunk-0001.ndjson",
          MAX_NORMALIZED_CHUNK_BYTES + 1,
        ),
      ],
      code: "CHUNK_TOO_LARGE",
    },
    {
      files: [
        metadataFile("manifest.json", MAX_MANIFEST_BYTES + 1),
        metadataFile("chunk-0001.ndjson", 1),
      ],
      code: "MANIFEST_TOO_LARGE",
    },
    {
      files: [
        metadataFile("manifest.json", 1),
        metadataFile("chunk-0001.ndjson", MAX_NORMALIZED_CHUNK_BYTES),
        metadataFile("chunk-0002.ndjson", MAX_NORMALIZED_CHUNK_BYTES),
        metadataFile("chunk-0003.ndjson", MAX_NORMALIZED_CHUNK_BYTES),
        metadataFile("chunk-0004.ndjson", MAX_NORMALIZED_CHUNK_BYTES),
      ],
      code: "DATASET_TOO_LARGE",
    },
    {
      files: [metadataFile("raw-export.json", 10)],
      code: "RAW_EXPORT_UNSUPPORTED",
    },
    {
      files: [
        metadataFile("manifest.json", 10),
        metadataFile("manifest.json", 10),
      ],
      code: "DUPLICATE_FILE_NAME",
    },
    {
      files: [
        metadataFile("manifest.json", 10),
        metadataFile("chunk-0001.ndjson", 10),
        metadataFile("notes.txt", 10),
      ],
      code: "UNEXPECTED_FILE",
    },
    {
      files: [
        metadataFile("manifest.json", 10),
        metadataFile("chunk-1.ndjson", 10),
      ],
      code: "UNEXPECTED_FILE",
    },
  ])("rejects candidate metadata with $code", ({ files, code }) => {
    expect(() => stageBrowserCandidate(files)).toThrow(
      new BrowserSelectionError(code as never),
    );
  });

  it("defines the exact normalized record fields and no main-thread fallback", () => {
    expect(NORMALIZED_RECORD_FIELDS).toEqual([
      "createTime",
      "formattedTime",
      "calendarDate",
      "senderScope",
      "content",
      "fileRank",
      "sourceIndex",
    ]);
    expect(MAIN_THREAD_ANALYSIS_FALLBACK).toBe("forbidden");
    const appSource = readFileSync(
      fileURLToPath(new URL("../src/presentation/App.tsx", import.meta.url)),
      "utf8",
    );
    expect(appSource).not.toContain("jieba-wasm");
    expect(appSource).not.toContain(".text()");
    expect(appSource).not.toContain(".arrayBuffer()");
  });
});
