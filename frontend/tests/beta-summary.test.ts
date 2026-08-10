import { describe, expect, it } from "vitest";

import {
  buildBetaReportDto,
} from "../src/presentation/beta/report-adapter";
import {
  createBetaSummaryDtoV1,
} from "../src/presentation/beta/summary-adapter";
import {
  presentBetaSummaryZhCN,
} from "../src/presentation/beta/summary-presenter";
import {
  validateBetaSummaryDtoV1,
  validateShareCardViewModelPrivacyV1,
  validateShareCardViewModelV1,
} from "../src/presentation/beta/summary-contract";
import {
  createWordFrequencyPresentation,
} from "../src/presentation/beta/word-presentation";
import {
  canonicalQueryKey,
  type CanonicalAnalysisFilters,
  type CanonicalAnalysisResult,
} from "../src/worker-analysis/analytics-contract";
import {
  syntheticBetaAllYearsReportResult,
  syntheticBetaAnnualReportResult,
} from "../src/presentation/beta/synthetic-report-fixture";
import { syntheticBetaWordCloudFrequency } from "../src/presentation/beta/synthetic-word-cloud-fixture";

function annualReport(year: number) {
  const result = syntheticBetaAnnualReportResult(year);
  return buildBetaReportDto(result, { mode: "annual", year });
}

function allYearsReport() {
  const result = syntheticBetaAllYearsReportResult();
  return buildBetaReportDto(result, { mode: "all-years", year: null });
}

function boundedAllYearsReport(): ReturnType<typeof buildBetaReportDto> {
  const source = syntheticBetaAllYearsReportResult();
  const filters: CanonicalAnalysisFilters = {
    ...source.filters,
    startDate: "2024-03-15",
    endDate: "2025-10-20",
  };
  const result = {
    ...source,
    filters,
    queryKey: canonicalQueryKey(source.datasetId, source.generation, filters),
    activity: { ...source.activity, filters },
    stage7: { ...source.stage7, filters },
    replySessions: { ...source.replySessions, filters },
  } as CanonicalAnalysisResult;
  return buildBetaReportDto(result, { mode: "all-years", year: null });
}

function visibleWords(year: number | null, hidden: readonly string[] = [], cleanMode = true) {
  return createWordFrequencyPresentation(
    syntheticBetaWordCloudFrequency(year, "both"),
    hidden,
    "raw-count",
    20,
    cleanMode,
  );
}

function summaryWithVocabulary(
  report: ReturnType<typeof annualReport>,
  includeVocabulary = true,
  hidden: readonly string[] = [],
  cleanMode = true,
) {
  const presentation = visibleWords(report.metadata.mode === "annual" ? report.metadata.year : null, hidden, cleanMode);
  return createBetaSummaryDtoV1(report, {
    includeVocabulary,
    wordPresentation: presentation,
    expectedWordRole: "both",
    expectedFrequencyDtoKey: presentation.frequencyDtoKey,
  });
}

