import type { WordFrequencyRole } from "../../worker-analysis/word-frequency-contract";
import { WORD_FREQUENCY_SCHEMA_VERSION } from "../../worker-analysis/word-frequency-contract";
import {
  BETA_REPORT_QUERY_SCHEMA_VERSION,
  BETA_REPORT_TIMEZONE,
  validateBetaReportDtoV1,
  type BetaReportDtoV1,
} from "./report-contract";
import {
  MAX_SHARE_CARD_VOCABULARY_ITEMS,
  selectShareCardVocabularyV1,
  type ShareCardVocabularySourceV1,
} from "./word-presentation";
import {
  BETA_SUMMARY_PRESENTER_VERSION,
  BETA_SUMMARY_SCHEMA_VERSION,
  SHARE_CARD_ART_VERSION,
  SHARE_CARD_COPY_VERSION,
  type BetaSummaryDtoV1,
  type BetaSummaryFactV1,
  type BetaSummaryMonthFactV1,
  type BetaSummarySenderComparisonV1,
  type BetaSummaryStreakFactV1,
  type BetaSummaryVocabularyV1,
  validateBetaSummaryDtoV1,
} from "./summary-contract";

export interface BetaSummaryAdapterOptions {
  readonly includeVocabulary?: boolean;
  readonly wordPresentation?: ShareCardVocabularySourceV1;
  readonly expectedWordRole?: WordFrequencyRole;
  readonly expectedFrequencyDtoKey?: string | null;
}

interface ReportQueryIdentity {
  readonly datasetId: unknown;
  readonly generation: unknown;
  readonly baseQueryKey: unknown;
  readonly mode: unknown;
  readonly year: unknown;
}

interface FrequencyIdentity {
  readonly datasetId: unknown;
  readonly generation: unknown;
  readonly baseQueryKey: unknown;
  readonly role: unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertFiniteNumbers(value: unknown): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("INVALID_BETA_SUMMARY_INPUT");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertFiniteNumbers);
    return;
  }
  if (record(value)) {
    Object.values(value).forEach(assertFiniteNumbers);
  }
}

function parseJsonTuple(value: string, code: string): readonly unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(code);
    }
    return parsed;
  } catch {
    throw new Error(code);
  }
}

function reportQueryIdentity(report: BetaReportDtoV1): ReportQueryIdentity {
  const tuple = parseJsonTuple(report.identity.reportQueryKey, "BETA_SUMMARY_REPORT_QUERY_INVALID");
  if (tuple.length !== 6 || tuple[0] !== BETA_REPORT_QUERY_SCHEMA_VERSION) {
    throw new Error("BETA_SUMMARY_REPORT_QUERY_INVALID");
  }
  return {
    datasetId: tuple[1],
    generation: tuple[2],
    baseQueryKey: tuple[3],
    mode: tuple[4],
    year: tuple[5],
  };
}

function frequencyIdentity(value: string): FrequencyIdentity {
  const tuple = parseJsonTuple(value, "BETA_SUMMARY_FREQUENCY_KEY_INVALID");
  if (tuple.length !== 7 || tuple[0] !== WORD_FREQUENCY_SCHEMA_VERSION) {
    throw new Error("BETA_SUMMARY_FREQUENCY_KEY_INVALID");
  }
  return {
    datasetId: tuple[1],
    generation: tuple[2],
    baseQueryKey: tuple[3],
    role: tuple[4],
  };
}

function assertMatchingWordPresentation(
  report: BetaReportDtoV1,
  source: ShareCardVocabularySourceV1,
  options: BetaSummaryAdapterOptions,
): void {
  if (source.frequencyDtoKey === null) {
    if (source.status === "ready") {
      throw new Error("BETA_SUMMARY_FREQUENCY_KEY_INVALID");
    }
    return;
  }
  const reportIdentity = reportQueryIdentity(report);
  const frequency = frequencyIdentity(source.frequencyDtoKey);
  if (
    frequency.datasetId !== reportIdentity.datasetId ||
    frequency.generation !== reportIdentity.generation ||
    frequency.baseQueryKey !== reportIdentity.baseQueryKey ||
    source.role !== frequency.role ||
    source.year !== (report.metadata.mode === "annual" ? report.metadata.year : null) ||
    (options.expectedWordRole !== undefined && source.role !== options.expectedWordRole) ||
    (options.expectedFrequencyDtoKey !== undefined && source.frequencyDtoKey !== options.expectedFrequencyDtoKey)
  ) {
    throw new Error("BETA_SUMMARY_FREQUENCY_MISMATCH");
  }
}

function yearFromDate(value: string): number {
  return Number(value.slice(0, 4));
}

function isFullCalendarRange(startDate: string, endDate: string): boolean {
  return startDate === `${yearFromDate(startDate)}-01-01` &&
    endDate === `${yearFromDate(endDate)}-12-31`;
}

function summaryScope(report: BetaReportDtoV1): BetaSummaryDtoV1["scope"] {
  const { startDate, endDate } = report.metadata.currentRange;
  const partial = report.metadata.scope === "partial-calendar-query" || !isFullCalendarRange(startDate, endDate);
  if (report.metadata.mode === "annual" && report.metadata.year !== null) {
    return {
      kind: "single-year",
      year: report.metadata.year,
      startDate,
      endDate,
      partial,
    };
  }
  return {
    kind: "all-years",
    year: null,
    startDate,
    endDate,
    partial,
  };
}

