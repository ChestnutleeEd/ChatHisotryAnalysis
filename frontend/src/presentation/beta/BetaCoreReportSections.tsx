import type { CSSProperties } from "react";

import type {
  BetaLocalizedReportSectionV1,
  BetaLocalizedVisualV1,
  BetaLocalizedMetricV1,
  BetaReportViewModelV1,
} from "./report-contract";
import { ArtworkFrame, BaseCard, Badge, Metric, QueryChips, Scene, StatusPill } from "./primitives";
import annualOpeningHero from "../../assets/beta/art/annual-opening-hero-v1.webp";

const SCENE_LABELS = {
  opening: "开场与消息",
  activity: "聊天节奏",
  rhythm: "时间分布",
  comparison: "双方与消息构成",
} as const;

function statusTone(status: BetaLocalizedReportSectionV1["status"]): "success" | "pending" | "warning" {
  if (status === "READY") {
    return "success";
  }
  if (status === "PARTIAL") {
    return "pending";
  }
  return "warning";
}

function cardVariant(section: BetaLocalizedReportSectionV1): "hero" | "metric" | "chart" | "split" {
  if (section.id === "opening") {
    return "hero";
  }
  if (section.visual === null) {
    return "metric";
  }
  return section.visual.kind === "table" ? "split" : "chart";
}

function visualRows(visual: BetaLocalizedVisualV1, rows = visual.rows) {
  return rows.map((row) => (
    <li key={row.key} className={`beta-core-visual-row beta-core-tone-${row.tone}`}>
      <div className="beta-core-visual-row-copy">
        <span>{row.label}</span>
        <strong>{row.displayValue}</strong>
      </div>
      <div className="beta-core-visual-track" aria-hidden="true">
        <span
          className="beta-core-visual-fill"
          style={{ "--beta-core-width": `${row.widthPercent}%` } as CSSProperties}
        />
      </div>
      {row.secondaryLabel !== null ? <small>{row.secondaryLabel}</small> : null}
    </li>
  ));
}

function visualTable(visual: BetaLocalizedVisualV1) {
  return (
    <table className="beta-core-visual-table">
      <caption>{visual.ariaLabel}</caption>
      <thead>
        <tr><th scope="col">项目</th><th scope="col">数值</th><th scope="col">补充</th></tr>
      </thead>
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
  );
}

