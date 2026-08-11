import type { CSSProperties, ReactNode } from "react";

import type {
  BetaLocalizedMetricV1,
  BetaLocalizedReportSectionV1,
  BetaLocalizedVisualV1,
  BetaReportViewModelV1,
} from "./report-contract";
import type { BetaReportSectionId } from "./report-sections";
import { ArtworkFrame, Badge, Metric, QueryChips, Scene, StatusPill } from "./primitives";
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
  const headingId = `beta-v2-scene-${scene}-heading`;
  return (
    <header className="beta-v2-scene-heading beta-core-scene-heading">
      <span className="beta-v2-scene-number" aria-hidden="true">{number}</span>
      <div>
        <p className="beta-type-eyebrow">{SCENE_LABELS[scene]}</p>
        <h2 id={headingId} className="beta-type-heading">{title}</h2>
        <p className="beta-v2-scene-summary">{summary}</p>
      </div>
    </header>
  );
}

function SectionHeader({ section }: { readonly section: BetaLocalizedReportSectionV1 }) {
  return (
    <div className="beta-v2-logical-header">
      <div>
        <p className="beta-type-eyebrow">{section.eyebrow} · {String(section.order).padStart(2, "0")}</p>
        <h3 className="beta-v2-logical-title">{section.heading}</h3>
      </div>
      {section.status === "READY" ? null : (
        <StatusPill tone={statusTone(section.status)}>{section.statusLabel}</StatusPill>
      )}
    </div>
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
    <dl className="beta-v2-detail-list">
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
    <div className={`beta-v2-metric-line ${className}`.trim()} aria-label={metric.accessibleLabel}>
      <span className="beta-metric-label">{metric.label}</span>
      <div className="beta-metric-value">
        <strong>{metric.value}</strong>
        {metric.unit !== "" ? <span>{metric.unit}</span> : null}
      </div>
    </div>
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
    <details className="beta-core-visual-details">
      <summary>{summary}</summary>
      <table className="beta-core-visual-table">
        <caption>{visual.ariaLabel}</caption>
        <thead>
          <tr><th scope="col">项目</th><th scope="col">数值</th><th scope="col">补充</th></tr>
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

function BarRows({
  visual,
  compact = false,
}: {
  readonly visual: BetaLocalizedVisualV1;
  readonly compact?: boolean;
}) {
  const rows = compact ? visual.rows : visual.rows;
  return (
    <ol className={`beta-v2-bar-rows${compact ? " beta-v2-bar-rows-compact" : ""}`} aria-hidden="true">
      {rows.map((row) => (
        <li key={row.key} data-tone={row.tone} data-peak={row.widthPercent >= 100 ? "true" : undefined}>
          <div className="beta-v2-bar-label">
            <span>{row.label}</span>
            <strong>{row.displayValue}</strong>
          </div>
          <span className="beta-v2-bar-track">
            <span
              className="beta-v2-bar-fill"
              style={{ "--beta-v2-width": `${row.widthPercent}%` } as CSSProperties}
            />
          </span>
          {row.secondaryLabel !== null ? <small>{row.secondaryLabel}</small> : null}
        </li>
      ))}
    </ol>
  );
}

function LandscapeChart({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  const groups = new Map<string, Map<number, BetaLocalizedVisualV1["rows"][number]>>();
  for (const row of visual.rows) {
    const [yearPart, monthPart] = row.key.split("-");
    const year = monthPart === undefined ? "当前范围" : yearPart ?? "当前范围";
    const month = monthPart === undefined ? 1 : Number(monthPart);
    const months = groups.get(year) ?? new Map<number, BetaLocalizedVisualV1["rows"][number]>();
    months.set(Number.isSafeInteger(month) && month >= 1 && month <= 12 ? month : 1, row);
    groups.set(year, months);
  }
  const timelineGroups = [...groups.entries()].map(([year, months]) => ({
    year,
    months: Array.from({ length: 12 }, (_, index) => months.get(index + 1) ?? null),
  }));
  return (
    <figure className="beta-v2-landscape-chart" aria-label={visual.ariaLabel}>
      <div className="beta-v2-month-timeline" aria-hidden="true">
        <div className="beta-v2-month-timeline-head">
          <span>年份</span>
          {Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        {timelineGroups.map((group) => (
          <div className="beta-v2-month-timeline-row" key={group.year}>
            <strong>{group.year}</strong>
            <ol>
              {group.months.map((row, index) => (
                <li key={row?.key ?? `${group.year}-${index + 1}`} data-peak={(row?.widthPercent ?? 0) >= 100 ? "true" : undefined} title={row === null ? `${group.year} 年 ${index + 1} 月：0 条` : `${row.label}：${row.displayValue}`}>
                  <span className="beta-v2-month-cell-track">
                    <span className="beta-v2-month-cell-fill" style={{ "--beta-v2-height": `${row?.widthPercent ?? 0}%` } as CSSProperties} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <figcaption>每年一行、每月一格；峰值直接标注，完整数值收在下方。</figcaption>
      <ExactVisualTable visual={visual} summary="查看完整月份数据" />
    </figure>
  );
}

function DistributionStrip({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  const isHourly = visual.rows.length === 24;
  const visibleHourTicks = new Set([0, 6, 12, 18, 23]);
  return (
    <div className={`beta-v2-distribution-strip${isHourly ? " beta-v2-hour-distribution" : ""}`}>
      <figure aria-label={visual.ariaLabel}>
        <ol aria-hidden="true">
          {visual.rows.map((row, index) => (
            <li key={row.key} data-peak={row.widthPercent >= 100 ? "true" : undefined} title={`${row.label}：${row.displayValue}`}>
              <span
                className="beta-v2-strip-value"
                style={{ "--beta-v2-height": `${Math.max(8, row.widthPercent)}%` } as CSSProperties}
              />
              <small>{isHourly && !visibleHourTicks.has(index) ? "" : row.label}</small>
            </li>
          ))}
        </ol>
        <figcaption>{visual.ariaLabel}；高亮只提示峰值，颜色不是唯一信息。</figcaption>
      </figure>
      <ExactVisualTable visual={visual} summary="查看完整分布数据" />
    </div>
  );
}

function ComparisonBar({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="beta-v2-comparison-visual" aria-label={visual.ariaLabel}>
      <div className="beta-v2-comparison-bar" aria-hidden="true">
        {visual.rows.map((row) => (
          <span
            key={row.key}
            data-tone={row.tone}
            style={{ "--beta-v2-width": `${row.widthPercent}%` } as CSSProperties}
          />
        ))}
      </div>
      <ul className="beta-v2-comparison-legend">
        {visual.rows.map((row) => (
          <li key={row.key} data-tone={row.tone}>
            <span className="beta-v2-role-marker" aria-hidden="true" />
            <strong>{row.label}</strong>
            <span>{row.displayValue}</span>
          </li>
        ))}
      </ul>
      <figcaption>{visual.ariaLabel}；两侧角色以文字和形状同时标记。</figcaption>
    </figure>
  );
}

function RankBars({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <figure className="beta-v2-rank-bars" aria-label={visual.ariaLabel}>
      <BarRows visual={visual} compact />
      <figcaption>{visual.ariaLabel}；排序和精确数值保留在明细中。</figcaption>
      <ExactVisualTable visual={visual} summary={visual.detailRows === undefined ? "查看完整类别数据" : "查看全部消息类型"} />
    </figure>
  );
}

function TableVisual({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <div className="beta-v2-table-visual">
      <table aria-label={visual.ariaLabel}>
        <caption>{visual.ariaLabel}</caption>
        <thead><tr><th scope="col">项目</th><th scope="col">数值</th><th scope="col">补充</th></tr></thead>
        <tbody>
          {visual.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.displayValue}</td>
              <td>{row.secondaryLabel ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ExactVisualTable visual={visual} summary="查看完整回复/长度数据" />
    </div>
  );
}

function StreakTimeline({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <div className="beta-v2-streak-timeline" aria-label={visual.ariaLabel}>
      {visual.rows.map((row, index) => (
        <div key={row.key} className="beta-v2-streak-row">
          <span className="beta-v2-streak-index">{index + 1}</span>
          <span className="beta-v2-streak-line" aria-hidden="true" />
          <span><strong>{row.displayValue}</strong><small>{row.secondaryLabel}</small></span>
        </div>
      ))}
      <ExactVisualTable visual={visual} summary="查看全部连续聊天区间" />
    </div>
  );
}

function VisualForSection({
  section,
}: {
  readonly section: BetaLocalizedReportSectionV1;
}) {
  if (section.visual === null) {
    return null;
  }
  switch (section.id) {
    case "peak-month":
      return <LandscapeChart visual={section.visual} />;
    case "peak-weekday":
    case "peak-hour":
      return <DistributionStrip visual={section.visual} />;
    case "sender-share":
    case "sessions":
      return <ComparisonBar visual={section.visual} />;
    case "message-types":
      return <RankBars visual={section.visual} />;
    case "longest-streak":
      return <StreakTimeline visual={section.visual} />;
    case "message-length":
    case "replies":
      return <TableVisual visual={section.visual} />;
    default:
      return (
        <div className="beta-v2-default-visual">
          <BarRows visual={section.visual} />
          <ExactVisualTable visual={section.visual} />
        </div>
      );
  }
}

function LogicalSection({
  section,
  className = "",
  children,
}: {
  readonly section: BetaLocalizedReportSectionV1;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      id={section.id}
      className={`beta-v2-logical-section beta-v2-logical-${section.id} ${className}`.trim()}
      data-section-status={section.status.toLowerCase()}
      data-scene={section.scene}
    >
      <SectionHeader section={section} />
      <p className="beta-v2-logical-lead">{section.lead}</p>
      <MetricLine metric={section.metric} />
      {children}
      <VisualForSection section={section} />
      <DetailList section={section} />
    </div>
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
  const openingChips = viewModel.metadata.year === null
    ? viewModel.metadata.queryChips
    : viewModel.metadata.queryChips.filter((chip) => chip.id !== "date");
  return (
    <Scene
      id="opening"
      scene="opening"
      className="beta-v2-opening"
      data-section-status={section.status.toLowerCase()}
      aria-labelledby="beta-report-heading"
    >
      <div className="beta-v2-opening-copy">
        <div className="beta-home-kicker">
          <Badge tone="beta">年度聊天报告</Badge>
          <Badge tone="privacy">{viewModel.privacy.localOnlyLabel}</Badge>
          {section.status === "PARTIAL" ? <Badge tone="partial">部分日期范围</Badge> : null}
        </div>
        <p className="beta-type-eyebrow">{section.eyebrow} · {String(section.order).padStart(2, "0")}</p>
        <h1 id="beta-report-heading" className="beta-type-display" tabIndex={-1}>{openingTitle}</h1>
        <p className="beta-v2-opening-lead">{section.lead}</p>
        <QueryChips chips={openingChips} />
        {section.scopeNote !== null ? <p className="beta-v2-scope-note">{section.scopeNote}</p> : null}
        {message.metric !== null ? (
          <Metric
            className="beta-v2-opening-metric"
            label={message.metric.label}
            value={message.metric.value}
            unit={message.metric.unit}
            description="去重后用户消息；当前报告只显示本地聚合结果。"
          />
        ) : null}
        <DetailList section={section} />
        <a className="beta-next-cue" href="#messages">下一节：规模</a>
      </div>
      <div className="beta-v2-opening-art">
        <ArtworkFrame src={annualOpeningHero} width={1536} height={1024} loading="eager" className="beta-opening-artwork" />
        <p className="beta-artwork-caption">抽象的时间与节奏记录</p>
      </div>
    </Scene>
  );
}

function ScaleScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const messages = sectionFor(sections, "messages");
  const activeDays = sectionFor(sections, "active-days");
  const streak = sectionFor(sections, "longest-streak");
  return (
    <Scene id="scale-scene" scene="scale" className="beta-v2-scene beta-v2-scale" reveal motionIndex={0} aria-labelledby="beta-v2-scene-scale-heading">
      <SceneHeading number="02" scene="scale" title="把这一年放到尺度里" summary="一个主数字先回答消息量，再用聊天日与连续区间补充活动范围。" />
      <div className="beta-v2-scale-grid">
        <LogicalSection section={messages} className="beta-v2-scale-hero">
          <p className="beta-v2-dominance-note">主视线：消息总量</p>
        </LogicalSection>
        <div className="beta-v2-scale-support">
          <LogicalSection section={activeDays} className="beta-v2-support-block" />
          <LogicalSection section={streak} className="beta-v2-support-block beta-v2-streak-block" />
        </div>
      </div>
    </Scene>
  );
}

function RhythmScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const month = sectionFor(sections, "peak-month");
  const weekday = sectionFor(sections, "peak-weekday");
  const hour = sectionFor(sections, "peak-hour");
  return (
    <Scene id="rhythm-scene" scene="rhythm" className="beta-v2-scene beta-v2-rhythm" reveal motionIndex={1} aria-labelledby="beta-v2-scene-rhythm-heading">
      <SceneHeading number="03" scene="rhythm" title="节奏不是一条横条" summary="月份承担主叙事，星期与小时退到两个可读的分布带，峰值和完整数据都直接可查。" />
      <LogicalSection section={month} className="beta-v2-rhythm-month" />
      <div className="beta-v2-rhythm-strips">
        <LogicalSection section={weekday} className="beta-v2-rhythm-strip" />
        <LogicalSection section={hour} className="beta-v2-rhythm-strip" />
      </div>
    </Scene>
  );
}

function BalanceScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const sender = sectionFor(sections, "sender-share");
  const length = sectionFor(sections, "message-length");
  const types = sectionFor(sections, "message-types");
  return (
    <Scene id="balance-scene" scene="balance" className="beta-v2-scene beta-v2-balance" reveal motionIndex={2} aria-labelledby="beta-v2-scene-balance-heading">
      <SceneHeading number="04" scene="balance" title="看见交流的平衡与形状" summary="Owner 与 Other 先做匿名比较；长度与类型只作为消息构成的辅助剖面。" />
      <div className="beta-v2-balance-grid">
        <LogicalSection section={sender} className="beta-v2-balance-primary" />
        <div className="beta-v2-balance-support">
          <LogicalSection section={length} className="beta-v2-support-block" />
          <LogicalSection
            section={types}
            className={`beta-v2-support-block${(types.visual?.detailRows?.length ?? types.visual?.rows.length ?? 0) > 6 ? " beta-v2-message-types-expanded" : ""}`}
          />
        </div>
      </div>
    </Scene>
  );
}

function ConversationScene({ sections }: { readonly sections: readonly BetaLocalizedReportSectionV1[] }) {
  const sessions = sectionFor(sections, "sessions");
  const replies = sectionFor(sections, "replies");
  return (
    <Scene id="conversation-scene" scene="conversation" className="beta-v2-scene beta-v2-conversation" reveal motionIndex={3} aria-labelledby="beta-v2-scene-conversation-heading">
      <SceneHeading number="05" scene="conversation" title="交流从哪里开始，如何接上" summary="会话数量是主事实；发起分布与回复间隔提供可核验的节奏上下文，不作关系判断。" />
      <div className="beta-v2-conversation-grid">
        <LogicalSection section={sessions} className="beta-v2-conversation-primary" />
        <LogicalSection section={replies} className="beta-v2-conversation-secondary" />
      </div>
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
    <div className="beta-v2-core-scenes">
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
          <Badge tone="partial">尚未提供</Badge>
        </section>
      ))}
    </div>
  );
}
