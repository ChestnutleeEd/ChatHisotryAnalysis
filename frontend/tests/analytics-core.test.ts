import { describe, expect, it } from "vitest";

import {
  canonicalShare,
  canonicalQueryKey,
  comparativeFilters,
  isCanonicalEligibleText,
  isCanonicalSystemDiagnostic,
  isCanonicalUserMessage,
  validateCanonicalFilters,
} from "../src/worker-analysis/analytics-contract";
import { METRIC_DEFINITION_VERSIONS } from "../src/canonical-v2/schema";
import {
  createSharedAggregate,
  aggregateSummary,
} from "../src/worker-analysis/analytics-aggregates";
import { CanonicalIndexBuilder } from "../src/worker-analysis/canonical-index";
import type { DatasetId, Generation } from "../src/desktop/ipc-contract";
import { canonicalEvent, canonicalFilters } from "./canonical-analytics-fixtures";

const dataset = {
  schemaVersion: "chat-history-analysis.manifest.v2" as const,
  eventCount: 3,
  userMessageCount: 3,
  eligibleTextCount: 2,
  systemEventCount: 0,
  chunkCount: 1,
  totalBytes: 100,
  warningCount: 0,
  messageCategoryCounts: {
    text: 2,
    image: 1,
    voice: 0,
    video: 0,
    file: 0,
    "animated-emoji": 0,
    structured: 0,
    location: 0,
    call: 0,
    "mini-program": 0,
    reply: 0,
    "contact-card": 0,
    system: 0,
    other: 0,
    unknown: 0,
  },
  unknownSenderCount: 0,
  minimumCalendarDate: "2025-01-01",
  maximumCalendarDate: "2025-01-03",
  pseudonymous: true as const,
};

describe("shared analytics semantics and compact index", () => {
  it("freezes inclusive filter semantics and canonical query keys", () => {
    const filters = canonicalFilters({
      endDate: "2025-01-03",
      sender: "owner",
    });
    validateCanonicalFilters(filters, dataset);
    expect(
      canonicalQueryKey(
        "dat_00000000000000000000000000000001" as DatasetId,
        7 as Generation,
        filters,
      ),
    ).toBe(
      JSON.stringify([
        "dat_00000000000000000000000000000001",
        7,
        "2025-01-01",
        "2025-01-03",
        "owner",
        null,
        6,
        "UTC+08:00",
        "chat-history-analysis.aggregate-query.v1",
        "chat-history-analysis.analytics-result.v3",
        [
          METRIC_DEFINITION_VERSIONS.population,
          METRIC_DEFINITION_VERSIONS.time,
          METRIC_DEFINITION_VERSIONS.tokens,
          METRIC_DEFINITION_VERSIONS.keywords,
          METRIC_DEFINITION_VERSIONS.sessions,
        ],
      ]),
    );
    expect(() =>
      validateCanonicalFilters(
        { ...filters, startDate: "2025-01-04" },
        dataset,
      ),
    ).toThrow();
    expect(comparativeFilters(filters).sender).toBe("both");
    expect(canonicalShare(0, 0)).toBeNull();
    expect(canonicalShare(1, 2)).toBe(0.5);
    const userEvent = canonicalEvent(1_735_689_600, 0, {
      content: "eligible",
    });
    const systemEvent = canonicalEvent(1_735_689_601, 1, {
      senderScope: null,
      messageCategory: "system",
      textEligible: false,
      content: null,
    });
    expect(isCanonicalUserMessage(userEvent)).toBe(true);
    expect(isCanonicalEligibleText(userEvent)).toBe(true);
    expect(isCanonicalSystemDiagnostic(systemEvent)).toBe(true);
  });

  it("retains only bounded typed arrays and shared token IDs", () => {
    const builder = new CanonicalIndexBuilder(3);
    const first = canonicalEvent(1_735_689_600, 0, { content: "alpha beta" });
    const second = canonicalEvent(first.createTime + 86_400, 1, {
      senderScope: "other",
      content: "beta gamma",
    });
    const third = canonicalEvent(first.createTime + 2 * 86_400, 2, {
      messageCategory: "image",
      textEligible: false,
      content: null,
    });
    builder.append(first, ["alpha", "beta"]);
    builder.append(second, ["beta", "gamma"]);
    builder.append(third, []);
    const index = builder.finish(dataset);
    expect(index.createTimes).toBeInstanceOf(Float64Array);
    expect(index.senderCodes).toBeInstanceOf(Uint8Array);
    expect(index.recordOffsets).toBeInstanceOf(Uint32Array);
    expect(index.tokenTable).toEqual(["alpha", "beta", "gamma"]);
    expect(index.summary).toMatchObject({
      indexedRecordCount: 3,
      eligibleTextCodePointCount: 20,
      tokenCount: 4,
      distinctTokenCount: 3,
    });
  });

  it("builds one shared aggregate for categories, sender, tokens, hour, and weekday", () => {
    const builder = new CanonicalIndexBuilder(3);
    const first = canonicalEvent(1_735_689_600, 0, { content: "alpha beta" });
    const second = canonicalEvent(first.createTime + 86_400, 1, {
      senderScope: "other",
      content: "beta gamma",
    });
    const third = canonicalEvent(first.createTime + 2 * 86_400, 2, {
      messageCategory: "image",
      textEligible: false,
      content: null,
    });
    builder.append(first, ["alpha", "beta"]);
    builder.append(second, ["beta", "gamma"]);
    builder.append(third, []);
    const index = builder.finish(dataset);
    const shared = createSharedAggregate(
      index,
      canonicalFilters({ endDate: "2025-01-02" }),
    );
    const aggregate = aggregateSummary(shared);
    expect(shared.activeSessionThresholdHours).toBe(6);
    expect(aggregate).toMatchObject({
      eventCount: 2,
      userMessageCount: 2,
      eligibleTextCount: 2,
      senderCounts: { owner: 1, other: 1 },
      tokenCount: 4,
    });
    expect(aggregate.messageCategoryCounts.image).toBe(0);
  });
});