function fact<T>(
  partial: boolean,
  value: T | null,
  unavailableReason: "NO_PEAK_BUCKET" | "NO_STREAK" | "NO_SENDER_COMPARISON",
): BetaSummaryFactV1<T> {
  if (value === null) {
    return { status: "unavailable", value: null, reason: unavailableReason };
  }
  return partial
    ? { status: "partial", value, reason: "PARTIAL_DATE_RANGE" }
    : { status: "available", value };
}

function monthFact(report: BetaReportDtoV1, partial: boolean): BetaSummaryFactV1<BetaSummaryMonthFactV1> {
  const peak = report.facts.peakMonth;
  const value = peak.maxCount === null || peak.ties.length === 0
    ? null
    : {
        monthKeys: peak.ties.map((monthKey) => monthKey),
        messageCount: peak.maxCount,
      };
  return fact(partial, value, "NO_PEAK_BUCKET");
}

function streakFact(report: BetaReportDtoV1, partial: boolean): BetaSummaryFactV1<BetaSummaryStreakFactV1> {
  const streak = report.facts.longestStreak;
  const value = streak.length <= 0 || streak.intervals.length === 0
    ? null
    : {
        length: streak.length,
        intervals: streak.intervals.map((interval) => ({
          startDate: interval.startDate,
          endDate: interval.endDate,
          length: interval.length,
        })),
      };
  return fact(partial, value, "NO_STREAK");
}

function senderFact(report: BetaReportDtoV1, partial: boolean): BetaSummaryFactV1<BetaSummarySenderComparisonV1> {
  const sender = report.facts.senderShare;
  const value = sender.denominator <= 0 || sender.owner.share === null || sender.other.share === null
    ? null
    : {
        denominator: sender.denominator,
        owner: {
          role: "owner" as const,
          count: sender.owner.count,
          share: sender.owner.share,
        },
        other: {
          role: "other" as const,
          count: sender.other.count,
          share: sender.other.share,
        },
        filterBehavior: "ignores-global-sender-filter" as const,
      };
  return fact(partial, value, "NO_SENDER_COMPARISON");
}

function summaryVocabulary(
  report: BetaReportDtoV1,
  options: BetaSummaryAdapterOptions,
): BetaSummaryVocabularyV1 {
  if (options.includeVocabulary !== true) {
    return { mode: "off", items: [] };
  }
  const source = options.wordPresentation;
  if (source === undefined) {
    return { mode: "unavailable", items: [], reason: "NO_VISIBLE_CANDIDATES" };
  }
  assertMatchingWordPresentation(report, source, options);
  const candidates = selectShareCardVocabularyV1(source, MAX_SHARE_CARD_VOCABULARY_ITEMS);
  if (candidates.length === 0) {
    return { mode: "unavailable", items: [], reason: "NO_VISIBLE_CANDIDATES" };
  }
  return {
    mode: "on",
    items: candidates.map((candidate) => ({
      displayRank: candidate.displayRank,
      token: candidate.displayToken,
    })),
  };
}

export function createBetaSummaryDtoV1(
  report: BetaReportDtoV1,
  options: BetaSummaryAdapterOptions = {},
): BetaSummaryDtoV1 {
  validateBetaReportDtoV1(report);
  assertFiniteNumbers(report.facts);
  const scope = summaryScope(report);
  const totalMessages = report.facts.totalMessages.value;
  const dto: BetaSummaryDtoV1 = {
    schemaVersion: BETA_SUMMARY_SCHEMA_VERSION,
    identity: {
      datasetId: report.identity.datasetId,
      generation: report.identity.generation,
      reportQueryKey: report.identity.reportQueryKey,
    },
    scope,
    timezone: BETA_REPORT_TIMEZONE,
    senderFilter: report.metadata.appliedFilters.sender,
    facts: {
      totalMessages: scope.partial
        ? { status: "partial", value: { count: totalMessages }, reason: "PARTIAL_DATE_RANGE" }
        : { status: "available", value: { count: totalMessages } },
      activeDays: scope.partial
        ? { status: "partial", value: { count: report.facts.activeDays.value }, reason: "PARTIAL_DATE_RANGE" }
        : { status: "available", value: { count: report.facts.activeDays.value } },
      mostActiveMonth: monthFact(report, scope.partial),
      longestStreak: streakFact(report, scope.partial),
      senderComparison: senderFact(report, scope.partial),
    },
    vocabulary: summaryVocabulary(report, options),
    exportAvailability: totalMessages > 0
      ? { status: "ready", reason: null }
      : { status: "unavailable", reason: "NO_USER_MESSAGES" },
    footer: {
      localOnlyLabel: "本地生成 · 不上传",
      productSignature: "聊天记录分析",
    },
    versions: {
      presenter: BETA_SUMMARY_PRESENTER_VERSION,
      copy: SHARE_CARD_COPY_VERSION,
      artwork: SHARE_CARD_ART_VERSION,
    },
  };
  validateBetaSummaryDtoV1(dto);
  return dto;
}
