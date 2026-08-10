import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { BetaButton } from "./primitives";
import type { ShareCardViewModelV1 } from "./summary-contract";
import {
  createClosedSharePreviewState,
  createSharePreviewState,
  markSharePreviewArtworkFallback,
  markSharePreviewReady,
  markSharePreviewStale,
  setSharePreviewVocabulary,
  shareCardPresentationKey,
  type ShareCardPreviewModels,
  type SharePreviewState,
} from "./share-preview-state";
import { BetaShareCardPreview } from "./BetaShareCardPreview";

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
}: {
  readonly open: boolean;
  readonly models: ShareCardPreviewModels;
  readonly currentViewModel?: ShareCardViewModelV1;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [includeVocabulary, setIncludeVocabulary] = useState(false);
  const [artworkState, setArtworkState] = useState<SharePreviewState["artwork"]>("loaded");
  const [previewState, setPreviewState] = useState<SharePreviewState>(createClosedSharePreviewState);
  const selectedViewModel = includeVocabulary ? models.on : models.off;
  const openedPresentationKey = useMemo(() => shareCardPresentationKey(models.off), [models.off]);
  const currentPresentationKey = currentViewModel === undefined
    ? null
    : shareCardPresentationKey(currentViewModel);
  const stale = open && (currentPresentationKey === null || currentPresentationKey !== openedPresentationKey);
  const vocabularyUnavailable = models.on.vocabulary.mode === "unavailable";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (!open) {
      if (dialog.open) {
        dialog.close();
      }
      setPreviewState(createClosedSharePreviewState());
      setIncludeVocabulary(false);
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLDialogElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
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

  const statusMessage = stale
    ? "当前范围已变化；请关闭后重新生成回顾卡。"
      : previewState.phase === "opening"
      ? "正在准备回顾卡预览…"
      : artworkState === "fallback"
        ? "装饰图不可用，已使用内置线点图案。"
        : selectedViewModel.scope.partial
          ? "当前预览使用部分日期范围，并已在卡片中标明。"
          : "预览仅使用本地统计结果，不包含聊天正文或联系人身份。";

  return (
    <dialog
      ref={dialogRef}
      className="beta-share-preview-dialog"
      data-testid="beta-share-preview-dialog"
      data-state={stale ? "stale" : previewState.phase}
      data-vocabulary={selectedViewModel.vocabulary.mode}
      aria-modal="true"
      aria-labelledby="beta-share-preview-heading"
      aria-describedby="beta-share-preview-description"
      aria-busy={previewState.phase === "opening"}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="beta-share-preview-shell">
        <header className="beta-share-preview-header">
          <div>
            <p className="beta-type-eyebrow">总结与分享</p>
            <h2 id="beta-share-preview-heading" ref={headingRef} tabIndex={-1}>年度回顾卡</h2>
            <p id="beta-share-preview-description">回顾卡仅使用本地统计结果生成，不包含聊天正文或联系人身份。</p>
          </div>
          <button className="beta-share-preview-close" type="button" aria-label="关闭年度回顾卡" onClick={onClose}>关闭</button>
        </header>

        <div className="beta-share-preview-layout">
          <div className="beta-share-preview-stage">
            <BetaShareCardPreview
              viewModel={selectedViewModel}
              artworkState={artworkState}
              onArtworkError={handleArtworkError}
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
                disabled={vocabularyUnavailable || stale || previewState.phase === "opening"}
                onChange={(event) => setIncludeVocabulary(event.currentTarget.checked)}
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
              <BetaButton data-testid="beta-share-preview-save" variant="primary" disabled aria-describedby="beta-share-preview-save-note">保存 PNG</BetaButton>
              <small id="beta-share-preview-save-note">下一批接入本地保存。</small>
            </div>
            <p className="beta-share-preview-status" role={stale ? "alert" : "status"} aria-live={stale ? "assertive" : "polite"}>{statusMessage}</p>
          </aside>
        </div>
      </div>
    </dialog>
  );
}
