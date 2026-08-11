import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { BetaButton } from "./primitives";
import type { ShareCardViewModelV1 } from "./summary-contract";
import type { ShareCardCanvasRenderUpdateV1 } from "./share-card-renderer";
import {
  createClosedSharePreviewState,
  createSharePreviewState,
  markSharePreviewArtworkFallback,
  markSharePreviewReady,
  markSharePreviewStale,
  setSharePreviewRendererState,
  setSharePreviewSaveState,
  setSharePreviewVocabulary,
  shareCardPresentationKey,
  type ShareCardPreviewModels,
  type SharePreviewState,
} from "./share-preview-state";
import { BetaShareCardPreview, type BetaShareCardPreviewHandle } from "./BetaShareCardPreview";

type SharePreviewSaveOutcome = "saved" | "cancelled";

function saveFailureMessage(error: unknown): string {
  const code = error !== null && typeof error === "object" && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : "";
  switch (code) {
    case "EXPORT_STALE_RESULT":
      return "当前结果已变化；请关闭后重新生成回顾卡。";
    case "EXPORT_LIMIT_EXCEEDED":
      return "回顾卡文件超过本地保存上限；请重试当前预览。";
    case "EXPORT_DIALOG_UNAVAILABLE":
    case "DIALOG_UNAVAILABLE":
      return "本机保存面板暂时不可用；请稍后重试。";
    case "EXPORT_PERMISSION_DENIED":
      return "没有权限写入你选择的位置；请换一个本地位置。";
    case "EXPORT_DISK_FULL":
      return "本地磁盘空间不足；请清理空间后重试。";
    case "EXPORT_DURABILITY_UNCERTAIN":
      return "文件已完成写入，但系统尚未确认其持久化；请检查后再重试。";
    case "EXPORT_CLEANUP_REQUIRED":
      return "本地保存流程需要清理后才能继续；请重试。";
    default:
      return "回顾卡未能保存；可以重试当前预览。";
  }
}

function focusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  );
}

