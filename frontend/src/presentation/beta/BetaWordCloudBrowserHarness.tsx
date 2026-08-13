import { useMemo, useState } from "react";

import { BetaButton, SkipLink } from "./primitives";
import { BetaWordCloud } from "./BetaWordCloud";
import { syntheticBetaWordCloudFrequency } from "./synthetic-word-cloud-fixture";
import type { WordFrequencyRole } from "../../worker-analysis/word-frequency-contract";
import type { WordFrequencyMetric } from "./word-presentation";

export function BetaWordCloudBrowserHarness() {
  const [year, setYear] = useState(2025);
  const [role, setRole] = useState<WordFrequencyRole>("both");
  const [metric, setMetric] = useState<WordFrequencyMetric>("raw-count");
  const [hiddenWords, setHiddenWords] = useState<readonly string[]>([]);
  const frequency = useMemo(
    () => syntheticBetaWordCloudFrequency(year, role),
    [role, year],
  );
  return (
    <main className="desktop-app beta-enabled" data-visual-version="v3" data-v3-surface="annual" data-testid="beta-word-cloud-harness">
      <SkipLink href="#word-cloud" />
      <header className="desktop-app-header">
        <div className="beta-product-identity">
          <p className="beta-type-eyebrow">浏览器合成验收</p>
          <h1 className="beta-product-name">年度词云</h1>
          <p className="beta-product-context">只使用合成词频，不读取聊天内容。</p>
        </div>
        <span className="beta-badge beta-badge-privacy">本地处理 · 不上传</span>
      </header>
      <section className="beta-surface-inset beta-harness-controls" aria-label="合成词云控制">
        <fieldset>
          <legend>年份</legend>
          {[2024, 2025].map((value) => (
            <label key={value}>
              <input type="radio" name="harness-year" checked={year === value} onChange={() => setYear(value)} />
              <span>{value} 年</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>发送方</legend>
          {(["both", "owner", "other"] as const).map((value) => (
            <label key={value}>
              <input type="radio" name="harness-role" checked={role === value} onChange={() => setRole(value)} />
              <span>{value === "both" ? "双方" : value === "owner" ? "Owner" : "Other"}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>显示口径</legend>
          <label>
            <input type="radio" name="harness-metric" checked={metric === "raw-count"} onChange={() => setMetric("raw-count")} />
            <span>出现次数</span>
          </label>
          <label>
            <input type="radio" name="harness-metric" checked={metric === "per-10000-eligible-tokens"} onChange={() => setMetric("per-10000-eligible-tokens")} />
            <span>每万词频率</span>
          </label>
        </fieldset>
        <BetaButton variant="tertiary" disabled={hiddenWords.length === 0} onClick={() => setHiddenWords([])}>
          清空隐藏词
        </BetaButton>
      </section>
      <BetaWordCloud
        frequency={frequency}
        metric={metric}
        customHiddenWords={hiddenWords}
        shellState="ready"
        onHideWord={(token) => setHiddenWords((current) => [...current, token])}
      />
    </main>
  );
}
