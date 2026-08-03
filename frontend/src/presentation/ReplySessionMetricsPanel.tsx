import { useEffect, useMemo, useState } from "react";

import type {
  CanonicalAnalysisFilters,
  CanonicalAnalysisResult,
  SessionThresholdHours,
} from "../worker-analysis/analytics-contract";
import { SESSION_THRESHOLD_HOURS } from "../worker-analysis/analytics-contract";
import {
  displayMetric,
  toReplySessionPresentation,
  type ReplySessionTable,
} from "./reply-session-presentation";

interface ReplySessionMetricsPanelProps {
  readonly result: CanonicalAnalysisResult;
  readonly pending: boolean;
  readonly onFilterChange: (filters: CanonicalAnalysisFilters) => void;
}
function count(value: number): string {
  return value.toLocaleString("en-US");
}

function formatShare(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Table<Row extends object>({
  model,
  renderRow,
}: {
  readonly model: ReplySessionTable<Row>;
  readonly renderRow: (row: Row, index: number) => React.ReactNode;
}) {
  return (
    <div className="activity-table-wrap">
      <table className="activity-table stage8-table">
        <caption>{model.caption}</caption>
        <thead>
          <tr>
            {model.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{model.rows.map(renderRow)}</tbody>
      </table>
    </div>
  );
}

export function ReplySessionMetricsPanel({
  result,
  pending,
  onFilterChange,
}: ReplySessionMetricsPanelProps) {
  const metrics = result.replySessions;
  const presentation = useMemo(
    () => toReplySessionPresentation(metrics),
    [metrics],
  );
  const [threshold, setThreshold] = useState<SessionThresholdHours>(
    metrics.replyIntervals.thresholdHours,
  );

  useEffect(() => {
    setThreshold(metrics.replyIntervals.thresholdHours);
  }, [metrics.replyIntervals.thresholdHours]);

  function applyThreshold(): void {
    if (threshold === result.filters.sessionThresholdHours) {
      return;
    }
    onFilterChange({ ...result.filters, sessionThresholdHours: threshold });
  }

  return (
    <section
      className="results-panel stage8-dashboard"
      aria-labelledby="stage8-heading"
      aria-busy={pending}
    >
      <div className="results-heading">
        <div>
          <p className="section-number">06 / REPLIES · SESSIONS</p>
          <h2 id="stage8-heading">Reply intervals and conversation sessions</h2>
          <p className="activity-definition">{presentation.definitions.population}</p>
          <p className="activity-definition">{presentation.definitions.senderFilter}</p>
        </div>
        <span className="activity-version">{metrics.schemaVersion}</span>
      </div>

      <div className="stage8-threshold-control">
        <label htmlFor="conversation-threshold">Conversation threshold</label>
        <select
          id="conversation-threshold"
          value={threshold}
          disabled={pending}
          onChange={(event) => {
            setThreshold(Number(event.currentTarget.value) as SessionThresholdHours);
          }}
        >
          {SESSION_THRESHOLD_HOURS.map((hours) => (
            <option key={hours} value={hours}>
              {hours} hours
            </option>
          ))}
        </select>
        <button
          className="primary-button activity-filter-button"
          type="button"
          disabled={pending || threshold === result.filters.sessionThresholdHours}
          onClick={applyThreshold}
        >
          Recalculate threshold
        </button>
      </div>

      <p className="activity-definition">{presentation.definitions.threshold}</p>
      <p className="activity-definition">{presentation.definitions.dateFilter}</p>
      <p className="activity-definition">{presentation.definitions.exclusions}</p>
      <p className="activity-definition">{presentation.definitions.languageBoundary}</p>

      {pending && (
        <p className="activity-pending" role="status" aria-live="polite">
          Recomputing reply and session metrics locally; the previous complete result remains visible.
        </p>
      )}

      <div className="stage8-kpis" aria-label="Reply and session summary">
        <div>
          <dt>Reply pairs included</dt>
          <dd>{count(presentation.overall.count)}</dd>
        </div>
        <div>
          <dt>Overall median (seconds)</dt>
          <dd>{displayMetric(presentation.overall.medianSeconds)}</dd>
        </div>
        <div>
          <dt>Conversation sessions</dt>
          <dd>{count(presentation.sessionCount)}</dd>
        </div>
        <div>
          <dt>Effective threshold</dt>
          <dd>{presentation.thresholdHours} hours</dd>
        </div>
      </div>

      <div className="stage8-grid">
        <section className="activity-card" aria-labelledby="stage8-reply-heading">
          <h3 id="stage8-reply-heading">Reply interval statistics</h3>
          {presentation.overall.count === 0 && (
            <p className="activity-empty" role="status">
              No qualifying reply pairs in the current inclusive date range.
            </p>
          )}
          <Table
            model={presentation.replyDirections}
            renderRow={(row) => (
              <tr key={row.direction}>
                <th scope="row">{row.direction}</th>
                <td>{row.responder}</td>
                <td>{count(row.count)}</td>
                <td>{displayMetric(row.meanSeconds)}</td>
                <td>{displayMetric(row.p25Seconds)}</td>
                <td>{displayMetric(row.medianSeconds)}</td>
                <td>{displayMetric(row.p75Seconds)}</td>
                <td>{displayMetric(row.p90Seconds)}</td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card" aria-labelledby="stage8-bins-heading">
          <h3 id="stage8-bins-heading">Reply interval bins</h3>
          <Table
            model={presentation.replyBins}
            renderRow={(row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                <td>{row.minSeconds}</td>
                <td>{row.maxSeconds}</td>
                <td>{count(row.count)}</td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card stage8-wide-card" aria-labelledby="stage8-initiator-heading">
          <h3 id="stage8-initiator-heading">Conversation initiators</h3>
          <p className="activity-definition">
            Sessions started by the first valid user message after the previous session boundary. The measure is threshold-sensitive.
          </p>
          {presentation.sessionCount === 0 && (
            <p className="activity-empty" role="status">
              No sessions open inside the current date range.
            </p>
          )}
          <Table
            model={presentation.initiators}
            renderRow={(row) => (
              <tr key={row.initiator}>
                <th scope="row">{row.initiator}</th>
                <td>{count(row.count)}</td>
                <td>{formatShare(row.share)}</td>
              </tr>
            )}
          />
        </section>
      </div>
    </section>
  );
}
