import type { ShareCardViewModelV1 } from "./summary-contract";

export interface ShareCardPreviewModels {
  readonly off: ShareCardViewModelV1;
  readonly on: ShareCardViewModelV1;
}

export type SharePreviewVocabularyState = "off" | "on" | "unavailable";
export type SharePreviewArtworkState = "loaded" | "fallback";
export type SharePreviewEvidenceState = "ready" | "partial" | "missing";
export type SharePreviewSaveState = "not-available" | "preparing" | "saved" | "cancelled" | "failed";
export type SharePreviewRendererState = "not-available" | "rendering" | "ready" | "renderer-failed" | "font-failed";

export interface SharePreviewState {
  readonly phase: "closed" | "opening" | "ready" | "stale";
  readonly vocabulary: SharePreviewVocabularyState;
  readonly artwork: SharePreviewArtworkState;
  /** Future Canvas/native renderer states are modeled but not started in B5.2. */
  readonly renderer: SharePreviewRendererState;
  readonly evidence: SharePreviewEvidenceState;
  readonly save: SharePreviewSaveState;
  readonly presentationKey: string | null;
}

/**
 * The preview is allowed to compare only privacy-stripped presentation data.
 * Vocabulary is intentionally excluded so toggling it does not look like a
 * scope change; every other visible field remains part of the stale fence.
 */
export function shareCardPresentationKey(viewModel: ShareCardViewModelV1): string {
  return JSON.stringify({
    ...viewModel,
    vocabulary: { mode: "off", items: [] as const },
  });
}

function evidenceState(viewModel: ShareCardViewModelV1): SharePreviewEvidenceState {
  if (viewModel.exportAvailability.status === "unavailable") {
    return "missing";
  }
  return viewModel.scope.partial ? "partial" : "ready";
}

export function createClosedSharePreviewState(): SharePreviewState {
  return {
    phase: "closed",
    vocabulary: "off",
    artwork: "loaded",
    renderer: "not-available",
    evidence: "ready",
    save: "not-available",
    presentationKey: null,
  };
}

export function createSharePreviewState(viewModel: ShareCardViewModelV1): SharePreviewState {
  return {
    phase: "opening",
    vocabulary: viewModel.vocabulary.mode,
    artwork: "loaded",
    renderer: "not-available",
    evidence: evidenceState(viewModel),
    save: "not-available",
    presentationKey: shareCardPresentationKey(viewModel),
  };
}

export function markSharePreviewReady(state: SharePreviewState): SharePreviewState {
  return state.phase === "opening" ? { ...state, phase: "ready" } : state;
}

export function setSharePreviewVocabulary(
  state: SharePreviewState,
  vocabulary: SharePreviewVocabularyState,
): SharePreviewState {
  return { ...state, vocabulary };
}

export function markSharePreviewArtworkFallback(state: SharePreviewState): SharePreviewState {
  return { ...state, artwork: "fallback" };
}

export function setSharePreviewRendererState(
  state: SharePreviewState,
  renderer: SharePreviewRendererState,
): SharePreviewState {
  return { ...state, renderer };
}

export function markSharePreviewStale(state: SharePreviewState): SharePreviewState {
  return state.phase === "closed" ? state : { ...state, phase: "stale", save: "not-available" };
}

export function setSharePreviewSaveState(
  state: SharePreviewState,
  save: SharePreviewSaveState,
): SharePreviewState {
  return { ...state, save };
}
