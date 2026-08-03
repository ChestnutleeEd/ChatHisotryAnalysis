import { isRendererAggregateInput, type RendererAggregateInput } from "./export-contract";
import { isCanonicalWorkerQueryKey } from "../worker-analysis/query-binding";

export const DESKTOP_IPC_PROTOCOL_VERSION =
  "chat-history-analysis.desktop-ipc.v1" as const;

export type RequestId = string & { readonly __requestId: unique symbol };
export type SelectionId = string & { readonly __selectionId: unique symbol };
export type SessionId = string & { readonly __sessionId: unique symbol };
export type ResultId = string & { readonly __resultId: unique symbol };
export type DatasetId = string & { readonly __datasetId: unique symbol };
export type Generation = number & { readonly __generation: unique symbol };

const REQUEST_ID_PATTERN = /^req_[0-9a-f]{32}$/u;
const SELECTION_ID_PATTERN = /^sel_[0-9a-f]{32}$/u;
const SESSION_ID_PATTERN = /^ses_[0-9a-f]{32}$/u;
const RESULT_ID_PATTERN = /^res_[0-9a-f]{32}$/u;
const DATASET_ID_PATTERN = /^dat_[0-9a-f]{32}$/u;

export type DesktopState =
  | "idle"
  | "selecting"
  | "ready"
  | "preprocessing"
  | "handoff"
  | "analyzing"
  | "complete"
  | "cancelling"
  | "failed"
  | "discarding"
  | "closing";

export type DesktopPhase =
  | "selection"
  | "validation"
  | "preprocessing"
  | "handoff"
  | "transport"
  | "hash"
  | "parse"
  | "index"
  | "tokenization"
  | "aggregation"
  | "cleanup";

export type DesktopFailureCode =
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "INVALID_REQUEST"
  | "COMMAND_NOT_ALLOWED"
  | "INVALID_SESSION"
  | "INVALID_GENERATION"
  | "INVALID_STATE"
  | "STALE_GENERATION"
  | "STALE_EVENT"
  | "WINDOW_NOT_AUTHORIZED"
  | "CONTRACT_ONLY"
  | "SESSION_BUSY"
  | "SESSION_STALE"
  | "SIDECAR_UNAVAILABLE"
  | "SIDECAR_VERIFICATION_FAILED"
  | "SIDECAR_START_FAILED"
  | "SIDECAR_HANDSHAKE_TIMEOUT"
  | "SIDECAR_PROTOCOL_MISMATCH"
  | "SIDECAR_EXITED"
  | "SESSION_CANCELLED"
  | "SESSION_CLEANUP_FAILED"
  | "PROCESS_IDENTITY_MISMATCH"
  | "SIDECAR_PROTOCOL_INVALID"
  | "SIDECAR_CRASHED"
  | "DATASET_TRANSPORT_INVALID"
  | "MEMORY_PRESSURE"
  | "WORKER_RUNTIME_FAILED"
  | "CLEANUP_REQUIRED"
  | "NO_SOURCE_SELECTED"
  | "SOURCE_COUNT_EXCEEDED"
  | "UNSUPPORTED_FILE_TYPE"
  | "SOURCE_UNREADABLE"
  | "DUPLICATE_SOURCE"
  | "SOURCE_SET_INVALID"
  | "SELECTION_STALE"
  | "DISK_SPACE_INSUFFICIENT"
  | "DATASET_HANDOFF_INVALID"
  | "DATASET_TAMPERED"
  | "DIALOG_UNAVAILABLE"
  | "EXPORT_BUSY"
  | "EXPORT_RESULT_PENDING"
  | "EXPORT_STALE_RESULT"
  | "EXPORT_SCHEMA_INVALID"
  | "EXPORT_LIMIT_EXCEEDED"
  | "EXPORT_RENDER_FAILED"
  | "EXPORT_PERMISSION_DENIED"
  | "EXPORT_DISK_FULL"
  | "EXPORT_WRITE_FAILED"
  | "EXPORT_FLUSH_FAILED"
  | "EXPORT_DURABILITY_UNCERTAIN"
  | "EXPORT_RENAME_FAILED"
  | "EXPORT_CLEANUP_REQUIRED"
  | "EXPORT_RESULT_NOT_FOUND";

