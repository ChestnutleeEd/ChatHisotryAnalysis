import type {
  CanonicalAnalysisFilters,
  CanonicalAnalysisResult,
  CanonicalDatasetSummary,
} from "../../worker-analysis/analytics-contract";
import {
  defaultRepresentedYear,
  representedYearOptions,
  representedYearsFromBuckets,
  type BetaReportSelection,
  type DateRange,
  type RepresentedYearOption,
} from "./report-state";

export type BetaLabelClass = "USER_VISIBLE" | "METHOD_ONLY" | "DEVELOPER_ONLY";

export const BETA_LABEL_CLASSIFICATION = {
  scope: "USER_VISIBLE",
  sender: "USER_VISIBLE",
  timezone: "USER_VISIBLE",
  sessionThreshold: "USER_VISIBLE",
  methodology: "METHOD_ONLY",
  generation: "DEVELOPER_ONLY",
  queryKey: "DEVELOPER_ONLY",
  schema: "DEVELOPER_ONLY",
  workerDto: "DEVELOPER_ONLY",
} as const satisfies Readonly<Record<string, BetaLabelClass>>;

export interface QueryChipViewModel {
  readonly id: "date" | "sender" | "timezone" | "session" | "filtered";
  readonly label: string;
  readonly tone?: "default" | "accent";
}

export interface BetaHomeViewModel {
  readonly heading: string;
  readonly lead: string;
  readonly scopeLabel: string;
  readonly scopeStatusLabel: string;
  readonly messageCountLabel: string;
  readonly representedYears: readonly RepresentedYearOption[];
  readonly latestRepresentedYear?: number;
  readonly defaultYear?: number;
  readonly empty: boolean;
  readonly queryChips: readonly QueryChipViewModel[];
}

export interface BetaRecapSkeletonViewModel {
  readonly fixtureKind: "committed-aggregate" | "synthetic-automated-test";
  readonly scopeLabel: string;
  readonly displayYear: string;
  readonly headline: string;
  readonly metricLabel: string;
  readonly metricValue: string;
  readonly metricUnit: string;
  readonly metricDefinition: string;
  readonly narrative: string;
  readonly queryChips: readonly QueryChipViewModel[];
  readonly empty: boolean;
}

function senderChip(filters: CanonicalAnalysisFilters): string {
  if (filters.sender === "owner") {
    return "仅 owner";
  }
  if (filters.sender === "other") {
    return "仅 other";
  }
  return "双方";
}

export function createQueryChips(
  filters: CanonicalAnalysisFilters,
  dataset: Pick<CanonicalDatasetSummary, "minimumCalendarDate" | "maximumCalendarDate">,
): readonly QueryChipViewModel[] {
  const dateLabel = filters.selectedYear === null
    ? `${filters.startDate} – ${filters.endDate}`
    : `${filters.selectedYear} 年`;
  const filtered =
    filters.startDate !== dataset.minimumCalendarDate ||
    filters.endDate !== dataset.maximumCalendarDate ||
    filters.sender !== "both" ||
    filters.selectedYear !== null ||
    filters.sessionThresholdHours !== 6;
  return [
    { id: "date", label: dateLabel, tone: "accent" },
    { id: "sender", label: senderChip(filters) },
    { id: "timezone", label: "UTC+08" },
    { id: "session", label: `会话 ${filters.sessionThresholdHours}h` },
    ...(filtered ? [{ id: "filtered" as const, label: "已筛选" }] : []),
  ];
}

export function createBetaHomeViewModel(
  result: CanonicalAnalysisResult,
  reportBaseRange: DateRange,
  representedYears: readonly number[] = representedYearsFromBuckets(result.activity.trends.yearly),
): BetaHomeViewModel {
  const yearOptions = representedYearOptions(representedYears, reportBaseRange);
  const defaultYear = defaultRepresentedYear(yearOptions)?.year;
  const empty = result.aggregate.userMessageCount === 0;
  const filtered =
    result.filters.startDate !== result.dataset.minimumCalendarDate ||
    result.filters.endDate !== result.dataset.maximumCalendarDate ||
    result.filters.sender !== "both" ||
    result.filters.selectedYear !== null ||
    result.filters.sessionThresholdHours !== 6;
  return {
    heading: empty ? "当前范围没有可回顾的用户消息" : "你的本地聊天回顾已经准备好",
    lead: empty
      ? "可以恢复全部数据范围，或重新选择文件后再开始年度报告。"
      : "先查看年度报告，再按需要进入详细分析。",
    scopeLabel: `${result.filters.startDate} – ${result.filters.endDate}`,
    scopeStatusLabel: filtered ? "已筛选范围" : "完整数据范围",
    messageCountLabel: `${result.aggregate.userMessageCount.toLocaleString("zh-CN")} 条用户消息`,
    representedYears: yearOptions,
    latestRepresentedYear: empty ? undefined : yearOptions[yearOptions.length - 1]?.year,
    defaultYear,
    empty,
    queryChips: createQueryChips(result.filters, result.dataset),
  };
}

function selectionLabel(selection: BetaReportSelection, range: DateRange): string {
  if (selection.kind === "year") {
    return `${selection.year} 年`;
  }
  if (selection.kind === "multi-year-overview") {
    return "多年度总览";
  }
  return `${range.startDate.slice(0, 4)}–${range.endDate.slice(0, 4)}`;
}

export function createBetaRecapSkeletonViewModel(
  result: CanonicalAnalysisResult,
  selection: BetaReportSelection,
  reportBaseRange: DateRange,
): BetaRecapSkeletonViewModel {
  const count = result.aggregate.userMessageCount;
  const displayYear = selectionLabel(selection, reportBaseRange);
  return {
    fixtureKind: "committed-aggregate",
    scopeLabel: `${result.filters.startDate} – ${result.filters.endDate}`,
    displayYear,
    headline:
      count === 0
        ? "当前提交范围没有用户消息，报告不会用其他年份的数据填补。"
        : `当前提交范围共有 ${count.toLocaleString("zh-CN")} 条用户消息。`,
    metricLabel: "用户消息",
    metricValue: count.toLocaleString("zh-CN"),
    metricUnit: "条",
    metricDefinition: "合并并确定性去重后，当前已提交范围内的用户消息。",
    narrative: "报告只读取已提交的本地聚合结果；章节切换不会重新读取源文件。",
    queryChips: createQueryChips(result.filters, result.dataset),
    empty: count === 0,
  };
}

export const SYNTHETIC_BETA_RECAP_FIXTURE: BetaRecapSkeletonViewModel = {
  fixtureKind: "synthetic-automated-test",
  scopeLabel: "2024-01-01 – 2025-12-31",
  displayYear: "2025 年",
  headline: "这是仅供自动化与合成测试使用的年度回顾。",
  metricLabel: "合成用户消息",
  metricValue: "1,248",
  metricUnit: "条",
    metricDefinition: "数值来自公开合成测试，不代表任何真实聊天记录。",
  narrative: "此 fixture 只验证信息架构、语义和响应式布局。",
  queryChips: [
    { id: "date", label: "2025 年", tone: "accent" },
    { id: "sender", label: "双方" },
    { id: "timezone", label: "UTC+08" },
    { id: "session", label: "会话 6h" },
  ],
  empty: false,
};
