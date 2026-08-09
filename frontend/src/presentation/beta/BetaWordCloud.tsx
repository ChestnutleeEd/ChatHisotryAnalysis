import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  WORD_CLOUD_MIN_FREQUENCY,
  WORD_CLOUD_VIEWPORT_SPECS,
  createWordCloudLayoutRequest,
  viewportBucketForWidth,
  type WordCloudViewportBucket,
} from "../../word-cloud-layout/contracts";
import {
  WordCloudLayoutClientCancelledError,
} from "../../word-cloud-layout/client";
import {
  WordCloudLayoutCoordinator,
  type CoordinatedWordCloudLayoutResult,
} from "../../word-cloud-layout/coordinator";
import {
  createWordCloudPresentation,
  type WordCloudPresentationV1,
} from "../../word-cloud-layout/presentation";
import type { WorkerWordFrequencyDtoV1 } from "../../worker-analysis/word-frequency-contract";
import {
  Badge,
  BetaButton,
  MethodologyDisclosure,
} from "./primitives";
import {
  renderWordCloudToCanvas,
  type WordCloudCanvasRenderReport,
} from "./word-cloud-renderer";
import type { WordFrequencyMetric } from "./word-presentation";

const ROLE_LABELS = {
  both: "双方",
  owner: "Owner",
  other: "Other",
} as const;

interface LayoutViewState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly presentationDigest?: string;
  readonly outcome?: CoordinatedWordCloudLayoutResult;
}

function defaultCanvasWidth(bucket: WordCloudViewportBucket): number {
  return WORD_CLOUD_VIEWPORT_SPECS[bucket].width;
}

function stableKeyForPresentationWord(
  normalizedToken: string,
  sourceRank: number,
): string {
  return JSON.stringify([normalizedToken, sourceRank]);
}

function wordCloudListItems(
  presentation: WordCloudPresentationV1,
) {
  return presentation.items;
}

function formatRate(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function clearCanvasFrame(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): void {
  const backingWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const backingHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = backingWidth;
  canvas.height = backingHeight;
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, backingWidth, backingHeight);
}