export type ReportFormat = "png" | "csv" | "json";
export type ApprovedChartKey =
  | "trends"
  | "sender-comparison"
  | "hour"
  | "weekday"
  | "message-types"
  | "reply-bins"
  | "initiator-counts";

export type DesktopCommand =
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "select-annual-sources";
      readonly requestId: RequestId;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "select-verification-sources";
      readonly requestId: RequestId;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "start-analysis";
      readonly requestId: RequestId;
      readonly selectionId: SelectionId;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "cancel-analysis";
      readonly requestId: RequestId;
      readonly sessionId: SessionId;
      readonly generation: Generation;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "retry-analysis";
      readonly requestId: RequestId;
      readonly sessionId: SessionId;
      readonly generation: Generation;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "discard-session";
      readonly requestId: RequestId;
      readonly sessionId: SessionId;
      readonly generation: Generation;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "prepare-aggregate-result";
      readonly requestId: RequestId;
      readonly sessionId: SessionId;
      readonly generation: Generation;
      readonly queryKey: string;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type:
        | "cancel-aggregate-result"
        | "acknowledge-worker-stop";
      readonly requestId: RequestId;
      readonly sessionId: SessionId;
      readonly generation: Generation;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "commit-aggregate-result";
      readonly requestId: RequestId;
      readonly sessionId: SessionId;
      readonly generation: Generation;
      readonly aggregate: RendererAggregateInput;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "export-aggregate";
      readonly requestId: RequestId;
      readonly sessionId: SessionId;
      readonly generation: Generation;
      readonly reportFormat: ReportFormat;
      readonly resultId: ResultId;
      readonly chartKey?: ApprovedChartKey;
    }
  | {
      readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
      readonly type: "request-application-close";
      readonly requestId: RequestId;
      readonly decision: "keep-open" | "cancel-and-close";
    };

type DesktopEventEnvelope<Type extends string, Payload> = {
  readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
  readonly sessionId: SessionId | null;
  readonly generation: Generation;
  readonly sequence: number;
  readonly type: Type;
  readonly payload: Payload;
};

export type DesktopEvent =
  | DesktopEventEnvelope<
      "selection-ready",
      {
        readonly selectionId: SelectionId;
        readonly annualSourceCount: number;
        readonly verificationSourceCount: number;
      }
    >
  | DesktopEventEnvelope<"state", { readonly state: DesktopState }>
  | DesktopEventEnvelope<
      "progress",
      {
        readonly phase: DesktopPhase;
        readonly completed: number;
        readonly total: number;
        readonly percentage: number;
      }
    >
  | DesktopEventEnvelope<
      "dataset-ready",
      {
        readonly datasetId: DatasetId;
        readonly recordCount: number;
        readonly chunkCount: number;
        readonly minimumCalendarDate: string;
        readonly maximumCalendarDate: string;
        readonly pseudonymous: true;
      }
    >
  | DesktopEventEnvelope<
      "failure",
      { readonly code: DesktopFailureCode; readonly retryable: boolean }
    >
  | DesktopEventEnvelope<
      "cancelled",
      { readonly reason: "user" | "replacement" | "application-close" }
    >
  | DesktopEventEnvelope<
      "cleanup",
      { readonly status: "complete" | "required"; readonly removedEntryCount: number }
    >
  | DesktopEventEnvelope<
      "exported",
      { readonly resultId: ResultId; readonly reportFormat: ReportFormat }
    >
  | DesktopEventEnvelope<
      "closed",
      { readonly status: "complete" | "cleanup-required" }
    >;

