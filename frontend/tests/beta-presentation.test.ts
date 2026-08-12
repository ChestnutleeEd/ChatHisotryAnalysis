import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BetaAnnualReport } from "../src/presentation/beta/BetaAnnualReport";
import { BetaHome } from "../src/presentation/beta/BetaHome";
import { BetaModeNavigation } from "../src/presentation/beta/BetaModeNavigation";
import {
  BaseCard,
  BetaButton,
  ArtworkFrame,
  MethodologyDisclosure,
  QueryChips,
  ProgressNavigator,
  SkipLink,
} from "../src/presentation/beta/primitives";
import {
  BETA_REPORT_SECTION_IDS,
  BETA_REPORT_SECTIONS,
} from "../src/presentation/beta/report-sections";
import {
  initializeReportPresentationState,
  representedYearOptions,
} from "../src/presentation/beta/report-state";
import {
  BETA_LABEL_CLASSIFICATION,
  SYNTHETIC_BETA_RECAP_FIXTURE,
  type BetaHomeViewModel,
} from "../src/presentation/beta/view-model";
import { buildBetaReportDto } from "../src/presentation/beta/report-adapter";
import { presentBetaReportZhCN } from "../src/presentation/beta/locales/zh-CN";
import { syntheticBetaAnnualReportResult } from "../src/presentation/beta/synthetic-report-fixture";

const noop = () => undefined;
const baseRange = { startDate: "2024-01-01", endDate: "2025-12-31" };
const committedFilters = {
  ...baseRange,
  sender: "both" as const,
  selectedYear: null,
  sessionThresholdHours: 6 as const,
};
const reportState = initializeReportPresentationState({
  datasetSessionKey: "synthetic-session:synthetic-dataset:1",
  committedFilters,
  datasetRange: baseRange,
  representedYears: [2024, 2025],
});
const queryChips = SYNTHETIC_BETA_RECAP_FIXTURE.queryChips;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05);
}

describe("Beta B1a shared presentation semantics", () => {
  it("renders semantic card variants and disabled/loading button states", () => {
    const card = renderToStaticMarkup(createElement(BaseCard, {
      variant: "hero",
      children: "年度回顾",
    }));
    expect(card).toContain("beta-card-hero");
    expect(card).toContain('data-surface-role="report"');

    const button = renderToStaticMarkup(createElement(BetaButton, {
      variant: "primary",
      loading: true,
      children: "查看年度聊天报告",
    }));
    expect(button).toContain("beta-button-primary");
    expect(button).toContain("disabled");
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain("处理中");
  });

  it("renders read-only query chips and an accessible native methodology disclosure", () => {
    const chips = renderToStaticMarkup(createElement(QueryChips, { chips: queryChips }));
    expect(chips).toContain('aria-label="当前已提交分析范围"');
    expect(chips).not.toContain("<button");
    expect(chips).toContain("UTC+08");

    const disclosure = renderToStaticMarkup(createElement(
      MethodologyDisclosure,
      { summary: "范围与定义", chips: ["本地聚合"], children: "完整方法" },
    ));
    expect(disclosure).toContain("<details");
    expect(disclosure).toContain("<summary");
    expect(disclosure).toContain("完整方法");
  });

  it("keeps shell skip navigation and decorative artwork measurable", () => {
    const skipLink = renderToStaticMarkup(createElement(SkipLink));
    expect(skipLink).toContain('href="#beta-main-content"');

    const artwork = renderToStaticMarkup(createElement(ArtworkFrame, {
      src: "/synthetic-art.webp",
      width: 1536,
      height: 1024,
    }));
    expect(artwork).toContain('alt=""');
    expect(artwork).toContain('aria-hidden="true"');
    expect(artwork).toContain('width="1536"');
    expect(artwork).toContain('height="1024"');
  });

  it("classifies engineering identities away from the primary user surface", () => {
    expect(BETA_LABEL_CLASSIFICATION.scope).toBe("USER_VISIBLE");
    expect(BETA_LABEL_CLASSIFICATION.methodology).toBe("METHOD_ONLY");
    expect(BETA_LABEL_CLASSIFICATION.generation).toBe("DEVELOPER_ONLY");
    expect(BETA_LABEL_CLASSIFICATION.queryKey).toBe("DEVELOPER_ONLY");
    expect(BETA_LABEL_CLASSIFICATION.schema).toBe("DEVELOPER_ONLY");
    expect(BETA_LABEL_CLASSIFICATION.workerDto).toBe("DEVELOPER_ONLY");
  });
});

