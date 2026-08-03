import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";

import {
  createDesktopApi,
  TAURI_COMMAND_ALLOWLIST,
  type DesktopApi,
  type DesktopInvoker,
} from "./ipc";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

const tauriInvoker: DesktopInvoker = {
  invoke<T>(
    command: (typeof TAURI_COMMAND_ALLOWLIST)[number],
    args: unknown,
  ): Promise<T> {
    return invoke<T>(command, args as Record<string, unknown>);
  },
};

export const desktopApi: DesktopApi = createDesktopApi(tauriInvoker);

export async function listenForDesktopEvents(
  handler: (payload: unknown, event: Event<unknown>) => void,
): Promise<() => void> {
  return listen<unknown>("desktop-event", (event) => {
    handler(event.payload, event);
  });
}

export async function listenForDesktopWorkerControl(
  handler: (payload: unknown) => void,
): Promise<() => void> {
  return listen<unknown>("desktop-worker-control", (event) => {
    handler(event.payload);
  });
}
