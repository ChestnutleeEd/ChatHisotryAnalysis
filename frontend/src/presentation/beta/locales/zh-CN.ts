import {
  BETA_REPORT_SECTIONS,
  type BetaReportSectionId,
} from "../report-sections";
import {
  BETA_REPORT_PRESENTER_VERSION,
  BETA_REPORT_TIMEZONE,
  BETA_REPORT_VIEW_MODEL_SCHEMA_VERSION,
  type BetaLocalizedDetailRowV1,
  type BetaLocalizedMetricV1,
  type BetaLocalizedMethodologyFactV1,
  type BetaLocalizedQueryChipV1,
  type BetaLocalizedReportSectionV1,
  type BetaLocalizedVisualRowV1,
  type BetaLocalizedVisualV1,
  type BetaReportDtoV1,
  type BetaReportSectionStatus,
  type BetaReportTemplateId,
  type BetaReportViewModelV1,
  type CoreReportFactsV1,
  validateBetaReportDtoV1,
  validateBetaReportViewModelV1,
} from "../report-contract";
import {
  betaReportMetricCategoryLabel,
  betaReportWeekdayLabel,
} from "../report-adapter";

const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

const FORBIDDEN_INFERENCE_PATTERN = /主动|冷淡|在意|亲密|关系质量|心理|人格|情感|说明你们|说明对方/iu;

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatDecimal(value: number): string {
  return decimalFormatter.format(value);
}

function formatPercent(value: number | null): string {
  return value === null ? "样本不足" : `${formatDecimal(value * 100)}%`;
}

function formatMonth(key: string, multiYear: boolean): string {
  const [year, month] = key.split("-");
  return multiYear ? `${year} 年 ${Number(month)} 月` : `${Number(month)} 月`;
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

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) {
    return `${rounded} 秒`;
  }
  if (rounded < 3_600) {
    return `${formatDecimal(rounded / 60)} 分钟`;
  }
  if (rounded < 86_400) {
    return `${formatDecimal(rounded / 3_600)} 小时`;
  }
  return `${formatDecimal(rounded / 86_400)} 天`;
}

function widthPercent(value: number, maximum: number): number {
  if (maximum <= 0 || value <= 0) {
    return 0;
  }
  return Math.max(4, Math.min(100, Math.round((value / maximum) * 100)));
}

function scopeNote(dto: BetaReportDtoV1): string | null {
  if (dto.metadata.scope === "partial-calendar-query") {
    return "当前仅覆盖部分日期范围。";
  }
  if (dto.metadata.scope === "multi-year") {
    return "当前范围跨越多个年份。";
  }
  return null;
}

function statusLabel(status: BetaReportSectionStatus): string {
  switch (status) {
    case "READY":
      return "已就绪";
    case "PARTIAL":
      return "部分日期范围";
    case "EMPTY":
      return "暂无数据";
    case "INSUFFICIENT":
      return "数据不足";
    case "UNAVAILABLE":
      return "尚未提供";
  }
}

function metric(
  label: string,
  value: string,
  unit: string,
): BetaLocalizedMetricV1 {
  return {
    label,
    value,
    unit,
    accessibleLabel: `${label} ${value}${unit}`,
  };
}

function details(...rows: readonly (BetaLocalizedDetailRowV1 | null)[]): readonly BetaLocalizedDetailRowV1[] {
  return rows.filter((row): row is BetaLocalizedDetailRowV1 => row !== null);
}

function visual(
  kind: BetaLocalizedVisualV1["kind"],
  ariaLabel: string,
  rows: readonly BetaLocalizedVisualRowV1[],
  legend: readonly string[] = [],
  detailRows?: readonly BetaLocalizedVisualRowV1[],
): BetaLocalizedVisualV1 {
  return detailRows === undefined
    ? { kind, ariaLabel, rows, legend }
    : { kind, ariaLabel, rows, legend, detailRows };
}