describe("Beta B1a Home and navigation", () => {
  const homeViewModel: BetaHomeViewModel = {
    heading: "你的本地聊天回顾已经准备好",
    lead: "先从年度故事浏览，再进入详细分析。",
    scopeLabel: "2024-01-01 – 2025-12-31",
    messageCountLabel: "1,248 条用户消息",
    representedYears: representedYearOptions([2024, 2025], baseRange),
    defaultYear: 2025,
    empty: false,
    queryChips,
  };

  it("keeps the recap CTA primary and Detailed Analysis secondary", () => {
    const html = renderToStaticMarkup(createElement(BetaHome, {
      viewModel: homeViewModel,
      pending: false,
      onOpenRecap: noop,
      onOpenDetailed: noop,
      onRestoreFullRange: noop,
    }));
    expect(html).toContain("beta-home");
    expect(html).toMatch(/beta-button-primary[^>]*><span[^>]*>查看年度聊天报告/u);
    expect(html).toMatch(/beta-button-secondary[^>]*><span[^>]*>进入详细分析/u);
    expect(html).toContain("本地处理 · 不上传");
    expect(html).not.toMatch(/generation|queryKey|schema|DTO|Worker/iu);
  });

  it("presents Home separately from the peer Annual Recap and Detailed modes", () => {
    const html = renderToStaticMarkup(createElement(BetaModeNavigation, {
      mode: "annual-recap",
      onModeChange: noop,
    }));
    expect(html).toContain('aria-label="产品模式"');
    expect(html).toContain("首页");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("年度回顾");
    expect(html).toContain("详细分析");
  });
});

