import {
  MAX_MANIFEST_BYTES,
  MAX_NORMALIZED_CHUNK_BYTES,
} from "../normalized/schema";
import {
  DESKTOP_IPC_PROTOCOL_VERSION,
  isGeneration,
  isDatasetId,
  isSessionId,
  type DatasetId,
  type Generation,
  type SessionId,
} from "../desktop/ipc-contract";
import {
  DatasetByteSourceError,
  type DatasetByteSource,
  type DatasetReadCheckpoint,
} from "./dataset-byte-source";

export type DatasetTransportKind = "manifest" | "chunk";
const MAX_DESKTOP_RECORD_COUNT = 2_000_000;
const MAX_DESKTOP_CHUNK_COUNT = 16_384;
const MAX_DESKTOP_CHUNK_BYTES = 33_554_432;
const CHUNK_NAME_PATTERN = /^chunk-([0-9]{4})\.ndjson$/u;

export interface DatasetTransportRequest {
  readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
  readonly sessionId: SessionId;
  readonly generation: Generation;
  readonly datasetId: DatasetId;
  readonly kind: DatasetTransportKind;
  readonly ordinal?: number;
  readonly expectedBytes?: number;
}
export interface OpaqueDatasetTransport {
  read(request: DatasetTransportRequest): Promise<ArrayBuffer>;
  complete?(sessionId: SessionId, generation: Generation, datasetId: DatasetId): Promise<void>;
  cancel(sessionId: SessionId, generation: Generation, datasetId: DatasetId): Promise<void>;
  close(sessionId: SessionId, generation: Generation, datasetId: DatasetId): Promise<void>;
}

export interface DatasetStreamOpenRequest {
  readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
  readonly sessionId: SessionId;
  readonly generation: Generation;
  readonly datasetId: DatasetId;
}

export interface DatasetStreamOpened extends DatasetStreamOpenRequest {
  readonly manifestBytes: number;
  readonly recordCount: number;
  readonly chunkCount: number;
  readonly chunkBytes: number;
}

export interface DatasetTransportInvoker {
  invoke<T>(
    command:
      | "open_dataset_stream"
      | "receive_dataset_chunk"
      | "complete_dataset_stream"
      | "cancel_dataset_stream"
      | "close_dataset_stream",
    args: { readonly request: unknown },
  ): Promise<T>;
}

function assertReadBytes(
  value: unknown,
  expectedBytes: number,
  maximumBytes: number,
): ArrayBuffer {
  const bytes = toArrayBuffer(value);
  if (
    bytes.byteLength !== expectedBytes ||
    bytes.byteLength < 1 ||
    bytes.byteLength > maximumBytes
  ) {
    throw new DatasetByteSourceError("FILE_SET_INVALID");
  }
  return bytes;
}

function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) => Number.isInteger(item) && (item as number) >= 0 && (item as number) <= 255,
    )
  ) {
    return Uint8Array.from(value as number[]).buffer;
  }
  throw new DatasetByteSourceError("FILE_SET_INVALID");
}

/**
 * DatasetByteSource for the desktop handoff. It carries only the opaque
 * session capability and ordinal; no path, filename, URL, or command string
 * can be represented by this adapter.
 */
export class DesktopSessionDatasetSource implements DatasetByteSource {
  private closed = false;

  constructor(
    private readonly transport: OpaqueDatasetTransport,
    private readonly sessionId: SessionId,
    private readonly generation: Generation,
    private readonly datasetId: DatasetId = "dat_00000000000000000000000000000001" as DatasetId,
  ) {
    if (
      !isSessionId(sessionId) ||
      !isGeneration(generation) ||
      generation === 0 ||
      !isDatasetId(datasetId)
    ) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
  }

  async readManifest(
    checkpoint?: DatasetReadCheckpoint,
  ): Promise<ArrayBuffer> {
    this.assertOpen();
    await checkpoint?.();
    const bytes = await this.transport.read({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      generation: this.generation,
      datasetId: this.datasetId,
      kind: "manifest",
    });
    await checkpoint?.();
    return assertReadBytes(bytes, bytes.byteLength, MAX_MANIFEST_BYTES);
  }

  async readChunk(
    ordinal: number,
    expectedBytes: number,
    checkpoint?: DatasetReadCheckpoint,
  ): Promise<ArrayBuffer> {
    this.assertOpen();
    if (
      !Number.isSafeInteger(ordinal) ||
      ordinal < 1 ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_NORMALIZED_CHUNK_BYTES
    ) {
      throw new DatasetByteSourceError("FILE_SET_INVALID");
    }
    await checkpoint?.();
    const bytes = await this.transport.read({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      generation: this.generation,
      datasetId: this.datasetId,
      kind: "chunk",
      ordinal,
      expectedBytes,
    });
    await checkpoint?.();
    return assertReadBytes(bytes, expectedBytes, MAX_NORMALIZED_CHUNK_BYTES);
  }

