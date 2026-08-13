import type { CSSProperties } from "react";

import type {
  HourActivityBucket,
  TrendBucket,
  WeekdayActivityBucket,
} from "../worker-analysis/activity-metrics";
import { formatCount, formatShare } from "./desktop-dashboard";

export function normalizePresentationValue(value: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / maximum));
}

function presentationStyle(value: number): CSSProperties {
  return { "--measure": value } as CSSProperties;
}

function maxCount(values: readonly number[]): number {
  return Math.max(0, ...values);
}

export function DetailedTemporalSeries({
  title,
  description,
  buckets,
}: {
  readonly title: string;
  readonly description: string;
  readonly buckets: readonly TrendBucket[];
}) {
  const maximum = maxCount(buckets.map((bucket) => bucket.count));
  const left = 24;
  const right = 696;
  const baseline = 154;
  const amplitude = 112;
  const points = buckets.map((bucket, index) => {
    const x = buckets.length <= 1
      ? (left + right) / 2
      : left + ((right - left) * index) / (buckets.length - 1);
    const y = baseline - normalizePresentationValue(bucket.count, maximum) * amplitude;
    return { bucket, x, y };
  });
  const labelStep = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <figure className="dashboard-temporal-series" data-visual-grammar="temporal-series" aria-label={title}>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <svg className="dashboard-temporal-series-plot" viewBox="0 0 720 190" aria-hidden="true" focusable="false">
        <line className="dashboard-temporal-gridline" x1={left} x2={right} y1={98} y2={98} />
        <line className="dashboard-temporal-baseline" x1={left} x2={right} y1={baseline} y2={baseline} />
        {points.map(({ bucket, x, y }, index) => (
          <g key={bucket.key} data-partial={bucket.partial ? "true" : undefined}>
            <line className="dashboard-temporal-stem" x1={x} x2={x} y1={baseline} y2={y} />
            <circle className="dashboard-temporal-point" cx={x} cy={y} r={bucket.count === 0 ? 2.5 : 4} />
            {index % labelStep === 0 || index === points.length - 1 ? (
              <text className="dashboard-temporal-label" x={x} y={178} textAnchor="middle">{bucket.key}</text>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="dashboard-temporal-axis-note">按现有时间桶顺序；不插值、不预测。</div>
    </figure>
  );
}

export function DetailedMonthMatrix({
  title,
  description,
  buckets,
}: {
  readonly title: string;
  readonly description: string;
  readonly buckets: readonly TrendBucket[];
}) {
  const maximum = maxCount(buckets.map((bucket) => bucket.count));
  return (
    <figure className="dashboard-month-matrix" data-visual-grammar="month-matrix" aria-label={title}>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <ol className="dashboard-month-matrix-grid">
        {buckets.map((bucket) => {
          const measure = normalizePresentationValue(bucket.count, maximum);
          return (
            <li key={bucket.key} className="dashboard-month-cell" data-partial={bucket.partial ? "true" : undefined}>
              <span>{bucket.key}</span>
              <span className="dashboard-month-cell-mark" aria-hidden="true" style={{ height: `${8 + measure * 58}px`, opacity: .24 + measure * .76 }} />
              <strong>{formatCount(bucket.count)}</strong>
              <small>{bucket.partial ? "部分周期" : "完整周期"}</small>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function DetailedWeekdayStrip({
  title,
  description,
  buckets,
}: {
  readonly title: string;
  readonly description: string;
  readonly buckets: readonly WeekdayActivityBucket[];
}) {
  const maximum = maxCount(buckets.map((bucket) => bucket.count));
  return (
    <figure className="dashboard-weekday-strip" data-visual-grammar="weekday-strip" aria-label={title}>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <ol>
        {buckets.map((bucket) => {
          const measure = normalizePresentationValue(bucket.count, maximum);
          return (
            <li key={bucket.weekday}>
              <span className="dashboard-distribution-label">{bucket.weekday}</span>
              <span className="dashboard-distribution-stem" aria-hidden="true" style={presentationStyle(measure)} />
              <strong>{formatCount(bucket.count)}</strong>
              <small>{formatShare(bucket.share)}</small>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function DetailedHourHistogram({
  title,
  description,
  buckets,
}: {
  readonly title: string;
  readonly description: string;
  readonly buckets: readonly HourActivityBucket[];
}) {
  const maximum = maxCount(buckets.map((bucket) => bucket.count));
  return (
    <figure className="dashboard-hour-histogram" data-visual-grammar="hour-histogram" aria-label={title}>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <ol>
        {buckets.map((bucket) => {
          const measure = normalizePresentationValue(bucket.count, maximum);
          return (
            <li key={bucket.hour}>
              <span className="dashboard-hour-mark" aria-hidden="true" style={{ height: `${6 + measure * 72}px`, opacity: .24 + measure * .76 }} />
              <strong>{String(bucket.hour).padStart(2, "0")}</strong>
              <small>{formatCount(bucket.count)}</small>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function DetailedProportionLedger({
  title,
  description,
  rows,
}: {
  readonly title: string;
  readonly description: string;
  readonly rows: readonly {
    readonly label: string;
    readonly value: number;
    readonly displayValue: string;
  }[];
}) {
  const maximum = maxCount(rows.map((row) => row.value));
  return (
    <figure className="dashboard-proportion-ledger" data-visual-grammar="proportion-ledger" aria-label={title}>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <ol>
        {rows.map((row, index) => {
          const measure = normalizePresentationValue(row.value, maximum);
          return (
            <li key={row.label}>
              <span className="dashboard-proportion-rank" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="dashboard-proportion-label">{row.label}</span>
              <span className="dashboard-proportion-rule" aria-hidden="true">
                <span style={{ width: `${measure * 100}%` }} />
              </span>
              <strong>{row.displayValue}</strong>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
