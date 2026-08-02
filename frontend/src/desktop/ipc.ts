import {
  parseDesktopCommand,
  type DesktopCommand,
  type DesktopCommandAck,
  type RequestId,
  type ResultId,
  type SelectionId,
  type SessionId,
  type Generation,
  type ReportFormat,
} from "./ipc-contract";

export const DESKTOP_COMMAND_ALLOWLIST = [
  "select-annual-sources",
  "select-verification-sources",
  "start-analysis",
  "cancel-analysis",
  "retry-analysis",
  "discard-session",
  "export-aggregate",
  "request-application-close",
] as const;

type DesktopCommandType = (typeof DESKTOP_COMMAND_ALLOWLIST)[number];

export const TAURI_COMMAND_BY_TYPE = {
  "select-annual-sources": "select_annual_sources",
  "select-verification-sources": "select_verification_sources",
  "start-analysis": "start_analysis",
  "cancel-analysis": "cancel_analysis",
  "retry-analysis": "retry_analysis",
  "discard-session": "discard_session",
  "export-aggregate": "export_aggregate",
  "request-application-close": "request_application_close",
} as const satisfies Record<DesktopCommandType, string>;

export const TAURI_COMMAND_ALLOWLIST = [
  "select_annual_sources",
  "select_verification_sources",
  "start_analysis",
  "cancel_analysis",
  "retry_analysis",
  "discard_session",
  "export_aggregate",
  "request_application_close",
] as const;

type TauriCommandName = (typeof TAURI_COMMAND_ALLOWLIST)[number];

export interface DesktopInvoker {
  invoke<T>(command: TauriCommandName, args: unknown): Promise<T>;
}

export interface DesktopApi {
  selectAnnualSources(requestId: RequestId): Promise<DesktopCommandAck>;
  selectVerificationSources(requestId: RequestId): Promise<DesktopCommandAck>;
  startAnalysis(requestId: RequestId, selectionId: SelectionId): Promise<DesktopCommandAck>;
  cancelAnalysis(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  retryAnalysis(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  discardSession(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  exportAggregate(
    requestId: RequestId,
    sessionId: SessionId,
    generation: Generation,
    reportFormat: ReportFormat,
    resultId: ResultId,
  ): Promise<DesktopCommandAck>;
  requestApplicationClose(
    requestId: RequestId,
    decision: "keep-open" | "cancel-and-close",
  ): Promise<DesktopCommandAck>;
}

function invokeCommand(
  invoker: DesktopInvoker,
  command: DesktopCommand,
): Promise<DesktopCommandAck> {
  const parsed = parseDesktopCommand(command);
  return invoker.invoke<DesktopCommandAck>(TAURI_COMMAND_BY_TYPE[parsed.type], {
    request: parsed,
  });
}

export function createDesktopApi(invoker: DesktopInvoker): DesktopApi {
  return {
    selectAnnualSources(requestId) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "select-annual-sources",
        requestId,
      });
    },
    selectVerificationSources(requestId) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "select-verification-sources",
        requestId,
      });
    },
    startAnalysis(requestId, selectionId) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "start-analysis",
        requestId,
        selectionId,
      });
    },
    cancelAnalysis(requestId, sessionId, generation) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "cancel-analysis",
        requestId,
        sessionId,
        generation,
      });
    },
    retryAnalysis(requestId, sessionId, generation) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "retry-analysis",
        requestId,
        sessionId,
        generation,
      });
    },
    discardSession(requestId, sessionId, generation) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "discard-session",
        requestId,
        sessionId,
        generation,
      });
    },
    exportAggregate(requestId, sessionId, generation, reportFormat, resultId) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "export-aggregate",
        requestId,
        sessionId,
        generation,
        reportFormat,
        resultId,
      });
    },
    requestApplicationClose(requestId, decision) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "request-application-close",
        requestId,
        decision,
      });
    },
  };
}
