import { validateCanonicalAnalyticsResult } from "../worker-analysis/analytics-contract";
import {
  SESSION_THRESHOLD_HOURS,
  type CanonicalAnalysisFilters,
  type CanonicalAnalysisResult,
  type CanonicalDatasetSummary,
  type SessionThresholdHours,
} from "../worker-analysis/analytics-contract";
import type { CanonicalMessageCategory } from "../canonical-v2/schema";

export const DASHBOARD_ROUTES = [
  "Overview",
  "Trends",
  "Comparison",
  "Activity",
  "Words & Years",
  "Message Types",
  "Replies & Sessions",
  "Export",
] as const;

export type DashboardRoute = (typeof DASHBOARD_ROUTES)[number];

export const DASHBOARD_ROUTE_LABELS: Readonly<Record<DashboardRoute, string>> = {
  Overview: "概览",
  Trends: "趋势",
  Comparison: "双方比较",
  Activity: "活跃时间",
  "Words & Years": "词汇与年份",
  "Message Types": "消息类型",
  "Replies & Sessions": "回复与会话",
  Export: "导出",
};

export const ROUTE_DESCRIPTIONS: Readonly<Record<DashboardRoute, string>> = {
  Overview: "高层摘要与当前结果范围",
  Trends: "日、月、年消息趋势",
  Comparison: "发送方数量与文本长度比较",
  Activity: "小时、星期与连续聊天日",
  "Words & Years": "跨年词汇、年度关键词与固定摘要",
  "Message Types": "消息类别和符合条件文字统计",
  "Replies & Sessions": "回复间隔、会话与开场次数",
  Export: "当前聚合结果的本地导出预览",
};

export type FilterErrors = Readonly<{
  startDate?: string;
  endDate?: string;
  range?: string;
  selectedYear?: string;
  sessionThresholdHours?: string;
}>;

export interface DashboardFilterValidation {
  readonly filters?: CanonicalAnalysisFilters;
  readonly errors: FilterErrors;
}

export interface DashboardViewModel {
  readonly result: CanonicalAnalysisResult;
  readonly correlation: {
    readonly generation: number;
    readonly queryKey: string;
  };
  readonly scopeLabel: string;
  readonly senderLabel: string;
  readonly yearOptions: readonly number[];
  readonly overview: {
    readonly selectedUserMessages: number;
    readonly totalChatDays: number;
    readonly longestStreakLength: number;
    readonly ownerShare: number | null;
    readonly otherShare: number | null;
    readonly replyMedians: readonly {
      readonly responder: "owner" | "other";
      readonly seconds: number | null;
      readonly count: number;
    }[];
    readonly initiators: readonly {
      readonly initiator: "owner" | "other" | "unknown";
      readonly count: number;
      readonly share: number | null;
    }[];
    readonly leadingTypes: readonly {
      readonly category: CanonicalMessageCategory;
      readonly count: number;
      readonly share: number | null;
    }[];
  };
  readonly wordRanking: readonly {
    readonly token: string;
    readonly count: number;
    readonly ratePer10000: number;
  }[];
  readonly activeKeywordYear: {
    readonly year: number;
    readonly partial: boolean;
    readonly mode: string;
    readonly omissionReason: string | null;
    readonly keywords: CanonicalAnalysisResult["stage7"]["yearlyKeywords"]["years"][number]["keywords"];
  } | undefined;
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}

