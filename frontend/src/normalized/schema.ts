export const MANIFEST_FILE_NAME = "manifest.json";
export const MANIFEST_SCHEMA_VERSION =
  "chat-history-analysis.manifest.v1";
export const NORMALIZED_SCHEMA_VERSION =
  "chat-history-analysis.normalized-record.v1";
export const PREPROCESSOR_VERSION = "0.1.0";
export const TIME_POLICY = "UTC+08:00";

export const MAX_NORMALIZED_RECORDS = 1_000_000;
export const MAX_NORMALIZED_DATASET_BYTES = 134_217_728;
export const MAX_NORMALIZED_CHUNK_BYTES = 33_554_432;
export const MAX_MANIFEST_BYTES = 4_194_304;

export const NORMALIZED_RECORD_FIELDS = [
  "createTime",
  "formattedTime",
  "calendarDate",
  "senderScope",
  "content",
  "fileRank",
  "sourceIndex",
] as const;

export type SenderScope = "owner" | "other";
export type SenderFilter = "all" | SenderScope;

export interface NormalizedTextRecord {
  readonly createTime: number;
  readonly formattedTime: string;
  readonly calendarDate: string;
  readonly senderScope: SenderScope;
  readonly content: string;
  readonly fileRank: number;
  readonly sourceIndex: number;
}

export interface NormalizedChunkDescriptor {
  readonly byteSize: number;
  readonly name: string;
  readonly recordCount: number;
  readonly sha256: string;
}

export interface DatasetSummary {
  readonly normalizedRecordCount: number;
  readonly minimumCalendarDate: string;
  readonly maximumCalendarDate: string;
  readonly warningCount: number;
  readonly warningsByReason: Readonly<Record<string, number>>;
  readonly chunkCount: number;
  readonly pseudonymous: true;
}

export function isNormalizedChunkName(value: string): boolean {
  return /^chunk-[0-9]{4}\.ndjson$/u.test(value);
}