function sectionDefinition(id: BetaReportSectionId) {
  const definition = BETA_REPORT_SECTIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error("UNKNOWN_BETA_REPORT_SECTION");
  }
  return definition;
}

function baseSection(
  dto: BetaReportDtoV1,
  id: BetaReportSectionId,
  content: Pick<BetaLocalizedReportSectionV1, "heading" | "lead" | "metric" | "visual" | "details">,
): BetaLocalizedReportSectionV1 {
  const semantic = dto.sections.find((candidate) => candidate.id === id);
  if (semantic === undefined) {
    throw new Error("BETA_REPORT_SECTION_MISSING");
  }
  const definition = sectionDefinition(id);
  return {
    id,
    order: definition.order,
    scene: definition.scene,
    status: semantic.status,
    templateId: semantic.templateId,
    eyebrow: definition.title,
    heading: content.heading,
    lead: content.lead,
    statusLabel: statusLabel(semantic.status),
    reason: semantic.reason,
    scopeNote: scopeNote(dto),
    metric: content.metric,
    visual: content.visual,
    details: content.details,
  };
}

function openingCopy(dto: BetaReportDtoV1): { readonly heading: string; readonly lead: string; readonly scopeLabel: string } {
  const startYear = dto.metadata.currentRange.startDate.slice(0, 4);
  const endYear = dto.metadata.currentRange.endDate.slice(0, 4);
  if (dto.metadata.mode === "annual" && dto.metadata.year !== null) {
    const scopeLabel = dto.metadata.scope === "partial-calendar-query"
      ? `${dto.metadata.year} 年 · 当前仅覆盖部分日期范围`
      : `${dto.metadata.year} 年`;
    return dto.metadata.scope === "partial-calendar-query"
      ? {
          heading: `${dto.metadata.year} 年的当前范围回顾`,
          lead: `这是你们 ${dto.metadata.year} 年当前已提交日期范围的聊天回顾。`,
          scopeLabel,
        }
      : {
          heading: `你的 ${dto.metadata.year} 年聊天回顾`,
          lead: `这是你们的 ${dto.metadata.year} 年聊天回顾。`,
          scopeLabel,
        };
  }
  const rangeLabel = startYear === endYear ? `${startYear} 年` : `${startYear}–${endYear}`;
  return {
    heading: `${rangeLabel} 的聊天回顾`,
    lead: `看看 ${rangeLabel} 发生了什么。`,
    scopeLabel: rangeLabel,
  };
}

function openingSection(dto: BetaReportDtoV1): BetaLocalizedReportSectionV1 {
  const copy = openingCopy(dto);
  return baseSection(dto, "opening", {
    heading: "这是哪段时间的回顾？",
    lead: copy.lead,
    metric: null,
    visual: null,
    details: details(
      { label: "当前范围", value: `${dto.metadata.currentRange.startDate} – ${dto.metadata.currentRange.endDate}` },
      { label: "时区", value: BETA_REPORT_TIMEZONE },
    ),
  });
}

function messagesSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const total = facts.totalMessages;
  return baseSection(dto, "messages", {
    heading: "这一范围聊了多少？",
    lead: total.value === 0
      ? "当前范围没有可回顾的用户消息。"
      : `这一范围共有 ${formatNumber(total.value)} 条用户消息。`,
    metric: metric("用户消息", formatNumber(total.value), "条"),
    visual: null,
    details: details(
      { label: "Owner", value: `${formatNumber(total.ownerCount)} 条` },
      { label: "Other", value: `${formatNumber(total.otherCount)} 条` },
    ),
  });
}

function activeDaysSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  return baseSection(dto, "active-days", {
    heading: "有多少天聊过？",
    lead: `这一范围内有 ${formatNumber(facts.activeDays.value)} 个聊天日。`,
    metric: metric("聊天日", formatNumber(facts.activeDays.value), "天"),
    visual: null,
    details: [{ label: "日历范围", value: `${formatNumber(facts.activeDays.calendarDays)} 天` }],
  });
}

function streakSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const streak = facts.longestStreak;
  const rows = streak.intervals.map((interval, index) => ({
    key: `${interval.startDate}-${interval.endDate}`,
    label: `区间 ${index + 1}`,
    value: interval.length,
    displayValue: `${formatNumber(interval.length)} 天`,
    secondaryLabel: `${interval.startDate} – ${interval.endDate}`,
    widthPercent: 100,
    tone: "primary" as const,
  }));
  return baseSection(dto, "longest-streak", {
    heading: "最长连续聊了多久？",
    lead: streak.length === 0
      ? "当前范围没有连续聊天区间。"
      : `最长连续聊天为 ${formatNumber(streak.length)} 天。`,
    metric: metric("最长连续聊天", formatNumber(streak.length), "天"),
    visual: streak.intervals.length === 0
      ? null
      : visual("streaks", "最长连续聊天区间", rows),
    details: details(
      streak.intervals.length > 1
        ? { label: "并列区间", value: `${streak.intervals.length} 个` }
        : null,
    ),
  });
}

function monthSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const multiYear = dto.metadata.mode !== "annual";
  const peak = facts.peakMonth;
  const peakLabels = peak.ties.map((key) => formatMonth(key, multiYear));
  const maximum = peak.buckets.reduce((current, bucket) => Math.max(current, bucket.count), 0);
  const rows = peak.buckets.map((bucket) => ({
    key: bucket.key,
    label: formatMonth(bucket.key, multiYear),
    value: bucket.count,
    displayValue: `${formatNumber(bucket.count)} 条`,
    secondaryLabel: bucket.partial ? "部分月份" : null,
    widthPercent: widthPercent(bucket.count, maximum),
    tone: bucket.partial ? "warning" as const : "primary" as const,
  }));
  const lead = peakLabels.length === 0
    ? "当前范围没有消息最多的月份。"
    : peakLabels.length === 1
      ? `${peakLabels[0]}是这一范围消息最多的月份。`
      : `${joinChinese(peakLabels)}并列消息最多。`;
  return baseSection(dto, "peak-month", {
    heading: "哪个月更常聊天？",
    lead,
    metric: peak.maxCount === null ? null : metric("峰值消息数", formatNumber(peak.maxCount), "条"),
    visual: visual("bars", "按月消息数量，固定按时间顺序排列", rows),
    details: details(peak.ties.length > 1 ? { label: "并列月份", value: joinChinese(peakLabels) } : null),
  });
}

function weekdaySection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const peak = facts.peakWeekday;
  const peakLabels = peak.ties.map(betaReportWeekdayLabel);
  const maximum = peak.buckets.reduce((current, bucket) => Math.max(current, bucket.count), 0);
  const rows = peak.buckets.map((bucket) => ({
    key: bucket.weekday,
    label: betaReportWeekdayLabel(bucket.weekday),
    value: bucket.count,
    displayValue: `${formatNumber(bucket.count)} 条`,
    secondaryLabel: formatPercent(bucket.share),
    widthPercent: widthPercent(bucket.count, maximum),
    tone: "primary" as const,
  }));
  return baseSection(dto, "peak-weekday", {
    heading: "通常星期几更常聊？",
    lead: peakLabels.length === 0
      ? "当前范围没有消息最多的星期。"
      : peakLabels.length === 1
        ? `${peakLabels[0]}的消息数最多。`
        : `${joinChinese(peakLabels)}的消息数并列最多。`,
    metric: peak.maxCount === null ? null : metric("峰值消息数", formatNumber(peak.maxCount), "条"),
    visual: visual("bars", "按星期一至星期日排列的消息数量", rows),
    details: [],
  });
}

function hourSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const peak = facts.peakHour;
  const peakLabels = peak.ties.map((hour) => `${hour} 点`);
  const maximum = peak.buckets.reduce((current, bucket) => Math.max(current, bucket.count), 0);
  const rows = peak.buckets.map((bucket) => ({
    key: String(bucket.hour),
    label: `${bucket.hour} 点`,
    value: bucket.count,
    displayValue: `${formatNumber(bucket.count)} 条`,
    secondaryLabel: formatPercent(bucket.share),
    widthPercent: widthPercent(bucket.count, maximum),
    tone: "primary" as const,
  }));
  return baseSection(dto, "peak-hour", {
    heading: "一天中什么时候更常聊天？",
    lead: peakLabels.length === 0
      ? "当前范围没有消息最多的小时。"
      : peakLabels.length === 1
        ? `${peakLabels[0]}附近消息最多（UTC+08:00）。`
        : `${joinChinese(peakLabels)}附近消息并列最多（UTC+08:00）。`,
    metric: peak.maxCount === null ? null : metric("峰值消息数", formatNumber(peak.maxCount), "条"),
    visual: visual("bars", "按 UTC+08:00 小时排列的消息数量", rows),
    details: [{ label: "时间口径", value: "UTC+08:00" }],
  });
}

function senderSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const sender = facts.senderShare;
  const rows = [
    {
      key: "owner",
      label: "Owner",
      value: sender.owner.count,
      displayValue: `${formatNumber(sender.owner.count)} 条 · ${formatPercent(sender.owner.share)}`,
      secondaryLabel: "消息数量",
      widthPercent: sender.owner.share === null ? 0 : Math.round(sender.owner.share * 100),
      tone: "owner" as const,
    },
    {
      key: "other",
      label: "Other",
      value: sender.other.count,
      displayValue: `${formatNumber(sender.other.count)} 条 · ${formatPercent(sender.other.share)}`,
      secondaryLabel: "消息数量",
      widthPercent: sender.other.share === null ? 0 : Math.round(sender.other.share * 100),
      tone: "other" as const,
    },
  ];
  return baseSection(dto, "sender-share", {
    heading: "双方各发了多少？",
    lead: sender.denominator === 0
      ? "当前范围没有可比较的 Owner / Other 消息。"
      : "Owner 与 Other 的消息数量分布如下。",
    metric: sender.denominator === 0 ? null : metric("双方消息合计", formatNumber(sender.denominator), "条"),
    visual: visual("segments", "Owner 与 Other 的消息数量和占比", rows, ["Owner", "Other"]),
    details: details(
      { label: "分母", value: `${formatNumber(sender.denominator)} 条用户消息` },
      { label: "筛选说明", value: "双方比较固定包含 Owner 与 Other" },
    ),
  });
}

function lengthSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const length = facts.messageLength;
  const overall = length.overall;
  const rows = [
    { label: "整体平均", value: overall.mean, stats: overall },
    { label: "Owner 平均", value: length.owner.mean, stats: length.owner },
    { label: "Other 平均", value: length.other.mean, stats: length.other },
  ].filter((row) => row.stats.count > 0).map((row) => ({
    key: row.label,
    label: row.label,
    value: row.value ?? 0,
    displayValue: row.value === null ? "样本不足" : `${formatDecimal(row.value)} 个字符`,
    secondaryLabel: `样本 ${formatNumber(row.stats.count)}`,
    widthPercent: widthPercent(row.value ?? 0, Math.max(overall.mean ?? 0, length.owner.mean ?? 0, length.other.mean ?? 0)),
    tone: "primary" as const,
  }));
  return baseSection(dto, "message-length", {
    heading: "文字消息通常有多长？",
    lead: overall.mean === null
      ? "当前没有足够的合资格文字消息样本。"
      : `平均每条文字消息约 ${formatDecimal(overall.mean)} 个字符。`,
    metric: overall.mean === null ? null : metric("平均消息长度", formatDecimal(overall.mean), "个字符"),
    visual: rows.length === 0 ? null : visual("table", "文字消息长度统计", rows),
    details: details(
      overall.median === null ? null : { label: "整体中位数", value: `${formatDecimal(overall.median)} 个字符` },
      overall.p90 === null ? null : { label: "整体 P90", value: `${formatDecimal(overall.p90)} 个字符` },
    ),
  });
}

function messageTypesSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const types = facts.messageTypes;
  const ranked = types.categories
    .map((bucket, index) => ({ bucket, index }))
    .filter(({ bucket }) => bucket.count > 0)
    .sort((left, right) => right.bucket.count - left.bucket.count || left.index - right.index)
    .map(({ bucket }) => bucket);
  const primary = ranked.slice(0, 5);
  const hidden = ranked.slice(5);
  const otherCount = hidden.reduce((total, bucket) => total + bucket.count, 0);
  const visible = otherCount > 0
    ? [
        ...primary,
        {
          category: "other" as const,
          count: otherCount,
          share: types.denominator === 0 ? null : otherCount / types.denominator,
        },
      ]
    : primary;
  const maximum = visible.reduce((current, bucket) => Math.max(current, bucket.count), 0);
  const rows = visible.map((bucket) => ({
    key: bucket.category,
    label: bucket.category === "other" && hidden.length > 0 ? "其他" : betaReportMetricCategoryLabel(bucket.category),
    value: bucket.count,
    displayValue: `${formatNumber(bucket.count)} 条 · ${formatPercent(bucket.share)}`,
    secondaryLabel: null,
    widthPercent: widthPercent(bucket.count, maximum),
    tone: bucket.category === "text" ? "primary" as const : "supporting" as const,
  }));
  const detailRows = ranked.map((bucket) => ({
    key: bucket.category,
    label: betaReportMetricCategoryLabel(bucket.category),
    value: bucket.count,
    displayValue: `${formatNumber(bucket.count)} 条 · ${formatPercent(bucket.share)}`,
    secondaryLabel: null,
    widthPercent: widthPercent(bucket.count, maximum),
    tone: bucket.category === "text" ? "primary" as const : "supporting" as const,
  }));
  return baseSection(dto, "message-types", {
    heading: "除了文字，还发了什么？",
    lead: types.denominator === 0
      ? "当前没有可展示的用户消息类型分布。"
      : "消息类型按当前用户消息分母排列，系统诊断不加入这个分母。",
    metric: types.denominator === 0 ? null : metric("用户消息", formatNumber(types.denominator), "条"),
    visual: rows.length === 0 ? null : visual("bars", "用户消息类型分布", rows, [], detailRows),
    details: details(
      hidden.length > 0 ? { label: "完整类别", value: "可在“查看全部消息类型”中查看" } : null,
      { label: "符合条件文字", value: `${formatNumber(types.eligibleTextCount)} 条` },
      types.systemDiagnosticCount > 0
        ? { label: "系统诊断", value: `${formatNumber(types.systemDiagnosticCount)} 条（不计入分母）` }
        : null,
    ),
  });
}

function sessionsSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const sessions = facts.sessions;
  const rows = [
    { key: "owner", label: "Owner", value: sessions.owner.count, share: sessions.owner.share, tone: "owner" as const },
    { key: "other", label: "Other", value: sessions.other.count, share: sessions.other.share, tone: "other" as const },
    { key: "unknown", label: "Unknown", value: sessions.unknown.count, share: sessions.unknown.share, tone: "supporting" as const },
  ].filter((row) => row.value > 0 || sessions.sessionCount === 0).map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value,
    displayValue: `${formatNumber(row.value)} 个 · ${formatPercent(row.share)}`,
    secondaryLabel: "会话发起方",
    widthPercent: row.share === null ? 0 : Math.round(row.share * 100),
    tone: row.tone,
  }));
  return baseSection(dto, "sessions", {
    heading: "一次聊天如何开始？",
    lead: sessions.sessionCount === 0
      ? "当前范围没有按此阈值形成的会话。"
      : `按 ${sessions.thresholdHours} 小时会话间隔计算，共 ${formatNumber(sessions.sessionCount)} 个会话。`,
    metric: metric("会话数", formatNumber(sessions.sessionCount), "个"),
    visual: visual("segments", "按会话发起方排列的会话数量", rows, ["Owner", "Other", "Unknown"]),
    details: [{ label: "会话阈值", value: `${sessions.thresholdHours} 小时` }],
  });
}

