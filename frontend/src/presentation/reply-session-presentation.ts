import type {
  ConversationSessionMetrics,
  ReplyDirectionMetrics,
  ReplyIntervalBin,
  ReplyIntervalStats,
  ReplySessionMetrics,
} from "../worker-analysis/reply-session-metrics";

export interface ReplySessionTable<Row> {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
}

export interface ReplyDirectionTableRow {
  readonly direction: ReplyDirectionMetrics["direction"];
  readonly responder: ReplyDirectionMetrics["responder"];
  readonly count: number;
  readonly meanSeconds: number | null;
  readonly p25Seconds: number | null;
  readonly medianSeconds: number | null;
  readonly p75Seconds: number | null;
  readonly p90Seconds: number | null;
}

export type ReplyBinTableRow = ReplyIntervalBin;

export interface InitiatorTableRow {
  readonly initiator: ConversationSessionMetrics["initiatorCounts"]["owner"]["initiator"];
  readonly count: number;
  readonly share: number | null;
}

export interface ReplySessionPresentation {
  readonly definitions: {
    readonly population: string;
    readonly threshold: string;
    readonly dateFilter: string;
    readonly senderFilter: string;
    readonly exclusions: string;
    readonly languageBoundary: string;
  };
  readonly replyDirections: ReplySessionTable<ReplyDirectionTableRow>;
  readonly replyBins: ReplySessionTable<ReplyBinTableRow>;
  readonly initiators: ReplySessionTable<InitiatorTableRow>;
  readonly overall: ReplyIntervalStats;
  readonly sessionCount: number;
  readonly thresholdHours: number;
}

export function displayMetric(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function directionRows(
  directions: readonly ReplyDirectionMetrics[],
): ReplySessionTable<ReplyDirectionTableRow> {
  return {
    caption: "Reply interval statistics by direction",
    columns: ["direction", "responder", "count", "mean (seconds)", "p25", "median", "p75", "p90"],
    rows: directions.map((direction) => ({
      direction: direction.direction,
      responder: direction.responder,
      count: direction.stats.count,
      meanSeconds: direction.stats.meanSeconds,
      p25Seconds: direction.stats.p25Seconds,
      medianSeconds: direction.stats.medianSeconds,
      p75Seconds: direction.stats.p75Seconds,
      p90Seconds: direction.stats.p90Seconds,
    })),
  };
}

function binRows(stats: ReplyIntervalStats): ReplySessionTable<ReplyBinTableRow> {
  return {
    caption: "Reply interval duration bins",
    columns: ["range", "minimum seconds", "maximum seconds", "count"],
    rows: stats.bins.map((bin) => ({ ...bin })),
  };
}

function initiatorRows(
  sessions: ConversationSessionMetrics,
): ReplySessionTable<InitiatorTableRow> {
  return {
    caption: "Conversation sessions by initiator",
    columns: ["initiator", "count", "share"],
    rows: [
      sessions.initiatorCounts.owner,
      sessions.initiatorCounts.other,
      sessions.initiatorCounts.unknown,
    ].map((bucket) => ({
      initiator: bucket.initiator,
      count: bucket.count,
      share: bucket.share,
    })),
  };
}

export function toReplySessionPresentation(
  metrics: ReplySessionMetrics,
): ReplySessionPresentation {
  const sessions = metrics.conversationSessions;
  return {
    definitions: {
      population: "Post-dedup user messages are ordered by canonical time; system events are excluded.",
      threshold: `The active conversation threshold is ${metrics.replyIntervals.thresholdHours} hours. A gap strictly greater than the threshold starts a new session; changing it recalculates both panels.`,
      dateFilter: "Reply intervals require both boundary messages inside the inclusive date filter. Sessions use the opening user message date.",
      senderFilter: "Both senders are included; the global sender filter does not apply to reply or initiator metrics.",
      exclusions: "Long offline gaps are excluded as replies, same-sender runs count as one burst, and crossing midnight alone does not split a session.",
      languageBoundary: "These are counts, distributions, intervals, and thresholds; they do not provide a relationship judgement.",
    },
    replyDirections: directionRows(metrics.replyIntervals.directions),
    replyBins: binRows(metrics.replyIntervals.overall),
    initiators: initiatorRows(sessions),
    overall: metrics.replyIntervals.overall,
    sessionCount: sessions.sessionCount,
    thresholdHours: sessions.thresholdHours,
  };
}
