import {
  MANIFEST_FILE_NAME,
  MAX_MANIFEST_BYTES,
  MAX_NORMALIZED_CHUNK_BYTES,
  MAX_NORMALIZED_DATASET_BYTES,
  isNormalizedChunkName,
} from "../normalized/schema";
import type { WorkerFailureCode } from "./protocol";

const RAW_EXPORT_PREFIX_PATTERN =
  /"exportInfo"\s*:[\s\S]*"session"\s*:[\s\S]*"messages"\s*:/u;

/** A small checkpoint hook keeps streaming reads cancellable without giving
 * the source adapter access to Worker state or privileged APIs. */
export type DatasetReadCheckpoint = () => Promise<void>;

export interface RuntimeFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  stream(): ReadableStream<Uint8Array>;
  slice(start?: number, end?: number): Blob;
}

export interface DatasetByteSource {
  readManifest(checkpoint?: DatasetReadCheckpoint): Promise<ArrayBuffer>;
  readChunk(
    ordinal: number,
    expectedBytes: number,
    checkpoint?: DatasetReadCheckpoint,
  ): Promise<ArrayBuffer>;
  /** Reads a manifest-declared chunk by its exact safe filename. */
  readChunkByName?(
    name: string,
    expectedBytes: number,
    checkpoint?: DatasetReadCheckpoint,
  ): Promise<ArrayBuffer>;
  close(): Promise<void>;
  /** Cancels an in-flight native stream before the generic close path. */
  cancel?(): Promise<void>;
  /** Completes the native stream only after every manifest/chunk was read. */
  complete?(): Promise<void>;
  /** Optional source-side exact-set check for browser File selections. */
  assertManifestChunks?(chunkNames: readonly string[]): void;
}

export class DatasetByteSourceError extends Error {
  readonly code: WorkerFailureCode;

  constructor(code: WorkerFailureCode) {
    super(code);
    this.name = "DatasetByteSourceError";
    this.code = code;
  }
}

async function readStream(
  file: RuntimeFile,
  expectedBytes: number,
  checkpoint?: DatasetReadCheckpoint,
): Promise<ArrayBuffer> {
  const reader = file.stream().getReader();
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const part = await reader.read();
      await checkpoint?.();
      if (part.done) {
        break;
      }
      if (offset + part.value.byteLength > bytes.byteLength) {
        throw new DatasetByteSourceError("FILE_SET_INVALID");
      }
      bytes.set(part.value, offset);
      offset += part.value.byteLength;
    }
    if (offset !== bytes.byteLength) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    return bytes.buffer;
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The original content-free failure remains authoritative.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Browser compatibility adapter. It is the only adapter that accepts a
 * collection of File-like objects; the Worker runtime only consumes the
 * DatasetByteSource interface below this boundary.
 */
export class BrowserFileDatasetSource implements DatasetByteSource {
  private readonly files: ReadonlyMap<string, RuntimeFile>;

  constructor(files: readonly RuntimeFile[]) {
    if (files.length < 2) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    const result = new Map<string, RuntimeFile>();
    let totalBytes = 0n;
    for (const file of files) {
      if (
        file.name !== MANIFEST_FILE_NAME &&
        !isNormalizedChunkName(file.name)
      ) {
        throw new DatasetByteSourceError("FILE_NAME_INVALID");
      }
      if (
        file.name.includes("/") ||
        file.name.includes("\\") ||
        file.name.includes("..") ||
        result.has(file.name)
      ) {
        throw new DatasetByteSourceError("FILE_SET_INVALID");
      }
      if (
        isNormalizedChunkName(file.name) &&
        file.size > MAX_NORMALIZED_CHUNK_BYTES
      ) {
        throw new DatasetByteSourceError("CHUNK_LIMIT_EXCEEDED");
      }
      result.set(file.name, file);
      totalBytes += BigInt(file.size);
      if (totalBytes > BigInt(MAX_NORMALIZED_DATASET_BYTES)) {
        throw new DatasetByteSourceError("DATASET_LIMIT_EXCEEDED");
      }
    }
    if (!result.has(MANIFEST_FILE_NAME)) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    this.files = result;
  }

  async readManifest(checkpoint?: DatasetReadCheckpoint): Promise<ArrayBuffer> {
    const file = this.files.get(MANIFEST_FILE_NAME);
    if (file === undefined) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    if (file.size > MAX_MANIFEST_BYTES) {
      const prefix = await file.slice(0, 65_536).text();
      if (RAW_EXPORT_PREFIX_PATTERN.test(prefix)) {
        throw new DatasetByteSourceError("RAW_EXPORT_UNSUPPORTED");
      }
      throw new DatasetByteSourceError("DATASET_LIMIT_EXCEEDED");
    }
    return readStream(file, file.size, checkpoint);
  }

  readChunk(
    ordinal: number,
    expectedBytes: number,
    checkpoint?: DatasetReadCheckpoint,
  ): Promise<ArrayBuffer> {
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_NORMALIZED_CHUNK_BYTES
    ) {
      throw new DatasetByteSourceError("CHUNK_LIMIT_EXCEEDED");
    }
    const name = `chunk-${String(ordinal).padStart(4, "0")}.ndjson`;
    const file = this.files.get(name);
    if (file === undefined || file.size !== expectedBytes) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    return readStream(file, expectedBytes, checkpoint);
  }

  readChunkByName(
    name: string,
    expectedBytes: number,
    checkpoint?: DatasetReadCheckpoint,
  ): Promise<ArrayBuffer> {
    if (!isNormalizedChunkName(name)) {
      throw new DatasetByteSourceError("FILE_NAME_INVALID");
    }
    const file = this.files.get(name);
    if (
      file === undefined ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_NORMALIZED_CHUNK_BYTES ||
      file.size !== expectedBytes
    ) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    return readStream(file, expectedBytes, checkpoint);
  }

  async close(): Promise<void> {
    // Browser File objects have no persistent descriptor to release.
  }

  assertManifestChunks(chunkNames: readonly string[]): void {
    const expectedNames = new Set([MANIFEST_FILE_NAME, ...chunkNames]);
    if (
      expectedNames.size !== this.files.size ||
      [...this.files.keys()].some((name) => !expectedNames.has(name))
    ) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
  }
}
