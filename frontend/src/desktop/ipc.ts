import {
  parseDesktopCommand,
  isRequestId,
  type DesktopCommand,
  type DesktopCommandAck,
  type RequestId,
  type ResultId,
  type SelectionId,
  type SessionId,
  type Generation,
  type ReportFormat,
  type ApprovedChartKey,
} from "./ipc-contract";
import {
  isWorkerOperationCapability,
  WORKER_CAPABILITY_PROTOCOL_VERSION,
  type WorkerOperationCapability,
} from "../worker-analysis/protocol";

export const DESKTOP_COMMAND_ALLOWLIST = [
  "select-annual-sources",
  "select-verification-sources",
  "start-analysis",
  "cancel-analysis",
  "retry-analysis",
  "discard-session",
  "prepare-aggregate-result",
  "cancel-aggregate-result",
  "acknowledge-worker-stop",
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
  "prepare-aggregate-result": "prepare_aggregate_result",
  "cancel-aggregate-result": "cancel_aggregate_result",
  "acknowledge-worker-stop": "acknowledge_worker_stop",
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
  "prepare_aggregate_result",
  "cancel_aggregate_result",
  "acknowledge_worker_stop",
  "export_aggregate",
  "request_application_close",
] as const;

type TauriCommandName = (typeof TAURI_COMMAND_ALLOWLIST)[number];

export interface DesktopInvoker {
  invoke<T>(command: TauriCommandName, args: unknown): Promise<T>;
}

export interface WorkerPreparationAck {
  readonly protocolVersion: typeof WORKER_CAPABILITY_PROTOCOL_VERSION;
  readonly requestId: RequestId;
  readonly accepted: true;
  readonly capability: WorkerOperationCapability;
}

export function isWorkerPreparationAck(value: unknown): value is WorkerPreparationAck {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const object = value as Record<string, unknown>;
  return (
    Object.keys(object).sort().join(",") ===
      "accepted,capability,protocolVersion,requestId" &&
    object.protocolVersion === WORKER_CAPABILITY_PROTOCOL_VERSION &&
    object.accepted === true &&
    isRequestId(object.requestId) &&
    isWorkerOperationCapability(object.capability)
  );
}

export interface DesktopApi {
  selectAnnualSources(requestId: RequestId): Promise<DesktopCommandAck>;
  selectVerificationSources(requestId: RequestId): Promise<DesktopCommandAck>;
  startAnalysis(requestId: RequestId, selectionId: SelectionId): Promise<DesktopCommandAck>;
  cancelAnalysis(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  retryAnalysis(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  discardSession(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  prepareAggregateResult(
    requestId: RequestId,
    sessionId: SessionId,
    generation: Generation,
    queryKey: string,
  ): Promise<WorkerPreparationAck>;
  cancelAggregateResult(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  acknowledgeWorkerStop(requestId: RequestId, sessionId: SessionId, generation: Generation): Promise<DesktopCommandAck>;
  exportAggregate(
    requestId: RequestId,
    sessionId: SessionId,
    generation: Generation,
    reportFormat: ReportFormat,
    resultId: ResultId,
    chartKey?: ApprovedChartKey,
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
  if (parsed.type === "commit-aggregate-result") {
    return Promise.reject(new Error("CONTRACT_ONLY"));
  }
  return invoker.invoke<DesktopCommandAck>(TAURI_COMMAND_BY_TYPE[parsed.type as DesktopCommandType], {
    request: parsed,
  });
}

function invokePreparationCommand(
  invoker: DesktopInvoker,
  command: DesktopCommand,
): Promise<WorkerPreparationAck> {
  const parsed = parseDesktopCommand(command);
  if (parsed.type !== "prepare-aggregate-result") {
    return Promise.reject(new Error("INVALID_PREPARATION_COMMAND"));
  }
  return invoker.invoke<WorkerPreparationAck>(
    TAURI_COMMAND_BY_TYPE[parsed.type],
    { request: parsed },
  );
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
    prepareAggregateResult(requestId, sessionId, generation, queryKey) {
      return invokePreparationCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "prepare-aggregate-result",
        requestId,
        sessionId,
        generation,
        queryKey,
      });
    },
    cancelAggregateResult(requestId, sessionId, generation) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "cancel-aggregate-result",
        requestId,
        sessionId,
        generation,
      });
    },
    acknowledgeWorkerStop(requestId, sessionId, generation) {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "acknowledge-worker-stop",
        requestId,
        sessionId,
        generation,
      });
    },
    exportAggregate(requestId, sessionId, generation, reportFormat, resultId, chartKey = "trends") {
      return invokeCommand(invoker, {
        protocolVersion: "chat-history-analysis.desktop-ipc.v1",
        type: "export-aggregate",
        requestId,
        sessionId,
        generation,
        reportFormat,
        resultId,
        chartKey,
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
