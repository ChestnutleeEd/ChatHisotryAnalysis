import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildBetaReportDto,
} from "./report-adapter";
import { createBetaSummaryDtoV1 } from "./summary-adapter";
import { presentBetaSummaryZhCN } from "./summary-presenter";
import { presentBetaReportZhCN } from "./locales/zh-CN";
import { BetaAnnualReport } from "./BetaAnnualReport";
import {
  initializeReportPresentationState,
  representedYearOptions,
  type BetaReportPresentationState,
} from "./report-state";
import {
  syntheticBetaAllYearsReportResult,
  syntheticBetaAnnualReportResult,
  syntheticBetaSparseAnnualReportResult,
} from "./synthetic-report-fixture";
import { syntheticBetaWordCloudFrequency } from "./synthetic-word-cloud-fixture";
import type { WordFrequencyRole } from "../../worker-analysis/word-frequency-contract";
import type { BetaReportMode } from "./report-contract";
import { BETA_REPORT_SECTIONS, type BetaReportSectionId } from "./report-sections";
import { SkipLink } from "./primitives";
import {
  createWordFrequencyPresentation,
  readCustomHiddenWords,
} from "./word-presentation";
import { readVocabularyCleanMode } from "./clean-vocabulary";
import type { ShareCardPreviewModels } from "./share-preview-state";

type HarnessMode = Exclude<BetaReportMode, "annual"> | "annual";

function reportStateFor(
  result: ReturnType<typeof syntheticBetaAnnualReportResult>,
  mode: HarnessMode,
): BetaReportPresentationState {
  const initial = initializeReportPresentationState({
    datasetSessionKey: `synthetic:${result.generation}`,
    committedFilters: result.filters,
    datasetRange: { startDate: "2024-01-01", endDate: "2025-12-31" },
    representedYears: [2024, 2025],
  });
  return mode === "annual"
    ? initial
    : { ...initial, selection: { kind: mode } };
}