export function BetaSharePreviewDialog({
  open,
  models,
  currentViewModel,
  triggerRef,
  onClose,
  onSavePng,
}: {
  readonly open: boolean;
  readonly models: ShareCardPreviewModels;
  readonly currentViewModel?: ShareCardViewModelV1;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
  readonly onSavePng?: (viewModel: ShareCardViewModelV1, bytes: Uint8Array) => Promise<SharePreviewSaveOutcome>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewRef = useRef<BetaShareCardPreviewHandle>(null);
  const saveBusyRef = useRef(false);
  const savePresentationKeyRef = useRef<string | null>(null);
  const cancelledResetTimerRef = useRef<number | undefined>(undefined);
  const [includeVocabulary, setIncludeVocabulary] = useState(false);
  const [artworkState, setArtworkState] = useState<SharePreviewState["artwork"]>("loaded");
  const [previewState, setPreviewState] = useState<SharePreviewState>(createClosedSharePreviewState);
  const [saveErrorCode, setSaveErrorCode] = useState<string>();
  const [renderAttempt, setRenderAttempt] = useState(0);
  const selectedViewModel = includeVocabulary ? models.on : models.off;
  const openedPresentationKey = useMemo(() => shareCardPresentationKey(models.off), [models.off]);
  const currentPresentationKey = currentViewModel === undefined
    ? null
    : shareCardPresentationKey(currentViewModel);
  const stale = open && (currentPresentationKey === null || currentPresentationKey !== openedPresentationKey);
  const vocabularyUnavailable = models.on.vocabulary.mode === "unavailable";
  const saveBusy = saveBusyRef.current
    || previewState.save === "preparing"
    || previewState.save === "waiting-native-dialog"
    || previewState.save === "saving";
  const renderBusy = previewState.phase === "opening" || previewState.renderer === "rendering";
  const previewRendererFailed = previewState.renderer === "renderer-failed" || previewState.renderer === "font-failed";
  savePresentationKeyRef.current = shareCardPresentationKey(selectedViewModel);

  function clearCancelledResetTimer(): void {
    if (cancelledResetTimerRef.current !== undefined) {
      window.clearTimeout(cancelledResetTimerRef.current);
      cancelledResetTimerRef.current = undefined;
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (!open) {
      clearCancelledResetTimer();
      if (dialog.open) {
        dialog.close();
      }
      setPreviewState(createClosedSharePreviewState());
      setIncludeVocabulary(false);
      setRenderAttempt(0);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }

    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    setArtworkState("loaded");
    setIncludeVocabulary(false);
    setSaveErrorCode(undefined);
    setRenderAttempt(0);
    setPreviewState(createSharePreviewState(models.off));
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus();
      setPreviewState((state) => markSharePreviewReady(state));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [models.off, open, triggerRef]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setPreviewState((state) => stale ? markSharePreviewStale(state) : state);
  }, [currentPresentationKey, open, stale]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setPreviewState((state) => setSharePreviewVocabulary(state, selectedViewModel.vocabulary.mode));
  }, [open, selectedViewModel.vocabulary.mode]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [open]);

  function setSaveState(save: SharePreviewState["save"]): void {
    setPreviewState((state) => setSharePreviewSaveState(state, save));
  }

  async function handleSavePng(): Promise<void> {
    if (
      saveBusyRef.current ||
      onSavePng === undefined ||
      stale ||
      previewState.phase !== "ready" ||
      previewState.renderer !== "ready"
    ) {
      return;
    }
    const bytes = previewRef.current?.getCurrentPng();
    if (bytes === undefined) {
      setSaveState("failed");
      return;
    }
    const attemptKey = shareCardPresentationKey(selectedViewModel);
    saveBusyRef.current = true;
    setSaveErrorCode(undefined);
    setSaveState("preparing");
    const waitingTimer = window.setTimeout(() => {
      if (saveBusyRef.current) {
        setSaveState("saving");
      }
    }, 350);
    try {
      setSaveState("waiting-native-dialog");
      const outcome = await onSavePng(selectedViewModel, bytes);
      if (savePresentationKeyRef.current !== attemptKey) {
        setSaveState("not-available");
        return;
      }
      setSaveState(outcome === "saved" ? "saved" : "cancelled");
      if (outcome === "cancelled") {
        clearCancelledResetTimer();
        cancelledResetTimerRef.current = window.setTimeout(() => {
          cancelledResetTimerRef.current = undefined;
          setPreviewState((state) => state.save === "cancelled"
            ? setSharePreviewSaveState(state, "ready")
            : state);
        }, 2_400);
      }
    } catch (error) {
      setSaveErrorCode(error !== null && typeof error === "object" && "code" in error
        ? String((error as { readonly code?: unknown }).code)
        : undefined);
      if (savePresentationKeyRef.current === attemptKey) {
        setSaveState("failed");
      } else {
        setSaveState("not-available");
      }
      // Technical failure codes are mapped to product copy below; no raw
      // host error text or PNG bytes enter the UI.
      void error;
    } finally {
      window.clearTimeout(waitingTimer);
      saveBusyRef.current = false;
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDialogElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (saveBusyRef.current) {
        return;
      }
      onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) {
      return;
    }
    const focusable = focusableElements(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      headingRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === headingRef.current) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleArtworkError(): void {
    setArtworkState("fallback");
    setPreviewState((state) => markSharePreviewArtworkFallback(state));
  }

  function handleCanvasRenderState(update: ShareCardCanvasRenderUpdateV1): void {
    if (update.artworkMode === "fallback") {
      handleArtworkError();
    } else {
      setArtworkState("loaded");
    }
    const rendererState = update.status === "ready"
      ? "ready"
      : update.status === "failed"
        ? update.error?.code === "EXPORT_FONT_UNAVAILABLE" ? "font-failed" : "renderer-failed"
        : "rendering";
    setPreviewState((state) => setSharePreviewRendererState(state, rendererState));
  }

  function handleVocabularyChange(nextValue: boolean): void {
    if (saveBusyRef.current || stale || previewState.phase === "opening") {
      return;
    }
    setIncludeVocabulary(nextValue);
    setSaveErrorCode(undefined);
    setPreviewState((state) => setSharePreviewRendererState(
      setSharePreviewVocabulary(state, nextValue ? models.on.vocabulary.mode : models.off.vocabulary.mode),
      "rendering",
    ));
    setRenderAttempt((attempt) => attempt + 1);
  }

  function handleRetryPreview(): void {
    if (saveBusy || stale || !previewRendererFailed) {
      return;
    }
    setSaveErrorCode(undefined);
    setPreviewState((state) => setSharePreviewRendererState(state, "rendering"));
    setRenderAttempt((attempt) => attempt + 1);
  }

  const statusMessage = stale
    ? "当前范围已变化；请关闭后重新生成回顾卡。"
      : previewState.save === "preparing"
        ? "正在准备本地保存；请稍候。"
        : previewState.save === "waiting-native-dialog"
          ? "正在打开本机保存面板；请在面板中选择位置。"
          : previewState.save === "saving"
            ? "正在写入你选择的位置；请稍候。"
            : previewState.save === "saved"
              ? "回顾卡已保存到你选择的位置。"
              : previewState.save === "cancelled"
                ? "本地保存已取消；当前结果未改变。"
                : previewState.save === "failed"
                  ? saveFailureMessage(saveErrorCode)
      : previewState.renderer === "font-failed"
        ? "字体未就绪，暂时无法生成固定版式；请重试。"
        : previewState.renderer === "renderer-failed"
          ? "回顾卡预览暂时无法生成，请重试。"
          : previewState.renderer === "rendering" || previewState.phase === "opening"
      ? "正在准备回顾卡预览…"
      : artworkState === "fallback"
        ? "装饰图不可用，已使用内置线点图案。"
        : selectedViewModel.scope.partial
          ? "当前预览使用部分日期范围，并已在卡片中标明。"
          : "预览仅使用本地统计结果，不包含聊天正文或联系人身份。";
  const liveMessage = stale
    ? "当前范围已变化；请关闭后重新生成回顾卡。"
    : previewState.save === "failed"
      ? saveFailureMessage(saveErrorCode)
      : previewRendererFailed
        ? previewState.renderer === "font-failed"
          ? "字体未就绪，暂时无法生成固定版式；请重试预览。"
          : "回顾卡预览暂时无法生成，请重试预览。"
        : previewState.save === "saved"
          ? "PNG 已保存。"
          : previewState.save === "cancelled"
            ? "已取消保存。"
            : saveBusy
              ? "正在保存 PNG…"
              : renderBusy
                ? "正在准备回顾卡预览…"
                : "";
  const liveIsAlert = stale || previewState.save === "failed" || previewRendererFailed;

  return (
    <dialog
      ref={dialogRef}
      className="beta-share-preview-dialog"
      data-testid="beta-share-preview-dialog"
      data-state={stale ? "stale" : previewState.phase}
      data-vocabulary={selectedViewModel.vocabulary.mode}
      aria-modal="true"
      aria-labelledby="beta-share-preview-heading"
      aria-describedby="beta-share-preview-description beta-share-card-accessible-summary"
      aria-busy={previewState.phase === "opening" || previewState.renderer === "rendering" || saveBusy}
      data-save-state={previewState.save}
      onCancel={(event) => { event.preventDefault(); if (!saveBusyRef.current) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="beta-share-preview-shell">
        <header className="beta-share-preview-header">
          <div>
            <p className="beta-type-eyebrow">总结与分享</p>
            <h2 id="beta-share-preview-heading" ref={headingRef} tabIndex={-1}>年度回顾卡</h2>
            <p id="beta-share-preview-description">回顾卡仅使用本地统计结果生成，不包含聊天正文或联系人身份。</p>
          </div>
          <button className="beta-share-preview-close" type="button" aria-label="关闭年度回顾卡" disabled={saveBusy} onClick={() => { if (!saveBusyRef.current) onClose(); }}>关闭</button>
        </header>

        <div className="beta-share-preview-layout">
          <div className="beta-share-preview-stage">
            <BetaShareCardPreview
              ref={previewRef}
              open={open}
              viewModel={selectedViewModel}
              renderAttempt={renderAttempt}
              onRenderStateChange={handleCanvasRenderState}
            />
          </div>

          <aside className="beta-share-preview-controls" aria-label="回顾卡选项">
            <div className="beta-share-preview-control-intro">
              <p className="beta-type-eyebrow">当前摘要</p>
              <strong>{selectedViewModel.headline}</strong>
              <span>{selectedViewModel.rangeLabel}</span>
            </div>

            <label className="beta-share-preview-toggle">
              <input
                type="checkbox"
                name="includeVocabulary"
                role="switch"
                aria-checked={includeVocabulary}
                checked={includeVocabulary}
                disabled={vocabularyUnavailable || stale || renderBusy || saveBusy}
                onChange={(event) => handleVocabularyChange(event.currentTarget.checked)}
              />
              <span>
                <strong>包含词汇摘要</strong>
                <small>{includeVocabulary ? "最多 5 个当前可见常用词。" : "默认不包含词汇摘要。"}</small>
              </span>
            </label>
            {vocabularyUnavailable ? <p className="beta-share-preview-unavailable">当前没有可用词汇摘要</p> : null}
            {selectedViewModel.senderFilterContext.disclosure !== null ? (
              <p className="beta-share-preview-note">{selectedViewModel.senderFilterContext.disclosure}</p>
            ) : null}
            <p className="beta-share-preview-privacy">PNG 会将当前选择的摘要内容保存到你指定的位置；应用不会上传。</p>
            <div className="beta-share-preview-save">
              <BetaButton
                data-testid="beta-share-preview-save"
                variant="primary"
                loading={saveBusy}
                loadingLabel="保存中…"
                disabled={
                  onSavePng === undefined ||
                  stale ||
                  renderBusy ||
                  previewState.phase !== "ready" ||
                  previewState.renderer !== "ready" ||
                  previewState.save === "not-available"
                }
                aria-label={previewState.save === "failed" ? "重试保存 PNG" : undefined}
                aria-describedby="beta-share-preview-save-note"
                onClick={() => void handleSavePng()}
              >
                {previewState.save === "saved"
                  ? "再次保存 PNG"
                  : previewState.save === "failed"
                    ? "重试保存 PNG"
                    : "保存 PNG"}
              </BetaButton>
              <small id="beta-share-preview-save-note">
                {previewState.save === "saved"
                  ? "已完成本地保存；再次保存会重新打开保存面板。"
                  : previewState.save === "cancelled"
                    ? "未写入文件；可以再次尝试。"
                    : previewState.save === "failed"
                      ? "保存失败；可以重试当前预览。"
                      : "只会打开本机保存面板，不会上传或复制到剪贴板。"}
              </small>
            </div>
            {previewRendererFailed ? (
              <BetaButton
                className="beta-share-preview-retry-render"
                data-testid="beta-share-preview-retry-render"
                variant="secondary"
                disabled={saveBusy}
                onClick={handleRetryPreview}
              >
                重试预览
              </BetaButton>
            ) : null}
            {previewState.save === "saved" ? (
              <div className="beta-share-preview-success-feedback" data-testid="beta-share-preview-success" aria-hidden="true">
                <span className="beta-share-preview-success-mark">
                  <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
                    <path d="m4 10.5 3.5 3.5L16 5.8" />
                  </svg>
                </span>
                <span>已保存</span>
              </div>
            ) : null}
            <p className="beta-share-preview-status">{statusMessage}</p>
            <p
              className="visually-hidden"
              data-testid="beta-share-preview-live-region"
              role={liveIsAlert ? "alert" : undefined}
              aria-live={liveIsAlert ? "assertive" : "polite"}
              aria-atomic="true"
            >
              {liveMessage}
            </p>
          </aside>
        </div>
      </div>
    </dialog>
  );
}