describe("Beta B5.1 summary contracts", () => {
  it("emits exact-key versioned contracts for single-year, all-years, partial, and bounded ranges", () => {
    const single = createBetaSummaryDtoV1(annualReport(2024));
    const allYears = createBetaSummaryDtoV1(allYearsReport());
    const partial = createBetaSummaryDtoV1(annualReport(2025));
    const bounded = createBetaSummaryDtoV1(boundedAllYearsReport());

    expect(Object.keys(single).sort()).toEqual([
      "exportAvailability", "facts", "footer", "identity", "schemaVersion", "scope", "senderFilter", "timezone", "versions", "vocabulary",
    ]);
    expect(single.scope).toMatchObject({ kind: "single-year", year: 2024, partial: false });
    expect(allYears.scope).toMatchObject({ kind: "all-years", year: null, partial: false, startDate: "2024-01-01", endDate: "2025-12-31" });
    expect(partial.scope).toMatchObject({ kind: "single-year", year: 2025, partial: true, startDate: "2025-02-01" });
    expect(bounded.scope).toMatchObject({ kind: "all-years", year: null, partial: true, startDate: "2024-03-15", endDate: "2025-10-20" });
    expect(single.timezone).toBe("UTC+08:00");
    expect(single.versions).toMatchObject({
      presenter: "chat-history-analysis.beta-summary-presenter.zh-CN.v1",
      copy: "chat-history-analysis.share-card-copy.v1",
      artwork: "chat-history-analysis.share-card-art.v1",
    });
    expect(() => validateBetaSummaryDtoV1(single)).not.toThrow();
  });

  it("selects trusted facts without re-aggregating and retains ties, streaks, and anonymous sender shares", () => {
    const source = structuredClone(annualReport(2024));
    const mutated = {
      ...source,
      facts: {
        ...source.facts,
        peakMonth: {
          ...source.facts.peakMonth,
          maxCount: 138,
          ties: ["2024-06", "2024-09"],
        },
        longestStreak: {
          length: 14,
          intervals: [
            { startDate: "2024-04-03", endDate: "2024-04-16", length: 14 },
            { startDate: "2024-09-10", endDate: "2024-09-23", length: 14 },
          ],
        },
      },
    };
    const summary = createBetaSummaryDtoV1(mutated);

    expect(summary.facts.totalMessages).toMatchObject({ status: "available", value: { count: 824 } });
    expect(summary.facts.activeDays).toMatchObject({ status: "available", value: { count: 112 } });
    expect(summary.facts.mostActiveMonth).toMatchObject({
      status: "available",
      value: { monthKeys: ["2024-06", "2024-09"], messageCount: 138 },
    });
    expect(summary.facts.longestStreak).toMatchObject({
      status: "available",
      value: { length: 14, intervals: expect.any(Array) },
    });
    expect(summary.facts.senderComparison).toMatchObject({
      status: "available",
      value: {
        denominator: 1_248,
        owner: { role: "owner", count: 720, share: 720 / 1_248 },
        other: { role: "other", count: 528, share: 528 / 1_248 },
      },
    });
    expect(summary.senderFilter).toBe("both");
  });

  it("keeps zero as a valid fact and unavailable evidence distinct from zero", () => {
    const source = structuredClone(annualReport(2024));
    const report = {
      ...source,
      facts: {
        ...source.facts,
        totalMessages: { ...source.facts.totalMessages, value: 0 },
        activeDays: { ...source.facts.activeDays, value: 0 },
        peakMonth: { buckets: source.facts.peakMonth.buckets.map((bucket) => ({ ...bucket, count: 0 })), maxCount: null, ties: [] },
        longestStreak: { length: 0, intervals: [] },
        senderShare: {
          ...source.facts.senderShare,
          denominator: 0,
          owner: { count: 0, share: null },
          other: { count: 0, share: null },
        },
      },
    };
    const summary = createBetaSummaryDtoV1(report);
    const viewModel = presentBetaSummaryZhCN(summary);

    expect(summary.facts.totalMessages).toEqual({ status: "available", value: { count: 0 } });
    expect(summary.facts.activeDays).toEqual({ status: "available", value: { count: 0 } });
    expect(summary.facts.mostActiveMonth).toEqual({ status: "unavailable", value: null, reason: "NO_PEAK_BUCKET" });
    expect(summary.facts.longestStreak).toEqual({ status: "unavailable", value: null, reason: "NO_STREAK" });
    expect(summary.facts.senderComparison).toEqual({ status: "unavailable", value: null, reason: "NO_SENDER_COMPARISON" });
    expect(summary.exportAvailability).toEqual({ status: "unavailable", reason: "NO_USER_MESSAGES" });
    expect(viewModel.metrics.totalMessages).toMatchObject({ status: "available", value: "0" });
    expect(viewModel.metrics.mostActiveMonth).toEqual({ status: "unavailable", value: null, unit: "", detail: "证据不足", label: "最活跃月份" });
    expect(viewModel.senderComparison.status).toBe("unavailable");
  });

  it("rejects NaN, Infinity, and out-of-range shares at the summary boundary", () => {
    const nanSource = structuredClone(annualReport(2024));
    const reportWithNaN = {
      ...nanSource,
      facts: { ...nanSource.facts, peakMonth: { ...nanSource.facts.peakMonth, maxCount: Number.NaN } },
    };
    expect(() => createBetaSummaryDtoV1(reportWithNaN)).toThrow("INVALID_BETA_REPORT_DTO");

    const infinitySource = structuredClone(annualReport(2024));
    const reportWithInfinity = {
      ...infinitySource,
      facts: {
        ...infinitySource.facts,
        senderShare: {
          ...infinitySource.facts.senderShare,
          owner: { ...infinitySource.facts.senderShare.owner, share: Number.POSITIVE_INFINITY },
        },
      },
    };
    expect(() => createBetaSummaryDtoV1(reportWithInfinity)).toThrow("INVALID_BETA_SUMMARY_INPUT");

    const invalidShareSource = structuredClone(annualReport(2024));
    const reportWithInvalidShare = {
      ...invalidShareSource,
      facts: {
        ...invalidShareSource.facts,
        senderShare: {
          ...invalidShareSource.facts.senderShare,
          owner: { ...invalidShareSource.facts.senderShare.owner, share: 1.2 },
        },
      },
    };
    expect(() => createBetaSummaryDtoV1(reportWithInvalidShare)).toThrow("INVALID_BETA_SUMMARY_FACT");

    const valid = createBetaSummaryDtoV1(annualReport(2024));
    const invalid = {
      ...structuredClone(valid),
      facts: {
        ...valid.facts,
        senderComparison: {
          status: "available" as const,
          value: {
            denominator: 1,
            owner: { role: "owner" as const, count: 1, share: Number.NaN },
            other: { role: "other" as const, count: 0, share: 0 },
            filterBehavior: "ignores-global-sender-filter" as const,
          },
        },
      },
    };
    expect(() => validateBetaSummaryDtoV1(invalid)).toThrow("INVALID_BETA_SUMMARY_FACT");
  });
});