function repliesSection(dto: BetaReportDtoV1, facts: CoreReportFactsV1): BetaLocalizedReportSectionV1 {
  const replies = facts.replyIntervals;
  const rows = replies.directions.map((direction) => {
    const stats = direction.stats;
    const responder = direction.responder === "owner" ? "Owner" : "Other";
    return {
      key: direction.direction,
      label: direction.direction === "owner-to-other" ? "Owner → Other" : "Other → Owner",
      value: stats.count,
      displayValue: stats.medianSeconds === null
        ? "样本不足"
        : `中位数 ${formatDuration(stats.medianSeconds)} · ${formatNumber(stats.count)} 个样本`,
      secondaryLabel: `回复方 ${responder}`,
      widthPercent: widthPercent(stats.count, Math.max(...replies.directions.map((item) => item.stats.count), 0)),
      tone: direction.responder === "owner" ? "owner" as const : "other" as const,
    };
  });
  return baseSection(dto, "replies", {
    heading: "回复间隔通常多久？",
    lead: replies.overall.medianSeconds === null
      ? "当前没有足够的可判定回复间隔样本。"
      : `可判定回复间隔的中位数约为 ${formatDuration(replies.overall.medianSeconds)}。`,
    metric: replies.overall.medianSeconds === null
      ? null
      : metric("回复间隔中位数", formatDuration(replies.overall.medianSeconds), ""),
    visual: visual("table", "按回复方向排列的回复间隔与样本数", rows),
    details: [
      { label: "回复样本", value: `${formatNumber(replies.overall.count)} 个可判定区间` },
      { label: "会话阈值", value: `${replies.thresholdHours} 小时` },
    ],
  });
}

function unavailableSection(dto: BetaReportDtoV1, id: BetaReportSectionId): BetaLocalizedReportSectionV1 {
  return baseSection(dto, id, {
    heading: sectionDefinition(id).question,
    lead: "这部分内容将在对应的本地词频或分享模块准备好后显示。",
    metric: null,
    visual: null,
    details: [],
  });
}

function methodology(dto: BetaReportDtoV1): readonly BetaLocalizedMethodologyFactV1[] {
  const values: Readonly<Record<string, string>> = {
    population: "合并并确定性去重后的用户消息",
    timezone: BETA_REPORT_TIMEZONE,
    "sender-filter-exception": "Owner / Other 比较、回复间隔与会话发起统计固定包含双方",
    "session-threshold": `${dto.metadata.appliedFilters.sessionThresholdHours} 小时会话间隔`,
    "partial-calendar": dto.metadata.scope === "partial-calendar-query"
      ? "当前仅覆盖部分日期范围"
      : dto.metadata.scope === "multi-year"
        ? "当前范围跨越多个年份"
        : "当前范围覆盖所选日历范围",
    "reply-limitation": "只统计满足现有边界的跨发送方回复区间；没有样本时显示数据不足",
    "non-evaluative-language": "仅描述数量、分布和时间间隔，不对聊天作额外判断",
    "word-denominator": "词频原始次数与每万词频率使用内置策略过滤后的符合条件词元分母",
  };
  return dto.methodology.map((fact) => ({
    id: fact.id,
    label: fact.id === "population"
      ? "统计人群"
      : fact.id === "timezone"
        ? "时间口径"
        : fact.id === "sender-filter-exception"
          ? "双方比较"
          : fact.id === "session-threshold"
            ? "会话阈值"
            : fact.id === "partial-calendar"
              ? "日历范围"
              : fact.id === "reply-limitation"
                ? "回复限制"
                : fact.id === "non-evaluative-language"
                  ? "表达边界"
                  : "词频分母",
    value: values[fact.id] ?? "当前定义已记录",
  }));
}

