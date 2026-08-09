import type { BetaProductMode } from "./report-state";

export function BetaModeNavigation({
  mode,
  onModeChange,
}: {
  readonly mode: BetaProductMode;
  readonly onModeChange: (mode: BetaProductMode) => void;
}) {
  return (
    <nav className="beta-mode-navigation" aria-label="产品模式">
      <button
        className="beta-mode-home"
        type="button"
        aria-current={mode === "home" ? "page" : undefined}
        onClick={() => onModeChange("home")}
      >
        首页
      </button>
      <div className="beta-mode-segments" aria-label="分析视图">
        <button
          type="button"
          aria-pressed={mode === "annual-recap"}
          onClick={() => onModeChange("annual-recap")}
        >
          年度回顾
        </button>
        <button
          type="button"
          aria-pressed={mode === "detailed-analysis"}
          onClick={() => onModeChange("detailed-analysis")}
        >
          详细分析
        </button>
      </div>
    </nav>
  );
}
