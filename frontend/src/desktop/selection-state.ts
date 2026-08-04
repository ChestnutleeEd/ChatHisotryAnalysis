import type { DesktopState, SelectionCommandAck, SelectionId } from "./ipc-contract";

export interface SelectionViewState {
  readonly selectionId: SelectionId | undefined;
  readonly annualCount: number;
  readonly verificationCount: number;
  readonly desktopState: DesktopState;
  readonly status: string;
}

export function applySelectionCommand(
  current: SelectionViewState,
  response: SelectionCommandAck,
): SelectionViewState {
  if (response.outcome === "cancelled" || response.selection === null) {
    return current;
  }
  return {
    selectionId: response.selection.selectionId,
    annualCount: response.selection.annualSourceCount,
    verificationCount: response.selection.verificationSourceCount,
    desktopState: "ready",
    status: "本地源选择已更新",
  };
}
