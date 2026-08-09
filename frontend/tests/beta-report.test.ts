import { describe, expect, it } from "vitest";

import {
  buildBetaReportDto,
} from "../src/presentation/beta/report-adapter";
import { presentBetaReportZhCN } from "../src/presentation/beta/locales/zh-CN";
import {
  BETA_REPORT_CACHE_LIMIT,
  BetaReportFactsCache,
} from "../src/presentation/beta/report-cache";
import {
  BETA_REPORT_SCHEMA_VERSION,
  BETA_REPORT_VIEW_MODEL_SCHEMA_VERSION,
} from "../src/presentation/beta/report-contract";
import {
  canonicalQueryKey,
  type CanonicalAnalysisResult,
} from "../src/worker-analysis/analytics-contract";
import {
  syntheticBetaAnnualReportResult,
} from "../src/presentation/beta/synthetic-report-fixture";

describe("Beta B2 report adapter and zh-CN presenter", () => {
  it("maps all core sources into an exact, locale-neutral sixteen-section DTO", () => {
    const result = syntheticBetaAnnualReportResult(2025);
    const dto = buildBetaReportDto(result, { mode: "annual", year: 2025 });
    expect(Object.keys(dto).sort()).toEqual([
      "export", "facts", "identity", "metadata", "methodology", "privacy", "schemaVersion", "sections", "wordEvidence",
    ]);
    expect(dto.schemaVersion).toBe(BETA_REPORT_SCHEMA_VERSION);
    expect(dto.metadata.scope).toBe("partial-calendar-query");
    expect(dto.metadata.timezone).toBe("UTC+08:00");
    expect(dto.sections).toHaveLength(16);
    expect(dto.sections.slice(0, 12).map((section) => section.order)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(dto.sections[0]?.factKey).toBe("none");
    expect(dto.sections.slice(1, 12).every((section) => section.factKey !== "none")).toBe(true);
    expect(dto.sections.slice(12).every((section) => section.status === "UNAVAILABLE")).toBe(true);
    expect(dto.facts.peakWeekday.ties).toEqual(["Monday", "Tuesday"]);
    expect(dto.facts.peakHour.ties).toEqual([20, 21]);
    expect(dto.facts.activeDays.calendarDays).toBe(334);
    expect(dto.facts.longestStreak.intervals).toHaveLength(2);
    expect(dto.facts.senderShare.filterBehavior).toBe("ignores-global-sender-filter");
    expect(dto.facts.sessions.filterBehavior).toBe("ignores-global-sender-filter");
    expect(dto.facts.replyIntervals.filterBehavior).toBe("ignores-global-sender-filter");
    expect(dto.privacy).toEqual({
      localOnly: true,
      containsMessageBodies: false,
      containsContactIdentity: false,
    });
    expect(dto.export.containsMessageBodies).toBe(false);
    expect(dto.export.containsContactIdentity).toBe(false);
  });

  it("presents deterministic Chinese copy without relational or psychological inference", () => {
    const result = syntheticBetaAnnualReportResult(2024);
    const first = presentBetaReportZhCN(buildBetaReportDto(result, { mode: "annual", year: 2024 }));
    const second = presentBetaReportZhCN(buildBetaReportDto(result, { mode: "annual", year: 2024 }));
    expect(first.schemaVersion).toBe(BETA_REPORT_VIEW_MODEL_SCHEMA_VERSION);
    expect(first).toEqual(second);
    expect(first.sections).toHaveLength(16);
    expect(first.sections[4]?.lead).toContain("6 月");
    expect(first.sections[5]?.lead).toContain("星期一和星期二");
    expect(first.sections[7]?.visual?.rows[0]?.displayValue).toContain("57.7%");
    expect(first.sections[11]?.lead).toContain("中位数");
    expect(JSON.stringify(first)).not.toMatch(/主动|冷淡|在意|亲密|关系质量|心理|人格|情感|说明你们|说明对方/iu);
  });

  it("keeps zero denominators honest and preserves comparative scope under sender filters", () => {
    const empty = structuredClone(syntheticBetaAnnualReportResult(2024));
    Object.assign(empty.aggregate, { userMessageCount: 0, senderCounts: { owner: 0, other: 0 } });
    Object.assign(empty.activity.chatActivity, { totalChatDays: 0, longestStreakLength: 0, longestStreaks: [] });
    Object.assign(empty.activity.senderComparison, {
      denominator: 0,
      owner: { count: 0, share: null },
      other: { count: 0, share: null },
    });
    Object.assign(empty.activity.trends, {
      monthly: empty.activity.trends.monthly.map((bucket) => ({ ...bucket, count: 0 })),
    });
    Object.assign(empty.activity.weekdayActivity, {
      buckets: empty.activity.weekdayActivity.buckets.map((bucket) => ({ ...bucket, count: 0, share: null })),
    });
    Object.assign(empty.activity.hourActivity, {
      buckets: empty.activity.hourActivity.buckets.map((bucket) => ({ ...bucket, count: 0, share: null })),
    });
    Object.assign(empty.stage7.averageLength, {
      overall: { count: 0, mean: null, median: null, p90: null },
      owner: { count: 0, mean: null, median: null, p90: null },
      other: { count: 0, mean: null, median: null, p90: null },
    });
    Object.assign(empty.stage7.messageTypes, {
      denominator: 0,
      eligibleTextCount: 0,
      categories: empty.stage7.messageTypes.categories.map((bucket) => ({ ...bucket, count: 0, share: null })),
    });
    Object.assign(empty.replySessions.conversationSessions, { sessionCount: 0, shareDenominator: 0 });
    Object.assign(empty.replySessions.replyIntervals, {
      overall: { count: 0, meanSeconds: null, medianSeconds: null, p90Seconds: null },
      directions: empty.replySessions.replyIntervals.directions.map((direction) => ({
        ...direction,
        stats: { count: 0, meanSeconds: null, medianSeconds: null, p90Seconds: null },
      })),
    });
    const emptyDto = buildBetaReportDto(empty, { mode: "annual", year: 2024 });
    const emptyView = presentBetaReportZhCN(emptyDto);
    expect(emptyDto.sections[1]?.status).toBe("EMPTY");
    expect(emptyDto.sections[8]?.status).toBe("INSUFFICIENT");
    expect(emptyDto.sections[11]?.status).toBe("INSUFFICIENT");
    expect(emptyView.sections[11]?.metric).toBeNull();

    const filtered = syntheticBetaAnnualReportResult(2024);
    const filteredResult = {
      ...filtered,
      filters: { ...filtered.filters, sender: "owner" as const },
      queryKey: canonicalQueryKey(filtered.datasetId, filtered.generation, { ...filtered.filters, sender: "owner" as const }),
    } as CanonicalAnalysisResult;
    const filteredDto = buildBetaReportDto(filteredResult, { mode: "annual", year: 2024 });
    expect(filteredDto.metadata.appliedFilters.sender).toBe("owner");
    expect(filteredDto.facts.senderShare.denominator).toBe(1_248);
    expect(filteredDto.facts.senderShare.other.count).toBe(528);
  });

  it("records threshold changes as current committed methodology without changing the base identity rules", () => {
    const source = syntheticBetaAnnualReportResult(2024);
    const filters = { ...source.filters, sessionThresholdHours: 3 as const };
    const result = {
      ...source,
      filters,
      queryKey: canonicalQueryKey(source.datasetId, source.generation, filters),
      replySessions: {
        ...source.replySessions,
        filters,
        conversationSessions: { ...source.replySessions.conversationSessions, thresholdHours: 3 as const },
        replyIntervals: { ...source.replySessions.replyIntervals, thresholdHours: 3 as const },
      },
    } as CanonicalAnalysisResult;
    const dto = buildBetaReportDto(result, { mode: "annual", year: 2024 });
    expect(dto.metadata.appliedFilters.sessionThresholdHours).toBe(3);
    expect(dto.facts.sessions.thresholdHours).toBe(3);
    expect(dto.facts.replyIntervals.thresholdHours).toBe(3);
    expect(dto.methodology.find((fact) => fact.id === "session-threshold")?.value).toBe("3");
  });
});

describe("Beta B2 bounded report facts cache", () => {
  it("hits, evicts oldest entries at eight, and disposes a dataset generation", () => {
    const cache = new BetaReportFactsCache();
    const firstResult = syntheticBetaAnnualReportResult(2024);
    const first = cache.getForResult(firstResult, { mode: "annual", year: 2024 });
    const hit = cache.getForResult(firstResult, { mode: "annual", year: 2024 });
    expect(hit).toBe(first);
    expect(cache.size).toBe(1);

    for (let year = 2016; year <= 2023; year += 1) {
      cache.getForResult(syntheticBetaAnnualReportResult(year), { mode: "annual", year });
    }
    expect(cache.size).toBe(BETA_REPORT_CACHE_LIMIT);
    expect(cache.get({
      datasetId: firstResult.datasetId,
      generation: firstResult.generation,
      baseQueryKey: firstResult.queryKey,
      mode: "annual",
      year: 2024,
    })).toBeUndefined();

    cache.clearForDatasetGeneration(firstResult.datasetId, firstResult.generation);
    expect(cache.size).toBe(0);
  });

  it("does not include navigation-like fields in the key", () => {
    const cache = new BetaReportFactsCache();
    const result = syntheticBetaAnnualReportResult(2024);
    const input = {
      datasetId: result.datasetId,
      generation: result.generation,
      baseQueryKey: result.queryKey,
      mode: "annual" as const,
      year: 2024,
    };
    cache.set(input, buildBetaReportDto(result, input));
    expect(cache.size).toBe(1);
    expect(cache.get({ ...input })).toBeDefined();
  });
});