function queryChips(dto: BetaReportDtoV1, openingScopeLabel: string): readonly BetaLocalizedQueryChipV1[] {
  const filters = dto.metadata.appliedFilters;
  const filtered = dto.metadata.scope !== "full-calendar-query" || filters.sender !== "both" || filters.sessionThresholdHours !== 6;
  return [
    { id: "date", label: openingScopeLabel, tone: "accent" },
    { id: "sender", label: filters.sender === "both" ? "双方" : filters.sender === "owner" ? "Owner" : "Other", tone: "default" },
    { id: "timezone", label: "UTC+08", tone: "default" },
    { id: "session", label: `会话 ${filters.sessionThresholdHours}h`, tone: "default" },
    ...(filtered ? [{ id: "filtered" as const, label: "已筛选", tone: "default" as const }] : []),
  ];
}

export function presentBetaReportZhCN(dto: BetaReportDtoV1): BetaReportViewModelV1 {
  validateBetaReportDtoV1(dto);
  const copy = openingCopy(dto);
  const facts = dto.facts;
  const sections: readonly BetaLocalizedReportSectionV1[] = [
    openingSection(dto),
    messagesSection(dto, facts),
    activeDaysSection(dto, facts),
    streakSection(dto, facts),
    monthSection(dto, facts),
    weekdaySection(dto, facts),
    hourSection(dto, facts),
    senderSection(dto, facts),
    lengthSection(dto, facts),
    messageTypesSection(dto, facts),
    sessionsSection(dto, facts),
    repliesSection(dto, facts),
    unavailableSection(dto, "frequent-words"),
    unavailableSection(dto, "distinctive-keywords"),
    unavailableSection(dto, "word-cloud"),
    unavailableSection(dto, "summary-share"),
  ];
  const model = {
    schemaVersion: BETA_REPORT_VIEW_MODEL_SCHEMA_VERSION,
    locale: "zh-CN" as const,
    presenterVersion: BETA_REPORT_PRESENTER_VERSION,
    reportQueryKey: dto.identity.reportQueryKey,
    customFilteringActive: false,
    metadata: {
      mode: dto.metadata.mode,
      year: dto.metadata.year,
      scope: dto.metadata.scope,
      scopeLabel: copy.scopeLabel,
      currentRangeLabel: `${dto.metadata.currentRange.startDate} – ${dto.metadata.currentRange.endDate}`,
      timezoneLabel: BETA_REPORT_TIMEZONE,
      partialLabel: dto.metadata.scope === "partial-calendar-query" ? "当前仅覆盖部分日期范围。" : null,
      queryChips: queryChips(dto, copy.scopeLabel),
    },
    sections,
    methodology: methodology(dto),
    privacy: {
      badgeLabel: "本地聚合结果",
      localOnlyLabel: "仅本地呈现 · 不上传",
    },
  };
  validateBetaReportViewModelV1(model);
  const serialized = JSON.stringify(model);
  if (FORBIDDEN_INFERENCE_PATTERN.test(serialized)) {
    throw new Error("BETA_REPORT_FORBIDDEN_NARRATIVE");
  }
  return model;
}

export type BetaReportZhCNViewModel = ReturnType<typeof presentBetaReportZhCN>;

export function betaReportTemplateFor(id: BetaReportSectionId, dto: BetaReportDtoV1): BetaReportTemplateId {
  return dto.sections.find((section) => section.id === id)?.templateId ?? "UNAVAILABLE";
}
