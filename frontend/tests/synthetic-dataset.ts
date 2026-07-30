import { createHash } from "node:crypto";

import type { NormalizedTextRecord } from "../src/normalized/schema";

export function formattedTime(createTime: number): string {
  const date = new Date(createTime * 1000 + 8 * 60 * 60 * 1000);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function syntheticRecords(): readonly NormalizedTextRecord[] {
  const start = 1_735_689_600;
  return [
    {
      createTime: start,
      formattedTime: formattedTime(start),
      calendarDate: formattedTime(start).slice(0, 10),
      senderScope: "owner",
      content: "本地 隐私 hello world",
      fileRank: 0,
      sourceIndex: 0,
    },
    {
      createTime: start + 86_400,
      formattedTime: formattedTime(start + 86_400),
      calendarDate: formattedTime(start + 86_400).slice(0, 10),
      senderScope: "other",
      content: "分析 测试 hello local",
      fileRank: 0,
      sourceIndex: 1,
    },
    {
      createTime: start + 2 * 86_400,
      formattedTime: formattedTime(start + 2 * 86_400),
      calendarDate: formattedTime(start + 2 * 86_400).slice(0, 10),
      senderScope: "owner",
      content: "本地 分析 world local",
      fileRank: 0,
      sourceIndex: 2,
    },
  ];
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function browserFile(
  parts: readonly (string | Uint8Array)[],
  name: string,
): File {
  const blobParts: BlobPart[] = parts.map((part) =>
    typeof part === "string"
      ? part
      : new Uint8Array(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer),
  );
  return new File(blobParts, name, {
    lastModified: 0,
    type: name.endsWith(".json")
      ? "application/json"
      : "application/x-ndjson",
  });
}

export interface SyntheticDataset {
  readonly files: readonly File[];
  readonly manifest: Record<string, unknown>;
  readonly chunkText: string;
}

export function createSyntheticDataset(
  records: readonly NormalizedTextRecord[] = syntheticRecords(),
  mutateManifest?: (manifest: Record<string, unknown>) => void,
): SyntheticDataset {
  const chunkText = records
    .map((record) => `${JSON.stringify(record)}\n`)
    .join("");
  const chunkBytes = new TextEncoder().encode(chunkText);
  const ownerCount = records.filter(
    (record) => record.senderScope === "owner",
  ).length;
  const manifest: Record<string, unknown> = {
    schemaVersion: "chat-history-analysis.manifest.v1",
    normalizedSchemaVersion:
      "chat-history-analysis.normalized-record.v1",
    preprocessorVersion: "0.1.0",
    conversationFingerprint: "a".repeat(64),
    timePolicy: "UTC+08:00",
    inputs: [
      {
        role: "annual-source",
        suppliedOrdinal: 1,
        fileRank: 0,
        byteSize: 1,
        sha256: "b".repeat(64),
      },
    ],
    chunks: [
      {
        name: "chunk-0001.ndjson",
        byteSize: chunkBytes.byteLength,
        recordCount: records.length,
        sha256: sha256(chunkBytes),
      },
    ],
    aggregates: {
      sourceCount: 1,
      annualSourceCount: 1,
      overlapVerificationCount: 0,
      rawMessageCount: records.length,
      eligibleTextRecordCount: records.length,
      normalizedRecordCount: records.length,
      skippedRecordCount: 0,
      duplicateRecordCount: 0,
      warningCount: 0,
      senderCounts: {
        owner: ownerCount,
        other: records.length - ownerCount,
      },
      skippedByReason: {},
      warningsByReason: {},
      overlap: {
        annualRangeOverlapCount: 0,
        suspiciousAnnualOverlapCount: 0,
        verificationSourceCount: 0,
        matchedEligibleRecordCount: 0,
        unmatchedEligibleRecordCount: 0,
      },
    },
    timeRange: {
      minimumCreateTime: records[0]?.createTime ?? 0,
      maximumCreateTime: records.at(-1)?.createTime ?? 0,
      minimumFormattedTime: records[0]?.formattedTime ?? "",
      maximumFormattedTime: records.at(-1)?.formattedTime ?? "",
      minimumCalendarDate: records[0]?.calendarDate ?? "",
      maximumCalendarDate: records.at(-1)?.calendarDate ?? "",
    },
    privacyValidation: {
      status: "passed",
      forbiddenFieldCount: 0,
    },
  };
  mutateManifest?.(manifest);
  const manifestText = `${JSON.stringify(manifest)}\n`;
  return {
    files: [
      browserFile([manifestText], "manifest.json"),
      browserFile([chunkBytes], "chunk-0001.ndjson"),
    ],
    manifest,
    chunkText,
  };
}

export function replaceChunk(
  dataset: SyntheticDataset,
  value: string | Uint8Array,
): readonly File[] {
  return [
    dataset.files[0],
    browserFile(
      [typeof value === "string" ? value : value],
      "chunk-0001.ndjson",
    ),
  ];
}

export function extraFile(name: string, value = "synthetic"): File {
  return browserFile([value], name);
}
