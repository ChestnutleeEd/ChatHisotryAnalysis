import {
  BETA_REPORT_TIMEZONE,
  type BetaReportDtoV1,
} from "./report-contract";
import {
  SHARE_CARD_ART_VERSION,
  SHARE_CARD_COPY_VERSION,
  SHARE_CARD_LAYOUT_VERSION,
  SHARE_CARD_RENDERER_VERSION,
  SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION,
  type BetaSummaryDtoV1,
  type BetaSummaryFactV1,
  type BetaSummaryMonthFactV1,
  type BetaSummarySenderComparisonV1,
  type BetaSummaryStreakFactV1,
  type ShareCardMetricViewModelV1,
  type ShareCardSenderComparisonViewModelV1,
  type ShareCardVocabularyViewModelV1,
  type ShareCardViewModelV1,
  validateBetaSummaryDtoV1,
  validateShareCardViewModelV1,
} from "./summary-contract";

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
  useGrouping: true,
});
const percentFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  useGrouping: true,
});

const FORBIDDEN_INFERENCE_PATTERN = /主动|冷淡|在意|亲密|关系质量|心理|人格|情感|依赖|说明你们|说明对方|感情升温|改善|变好|变差/iu;

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

function formatPercent(value: number): string {
  return `${percentFormatter.format(value * 100)}%`;
}

function formatDate(value: string): string {
  return value.replaceAll("-", ".");
}

function formatDateRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)}–${formatDate(endDate)}`;
}

function formatMonthKey(key: string, allYears: boolean): string {
  const year = key.slice(0, 4);
  const month = Number(key.slice(5, 7));
  return allYears ? `${year} 年 ${month} 月` : `${month} 月`;
}

function joinChinese(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]}和${values[1]}`;
  }
  return `${values.slice(0, -1).join("、")}和${values.at(-1)}`;
}

function metric<T>(
  fact: BetaSummaryFactV1<T>,
  label: string,
  render: (value: T) => { readonly value: string; readonly unit: string; readonly detail: string },
): ShareCardMetricViewModelV1 {
  if (fact.status === "unavailable") {
    return {
      status: "unavailable",
      label,
      value: null,
      unit: "",
      detail: "证据不足",
    };
  }
  const rendered = render(fact.value);
  return {
    status: "available",
    label,
    value: rendered.value,
    unit: rendered.unit,
    detail: rendered.detail,
  };
}

function totalMessagesMetric(dto: BetaSummaryDtoV1): ShareCardMetricViewModelV1 {
  return metric(dto.facts.totalMessages, "用户消息", (value) => ({
    value: formatCount(value.count),
    unit: "条",
    detail: `这一范围共有 ${formatCount(value.count)} 条用户消息。`,
  }));
}

function activeDaysMetric(dto: BetaSummaryDtoV1): ShareCardMetricViewModelV1 {
  return metric(dto.facts.activeDays, "聊天日", (value) => ({
    value: formatCount(value.count),
    unit: "天",
    detail: `这一范围内有 ${formatCount(value.count)} 个聊天日。`,
  }));
}

function mostActiveMonthMetric(dto: BetaSummaryDtoV1): ShareCardMetricViewModelV1 {
  const allYears = dto.scope.kind === "all-years";
  return metric(dto.facts.mostActiveMonth, "最活跃月份", (value: BetaSummaryMonthFactV1) => {
    const months = value.monthKeys.map((key) => formatMonthKey(key, allYears));
    const monthLabel = joinChinese(months);
    return {
      value: monthLabel,
      unit: "",
      detail: months.length === 1
        ? `${monthLabel}是这一范围消息最多的月份，共 ${formatCount(value.messageCount)} 条。`
        : `${monthLabel}并列消息最多，共 ${formatCount(value.messageCount)} 条。`,
    };
  });
}

function longestStreakMetric(dto: BetaSummaryDtoV1): ShareCardMetricViewModelV1 {
  return metric(dto.facts.longestStreak, "最长连续聊天", (value: BetaSummaryStreakFactV1) => {
    const intervals = value.intervals.map((interval) => formatDateRange(interval.startDate, interval.endDate));
    return {
      value: formatCount(value.length),
      unit: "天",
      detail: intervals.length === 1
        ? `最长连续聊天区间为 ${intervals[0]}，持续 ${formatCount(value.length)} 天。`
        : `最长连续聊天区间为 ${joinChinese(intervals)}，均持续 ${formatCount(value.length)} 天。`,
    };
  });
}

function senderFilterLabel(sender: BetaReportDtoV1["metadata"]["appliedFilters"]["sender"]): string {
  return sender === "both" ? "双方" : sender === "owner" ? "仅 Owner" : "仅 Other";
}

