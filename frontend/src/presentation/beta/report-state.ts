import type {
  CanonicalAnalysisFilters,
  CanonicalDatasetSummary,
} from "../../worker-analysis/analytics-contract";

export type BetaProductMode = "home" | "annual-recap" | "detailed-analysis";

export interface DateRange {
  readonly startDate: string;
  readonly endDate: string;
}

export type BetaReportSelection =
  | { readonly kind: "year"; readonly year: number }
  | { readonly kind: "all-years" }
  | { readonly kind: "multi-year-overview" };

export interface RepresentedYearOption {
  readonly year: number;
  readonly scope: "full-calendar-query" | "partial-calendar-query";
}

export interface BetaReportPresentationState {
  readonly datasetSessionKey: string;
  readonly reportBaseRange: DateRange;
  readonly selection: BetaReportSelection;
  readonly recoveryUsesDatasetRange: boolean;
}

export interface ReportStateContext {
  readonly datasetSessionKey: string;
  readonly committedFilters: CanonicalAnalysisFilters;
  readonly datasetRange: DateRange;
  readonly representedYears: readonly number[];
  readonly recovery?: boolean;
}

export interface ReportQueryTransition {
  readonly state: BetaReportPresentationState;
  readonly filters: CanonicalAnalysisFilters;
}

export function rangeFromFilters(filters: CanonicalAnalysisFilters): DateRange {
  return { startDate: filters.startDate, endDate: filters.endDate };
}

export function datasetRange(
  dataset: Pick<CanonicalDatasetSummary, "minimumCalendarDate" | "maximumCalendarDate">,
): DateRange {
  return {
    startDate: dataset.minimumCalendarDate,
    endDate: dataset.maximumCalendarDate,
  };
}

export function representedYearsFromBuckets(
  buckets: readonly { readonly key: string; readonly count: number }[],
): readonly number[] {
  return buckets
    .filter((bucket) => bucket.count > 0 && /^[0-9]{4}$/u.test(bucket.key))
    .map((bucket) => Number(bucket.key))
    .filter((year) => Number.isSafeInteger(year))
    .sort((left, right) => left - right);
}

export function calendarYearRange(year: number): DateRange {
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999) {
    throw new Error("INVALID_REPORT_YEAR");
  }
  const value = String(year).padStart(4, "0");
  return { startDate: `${value}-01-01`, endDate: `${value}-12-31` };
}

export function intersectRangeWithYear(
  baseRange: DateRange,
  year: number,
): DateRange | null {
  const yearRange = calendarYearRange(year);
  const startDate = baseRange.startDate > yearRange.startDate
    ? baseRange.startDate
    : yearRange.startDate;
  const endDate = baseRange.endDate < yearRange.endDate
    ? baseRange.endDate
    : yearRange.endDate;
  return startDate > endDate ? null : { startDate, endDate };
}

export function representedYearOptions(
  years: readonly number[],
  baseRange: DateRange,
): readonly RepresentedYearOption[] {
  return [...new Set(years)]
    .sort((left, right) => left - right)
    .flatMap((year): readonly RepresentedYearOption[] => {
      const intersection = intersectRangeWithYear(baseRange, year);
      if (intersection === null) {
        return [];
      }
      const fullYear = calendarYearRange(year);
      return [{
        year,
        scope:
          intersection.startDate === fullYear.startDate &&
          intersection.endDate === fullYear.endDate
            ? "full-calendar-query"
            : "partial-calendar-query",
      }];
    });
}

export function defaultRepresentedYear(
  options: readonly RepresentedYearOption[],
): RepresentedYearOption | undefined {
  const full = options.filter((option) => option.scope === "full-calendar-query");
  return (full.length > 0 ? full : options).at(-1);
}