export function formatShare(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(1)}%`;
}

export function formatSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 60) {
    return `${value.toFixed(0)} 秒`;
  }
  if (value < 3_600) {
    return `${(value / 60).toFixed(1)} 分钟`;
  }
  return `${(value / 3_600).toFixed(1)} 小时`;
}

export function formatMetricValue(value: number | null, fractionDigits = 2): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: fractionDigits });
}

export function senderLabel(sender: CanonicalAnalysisFilters["sender"]): string {
  if (sender === "owner") {
    return "仅 owner";
  }
  if (sender === "other") {
    return "仅 other";
  }
  return "owner 与 other";
}

export function categoryLabel(category: CanonicalMessageCategory): string {
  const labels: Partial<Record<CanonicalMessageCategory, string>> = {
    text: "文字",
    image: "图片",
    voice: "语音",
    video: "视频",
    file: "文件",
    "animated-emoji": "动态表情",
    structured: "结构化消息",
    location: "位置",
    call: "通话",
    "mini-program": "小程序",
    reply: "回复引用",
    "contact-card": "名片",
    system: "系统诊断",
    other: "其他",
    unknown: "未知类别",
  };
  return labels[category] ?? "未知类别";
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((value) => value.codePointAt(0) ?? 0);
  const rightPoints = [...right].map((value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index] ?? 0;
    const rightPoint = rightPoints[index] ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }
  return leftPoints.length - rightPoints.length;
}

export function isCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}

export function validateDashboardFilters(
  draft: CanonicalAnalysisFilters,
  dataset: Pick<CanonicalDatasetSummary, "minimumCalendarDate" | "maximumCalendarDate">,
): DashboardFilterValidation {
  const errors: {
    startDate?: string;
    endDate?: string;
    range?: string;
    selectedYear?: string;
    sessionThresholdHours?: string;
  } = {};
  if (!isCalendarDate(draft.startDate)) {
    errors.startDate = "请输入有效的开始日期。";
  } else if (draft.startDate < dataset.minimumCalendarDate) {
    errors.startDate = "开始日期不能早于当前数据范围。";
  }
  if (!isCalendarDate(draft.endDate)) {
    errors.endDate = "请输入有效的结束日期。";
  } else if (draft.endDate > dataset.maximumCalendarDate) {
    errors.endDate = "结束日期不能晚于当前数据范围。";
  }
  if (
    isCalendarDate(draft.startDate) &&
    isCalendarDate(draft.endDate) &&
    draft.startDate > draft.endDate
  ) {
    errors.range = "开始日期不能晚于结束日期。";
  }
  if (
    draft.selectedYear !== null &&
    (!Number.isSafeInteger(draft.selectedYear) || draft.selectedYear < 1 || draft.selectedYear > 9999)
  ) {
    errors.selectedYear = "年份必须是有效的四位数字。";
  }
  if (!SESSION_THRESHOLD_HOURS.includes(draft.sessionThresholdHours as SessionThresholdHours)) {
    errors.sessionThresholdHours = "请选择受支持的会话阈值。";
  }
  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { filters: draft, errors };
}

export function routeIndex(route: DashboardRoute): number {
  return DASHBOARD_ROUTES.indexOf(route);
}

export function routeAt(index: number): DashboardRoute {
  const normalized = (index + DASHBOARD_ROUTES.length) % DASHBOARD_ROUTES.length;
  return DASHBOARD_ROUTES[normalized] ?? "Overview";
}

export function createDashboardViewModel(
  value: CanonicalAnalysisResult,
): DashboardViewModel {
  const result = validateCanonicalAnalyticsResult(value);
  const keywordYears = result.stage7.yearlyKeywords.years;
  const activeYear = result.stage7.yearlyKeywords.activeYear;
  const activeKeywordYear =
    activeYear === null
      ? undefined
      : keywordYears.find((year) => year.year === activeYear);
  const wordCounts = new Map<string, number>();
  for (const year of result.stage7.wordEvolution.years) {
    for (const cell of year.values) {
      wordCounts.set(cell.token, (wordCounts.get(cell.token) ?? 0) + cell.count);
    }
  }
  const totalTokenCount = result.stage7.wordEvolution.years.reduce(
    (total, year) => total + year.totalTokenCount,
    0,
  );
  const wordRanking = [...wordCounts.entries()]
    .sort((left, right) => right[1] - left[1] || compareCodePoints(left[0], right[0]))
    .map(([token, count]) => ({
      token,
      count,
      ratePer10000: totalTokenCount === 0 ? 0 : (count * 10_000) / totalTokenCount,
    }));
  const replyMedians = result.replySessions.replyIntervals.directions.map((direction) => ({
    responder: direction.responder,
    seconds: direction.stats.medianSeconds,
    count: direction.stats.count,
  }));
  const initiators = [
    result.replySessions.conversationSessions.initiatorCounts.owner,
    result.replySessions.conversationSessions.initiatorCounts.other,
    result.replySessions.conversationSessions.initiatorCounts.unknown,
  ];
  const leadingTypes = [...result.stage7.messageTypes.categories]
    .filter((bucket) => bucket.count > 0)
    .slice(0, 5);
  return {
    result,
    correlation: {
      generation: result.generation,
      queryKey: result.queryKey,
    },
    scopeLabel: `${result.filters.startDate} → ${result.filters.endDate} · ${senderLabel(result.filters.sender)} · UTC+08:00`,
    senderLabel: senderLabel(result.filters.sender),
    yearOptions: result.stage7.wordEvolution.years.map((year) => year.year),
    overview: {
      selectedUserMessages: result.aggregate.userMessageCount,
      totalChatDays: result.activity.chatActivity.totalChatDays,
      longestStreakLength: result.activity.chatActivity.longestStreakLength,
      ownerShare: result.activity.senderComparison.owner.share,
      otherShare: result.activity.senderComparison.other.share,
      replyMedians,
      initiators,
      leadingTypes,
    },
    wordRanking,
    activeKeywordYear,
  };
}

export function comparativeScopeNotice(): string {
  return "比较、回复和会话开场次数固定同时包含 Owner 与 Other；全局发送方筛选不适用于这些指标。";
}

export function methodologyFacts(): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: "处理位置", value: "所有处理均在本地完成；应用不会上传聊天记录，也不会自动发现文件。" },
    { label: "数据来源", value: "统计只基于用户主动选择的源文件；多个年度源会验证、合并、排序并确定性去重。" },
    { label: "日期与时区", value: "日期使用固定 UTC+08:00；日期筛选包含开始和结束日期。" },
    { label: "会话规则", value: "会话阈值会影响会话、回复和开场次数；回复间隔只描述时间差。" },
    { label: "解读边界", value: "关键词和年度摘要是确定性的本地统计，不是情感、关系质量或心理推断。" },
  ];
}

export function methodologyCopy(): readonly string[] {
  return methodologyFacts().map((fact) => fact.value);
}
