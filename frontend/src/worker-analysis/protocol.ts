import type {
  DatasetSummary,
  SenderFilter,
} from "../normalized/schema";
import {
  isDatasetId,
  isGeneration,
  isSessionId,
} from "../desktop/ipc-contract";
import type {
  DatasetId,
  Generation,
  SessionId,
} from "../desktop/ipc-contract";
import type {
  CanonicalAnalysisResult,
  CanonicalAnalysisSettings,
  CanonicalDatasetSummary,
} from "./analytics-contract";
import {
  ANALYTICS_RESULT_CONTRACT_VERSION,
  isWorkerQueryKeyBoundTo,
} from "./query-binding";

export const STOP_WORDS_VERSION =
  "chat-history-analysis.stopwords.zh-en.v1";
export const STOP_WORDS_SHA256 =
  "a967184c888afe1fe52a430ba7bf838b39390c1902e6c5b35951a6633068e54b";

export const WORKER_CAPABILITY_PROTOCOL_VERSION =
  "chat-history-analysis.worker-capability.v1" as const;
export { ANALYTICS_RESULT_CONTRACT_VERSION };

export type WorkerPhase =
  | "transport"
  | "manifest"
  | "hash"
  | "parse"
  | "index"
  | "wasm"
  | "records"
  | "tokenization"
  | "base"
  | "sessionization"
  | "derived"
  | "aggregation";

export type WorkerFailureCode =
  | "WORKER_CREATION_FAILED"
  | "WORKER_RUNTIME_FAILED"
  | "WORKER_TERMINATED"
  | "WORKER_TIMEOUT"
  | "WORKER_COMMIT_REJECTED"
  | "WASM_INITIALIZATION_FAILED"
  | "MEMORY_PRESSURE"
  | "RAW_EXPORT_UNSUPPORTED"
  | "MANIFEST_INVALID"
  | "MANIFEST_VERSION_UNSUPPORTED"
  | "FILE_SET_INVALID"
  | "FILE_NAME_INVALID"
  | "DATASET_LIMIT_EXCEEDED"
  | "CHUNK_LIMIT_EXCEEDED"
  | "HASH_MISMATCH"
  | "UTF8_INVALID"
  | "NDJSON_INVALID"
  | "RECORD_SCHEMA_INVALID"
  | "RECORD_ORDER_INVALID"
  | "COUNT_MISMATCH"
  | "RANGE_MISMATCH"
  | "PRIVACY_VALIDATION_FAILED"
  | "DATASET_TRANSPORT_INVALID"
  | "SETTINGS_INVALID"
  | "NO_ACCEPTED_DATASET"
  | "STALE_OPERATION";

export type DesktopTransportCommand =
  | "open_dataset_stream"
  | "receive_dataset_chunk"
  | "complete_dataset_stream"
  | "cancel_dataset_stream"
  | "close_dataset_stream"
  | "commit_worker_result";

/** Internal Worker-to-host bridge messages. They carry opaque capabilities or
 * host-owned aggregate values only; paths and raw source bytes are not part
 * of this protocol. */
export interface DesktopTransportRequest {
  readonly type: "desktop-transport-request";
  readonly requestId: number;
  readonly command: DesktopTransportCommand;
  readonly args: { readonly request: unknown };
}

export interface DesktopTransportResponse {
  readonly type: "desktop-transport-response";
  readonly requestId: number;
  readonly accepted: boolean;
  readonly value?: unknown;
}

export interface TokenizerSettings {
  readonly minimumTokenLength: number;
  readonly additionalStopWords: readonly string[];
}

export const DEFAULT_TOKENIZER_SETTINGS: TokenizerSettings = {
  minimumTokenLength: 2,
  additionalStopWords: [],
};

export interface AnalysisSettings {
  readonly sender: SenderFilter;
  readonly startDate: string;
  readonly endDate: string;
  readonly maximumWords: number;
  readonly minimumFrequency: number;
}

export type { CanonicalAnalysisFilters, CanonicalAnalysisSettings } from "./analytics-contract";
export type { CanonicalAnalysisResult, CanonicalDatasetSummary } from "./analytics-contract";

export interface RankedToken {
  readonly token: string;
  readonly frequency: number;
}

export interface AnalysisResult {
  readonly words: readonly RankedToken[];
  readonly analyzedMessageCount: number;
  readonly uniqueTokenCount: number;
  readonly totalTokenCount: number;
  readonly sender: SenderFilter;
  readonly startDate: string;
  readonly endDate: string;
  readonly maximumWords: number;
  readonly minimumFrequency: number;
  readonly cacheGeneration: number;
}

