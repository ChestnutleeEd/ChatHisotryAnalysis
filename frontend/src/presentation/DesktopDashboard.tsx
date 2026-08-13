import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ApprovedChartKey, ReportFormat } from "../desktop/ipc-contract";
import type {
  CanonicalAnalysisFilters,
  CanonicalAnalysisResult,
} from "../worker-analysis/analytics-contract";
import type { TrendBucket } from "../worker-analysis/activity-metrics";
import {
  DASHBOARD_ROUTES,
  DASHBOARD_ROUTE_LABELS,
  ROUTE_DESCRIPTIONS,
  categoryLabel,
  comparativeScopeNotice,
  createDashboardViewModel,
  formatCount,
  formatMetricValue,
  formatSeconds,
  formatShare,
  methodologyFacts,
  routeAt,
  routeIndex,
  senderLabel,
  validateDashboardFilters,
  type DashboardRoute,
  type DashboardViewModel,
  type FilterErrors,
} from "./desktop-dashboard";

interface DesktopDashboardProps {
  readonly result: CanonicalAnalysisResult;
  readonly pending: boolean;
  readonly onFilterChange: (filters: CanonicalAnalysisFilters) => void;
  readonly onAnalyzeOtherFiles: () => void;
  readonly onExport: (format: ReportFormat, chartKey: ApprovedChartKey) => void;
  readonly initialRoute?: DashboardRoute;
  readonly onRouteChange?: (route: DashboardRoute) => void;
}

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly definition: string;
  readonly variant?: "hero" | "standard" | "compact";
  readonly className?: string;
  readonly href?: DashboardRoute;
  readonly onNavigate?: (route: DashboardRoute) => void;
  readonly unavailableReason?: string;
}

interface ChartRow {
  readonly label: string;
  readonly value: number;
  readonly displayValue: string;
  readonly secondary?: string;
}

function filtersEqual(
  left: CanonicalAnalysisFilters,
  right: CanonicalAnalysisFilters,
): boolean {
  return (
    left.startDate === right.startDate &&
    left.endDate === right.endDate &&
    left.sender === right.sender &&
    left.selectedYear === right.selectedYear &&
    left.sessionThresholdHours === right.sessionThresholdHours
  );
}

function MetricCard({
  label,
  value,
  unit,
  definition,
  variant = "standard",
  className,
  href,
  onNavigate,
  unavailableReason,
}: MetricCardProps) {
  const cardClassName = ["dashboard-kpi-card", `dashboard-metric-${variant}`, className]
    .filter((value): value is string => value !== undefined)
    .join(" ");
  return (
    <div className={cardClassName}>
      <dl>
        <dt>{label}</dt>
        <dd className={unavailableReason === undefined ? undefined : "is-unavailable"}>
          {value}
          {unit !== undefined && value !== "—" ? <small>{unit}</small> : null}
        </dd>
        <dd className="dashboard-kpi-definition">{unavailableReason ?? definition}</dd>
      </dl>
      {href !== undefined && onNavigate !== undefined ? (
        <button className="dashboard-kpi-link" type="button" onClick={() => onNavigate(href)} aria-label={`${label}，打开${DASHBOARD_ROUTE_LABELS[href]}`}>
          查看{DASHBOARD_ROUTE_LABELS[href]}
        </button>
      ) : null}
    </div>
  );
}

function Definition({ children }: { readonly children: ReactNode }) {
  return (
    <details className="dashboard-definition">
      <summary>查看统计口径</summary>
      <div>{children}</div>
    </details>
  );
}

function DeveloperDetails({
  label = "查看开发信息",
  value,
}: {
  readonly label?: string;
  readonly value: string;
}) {
  return (
    <details className="dashboard-developer-details">
      <summary>{label}</summary>
      <code>{value}</code>
    </details>
  );
}

