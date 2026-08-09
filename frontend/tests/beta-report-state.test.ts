import { describe, expect, it } from "vitest";

import type { DatasetId, Generation } from "../src/desktop/ipc-contract";
import {
  canonicalQueryKey,
  type CanonicalAnalysisFilters,
} from "../src/worker-analysis/analytics-contract";
import {
  applyGlobalReportRange,
  committedReportSelection,
  defaultRepresentedYear,
  initializeReportPresentationState,
  intersectRangeWithYear,
  representedYearOptions,
  representedYearsFromBuckets,
  restoreDatasetReportRange,
  selectAllReportYears,
  selectMultiYearOverview,
  selectMultiYearReportRange,
  selectReportYear,
  type DateRange,
} from "../src/presentation/beta/report-state";

const DATASET_RANGE: DateRange = {
  startDate: "2022-01-01",
  endDate: "2026-12-31",
};

function filters(
  overrides: Partial<CanonicalAnalysisFilters> = {},
): CanonicalAnalysisFilters {
  return {
    startDate: DATASET_RANGE.startDate,
    endDate: DATASET_RANGE.endDate,
    sender: "both",
    selectedYear: null,
    sessionThresholdHours: 6,
    ...overrides,
  };
}

function initialState(
  overrides: Partial<Parameters<typeof initializeReportPresentationState>[0]> = {},
) {
  return initializeReportPresentationState({
    datasetSessionKey: "synthetic-session-a:dataset-a:1",
    committedFilters: filters(),
    datasetRange: DATASET_RANGE,
    representedYears: [2022, 2023, 2024, 2025, 2026],
    ...overrides,
  });
}

describe("Beta B1a represented-year helpers", () => {
  it("handles no, one, and multiple represented years without inventing empty years", () => {
    expect(representedYearsFromBuckets([])).toEqual([]);
    expect(representedYearsFromBuckets([{ key: "2025", count: 4 }])).toEqual([2025]);
    expect(representedYearsFromBuckets([
      { key: "2025", count: 3 },
      { key: "2023", count: 1 },
      { key: "2024", count: 0 },
    ])).toEqual([2023, 2025]);
  });

  it("prefers the latest full calendar year and labels partial intersections", () => {
    const options = representedYearOptions(
      [2023, 2024, 2025],
      { startDate: "2023-04-12", endDate: "2025-08-30" },
    );
    expect(options).toEqual([
      { year: 2023, scope: "partial-calendar-query" },
      { year: 2024, scope: "full-calendar-query" },
      { year: 2025, scope: "partial-calendar-query" },
    ]);
    expect(defaultRepresentedYear(options)).toEqual({
      year: 2024,
      scope: "full-calendar-query",
    });
    expect(defaultRepresentedYear([
      { year: 2024, scope: "partial-calendar-query" },
      { year: 2025, scope: "partial-calendar-query" },
    ])?.year).toBe(2025);
  });
});

