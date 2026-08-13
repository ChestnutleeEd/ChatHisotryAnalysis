import { useEffect, useRef } from "react";

import type { BetaProductMode } from "./report-state";
import { Navigation } from "./primitives";

export function BetaModeNavigation({
  mode,
  onModeChange,
}: {
  readonly mode: BetaProductMode;
  readonly onModeChange: (mode: BetaProductMode) => void;
}) {
  const previousMode = useRef(mode);

  useEffect(() => {
    if (previousMode.current === mode) {
      return;
    }
    previousMode.current = mode;
    const focusTimer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-beta-mode="${mode}"] [data-mode-focus-target], [data-beta-mode="${mode}"] h1[tabindex], [data-beta-mode="${mode}"] .dashboard-panel-wrap`,
      );
      target?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [mode]);

  return (
    <Navigation label="产品模式" className="beta-mode-navigation">
      <button
        className="beta-mode-home"
        type="button"
        aria-current={mode === "home" ? "page" : undefined}
        aria-pressed={mode === "home"}
        onClick={() => onModeChange("home")}
      >
        首页
      </button>
      <div className="beta-mode-segments" aria-label="分析视图">
        <button
          type="button"
          className={mode === "annual-recap" ? "is-current" : undefined}
          aria-pressed={mode === "annual-recap"}
          aria-current={mode === "annual-recap" ? "page" : undefined}
          onClick={() => onModeChange("annual-recap")}
        >
          年度报告
        </button>
        <button
          type="button"
          className={mode === "detailed-analysis" ? "is-current" : undefined}
          aria-pressed={mode === "detailed-analysis"}
          aria-current={mode === "detailed-analysis" ? "page" : undefined}
          onClick={() => onModeChange("detailed-analysis")}
        >
          详细分析
        </button>
      </div>
    </Navigation>
  );
}
