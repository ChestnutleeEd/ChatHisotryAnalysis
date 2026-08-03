import type {
  Stage7KeywordEntry,
  Stage7MessageTypeBucket,
  Stage7Metrics,
  Stage7WordCell,
  Stage7WordYear,
} from "../worker-analysis/stage7-metrics";

export interface Stage7Table<Row> {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
}

export interface Stage7LengthRow {
  readonly scope: string;
  readonly count: number;
  readonly sum: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
}

export interface Stage7WordRow {
  readonly year: number;
  readonly partial: boolean;
  readonly totalTokenCount: number;
  readonly values: readonly Stage7WordCell[];
}

export interface Stage7KeywordRow extends Stage7KeywordEntry {
  readonly year: number;
  readonly mode: string;
}

export interface Stage7TypeRow {
  readonly category: Stage7MessageTypeBucket["category"];
  readonly count: number;
  readonly share: number | null;
  readonly displayShare: string;
}

export interface Stage7Presentation {
  readonly length: Stage7Table<Stage7LengthRow>;
  readonly words: Stage7Table<Stage7WordRow>;
  readonly keywords: Stage7Table<Stage7KeywordRow>;
  readonly types: Stage7Table<Stage7TypeRow>;
}

export function formatStage7Share(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function lengthRows(metrics: Stage7Metrics): readonly Stage7LengthRow[] {
  return [
    { scope: "overall", stats: metrics.averageLength.overall },
    { scope: "owner", stats: metrics.averageLength.owner },
    { scope: "other", stats: metrics.averageLength.other },
  ].map(({ scope, stats }) => ({
    scope,
    count: stats.count,
    sum: stats.sum,
    mean: stats.mean,
    median: stats.median,
    p90: stats.p90,
  }));
}

function wordRows(metrics: Stage7Metrics): readonly Stage7WordRow[] {
  return metrics.wordEvolution.years.map((year: Stage7WordYear) => ({
    year: year.year,
    partial: year.partial,
    totalTokenCount: year.totalTokenCount,
    values: year.values,
  }));
}

function keywordRows(metrics: Stage7Metrics): readonly Stage7KeywordRow[] {
  return metrics.yearlyKeywords.years.flatMap((year) =>
    year.keywords.map((keyword) => ({
      ...keyword,
      year: year.year,
      mode: year.mode,
    })),
  );
}

function typeRows(metrics: Stage7Metrics): readonly Stage7TypeRow[] {
  return metrics.messageTypes.categories.map((bucket) => ({
    category: bucket.category,
    count: bucket.count,
    share: bucket.share,
    displayShare: formatStage7Share(bucket.share),
  }));
}

export function toStage7Presentation(metrics: Stage7Metrics): Stage7Presentation {
  return {
    length: {
      caption: "Eligible text length in Unicode code points",
      columns: ["scope", "count", "sum", "mean", "median", "p90"],
      rows: lengthRows(metrics),
    },
    words: {
      caption: "Top-20 vocabulary by year",
      columns: ["year", "partial", "token total", "values"],
      rows: wordRows(metrics),
    },
    keywords: {
      caption: "Traceable yearly keywords",
      columns: ["year", "mode", "token", "count", "message DF", "score"],
      rows: keywordRows(metrics),
    },
    types: {
      caption: "Post-dedup user message types",
      columns: ["category", "count", "share"],
      rows: typeRows(metrics),
    },
  };
}
