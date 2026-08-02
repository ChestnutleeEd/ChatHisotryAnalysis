import { describe, expect, it } from "vitest";

import {
  CANONICAL_EVENT_FIELDS,
  CANONICAL_MESSAGE_CATEGORIES,
  CANONICAL_MANIFEST_SCHEMA_VERSION,
  MAX_CANONICAL_CHUNK_COUNT,
  MAX_CANONICAL_CHUNK_BYTES,
  MAX_CANONICAL_DATASET_BYTES,
  MAX_CANONICAL_EVENTS,
  isCanonicalManifestV2,
  isCanonicalEventV2,
  isCompatibleDatasetContract,
  parseCompatibleDatasetContract,
  serializeCanonicalManifestV2,
  serializeCanonicalEventV2,
  type CanonicalEventV2,
  validateCanonicalManifestV2,
} from "../src/canonical-v2/schema";
import { MANIFEST_SCHEMA_VERSION } from "../src/normalized/schema";
import vectors from "../../contracts/canonical-v2.vectors.json";

const base = {
  createTime: 1_735_689_600,
  formattedTime: "2025-01-01 08:00:00",
  calendarDate: "2025-01-01",
  senderScope: "owner" as const,
  fileRank: 0,
  sourceIndex: 0,
};

describe("canonical event v2 contract foundation", () => {
  it("freezes categories, fields, limits, and the exact eligible shape", () => {
    expect(CANONICAL_EVENT_FIELDS).toEqual([
      "createTime",
      "formattedTime",
      "calendarDate",
      "senderScope",
      "messageCategory",
      "textEligible",
      "content",
      "fileRank",
      "sourceIndex",
    ]);
    expect(CANONICAL_MESSAGE_CATEGORIES).toHaveLength(15);
    expect(CANONICAL_MANIFEST_SCHEMA_VERSION).toBe(
      "chat-history-analysis.manifest.v2",
    );
    expect(MAX_CANONICAL_EVENTS).toBe(2_000_000);
    expect(MAX_CANONICAL_DATASET_BYTES).toBe(536_870_912);
    expect(MAX_CANONICAL_CHUNK_BYTES).toBe(33_554_432);
    expect(MAX_CANONICAL_CHUNK_COUNT).toBe(16_384);
    expect(
      isCanonicalEventV2({
        ...base,
        messageCategory: "text",
        textEligible: true,
        content: "synthetic text",
      }),
    ).toBe(true);
  });

  it("keeps media, unknown, and system events content-free", () => {
    const media: CanonicalEventV2 = {
      ...base,
      messageCategory: "image",
      textEligible: false,
      content: null,
    };
    const unknown: CanonicalEventV2 = {
      ...base,
      messageCategory: "unknown",
      textEligible: false,
      content: null,
    };
    const system: CanonicalEventV2 = {
      ...base,
      senderScope: null,
      messageCategory: "system",
      textEligible: false,
      content: null,
    };
    expect(isCanonicalEventV2(media)).toBe(true);
    expect(isCanonicalEventV2(unknown)).toBe(true);
    expect(isCanonicalEventV2(system)).toBe(true);
    expect(
      isCanonicalEventV2({ ...media, content: "synthetic payload" }),
    ).toBe(false);
    expect(isCanonicalEventV2({ ...system, senderScope: "other" })).toBe(false);
  });

  it("rejects unknown fields and serializes deterministically", () => {
    const event: CanonicalEventV2 = {
      ...base,
      messageCategory: "text",
      textEligible: true,
      content: "synthetic text",
    };
    expect(serializeCanonicalEventV2(event)).toBe(
      '{"createTime":1735689600,"formattedTime":"2025-01-01 08:00:00","calendarDate":"2025-01-01","senderScope":"owner","messageCategory":"text","textEligible":true,"content":"synthetic text","fileRank":0,"sourceIndex":0}',
    );
    expect(isCanonicalEventV2({ ...event, unknown: true })).toBe(false);
    expect(isCanonicalEventV2({ ...event, sourceIndex: -1 })).toBe(false);
  });

  it("consumes the shared event vectors and serialization goldens", () => {
    for (const vector of vectors.validEvents) {
      expect(isCanonicalEventV2(vector.value), vector.name).toBe(true);
      expect(
        serializeCanonicalEventV2(vector.value as CanonicalEventV2),
        vector.name,
      ).toBe(vector.serialized);
    }
    for (const vector of vectors.invalidEvents) {
      expect(isCanonicalEventV2(vector.value), vector.name).toBe(false);
    }
  });

  it("consumes the shared manifest vectors with exact limits and fields", () => {
    for (const vector of vectors.validManifests) {
      const manifest = validateCanonicalManifestV2(vector.value);
      expect(isCanonicalManifestV2(vector.value), vector.name).toBe(true);
      expect(serializeCanonicalManifestV2(manifest), vector.name).toBe(
        vector.serialized,
      );
    }
    for (const vector of vectors.invalidManifests) {
      expect(isCanonicalManifestV2(vector.value), vector.name).toBe(false);
    }
  });

  it("routes only complete v1/v2 discriminants through exact runtime unions", () => {
    const v1 = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      summary: {
        chunkCount: 1,
        maximumCalendarDate: "2025-01-01",
        minimumCalendarDate: "2025-01-01",
        normalizedRecordCount: 1,
        pseudonymous: true,
        warningCount: 0,
        warningsByReason: {},
      },
      records: [
        {
          createTime: 1735689600,
          formattedTime: "2025-01-01 08:00:00",
          calendarDate: "2025-01-01",
          senderScope: "owner",
          content: "synthetic text",
          fileRank: 0,
          sourceIndex: 0,
        },
      ],
    };
    const v2 = {
      schemaVersion: CANONICAL_MANIFEST_SCHEMA_VERSION,
      summary: {
        eventCount: 1,
        userMessageCount: 1,
        eligibleTextCount: 1,
        systemEventCount: 0,
        chunkCount: 1,
        totalBytes: 1,
        warningCount: 0,
        messageCategoryCounts: Object.fromEntries(
          CANONICAL_MESSAGE_CATEGORIES.map((category) => [
            category,
            category === "text" ? 1 : 0,
          ]),
        ),
        unknownSenderCount: 0,
      },
      events: [
        {
          ...base,
          messageCategory: "text",
          textEligible: true,
          content: "synthetic text",
        },
      ],
    };
    expect(parseCompatibleDatasetContract(v1)).toEqual(v1);
    expect(parseCompatibleDatasetContract(v2)).toEqual(v2);
    expect(isCompatibleDatasetContract({ ...v1, schemaVersion: "v1" })).toBe(false);
    expect(isCompatibleDatasetContract({ ...v2, schemaVersion: "v2" })).toBe(false);
    expect(
      isCompatibleDatasetContract({ ...v1, canonicalSchemaVersion: "mixed" }),
    ).toBe(false);
    expect(
      isCompatibleDatasetContract({
        ...v2,
        summary: { ...v2.summary, eventCount: 2 },
      }),
    ).toBe(false);
  });
});
