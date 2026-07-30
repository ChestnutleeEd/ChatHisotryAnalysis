import { useEffect, useRef, useState } from "react";

import { DisabledBrowserInput } from "../browser-input/port";
import { MAIN_THREAD_ANALYSIS_FALLBACK } from "../privacy/constraints";
import { AnalysisWorkerClient } from "../worker-analysis/worker-client";
import {
  renderWordCloudProbe,
  type WordCloudProbe,
} from "./word-cloud-probe";

type ProbeState = "checking" | "ready" | "unavailable";

export function App() {
  const chartContainer = useRef<HTMLDivElement>(null);
  const [workerState, setWorkerState] = useState<ProbeState>("checking");
  const [tokenCount, setTokenCount] = useState(0);
  const [tokenSignature, setTokenSignature] = useState("");
  const [chartState, setChartState] = useState<ProbeState>("checking");
  const [pngPrefix, setPngPrefix] = useState("");
  const browserInput = new DisabledBrowserInput().availability();

  useEffect(() => {
    const client = new AnalysisWorkerClient();
    let active = true;

    void client
      .runSyntheticProbe()
      .then((result) => {
        if (active) {
          setTokenCount(result.tokens.length);
          setTokenSignature(result.tokens.join("|"));
          setWorkerState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setWorkerState("unavailable");
        }
      });

    return () => {
      active = false;
      client.dispose();
    };
  }, []);

  useEffect(() => {
    const container = chartContainer.current;
    if (container === null) {
      setChartState("unavailable");
      return;
    }

    let active = true;
    let probe: WordCloudProbe | undefined;
    void renderWordCloudProbe(container)
      .then((result) => {
        probe = result;
        if (active) {
          setPngPrefix(result.pngDataUrl.slice(0, 22));
          setChartState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setChartState("unavailable");
        }
      });

    return () => {
      active = false;
      probe?.dispose();
    };
  }, []);

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">STAGE 1B · LOCAL INFRASTRUCTURE</p>
        <h1>本地聊天分析基础设施探针</h1>
        <p>
          当前页面只验证本地 Worker、内嵌 WASM 与 Canvas 词云渲染。聊天文件导入和真实分析尚未实现。
        </p>
      </header>

      <section className="status-grid" aria-label="基础设施状态">
        <article className="status-card">
          <span>Worker + Jieba WASM</span>
          <strong data-testid="worker-status">{workerState}</strong>
          <small
            data-testid="token-count"
            data-token-signature={tokenSignature}
          >
            合成探针 token：{tokenCount}
          </small>
        </article>
        <article className="status-card">
          <span>ECharts + word cloud</span>
          <strong data-testid="chart-status">{chartState}</strong>
          <small
            data-testid="png-status"
            data-png-prefix={pngPrefix}
          >
            PNG：{pngPrefix === "" ? "等待" : "本地可导出"}
          </small>
        </article>
        <article className="status-card">
          <span>浏览器输入边界</span>
          <strong data-testid="input-status">{browserInput.kind}</strong>
          <small>{browserInput.reason}</small>
        </article>
        <article className="status-card">
          <span>主线程分析回退</span>
          <strong data-testid="fallback-status">
            {MAIN_THREAD_ANALYSIS_FALLBACK}
          </strong>
          <small>Worker 失败时保持不可用状态</small>
        </article>
      </section>

      <section className="probe-panel" aria-labelledby="probe-heading">
        <div>
          <p className="eyebrow">SYNTHETIC CANVAS PROBE</p>
          <h2 id="probe-heading">固定合成输入</h2>
          <p>只用于证明本地扩展注册和 PNG 导出能力；不读取或统计任何聊天内容。</p>
        </div>
        <div
          className="chart"
          ref={chartContainer}
          role="img"
          aria-label="由本地、隐私、分析、测试四个合成词生成的基础词云探针"
        />
      </section>
      <footer className="footer">
        <a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a>
      </footer>
    </main>
  );
}
