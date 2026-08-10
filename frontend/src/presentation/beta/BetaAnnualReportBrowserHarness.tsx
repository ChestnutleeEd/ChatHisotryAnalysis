import { useMemo, useState } from "react";

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
} from "./synthetic-report-fixture";
import { syntheticBetaWordCloudFrequency } from "./synthetic-word-cloud-fixture";
import type { WordFrequencyRole } from "../../worker-analysis/word-frequency-contract";
import type { BetaReportMode } from "./report-contract";
import { BETA_REPORT_SECTIONS, type BetaReportSectionId } from "./report-sections";
import { SkipLink } from "./primitives";
import { createWordFrequencyPresentation } from "./word-presentation";
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
  const [mode, setMode] = useState<HarnessMode>("annual");
  const [year, setYear] = useState(2025);
  const [wordRole, setWordRole] = useState<WordFrequencyRole>("both");
  const [selectedSection, setSelectedSection] = useState<BetaReportSectionId>("opening");
  const result = useMemo(
    () => mode === "annual" ? syntheticBetaAnnualReportResult(year) : syntheticBetaAllYearsReportResult(),
    [mode, year],
  );
  const reportState = useMemo(() => reportStateFor(result, mode), [mode, result]);
  const viewModel = useMemo(() => presentBetaReportZhCN(buildBetaReportDto(result, {
    mode,
    year: mode === "annual" ? year : null,
  })), [mode, result, year]);
  const frequency = useMemo(
    () => syntheticBetaWordCloudFrequency(mode === "annual" ? year : null, wordRole),
    [mode, wordRole, year],
  );
  const shareCardModels = useMemo<ShareCardPreviewModels>(() => {
    const reportDto = buildBetaReportDto(result, {
      mode,
      year: mode === "annual" ? year : null,
    });
    const summary = createBetaSummaryDtoV1(reportDto);
    const wordPresentation = createWordFrequencyPresentation(frequency, [], "raw-count", undefined, true);
    return {
      off: presentBetaSummaryZhCN(summary),
      on: presentBetaSummaryZhCN(createBetaSummaryDtoV1(reportDto, {
        includeVocabulary: true,
        wordPresentation,
        expectedWordRole: wordRole,
        expectedFrequencyDtoKey: wordPresentation.frequencyDtoKey,
      })),
    };
  }, [frequency, mode, result, wordRole, year]);
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

  return (
    <main className="desktop-app beta-enabled" data-testid="beta-annual-recap-harness">
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
        wordFrequencyPending={false}
        onRangeChange={changeRange}
        onSectionChange={changeSection}
        onRestoreFullRange={() => { setMode("all-years"); }}
        onOpenDetailed={() => undefined}
        onWordRoleChange={setWordRole}
        shareCardViewModel={shareCardModels.off}
        onBuildSharePreview={() => shareCardModels}
      />
      <p className="visually-hidden">{BETA_REPORT_SECTIONS.length} 个固定逻辑章节。</p>
    </main>
  );
}
