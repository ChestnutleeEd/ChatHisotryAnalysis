/**
 * Minimal contract for a future normalized record. Stage 1B does not create,
 * read, validate, convert, or persist records of this shape.
 */
export interface NormalizedTextRecord {
  readonly createTime: number;
  readonly formattedTime: string;
  readonly calendarDate: string;
  readonly senderScope: "owner" | "other";
  readonly content: string;
  readonly fileRank: number;
  readonly sourceIndex: number;
}

export const NORMALIZED_RECORD_FIELDS = [
  "createTime",
  "formattedTime",
  "calendarDate",
  "senderScope",
  "content",
  "fileRank",
  "sourceIndex",
] as const;