describe("Beta B5.1 vocabulary privacy boundary", () => {
  it("defaults vocabulary off and keeps analytical facts identical when explicitly enabled", () => {
    const report = annualReport(2025);
    const off = createBetaSummaryDtoV1(report);
    const on = summaryWithVocabulary(report, true, ["本地版本"]);

    expect(off.vocabulary).toEqual({ mode: "off", items: [] });
    expect(on.vocabulary.mode).toBe("on");
    expect(on.vocabulary.items).toHaveLength(5);
    expect(on.vocabulary.items.map((item) => item.displayRank)).toEqual([1, 2, 3, 4, 5]);
    expect(on.vocabulary.items.map((item) => item.token)).not.toContain("本地版本");
    expect(on.vocabulary.items.some((item) => ["但是", "然后", "所以", "这个", "已经", "就是", "其实", "还有", "the", "and"].includes(item.token))).toBe(false);
    expect(on.facts).toEqual(off.facts);
    expect(on.identity).toEqual(off.identity);
    expect(on.scope).toEqual(off.scope);
  });

  it("never resurfaces custom-hidden or Clean Mode candidates and returns deterministic order", () => {
    const report = annualReport(2025);
    const hidden = ["本地版本", "年度报告", "词云布局"];
    const first = summaryWithVocabulary(report, true, hidden, true);
    const second = summaryWithVocabulary(report, true, hidden, true);

    expect(first).toEqual(second);
    expect(first.vocabulary.mode).toBe("on");
    if (first.vocabulary.mode === "on") {
      expect(first.vocabulary.items.map((item) => item.token)).toEqual([
        "发布计划", "测试矩阵", "界面修订", "离线分析", "范围同步",
      ]);
      expect(first.vocabulary.items.map((item) => item.displayRank)).toEqual([1, 2, 3, 4, 5]);
      expect(first.vocabulary.items).not.toEqual(expect.arrayContaining(hidden.map((token) => ({ displayRank: expect.any(Number), token }))));
    }

    const uncleanSource = visibleWords(2025, hidden, false);
    const cleanSource = visibleWords(2025, hidden, true);
    const unclean = createBetaSummaryDtoV1(report, {
      includeVocabulary: true,
      wordPresentation: uncleanSource,
      expectedWordRole: "both",
      expectedFrequencyDtoKey: uncleanSource.frequencyDtoKey,
    });
    expect(unclean.vocabulary).not.toEqual(first.vocabulary);
    expect(cleanSource.items.slice(0, 7).map((item) => item.displayToken)).toEqual([
      "发布计划", "测试矩阵", "界面修订", "离线分析", "范围同步", "性能记录", "隐私边界",
    ]);
  });

  it("disables the opt-in at zero visible candidates and never exposes full cloud/keyword fields", () => {
    const report = annualReport(2025);
    const frequency = syntheticBetaWordCloudFrequency(2025, "both");
    const allHidden = createWordFrequencyPresentation(
      frequency,
      frequency.items.map((item) => item.normalizedToken),
      "raw-count",
      20,
      true,
    );
    const summary = createBetaSummaryDtoV1(report, {
      includeVocabulary: true,
      wordPresentation: allHidden,
      expectedWordRole: "both",
      expectedFrequencyDtoKey: allHidden.frequencyDtoKey,
    });
    const viewModel = presentBetaSummaryZhCN(summary);

    expect(summary.vocabulary).toEqual({ mode: "unavailable", items: [], reason: "NO_VISIBLE_CANDIDATES" });
    expect(viewModel.vocabulary).toEqual({ mode: "unavailable", label: "当前没有可用词汇摘要", items: [], reason: "NO_VISIBLE_CANDIDATES" });
    expect(JSON.stringify(summary)).not.toMatch(/normalizedToken|sourceRank|fullCloud|distinctive|customHidden|hiddenTokens|frequencyDtoKey/iu);
    expect(JSON.stringify(viewModel)).not.toMatch(/frequencyDtoKey|reportQueryKey|datasetId|generation|sessionThreshold|path|filename|messageBody|contact/iu);
  });

  it("rejects stale query/year/role vocabulary and strips extra private-like metadata", () => {
    const report2025 = annualReport(2025);
    const staleYear = visibleWords(2024);
    expect(() => createBetaSummaryDtoV1(report2025, {
      includeVocabulary: true,
      wordPresentation: staleYear,
      expectedWordRole: "both",
      expectedFrequencyDtoKey: staleYear.frequencyDtoKey,
    })).toThrow("BETA_SUMMARY_FREQUENCY_MISMATCH");

    const owner = visibleWords(2025);
    const ownerPresentation = {
      ...owner,
      role: "owner" as const,
      frequencyDtoKey: syntheticBetaWordCloudFrequency(2025, "owner").identity.frequencyDtoKey,
      sourcePath: "/Users/example/private.json",
      filename: "private.json",
      messageBody: "synthetic body must not pass through",
      contactName: "synthetic contact",
    } as typeof owner;
    expect(() => createBetaSummaryDtoV1(report2025, {
      includeVocabulary: true,
      wordPresentation: ownerPresentation,
      expectedWordRole: "both",
      expectedFrequencyDtoKey: ownerPresentation.frequencyDtoKey,
    })).toThrow("BETA_SUMMARY_FREQUENCY_MISMATCH");

    const safeOwner = {
      ...owner,
      role: "owner" as const,
      frequencyDtoKey: syntheticBetaWordCloudFrequency(2025, "owner").identity.frequencyDtoKey,
      sourcePath: "/Users/example/private.json",
      filename: "private.json",
      messageBody: "synthetic body must not pass through",
      contactName: "synthetic contact",
    } as typeof owner;
    const safeSummary = createBetaSummaryDtoV1(report2025, {
      includeVocabulary: true,
      wordPresentation: safeOwner,
      expectedWordRole: "owner",
      expectedFrequencyDtoKey: safeOwner.frequencyDtoKey,
    });
    expect(JSON.stringify(safeSummary)).not.toContain("private.json");
    expect(JSON.stringify(safeSummary)).not.toContain("synthetic body must not pass through");
    expect(JSON.stringify(safeSummary)).not.toContain("synthetic contact");
  });
});

