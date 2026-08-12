import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import type {
  BetaLocalizedMetricV1,
  BetaLocalizedReportSectionV1,
  BetaLocalizedVisualV1,
  BetaReportViewModelV1,
} from "./report-contract";
import type { BetaReportSectionId } from "./report-sections";
import {
  Annotation,
  ArtworkFrame,
  Metric,
  Scene,
  SceneIntro,
  StatusPill,
  StoryGrid,
} from "./primitives";
import annualOpeningHero from "../../assets/beta/art/annual-opening-hero-v1.webp";

const SCENE_LABELS = {
  opening: "开场",
  scale: "规模",
  rhythm: "节奏",
  balance: "平衡",
  conversation: "交流",
  vocabulary: "词汇",
  closing: "收束",
} as const;

type VisualRow = BetaLocalizedVisualV1["rows"][number];

export interface MonthMatrixGroup {
  readonly year: string;
  readonly months: readonly (VisualRow | null)[];
}

/** Presentation-only grouping for the existing month rows. No values are derived. */
export function groupMonthRows(rows: readonly VisualRow[]): readonly MonthMatrixGroup[] {
  const groups = new Map<string, Map<number, VisualRow>>();
  for (const row of rows) {
    const [yearPart, monthPart] = row.key.split("-");
    const year = yearPart ?? "当前范围";
    const month = Number(monthPart);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      continue;
    }
    const months = groups.get(year) ?? new Map<number, VisualRow>();
    months.set(month, row);
    groups.set(year, months);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([year, months]) => ({
      year,
      months: Array.from({ length: 12 }, (_, index) => months.get(index + 1) ?? null),
    }));
}

/**
 * Presentation-only scaling for SVG marks. Exact values remain in text/table
 * alternatives; this helper changes only the relative drawing size.
 */
export function visualMarkerScale(
  normalizedValue: number,
  bounds: { readonly minimum: number; readonly maximum: number },
): number {
  const ratio = Number.isFinite(normalizedValue)
    ? Math.min(1, Math.max(0, normalizedValue))
    : 0;
  const minimum = Math.max(0, bounds.minimum);
  const maximum = Math.max(minimum, bounds.maximum);
  return ratio === 0 ? 0 : minimum + (maximum - minimum) * ratio;
}

function statusTone(status: BetaLocalizedReportSectionV1["status"]): "pending" | "warning" {
  return status === "PARTIAL" ? "pending" : "warning";
}

function sectionFor(
  sections: readonly BetaLocalizedReportSectionV1[],
  id: BetaReportSectionId,
): BetaLocalizedReportSectionV1 {
  const section = sections.find((candidate) => candidate.id === id);
  if (section === undefined) {
    throw new Error(`BETA_SECTION_MISSING:${id}`);
  }
  return section;
}

function peakLabels(rows: readonly VisualRow[]): string {
  const labels = rows.filter((row) => row.widthPercent >= 100).map((row) => row.label);
  return labels.length === 0 ? "暂无峰值" : `峰值：${labels.join("、")}`;
}

function SceneHeading({
  number,
  scene,
  title,
  summary,
}: {
  readonly number: string;
  readonly scene: keyof typeof SCENE_LABELS;
  readonly title: string;
  readonly summary: string;
}) {
  return (
    <SceneIntro
      number={number}
      kicker={SCENE_LABELS[scene]}
      title={title}
      summary={summary}
      headingId={`v3-scene-${scene}-heading`}
      className={`v3-scene-intro-${scene}`}
    />
  );
}

function SectionHeader({ section }: { readonly section: BetaLocalizedReportSectionV1 }) {
  return (
    <header className="v3-logical-header">
      <div>
        <p className="v3-logical-kicker">
          {section.eyebrow} · {String(section.order).padStart(2, "0")}
        </p>
        <h3 className="v3-logical-title">{section.heading}</h3>
      </div>
      {section.status === "READY" ? null : (
        <StatusPill tone={statusTone(section.status)}>{section.statusLabel}</StatusPill>
      )}
    </header>
  );
}