export function BetaWordCloud({
  frequency,
  metric,
  customHiddenWords,
  cleanMode = true,
  pending = false,
  onHideWord,
}: {
  readonly frequency?: WorkerWordFrequencyDtoV1;
  readonly metric: WordFrequencyMetric;
  readonly customHiddenWords: readonly string[];
  readonly cleanMode?: boolean;
  readonly pending?: boolean;
  readonly onHideWord?: (token: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const coordinatorRef = useRef<WordCloudLayoutCoordinator | undefined>(undefined);
  const [viewportBucket, setViewportBucket] = useState<WordCloudViewportBucket>("standard");
  const [canvasWidth, setCanvasWidth] = useState(defaultCanvasWidth("standard"));
  const [devicePixelRatio, setDevicePixelRatio] = useState(1);
  const [layoutState, setLayoutState] = useState<LayoutViewState>({ status: "idle" });
  const [canvasAvailable, setCanvasAvailable] = useState(true);
  const [rendererReport, setRendererReport] = useState<WordCloudCanvasRenderReport>();

  const wordLimit = WORD_CLOUD_VIEWPORT_SPECS[viewportBucket].defaultWordLimit;
  const presentation = useMemo(() => {
    if (frequency === undefined) {
      return undefined;
    }
    try {
      return createWordCloudPresentation(
        frequency,
        customHiddenWords,
        metric,
        wordLimit,
        WORD_CLOUD_MIN_FREQUENCY,
        cleanMode,
      );
    } catch {
      return undefined;
    }
  }, [cleanMode, customHiddenWords, frequency, metric, wordLimit]);

  useEffect(() => {
    const coordinator = new WordCloudLayoutCoordinator();
    coordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      if (coordinatorRef.current === coordinator) {
        coordinatorRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    const target = canvasWrapRef.current;
    const updateSize = (width: number): void => {
      if (!Number.isFinite(width) || width <= 0) {
        return;
      }
      setCanvasWidth(width);
      setViewportBucket(viewportBucketForWidth(width));
    };
    const initialWidth = target?.getBoundingClientRect().width ?? 0;
    if (initialWidth > 0) {
      updateSize(initialWidth);
    }
    const updateDevicePixelRatio = (): void => {
      const next = typeof window === "undefined" ? 1 : window.devicePixelRatio;
      setDevicePixelRatio(Number.isFinite(next) && next > 0 ? next : 1);
    };
    updateDevicePixelRatio();
    if (typeof ResizeObserver !== "undefined" && target !== null) {
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        updateSize(width);
        updateDevicePixelRatio();
      });
      observer.observe(target);
      return () => observer.disconnect();
    }
    const handleResize = (): void => {
      const width = canvasWrapRef.current?.getBoundingClientRect().width ?? 0;
      updateSize(width);
      updateDevicePixelRatio();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    if (frequency === undefined || presentation === undefined || presentation.words.length === 0) {
      coordinator?.cancel();
      setLayoutState({
        status: frequency === undefined ? "idle" : "ready",
        presentationDigest: presentation?.presentationDigest,
      });
      return;
    }
    if (coordinator === undefined) {
      return;
    }
    let active = true;
    setLayoutState({
      status: "loading",
      presentationDigest: presentation.presentationDigest,
    });
    const request = createWordCloudLayoutRequest({
      datasetId: frequency.identity.datasetId,
      generation: frequency.identity.generation,
      frequencyDtoKey: presentation.frequencyDtoKey,
      viewportBucket,
      wordLimit,
      words: presentation.words,
    });
    void coordinator.layout(request).then((outcome) => {
      if (!active) {
        return;
      }
      setLayoutState({
        status: "ready",
        presentationDigest: presentation.presentationDigest,
        outcome,
      });
    }).catch((error: unknown) => {
      if (!active || error instanceof WordCloudLayoutClientCancelledError) {
        return;
      }
      setLayoutState({
        status: "error",
        presentationDigest: presentation.presentationDigest,
      });
    });
    return () => {
      active = false;
      coordinator.cancel();
    };
  }, [frequency, presentation, viewportBucket, wordLimit]);

  const currentOutcome = layoutState.presentationDigest === presentation?.presentationDigest
    ? layoutState.outcome
    : undefined;
  const currentResult = currentOutcome?.result;
  const listItems = presentation === undefined
    ? []
    : wordCloudListItems(presentation);
  const role = frequency?.scope.role ?? "both";
  const roleLabel = ROLE_LABELS[role];
  const yearLabel = frequency?.scope.year === null || frequency === undefined
    ? "全部年份"
    : `${frequency.scope.year} 年`;
  const hasCandidates = presentation !== undefined && presentation.items.length > 0;
  const rendererOmissionCount = rendererReport?.omitted.length ?? 0;
  const displayFallback =
    !canvasAvailable ||
    layoutState.status === "error" ||
    (currentResult !== undefined && currentResult.placed.length === 0);
  const primaryStatus = !hasCandidates
    ? frequency === undefined
      ? "正在准备当前范围的词频与词云。"
      : "当前范围内没有足够的可展示词语。"
    : layoutState.status === "loading"
      ? "正在由本地词云布局 Worker 排列词语。"
      : layoutState.status === "error"
        ? "词云暂时无法绘制，以下保留同一份词频列表。"
        : !canvasAvailable
          ? "当前环境无法绘制 Canvas，以下词频列表仍可使用。"
          : currentResult === undefined
            ? "词云布局尚未就绪，以下保留同一份词频列表。"
            : currentResult.placed.length === 0
              ? "当前词语无法放入词云，以下使用排序列表与条形提示。"
              : currentOutcome !== undefined && currentOutcome.effectiveWordLimit < wordLimit
                ? `词云已展示 ${currentResult.placed.length - rendererOmissionCount} 个词语；版面有限，其余词语保留在下方列表。`
                : currentResult.omitted.length > 0 || rendererOmissionCount > 0
                ? `词云已展示 ${currentResult.placed.length - rendererOmissionCount} 个词语，其余词语保留在下方列表。`
                : `词云已展示 ${currentResult.placed.length} 个词语。`;
  const statusTone = layoutState.status === "error" || !canvasAvailable
    ? "partial"
    : pending || layoutState.status === "loading"
      ? "partial"
      : "privacy";

  const fallbackMaxWeight = Math.max(
    1,
    ...listItems.map((item) => metric === "raw-count" ? item.count : item.ratePer10000),
  );
  const statusMessage = hasCandidates && presentation.items.length < 20
    ? `${primaryStatus} 当前只有 ${presentation.items.length} 个可用词语，词云会完整展示这部分结果。`
    : primaryStatus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const spec = WORD_CLOUD_VIEWPORT_SPECS[viewportBucket];
    const cssWidth = Math.max(1, canvasWidth);
    if (currentResult === undefined) {
      const cssHeight = spec.height * cssWidth / spec.width;
      try {
        clearCanvasFrame(canvas, cssWidth, cssHeight, devicePixelRatio);
        setCanvasAvailable(canvas.getContext("2d") !== null);
      } catch {
        setCanvasAvailable(false);
      }
      setRendererReport(undefined);
      return;
    }
    try {
      const report = renderWordCloudToCanvas(canvas, currentResult, {
        cssWidth,
        devicePixelRatio,
        role,
      });
      setCanvasAvailable(!report.omitted.some((word) => word.reason === "CANVAS_CONTEXT_UNAVAILABLE"));
      setRendererReport(report);
    } catch {
      setCanvasAvailable(false);
      setRendererReport(undefined);
    }
  }, [canvasWidth, currentResult, devicePixelRatio, role, viewportBucket]);

  return (
    <section
      id="word-cloud"
      className="beta-v2-word-cloud"
      data-clean-mode={cleanMode ? "on" : "off"}
      aria-labelledby="beta-word-cloud-heading"
    >
      <div className="beta-word-cloud-heading">
        <div>
          <p className="beta-type-eyebrow">词云 · 15</p>
          <h3 id="beta-word-cloud-heading" className="beta-type-title beta-word-section-heading">这一组词放在一起是什么样？</h3>
          <p className="beta-type-secondary">
            词语大小代表当前{metric === "raw-count" ? "出现次数" : "每万词频率"}；词云和列表都来自当前 {yearLabel}、{roleLabel} 范围。
          </p>
          <p className="beta-type-metadata">{cleanMode ? "已净化常用词" : "显示全部基础合格词"}</p>
        </div>
        <Badge tone={statusTone}>{pending || layoutState.status === "loading" ? "更新中" : "本地词云"}</Badge>
      </div>

      <p className="beta-word-cloud-status" role="status" aria-live="polite">
        {statusMessage}
      </p>

      <div ref={canvasWrapRef} className="beta-word-cloud-canvas-wrap" data-layout-source="worker">
        <canvas
          ref={canvasRef}
          className="beta-word-cloud-canvas"
          aria-hidden="true"
          data-testid="beta-word-cloud-canvas"
          data-layout-state={layoutState.status}
        />
      </div>

      {displayFallback && hasCandidates ? (
        <div className="beta-word-cloud-fallback-bars" aria-label="词频条形提示">
          {listItems.map((item) => {
            const weight = metric === "raw-count" ? item.count : item.ratePer10000;
            const width = `${Math.max(4, Math.round((weight / fallbackMaxWeight) * 100))}%`;
            return (
              <div key={stableKeyForPresentationWord(item.normalizedToken, item.sourceRank)} className="beta-word-cloud-bar-row">
                <span className="beta-word-cloud-bar-label">{item.displayToken}</span>
                <span className="beta-word-cloud-bar-track" aria-hidden="true">
                  <span className="beta-word-cloud-bar-fill" style={{ "--beta-word-cloud-bar-width": width } as CSSProperties} />
                </span>
                <strong>{metric === "raw-count" ? `${item.count.toLocaleString("zh-CN")} 次` : `${formatRate(item.ratePer10000)} / 万`}</strong>
              </div>
            );
          })}
        </div>
      ) : null}

      {hasCandidates ? (
        <details className="beta-word-cloud-list-disclosure" data-testid="beta-word-cloud-list-disclosure">
          <summary>查看词频列表（{listItems.length}）</summary>
          <div className="beta-word-cloud-list-wrap">
            <div className="beta-word-cloud-list-heading">
              <h3>可读词频列表</h3>
              <span className="beta-type-metadata">{listItems.length} 个词语 · {roleLabel} · {yearLabel}</span>
            </div>
            <ol className="beta-word-cloud-list" aria-label={`${yearLabel}${roleLabel}词频列表`}>
              {listItems.map((item) => {
                const key = stableKeyForPresentationWord(item.normalizedToken, item.sourceRank);
                const layoutWord = currentResult === undefined
                  ? undefined
                  : [...currentResult.placed, ...currentResult.omitted].find((word) => word.stableKey === key);
                const layoutPlaced = currentResult?.placed.some((word) => word.stableKey === key) ?? false;
                const layoutOmitted = currentResult !== undefined && !layoutPlaced;
                const rendererOmission = rendererReport?.omitted.find((word) => word.stableKey === key);
                const rendererOmitted = rendererOmission !== undefined;
                const primaryValue = metric === "raw-count"
                  ? `出现 ${item.count.toLocaleString("zh-CN")} 次`
                  : `每万词频率 ${formatRate(item.ratePer10000)}`;
                const secondaryValue = metric === "raw-count"
                  ? `每万词频率 ${formatRate(item.ratePer10000)}`
                  : `出现 ${item.count.toLocaleString("zh-CN")} 次`;
                return (
                  <li
                    key={key}
                    data-layout-omitted={layoutOmitted ? "true" : undefined}
                    data-renderer-omitted={rendererOmitted ? "true" : undefined}
                  >
                    <span className="beta-word-cloud-list-rank">{item.displayRank}</span>
                    <span className="beta-word-cloud-list-token">
                      <strong>{item.displayToken}</strong>
                      <small>{roleLabel} · {yearLabel}</small>
                    </span>
                    <span className="beta-word-cloud-list-values" aria-label={`${primaryValue}；${secondaryValue}`}>
                      <strong>{primaryValue}</strong>
                      <small>{secondaryValue}</small>
                    </span>
                    {layoutOmitted ? (
                      <span className="beta-word-cloud-list-note">
                        {layoutWord === undefined ? "当前降级布局未纳入" : "未放入词云"}
                      </span>
                    ) : rendererOmitted ? (
                      <span className="beta-word-cloud-list-note">
                        {rendererOmission.reason === "CANVAS_CONTEXT_UNAVAILABLE" ? "Canvas 不可用" : "字体适配后未绘制"}
                      </span>
                    ) : null}
                    {onHideWord !== undefined ? (
                      <BetaButton variant="tertiary" onClick={() => onHideWord(item.normalizedToken)}>隐藏此词</BetaButton>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </details>
      ) : (
        <p className="beta-word-cloud-empty" role="status">当前范围内没有足够的可展示词语。</p>
      )}

      {presentation?.boundedPoolExhausted ? (
        <p className="beta-word-cloud-status">展示过滤已耗尽部分有界候选池；当前词云和列表不会请求更多分析数据。</p>
      ) : null}

      <MethodologyDisclosure
        summary="查看词云绘制与统计口径"
        chips={["本机 Canvas", "至少出现 2 次", "最多 100 词", "不展示原文"]}
      >
        <p>词云大小使用当前选择的出现次数或每万词频率；列表同时保留两个数值、排名、角色和年份。Canvas 只接收布局 Worker 返回的几何结果。</p>
        <p>净化常用词与自定义隐藏都只改变 presentation digest 和本地布局；frequencyDtoKey、次数、rate、分母与分析排名保持不变。</p>
        <p>浏览器字体如果比布局安全框更宽，只会向下缩小绘制字号；无法在最小字号内适配的词不会偷偷溢出，列表仍会保留它。</p>
        <p>内置词汇过滤决定统计分母；自定义隐藏只影响本地呈现，不改变次数、频率、排名、分母或 Worker 请求。</p>
      </MethodologyDisclosure>
    </section>
  );
}
