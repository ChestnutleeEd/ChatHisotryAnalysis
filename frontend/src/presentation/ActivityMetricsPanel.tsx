import { useEffect, useMemo, useState } from "react";

import type { CanonicalAnalysisFilters, CanonicalAnalysisResult } from "../worker-analysis/analytics-contract";
import { toActivityPresentation, type ActivityTable } from "./activity-metrics";

interface ActivityMetricsPanelProps {
  readonly result: CanonicalAnalysisResult;
  readonly pending: boolean;
  readonly onFilterChange: (filters: CanonicalAnalysisFilters) => void;
}

function count(value: number): string {
  return value.toLocaleString("zh-CN");
}

function Table<Row extends object>({
  model,
  renderRow,
}: {
  readonly model: ActivityTable<Row>;
  readonly renderRow: (row: Row, index: number) => React.ReactNode;
}) {
  return (
    <div className="activity-table-wrap">
      <table className="activity-table">
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

export function ActivityMetricsPanel({
  result,
  pending,
  onFilterChange,
}: ActivityMetricsPanelProps) {
  const presentation = useMemo(
    () => toActivityPresentation(result.activity),
    [result.activity],
  );
  const [draft, setDraft] = useState<CanonicalAnalysisFilters>(result.filters);
  const [dateError, setDateError] = useState<string>();

  useEffect(() => {
    setDraft(result.filters);
    setDateError(undefined);
  }, [result.filters]);

  function applyFilters(): void {
    if (draft.startDate > draft.endDate) {
      setDateError("开始日期不能晚于结束日期。");
      return;
    }
    setDateError(undefined);
    onFilterChange(draft);
  }

  return (
    <section
      className="results-panel activity-dashboard"
      aria-labelledby="activity-heading"
      aria-busy={pending}
    >
      <div className="results-heading">
        <div>
          <p className="section-number">04 / ACTIVITY</p>
          <h2 id="activity-heading">对话活动统计</h2>
          <p className="activity-definition">{presentation.definitions.population}</p>
          <p className="activity-definition">{presentation.definitions.timezone}</p>
        </div>
        <span className="activity-version">{result.activity.schemaVersion}</span>
      </div>

      <div className="activity-filters" aria-label="Activity filters">
        <label>
          开始日期
          <input
            type="date"
            value={draft.startDate}
            min={result.dataset.minimumCalendarDate}
            max={result.dataset.maximumCalendarDate}
            onChange={(event) => {
              setDraft({ ...draft, startDate: event.currentTarget.value });
            }}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={draft.endDate}
            min={result.dataset.minimumCalendarDate}
            max={result.dataset.maximumCalendarDate}
            onChange={(event) => {
              setDraft({ ...draft, endDate: event.currentTarget.value });
            }}
          />
        </label>
        <label>
          发送方筛选
          <select
            value={draft.sender}
            onChange={(event) => {
              setDraft({
                ...draft,
                sender: event.currentTarget.value as CanonicalAnalysisFilters["sender"],
              });
            }}
          >
            <option value="both">全部 user messages</option>
            <option value="owner">仅 owner</option>
            <option value="other">仅 other</option>
          </select>
        </label>
        <button
          className="primary-button activity-filter-button"
          type="button"
          disabled={pending}
          onClick={applyFilters}
        >
          应用筛选
        </button>
      </div>
      {dateError !== undefined && (
        <p className="field-error" role="alert">
          {dateError}
        </p>
      )}
      {pending && (
        <p className="activity-pending" role="status" aria-live="polite">
          正在由本地 Worker 重新计算；上一次完整结果仍保留。
        </p>
      )}

      <div className="activity-kpis" aria-label="Activity summary">
        <div>
          <dt>selected user messages</dt>
          <dd>{count(result.aggregate.userMessageCount)}</dd>
        </div>
        <div>
          <dt>chat days</dt>
          <dd>{count(presentation.chatActivity.totalChatDays)}</dd>
        </div>
        <div>
          <dt>longest streak</dt>
          <dd>{count(presentation.chatActivity.longestStreakLength)} days</dd>
        </div>
        <div>
          <dt>sender denominator</dt>
          <dd>{count(presentation.senderComparison.denominator)}</dd>
        </div>
      </div>

      <details className="activity-definition-panel">
        <summary>查看统计口径</summary>
        <ul>
          <li>{presentation.definitions.comparativeSenderScope}</li>
          <li>{presentation.definitions.chatDay}</li>
          <li>{presentation.definitions.streak}</li>
        </ul>
      </details>

      <div className="activity-grid">
        <section className="activity-card" aria-labelledby="trend-daily-heading">
          <h3 id="trend-daily-heading">Daily / Monthly / Yearly trends</h3>
          <div className="activity-trend-tables">
            <Table
              model={presentation.trends.daily}
              renderRow={(row) => (
                <tr key={row.key}>
                  <th scope="row">{row.key}</th>
                  <td>{count(row.count)}</td>
                  <td>{row.partial ? "partial" : "full"}</td>
                </tr>
              )}
            />
            <Table
              model={presentation.trends.monthly}
              renderRow={(row) => (
                <tr key={row.key}>
                  <th scope="row">{row.key}</th>
                  <td>{count(row.count)}</td>
                  <td>{row.partial ? "partial" : "full"}</td>
                </tr>
              )}
            />
            <Table
              model={presentation.trends.yearly}
              renderRow={(row) => (
                <tr key={row.key}>
                  <th scope="row">{row.key}</th>
                  <td>{count(row.count)}</td>
                  <td>{row.partial ? "partial" : "full"}</td>
                </tr>
              )}
            />
          </div>
        </section>

        <section className="activity-card" aria-labelledby="sender-heading">
          <h3 id="sender-heading">Sender comparison</h3>
          <p className="activity-definition">{presentation.definitions.comparativeSenderScope}</p>
          <Table
            model={presentation.senderComparison}
            renderRow={(row) => (
              <tr key={row.sender}>
                <th scope="row">{row.sender}</th>
                <td>{count(row.count)}</td>
                <td>{row.displayShare}</td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card" aria-labelledby="hour-heading">
          <h3 id="hour-heading">Hour activity</h3>
          <Table
            model={presentation.hourActivity}
            renderRow={(row) => (
              <tr key={row.key}>
                <th scope="row">{row.key}:00</th>
                <td>{count(row.count)}</td>
                <td>{row.displayShare}</td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card" aria-labelledby="weekday-heading">
          <h3 id="weekday-heading">Weekday activity</h3>
          <Table
            model={presentation.weekdayActivity}
            renderRow={(row) => (
              <tr key={row.key}>
                <th scope="row">{row.key}</th>
                <td>{count(row.count)}</td>
                <td>{row.displayShare}</td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card" aria-labelledby="streak-heading">
          <h3 id="streak-heading">Chat days and longest streaks</h3>
          <Table
            model={presentation.chatActivity.streaks}
            renderRow={(row) => (
              <tr key={`${row.startDate}-${row.endDate}`}>
                <th scope="row">{row.startDate}</th>
                <td>{row.endDate}</td>
                <td>{count(row.length)} days</td>
              </tr>
            )}
          />
        </section>
      </div>
    </section>
  );
}
