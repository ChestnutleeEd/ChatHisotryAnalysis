import { describe, expect, it } from "vitest";

import {
  REPLY_INTERVAL_DEFINITION_VERSION,
  REPLY_SESSION_METRICS_SCHEMA_VERSION,
  SESSION_INITIATOR_DEFINITION_VERSION,
  type ReplySessionMetrics,
} from "../src/worker-analysis/reply-session-metrics";
import { toReplySessionPresentation } from "../src/presentation/reply-session-presentation";

const emptyStats = {
  count: 0,
  meanSeconds: null,
  p25Seconds: null,
  medianSeconds: null,
  p75Seconds: null,
  p90Seconds: null,
  bins: [
    { id: "0-59-seconds", label: "0–59 seconds", minSeconds: 0, maxSeconds: 59, count: 0 },
    { id: "60-299-seconds", label: "60–299 seconds", minSeconds: 60, maxSeconds: 299, count: 0 },
    { id: "300-1799-seconds", label: "300–1,799 seconds", minSeconds: 300, maxSeconds: 1_799, count: 0 },
    { id: "1800-3599-seconds", label: "1,800–3,599 seconds", minSeconds: 1_800, maxSeconds: 3_599, count: 0 },
    { id: "3600-21599-seconds", label: "3,600–21,599 seconds", minSeconds: 3_600, maxSeconds: 21_599, count: 0 },
    { id: "21600-43199-seconds", label: "21,600–43,199 seconds", minSeconds: 21_600, maxSeconds: 43_199, count: 0 },
    { id: "43200-86399-seconds", label: "43,200–86,399 seconds", minSeconds: 43_200, maxSeconds: 86_399, count: 0 },
    { id: "86400-seconds", label: "86,400 seconds", minSeconds: 86_400, maxSeconds: 86_400, count: 0 },
  ],
} as const;

function metrics(): ReplySessionMetrics {
  return {
    schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
    replyIntervals: {
      schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
      definitionVersion: REPLY_INTERVAL_DEFINITION_VERSION,
      unit: "seconds",
      thresholdHours: 6,
      filterBehavior: "ignores-global-sender-filter",
      dateBoundary: "both-boundary-messages-inclusive",
      excludedGapRule: "strictly-greater-gap-starts-new-session",
      overall: emptyStats,
      directions: [
        { direction: "owner-to-other", from: "owner", to: "other", responder: "other", stats: emptyStats },
        { direction: "other-to-owner", from: "other", to: "owner", responder: "owner", stats: emptyStats },
      ],
    },
    conversationSessions: {
      schemaVersion: REPLY_SESSION_METRICS_SCHEMA_VERSION,
      definitionVersion: SESSION_INITIATOR_DEFINITION_VERSION,
      thresholdHours: 6,
      filterBehavior: "ignores-global-sender-filter",
      openingDateBoundary: "opening-user-message-inclusive",
      sensitivityChanged: false,
      sessionCount: 0,
      shareDenominator: 0,
      initiatorCounts: {
        owner: { initiator: "owner", count: 0, share: null },
        other: { initiator: "other", count: 0, share: null },
        unknown: { initiator: "unknown", count: 0, share: null },
      },
    },
  };
}

describe("Stage 8 presentation contract", () => {
  it("keeps accessible tables and privacy-safe wording for empty metrics", () => {
    const presentation = toReplySessionPresentation(metrics());
    expect(presentation.replyDirections.rows).toHaveLength(2);
    expect(presentation.replyBins.rows).toHaveLength(8);
    expect(presentation.initiators.rows.map((row) => row.initiator)).toEqual([
      "owner",
      "other",
      "unknown",
    ]);
    expect(presentation.definitions.threshold).toContain("strictly greater");
    expect(presentation.definitions.senderFilter).toContain("does not apply");
    expect(presentation.definitions.languageBoundary).toContain("relationship judgement");
    expect(presentation.definitions.languageBoundary).not.toMatch(/care|affection|psychological|quality/iu);
    expect(JSON.stringify(presentation)).not.toMatch(/path|content|displayName|participant/iu);
  });
});
