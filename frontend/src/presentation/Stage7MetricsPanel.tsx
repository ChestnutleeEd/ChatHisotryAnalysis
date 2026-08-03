import { useEffect, useMemo, useState } from "react";

import type { CanonicalAnalysisFilters, CanonicalAnalysisResult } from "../worker-analysis/analytics-contract";
import { toStage7Presentation, type Stage7Table } from "./stage7-presentation";

interface Stage7MetricsPanelProps {
  readonly result: CanonicalAnalysisResult;
  readonly pending: boolean;
  readonly onFilterChange: (filters: CanonicalAnalysisFilters) => void;
}

function count(value: number): string {
  return value.toLocaleString("zh-CN");
}

function value(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function Table<Row extends object>({
  model,
  renderRow,
}: {
  readonly model: Stage7Table<Row>;
  readonly renderRow: (row: Row, index: number) => React.ReactNode;
}) {
  return (
    <div className="activity-table-wrap">
      <table className="activity-table stage7-table">
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

export function Stage7MetricsPanel({
  result,
  pending,
  onFilterChange,
}: Stage7MetricsPanelProps) {
  const metrics = result.stage7;
  const presentation = useMemo(() => toStage7Presentation(metrics), [metrics]);
  const [selectedYear, setSelectedYear] = useState<number | null>(metrics.filters.selectedYear);

  useEffect(() => {
    setSelectedYear(metrics.filters.selectedYear);
  }, [metrics.filters.selectedYear]);

  function applyYear(): void {
    onFilterChange({ ...result.filters, selectedYear });
  }

  const activeKeywords = metrics.yearlyKeywords.years.find(
    (year) => year.year === metrics.yearlyKeywords.activeYear,
  );
  const activeKeywordTable = {
    ...presentation.keywords,
    rows: presentation.keywords.rows.filter(
      (row) => row.year === metrics.yearlyKeywords.activeYear,
    ),
  };

  return (
    <section
      className="results-panel stage7-dashboard"
      aria-labelledby="stage7-heading"
      aria-busy={pending}
    >
      <div className="results-heading">
        <div>
          <p className="section-number">05 / WORDS · LENGTH · TYPES</p>
          <h2 id="stage7-heading">词频、长度与消息类型</h2>
          <p className="activity-definition">
            所有结果由当前 generation 的 analytics Worker 计算；token 只来自 eligible text，消息类型则包含所有 user messages，system 单独计数。
          </p>
          <p className="activity-definition">
            当前全局筛选：{result.filters.startDate} → {result.filters.endDate} · sender {result.filters.sender} · UTC+08:00。
          </p>
        </div>
        <span className="activity-version">{metrics.schemaVersion}</span>
      </div>

      <div className="stage7-year-control">
        <label htmlFor="stage7-year">年度关键词与摘要年份</label>
        <select
          id="stage7-year"
          value={selectedYear ?? ""}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            setSelectedYear(raw === "" ? null : Number(raw));
          }}
        >
          <option value="">最新有数据年份</option>
          {metrics.yearlyKeywords.years.map((year) => (
            <option key={year.year} value={year.year}>
              {year.year}{year.partial ? "（部分年份）" : ""}
            </option>
          ))}
        </select>
        <button
          className="primary-button activity-filter-button"
          type="button"
          disabled={pending || selectedYear === result.filters.selectedYear}
          onClick={applyYear}
        >
          应用年度
        </button>
      </div>

      {pending && (
        <p className="activity-pending" role="status" aria-live="polite">
          本地 Worker 正在重新计算；上一次完整 Stage 7 结果仍保留。
        </p>
      )}

      <div className="stage7-grid">
        <section className="activity-card" aria-labelledby="stage7-types-heading">
          <h3 id="stage7-types-heading">消息类型计数与占比</h3>
          <p className="activity-definition">
            分母为筛选后的 user messages：text 包含 eligible 与 ineligible text；unknown 保持可见；system diagnostic 不进入分母。
          </p>
          <Table
            model={presentation.types}
            renderRow={(row) => (
              <tr key={row.category}>
                <th scope="row">{row.category}</th>
                <td>{count(row.count)}</td>
                <td>{row.displayShare}</td>
              </tr>
            )}
          />
          <p className="activity-definition">
            eligible text：{count(metrics.messageTypes.eligibleTextCount)}；system diagnostic：{count(metrics.messageTypes.systemDiagnosticCount)}。
          </p>
        </section>

        <section className="activity-card" aria-labelledby="stage7-length-heading">
          <h3 id="stage7-length-heading">Eligible text 长度</h3>
          <p className="activity-definition">
            单位为清洗后 Unicode code points；不包含媒体、system、URL-only 或 ineligible text。median 与 p90 使用 nearest-rank。
          </p>
          <Table
            model={presentation.length}
            renderRow={(row) => (
              <tr key={row.scope}>
                <th scope="row">{row.scope}</th>
                <td>{count(row.count)}</td>
                <td>{count(row.sum)}</td>
                <td>{value(row.mean)}</td>
                <td>{value(row.median)}</td>
                <td>{value(row.p90)}</td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card stage7-wide-card" aria-labelledby="stage7-words-heading">
          <h3 id="stage7-words-heading">跨年高频词（Top 20）</h3>
          <p className="activity-definition">
            词汇按总 raw count 降序、Unicode code-point 升序固定排序；每年保留零值，并同时展示 raw count 与每 10,000 tokens 频率。
          </p>
          <Table
            model={presentation.words}
            renderRow={(row) => (
              <tr key={row.year}>
                <th scope="row">{row.year}</th>
                <td>{row.partial ? "partial" : "full"}</td>
                <td>{count(row.totalTokenCount)}</td>
                <td>
                  <div className="stage7-token-values">
                    {row.values.map((cell) => (
                      <span key={cell.token}>
                        {cell.token}: {count(cell.count)} / {value(cell.ratePer10000)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card" aria-labelledby="stage7-keywords-heading">
          <h3 id="stage7-keywords-heading">年度关键词</h3>
          <p className="activity-definition">
            候选需满足 count ≥ 5 且 distinct messages ≥ 3；多年份使用 smoothed year-vs-rest log odds，只保留正分；单年使用 frequency-fallback。
          </p>
          {activeKeywords?.mode === "insufficient-evidence" && (
            <p className="activity-empty" role="status">
              当前年份证据不足：{activeKeywords.omissionReason ?? "NO_CANDIDATE_TOKENS"}。
            </p>
          )}
          <Table
            model={activeKeywordTable}
            renderRow={(row) => (
              <tr key={`${row.year}-${row.token}`}>
                <th scope="row">{row.year}</th>
                <td>{row.mode}</td>
                <td>{row.token}</td>
                <td>{count(row.count)}</td>
                <td>{count(row.distinctMessageFrequency)}</td>
                <td>{value(row.score)}</td>
              </tr>
            )}
          />
        </section>

        <section className="activity-card" aria-labelledby="stage7-summary-heading">
          <h3 id="stage7-summary-heading">可追溯年度摘要</h3>
          <p className="activity-definition">
            摘要只由固定模板和已版本化指标拼接；每条事实都带有 metric ID、definition version、filters 和 aggregate trace。
          </p>
          {metrics.summary.clauses.length === 0 ? (
            <p className="activity-empty">当前筛选没有可展示的固定事实。</p>
          ) : (
            <ol className="stage7-summary-list">
              {metrics.summary.clauses.map((clause) => (
                <li key={clause.id}>
                  <span>{clause.text}</span>
                  <small>
                    {clause.trace.metricId} · {clause.trace.definitionVersion}
                  </small>
                  <details>
                    <summary>查看 trace</summary>
                    <p className="activity-definition">
                      filters：{clause.trace.filters.startDate} → {clause.trace.filters.endDate} · sender {clause.trace.filters.sender}
                    </p>
                    <dl className="stage7-trace-values">
                      {Object.entries(clause.trace.values).map(([key, traceValue]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{traceValue === null ? "—" : String(traceValue)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </li>
              ))}
            </ol>
          )}
          {metrics.summary.omissions.length > 0 && (
            <details>
              <summary>查看省略原因</summary>
              <ul>
                {metrics.summary.omissions.map((omission) => (
                  <li key={omission.metricId}>
                    {omission.metricId}：{omission.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </section>
  );
}