function Table({
  caption,
  columns,
  rows,
  emptyText = "当前筛选没有可展示的数据。",
}: {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
  readonly emptyText?: string;
}) {
  return (
    <div className="dashboard-table-wrap" role="region" tabIndex={0} aria-label={`${caption}，可横向滚动查看`}>
      <span className="dashboard-table-overflow-cue" aria-hidden="true">横向滚动查看</span>
      <table className="dashboard-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <span className="dashboard-empty-inline">{emptyText}</span>
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${caption}-${String(row[0])}-${index}`}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={`${cellIndex}-${String(cell)}`} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={`${cellIndex}-${String(cell)}`}>{cell}</td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function BarChart({
  title,
  description,
  rows,
}: {
  readonly title: string;
  readonly description: string;
  readonly rows: readonly ChartRow[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <figure className="dashboard-bar-chart" aria-label={title}>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <div className="dashboard-bar-list" role="list">
        {rows.map((row) => (
          <div className="dashboard-bar-row" role="listitem" key={row.label}>
            <div className="dashboard-bar-label">
              <span>{row.label}</span>
              <strong>{row.displayValue}</strong>
            </div>
            <div className="dashboard-bar-track" aria-hidden="true">
              <progress
                className="dashboard-bar-progress"
                max={max}
                value={Math.max(0, Math.min(max, row.value))}
                aria-label={`${row.label} ${row.displayValue}`}
              />
            </div>
            {row.secondary !== undefined ? <small>{row.secondary}</small> : null}
          </div>
        ))}
      </div>
    </figure>
  );
}

function RoleComparison({
  owner,
  other,
  denominator,
}: {
  readonly owner: { readonly count: number; readonly share: number | null };
  readonly other: { readonly count: number; readonly share: number | null };
  readonly denominator: number;
}) {
  const max = Math.max(1, owner.count, other.count);
  const rows = [
    { key: "owner", label: "owner", value: owner },
    { key: "other", label: "other", value: other },
  ] as const;
  return (
    <div className="dashboard-role-comparison" aria-label="owner 与 other 消息比较">
      <div className="dashboard-role-comparison-heading">
        <strong>消息数量</strong>
        <span>分母：{formatCount(denominator)} 条用户消息</span>
      </div>
      {rows.map((row) => (
        <div className={`dashboard-role-row dashboard-role-${row.key}`} key={row.key}>
          <div className="dashboard-role-row-label">
            <span>{row.label}</span>
            <strong>{formatCount(row.value.count)} · {formatShare(row.value.share)}</strong>
          </div>
          <div className="dashboard-role-track" aria-hidden="true">
            <span style={{ width: `${(row.value.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ title, definition, buckets }: {
  readonly title: string;
  readonly definition: string;
  readonly buckets: readonly TrendBucket[];
}) {
  const rows = buckets.map((bucket) => ({
    label: bucket.key,
    value: bucket.count,
    displayValue: formatCount(bucket.count),
    secondary: bucket.partial ? "部分周期" : "完整周期",
  }));
  return (
    <section className="dashboard-chart-card" aria-labelledby={`${title}-heading`}>
      <h3 id={`${title}-heading`}>{title}</h3>
      <BarChart title={`${title}图`} description={definition} rows={rows} />
      <Table
        caption={`${title}精确数据`}
        columns={["周期", "消息数", "周期状态"]}
        rows={buckets.map((bucket) => [
          bucket.key,
          formatCount(bucket.count),
          bucket.partial ? "部分周期" : "完整周期",
        ])}
      />
    </section>
  );
}

function ScopeLine({ result }: { readonly result: CanonicalAnalysisResult }) {
  const isFiltered =
    result.filters.startDate !== result.dataset.minimumCalendarDate ||
    result.filters.endDate !== result.dataset.maximumCalendarDate;
  return (
    <dl className="dashboard-context-register" aria-label="当前已提交分析范围">
      <div><dt>范围</dt><dd>{result.filters.startDate} → {result.filters.endDate}</dd></div>
      <div><dt>年度</dt><dd>{result.filters.selectedYear ?? "全部"}</dd></div>
      <div><dt>角色</dt><dd>{senderLabel(result.filters.sender)}</dd></div>
      <div><dt>时区</dt><dd>UTC+08:00</dd></div>
      <div><dt>会话</dt><dd>{result.filters.sessionThresholdHours} 小时</dd></div>
      <div><dt>状态</dt><dd>{isFiltered ? "已筛选" : "完整范围"}</dd></div>
    </dl>
  );
}

function OverviewPage({
  model,
  onNavigate,
}: {
  readonly model: DashboardViewModel;
  readonly onNavigate: (route: DashboardRoute) => void;
}) {
  const { result } = model;
  const initiatorTotal = result.replySessions.conversationSessions.sessionCount;
  const longestStreak = result.activity.chatActivity.longestStreakLength;
  const ownerReply = model.overview.replyMedians.find((item) => item.responder === "owner");
  const otherReply = model.overview.replyMedians.find((item) => item.responder === "other");
  return (
    <section className="dashboard-page" aria-labelledby="overview-page-heading">
      <div className="dashboard-page-heading">
        <div>
          <p className="dashboard-eyebrow">01 / 概览</p>
          <h2 id="overview-page-heading" tabIndex={-1}>概览</h2>
          <p>从当前已应用条件出发，先看规模，再看活动、双方比较和回复区间。</p>
        </div>
        <DeveloperDetails label="查看概览定义" value={result.schemaVersion} />
      </div>
      <div className="dashboard-overview-grid">
        <MetricCard
          label="筛选后用户消息"
          value={formatCount(model.overview.selectedUserMessages)}
          unit="条"
          variant="hero"
          className="dashboard-overview-primary"
          definition="去重后用户消息；排除系统消息。"
          href="Trends"
          onNavigate={onNavigate}
        />
        <section className="dashboard-overview-group dashboard-overview-activity" aria-labelledby="overview-activity-heading">
          <div className="dashboard-overview-group-heading">
            <div><p className="dashboard-eyebrow">活动</p><h3 id="overview-activity-heading">活动节奏</h3></div>
            <button className="dashboard-inline-link" type="button" onClick={() => onNavigate("Activity")}>查看活动</button>
          </div>
          <div className="dashboard-overview-pair">
            <MetricCard label="聊天日" value={formatCount(model.overview.totalChatDays)} unit="天" variant="compact" definition="UTC+08:00 日历日内至少一条符合筛选的用户消息。" />
            <MetricCard label="最长连续聊天日" value={formatCount(longestStreak)} unit="天" variant="compact" definition="相邻自然日组成的最长筛选后连续区间。" />
          </div>
        </section>
        <section className="dashboard-overview-group dashboard-overview-comparison" aria-labelledby="overview-comparison-heading">
          <div className="dashboard-overview-group-heading">
            <div><p className="dashboard-eyebrow">双方比较</p><h3 id="overview-comparison-heading">Owner / Other</h3></div>
            <button className="dashboard-inline-link" type="button" onClick={() => onNavigate("Comparison")}>查看比较</button>
          </div>
          <RoleComparison
            owner={result.activity.senderComparison.owner}
            other={result.activity.senderComparison.other}
            denominator={result.activity.senderComparison.denominator}
          />
        </section>
        <section className="dashboard-overview-group dashboard-overview-conversation" aria-labelledby="overview-conversation-heading">
          <div className="dashboard-overview-group-heading">
            <div><p className="dashboard-eyebrow">会话</p><h3 id="overview-conversation-heading">回复与会话</h3></div>
            <button className="dashboard-inline-link" type="button" onClick={() => onNavigate("Replies & Sessions")}>查看详情</button>
          </div>
          <div className="dashboard-overview-pair">
            <MetricCard label="会话开场次数" value={formatCount(initiatorTotal)} unit="个会话" variant="compact" definition={`当前阈值为 ${result.replySessions.conversationSessions.thresholdHours} 小时。`} />
            <div className="dashboard-reply-summary">
              <span className="dashboard-metric-label">回复间隔中位数</span>
              <div><strong>owner</strong><span>{formatSeconds(ownerReply?.seconds ?? null)}</span></div>
              <div><strong>other</strong><span>{formatSeconds(otherReply?.seconds ?? null)}</span></div>
            </div>
          </div>
        </section>
        <div className="dashboard-overview-support-stack">
          <section className="dashboard-chart-card dashboard-overview-support-primary" aria-labelledby="overview-trend-heading">
            <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">时间趋势</p><h3 id="overview-trend-heading">范围内趋势</h3></div><span className="dashboard-card-kicker">按年</span></div>
            <BarChart
              title="年度用户消息数量"
              description="所有类别的去重后用户消息；完整数据见趋势。"
              rows={result.activity.trends.yearly.map((bucket) => ({
                label: bucket.key,
                value: bucket.count,
                displayValue: formatCount(bucket.count),
                secondary: bucket.partial ? "部分周期" : undefined,
              }))}
            />
          </section>
          <section className="dashboard-chart-card" aria-labelledby="overview-type-heading">
            <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">消息构成</p><h3 id="overview-type-heading">主要消息类别</h3></div><span className="dashboard-card-kicker">当前范围</span></div>
            <BarChart
              title="当前范围的类别计数"
              description="类别顺序和计数来自同一份本地结果；完整类别表见消息类型。"
              rows={model.overview.leadingTypes.map((bucket) => ({
                label: categoryLabel(bucket.category),
                value: bucket.count,
                displayValue: `${formatCount(bucket.count)} · ${formatShare(bucket.share)}`,
              }))}
            />
            {model.overview.leadingTypes.length === 0 ? (
              <p className="dashboard-empty" role="status">当前筛选没有用户消息类别。</p>
            ) : null}
          </section>
        </div>
      </div>
      <Definition>
        <p>去重后用户消息包含媒体、未知类别和不符合文字规则的消息，排除系统消息。</p>
        <p>聊天日和 streak 使用 UTC+08:00 日历日；发送方比较固定同时包含 owner 与 other。</p>
        <p>{comparativeScopeNotice()}</p>
        <p>缺少证据时显示 unavailable，不以零替代。</p>
      </Definition>
    </section>
  );
}

function TrendsPage({ result }: { readonly result: CanonicalAnalysisResult }) {
  return (
    <section className="dashboard-page" aria-labelledby="trends-page-heading">
      <PageHeading eyebrow="02 / 趋势" id="trends-page-heading" title="趋势" description="日、月、年趋势都统计去重后用户消息，使用固定 UTC+08:00。" schema={result.activity.schemaVersion} />
      <div className="dashboard-trends-layout">
        <TrendChart title="每月" definition="部分月份保留“部分周期”标记；计数只来自筛选日期。" buckets={result.activity.trends.monthly} />
        <aside className="dashboard-trends-support" aria-label="年度趋势摘要">
          <p className="dashboard-eyebrow">辅助视图</p>
          <h3>年度范围</h3>
          <BarChart
            title="年度用户消息数量"
            description="按年概览；精确数据在下方展开。"
            rows={result.activity.trends.yearly.map((bucket) => ({
              label: bucket.key,
              value: bucket.count,
              displayValue: formatCount(bucket.count),
              secondary: bucket.partial ? "部分周期" : "完整周期",
            }))}
          />
        </aside>
      </div>
      <details className="dashboard-definition dashboard-progressive-disclosure">
        <summary>查看每日与年度精确数据</summary>
        <div className="dashboard-trends-details">
          <TrendChart title="每日" definition="包含筛选区间内的零值日期；日期筛选包含首尾。" buckets={result.activity.trends.daily} />
          <TrendChart title="每年" definition="部分年份保留“部分周期”标记；计数只来自筛选日期。" buckets={result.activity.trends.yearly} />
        </div>
      </details>
    </section>
  );
}

function ComparisonPage({ result }: { readonly result: CanonicalAnalysisResult }) {
  const senderRows = [result.activity.senderComparison.owner, result.activity.senderComparison.other];
  const senderDifference = result.activity.senderComparison.owner.count - result.activity.senderComparison.other.count;
  const lengthRows = [
    ["整体", result.stage7.averageLength.overall],
    ["owner", result.stage7.averageLength.owner],
    ["other", result.stage7.averageLength.other],
  ] as const;
  return (
    <section className="dashboard-page" aria-labelledby="comparison-page-heading">
      <PageHeading eyebrow="03 / 双方比较" id="comparison-page-heading" title="比较" description="发送方比较固定同时包含 Owner 与 Other；全局发送方筛选不改变比较分母。" schema={result.activity.schemaVersion} />
      <div className="dashboard-two-column">
        <section className="dashboard-chart-card" aria-labelledby="sender-comparison-heading">
          <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">比较条</p><h3 id="sender-comparison-heading">发送方消息数量与占比</h3></div><span className="dashboard-card-kicker">Owner / Other</span></div>
          <p className="dashboard-primary-insight">{senderDifference === 0 ? "两个发送方的消息数量相同。" : `${senderDifference > 0 ? "owner" : "other"} 多 ${formatCount(Math.abs(senderDifference))} 条消息。`}</p>
          <RoleComparison
            owner={result.activity.senderComparison.owner}
            other={result.activity.senderComparison.other}
            denominator={result.activity.senderComparison.denominator}
          />
          <details className="dashboard-definition dashboard-progressive-disclosure">
            <summary>查看发送方精确比较</summary>
            <Table
              caption="发送方精确比较"
              columns={["发送方", "消息数", "占比"]}
              rows={senderRows.map((bucket) => [bucket.sender, formatCount(bucket.count), formatShare(bucket.share)])}
            />
          </details>
        </section>
        <section className="dashboard-chart-card" aria-labelledby="length-heading">
          <h3 id="length-heading">符合条件文字长度</h3>
          <p className="dashboard-definition-copy">单位是清洗后的 Unicode 字符数；不包含媒体、系统消息、纯 URL 或不符合文字规则的消息。</p>
          <Table
            caption="符合条件文字长度统计"
            columns={["范围", "消息数", "总字符数", "平均", "中位数", "p90"]}
            rows={lengthRows.map(([scope, stats]) => [
              scope,
              formatCount(stats.count),
              formatCount(stats.sum),
              formatMetricValue(stats.mean),
              formatMetricValue(stats.median),
              formatMetricValue(stats.p90),
            ])}
            emptyText="当前筛选没有符合条件的文字消息。"
          />
        </section>
      </div>
      <Definition>
        <p>整体平均长度使用合并后的字符总数除以符合条件的文字消息数，不是两个发送方平均值的平均。</p>
        <p>{comparativeScopeNotice()}</p>
      </Definition>
    </section>
  );
}

function ActivityPage({ result }: { readonly result: CanonicalAnalysisResult }) {
  const hourRows = result.activity.hourActivity.buckets.map((bucket) => ({
    label: String(bucket.hour).padStart(2, "0"),
    value: bucket.count,
    displayValue: `${formatCount(bucket.count)} · ${formatShare(bucket.share)}`,
  }));
  const weekdayRows = result.activity.weekdayActivity.buckets.map((bucket) => ({
    label: bucket.weekday,
    value: bucket.count,
    displayValue: `${formatCount(bucket.count)} · ${formatShare(bucket.share)}`,
  }));
  return (
    <section className="dashboard-page" aria-labelledby="activity-page-heading">
      <PageHeading eyebrow="04 / 活跃时间" id="activity-page-heading" title="活动" description="小时和星期分布使用当前日期与发送方范围；所有固定桶保留零值。" schema={result.activity.schemaVersion} />
      <div className="dashboard-activity-layout">
        <TrendChart title="每月活动" definition="月份趋势保留部分周期标记；计数只来自筛选日期。" buckets={result.activity.trends.monthly} />
        <div className="dashboard-activity-distributions">
          <section className="dashboard-chart-card dashboard-chart-micro" aria-labelledby="hour-activity-heading">
            <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">分布带</p><h3 id="hour-activity-heading">小时分布</h3></div><span className="dashboard-card-kicker">UTC+08:00</span></div>
            <BarChart title="UTC+08:00 小时" description={"分母：" + formatCount(result.activity.hourActivity.denominator) + " 条筛选后的用户消息。"} rows={hourRows} />
          </section>
          <section className="dashboard-chart-card dashboard-chart-micro" aria-labelledby="weekday-activity-heading">
            <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">分布带</p><h3 id="weekday-activity-heading">星期分布</h3></div><span className="dashboard-card-kicker">固定桶</span></div>
            <BarChart title="周一至周日" description="按固定日历日期归类，不使用主机语言环境。" rows={weekdayRows} />
          </section>
        </div>
      </div>
      <div className="dashboard-overview-pair dashboard-activity-metrics">
        <MetricCard label="聊天日" value={formatCount(result.activity.chatActivity.totalChatDays)} unit="天" definition="有至少一条符合当前筛选用户消息的 UTC+08:00 日期。" />
        <MetricCard label="最长连续聊天日" value={formatCount(result.activity.chatActivity.longestStreakLength)} unit="天" definition="连续日期之间只允许相差一天；完整并列区间见下表。" />
      </div>
      <details className="dashboard-definition dashboard-progressive-disclosure">
        <summary>查看小时、星期与 streak 精确数据</summary>
        <div className="dashboard-activity-details">
          <Table caption="小时精确数据" columns={["小时", "消息数", "占比"]} rows={result.activity.hourActivity.buckets.map((bucket) => [String(bucket.hour).padStart(2, "0"), formatCount(bucket.count), formatShare(bucket.share)])} />
          <Table caption="星期精确数据" columns={["星期", "消息数", "占比"]} rows={result.activity.weekdayActivity.buckets.map((bucket) => [bucket.weekday, formatCount(bucket.count), formatShare(bucket.share)])} />
          <Table caption="所有并列最长连续聊天日区间" columns={["开始", "结束", "长度"]} rows={result.activity.chatActivity.longestStreaks.map((streak) => [streak.startDate, streak.endDate, formatCount(streak.length) + " 天"])} emptyText="当前筛选没有聊天日。" />
        </div>
      </details>
      <Definition>
        <p>系统事件不计入活动、聊天日或连续天数；发送方筛选会重新计算当前范围内的活动。</p>
        <p>所有日期、小时和星期使用 UTC+08:00。</p>
      </Definition>
    </section>
  );
}

function WordsYearsPage({
  model,
  onLocalFilterChange,
  pending,
}: {
  readonly model: DashboardViewModel;
  readonly onLocalFilterChange: (filters: CanonicalAnalysisFilters) => void;
  readonly pending: boolean;
}) {
  const { result } = model;
  const [selectedYear, setSelectedYear] = useState<number | null>(result.filters.selectedYear);
  useEffect(() => setSelectedYear(result.filters.selectedYear), [result.filters.selectedYear]);
  const selectedKeywordYear = selectedYear === null
    ? model.activeKeywordYear
    : result.stage7.yearlyKeywords.years.find((year) => year.year === selectedYear);
  const applyYear = () => onLocalFilterChange({ ...result.filters, selectedYear });
  const rankingPreview = model.wordRanking.slice(0, 12);
  const keywordPreview = selectedKeywordYear?.keywords.slice(0, 8) ?? [];
  const summaryLead = result.stage7.summary.clauses[0]?.text ?? "当前筛选没有足够证据形成固定摘要。";
  return (
    <section className="dashboard-page" aria-labelledby="words-page-heading">
      <PageHeading eyebrow="05 / 词汇与年份" id="words-page-heading" title="词汇与年度" description="词汇只来自符合条件的文字；年度关键词和摘要保留统计口径，完整明细按需展开。" schema={result.stage7.schemaVersion} />
      <section className="dashboard-summary-banner" aria-labelledby="words-summary-heading">
        <p className="dashboard-eyebrow">当前摘要</p>
        <h3 id="words-summary-heading">{summaryLead}</h3>
        <p>先看当前范围的主要词汇，再按需展开逐年数值和统计口径。</p>
      </section>
      <div className="dashboard-local-control dashboard-year-control">
        <label htmlFor="dashboard-year">年度关键词与摘要</label>
        <select id="dashboard-year" value={selectedYear ?? ""} onChange={(event) => setSelectedYear(event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}>
          <option value="">最新有数据年份</option>
          {model.yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <button className="dashboard-button dashboard-button-primary" type="button" disabled={pending || selectedYear === result.filters.selectedYear} onClick={applyYear}>应用年度</button>
      </div>
      <section className="dashboard-words-visualization" aria-labelledby="words-visualization-heading">
        <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">关键视图</p><h3 id="words-visualization-heading">词汇概览</h3></div><span className="dashboard-card-kicker">频率 · 年度关键词</span></div>
        <div className="dashboard-words-visualization-grid">
          <div className="dashboard-words-frequency">
            <p className="dashboard-primary-insight">{rankingPreview[0] === undefined ? "当前没有可展示的符合条件文字词汇。" : `“${rankingPreview[0].token}”是当前跨年合并排名中的首位词汇。`}</p>
            <BarChart title="跨年词汇出现次数" description="先看整体频率，再查看排名与逐年比较。" rows={rankingPreview.slice(0, 8).map((word) => ({ label: word.token, value: word.count, displayValue: formatCount(word.count) }))} />
          </div>
          <section className="dashboard-words-keywords" aria-labelledby="keywords-heading">
            <p className="dashboard-eyebrow">年度比较信号</p>
            <h4 id="keywords-heading">年度关键词</h4>
            <p className="dashboard-definition-copy">当前年份中相对突出的候选；不等同于最高频词。</p>
            {selectedKeywordYear?.mode === "insufficient-evidence" ? <p className="dashboard-empty" role="status">当前年份证据不足：{selectedKeywordYear.omissionReason ?? "没有可用候选"}。</p> : null}
            {keywordPreview.length > 0 ? (
              <ol className="dashboard-ranking-list dashboard-keyword-list" aria-label="年度关键词排名">
                {keywordPreview.map((keyword, index) => (
                  <li key={keyword.token}>
                    <span>{index + 1}</span>
                    <strong>{keyword.token}</strong>
                    <b>{formatCount(keyword.count)} 次</b>
                  </li>
                ))}
              </ol>
            ) : <p className="dashboard-empty-inline">当前年份没有可展示的年度关键词。</p>}
            <details className="dashboard-definition dashboard-progressive-disclosure">
              <summary>查看关键词统计明细</summary>
              <p>候选需满足出现次数 ≥ 5 且覆盖消息 ≥ 3；单年份会标为频次回退。</p>
              <Table caption="年度关键词统计依据" columns={["年份", "模式", "词", "次数", "当年词元总数", "其他年份次数", "其他年份词元总数", "消息覆盖", "分数"]} rows={(selectedKeywordYear?.keywords ?? []).map((keyword) => [selectedKeywordYear?.year ?? "—", selectedKeywordYear?.mode ?? "—", keyword.token, formatCount(keyword.count), formatCount(keyword.yearTokenTotal), formatCount(keyword.restCount), formatCount(keyword.restTokenTotal), formatCount(keyword.distinctMessageFrequency), formatMetricValue(keyword.score)])} emptyText="当前年份没有可展示的年度关键词。" />
            </details>
          </section>
        </div>
      </section>
      <section className="dashboard-chart-card dashboard-words-ranking" aria-labelledby="word-ranking-heading">
        <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">主要排名</p><h3 id="word-ranking-heading">主要词汇排名</h3></div><span className="dashboard-card-kicker">最多 12 项</span></div>
        <p className="dashboard-primary-insight">保留出现次数，并同时显示每 10,000 个符合条件词元的频率。</p>
        {rankingPreview.length > 0 ? (
          <ol className="dashboard-ranking-list dashboard-word-ranking-list" aria-label="主要词汇排名">
            {rankingPreview.map((word, index) => (
              <li key={word.token}>
                <span>{index + 1}</span>
                <strong>{word.token}</strong>
                <b>{formatCount(word.count)} 次 · {formatMetricValue(word.ratePer10000)} / 10,000</b>
              </li>
            ))}
          </ol>
        ) : <p className="dashboard-empty" role="status">当前没有可展示的符合条件文字词汇。</p>}
      </section>
      <section className="dashboard-chart-card dashboard-words-year-comparison" aria-labelledby="word-years-heading">
        <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">年度比较</p><h3 id="word-years-heading">逐年比较</h3></div><span className="dashboard-card-kicker">保留部分年份</span></div>
        <p className="dashboard-primary-insight">每年保留周期状态与词元总数；逐词出现次数和频率在明细中查看。</p>
        <Table
          caption="各年词汇概览"
          columns={["年份", "周期", "符合条件词元总数", "词汇单元"]}
          rows={result.stage7.wordEvolution.years.map((year) => [year.year, year.partial ? "部分年份" : "完整年份", formatCount(year.totalTokenCount), formatCount(year.values.length)])}
          emptyText="当前筛选没有符合条件的文字消息。"
        />
      </section>
      <details className="dashboard-definition dashboard-progressive-disclosure dashboard-words-year-details">
        <summary>查看逐年明细</summary>
        <p>保留每年每个词的出现次数、频率和当前排序；展开后可横向查看完整数据。</p>
        <Table caption="跨年词汇逐年数据" columns={["年份", "周期", "词元总数", "词汇值"]} rows={result.stage7.wordEvolution.years.map((year) => [year.year, year.partial ? "部分年份" : "完整年份", formatCount(year.totalTokenCount), year.values.map((cell) => `${cell.token}: ${formatCount(cell.count)} / ${formatMetricValue(cell.ratePer10000)} / 10,000`).join("；") || "—"])} emptyText="当前筛选没有符合条件的文字消息。" />
      </details>
      <details className="dashboard-definition dashboard-progressive-disclosure dashboard-words-methodology">
        <summary>查看统计口径与摘要依据</summary>
        <p>关键词分数、次数、当年总量、其他年份总量和消息覆盖均由本地结果提供；摘要使用固定本地模板。</p>
        {result.stage7.summary.clauses.length === 0 ? <p className="dashboard-empty" role="status">当前筛选没有足够证据形成固定摘要。</p> : <ol className="dashboard-summary-list">{result.stage7.summary.clauses.map((clause) => <li key={clause.id}><span>{clause.text}</span><details><summary>查看依据</summary><small>{clause.trace.metricId} · {clause.trace.definitionVersion}</small><p>{clause.trace.filters.startDate} → {clause.trace.filters.endDate} · {senderLabel(clause.trace.filters.sender)}</p><dl>{Object.entries(clause.trace.values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value === null ? "—" : String(value)}</dd></div>)}</dl></details></li>)}</ol>}
        {result.stage7.summary.omissions.length > 0 ? <details className="dashboard-definition"><summary>查看省略原因</summary><ul>{result.stage7.summary.omissions.map((omission) => <li key={omission.metricId}>{omission.metricId}：{omission.reason}</li>)}</ul></details> : null}
        <p>这些结果不表达情感、关系质量、心理状态或真实意图。</p>
      </details>
    </section>
  );
}

function MessageTypesPage({ result }: { readonly result: CanonicalAnalysisResult }) {
  const categoryRows = result.stage7.messageTypes.categories.map((bucket) => ({
    label: categoryLabel(bucket.category),
    value: bucket.count,
    displayValue: `${formatCount(bucket.count)} · ${formatShare(bucket.share)}`,
  }));
  return (
    <section className="dashboard-page" aria-labelledby="types-page-heading">
      <PageHeading eyebrow="06 / 消息类型" id="types-page-heading" title="消息类型" description="消息类别按固定顺序展示；系统诊断独立于用户消息分母。" schema={result.stage7.messageTypes.schemaVersion} />
      <section className="dashboard-chart-card" aria-labelledby="types-chart-heading">
        <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">类别条</p><h3 id="types-chart-heading">用户消息类别</h3></div><span className="dashboard-card-kicker">数量 · 占比</span></div>
        {result.stage7.messageTypes.denominator === 0 ? <p className="dashboard-empty" role="status">当前筛选没有用户消息类别。</p> : null}
        <BarChart title="类别计数与占比" description={`分母：${formatCount(result.stage7.messageTypes.denominator)} 条筛选后的用户消息。`} rows={categoryRows} />
        <details className="dashboard-definition dashboard-progressive-disclosure">
          <summary>查看精确类别统计</summary>
          <Table caption="精确消息类别统计" columns={["类别", "消息数", "占比"]} rows={result.stage7.messageTypes.categories.map((bucket) => [categoryLabel(bucket.category), formatCount(bucket.count), formatShare(bucket.share)])} />
        </details>
        <dl className="dashboard-inline-metrics">
          <div><dt>符合条件文字</dt><dd>{formatCount(result.stage7.messageTypes.eligibleTextCount)}</dd></div>
          <div><dt>系统诊断</dt><dd>{formatCount(result.stage7.messageTypes.systemDiagnosticCount)}</dd></div>
        </dl>
      </section>
      <Definition>
        <p>文字类别包含符合与不符合规则的文字消息；未知类别保持可见；系统消息不进入用户消息占比的分母。</p>
      </Definition>
    </section>
  );
}

function RepliesSessionsPage({
  result,
  onLocalFilterChange,
  pending,
}: {
  readonly result: CanonicalAnalysisResult;
  readonly onLocalFilterChange: (filters: CanonicalAnalysisFilters) => void;
  readonly pending: boolean;
}) {
  const [threshold, setThreshold] = useState(result.filters.sessionThresholdHours);
  useEffect(() => setThreshold(result.filters.sessionThresholdHours), [result.filters.sessionThresholdHours]);
  const replies = result.replySessions.replyIntervals;
  const sessions = result.replySessions.conversationSessions;
  return (
    <section className="dashboard-page" aria-labelledby="replies-page-heading">
      <PageHeading eyebrow="07 / 回复与会话" id="replies-page-heading" title="回复与会话" description="回复间隔只描述时间差；会话开场次数是阈值敏感的比较统计。" schema={replies.schemaVersion} />
      <div className="dashboard-local-control">
        <label htmlFor="dashboard-threshold">不活跃阈值</label>
        <select id="dashboard-threshold" value={threshold} onChange={(event) => setThreshold(Number(event.currentTarget.value) as typeof threshold)}>
          {[1, 3, 6, 12, 24].map((hours) => <option key={hours} value={hours}>{hours} 小时</option>)}
        </select>
        <button className="dashboard-button dashboard-button-primary" type="button" disabled={pending || threshold === result.filters.sessionThresholdHours} onClick={() => onLocalFilterChange({ ...result.filters, sessionThresholdHours: threshold })}>应用阈值</button>
        <span className="dashboard-control-note">只重新计算回复、会话、开场次数和依赖它们的摘要。</span>
      </div>
      <p className="dashboard-scope-note">当前阈值：{replies.thresholdHours} 小时 · 两端消息都必须在日期范围内 · 发送方筛选不适用于回复和开场统计。</p>
      <div className="dashboard-replies-summary">
        <MetricCard
          label="会话数量"
          value={formatCount(sessions.sessionCount)}
          unit="个会话"
          variant="hero"
          className="dashboard-replies-hero"
          definition={"阈值为 " + sessions.thresholdHours + " 小时；会话数量是阈值敏感统计。"}
        />
        <MetricCard
          label="整体回复间隔中位数"
          value={formatSeconds(replies.overall.medianSeconds)}
          variant="standard"
          definition="只描述可判定回复区间的时间差；样本量见详细数据。"
        />
        <section className="dashboard-replies-initiators" aria-labelledby="initiator-summary-heading">
          <div className="dashboard-card-heading-row"><div><p className="dashboard-eyebrow">开场发送方</p><h3 id="initiator-summary-heading">会话开场发送方</h3></div><span className="dashboard-card-kicker">{formatCount(sessions.shareDenominator)} 个样本</span></div>
          <BarChart title="会话开场次数" description="未知保留为独立类别。" rows={[sessions.initiatorCounts.owner, sessions.initiatorCounts.other, sessions.initiatorCounts.unknown].map((bucket) => ({ label: bucket.initiator, value: bucket.count, displayValue: formatCount(bucket.count) + " · " + formatShare(bucket.share) }))} />
        </section>
      </div>
      <details className="dashboard-definition dashboard-progressive-disclosure dashboard-replies-details">
        <summary>查看回复方向与区间分布</summary>
        <div className="dashboard-two-column">
        <section className="dashboard-chart-card" aria-labelledby="reply-stats-heading">
          <h3 id="reply-stats-heading">按回复方查看回复间隔</h3>
          <Table caption="回复方向与回复方统计" columns={["方向", "回复方", "数量", "平均", "p25", "中位数", "p75", "p90"]} rows={replies.directions.map((direction) => [direction.direction, direction.responder, formatCount(direction.stats.count), formatSeconds(direction.stats.meanSeconds), formatSeconds(direction.stats.p25Seconds), formatSeconds(direction.stats.medianSeconds), formatSeconds(direction.stats.p75Seconds), formatSeconds(direction.stats.p90Seconds)])} emptyText="当前筛选没有可判定的回复间隔。" />
        </section>
        <section className="dashboard-chart-card" aria-labelledby="reply-bins-heading">
          <h3 id="reply-bins-heading">回复区间分布</h3>
          <BarChart title="回复间隔分布" description="长于当前阈值的间隔被视为新会话，不作为回复。" rows={replies.overall.bins.map((bin) => ({ label: bin.label, value: bin.count, displayValue: formatCount(bin.count) }))} />
          <Table caption="回复区间分组" columns={["区间", "最小秒数", "最大秒数", "数量"]} rows={replies.overall.bins.map((bin) => [bin.label, formatCount(bin.minSeconds), formatCount(bin.maxSeconds), formatCount(bin.count)])} />
        </section>
      </div>
      </details>
      <section className="dashboard-chart-card" aria-labelledby="initiator-heading">
        <h3 id="initiator-heading">会话开场次数</h3>
        <p className="dashboard-definition-copy">会话使用首条用户消息的日期；跨午夜本身不分会话；该统计不是关系质量判断。</p>
        <Table caption="会话开场次数与占比" columns={["开场发送方", "数量", "占比"]} rows={[sessions.initiatorCounts.owner, sessions.initiatorCounts.other, sessions.initiatorCounts.unknown].map((bucket) => [bucket.initiator, formatCount(bucket.count), formatShare(bucket.share)])} emptyText="当前筛选没有会话。" />
        <dl className="dashboard-inline-metrics"><div><dt>会话总数</dt><dd>{formatCount(sessions.sessionCount)}</dd></div><div><dt>阈值敏感</dt><dd>{sessions.sensitivityChanged ? "是" : "默认阈值"}</dd></div></dl>
      </section>
      <Definition>
        <p>{replies.excludedGapRule === "strictly-greater-gap-starts-new-session" ? "gap 严格大于阈值才开始新会话；等于阈值仍属于当前会话。" : "当前 DTO 提供的 offline-gap 规则已应用。"}</p>
        <p>system events 不会启动、桥接或拆分会话；连续同一发送方消息作为一个 burst。</p>
      </Definition>
    </section>
  );
}

function ExportPage({
  result,
  pending,
  draftFilters,
  onExport,
}: {
  readonly result: CanonicalAnalysisResult;
  readonly pending: boolean;
  readonly draftFilters: CanonicalAnalysisFilters;
  readonly onExport: (format: ReportFormat, chartKey: ApprovedChartKey) => void;
}) {
  const [selectedChart, setSelectedChart] = useState<ApprovedChartKey>("trends");
  const stale = pending || !filtersEqual(draftFilters, result.filters);
  const reason = pending ? "本地计算进行中，等待完整结果代次。" : stale ? "筛选草稿尚未提交，不能导出旧代次。" : undefined;
  return (
    <section className="dashboard-page" aria-labelledby="export-page-heading">
      <PageHeading eyebrow="08 / EXPORT" id="export-page-heading" title="导出" description="导出只包含当前已提交的聚合结果；每份文件都标记为本地敏感数据。" schema={result.schemaVersion} />
      <section className="dashboard-export-preview" aria-labelledby="export-preview-heading">
        <h3 id="export-preview-heading">导出预览</h3>
        <dl className="dashboard-export-meta">
          <div><dt>数据范围</dt><dd>{result.filters.startDate} → {result.filters.endDate}</dd></div>
          <div><dt>发送方范围</dt><dd>{senderLabel(result.filters.sender)}</dd></div>
          <div><dt>时区</dt><dd>UTC+08:00</dd></div>
          <div><dt>结果范围</dt><dd>当前已提交结果</dd></div>
          <div><dt>会话阈值</dt><dd>{result.filters.sessionThresholdHours} 小时</dd></div>
          <div><dt>包含字段</dt><dd>聚合计数、占比、趋势、类别、时间差、会话、筛选、定义版本、周期状态</dd></div>
          <div><dt>排除字段</dt><dd>正文、参与者、标识符、路径、词元、关键词、源元数据</dd></div>
        </dl>
        <DeveloperDetails label="查看结果代次" value={String(result.generation)} />
        <label className="dashboard-export-chart-select" htmlFor="dashboard-export-chart">
          PNG 图表
          <select
            id="dashboard-export-chart"
            value={selectedChart}
            onChange={(event) => setSelectedChart(event.currentTarget.value as ApprovedChartKey)}
            disabled={stale}
          >
            <option value="trends">趋势</option>
            <option value="sender-comparison">发送方比较</option>
            <option value="hour">小时分布</option>
            <option value="weekday">星期分布</option>
            <option value="message-types">消息类型</option>
            <option value="reply-bins">回复区间</option>
            <option value="initiator-counts">会话开场次数</option>
          </select>
        </label>
        <div className="dashboard-export-actions" aria-describedby={reason === undefined ? undefined : "export-disabled-reason"}>
          <button className="dashboard-button dashboard-button-primary" type="button" disabled={stale} onClick={() => onExport("png", selectedChart)}>导出批准图表 PNG</button>
          <button className="dashboard-button" type="button" disabled={stale} onClick={() => onExport("csv", selectedChart)}>导出聚合 CSV</button>
          <button className="dashboard-button" type="button" disabled={stale} onClick={() => onExport("json", selectedChart)}>导出聚合 JSON</button>
        </div>
        {reason !== undefined ? <p id="export-disabled-reason" className="dashboard-empty" role="status">{reason}</p> : null}
        <p className="dashboard-definition-copy">当前筛选、时区和阈值会写入导出契约；文件不包含正文、词元级源文本、参与者身份、标识符、源路径或隐藏元数据。</p>
        <p className="dashboard-export-warning" role="note">本地聚合数据仍可能包含敏感信息，请谨慎选择保存位置和分享对象。</p>
      </section>
      <Definition>
        <p>导出通过原生保存流程完成；取消保存不会改变当前结果。</p>
        <p>聚合结果仍可能敏感，请只保存到你选择的本地位置。</p>
      </Definition>
    </section>
  );
}

function PageHeading({ eyebrow, id, title, description, schema }: { readonly eyebrow: string; readonly id: string; readonly title: string; readonly description: string; readonly schema: string }) {
  return (
    <div className="dashboard-page-heading">
      <div><p className="dashboard-eyebrow">{eyebrow}</p><h2 id={id} tabIndex={-1}>{title}</h2><p>{description}</p></div>
      <DeveloperDetails value={schema} />
    </div>
  );
}

function MethodologyLedger({ result }: { readonly result: CanonicalAnalysisResult }) {
  const facts = methodologyFacts();
  const groups = [
    { id: "population", title: "Population", facts: [facts[1]] },
    { id: "scope", title: "Scope", facts: [facts[0], facts[3]] },
    { id: "timezone", title: "Timezone", facts: [facts[2]] },
    { id: "exceptions", title: "Exceptions", facts: [facts[4]] },
  ] as const;
  return (
    <details className="dashboard-methodology">
      <summary id="dashboard-methodology-heading">
        <span>查看口径与方法</span>
        <small>Population · Scope · Timezone · Exceptions · Version</small>
      </summary>
      <div className="dashboard-methodology-ledger">
        <nav aria-label="方法分组">
          {groups.map((group) => <a key={group.id} href={`#dashboard-method-${group.id}`}>{group.title}</a>)}
          <a href="#dashboard-method-version">Version</a>
        </nav>
        <div className="dashboard-methodology-groups">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`dashboard-method-${group.id}`}>
              <h3 id={`dashboard-method-${group.id}`}>{group.title}</h3>
              <dl>
                {group.facts.map((fact) => fact === undefined ? null : (
                  <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                ))}
              </dl>
            </section>
          ))}
          <section aria-labelledby="dashboard-method-version">
            <h3 id="dashboard-method-version">Version</h3>
            <dl>
              <div><dt>结果版本</dt><dd>{result.schemaVersion}</dd></div>
              <div><dt>结果代次</dt><dd>{result.generation}</dd></div>
            </dl>
          </section>
        </div>
        <p className="dashboard-methodology-note">统计描述数据分布、时间差和阈值，不提供情感、关系质量或心理推断。</p>
      </div>
    </details>
  );
}