export function BetaAnnualReportBrowserHarness() {
  const searchParams = new URLSearchParams(window.location.search);
  const saveScenario = searchParams.get("save") ?? "saved";
  const sparseFixture = searchParams.get("sparse") === "1";
  const vocabularyFixture = searchParams.get("vocabulary") ?? "ready";
  const [mode, setMode] = useState<HarnessMode>("annual");
  const [year, setYear] = useState(2025);
  const [wordRole, setWordRole] = useState<WordFrequencyRole>("both");
  const [vocabularyRecovered, setVocabularyRecovered] = useState(false);
  const [loadingErrored, setLoadingErrored] = useState(false);
  const [scopeTransitionPending, setScopeTransitionPending] = useState(false);
  const [selectedSection, setSelectedSection] = useState<BetaReportSectionId>("opening");
  const saveAttemptsRef = useRef(0);
  const [saveAttempts, setSaveAttempts] = useState(0);
  useEffect(() => {
    if (vocabularyFixture !== "loading-error" && vocabularyFixture !== "loading-recover") {
      return;
    }
    const timeout = window.setTimeout(() => {
      if (vocabularyFixture === "loading-error") {
        setLoadingErrored(true);
      } else {
        setVocabularyRecovered(true);
      }
    }, 1_200);
    return () => window.clearTimeout(timeout);
  }, [vocabularyFixture]);
  const result = useMemo(() => {
    const base = sparseFixture
      ? syntheticBetaSparseAnnualReportResult()
      : mode === "annual" ? syntheticBetaAnnualReportResult(year) : syntheticBetaAllYearsReportResult();
    if (vocabularyFixture !== "keywords-sparse" && vocabularyFixture !== "both-sparse") {
      return base;
    }
    return {
      ...base,
      stage7: {
        ...base.stage7,
        yearlyKeywords: {
          ...base.stage7.yearlyKeywords,
          years: base.stage7.yearlyKeywords.years.map((candidate) => candidate.year === base.filters.selectedYear
            ? { ...candidate, keywords: candidate.keywords.slice(-2) }
            : candidate),
        },
      },
    };
  }, [mode, sparseFixture, vocabularyFixture, year]);
  const reportState = useMemo(() => reportStateFor(result, mode), [mode, result]);
  const viewModel = useMemo(() => presentBetaReportZhCN(buildBetaReportDto(result, {
    mode,
    year: mode === "annual" ? year : null,
  })), [mode, result, year]);
  const frequency = useMemo(() => {
    const ready = syntheticBetaWordCloudFrequency(mode === "annual" ? year : null, wordRole);
    if (
      vocabularyFixture === "loading" ||
      vocabularyFixture === "error" ||
      vocabularyFixture === "loading-error" ||
      (vocabularyFixture === "error-recover" && !vocabularyRecovered) ||
      (vocabularyFixture === "loading-recover" && !vocabularyRecovered) ||
      scopeTransitionPending
    ) {
      return undefined;
    }
    if (vocabularyFixture === "zero") {
      return {
        ...ready,
        denominator: { ...ready.denominator, eligibleTokenCount: 0, status: "empty" as const, emptyReason: "NO_ELIGIBLE_TOKENS" as const },
        items: [],
      };
    }
    if (vocabularyFixture === "clean-shift") {
      return { ...ready, items: ready.items.slice(0, 13) };
    }
    if (vocabularyFixture === "hidden-shift" || vocabularyFixture === "role-shift") {
      const limit = vocabularyFixture === "role-shift" && wordRole === "owner" ? 3 : 5;
      return {
        ...ready,
        items: ready.items.slice(10, 10 + limit).map((item, index) => ({ ...item, rank: index + 1 })),
      };
    }
    if (vocabularyFixture === "sparse" || vocabularyFixture === "both-sparse") {
      return { ...ready, items: ready.items.filter((item) => item.rank >= 11).slice(0, 3).map((item, index) => ({ ...item, rank: index + 1 })) };
    }
    return ready;
  }, [mode, scopeTransitionPending, vocabularyFixture, vocabularyRecovered, wordRole, year]);
  function buildShareCardModels(): ShareCardPreviewModels {
    const reportDto = buildBetaReportDto(result, {
      mode,
      year: mode === "annual" ? year : null,
    });
    const summary = createBetaSummaryDtoV1(reportDto);
    if (sparseFixture) {
      const unavailable = presentBetaSummaryZhCN(summary);
      return { off: unavailable, on: unavailable };
    }
    const wordPresentation = createWordFrequencyPresentation(
      frequency,
      readCustomHiddenWords(),
      "raw-count",
      undefined,
      readVocabularyCleanMode(),
    );
    return {
      off: presentBetaSummaryZhCN(summary),
      on: presentBetaSummaryZhCN(createBetaSummaryDtoV1(reportDto, {
        includeVocabulary: true,
        wordPresentation,
        expectedWordRole: wordRole,
        expectedFrequencyDtoKey: wordPresentation.frequencyDtoKey,
      })),
    };
  }
  const representedYears = representedYearOptions([2024, 2025], { startDate: "2024-01-01", endDate: "2025-12-31" });

  function changeRange(value: string): void {
    if (value === "all-years" || value === "multi-year-overview") {
      setMode(value);
      return;
    }
    const match = /^year:([0-9]{4})$/u.exec(value);
    if (match !== null) {
      setYear(Number(match[1]));
      setMode("annual");
    }
  }

  function changeSection(section: BetaReportSectionId): void {
    setSelectedSection(section);
    document.getElementById(section)?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  function changeWordRole(role: WordFrequencyRole): void {
    setWordRole(role);
    if (vocabularyFixture === "error-recover" || vocabularyFixture === "loading-recover") {
      setVocabularyRecovered(true);
    }
    if (vocabularyFixture === "loading-error") {
      setLoadingErrored(true);
    }
    if (vocabularyFixture === "scope-transition") {
      setScopeTransitionPending(true);
      window.setTimeout(() => setScopeTransitionPending(false), 450);
    }
  }

  async function saveSyntheticShareCardPng(): Promise<"saved" | "cancelled"> {
    saveAttemptsRef.current += 1;
    setSaveAttempts(saveAttemptsRef.current);
    if (saveScenario === "delayed") {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 550));
    }
    if (saveScenario === "failed") {
      const error = new Error("synthetic save failure") as Error & { code?: string };
      error.code = "EXPORT_WRITE_FAILED";
      throw error;
    }
    return saveScenario === "cancelled" ? "cancelled" : "saved";
  }

  return (
    <main className="desktop-app beta-enabled" data-visual-version="v3" data-v3-surface="annual" data-testid="beta-annual-recap-harness" data-save-attempts={saveAttempts}>
      <SkipLink />
      <header className="desktop-app-header">
        <div className="beta-product-identity">
          <p className="beta-type-eyebrow">浏览器合成验收</p>
          <p className="beta-product-name">本地聊天分析 · Annual Recap</p>
          <p className="beta-product-context">仅使用合成指标；不读取聊天内容、文件名或路径。</p>
        </div>
        <span className="beta-badge beta-badge-privacy">本地处理 · 不上传</span>
      </header>
      <BetaAnnualReport
        viewModel={viewModel}
        reportState={reportState}
        representedYears={representedYears}
        selectedSection={selectedSection}
        pending={false}
        analyticsResult={result}
        wordFrequency={frequency}
        wordRole={wordRole}
        wordFrequencyPending={vocabularyFixture === "loading" || (vocabularyFixture === "loading-recover" && !vocabularyRecovered) || (vocabularyFixture === "loading-error" && !loadingErrored) || scopeTransitionPending}
        wordFrequencyError={vocabularyFixture === "error" || loadingErrored || (vocabularyFixture === "error-recover" && !vocabularyRecovered) ? "合成词频暂时不可用，请调整范围后重试。" : undefined}
        onRangeChange={changeRange}
        onSectionChange={changeSection}
        onRestoreFullRange={() => { setMode("all-years"); }}
        onOpenDetailed={() => undefined}
        onWordRoleChange={changeWordRole}
        shareCardViewModel={buildShareCardModels().off}
        onBuildSharePreview={buildShareCardModels}
        onSaveShareCardPng={saveSyntheticShareCardPng}
      />
      <p className="visually-hidden">{BETA_REPORT_SECTIONS.length} 个固定逻辑章节。</p>
    </main>
  );
}
