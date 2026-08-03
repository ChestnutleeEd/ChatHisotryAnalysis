import type {
  DatasetSummary,
  SenderFilter,
} from "../normalized/schema";
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

export const STOP_WORDS_VERSION =
  "chat-history-analysis.stopwords.zh-en.v1";
export const STOP_WORDS_SHA256 =
  "a967184c888afe1fe52a430ba7bf838b39390c1902e6c5b35951a6633068e54b";

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
};

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
