import { createHash } from "node:crypto";

import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  CANONICAL_MANIFEST_SCHEMA_VERSION,
  CANONICAL_MESSAGE_CATEGORIES,
  CANONICAL_PREPROCESSOR_VERSION,
  CANONICAL_TIME_POLICY,
  MAX_CANONICAL_CHUNK_BYTES,
  MAX_CANONICAL_CHUNK_COUNT,
  MAX_CANONICAL_DATASET_BYTES,
  MAX_CANONICAL_EVENTS,
  METRIC_DEFINITION_VERSIONS,
  type CanonicalEventV2,
} from "../src/canonical-v2/schema";
import type { CanonicalAnalysisFilters } from "../src/worker-analysis/analytics-contract";
import { browserFile } from "./synthetic-dataset";

export function canonicalHash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalFormattedTime(createTime: number): string {
  const date = new Date(createTime * 1000 + 8 * 60 * 60 * 1000);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function canonicalEvent(
  createTime: number,
  sourceIndex: number,
  overrides: Partial<CanonicalEventV2> = {},
): CanonicalEventV2 {
  const formattedTime = canonicalFormattedTime(createTime);
  return {
    createTime,
    formattedTime,
    calendarDate: formattedTime.slice(0, 10),
    senderScope: "owner",
    messageCategory: "text",
    textEligible: true,
    content: `synthetic token ${sourceIndex}`,
    fileRank: 0,
    sourceIndex,
    ...overrides,
  };
}

export function createCanonicalDataset(
  events: readonly CanonicalEventV2[],
  splitAt = events.length,
): { readonly files: readonly File[]; readonly manifest: Record<string, unknown> } {
  const parts = [events.slice(0, splitAt), events.slice(splitAt)].filter(
    (part) => part.length > 0,
  );
  const chunks = parts.map((part, index) => {
    const bytes = new TextEncoder().encode(
      part.map((event) => `${JSON.stringify(event)}\n`).join(""),
    );
    return {
      bytes,
      descriptor: {
        ordinal: index,
        name: `chunk-${String(index).padStart(4, "0")}.ndjson`,
        byteSize: bytes.byteLength,
        recordCount: part.length,
        sha256: canonicalHash(bytes),
      },
    };
  });
  const categoryCounts = Object.fromEntries(
    CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<string, number>;
  let eligibleTextCount = 0;
  let systemEventCount = 0;
  for (const event of events) {
    categoryCounts[event.messageCategory] += 1;
    eligibleTextCount += event.textEligible ? 1 : 0;
    systemEventCount += event.messageCategory === "system" ? 1 : 0;
  }
  const chunkBytes = chunks.reduce(
    (total, chunk) => total + chunk.bytes.byteLength,
    0,
  );
  const manifest: Record<string, unknown> = {
    schemaVersion: CANONICAL_MANIFEST_SCHEMA_VERSION,
    canonicalSchemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
    preprocessorVersion: CANONICAL_PREPROCESSOR_VERSION,
    timePolicy: CANONICAL_TIME_POLICY,
    metricDefinitionVersions: METRIC_DEFINITION_VERSIONS,
    publicationCounts: {
      sourceCount: 1,
      rawAcceptedEventCount: events.length,
      canonicalEventCount: events.length,
      duplicateEventCount: 0,
    },
    chunks: chunks.map((chunk) => chunk.descriptor),
    aggregates: {
      eventCount: events.length,
      userMessageCount: events.length - systemEventCount,
      eligibleTextCount,
      systemEventCount,
      chunkCount: chunks.length,
      totalBytes: chunkBytes,
      warningCount: 0,
      messageCategoryCounts: categoryCounts,
      unknownSenderCount: 0,
    },
    limits: {
      maxEvents: MAX_CANONICAL_EVENTS,
      maxDatasetBytes: MAX_CANONICAL_DATASET_BYTES,
      maxChunkBytes: MAX_CANONICAL_CHUNK_BYTES,
      maxChunkCount: MAX_CANONICAL_CHUNK_COUNT,
    },
    privacyValidation: {
      status: "passed",
      forbiddenFieldCount: 0,
      contentPolicy: "eligible-text-only",
    },
  };
  return {
    files: [
      browserFile([`${JSON.stringify(manifest)}\n`], "manifest.json"),
      ...chunks.map((chunk) => browserFile([chunk.bytes], chunk.descriptor.name)),
    ],
    manifest,
  };
}

export function canonicalMixedEvents(): readonly CanonicalEventV2[] {
  const start = 1_735_689_600;
  return [
    canonicalEvent(start, 0, {
      senderScope: "owner",
      content: "alpha beta",
    }),
    canonicalEvent(start + 3_600, 1, {
      senderScope: "other",
      content: "beta gamma",
    }),
    canonicalEvent(start + 86_400, 2, {
      senderScope: "owner",
      messageCategory: "image",
      textEligible: false,
      content: null,
    }),
    canonicalEvent(start + 2 * 86_400, 3, {
      senderScope: null,
      messageCategory: "system",
      textEligible: false,
      content: null,
    }),
    canonicalEvent(start + 3 * 86_400, 4, {
      senderScope: "other",
      messageCategory: "unknown",
      textEligible: false,
      content: null,
    }),
  ];
}

export function canonicalFilters(
  overrides: Partial<CanonicalAnalysisFilters> = {},
): CanonicalAnalysisFilters {
  return {
    startDate: "2025-01-01",
    endDate: "2025-01-04",
    sender: "both",
    selectedYear: null,
    sessionThresholdHours: 6,
    ...overrides,
  };
}

export function syntheticAnalyticsEvents(
  count = 8_192,
): readonly CanonicalEventV2[] {
  const start = Math.floor(Date.UTC(2023, 0, 1) / 1000) - 8 * 60 * 60;
  return Array.from({ length: count }, (_, sourceIndex) => {
    const createTime = start + sourceIndex * 6 * 60 * 60;
    if (sourceIndex % 17 === 0) {
      return canonicalEvent(createTime, sourceIndex, {
        senderScope: null,
        messageCategory: "system",
        textEligible: false,
        content: null,
      });
    }
    if (sourceIndex % 7 === 0) {
      return canonicalEvent(createTime, sourceIndex, {
        senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
        messageCategory: "image",
        textEligible: false,
        content: null,
      });
    }
    if (sourceIndex % 11 === 0) {
      return canonicalEvent(createTime, sourceIndex, {
        senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
        messageCategory: "unknown",
        textEligible: false,
        content: null,
      });
    }
    return canonicalEvent(createTime, sourceIndex, {
      senderScope: sourceIndex % 2 === 0 ? "owner" : "other",
      content: `synthetic token-${sourceIndex % 31} year-${2023 + Math.floor(sourceIndex / 1460)}`,
    });
  });
}
