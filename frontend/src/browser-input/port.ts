export interface BrowserInputAvailability {
  readonly kind: "disabled";
  readonly reason: "STAGE_1B_CONTRACT_ONLY";
}

/**
 * Browser input is intentionally disabled in Stage 1B. The adapter exposes no
 * selection, drag/drop, picker, or raw-chat operation.
 */
export interface BrowserInputPort {
  availability(): BrowserInputAvailability;
}

export class DisabledBrowserInput implements BrowserInputPort {
  availability(): BrowserInputAvailability {
    return {
      kind: "disabled",
      reason: "STAGE_1B_CONTRACT_ONLY",
    };
  }
}