function CompactDistribution({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <div className="beta-core-compact-distribution" aria-hidden="true">
      <ol>
        {visual.rows.map((row) => (
          <li key={row.key} title={`${row.label}：${row.displayValue}`}>
            <span style={{ "--beta-core-height": `${Math.max(10, row.widthPercent)}%` } as CSSProperties} />
            <small>{row.label}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Visual({
  visual,
  sectionId,
}: {
  readonly visual: BetaLocalizedVisualV1;
  readonly sectionId: BetaLocalizedReportSectionV1["id"];
}) {
  const compactDistribution = sectionId === "peak-month" || sectionId === "peak-weekday" || sectionId === "peak-hour";
  const primaryVisual = sectionId === "message-types"
    ? { ...visual, rows: visual.rows.map((row) => ({ ...row, secondaryLabel: null })) }
    : visual;
  const compactTableRows = primaryVisual.kind === "table" ? primaryVisual.rows.slice(0, 3) : primaryVisual.rows;
  return (
    <div className={`beta-core-visual beta-core-visual-${visual.kind}`}>
      {compactDistribution ? <CompactDistribution visual={primaryVisual} /> : (
        <div className="beta-core-chart" aria-hidden="true">
          <ol>{visualRows(primaryVisual, compactTableRows)}</ol>
        </div>
      )}
      <details className="beta-core-visual-details">
        <summary>{sectionId === "message-types" ? "查看类型明细" : "查看完整数据"}</summary>
        {visualTable(visual)}
      </details>
      {visual.legend.length > 0 ? (
        <ul className="beta-core-legend" aria-label="图例">
          {visual.legend.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function CoreOpeningSection({
  section,
  scopeLabel,
  queryChips,
  dominantMetric,
}: {
  readonly section: BetaLocalizedReportSectionV1;
  readonly scopeLabel: string;
  readonly queryChips: BetaReportViewModelV1["metadata"]["queryChips"];
  readonly dominantMetric: BetaLocalizedMetricV1 | null;
}) {
  return (
    <Scene
      id="opening"
      scene="opening"
      className={`beta-core-card beta-core-opening beta-core-card-${section.status.toLowerCase()}`}
      data-section-status={section.status.toLowerCase()}
      data-card-variant="hero"
      aria-labelledby="beta-report-heading"
    >
      <div className="beta-core-opening-copy">
        <div className="beta-home-kicker">
          <Badge tone="beta">年度聊天报告</Badge>
          <Badge tone="privacy">仅本地呈现 · 不上传</Badge>
          {section.status === "PARTIAL" ? <Badge tone="partial">部分日期范围</Badge> : null}
        </div>
        <p className="beta-type-eyebrow">{section.eyebrow} · {String(section.order).padStart(2, "0")}</p>
        <h1 id="beta-report-heading" className="beta-type-display" tabIndex={-1}>{scopeLabel}</h1>
        <p className="beta-type-report-lead">{section.lead}</p>
        <QueryChips chips={queryChips} />
        {section.scopeNote !== null ? <p className="beta-core-scope-note">{section.scopeNote}</p> : null}
        {dominantMetric !== null ? (
          <Metric
            className="beta-report-hero-metric"
            label={dominantMetric.label}
            value={dominantMetric.value}
            unit={dominantMetric.unit}
            description="post-dedup 用户消息；当前报告只显示本地聚合结果。"
          />
        ) : null}
        {section.details.length > 0 ? (
          <dl className="beta-core-opening-details">
            {section.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
          </dl>
        ) : null}
        <a className="beta-next-cue" href="#messages">下一节：消息</a>
      </div>
      <div className="beta-core-opening-art">
        <ArtworkFrame src={annualOpeningHero} width={1536} height={1024} loading="eager" className="beta-opening-artwork" />
        <p className="beta-artwork-caption">抽象的时间与节奏记录</p>
      </div>
    </Scene>
  );
}

function CoreSection({
  section,
  scopeLabel,
  queryChips,
  dominantMetric,
}: {
  readonly section: BetaLocalizedReportSectionV1;
  readonly scopeLabel: string;
  readonly queryChips: BetaReportViewModelV1["metadata"]["queryChips"];
  readonly dominantMetric: BetaLocalizedMetricV1 | null;
}) {
  if (section.id === "opening") {
    return <CoreOpeningSection section={section} scopeLabel={scopeLabel} queryChips={queryChips} dominantMetric={dominantMetric} />;
  }
  const variant = cardVariant(section);
  return (
    <BaseCard
      id={section.id}
      variant={variant}
      className={`beta-core-card beta-core-card-${section.status.toLowerCase()}`}
      data-section-status={section.status.toLowerCase()}
      data-card-variant={variant}
    >
      <div className="beta-core-card-heading">
        <div>
          <p className="beta-type-eyebrow">{section.eyebrow} · {String(section.order).padStart(2, "0")}</p>
          <h2 className="beta-type-title beta-core-section-heading">{section.heading}</h2>
        </div>
        {section.status === "READY" ? null : <StatusPill tone={statusTone(section.status)}>{section.statusLabel}</StatusPill>}
      </div>
      <p className="beta-type-report-lead">{section.lead}</p>
      {section.metric !== null ? (
        <div className="beta-core-metric" aria-label={section.metric.accessibleLabel}>
          <span className="beta-type-metadata">{section.metric.label}</span>
          <strong className="beta-type-metric">{section.metric.value}</strong>
          {section.metric.unit !== "" ? <span className="beta-type-metric-unit">{section.metric.unit}</span> : null}
        </div>
      ) : null}
      {section.visual !== null ? <Visual visual={section.visual} sectionId={section.id} /> : null}
      {section.details.length > 0 ? (
        <details className="beta-core-details-disclosure">
          <summary>查看明细</summary>
          <dl className="beta-core-details">
            {section.scopeNote !== null ? (
              <div><dt>当前范围</dt><dd>{section.scopeNote}</dd></div>
            ) : null}
            {section.details.map((detail) => (
              <div key={`${detail.label}-${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </BaseCard>
  );
}

export function BetaCoreReportSections({
  viewModel,
}: {
  readonly viewModel: BetaReportViewModelV1;
}) {
  const scenes = ["opening", "activity", "rhythm", "comparison"] as const;
  const dominantMetric = viewModel.sections.find((section) => section.id === "messages")?.metric ?? null;
  return (
    <div className="beta-core-report-scenes">
      {scenes.map((scene) => {
        const sections = viewModel.sections.filter((section) => section.order <= 12 && section.scene === scene);
        return sections.length === 0 ? null : (
          <section key={scene} className={`beta-core-scene beta-core-scene-${scene}`} aria-labelledby={`beta-core-scene-${scene}-heading`}>
            <h2 id={`beta-core-scene-${scene}-heading`} className="beta-core-scene-heading">{SCENE_LABELS[scene]}</h2>
            {sections.map((section) => (
              <CoreSection
                key={section.id}
                section={section}
                scopeLabel={viewModel.metadata.scopeLabel}
                queryChips={viewModel.metadata.queryChips}
                dominantMetric={dominantMetric}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function BetaUnavailableReportSections() {
  return (
    <section className="beta-core-scene beta-core-scene-language" aria-label="词语与分享模块状态">
      {[
        ["frequent-words", "常用词", "本地词频证据尚未就绪。"],
        ["distinctive-keywords", "年度关键词", "年度关键词证据尚未就绪。"],
        ["word-cloud", "词云", "词云会在对应的有界词频结果就绪后显示。"],
      ].map(([id, title, lead]) => (
        <BaseCard key={id} id={id} variant="narrative" className="beta-core-card beta-core-card-unavailable">
          <p className="beta-type-eyebrow">{title}</p>
          <h2 className="beta-type-heading">{title}</h2>
          <p className="beta-type-report-lead">{lead}</p>
          <Badge tone="partial">尚未提供</Badge>
        </BaseCard>
      ))}
    </section>
  );
}