describe("Beta B1a reportBaseRange boundary", () => {
  it("initializes from the committed broad analytical range", () => {
    const state = initialState();
    expect(state.reportBaseRange).toEqual(DATASET_RANGE);
    expect(state.selection).toEqual({ kind: "year", year: 2026 });
  });

  it("switches 2024 to 2025 from the preserved base rather than the narrowed effective range", () => {
    const initial = initialState();
    const yearA = selectReportYear(initial, filters(), 2024);
    expect(yearA?.filters).toMatchObject({
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      selectedYear: 2024,
    });
    expect(yearA?.state.reportBaseRange).toEqual(DATASET_RANGE);

    const yearB = selectReportYear(yearA!.state, yearA!.filters, 2025);
    expect(yearB?.filters).toMatchObject({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      selectedYear: 2025,
    });
    expect(yearB?.state.reportBaseRange).toEqual(DATASET_RANGE);
  });

  it("restores all years from reportBaseRange after a concrete year", () => {
    const year = selectReportYear(initialState(), filters(), 2024)!;
    const all = selectAllReportYears(year.state, year.filters);
    expect(all.filters).toMatchObject({
      ...DATASET_RANGE,
      selectedYear: null,
    });
    expect(all.state.selection).toEqual({ kind: "all-years" });
  });

  it("restores the broad committed range before publishing multi-year overview", () => {
    const year = selectReportYear(initialState(), filters(), 2024)!;
    const overview = selectMultiYearReportRange(year.state, year.filters);
    expect(overview.filters).toMatchObject({
      ...DATASET_RANGE,
      selectedYear: null,
    });
    expect(overview.state.selection).toEqual({ kind: "multi-year-overview" });
    expect(overview.state.reportBaseRange).toEqual(DATASET_RANGE);
  });

  it("derives the visible selector from committed analytics rather than an optimistic selection", () => {
    const current = initialState();
    const requested = selectReportYear(current, filters(), 2024)!;
    expect(committedReportSelection(requested.state.selection, filters())).toEqual({ kind: "all-years" });
    expect(committedReportSelection(requested.state.selection, requested.filters)).toEqual({ kind: "year", year: 2024 });
    expect(committedReportSelection({ kind: "multi-year-overview" }, filters())).toEqual({ kind: "multi-year-overview" });
  });

  it("intersects partial broad ranges and rejects empty year intersections", () => {
    const partial: DateRange = {
      startDate: "2024-06-15",
      endDate: "2025-03-20",
    };
    expect(intersectRangeWithYear(partial, 2024)).toEqual({
      startDate: "2024-06-15",
      endDate: "2024-12-31",
    });
    expect(intersectRangeWithYear(partial, 2025)).toEqual({
      startDate: "2025-01-01",
      endDate: "2025-03-20",
    });
    expect(intersectRangeWithYear(partial, 2023)).toBeNull();
  });

  it("replaces the base only after explicit global Apply", () => {
    const year = selectReportYear(initialState(), filters(), 2024)!;
    const applied = applyGlobalReportRange(
      year.state,
      filters({
        startDate: "2023-02-01",
        endDate: "2025-10-31",
        sender: "owner",
      }),
    );
    expect(applied.reportBaseRange).toEqual({
      startDate: "2023-02-01",
      endDate: "2025-10-31",
    });
    expect(applied.selection).toEqual({ kind: "all-years" });
  });

  it("restores the dataset-supported range and clears the selected year", () => {
    const year = selectReportYear(initialState(), filters(), 2024)!;
    const restored = restoreDatasetReportRange(
      year.state,
      year.filters,
      DATASET_RANGE,
    );
    expect(restored.state.reportBaseRange).toEqual(DATASET_RANGE);
    expect(restored.filters).toMatchObject({
      ...DATASET_RANGE,
      selectedYear: null,
    });
    expect(restored.filters.sender).toBe("both");
    expect(restored.filters.sessionThresholdHours).toBe(6);
  });

  it("resets the base for a new dataset/session and uses dataset bounds for recovered year state", () => {
    const old = selectReportYear(initialState(), filters(), 2024)!;
    const newDatasetRange = { startDate: "2030-02-01", endDate: "2031-11-30" };
    const next = initialState({
      datasetSessionKey: "synthetic-session-b:dataset-b:1",
      committedFilters: filters({
        startDate: "2030-02-01",
        endDate: "2031-11-30",
      }),
      datasetRange: newDatasetRange,
      representedYears: [2030, 2031],
    });
    expect(next.datasetSessionKey).not.toBe(old.state.datasetSessionKey);
    expect(next.reportBaseRange).toEqual(newDatasetRange);
    expect(next.reportBaseRange).not.toEqual(old.state.reportBaseRange);

    const recovered = initialState({
      datasetSessionKey: "synthetic-recovered:dataset-c:4",
      committedFilters: filters({
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        selectedYear: 2025,
      }),
      recovery: true,
    });
    expect(recovered.reportBaseRange).toEqual(DATASET_RANGE);
    expect(recovered.recoveryUsesDatasetRange).toBe(true);
  });

  it("keeps navigation, chapter, scroll, multi-year mode, and reportBaseRange out of canonicalQueryKey", () => {
    const committed = filters({ startDate: "2024-01-01", endDate: "2025-12-31" });
    const datasetId = "ds_00000000000000000000000000000001" as DatasetId;
    const generation = 1 as Generation;
    const before = canonicalQueryKey(datasetId, generation, committed);
    const state = selectMultiYearOverview(initialState());
    const presentationOnly = {
      productMode: "annual-recap",
      dashboardRoute: "Words & Years",
      chapter: "word-cloud",
      scrollPosition: 840,
      reportBaseRange: state.reportBaseRange,
      selection: state.selection,
    };
    expect(presentationOnly.selection).toEqual({ kind: "multi-year-overview" });
    expect(canonicalQueryKey(datasetId, generation, committed)).toBe(before);
  });
});