function DashboardNavigation({ route, onRouteChange }: { readonly route: DashboardRoute; readonly onRouteChange: (route: DashboardRoute, focusTarget: "content" | "rail") => void }) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();
    const current = routeIndex(route);
    const next = event.key === "Home" ? 0 : event.key === "End" ? DASHBOARD_ROUTES.length - 1 : event.key === "ArrowRight" ? current + 1 : current - 1;
    const nextRoute = routeAt(next);
    onRouteChange(nextRoute, "rail");
    window.setTimeout(() => buttonRefs.current[routeIndex(nextRoute)]?.focus(), 0);
  }
  return (
    <nav className="dashboard-navigation dashboard-tab-rail" aria-label="结果导航">
      <div className="dashboard-tab-rail-heading" aria-hidden="true">分析章节</div>
      <div className="dashboard-tablist-wrap">
      <div className="dashboard-tablist" role="tablist" aria-label="分析结果页面">
        {DASHBOARD_ROUTES.map((item, index) => (
          <button
            key={item}
            ref={(element) => { buttonRefs.current[index] = element; }}
            className={item === route ? "is-current" : undefined}
            type="button"
            role="tab"
            aria-selected={item === route}
            aria-current={item === route ? "page" : undefined}
            aria-controls={`dashboard-panel-${index}`}
            id={`dashboard-tab-${index}`}
            tabIndex={item === route ? 0 : -1}
            title={ROUTE_DESCRIPTIONS[item]}
            onClick={() => onRouteChange(item, "content")}
            onKeyDown={onKeyDown}
          >
            <span className="dashboard-route-folio" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span>{DASHBOARD_ROUTE_LABELS[item]}</span>
          </button>
        ))}
      </div>
      <span className="dashboard-rail-overflow-cue" aria-hidden="true">横向滚动查看更多</span>
      </div>
    </nav>
  );
}

