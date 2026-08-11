import { describe, expect, it } from "vitest";

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
} from "../src/presentation/beta/share-preview-state";
import {
  buildBetaReportDto,
} from "../src/presentation/beta/report-adapter";
import { presentBetaReportZhCN } from "../src/presentation/beta/locales/zh-CN";
import { createBetaSummaryDtoV1 } from "../src/presentation/beta/summary-adapter";
import { presentBetaSummaryZhCN } from "../src/presentation/beta/summary-presenter";
import { syntheticBetaAnnualReportResult } from "../src/presentation/beta/synthetic-report-fixture";

function shareCard() {
  const report = buildBetaReportDto(syntheticBetaAnnualReportResult(2025), { mode: "annual", year: 2025 });
  return presentBetaSummaryZhCN(createBetaSummaryDtoV1(report));
}

describe("B5.2 share preview state", () => {
  it("starts closed and opens with vocabulary off, no save success, and partial evidence preserved", () => {
    const closed = createClosedSharePreviewState();
    expect(closed).toMatchObject({ phase: "closed", vocabulary: "off", save: "not-available" });

    const viewModel = shareCard();
    const opening = createSharePreviewState(viewModel);
    expect(opening).toMatchObject({ phase: "opening", vocabulary: "off", evidence: "partial", artwork: "loaded", renderer: "rendering", save: "not-available" });
    expect(opening.presentationKey).toBe(shareCardPresentationKey(viewModel));
  });

  it("moves to ready, toggles only the view-model vocabulary state, and falls back when art fails", () => {
    const viewModel = shareCard();
    const opening = createSharePreviewState(viewModel);
    const ready = markSharePreviewReady(opening);
    expect(ready.phase).toBe("ready");
    expect(setSharePreviewVocabulary(ready, "on").vocabulary).toBe("on");
    expect(markSharePreviewArtworkFallback(ready).artwork).toBe("fallback");
    expect(setSharePreviewRendererState(ready, "ready").save).toBe("ready");
    expect(setSharePreviewRendererState(ready, "font-failed").renderer).toBe("font-failed");
  });

  it("fences a changed committed presentation and never models a fake successful save", () => {
    const viewModel = shareCard();
    const current = createSharePreviewState(viewModel);
    const changed = { ...viewModel, headline: "另一个范围的回顾" };
    expect(shareCardPresentationKey(changed)).not.toBe(shareCardPresentationKey(viewModel));
    expect(markSharePreviewStale(current)).toMatchObject({ phase: "stale", save: "not-available" });
    expect(setSharePreviewSaveState(current, "saved").save).toBe("saved");
    const saving = setSharePreviewSaveState(current, "saving");
    expect(markSharePreviewStale(saving)).toMatchObject({ phase: "stale", save: "saving" });
    expect(createSharePreviewState(viewModel).save).toBe("not-available");
  });

  it("keeps the preview contract independent from the report view-model shape", () => {
    const reportViewModel = presentBetaReportZhCN(buildBetaReportDto(syntheticBetaAnnualReportResult(2025), { mode: "annual", year: 2025 }));
    const viewModel = shareCard();
    expect(viewModel).not.toHaveProperty("sections");
    expect(viewModel).not.toHaveProperty("methodology");
    expect(reportViewModel).toHaveProperty("sections");
    expect(Object.keys(viewModel)).not.toContain("report");
  });
});
