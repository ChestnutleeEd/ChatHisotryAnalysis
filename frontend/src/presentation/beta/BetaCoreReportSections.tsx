import type { CSSProperties } from "react";

import type {
  BetaLocalizedReportSectionV1,
  BetaLocalizedVisualV1,
  BetaReportViewModelV1,
} from "./report-contract";
import { BaseCard, Badge, StatusPill } from "./primitives";

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

function visualRows(visual: BetaLocalizedVisualV1) {
  return visual.rows.map((row) => (
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

function Visual({ visual }: { readonly visual: BetaLocalizedVisualV1 }) {
  return (
    <div className={`beta-core-visual beta-core-visual-${visual.kind}`}>
      {visual.kind === "table" ? null : (
        <div className="beta-core-chart" aria-hidden="true">
          <ol>{visualRows(visual)}</ol>
        </div>
      )}
      {visualTable(visual)}
      {visual.legend.length > 0 ? (
        <ul className="beta-core-legend" aria-label="图例">
          {visual.legend.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function CoreSection({ section }: { readonly section: BetaLocalizedReportSectionV1 }) {
  const variant = cardVariant(section);
  return (
    <BaseCard id={section.id} variant={variant} className={`beta-core-card beta-core-card-${section.status.toLowerCase()}`}>
      <div className="beta-core-card-heading">
        <div>
          <p className="beta-type-eyebrow">{section.eyebrow} · {String(section.order).padStart(2, "0")}</p>
          <h2 className="beta-type-heading">{section.heading}</h2>
        </div>
        <StatusPill tone={statusTone(section.status)}>{section.statusLabel}</StatusPill>
      </div>
      <p className="beta-type-report-lead">{section.lead}</p>
      {section.scopeNote !== null ? <p className="beta-core-scope-note">{section.scopeNote}</p> : null}
      {section.metric !== null ? (
        <div className="beta-core-metric" aria-label={section.metric.accessibleLabel}>
          <span className="beta-type-metadata">{section.metric.label}</span>
          <strong className="beta-type-metric">{section.metric.value}</strong>
          {section.metric.unit !== "" ? <span className="beta-type-metric-unit">{section.metric.unit}</span> : null}
        </div>
      ) : null}
      {section.visual !== null ? <Visual visual={section.visual} /> : null}
      {section.details.length > 0 ? (
        <dl className="beta-core-details">
          {section.details.map((detail) => (
            <div key={`${detail.label}-${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
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
  return (
    <div className="beta-core-report-scenes">
      {scenes.map((scene) => {
        const sections = viewModel.sections.filter((section) => section.order <= 12 && section.scene === scene);
        return sections.length === 0 ? null : (
          <section key={scene} className={`beta-core-scene beta-core-scene-${scene}`} aria-label={`${SCENE_LABELS[scene]}核心指标`}>
            {sections.map((section) => <CoreSection key={section.id} section={section} />)}
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
