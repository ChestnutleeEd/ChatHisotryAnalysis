import type { CSSProperties } from "react";

import shareCardField from "../../assets/beta/art/share-card-field-v1.webp";
import type {
  ShareCardMetricViewModelV1,
  ShareCardSenderRoleViewModelV1,
  ShareCardViewModelV1,
} from "./summary-contract";
import type { SharePreviewArtworkState } from "./share-preview-state";

function metricValue(metric: ShareCardMetricViewModelV1): string {
  if (metric.status === "unavailable") {
    return metric.detail;
  }
  return `${metric.value ?? ""}${metric.unit}`;
}

function SenderRole({ role }: { readonly role: ShareCardSenderRoleViewModelV1 }) {
  return (
    <li className={`beta-share-card-sender-role beta-share-card-sender-${role.label.toLowerCase()}`}>
      <span className="beta-share-card-role-marker" aria-hidden="true" />
      <span>
        <strong>{role.label}</strong>
        <small>{role.count === null ? "证据不足" : `${role.count} 条 · ${role.share ?? ""}`}</small>
      </span>
    </li>
  );
}

function CardMetric({ metric }: { readonly metric: ShareCardMetricViewModelV1 }) {
  return (
    <li className={`beta-share-card-metric beta-share-card-metric-${metric.status}`}>
      <span>{metric.label}</span>
      <strong>{metricValue(metric)}</strong>
      <small>{metric.detail}</small>
    </li>
  );
}

function accessibleSummary(viewModel: ShareCardViewModelV1): string {
  const metrics = Object.values(viewModel.metrics)
    .map((metric) => `${metric.label}${metricValue(metric)}`)
    .join("；");
  const vocabulary = viewModel.vocabulary.mode === "on"
    ? `，${viewModel.vocabulary.label}${viewModel.vocabulary.items.map((item) => item.token).join("、")}`
    : "，未包含词汇摘要";
  return `${viewModel.headline}，范围 ${viewModel.rangeLabel}${viewModel.partialLabel === null ? "" : `，${viewModel.partialLabel}`}；${metrics}${vocabulary}；${viewModel.privacyLine}。`;
}

export function BetaShareCardPreview({
  viewModel,
  artworkState,
  onArtworkError,
}: {
  readonly viewModel: ShareCardViewModelV1;
  readonly artworkState: SharePreviewArtworkState;
  readonly onArtworkError: () => void;
}) {
  const totalMessages = viewModel.metrics.totalMessages;
  const sender = viewModel.senderComparison;
  return (
    <article
      className="beta-share-card"
      data-testid="beta-share-card-preview"
      data-artwork-state={artworkState}
      data-evidence-state={viewModel.scope.partial ? "partial" : viewModel.exportAvailability.status}
      aria-describedby="beta-share-card-accessible-summary"
    >
      <div className="beta-share-card-artwork" aria-hidden="true">
        {artworkState === "loaded" ? (
          <img src={shareCardField} alt="" width={1200} height={1500} loading="eager" onError={onArtworkError} />
        ) : (
          <div className="beta-share-card-artwork-fallback" />
        )}
      </div>
      <div className="beta-share-card-content">
        <header className="beta-share-card-header">
          <div>
            <p className="beta-share-card-eyebrow">私人数据年鉴 · {viewModel.timezoneLabel}</p>
            <h2>{viewModel.headline}</h2>
          </div>
          <span className="beta-share-card-range">{viewModel.rangeLabel}</span>
        </header>

        <section className="beta-share-card-total" aria-labelledby="beta-share-card-total-heading">
          <p id="beta-share-card-total-heading">{totalMessages.label}</p>
          <strong>{totalMessages.value ?? totalMessages.detail}</strong>
          {totalMessages.status === "available" ? <span>{totalMessages.unit}</span> : null}
          <small>{totalMessages.detail}</small>
        </section>

        <ul className="beta-share-card-metrics" aria-label="年度回顾指标">
          <CardMetric metric={viewModel.metrics.activeDays} />
          <CardMetric metric={viewModel.metrics.mostActiveMonth} />
          <CardMetric metric={viewModel.metrics.longestStreak} />
        </ul>

        <section className="beta-share-card-balance" aria-labelledby="beta-share-card-balance-heading">
          <div className="beta-share-card-section-label">
            <span id="beta-share-card-balance-heading">Owner / Other</span>
            <small>{sender.status === "available" ? `合计 ${sender.denominator} 条` : sender.detail}</small>
          </div>
          {sender.status === "available" ? (
            <>
              <div className="beta-share-card-balance-bar" aria-hidden="true">
                <span style={{ flexBasis: sender.owner.share ?? "0%" } as CSSProperties} />
                <span style={{ flexBasis: sender.other.share ?? "0%" } as CSSProperties} />
              </div>
              <ul className="beta-share-card-sender-list">
                <SenderRole role={sender.owner} />
                <SenderRole role={sender.other} />
              </ul>
            </>
          ) : (
            <p className="beta-share-card-unavailable">双方比较：证据不足</p>
          )}
        </section>

        <section className={`beta-share-card-vocabulary beta-share-card-vocabulary-${viewModel.vocabulary.mode}`} aria-labelledby="beta-share-card-vocabulary-heading">
          <div className="beta-share-card-section-label">
            <span id="beta-share-card-vocabulary-heading">词汇摘要</span>
            <small>{viewModel.vocabulary.label}</small>
          </div>
          {viewModel.vocabulary.mode === "on" ? (
            <ul>
              {viewModel.vocabulary.items.map((item) => <li key={item.displayRank}>{item.token}</li>)}
            </ul>
          ) : <p>{viewModel.vocabulary.label}</p>}
        </section>

        <footer className="beta-share-card-footer">
          <div>
            <strong>{viewModel.privacyLine}</strong>
            <span>{viewModel.productSignature}</span>
          </div>
          <div>
            {viewModel.partialLabel !== null ? <span>{viewModel.partialLabel}</span> : null}
            <span>{viewModel.senderFilterContext.appliedFilterLabel}</span>
          </div>
        </footer>
      </div>
      <p id="beta-share-card-accessible-summary" className="visually-hidden">{accessibleSummary(viewModel)}</p>
    </article>
  );
}
