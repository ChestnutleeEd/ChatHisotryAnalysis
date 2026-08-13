import { describe, expect, it } from "vitest";

import { syntheticBetaDetailedResult } from "../src/presentation/beta/synthetic-report-fixture";
import { normalizePresentationValue } from "../src/presentation/detailed-visualizations";
import { validateCanonicalAnalyticsResult } from "../src/worker-analysis/analytics-contract";

describe("V3.4R Detailed synthetic result contract", () => {
  it.each([
    [6, false],
    [12, true],
    [24, true],
  ] as const)("keeps the reply/session DTO valid at threshold %i", (threshold, sensitivityChanged) => {
    const result = syntheticBetaDetailedResult({ sessionThresholdHours: threshold });
    const validated = validateCanonicalAnalyticsResult(result);

    expect(validated.filters.sessionThresholdHours).toBe(threshold);
    expect(validated.replySessions.replyIntervals.thresholdHours).toBe(threshold);
    expect(validated.replySessions.conversationSessions.thresholdHours).toBe(threshold);
    expect(validated.replySessions.conversationSessions.sensitivityChanged).toBe(sensitivityChanged);
  });

  it("normalizes presentation marks without changing exact values", () => {
    expect(normalizePresentationValue(0, 12)).toBe(0);
    expect(normalizePresentationValue(6, 12)).toBe(0.5);
    expect(normalizePresentationValue(24, 12)).toBe(1);
    expect(normalizePresentationValue(4, 0)).toBe(0);
  });
});