export interface DesktopCommandAck {
  readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
  readonly requestId: RequestId;
  readonly accepted: true;
}

export interface ResultCommitAck extends DesktopCommandAck {
  readonly resultId: ResultId;
}

export interface DesktopIpcErrorPayload {
  readonly protocolVersion: typeof DESKTOP_IPC_PROTOCOL_VERSION;
  readonly requestId: RequestId | null;
  readonly code: DesktopFailureCode;
}

export class DesktopIpcValidationError extends Error {
  readonly code: DesktopFailureCode;

  constructor(code: DesktopFailureCode) {
    super(code);
    this.name = "DesktopIpcValidationError";
    this.code = code;
  }
}

export function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function isSelectionId(value: unknown): value is SelectionId {
  return typeof value === "string" && SELECTION_ID_PATTERN.test(value);
}

export function isSessionId(value: unknown): value is SessionId {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function isResultId(value: unknown): value is ResultId {
  return typeof value === "string" && RESULT_ID_PATTERN.test(value);
}

export function isDatasetId(value: unknown): value is DatasetId {
  return typeof value === "string" && DATASET_ID_PATTERN.test(value);
}

export function isGeneration(value: unknown): value is Generation {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function requireProtocol(value: Record<string, unknown>): void {
  if (value.protocolVersion !== DESKTOP_IPC_PROTOCOL_VERSION) {
    throw new DesktopIpcValidationError("UNSUPPORTED_PROTOCOL_VERSION");
  }
}

function requireOpaqueId(
  value: unknown,
  predicate: (candidate: unknown) => boolean,
): void {
  if (!predicate(value)) {
    throw new DesktopIpcValidationError("INVALID_REQUEST");
  }
}

function requireGeneration(value: unknown, allowZero = false): void {
  if (!isGeneration(value) || (!allowZero && value === 0)) {
    throw new DesktopIpcValidationError("INVALID_GENERATION");
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function parseDesktopCommand(value: unknown): DesktopCommand {
  if (!isRecord(value)) {
    throw new DesktopIpcValidationError("INVALID_REQUEST");
  }
  requireProtocol(value);
  if (!isRequestId(value.requestId)) {
    throw new DesktopIpcValidationError("INVALID_REQUEST");
  }
  switch (value.type) {
    case "select-annual-sources":
    case "select-verification-sources":
      if (!hasExactKeys(value, ["protocolVersion", "requestId", "type"])) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      return value as DesktopCommand;
    case "start-analysis":
      if (
        !hasExactKeys(value, [
          "protocolVersion",
          "requestId",
          "selectionId",
          "type",
        ])
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      requireOpaqueId(value.selectionId, isSelectionId);
      return value as DesktopCommand;
    case "cancel-analysis":
    case "retry-analysis":
    case "discard-session":
    case "cancel-aggregate-result":
    case "acknowledge-worker-stop":
      if (
        !hasExactKeys(value, [
          "generation",
          "protocolVersion",
          "requestId",
          "sessionId",
          "type",
        ])
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      requireOpaqueId(value.sessionId, isSessionId);
      requireGeneration(value.generation);
      return value as DesktopCommand;
    case "prepare-aggregate-result":
      if (
        !hasExactKeys(value, [
          "generation",
          "protocolVersion",
          "queryKey",
          "requestId",
          "sessionId",
          "type",
        ]) ||
        !isCanonicalWorkerQueryKey(value.queryKey)
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      requireOpaqueId(value.sessionId, isSessionId);
      requireGeneration(value.generation);
      return value as DesktopCommand;
    case "commit-aggregate-result":
      if (
        !hasExactKeys(value, [
          "generation",
          "protocolVersion",
          "requestId",
          "sessionId",
          "aggregate",
          "type",
        ]) || !isRendererAggregateInput(value.aggregate)
      ) {
        throw new DesktopIpcValidationError("EXPORT_SCHEMA_INVALID");
      }
      requireOpaqueId(value.sessionId, isSessionId);
      requireGeneration(value.generation);
      return value as DesktopCommand;
    case "export-aggregate":
      if (
        !(
          hasExactKeys(value, [
            "generation",
            "protocolVersion",
            "reportFormat",
            "requestId",
            "resultId",
            "sessionId",
            "type",
          ]) ||
          hasExactKeys(value, [
            "chartKey",
            "generation",
            "protocolVersion",
            "reportFormat",
            "requestId",
            "resultId",
            "sessionId",
            "type",
          ])
        ) ||
        ("chartKey" in value && !isApprovedChartKey(value.chartKey))
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      requireOpaqueId(value.sessionId, isSessionId);
      requireOpaqueId(value.resultId, isResultId);
      requireGeneration(value.generation);
      if (!isReportFormat(value.reportFormat)) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      return value as DesktopCommand;
    case "request-application-close":
      if (
        !hasExactKeys(value, [
          "decision",
          "protocolVersion",
          "requestId",
          "type",
        ]) ||
        (value.decision !== "keep-open" && value.decision !== "cancel-and-close")
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      return value as DesktopCommand;
    default:
      throw new DesktopIpcValidationError("COMMAND_NOT_ALLOWED");
  }
}

export function isReportFormat(value: unknown): value is ReportFormat {
  return value === "png" || value === "csv" || value === "json";
}

export function isApprovedChartKey(value: unknown): value is ApprovedChartKey {
  return (
    value === "trends" ||
    value === "sender-comparison" ||
    value === "hour" ||
    value === "weekday" ||
    value === "message-types" ||
    value === "reply-bins" ||
    value === "initiator-counts"
  );
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function parseDesktopEvent(value: unknown): DesktopEvent {
  if (!isRecord(value)) {
    throw new DesktopIpcValidationError("INVALID_REQUEST");
  }
  requireProtocol(value);
  if (
    !hasExactKeys(value, [
      "generation",
      "payload",
      "protocolVersion",
      "sequence",
      "sessionId",
      "type",
    ]) ||
    !isGeneration(value.generation) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    (value.sessionId !== null && !isSessionId(value.sessionId)) ||
    !isRecord(value.payload)
  ) {
    throw new DesktopIpcValidationError("INVALID_REQUEST");
  }
  const payload = value.payload;
  switch (value.type) {
    case "selection-ready":
      if (
        value.sessionId !== null ||
        value.generation !== 0 ||
        !hasExactKeys(payload, [
          "annualSourceCount",
          "selectionId",
          "verificationSourceCount",
        ]) ||
        !isSelectionId(payload.selectionId) ||
        !isNonNegativeSafeInteger(payload.annualSourceCount) ||
        !isNonNegativeSafeInteger(payload.verificationSourceCount)
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "state":
      requireSessionEventCorrelation(value);
      if (!hasExactKeys(payload, ["state"]) || !isDesktopState(payload.state)) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "progress":
      requireSessionEventCorrelation(value);
      if (
        !hasExactKeys(payload, [
          "completed",
          "percentage",
          "phase",
          "total",
        ]) ||
        !isDesktopPhase(payload.phase) ||
        !isNonNegativeSafeInteger(payload.completed) ||
        !isPositiveSafeInteger(payload.total) ||
        typeof payload.percentage !== "number" ||
        !Number.isFinite(payload.percentage) ||
        payload.percentage < 0 ||
        payload.percentage > 100 ||
        payload.completed > payload.total
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "dataset-ready":
      requireSessionEventCorrelation(value);
      if (
        !hasExactKeys(payload, [
          "chunkCount",
          "datasetId",
          "maximumCalendarDate",
          "minimumCalendarDate",
          "pseudonymous",
          "recordCount",
        ]) ||
        !isDatasetId(payload.datasetId) ||
        !isPositiveSafeInteger(payload.recordCount) ||
        !isPositiveSafeInteger(payload.chunkCount) ||
        !isCalendarDate(payload.minimumCalendarDate) ||
        !isCalendarDate(payload.maximumCalendarDate) ||
        payload.minimumCalendarDate > payload.maximumCalendarDate ||
        payload.pseudonymous !== true
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "failure":
      requireSessionEventCorrelation(value);
      if (
        !hasExactKeys(payload, ["code", "retryable"]) ||
        !isDesktopFailureCode(payload.code) ||
        typeof payload.retryable !== "boolean"
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "cancelled":
      requireSessionEventCorrelation(value);
      if (
        !hasExactKeys(payload, ["reason"]) ||
        (payload.reason !== "user" &&
          payload.reason !== "replacement" &&
          payload.reason !== "application-close")
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "cleanup":
      requireSessionEventCorrelation(value);
      if (
        !hasExactKeys(payload, ["removedEntryCount", "status"]) ||
        !isNonNegativeSafeInteger(payload.removedEntryCount) ||
        (payload.status !== "complete" && payload.status !== "required")
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "exported":
      requireSessionEventCorrelation(value);
      if (
        !hasExactKeys(payload, ["reportFormat", "resultId"]) ||
        !isResultId(payload.resultId) ||
        !isReportFormat(payload.reportFormat)
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    case "closed":
      requireSessionEventCorrelation(value);
      if (
        !hasExactKeys(payload, ["status"]) ||
        (payload.status !== "complete" && payload.status !== "cleanup-required")
      ) {
        throw new DesktopIpcValidationError("INVALID_REQUEST");
      }
      break;
    default:
      throw new DesktopIpcValidationError("INVALID_REQUEST");
  }
  return value as DesktopEvent;
}

function requireSessionEventCorrelation(value: Record<string, unknown>): void {
  if (value.sessionId === null || value.generation === 0) {
    throw new DesktopIpcValidationError("INVALID_REQUEST");
  }
}

function isDesktopState(value: unknown): value is DesktopState {
  return (
    value === "idle" ||
    value === "selecting" ||
    value === "ready" ||
    value === "preprocessing" ||
    value === "handoff" ||
    value === "analyzing" ||
    value === "complete" ||
    value === "cancelling" ||
    value === "failed" ||
    value === "discarding" ||
    value === "closing"
  );
}

function isDesktopPhase(value: unknown): value is DesktopPhase {
  return (
    value === "selection" ||
    value === "validation" ||
    value === "preprocessing" ||
    value === "handoff" ||
    value === "transport" ||
    value === "hash" ||
    value === "parse" ||
    value === "index" ||
    value === "tokenization" ||
    value === "aggregation" ||
    value === "cleanup"
  );
}

function isDesktopFailureCode(value: unknown): value is DesktopFailureCode {
  return (
    typeof value === "string" &&
    [
      "UNSUPPORTED_PROTOCOL_VERSION",
      "INVALID_REQUEST",
      "COMMAND_NOT_ALLOWED",
      "INVALID_SESSION",
      "INVALID_GENERATION",
      "INVALID_STATE",
      "STALE_GENERATION",
      "STALE_EVENT",
      "WINDOW_NOT_AUTHORIZED",
      "CONTRACT_ONLY",
      "SESSION_BUSY",
      "SESSION_STALE",
      "SIDECAR_UNAVAILABLE",
      "SIDECAR_VERIFICATION_FAILED",
      "SIDECAR_START_FAILED",
      "SIDECAR_HANDSHAKE_TIMEOUT",
      "SIDECAR_PROTOCOL_MISMATCH",
      "SIDECAR_EXITED",
      "SESSION_CANCELLED",
      "SESSION_CLEANUP_FAILED",
      "PROCESS_IDENTITY_MISMATCH",
      "SIDECAR_PROTOCOL_INVALID",
      "SIDECAR_CRASHED",
      "DATASET_TRANSPORT_INVALID",
      "MEMORY_PRESSURE",
      "WORKER_RUNTIME_FAILED",
      "CLEANUP_REQUIRED",
      "NO_SOURCE_SELECTED",
      "SOURCE_COUNT_EXCEEDED",
      "UNSUPPORTED_FILE_TYPE",
      "SOURCE_UNREADABLE",
      "DUPLICATE_SOURCE",
      "SOURCE_SET_INVALID",
      "SELECTION_STALE",
      "DISK_SPACE_INSUFFICIENT",
      "DATASET_HANDOFF_INVALID",
      "DATASET_TAMPERED",
      "DIALOG_UNAVAILABLE",
      "EXPORT_BUSY",
      "EXPORT_RESULT_PENDING",
      "EXPORT_STALE_RESULT",
      "EXPORT_SCHEMA_INVALID",
      "EXPORT_LIMIT_EXCEEDED",
      "EXPORT_RENDER_FAILED",
      "EXPORT_PERMISSION_DENIED",
      "EXPORT_DISK_FULL",
      "EXPORT_WRITE_FAILED",
      "EXPORT_FLUSH_FAILED",
      "EXPORT_DURABILITY_UNCERTAIN",
      "EXPORT_RENAME_FAILED",
      "EXPORT_CLEANUP_REQUIRED",
      "EXPORT_RESULT_NOT_FOUND",
    ].includes(value)
  );
}

const STATE_TRANSITIONS: Readonly<Record<DesktopState, readonly DesktopState[]>> = {
  idle: ["selecting"],
  selecting: ["idle", "ready"],
  ready: ["preprocessing", "selecting", "discarding"],
  preprocessing: ["handoff", "cancelling", "failed", "closing"],
  handoff: ["analyzing", "cancelling", "failed", "closing"],
  analyzing: ["complete", "cancelling", "failed", "closing"],
  complete: ["selecting", "discarding", "closing"],
  cancelling: ["ready", "failed", "discarding", "closing"],
  failed: ["ready", "preprocessing", "discarding", "closing"],
  discarding: ["idle", "selecting", "closing"],
  closing: [],
};

export function isValidDesktopTransition(
  from: DesktopState,
  to: DesktopState,
): boolean {
  return from === to || STATE_TRANSITIONS[from].includes(to);
}

export interface EventCursor {
  readonly windowId: string;
  readonly sessionId: SessionId | null;
  readonly generation: Generation;
  readonly sequence: number;
  readonly state: DesktopState;
  readonly terminal: boolean;
  readonly terminalOutcome?: "complete" | "failure" | "cancelled";
  readonly cleanupStatus?: "complete" | "required";
  readonly closed?: boolean;
}

export function acceptDesktopEvent(
  cursor: EventCursor,
  eventValue: unknown,
  originWindowId: string,
):
  | { readonly accepted: true; readonly cursor: EventCursor; readonly event: DesktopEvent }
  | {
      readonly accepted: false;
      readonly code:
        | "STALE_EVENT"
        | "STALE_GENERATION"
        | "WINDOW_NOT_AUTHORIZED"
        | "INVALID_STATE";
    } {
  if (originWindowId !== cursor.windowId) {
    return { accepted: false, code: "WINDOW_NOT_AUTHORIZED" };
  }
  const isPotentialSelectionReset =
    isRecord(eventValue) &&
    eventValue.type === "selection-ready" &&
    eventValue.sessionId === null &&
    eventValue.generation === 0 &&
    eventValue.sequence === 1;
  if (
    !isPotentialSelectionReset &&
    isRecord(eventValue) &&
    Number.isSafeInteger(eventValue.generation) &&
    (eventValue.generation as number) < cursor.generation
  ) {
    return { accepted: false, code: "STALE_GENERATION" };
  }
  let event: DesktopEvent;
  try {
    event = parseDesktopEvent(eventValue);
  } catch {
    return { accepted: false, code: "STALE_EVENT" };
  }
  const selectionReset =
    event.sessionId === null &&
    event.type === "selection-ready" &&
    event.generation === 0 &&
    event.sequence === 1 &&
    (cursor.sessionId === null || cursor.terminal);
  if (selectionReset) {
    return {
      accepted: true,
      event,
      cursor: {
        windowId: cursor.windowId,
        sessionId: null,
        generation: cursor.generation,
        sequence: 1,
        state: "ready",
        terminal: false,
      },
    };
  }
  if (cursor.closed === true) {
    return { accepted: false, code: "STALE_EVENT" };
  }
  const newSession =
    cursor.sessionId === null &&
    event.sessionId !== null &&
    event.sequence === 1 &&
    event.generation > cursor.generation;
  if (event.sessionId !== cursor.sessionId && !newSession) {
    return { accepted: false, code: "STALE_GENERATION" };
  }
  // A session-bound event belongs to exactly one active operation.  Only an
  // explicit new start/load command may advance the generation; accepting a
  // future event here would let a delayed producer replace the cursor.
  if (!newSession && event.sessionId !== null && event.generation !== cursor.generation) {
    return { accepted: false, code: "STALE_GENERATION" };
  }
  if (!newSession && event.sessionId === null && event.generation !== cursor.generation) {
    return { accepted: false, code: "STALE_GENERATION" };
  }
  if (!newSession && event.generation === cursor.generation) {
    if (event.sequence <= cursor.sequence) {
      return { accepted: false, code: "STALE_EVENT" };
    }
    if (event.sequence !== cursor.sequence + 1) {
      return { accepted: false, code: "STALE_EVENT" };
    }
  }

  let nextState = cursor.state;
  let terminalOutcome = cursor.terminalOutcome;
  let cleanupStatus = cursor.cleanupStatus;
  let closed = false;

  if (cursor.terminal) {
    if (event.type === "cleanup") {
      if (cleanupStatus !== undefined) {
        return { accepted: false, code: "INVALID_STATE" };
      }
      cleanupStatus = event.payload.status;
    } else if (event.type === "closed") {
      if (cleanupStatus === undefined) {
        return { accepted: false, code: "INVALID_STATE" };
      }
      closed = true;
    } else if (event.type === "exported") {
      if (terminalOutcome !== "complete" || cleanupStatus !== undefined) {
        return { accepted: false, code: "INVALID_STATE" };
      }
    } else {
      return { accepted: false, code: "STALE_EVENT" };
    }
  } else if (event.type === "selection-ready") {
    nextState = "ready";
  } else if (event.type === "state") {
    if (!isValidDesktopTransition(cursor.state, event.payload.state)) {
      return { accepted: false, code: "INVALID_STATE" };
    }
    nextState = event.payload.state;
    if (nextState === "complete") {
      terminalOutcome = "complete";
    } else if (nextState === "failed") {
      terminalOutcome = "failure";
    }
  } else if (event.type === "failure") {
    terminalOutcome = "failure";
    nextState = "failed";
  } else if (event.type === "cancelled") {
    terminalOutcome = "cancelled";
    nextState = "cancelling";
  } else {
    if (event.type === "cleanup" || event.type === "closed" || event.type === "exported") {
      return { accepted: false, code: "INVALID_STATE" };
    }
  }

  return {
    accepted: true,
    event,
    cursor: {
      windowId: cursor.windowId,
      sessionId: event.sessionId,
      generation: event.generation,
      sequence: event.sequence,
      state: nextState,
      terminal: terminalOutcome !== undefined,
      ...(terminalOutcome === undefined ? {} : { terminalOutcome }),
      ...(cleanupStatus === undefined ? {} : { cleanupStatus }),
      ...(closed ? { closed } : {}),
    },
  };
}