export interface WorkerProgress {
  readonly type: "progress";
  readonly operationId: number;
  readonly generation: number;
  readonly sequence: number;
  readonly phase: WorkerPhase;
  readonly completed: number;
  readonly total: number;
  readonly percentage: number;
  readonly chunkOrdinal?: number;
  readonly chunkCount?: number;
}

export type BrowserFileSourceRequest = {
  readonly kind: "browser-file-source";
  readonly files: readonly File[];
};

export type DesktopDatasetSourceRequest = {
  readonly kind: "desktop-dataset-source";
  readonly sessionId: SessionId;
  readonly generation: Generation;
  readonly datasetId: DatasetId;
  readonly workerCapability: WorkerOperationCapability;
};

export interface WorkerOperationCapability {
  readonly protocolVersion: typeof WORKER_CAPABILITY_PROTOCOL_VERSION;
  readonly operationId: string;
  readonly nonce: string;
  readonly windowId: string;
  readonly sessionId: SessionId;
  readonly generation: Generation;
  readonly datasetId: DatasetId;
  readonly queryKey: string;
  readonly analyticsContractVersion: typeof ANALYTICS_RESULT_CONTRACT_VERSION;
  readonly expiresAtMillis: number;
}

export type WorkerDatasetSourceRequest =
  | BrowserFileSourceRequest
  | DesktopDatasetSourceRequest;

export type WorkerRequest =
  | {
      readonly type: "load-dataset";
      readonly operationId: number;
      readonly generation: number;
      readonly sequence: number;
      readonly source: WorkerDatasetSourceRequest;
      readonly tokenizerSettings: TokenizerSettings;
    }
  | {
      readonly type: "analyze";
      readonly operationId: number;
      readonly generation: number;
      readonly sequence: number;
      readonly settings: AnalysisSettings | CanonicalAnalysisSettings;
      readonly workerCapability?: WorkerOperationCapability;
    }
  | {
      readonly type: "cancel";
      readonly operationId: number;
      readonly generation: number;
      readonly sequence: number;
    }
  | {
      readonly type: "dispose";
    };

export type WorkerResponse =
  | WorkerProgress
  | {
      readonly type: "accepted";
      readonly operationId: number;
      readonly generation: number;
      readonly sequence: number;
      readonly summary: DatasetSummary | CanonicalDatasetSummary;
      readonly result: AnalysisResult | CanonicalAnalysisResult;
    }
  | {
      readonly type: "result";
      readonly operationId: number;
      readonly generation: number;
      readonly sequence: number;
      readonly result: AnalysisResult | CanonicalAnalysisResult;
      readonly resultId?: string;
    }
  | {
      readonly type: "cancelled";
      readonly operationId: number;
      readonly generation: number;
      readonly sequence: number;
    }
  | {
      readonly type: "error";
      readonly operationId: number;
      readonly generation: number;
      readonly sequence: number;
      readonly code: WorkerFailureCode;
      readonly phase: WorkerPhase;
      readonly chunkOrdinal?: number;
      readonly lineOrdinal?: number;
    };

export function isWorkerOperationCapability(
  value: unknown,
): value is WorkerOperationCapability {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const object = value as Record<string, unknown>;
  const expected = [
    "analyticsContractVersion",
    "datasetId",
    "expiresAtMillis",
    "generation",
    "nonce",
    "operationId",
    "protocolVersion",
    "queryKey",
    "sessionId",
    "windowId",
  ].sort();
  const actual = Object.keys(object).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]) &&
    object.protocolVersion === WORKER_CAPABILITY_PROTOCOL_VERSION &&
    /^wrk_[0-9a-f]{32}$/u.test(String(object.operationId)) &&
    /^nonce_[0-9a-f]{32}$/u.test(String(object.nonce)) &&
    object.windowId === "main" &&
    isSessionId(object.sessionId) &&
    isGeneration(object.generation) &&
    object.generation !== 0 &&
    isDatasetId(object.datasetId) &&
    isWorkerQueryKeyBoundTo(
      object.queryKey,
      object.datasetId as DatasetId,
      object.generation as Generation,
    ) &&
    object.analyticsContractVersion === ANALYTICS_RESULT_CONTRACT_VERSION &&
    Number.isSafeInteger(object.expiresAtMillis) &&
    (object.expiresAtMillis as number) >= Date.now()
  );
}

export interface LegacyAcceptedDatasetResult {
  readonly summary: DatasetSummary;
  readonly result: AnalysisResult;
}

export interface CanonicalAcceptedDatasetResult {
  readonly summary: CanonicalDatasetSummary;
  readonly result: CanonicalAnalysisResult;
}

export type AcceptedDatasetResult =
  | LegacyAcceptedDatasetResult
  | CanonicalAcceptedDatasetResult;
