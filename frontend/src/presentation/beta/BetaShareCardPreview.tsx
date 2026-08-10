import { useEffect, useRef, useState } from "react";

import {
  decodeShareCardPngV1,
  encodeShareCardPngV1,
  inspectShareCardPngV1,
  loadShareCardArtworkV1,
  renderShareCardV1,
  ShareCardRendererErrorV1,
  type ShareCardCanvasRenderUpdateV1,
} from "./share-card-renderer";
import type { ShareCardMetricViewModelV1, ShareCardViewModelV1 } from "./summary-contract";

function metricValue(metric: ShareCardMetricViewModelV1): string {
  if (metric.status === "unavailable") {
    return metric.detail;
  }
  return `${metric.value ?? ""}${metric.unit}`;
}

function accessibleSummary(viewModel: ShareCardViewModelV1): string {
  const metrics = (Object.values(viewModel.metrics) as ShareCardMetricViewModelV1[])
    .map((metric) => `${metric.label}${metricValue(metric)}`)
    .join("；");
  const sender = viewModel.senderComparison.status === "available"
    ? `Owner ${viewModel.senderComparison.owner.count ?? "证据不足"} 条 ${viewModel.senderComparison.owner.share ?? ""}，Other ${viewModel.senderComparison.other.count ?? "证据不足"} 条 ${viewModel.senderComparison.other.share ?? ""}`
    : "Owner / Other 比较证据不足";
  const vocabulary = viewModel.vocabulary.mode === "on"
    ? `，${viewModel.vocabulary.label}${viewModel.vocabulary.items.map((item) => item.token).join("、")}`
    : `，${viewModel.vocabulary.label}`;
  const scopeNote = viewModel.partialLabel === null ? "完整日期范围" : viewModel.partialLabel;
  return `${viewModel.headline}，范围 ${viewModel.rangeLabel}，${scopeNote}；${metrics}；${sender}；${viewModel.senderFilterContext.appliedFilterLabel}${vocabulary}；${viewModel.privacyLine}，${viewModel.timezoneLabel}。`;
}

export function BetaShareCardPreview({
  open,
  viewModel,
  onRenderStateChange,
}: {
  readonly open: boolean;
  readonly viewModel: ShareCardViewModelV1;
  readonly onRenderStateChange: (update: ShareCardCanvasRenderUpdateV1) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderUpdate, setRenderUpdate] = useState<ShareCardCanvasRenderUpdateV1>({
    status: "rendering",
    artworkMode: "raster",
  });
  const [rgbaDigest, setRgbaDigest] = useState<string | null>(null);
  const renderSequence = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const sequence = renderSequence.current + 1;
    renderSequence.current = sequence;
    let active = true;
    let artwork: Awaited<ReturnType<typeof loadShareCardArtworkV1>> | undefined;
    let bytes: Uint8Array | undefined;
    const publish = (update: ShareCardCanvasRenderUpdateV1): void => {
      if (!active || renderSequence.current !== sequence) {
        return;
      }
      setRenderUpdate(update);
      onRenderStateChange(update);
    };
    setRgbaDigest(null);
    publish({ status: "rendering", artworkMode: "raster" });

    void (async () => {
      try {
        artwork = await loadShareCardArtworkV1();
      } catch {
        artwork = undefined;
      }
      if (!active || renderSequence.current !== sequence) {
        return;
      }
      try {
        const render = await renderShareCardV1(canvas, viewModel, { artwork });
        if (!active || renderSequence.current !== sequence) {
          return;
        }
        const encodeStartedAt = typeof performance === "undefined" ? null : performance.now();
        bytes = await encodeShareCardPngV1(canvas);
        const encodeDurationMs = encodeStartedAt === null || typeof performance === "undefined"
          ? undefined
          : Math.max(0, Math.round(performance.now() - encodeStartedAt));
        const png = inspectShareCardPngV1(bytes);
        const decoded = await decodeShareCardPngV1(bytes);
        if (!active || renderSequence.current !== sequence) {
          return;
        }
        const update: ShareCardCanvasRenderUpdateV1 = {
          status: "ready",
          artworkMode: render.artworkMode,
          fontMode: render.diagnostics.fontMode,
          encodeDurationMs,
          png,
          decoded,
        };
        // The update only carries non-sensitive diagnostics; PNG bytes never
        // enter React state or the DOM.
        setRgbaDigest(decoded.rgbaDigest);
        publish(update);
      } catch (error) {
        if (!active || renderSequence.current !== sequence) {
          return;
        }
        const rendererError = error instanceof ShareCardRendererErrorV1 ? error : undefined;
        publish({
          status: "failed",
          artworkMode: artwork === undefined ? "fallback" : "raster",
          error: rendererError,
        });
      } finally {
        bytes?.fill(0);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, viewModel]);

  return (
    <article
      className="beta-share-card"
      data-testid="beta-share-card-preview"
      data-artwork-state={renderUpdate.artworkMode === "raster" ? "loaded" : "fallback"}
      data-render-state={renderUpdate.status}
      data-png-state={renderUpdate.status === "ready" ? "validated" : "pending"}
      data-font-mode={renderUpdate.fontMode}
      data-png-encode-ms={renderUpdate.encodeDurationMs}
      data-png-width={renderUpdate.status === "ready" ? "1200" : undefined}
      data-png-height={renderUpdate.status === "ready" ? "1500" : undefined}
      data-png-size={renderUpdate.png?.byteLength}
      data-png-chunks={renderUpdate.png === undefined ? undefined : [...new Set(renderUpdate.png.chunkTypes)].join(",")}
      data-png-forbidden-chunks={renderUpdate.png?.forbiddenChunks.join(",")}
      data-alpha={renderUpdate.decoded?.opaque === true ? "255" : undefined}
      data-rgba-digest={rgbaDigest ?? undefined}
      data-evidence-state={viewModel.scope.partial ? "partial" : viewModel.exportAvailability.status}
      aria-describedby="beta-share-card-accessible-summary"
    >
      <canvas
        ref={canvasRef}
        className="beta-share-card-canvas"
        width={1200}
        height={1500}
        aria-hidden="true"
      />
      {renderUpdate.status === "failed" ? (
        <p className="beta-share-card-render-failure" role="status">回顾卡预览暂时无法生成，请重试。</p>
      ) : null}
      <p id="beta-share-card-accessible-summary" className="visually-hidden">{accessibleSummary(viewModel)}</p>
    </article>
  );
}