  async readChunkByName(
    name: string,
    expectedBytes: number,
    checkpoint?: DatasetReadCheckpoint,
  ): Promise<ArrayBuffer> {
    this.assertOpen();
    const match = CHUNK_NAME_PATTERN.exec(name);
    if (
      match === null ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_NORMALIZED_CHUNK_BYTES
    ) {
      throw new DatasetByteSourceError("FILE_NAME_INVALID");
    }
    const zeroBasedOrdinal = Number(match[1]);
    if (zeroBasedOrdinal > 16_383) {
      throw new DatasetByteSourceError("CHUNK_LIMIT_EXCEEDED");
    }
    await checkpoint?.();
    const bytes = await this.transport.read({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      generation: this.generation,
      datasetId: this.datasetId,
      kind: "chunk",
      ordinal: zeroBasedOrdinal + 1,
      expectedBytes,
    });
    await checkpoint?.();
    return assertReadBytes(bytes, expectedBytes, MAX_NORMALIZED_CHUNK_BYTES);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.transport.close(this.sessionId, this.generation, this.datasetId);
  }

  async cancel(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.transport.cancel(this.sessionId, this.generation, this.datasetId);
  }

  async complete(): Promise<void> {
    await this.transport.complete?.(
      this.sessionId,
      this.generation,
      this.datasetId,
    );
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new DatasetByteSourceError("WORKER_TERMINATED");
    }
  }
}

const DATASET_STREAM_RESPONSE_FIELDS = [
  "chunkBytes",
  "chunkCount",
  "datasetId",
  "generation",
  "manifestBytes",
  "protocolVersion",
  "recordCount",
  "sessionId",
] as const;

function exactResponse(value: unknown): DatasetStreamOpened {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DatasetByteSourceError("FILE_SET_INVALID");
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...DATASET_STREAM_RESPONSE_FIELDS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    object.protocolVersion !== DESKTOP_IPC_PROTOCOL_VERSION ||
    !isSessionId(object.sessionId) ||
    !isGeneration(object.generation) ||
    object.generation === 0 ||
    !isDatasetId(object.datasetId) ||
    !Number.isSafeInteger(object.manifestBytes) ||
    (object.manifestBytes as number) < 1 ||
    (object.manifestBytes as number) > MAX_MANIFEST_BYTES ||
    !Number.isSafeInteger(object.recordCount) ||
    (object.recordCount as number) < 1 ||
    (object.recordCount as number) > MAX_DESKTOP_RECORD_COUNT ||
    !Number.isSafeInteger(object.chunkCount) ||
    (object.chunkCount as number) < 1 ||
    (object.chunkCount as number) > MAX_DESKTOP_CHUNK_COUNT ||
    !Number.isSafeInteger(object.chunkBytes) ||
    (object.chunkBytes as number) < 1
    || (object.chunkBytes as number) > MAX_DESKTOP_CHUNK_BYTES
  ) {
    throw new DatasetByteSourceError("FILE_SET_INVALID");
  }
  return object as unknown as DatasetStreamOpened;
}

export function createTauriDatasetTransport(
  invoker: DatasetTransportInvoker,
): OpaqueDatasetTransport {
  return {
    async read(request) {
      const value = await invoker.invoke<unknown>("receive_dataset_chunk", {
        request,
      });
      return toArrayBuffer(value);
    },
    async complete(sessionId, generation, datasetId) {
      await invoker.invoke("complete_dataset_stream", {
        request: {
          protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
          sessionId,
          generation,
          datasetId,
        },
      });
    },
    async cancel(sessionId, generation, datasetId) {
      await invoker.invoke("cancel_dataset_stream", {
        request: {
          protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
          sessionId,
          generation,
          datasetId,
        },
      });
    },
    async close(sessionId, generation, datasetId) {
      await invoker.invoke("close_dataset_stream", {
        request: {
          protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
          sessionId,
          generation,
          datasetId,
        },
      });
    },
  };
}

export async function openTauriDatasetSource(
  invoker: DatasetTransportInvoker,
  request: DatasetStreamOpenRequest,
): Promise<{ readonly opened: DatasetStreamOpened; readonly source: DesktopSessionDatasetSource }> {
  if (
    request.protocolVersion !== DESKTOP_IPC_PROTOCOL_VERSION ||
    !isSessionId(request.sessionId) ||
    !isGeneration(request.generation) ||
    request.generation === 0 ||
    !isDatasetId(request.datasetId)
  ) {
    throw new DatasetByteSourceError("FILE_SET_INVALID");
  }
  const opened = exactResponse(
    await invoker.invoke("open_dataset_stream", { request }),
  );
  if (
    opened.sessionId !== request.sessionId ||
    opened.generation !== request.generation ||
    opened.datasetId !== request.datasetId
  ) {
    throw new DatasetByteSourceError("FILE_SET_INVALID");
  }
  const transport = createTauriDatasetTransport(invoker);
  const source = new DesktopSessionDatasetSource(
    {
      ...transport,
      async cancel(sessionId, generation, datasetId) {
        await invoker.invoke("cancel_dataset_stream", {
          request: {
            protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
            sessionId,
            generation,
            datasetId,
          },
        });
      },
      async close(sessionId, generation, datasetId) {
        await invoker.invoke("close_dataset_stream", {
          request: {
            protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
            sessionId,
            generation,
            datasetId,
          },
        });
      },
    },
    request.sessionId,
    request.generation,
    request.datasetId,
  );
  return { opened, source };
}