function initialSelection(
  filters: CanonicalAnalysisFilters,
  options: readonly RepresentedYearOption[],
): BetaReportSelection {
  if (filters.selectedYear !== null) {
    return { kind: "year", year: filters.selectedYear };
  }
  const defaultYear = defaultRepresentedYear(options);
  return defaultYear === undefined
    ? { kind: "all-years" }
    : { kind: "year", year: defaultYear.year };
}

export function initializeReportPresentationState(
  context: ReportStateContext,
): BetaReportPresentationState {
  const recoveryUsesDatasetRange =
    context.recovery === true && context.committedFilters.selectedYear !== null;
  const reportBaseRange = recoveryUsesDatasetRange
    ? context.datasetRange
    : rangeFromFilters(context.committedFilters);
  return {
    datasetSessionKey: context.datasetSessionKey,
    reportBaseRange,
    selection: initialSelection(
      context.committedFilters,
      representedYearOptions(context.representedYears, reportBaseRange),
    ),
    recoveryUsesDatasetRange,
  };
}

export function selectReportYear(
  state: BetaReportPresentationState,
  committedFilters: CanonicalAnalysisFilters,
  year: number,
): ReportQueryTransition | null {
  const effectiveRange = intersectRangeWithYear(state.reportBaseRange, year);
  if (effectiveRange === null) {
    return null;
  }
  return {
    state: {
      ...state,
      selection: { kind: "year", year },
      recoveryUsesDatasetRange: false,
    },
    filters: {
      ...committedFilters,
      ...effectiveRange,
      selectedYear: year,
    },
  };
}

export function selectAllReportYears(
  state: BetaReportPresentationState,
  committedFilters: CanonicalAnalysisFilters,
): ReportQueryTransition {
  return {
    state: {
      ...state,
      selection: { kind: "all-years" },
      recoveryUsesDatasetRange: false,
    },
    filters: {
      ...committedFilters,
      ...state.reportBaseRange,
      selectedYear: null,
    },
  };
}

export function selectMultiYearOverview(
  state: BetaReportPresentationState,
): BetaReportPresentationState {
  return {
    ...state,
    selection: { kind: "multi-year-overview" },
  };
}

export function selectMultiYearReportRange(
  state: BetaReportPresentationState,
  committedFilters: CanonicalAnalysisFilters,
): ReportQueryTransition {
  const allYears = selectAllReportYears(state, committedFilters);
  return {
    state: selectMultiYearOverview(allYears.state),
    filters: allYears.filters,
  };
}

export function committedReportSelection(
  presentationSelection: BetaReportSelection,
  committedFilters: CanonicalAnalysisFilters,
): BetaReportSelection {
  if (committedFilters.selectedYear !== null) {
    return { kind: "year", year: committedFilters.selectedYear };
  }
  return presentationSelection.kind === "multi-year-overview"
    ? presentationSelection
    : { kind: "all-years" };
}

export function applyGlobalReportRange(
  state: BetaReportPresentationState,
  committedFilters: CanonicalAnalysisFilters,
): BetaReportPresentationState {
  return {
    ...state,
    reportBaseRange: rangeFromFilters(committedFilters),
    selection:
      committedFilters.selectedYear === null
        ? { kind: "all-years" }
        : { kind: "year", year: committedFilters.selectedYear },
    recoveryUsesDatasetRange: false,
  };
}

export function restoreDatasetReportRange(
  state: BetaReportPresentationState,
  committedFilters: CanonicalAnalysisFilters,
  fullDatasetRange: DateRange,
): ReportQueryTransition {
  return {
    state: {
      ...state,
      reportBaseRange: fullDatasetRange,
      selection: { kind: "all-years" },
      recoveryUsesDatasetRange: false,
    },
    filters: {
      ...committedFilters,
      ...fullDatasetRange,
      selectedYear: null,
    },
  };
}

export function reportSelectionValue(selection: BetaReportSelection): string {
  if (selection.kind === "year") {
    return `year:${selection.year}`;
  }
  return selection.kind;
}
