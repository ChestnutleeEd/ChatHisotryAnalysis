import { useMemo, useState } from "react";

import type { ApprovedChartKey, ReportFormat } from "../../desktop/ipc-contract";
import {
  validateCanonicalAnalyticsResult,
  type CanonicalAnalysisFilters,
  type CanonicalAnalysisResult,
} from "../../worker-analysis/analytics-contract";
import { DesktopDashboard } from "../DesktopDashboard";
import { classifyAnalyticsError } from "../analytics-error-classifier";
import { BetaHome } from "./BetaHome";
import { BetaModeNavigation } from "./BetaModeNavigation";
import { SkipLink } from "./primitives";
import { createBetaHomeViewModel } from "./view-model";
import {
  syntheticBetaDetailedResult,
  syntheticBetaLongLabelDetailedResult,
  syntheticBetaSparseDetailedResult,
} from "./synthetic-report-fixture";

export function BetaShellBrowserHarness({
  initialMode,
}: {
  readonly initialMode: "home" | "detailed-analysis";
}) {
  const [mode, setMode] = useState<"home" | "detailed-analysis">(initialMode);
  const fixtureState = new URLSearchParams(window.location.search).get("state");
  const [result, setResult] = useState<CanonicalAnalysisResult>(() => (
    fixtureState === "empty"
      ? syntheticBetaSparseDetailedResult()
      : fixtureState === "long"
        ? syntheticBetaLongLabelDetailedResult()
        : syntheticBetaDetailedResult()
  ));
  const [resultError, setResultError] = useState<string | undefined>(() => (
    fixtureState === "error"
      ? "合成结果未通过当前分析契约；上一份已提交结果仍保留。调整条件后可再次应用。"
      : undefined
  ));
  const homeViewModel = useMemo(
    () => createBetaHomeViewModel(result, { startDate: "2024-01-01", endDate: "2025-12-31" }, [2024, 2025]),
    [result],
  );

  function applyFilters(filters: CanonicalAnalysisFilters): void {
    const nextResult = syntheticBetaDetailedResult(filters);
    try {
      validateCanonicalAnalyticsResult(nextResult);
    } catch (error) {
      if (classifyAnalyticsError(error).kind !== "unexpected") {
        setResultError("合成结果未通过当前分析契约；上一份已提交结果仍保留。调整条件后可再次应用。");
        return;
      }
      throw error;
    }
    setResult(nextResult);
    setResultError(undefined);
  }
  function noopExport(_format: ReportFormat, _chartKey: ApprovedChartKey): void {
    void _format;
    void _chartKey;
  }

  return (
    <main className="desktop-app beta-enabled" data-visual-version="v3" data-v3-surface={mode === "home" ? "home" : "detailed"} data-testid={`beta-${initialMode}-harness`}>
      <SkipLink />
      <header className="desktop-app-header">
        <div className="beta-product-identity">
          <div className="beta-product-labels">
            <p className="beta-type-eyebrow">合成验收</p>
            <span className="beta-badge beta-badge-beta">Beta</span>
          </div>
          <p className="beta-product-name">本地聊天分析</p>
          <p className="beta-product-context">只使用合成指标；不读取聊天内容、文件名或路径。</p>
        </div>
        <span className="beta-badge beta-badge-privacy">本地处理 · 不上传</span>
      </header>
      <BetaModeNavigation
        mode={mode}
        onModeChange={(nextMode) => {
          if (nextMode === "home" || nextMode === "detailed-analysis") {
            setMode(nextMode);
          }
        }}
      />
      {mode === "home" ? (
        <BetaHome
          viewModel={homeViewModel}
          pending={false}
          onOpenRecap={() => undefined}
          onOpenDetailed={() => setMode("detailed-analysis")}
          onAnalyzeOtherFiles={() => undefined}
          onRestoreFullRange={() => undefined}
        />
      ) : (
        <div data-beta-mode="detailed-analysis">
          <DesktopDashboard
            result={result}
            pending={fixtureState === "loading"}
            onFilterChange={applyFilters}
            onAnalyzeOtherFiles={() => undefined}
            onExport={noopExport}
            initialRoute="Overview"
            onRouteChange={() => undefined}
            resultError={resultError}
          />
        </div>
      )}
    </main>
  );
}