function senderFilterDisclosure(sender: BetaReportDtoV1["metadata"]["appliedFilters"]["sender"]): string | null {
  return sender === "both"
    ? null
    : "当前筛选仅作用于一般消息统计；Owner / Other 比较固定包含双方。";
}

function senderComparison(dto: BetaSummaryDtoV1): ShareCardSenderComparisonViewModelV1 {
  const fact = dto.facts.senderComparison;
  if (fact.status === "unavailable") {
    return {
      status: "unavailable",
      owner: { label: "Owner", count: null, share: null },
      other: { label: "Other", count: null, share: null },
      denominator: null,
      detail: "证据不足",
    };
  }
  const value: BetaSummarySenderComparisonV1 = fact.value;
  return {
    status: "available",
    owner: {
      label: "Owner",
      count: formatCount(value.owner.count),
      share: formatPercent(value.owner.share),
    },
    other: {
      label: "Other",
      count: formatCount(value.other.count),
      share: formatPercent(value.other.share),
    },
    denominator: formatCount(value.denominator),
    detail: "Owner / Other 使用匿名角色；双方比较固定包含双方。",
  };
}

function headline(dto: BetaSummaryDtoV1): string {
  if (dto.scope.kind === "single-year") {
    return `${dto.scope.year} 年聊天回顾`;
  }
  const startYear = dto.scope.startDate.slice(0, 4);
  const endYear = dto.scope.endDate.slice(0, 4);
  return startYear === endYear
    ? `${startYear} 年聊天回顾`
    : `${startYear}–${endYear} 聊天回顾`;
}

function vocabulary(dto: BetaSummaryDtoV1): ShareCardVocabularyViewModelV1 {
  if (dto.vocabulary.mode === "off") {
    return { mode: "off", label: "未包含词汇摘要", items: [] };
  }
  if (dto.vocabulary.mode === "unavailable") {
    return {
      mode: "unavailable",
      label: "当前没有可用词汇摘要",
      items: [],
      reason: "NO_VISIBLE_CANDIDATES",
    };
  }
  return {
    mode: "on",
    label: "常见词包括",
    items: dto.vocabulary.items.map((item) => ({
      displayRank: item.displayRank,
      token: item.token,
    })),
  };
}

export function presentBetaSummaryZhCN(dto: BetaSummaryDtoV1): ShareCardViewModelV1 {
  validateBetaSummaryDtoV1(dto);
  const viewModel: ShareCardViewModelV1 = {
    schemaVersion: SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION,
    locale: "zh-CN",
    scope: dto.scope.kind === "single-year"
      ? {
          kind: "single-year",
          year: dto.scope.year,
          startDate: dto.scope.startDate,
          endDate: dto.scope.endDate,
          partial: dto.scope.partial,
        }
      : {
          kind: "all-years",
          year: null,
          startDate: dto.scope.startDate,
          endDate: dto.scope.endDate,
          partial: dto.scope.partial,
        },
    headline: headline(dto),
    rangeLabel: formatDateRange(dto.scope.startDate, dto.scope.endDate),
    partialLabel: dto.scope.partial ? "部分日期范围" : null,
    senderFilterContext: {
      appliedFilterLabel: senderFilterLabel(dto.senderFilter),
      disclosure: senderFilterDisclosure(dto.senderFilter),
    },
    metrics: {
      totalMessages: totalMessagesMetric(dto),
      activeDays: activeDaysMetric(dto),
      mostActiveMonth: mostActiveMonthMetric(dto),
      longestStreak: longestStreakMetric(dto),
    },
    senderComparison: senderComparison(dto),
    vocabulary: vocabulary(dto),
    exportAvailability: dto.exportAvailability.status === "ready"
      ? { status: "ready", reason: null }
      : { status: "unavailable", reason: "NO_USER_MESSAGES" },
    privacyLine: dto.footer.localOnlyLabel,
    timezoneLabel: BETA_REPORT_TIMEZONE,
    productSignature: dto.footer.productSignature,
    versions: {
      renderer: SHARE_CARD_RENDERER_VERSION,
      copy: SHARE_CARD_COPY_VERSION,
      artwork: SHARE_CARD_ART_VERSION,
      layout: SHARE_CARD_LAYOUT_VERSION,
    },
  };
  validateShareCardViewModelV1(viewModel);
  if (FORBIDDEN_INFERENCE_PATTERN.test(JSON.stringify(viewModel))) {
    throw new Error("BETA_SUMMARY_FORBIDDEN_NARRATIVE");
  }
  return viewModel;
}
