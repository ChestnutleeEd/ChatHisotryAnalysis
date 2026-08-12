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

function DetailList({ section }: { readonly section: BetaLocalizedReportSectionV1 }) {
  const rows = [
    ...(section.scopeNote === null ? [] : [{ label: "当前范围", value: section.scopeNote }]),
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

function ExactVisualTable({
  visual,
  summary = "查看完整数据",
}: {
  readonly visual: BetaLocalizedVisualV1;
  readonly summary?: string;
}) {
  const rows = visual.detailRows ?? visual.rows;
  return (
    <details className="v3-visual-details" data-v3-visual-details="true">
      <summary>{summary}</summary>
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

function MonthMatrix({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  const groups = groupMonthRows(visual.rows);
  return (
    <figure className="v3-visual v3-month-matrix" aria-label={visual.ariaLabel}>
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
                return (
                  <li
                    key={row?.key ?? `${group.year}-${index + 1}`}
                    data-peak={row?.widthPercent === 100 ? "true" : undefined}
                    data-partial={secondaryLabel !== null && secondaryLabel !== undefined ? "true" : undefined}
                    aria-label={`${label}：${displayValue}${secondaryLabel === null || secondaryLabel === undefined ? "" : `；${secondaryLabel}`}`}
                  >
                    <span className="v3-month-cell-track" aria-hidden="true">
                      <span
                        className="v3-month-cell-fill"
                        style={{ "--v3-data-scale": `${row?.widthPercent ?? 0}%` } as CSSProperties}
                      />
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <figcaption className="v3-visual-caption">
        {visual.ariaLabel}；{peakLabels(visual.rows)}。部分月份直接标注，完整数值收在下方。
      </figcaption>
      <ExactVisualTable visual={visual} summary="查看完整月份数据" />
    </figure>
  );
}

function WeekdayBeats({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="v3-visual v3-weekday-beats" aria-label={visual.ariaLabel}>
      <ol>
        {visual.rows.map((row) => (
          <li key={row.key} data-peak={row.widthPercent === 100 ? "true" : undefined}>
            <span
              className="v3-beat-mark"
              aria-hidden="true"
              style={{ "--v3-beat-scale": String(row.widthPercent / 100) } as CSSProperties}
            />
            <span className="v3-beat-label">{row.label}</span>
            <strong>{row.displayValue}</strong>
            <small>{row.secondaryLabel}</small>
          </li>
        ))}
      </ol>
      <figcaption className="v3-visual-caption">
        {visual.ariaLabel}；{peakLabels(visual.rows)}。七个节拍按星期一至星期日排列。
      </figcaption>
      <ExactVisualTable visual={visual} summary="查看完整星期数据" />
    </figure>
  );
}

function HourPulse({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="v3-visual v3-hour-pulse" aria-label={visual.ariaLabel}>
      <ol>
        {visual.rows.map((row) => (
          <li key={row.key} data-peak={row.widthPercent === 100 ? "true" : undefined}>
            <span
              className="v3-hour-pulse-mark"
              aria-hidden="true"
              style={{ "--v3-pulse-scale": String(row.widthPercent / 100) } as CSSProperties}
            />
            <span className="v3-hour-label">{String(row.key).padStart(2, "0")}</span>
          </li>
        ))}
      </ol>
      <figcaption className="v3-visual-caption">
        {visual.ariaLabel}；{peakLabels(visual.rows)}。脉冲只连接已有的 24 个小时桶，不做插值。
      </figcaption>
      <ExactVisualTable visual={visual} summary="查看完整小时数据" />
    </figure>
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
      <SceneHeading number="02" scene="scale" title="把这一年放到尺度里" summary="消息总量先成为主尺度；聊天日和连续区间作为活动证据落在右侧。" />
      <StoryGrid mode="asymmetric" className="v3-scale-grid">
        <LogicalSection
          section={messages}
          className="v3-scale-primary"
          data-v3-geometry-cell="scale-primary"
          data-v3-cell-mode="asymmetric"
        >
          <Annotation>主尺度：消息总量。下方基线只承担阅读登记，不增加统计含义。</Annotation>
          <div className="v3-scale-baseline" aria-hidden="true"><span /></div>
        </LogicalSection>
        <div className="v3-scale-evidence" data-v3-geometry-cell="scale-evidence" data-v3-cell-mode="asymmetric">
          <LogicalSection section={activeDays} className="v3-scale-evidence-item v3-scale-active-days">
            <div className="v3-activity-rail" aria-hidden="true"><span /></div>
          </LogicalSection>
          <LogicalSection section={streak} className="v3-scale-evidence-item v3-scale-streak">
            {streak.visual === null ? null : <StreakTimeline visual={streak.visual} />}
          </LogicalSection>
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
      <SceneHeading number="03" scene="rhythm" title="把时间读成节拍" summary="月份是年度主线，星期与小时分别成为七拍和二十四拍；峰值与完整数值始终可查。" />
      <LogicalSection section={month} className="v3-rhythm-month" data-v3-geometry-cell="rhythm-month" data-v3-cell-mode="full">
        {month.visual === null ? null : <MonthMatrix visual={month.visual} />}
      </LogicalSection>
      <StoryGrid mode="paired" className="v3-rhythm-beats">
        <LogicalSection section={weekday} className="v3-rhythm-weekday" data-v3-geometry-cell="rhythm-weekday" data-v3-cell-mode="paired">
          {weekday.visual === null ? null : <WeekdayBeats visual={weekday.visual} />}
        </LogicalSection>
        <LogicalSection section={hour} className="v3-rhythm-hour" data-v3-geometry-cell="rhythm-hour" data-v3-cell-mode="paired">
          {hour.visual === null ? null : <HourPulse visual={hour.visual} />}
        </LogicalSection>
      </StoryGrid>
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
      <StoryGrid mode="asymmetric" className="v3-balance-evidence" data-density={density}>
        <LogicalSection section={length} className="v3-balance-length" data-v3-geometry-cell="balance-length" data-v3-cell-mode="asymmetric">
          {length.visual === null ? null : <LengthEvidence visual={length.visual} />}
        </LogicalSection>
        <LogicalSection section={types} className="v3-balance-types" data-v3-geometry-cell="balance-types" data-v3-cell-mode="asymmetric">
          {types.visual === null ? null : <RankedMessageTypes visual={types.visual} />}
        </LogicalSection>
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
  const unavailable: readonly { readonly id: BetaReportSectionId; readonly title: string; readonly lead: string }[] = [
    { id: "frequent-words", title: "常用词", lead: "本地词频证据尚未就绪。" },
    { id: "distinctive-keywords", title: "年度关键词", lead: "年度关键词证据尚未就绪。" },
    { id: "word-cloud", title: "词云", lead: "词云会在对应的有界词频结果就绪后显示。" },
  ];
  return (
    <div className="beta-v2-vocabulary-unavailable">
      {unavailable.map((item) => (
        <section key={item.id} id={item.id} className="beta-v2-unavailable-item" data-section-status="unavailable">
          <p className="beta-type-eyebrow">{item.title}</p>
          <h3 className="beta-v2-logical-title">{item.title}</h3>
          <p className="beta-v2-logical-lead">{item.lead}</p>
          <StatusPill tone="warning">尚未提供</StatusPill>
        </section>
      ))}
    </div>
  );
}