export function DesktopDashboard({
  result,
  pending,
  onFilterChange,
  onAnalyzeOtherFiles,
  onExport,
  initialRoute = "Overview",
  onRouteChange,
}: DesktopDashboardProps) {
  const model = useMemo(() => createDashboardViewModel(result), [result]);
  const [route, setRoute] = useState<DashboardRoute>(initialRoute);
  const [draftFilters, setDraftFilters] = useState<CanonicalAnalysisFilters>(result.filters);
  const [filterErrors, setFilterErrors] = useState<FilterErrors>({});
  const headingRef = useRef<HTMLDivElement>(null);
  const firstRouteRender = useRef(true);
  const routeFocusTarget = useRef<"content" | "rail">("content");

  useEffect(() => {
    setDraftFilters(result.filters);
    setFilterErrors({});
  }, [result.filters]);

  useEffect(() => {
    if (firstRouteRender.current) {
      firstRouteRender.current = false;
      return;
    }
    const focusTarget = routeFocusTarget.current;
    routeFocusTarget.current = "content";
    if (focusTarget === "rail") {
      return;
    }
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }, [route]);

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const validation = validateDashboardFilters(draftFilters, result.dataset);
    setFilterErrors(validation.errors);
    if (validation.filters !== undefined) {
      onFilterChange(validation.filters);
    }
  }

  function updateDraft(patch: Partial<CanonicalAnalysisFilters>): void {
    setDraftFilters((current) => ({ ...current, ...patch }));
    setFilterErrors({});
  }

  function handleRouteChange(next: DashboardRoute, focusTarget: "content" | "rail" = "content"): void {
    routeFocusTarget.current = focusTarget;
    setRoute(next);
    onRouteChange?.(next);
  }

  const activePanelIndex = routeIndex(route);
  const draftDirty = !filtersEqual(draftFilters, result.filters);
  return (
    <section id="beta-main-content" className="dashboard-shell dashboard-content-shell" aria-label="本地分析结果工作区" aria-busy={pending} tabIndex={-1}>
      <header className="dashboard-context-strip" aria-label="当前分析上下文">
        <div className="dashboard-context-title">
          <p className="dashboard-eyebrow">本地分析 · 详细</p>
          <h1>详细分析</h1>
          <span className="dashboard-local-badge">仅本地处理</span>
        </div>
        <ScopeLine result={result} />
        <button className="dashboard-context-action" type="button" onClick={onAnalyzeOtherFiles}>分析其他文件</button>
      </header>
      <form className="dashboard-filter-bar dashboard-filter-toolbar dashboard-query-bar" aria-labelledby="dashboard-filters-heading" aria-describedby="dashboard-draft-status" onSubmit={submitFilters}>
        <div className="dashboard-filter-heading"><div><p className="dashboard-eyebrow">筛选草稿</p><h2 id="dashboard-filters-heading">调整分析范围</h2></div><span id="dashboard-draft-status" className="dashboard-draft-status" data-dirty={draftDirty ? "true" : "false"} aria-live="polite">{draftDirty ? "有未应用更改" : "与当前分析一致"}</span></div>
        <label>开始日期<input name="startDate" autoComplete="off" type="date" value={draftFilters.startDate} min={result.dataset.minimumCalendarDate} max={result.dataset.maximumCalendarDate} aria-invalid={filterErrors.startDate !== undefined || filterErrors.range !== undefined} aria-describedby={filterErrors.startDate !== undefined ? "dashboard-start-error" : filterErrors.range !== undefined ? "dashboard-range-error" : undefined} onChange={(event) => updateDraft({ startDate: event.currentTarget.value })} /></label>
        <label>结束日期<input name="endDate" autoComplete="off" type="date" value={draftFilters.endDate} min={result.dataset.minimumCalendarDate} max={result.dataset.maximumCalendarDate} aria-invalid={filterErrors.endDate !== undefined || filterErrors.range !== undefined} aria-describedby={filterErrors.endDate !== undefined ? "dashboard-end-error" : filterErrors.range !== undefined ? "dashboard-range-error" : undefined} onChange={(event) => updateDraft({ endDate: event.currentTarget.value })} /></label>
        <label>发送方<select name="sender" autoComplete="off" value={draftFilters.sender} onChange={(event) => updateDraft({ sender: event.currentTarget.value as CanonicalAnalysisFilters["sender"] })}><option value="both">Owner 与 Other</option><option value="owner">仅 Owner</option><option value="other">仅 Other</option></select></label>
        <button className="dashboard-button dashboard-button-primary" type="submit" disabled={pending || !draftDirty}>应用筛选</button>
        {filterErrors.startDate !== undefined ? <p id="dashboard-start-error" className="dashboard-field-error" role="alert">{filterErrors.startDate}</p> : null}
        {filterErrors.endDate !== undefined ? <p id="dashboard-end-error" className="dashboard-field-error" role="alert">{filterErrors.endDate}</p> : null}
        {filterErrors.range !== undefined ? <p id="dashboard-range-error" className="dashboard-field-error" role="alert">{filterErrors.range}</p> : null}
      </form>
      {pending ? <div className="dashboard-pending" role="status" aria-live="polite"><strong>正在本地更新统计</strong><span>上一次完整结果仍可阅读；当前筛选未完成前不能导出。</span></div> : null}
      <div className="dashboard-workspace-grid" data-layout-mode="ledger">
        <DashboardNavigation route={route} onRouteChange={handleRouteChange} />
        <div className="dashboard-canvas-stack">
          <div ref={headingRef} id={`dashboard-panel-${activePanelIndex}`} role="tabpanel" aria-labelledby={`dashboard-tab-${activePanelIndex}`} tabIndex={-1} aria-label={DASHBOARD_ROUTE_LABELS[route]} className="dashboard-panel-wrap dashboard-content-canvas" data-route={route}>
            <div className="dashboard-route-transition" key={route}>
              {route === "Overview" ? <OverviewPage model={model} onNavigate={handleRouteChange} /> : null}
              {route === "Trends" ? <TrendsPage result={result} /> : null}
              {route === "Comparison" ? <ComparisonPage result={result} /> : null}
              {route === "Activity" ? <ActivityPage result={result} /> : null}
              {route === "Words & Years" ? <WordsYearsPage model={model} onLocalFilterChange={onFilterChange} pending={pending} /> : null}
              {route === "Message Types" ? <MessageTypesPage result={result} /> : null}
              {route === "Replies & Sessions" ? <RepliesSessionsPage result={result} onLocalFilterChange={onFilterChange} pending={pending} /> : null}
              {route === "Export" ? <ExportPage result={result} pending={pending} draftFilters={draftFilters} onExport={onExport} /> : null}
            </div>
          </div>
          <MethodologyLedger result={result} />
        </div>
      </div>
    </section>
  );
}