function DetailList({
  section,
  includeScope = true,
}: {
  readonly section: BetaLocalizedReportSectionV1;
  readonly includeScope?: boolean;
}) {
  const rows = [
    ...(includeScope && section.scopeNote !== null ? [{ label: "当前范围", value: section.scopeNote }] : []),
    ...section.details,
  ];
  if (rows.length === 0) {
    return null;
  }
  return (
    <dl className="v3-detail-list" data-v3-meaningful="details">
      {rows.map((detail) => (
        <div key={`${detail.label}-${detail.value}`}>
          <dt>{detail.label}</dt>
          <dd>{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MetricLine({
  metric,
  className = "",
}: {
  readonly metric: BetaLocalizedMetricV1 | null;
  readonly className?: string;
}) {
  if (metric === null) {
    return null;
  }
  return (
    <Metric
      className={`v3-logical-metric ${className}`.trim()}
      label={metric.label}
      value={metric.value}
      unit={metric.unit}
      description={metric.accessibleLabel}
    />
  );
}

function ExactVisualTableContent({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  const rows = visual.detailRows ?? visual.rows;
  return (
    <table className="v3-visual-table">
      <caption>{visual.ariaLabel}</caption>
      <thead>
        <tr>
          <th scope="col">项目</th>
          <th scope="col">数值</th>
          <th scope="col">补充</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{row.displayValue}</td>
            <td>{row.secondaryLabel ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExactVisualTable({
  visual,
  summary = "查看完整数据",
}: {
  readonly visual: BetaLocalizedVisualV1;
  readonly summary?: string;
}) {
  return (
    <details className="v3-visual-details" data-v3-visual-details="true">
      <summary>{summary}</summary>
      <ExactVisualTableContent visual={visual} />
    </details>
  );
}

function LogicalSection({
  section,
  className = "",
  children,
  ...props
}: {
  readonly section: BetaLocalizedReportSectionV1;
  readonly className?: string;
  readonly children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "id">) {
  return (
    <article
      {...props}
      id={section.id}
      className={`v3-logical-section v3-logical-${section.id} ${className}`.trim()}
      data-section-status={section.status.toLowerCase()}
      data-scene={section.scene}
    >
      <SectionHeader section={section} />
      <p className="v3-logical-lead">{section.lead}</p>
      <MetricLine metric={section.metric} />
      {children}
      <DetailList section={section} />
    </article>
  );
}

function SectionStatus({
  section,
  hidePartial = false,
}: {
  readonly section: BetaLocalizedReportSectionV1;
  readonly hidePartial?: boolean;
}) {
  return section.status === "READY" || (hidePartial && section.status === "PARTIAL")
    ? null
    : <StatusPill tone={statusTone(section.status)}>{section.statusLabel}</StatusPill>;
}

function CompactEvidenceHeader({ section }: { readonly section: BetaLocalizedReportSectionV1 }) {
  return (
    <header className="v3-compact-evidence-header">
      <div>
        <h3 className="v3-logical-title">{section.heading}</h3>
        <p className="v3-logical-lead">{section.lead}</p>
      </div>
      <MetricLine metric={section.metric} className="v3-compact-evidence-metric" />
      <SectionStatus section={section} hidePartial />
    </header>
  );
}

function RhythmSectionHeader({ section }: { readonly section: BetaLocalizedReportSectionV1 }) {
  return (
    <header className="v3-rhythm-section-header">
      <div>
        <p className="v3-logical-kicker">
          {section.eyebrow} · {String(section.order).padStart(2, "0")}
        </p>
        <h3 className="v3-logical-title">{section.heading}</h3>
        <p className="v3-logical-lead">{section.lead}</p>
      </div>
      {section.metric === null ? null : (
        <p className="v3-rhythm-peak-annotation" aria-label={section.metric.accessibleLabel}>
          <span>{section.metric.label}</span>
          <strong>{section.metric.value}{section.metric.unit === "" ? "" : ` ${section.metric.unit}`}</strong>
        </p>
      )}
      <SectionStatus section={section} hidePartial />
    </header>
  );
}

function InlineSectionFacts({ section }: { readonly section: BetaLocalizedReportSectionV1 }) {
  const rows = [
    ...section.details,
  ];
  return rows.length === 0 ? null : (
    <dl className="v3-inline-facts">
      {rows.map((detail) => (
        <div key={`${detail.label}-${detail.value}`}>
          <dt>{detail.label}</dt>
          <dd>{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MonthCadence({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  const groups = groupMonthRows(visual.rows);
  return (
    <figure className="v3-visual v3-month-cadence" data-rhythm-visual="month-cadence" aria-label={visual.ariaLabel}>
      <div className="v3-month-matrix-grid">
        <div className="v3-month-matrix-head" aria-hidden="true">
          <span>年份</span>
          {Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        {groups.map((group) => (
          <div className="v3-month-matrix-row" key={group.year}>
            <strong>{group.year}</strong>
            <ol>
              {group.months.map((row, index) => {
                const label = row?.label ?? `${group.year} 年 ${index + 1} 月`;
                const displayValue = row?.displayValue ?? "0 条";
                const secondaryLabel = row?.secondaryLabel;
                const normalizedValue = (row?.widthPercent ?? 0) / 100;
                const radius = visualMarkerScale(normalizedValue, { minimum: 4, maximum: 15 });
                const isPeak = row?.widthPercent === 100;
                return (
                  <li
                    key={row?.key ?? `${group.year}-${index + 1}`}
                    data-cadence-cell="true"
                    data-zero={normalizedValue === 0 ? "true" : undefined}
                    data-peak={isPeak ? "true" : undefined}
                    data-partial={secondaryLabel !== null && secondaryLabel !== undefined ? "true" : undefined}
                    aria-label={`${label}：${displayValue}${secondaryLabel === null || secondaryLabel === undefined ? "" : `；${secondaryLabel}`}`}
                    style={{ "--v3-cadence-delay": `${30 + index * 36}ms` } as CSSProperties}
                  >
                    <svg viewBox="0 0 44 44" role="presentation" aria-hidden="true" focusable="false">
                      <g className="v3-cadence-mark">
                        <circle className="v3-cadence-orbit" cx="22" cy="22" r="18" />
                        <circle className="v3-cadence-value" cx="22" cy="22" r={radius} />
                        <path className="v3-cadence-register" d="M8 35.5H36" />
                        {isPeak ? (
                          <>
                            <circle className="v3-cadence-peak-ring" cx="22" cy="22" r="18" />
                            <path className="v3-cadence-peak-notch" d="M22 2V8" />
                          </>
                        ) : null}
                      </g>
                    </svg>
                    {isPeak ? <span className="v3-cadence-peak-label" aria-hidden="true">峰</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <figcaption className="v3-visual-caption">
        {visual.ariaLabel}；{peakLabels(visual.rows)}。圆形档案印记表达相对节奏，斜纹表示部分月份。
      </figcaption>
    </figure>
  );
}

function WeekdayBeats({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="v3-visual v3-weekday-beats" data-rhythm-visual="weekday-beat" aria-label={visual.ariaLabel}>
      <ol className="v3-weekday-seal-list" aria-hidden="true">
        {visual.rows.map((row, index) => {
          const normalizedValue = row.widthPercent / 100;
          const inkSize = visualMarkerScale(normalizedValue, { minimum: 8, maximum: 42 });
          const isPeak = row.widthPercent === 100;
          return (
            <li
              key={row.key}
              className="v3-beat-marker"
              data-beat-marker="true"
              data-zero={normalizedValue === 0 ? "true" : undefined}
              data-peak={isPeak ? "true" : undefined}
              style={{ "--v3-marker-delay": `${40 + index * 44}ms` } as CSSProperties}
            >
              <span className="v3-beat-seal" data-beat-seal="true">
                <span
                  className="v3-beat-ink"
                  style={{ "--v3-ink-size": `${inkSize}px` } as CSSProperties}
                />
              </span>
              <strong className="v3-beat-label">{row.label}</strong>
              <span className="v3-beat-value">{row.displayValue}</span>
              {isPeak ? <span className="v3-beat-peak-label">峰值</span> : null}
            </li>
          );
        })}
      </ol>
      <figcaption className="v3-visual-caption">
        {visual.ariaLabel}；{peakLabels(visual.rows)}。七枚固定节拍印章沿同一轨道排列，内部墨迹表达相对强弱。
      </figcaption>
    </figure>
  );
}

function HourPulse({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  const anchorHours = new Set([0, 6, 12, 18, 23]);
  return (
    <figure className="v3-visual v3-hour-pulse" data-rhythm-visual="hour-pulse" aria-label={visual.ariaLabel}>
      <ol className="v3-hour-register-list" aria-hidden="true">
        {visual.rows.map((row, index) => {
          const hour = Number(row.key);
          const normalizedValue = row.widthPercent / 100;
          const inkSize = visualMarkerScale(normalizedValue, { minimum: 3, maximum: 13 });
          const isPeak = row.widthPercent === 100;
          return (
            <li
              key={row.key}
              className="v3-pulse-marker"
              data-pulse-marker="true"
              data-hour-index={index}
              data-zero={normalizedValue === 0 ? "true" : undefined}
              data-peak={isPeak ? "true" : undefined}
              style={{ "--v3-marker-delay": `${30 + index * 14}ms` } as CSSProperties}
            >
              <span className="v3-hour-aperture" data-hour-aperture="true">
                <span
                  className="v3-hour-ink"
                  style={{ "--v3-ink-size": `${inkSize}px` } as CSSProperties}
                />
              </span>
              {anchorHours.has(hour) ? (
                <span data-hour-anchor="true" className="v3-hour-label">
                  {String(hour).padStart(2, "0")}
                </span>
              ) : null}
              {isPeak ? <span className="v3-hour-peak-label">峰</span> : null}
            </li>
          );
        })}
      </ol>
      <figcaption className="v3-visual-caption">
        {visual.ariaLabel}；{peakLabels(visual.rows)}。24 个固定时间孔位登记在计时轨道上，不移动、不连接、不插值。
      </figcaption>
    </figure>
  );
}

function RhythmEvidenceZone({
  month,
  weekday,
  hour,
}: {
  readonly month: BetaLocalizedVisualV1;
  readonly weekday: BetaLocalizedVisualV1;
  readonly hour: BetaLocalizedVisualV1;
}) {
  return (
    <details className="v3-visual-details v3-rhythm-evidence-zone" data-v3-visual-details="true">
      <summary>查看完整月份、星期与小时数据</summary>
      <div className="v3-rhythm-evidence-tables">
        <section data-rhythm-evidence="month" aria-labelledby="v3-rhythm-evidence-month-heading">
          <h4 id="v3-rhythm-evidence-month-heading">月份</h4>
          <ExactVisualTableContent visual={month} />
        </section>
        <section data-rhythm-evidence="weekday" aria-labelledby="v3-rhythm-evidence-weekday-heading">
          <h4 id="v3-rhythm-evidence-weekday-heading">星期</h4>
          <ExactVisualTableContent visual={weekday} />
        </section>
        <section data-rhythm-evidence="hour" aria-labelledby="v3-rhythm-evidence-hour-heading">
          <h4 id="v3-rhythm-evidence-hour-heading">小时</h4>
          <ExactVisualTableContent visual={hour} />
        </section>
      </div>
    </details>
  );
}

function RoleShareBand({
  visual,
  label,
}: {
  readonly visual: BetaLocalizedVisualV1;
  readonly label: string;
}) {
  return (
    <figure className="v3-role-band" aria-label={visual.ariaLabel}>
      <div className="v3-role-band-track" aria-hidden="true">
        {visual.rows.map((row) => (
          <span
            key={row.key}
            className="v3-role-band-segment"
            data-tone={row.tone}
            style={{ "--v3-band-width": `${row.widthPercent}%` } as CSSProperties}
          />
        ))}
      </div>
      <div className="v3-role-band-label">
        <span>{label}</span>
        <span>Owner / Other</span>
      </div>
      <ul className="v3-role-band-legend">
        {visual.rows.map((row) => (
          <li key={row.key} data-tone={row.tone}>
            <span className="v3-role-marker" aria-hidden="true" />
            <strong>{row.label}</strong>
            <span>{row.displayValue}</span>
          </li>
        ))}
      </ul>
      <figcaption className="v3-visual-caption">
        {visual.ariaLabel}；颜色、位置、文字和斜纹共同标记角色。
      </figcaption>
      <ExactVisualTable visual={visual} summary="查看完整发送方数据" />
    </figure>
  );
}

function LengthEvidence({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="v3-length-evidence" aria-label={visual.ariaLabel}>
      <ol>
        {visual.rows.map((row) => (
          <li key={row.key}>
            <div className="v3-length-row-heading">
              <strong>{row.label}</strong>
              <span>{row.displayValue}</span>
            </div>
            <span className="v3-length-track" aria-hidden="true">
              <span className="v3-length-line" />
              <span
                className="v3-length-marker"
                style={{ "--v3-marker-position": `${row.widthPercent}%` } as CSSProperties}
              />
            </span>
            <small>{row.secondaryLabel}</small>
          </li>
        ))}
      </ol>
      <figcaption className="v3-visual-caption">
        平均值以三点比较呈现；中位数与 P90 保留在章节说明中，不推断分布形状。
      </figcaption>
      <ExactVisualTable visual={visual} summary="查看完整消息长度数据" />
    </figure>
  );
}

function RankedMessageTypes({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="v3-ranked-types" aria-label={visual.ariaLabel}>
      <ol>
        {visual.rows.map((row, index) => (
          <li key={row.key}>
            <span className="v3-ranked-index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{row.label}</strong>
              <span>{row.displayValue}</span>
            </div>
            <span className="v3-ranked-track" aria-hidden="true">
              <span style={{ "--v3-rank-width": `${row.widthPercent}%` } as CSSProperties} />
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="v3-visual-caption">
        用户消息类型按已有分母排序；系统诊断不进入分母，完整类别收在下方。
      </figcaption>
      <ExactVisualTable visual={visual} summary="查看全部消息类型" />
    </figure>
  );
}

function StreakTimeline({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="v3-streak-timeline" aria-label={visual.ariaLabel}>
      <ol>
        {visual.rows.map((row, index) => (
          <li key={row.key}>
            <span className="v3-streak-index">{index + 1}</span>
            <span className="v3-streak-axis" aria-hidden="true">
              <span />
            </span>
            <div>
              <strong>{row.displayValue}</strong>
              <small>{row.secondaryLabel}</small>
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="v3-visual-caption">连续区间按时间证据列出；并列区间完整保留。</figcaption>
      <ExactVisualTable visual={visual} summary="查看全部连续聊天区间" />
    </figure>
  );
}

function ReplyEvidence({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="v3-reply-evidence" aria-label={visual.ariaLabel}>
      <ol>
        {visual.rows.map((row) => (
          <li key={row.key}>
            <span className="v3-reply-direction" aria-hidden="true">
              <span />
            </span>
            <div>
              <strong>{row.label}</strong>
              <span>{row.displayValue}</span>
              <small>{row.secondaryLabel}</small>
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="v3-visual-caption">
        方向线只表示阅读顺序；回复间隔的中位数、方向和样本数以文字直接给出，不暗示因果或关系质量。
      </figcaption>
      <ExactVisualTable visual={visual} summary="查看完整回复间隔数据" />
    </figure>
  );
}

function CoreOpeningSection({
  section,
  message,
  viewModel,
}: {
  readonly section: BetaLocalizedReportSectionV1;
  readonly message: BetaLocalizedReportSectionV1;
  readonly viewModel: BetaReportViewModelV1;
}) {
  const openingTitle = viewModel.metadata.year === null
    ? viewModel.metadata.scopeLabel
    : `${viewModel.metadata.year} 年`;
  return (
    <Scene
      id="opening"
      scene="opening"
      layoutMode="asymmetric"
      whitespaceIntent="opening-cinematic"
      className="v3-annual-scene v3-opening-scene"
      data-section-status={section.status.toLowerCase()}
      reveal
      motionIndex={0}
      aria-labelledby="beta-report-heading"
    >
      <StoryGrid mode="asymmetric" className="v3-opening-grid">
        <div className="v3-opening-copy" data-v3-geometry-cell="opening-copy" data-v3-cell-mode="asymmetric">
          <p className="v3-opening-folio">年度回顾 · 01 / {viewModel.metadata.scopeLabel}</p>
          <h1 id="beta-report-heading" className="v3-opening-title" tabIndex={-1}>{openingTitle}</h1>
          <p className="v3-opening-lead">{section.lead}</p>
          {section.status === "PARTIAL" ? (
            <p className="v3-opening-partial" role="note">{section.statusLabel}：当前报告只使用已提交范围。</p>
          ) : null}
          {message.metric !== null ? (
            <Metric
              className="v3-opening-metric"
              label={message.metric.label}
              value={message.metric.value}
              unit={message.metric.unit}
              description="合并并确定性去重后的用户消息。"
            />
          ) : null}
          <dl className="v3-opening-facts">
            <div><dt>当前范围</dt><dd>{viewModel.metadata.currentRangeLabel}</dd></div>
            <div><dt>时间口径</dt><dd>{viewModel.metadata.timezoneLabel}</dd></div>
            <div><dt>呈现边界</dt><dd>{viewModel.privacy.localOnlyLabel}</dd></div>
          </dl>
          <a className="v3-next-cue" href="#messages">下一节：规模</a>
        </div>
        <div className="v3-opening-art" data-v3-geometry-cell="opening-art" data-v3-cell-mode="asymmetric">
          <ArtworkFrame src={annualOpeningHero} width={1536} height={1024} loading="eager" className="v3-opening-artwork" />
          <p className="v3-artwork-caption">抽象的时间与节奏记录</p>
        </div>
      </StoryGrid>
    </Scene>
  );
}

function ScaleScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const messages = sectionFor(sections, "messages");
  const activeDays = sectionFor(sections, "active-days");
  const streak = sectionFor(sections, "longest-streak");
  return (
    <Scene
      id="scale-scene"
      scene="scale"
      layoutMode="asymmetric"
      className="v3-annual-scene v3-scale-scene"
      reveal
      motionIndex={1}
      aria-labelledby="v3-scene-scale-heading"
    >
      <SceneHeading number="02" scene="scale" title="把这一年放到尺度里" summary="消息总量先成为主尺度；聊天日和连续区间在下方形成一条完整活动证据带。" />
      <StoryGrid mode="asymmetric" className="v3-scale-grid">
        <article
          id={messages.id}
          className="v3-scale-primary"
          data-v3-geometry-cell="scale-primary"
          data-v3-cell-mode="asymmetric"
          data-section-status={messages.status.toLowerCase()}
        >
          <header className="v3-scale-hero-header">
            <p className="v3-logical-kicker">{messages.eyebrow} · {String(messages.order).padStart(2, "0")}</p>
            <h3 className="v3-logical-title">{messages.heading}</h3>
            <p className="v3-logical-lead">{messages.lead}</p>
            <SectionStatus section={messages} hidePartial />
          </header>
          <MetricLine metric={messages.metric} className="v3-scale-hero-metric" />
          <Annotation>主尺度：消息总量。下方基线只承担阅读登记，不增加统计含义。</Annotation>
          <div className="v3-scale-baseline" aria-hidden="true"><span /></div>
        </article>
        <aside className="v3-scale-context" data-v3-geometry-cell="scale-context" data-v3-cell-mode="asymmetric" aria-label="消息尺度范围注记">
          <p className="v3-logical-kicker">范围注记 · 02</p>
          <h3 className="v3-scale-context-title">同一范围下的消息尺度</h3>
          <p className="v3-scale-context-copy">Owner 与 Other 的现有计数保留为范围证据，不与总量争夺主层级。</p>
          <DetailList section={messages} />
        </aside>
        <div className="v3-scale-activity-band" data-v3-geometry-cell="scale-activity-band" data-v3-cell-mode="full">
          <header className="v3-scale-activity-heading">
            <p className="v3-logical-kicker">活动证据 · 03–04</p>
            <h3>聊天日与连续区间</h3>
            <p>{activeDays.lead} {streak.lead}</p>
          </header>
          <div className="v3-scale-activity-grid">
            <article id={activeDays.id} className="v3-scale-active-days" data-section-status={activeDays.status.toLowerCase()}>
              <CompactEvidenceHeader section={activeDays} />
              <div className="v3-activity-register" aria-hidden="true">
                <span className="v3-activity-register-line" />
                <span className="v3-activity-register-mark" />
              </div>
              <DetailList section={activeDays} includeScope={false} />
            </article>
            <article id={streak.id} className="v3-scale-streak" data-section-status={streak.status.toLowerCase()}>
              <CompactEvidenceHeader section={streak} />
            {streak.visual === null ? null : <StreakTimeline visual={streak.visual} />}
              <DetailList section={streak} includeScope={false} />
            </article>
          </div>
        </div>
      </StoryGrid>
    </Scene>
  );
}

function RhythmScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const month = sectionFor(sections, "peak-month");
  const weekday = sectionFor(sections, "peak-weekday");
  const hour = sectionFor(sections, "peak-hour");
  return (
    <Scene
      id="rhythm-scene"
      scene="rhythm"
      layoutMode="full"
      className="v3-annual-scene v3-rhythm-scene"
      reveal
      motionIndex={2}
      aria-labelledby="v3-scene-rhythm-heading"
    >
      <SceneHeading number="03" scene="rhythm" title="节奏不是一条横条" summary="月份是档案节律，星期是一组七拍，小时是 24 点日内脉冲；三种时间尺度共享标注语言，但不共享形态。" />
      <article id={month.id} className="v3-rhythm-month" data-v3-geometry-cell="rhythm-month" data-v3-cell-mode="full" data-section-status={month.status.toLowerCase()}>
        <RhythmSectionHeader section={month} />
        {month.visual === null ? null : <MonthCadence visual={month.visual} />}
        <InlineSectionFacts section={month} />
      </article>
      <p className="v3-rhythm-transition">同一范围，接着换成一周七拍与一天 24 点来读。</p>
      <StoryGrid mode="paired" className="v3-rhythm-beats">
        <article id={weekday.id} className="v3-rhythm-weekday" data-v3-geometry-cell="rhythm-weekday" data-v3-cell-mode="paired" data-section-status={weekday.status.toLowerCase()}>
          <RhythmSectionHeader section={weekday} />
          {weekday.visual === null ? null : <WeekdayBeats visual={weekday.visual} />}
          <InlineSectionFacts section={weekday} />
        </article>
        <article id={hour.id} className="v3-rhythm-hour" data-v3-geometry-cell="rhythm-hour" data-v3-cell-mode="paired" data-section-status={hour.status.toLowerCase()}>
          <RhythmSectionHeader section={hour} />
          {hour.visual === null ? null : <HourPulse visual={hour.visual} />}
          <InlineSectionFacts section={hour} />
        </article>
      </StoryGrid>
      {month.visual !== null && weekday.visual !== null && hour.visual !== null ? (
        <RhythmEvidenceZone month={month.visual} weekday={weekday.visual} hour={hour.visual} />
      ) : null}
    </Scene>
  );
}

function BalanceScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const sender = sectionFor(sections, "sender-share");
  const length = sectionFor(sections, "message-length");
  const types = sectionFor(sections, "message-types");
  const typeRowCount = types.visual?.rows.length ?? 0;
  const density = typeRowCount > 3 ? "dense" : "sparse";
  return (
    <Scene
      id="balance-scene"
      scene="balance"
      layoutMode="full"
      className="v3-annual-scene v3-balance-scene"
      reveal
      motionIndex={3}
      aria-labelledby="v3-scene-balance-heading"
    >
      <SceneHeading number="04" scene="balance" title="先看双方，再看消息构成" summary="Owner / Other 的比例成为主视觉；长度和类型只补充消息的构成方式。" />
      <LogicalSection section={sender} className="v3-balance-role" data-v3-geometry-cell="balance-role" data-v3-cell-mode="full">
        {sender.visual === null ? null : <RoleShareBand visual={sender.visual} label="发送方比例" />}
      </LogicalSection>
      <header className="v3-balance-composition-heading">
        <p className="v3-logical-kicker">构成证据 · 09–10</p>
        <h3>长度与类型放在同一层阅读</h3>
        <p>{length.lead} {types.lead}</p>
      </header>
      <StoryGrid mode="asymmetric" className="v3-balance-evidence" data-density={density}>
        <article id={length.id} className="v3-balance-length" data-v3-geometry-cell="balance-length" data-v3-cell-mode="asymmetric" data-section-status={length.status.toLowerCase()}>
          <CompactEvidenceHeader section={length} />
          {length.visual === null ? null : <LengthEvidence visual={length.visual} />}
          <DetailList section={length} includeScope={false} />
        </article>
        <article id={types.id} className="v3-balance-types" data-v3-geometry-cell="balance-types" data-v3-cell-mode="asymmetric" data-section-status={types.status.toLowerCase()}>
          <CompactEvidenceHeader section={types} />
          {types.visual === null ? null : <RankedMessageTypes visual={types.visual} />}
          <DetailList section={types} includeScope={false} />
        </article>
      </StoryGrid>
    </Scene>
  );
}

function ConversationScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const sessions = sectionFor(sections, "sessions");
  const replies = sectionFor(sections, "replies");
  return (
    <Scene
      id="conversation-scene"
      scene="conversation"
      layoutMode="asymmetric"
      className="v3-annual-scene v3-conversation-scene"
      reveal
      motionIndex={4}
      aria-labelledby="v3-scene-conversation-heading"
    >
      <SceneHeading number="05" scene="conversation" title="交流从哪里开始，如何接上" summary="左侧回答会话如何开始，右侧回答回复如何接上；中间连接线只是阅读顺序，不是因果判断。" />
      <StoryGrid mode="asymmetric" className="v3-conversation-grid">
        <LogicalSection section={sessions} className="v3-conversation-start" data-v3-geometry-cell="conversation-start" data-v3-cell-mode="asymmetric">
          {sessions.visual === null ? null : <RoleShareBand visual={sessions.visual} label="会话发起方" />}
        </LogicalSection>
        <div className="v3-conversation-connector" aria-hidden="true"><span /></div>
        <LogicalSection section={replies} className="v3-conversation-replies" data-v3-geometry-cell="conversation-replies" data-v3-cell-mode="asymmetric">
          {replies.visual === null ? null : <ReplyEvidence visual={replies.visual} />}
        </LogicalSection>
      </StoryGrid>
    </Scene>
  );
}

export function BetaCoreReportSections({
  viewModel,
}: {
  readonly viewModel: BetaReportViewModelV1;
}) {
  const coreSections = viewModel.sections.filter((section) => section.order <= 12);
  const opening = sectionFor(coreSections, "opening");
  const messages = sectionFor(coreSections, "messages");
  return (
    <div className="v3-core-scenes">
      <CoreOpeningSection section={opening} message={messages} viewModel={viewModel} />
      <ScaleScene sections={coreSections} />
      <RhythmScene sections={coreSections} />
      <BalanceScene sections={coreSections} />
      <ConversationScene sections={coreSections} />
    </div>
  );
}

export function BetaUnavailableReportSections() {
  return (
    <section id="frequent-words" className="v3-vocabulary-unavailable" data-section-status="unavailable" data-layout-mode="12">
      <span className="v3-vocabulary-unavailable-mark" aria-hidden="true" />
      <div>
        <p className="beta-type-eyebrow">词汇档案</p>
        <h3>当前词汇证据尚未就绪</h3>
        <p>常用词、年度关键词与词云会在对应的本地有界词频结果就绪后一起显示。</p>
      </div>
      <StatusPill tone="warning">尚未提供</StatusPill>
      <span id="distinctive-keywords" className="v3-visually-hidden">年度关键词尚未提供</span>
      <span id="word-cloud" className="v3-visually-hidden">词云尚未提供</span>
    </section>
  );
}