describe("Beta B5.1 zh-CN share-card presenter", () => {
  it("presents all-years and single-year titles with fixed date/range formatting", () => {
    const allYears = presentBetaSummaryZhCN(createBetaSummaryDtoV1(allYearsReport()));
    const single = presentBetaSummaryZhCN(createBetaSummaryDtoV1(annualReport(2024)));

    expect(allYears.headline).toBe("2024–2025 聊天回顾");
    expect(allYears.rangeLabel).toBe("2024.01.01–2025.12.31");
    expect(allYears.scope.kind).toBe("all-years");
    expect(single.headline).toBe("2024 年聊天回顾");
    expect(single.rangeLabel).toBe("2024.01.01–2024.12.31");
    expect(single.timezoneLabel).toBe("UTC+08:00");
    expect(single.privacyLine).toBe("本地生成 · 不上传");
    expect(single.productSignature).toBe("聊天记录分析");
  });

  it("states partial scope, tied months, unavailable evidence, sender context, and no inference", () => {
    const source = structuredClone(annualReport(2025));
    const report = {
      ...source,
      metadata: {
        ...source.metadata,
        appliedFilters: { ...source.metadata.appliedFilters, sender: "owner" as const },
      },
      facts: {
        ...source.facts,
        peakMonth: {
          ...source.facts.peakMonth,
          maxCount: 138,
          ties: ["2025-06", "2025-09"],
        },
        longestStreak: { length: 0, intervals: [] },
        senderShare: {
          ...source.facts.senderShare,
          denominator: 0,
          owner: { count: 0, share: null },
          other: { count: 0, share: null },
        },
      },
    };
    const viewModel = presentBetaSummaryZhCN(createBetaSummaryDtoV1(report));

    expect(viewModel.partialLabel).toBe("部分日期范围");
    expect(viewModel.metrics.mostActiveMonth.detail).toContain("6 月和9 月并列消息最多");
    expect(viewModel.metrics.longestStreak).toMatchObject({ status: "unavailable", value: null, detail: "证据不足" });
    expect(viewModel.senderComparison).toMatchObject({ status: "unavailable", denominator: null, detail: "证据不足" });
    expect(viewModel.senderFilterContext).toEqual({
      appliedFilterLabel: "仅 Owner",
      disclosure: "当前筛选仅作用于一般消息统计；Owner / Other 比较固定包含双方。",
    });
    expect(JSON.stringify(viewModel)).not.toMatch(/主动|冷淡|在意|亲密|关系质量|心理|人格|情感|依赖|改善|变好|变差/iu);
  });

  it("preserves exact keys and deep-equal determinism for the same facts/preferences", () => {
    const report = annualReport(2024);
    const first = presentBetaSummaryZhCN(summaryWithVocabulary(report, true, ["相册整理"], true));
    const second = presentBetaSummaryZhCN(summaryWithVocabulary(report, true, ["相册整理"], true));

    expect(first).toEqual(second);
    expect(Object.keys(first).sort()).toEqual([
      "exportAvailability", "headline", "locale", "metrics", "partialLabel", "privacyLine", "productSignature", "rangeLabel", "schemaVersion", "scope", "senderComparison", "senderFilterContext", "timezoneLabel", "versions", "vocabulary",
    ]);
    expect(() => validateShareCardViewModelV1(first)).not.toThrow();
    expect(() => validateShareCardViewModelPrivacyV1(first)).not.toThrow();
  });

  it("defensively rejects forbidden renderer fields when a view model is tampered with", () => {
    const viewModel = presentBetaSummaryZhCN(createBetaSummaryDtoV1(annualReport(2024)));
    const leaked = {
      ...viewModel,
      sourcePath: "/Users/example/chat.json",
      queryKey: "synthetic-query-key",
    };
    expect(() => validateShareCardViewModelPrivacyV1(leaked)).toThrow("INVALID_SHARE_CARD_VIEW_MODEL");
  });
});

describe("Beta B5.1 summary type boundary", () => {
  it("does not accept an arbitrary whole-report-shaped object as a share-card model", () => {
    const report = annualReport(2024);
    const summary = createBetaSummaryDtoV1(report);
    const viewModel = presentBetaSummaryZhCN(summary);
    const serialized = JSON.stringify(viewModel);

    expect(serialized).not.toContain("sourceFilename");
    expect(serialized).not.toContain("sourcePath");
    expect(serialized).not.toContain("messageBody");
    expect(serialized).not.toContain("contactName");
    expect(serialized).not.toContain("datasetId");
    expect(serialized).not.toContain("queryKey");
    expect(serialized).not.toContain("sessionThresholdHours");
    expect(serialized).not.toContain("hiddenTokens");
    expect(serialized).not.toContain("generation");
    expect(summary).not.toHaveProperty("report");
    expect(summary).not.toHaveProperty("result");
  });
});