describe("Beta B1a annual report skeleton", () => {
  it("keeps all sixteen stable logical section IDs in fixed order", () => {
    expect(BETA_REPORT_SECTION_IDS).toHaveLength(16);
    expect(BETA_REPORT_SECTIONS.map((section) => section.id)).toEqual(BETA_REPORT_SECTION_IDS);
    expect(BETA_REPORT_SECTIONS.map((section) => section.order)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect(new Set(BETA_REPORT_SECTIONS.map((section) => section.scene)).size).toBeLessThan(16);
  });

  it("renders synthetic hero, metric, narrative, registry, headings, privacy, and methodology", () => {
    const html = renderToStaticMarkup(createElement(BetaAnnualReport, {
      viewModel: SYNTHETIC_BETA_RECAP_FIXTURE,
      reportState,
      representedYears: representedYearOptions([2024, 2025], baseRange),
      selectedSection: "opening",
      pending: false,
      onRangeChange: noop,
      onSectionChange: noop,
      onRestoreFullRange: noop,
      onOpenDetailed: noop,
    }));
    expect(html).toContain('data-fixture-kind="synthetic-automated-test"');
    expect(html).toContain("自动化合成测试");
    expect(html).toContain("beta-card-hero");
    expect(html).toContain("beta-card-metric");
    expect(html).toContain("beta-card-narrative");
    expect(html).toContain("beta-card-privacy");
    expect(html).toContain("下一节：消息");
    expect(html).toContain('data-v3-annual-report="true"');
    expect(html).toContain('data-v3-layout-mode="asymmetric"');
    expect(html).toContain('aria-label="年度报告阅读导航"');
    expect(html).toContain('class="v3-range-toggle"');
    expect(html.match(/data-delivery-slot=/gu)).toHaveLength(16);
    expect(html).toContain("<h1");
    expect(html.match(/<h2/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain("16 个 full-screen");
  });

  it("defines scoped responsive/focus/static reduced-motion CSS contracts", () => {
    const entryCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/presentation/beta/styles.css", import.meta.url), "utf8");
    const foundationCss = readFileSync(new URL("../src/presentation/beta/styles/foundation.css", import.meta.url), "utf8");
    const annualCss = readFileSync(new URL("../src/presentation/beta/styles/annual.css", import.meta.url), "utf8");
    const motionCss = readFileSync(new URL("../src/presentation/beta/styles/motion.css", import.meta.url), "utf8");
    expect(entryCss).toContain('@import "./presentation/beta/styles.css";');
    expect(entryCss).toContain('@import "./presentation/beta/styles/foundation.css";');
    expect(entryCss).toContain('@import "./presentation/beta/styles/annual.css";');
    expect(entryCss).toContain('@import "./presentation/beta/styles/motion.css";');
    expect(css).toContain(".desktop-app.beta-enabled {");
    expect(css).toContain("--beta-color-canvas: #F3F4F2");
    expect(css).toContain("--beta-color-report: #F7F3EA");
    expect(css).toContain("--beta-color-primary: #1F4D3F");
    expect(css).toContain("--beta-radius-art: 24px");
    expect(css).toContain("--beta-depth-raised:");
    expect(css).toContain("grid-template-columns: minmax(0, 7fr) minmax(280px, 5fr)");
    expect(css).toContain(".beta-artwork-frame");
    expect(css).toContain("font-size: clamp(48px, 5.6vw, 72px)");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(".desktop-app.beta-enabled .beta-button");
    expect(css).toContain(".desktop-app.beta-enabled .beta-button:disabled");
    expect(css).toContain(".desktop-app.beta-enabled button:focus-visible");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (max-width: 599px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("scroll-behavior: auto !important");
    expect(foundationCss).toContain("--v3-canvas: #E8DCC7");
    expect(foundationCss).toContain("--v3-workspace-signal: #002FA7");
    expect(foundationCss).toContain("grid-template-columns: repeat(12, minmax(0, 1fr))");
    expect(foundationCss).toContain("align-items: start");
    expect(annualCss).toContain("width: 100%");
    expect(annualCss).toContain("max-width: 720px");
    expect(annualCss).toContain("position: sticky");
    expect(annualCss).toContain("scroll-margin-top");
    expect(annualCss).toContain("@media (max-width: 599px)");
    expect(motionCss).toContain("--motion-scene: 520ms");
    expect(motionCss).toContain("transform: translateY(12px)");
    expect(motionCss).toContain("animation: none !important");
    expect(motionCss).not.toContain("transition: all");
  });

  it("renders the seven-step navigator with labeled native controls", () => {
    const html = renderToStaticMarkup(createElement(ProgressNavigator, {
      items: [
        { key: "opening", label: "开场", section: "opening" },
        { key: "scale", label: "规模", section: "messages" },
        { key: "rhythm", label: "节奏", section: "peak-month" },
        { key: "balance", label: "平衡", section: "sender-share" },
        { key: "conversation", label: "交流", section: "sessions" },
        { key: "vocabulary", label: "词汇", section: "frequent-words" },
        { key: "closing", label: "收束", section: "summary-share" },
      ],
      selectedSection: "opening",
      rangeValue: "all-years",
      rangeOptions: [{ value: "all-years", label: "全部年份" }],
      sectionOptions: [{ value: "opening", label: "01 · 开场" }],
      pending: false,
      onRangeChange: noop,
      onSectionChange: noop,
      onRestoreFullRange: noop,
    }));
    expect(html).toContain('data-v3-navigator="annual"');
    expect(html).toContain('aria-label="第 1 场：开场"');
    expect(html).toContain('aria-label="第 7 场：收束"');
    expect(html).toContain(">范围与章节</button>");
    expect(html).toContain('aria-controls="annual-range-controls"');
    expect(html).not.toContain('id="annual-range-controls"');
  });

  it("keeps primary, privacy, success, focus, and disabled pairs above their frozen contrast floors", () => {
    expect(contrastRatio("#FFFFFF", "#1F4D3F")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#276749", "#E9F1ED")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#1F4D3F", "#E9F1ED")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#005FCC", "#F3F4F2")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#737A74", "#ECEDE9")).toBeGreaterThanOrEqual(3);
  });
});

describe("Beta B2 core report composition", () => {
  it("renders localized sections 1–12 with exact table alternatives and honest B3/B4 gaps", () => {
    const result = syntheticBetaAnnualReportResult(2025);
    const viewModel = presentBetaReportZhCN(buildBetaReportDto(result, { mode: "annual", year: 2025 }));
    const html = renderToStaticMarkup(createElement(BetaAnnualReport, {
      viewModel,
      reportState,
      representedYears: representedYearOptions([2024, 2025], baseRange),
      selectedSection: "opening",
      pending: false,
      onRangeChange: noop,
      onSectionChange: noop,
      onRestoreFullRange: noop,
      onOpenDetailed: noop,
    }));
    expect(html).toContain('data-beta-mode="annual-recap"');
    expect(html).toContain("这一范围共有 1,248 条用户消息");
    expect(html).toContain("星期一和星期二");
    expect(html).toContain("按星期一至星期日排列的消息数量");
    expect(html).toContain("尚未提供");
    expect(html).toContain("UTC+08:00");
    expect(html).toContain("beta-core-scene-heading");
    expect(html).toContain("beta-core-visual-details");
    expect(html).not.toContain("beta-status-success");
    expect(html).not.toMatch(/<details[^>]+open(?:=|\s|>)/u);
    for (const id of BETA_REPORT_SECTION_IDS.slice(0, 12)) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toContain("canonical-event");
    expect(html).not.toContain("messageBodies");
  });
});
