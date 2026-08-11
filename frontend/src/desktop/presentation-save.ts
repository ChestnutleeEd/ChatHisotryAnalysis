import { invoke } from "@tauri-apps/api/core";

import type { Generation, ResultId, SessionId } from "./ipc-contract";
import {
  SHARE_CARD_RENDERER_VERSION,
  SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION,
  validateShareCardViewModelPrivacyV1,
  type ShareCardViewModelV1,
} from "../presentation/beta/summary-contract";

export const PRESENTATION_SAVE_PROTOCOL_VERSION =
  "chat-history-analysis.presentation-png-save.v1" as const;
export const PRESENTATION_SAVE_PURPOSE = "presentation-png" as const;
export const PRESENTATION_LEASE_HEADER = "x-chat-analysis-export-lease" as const;
export const PRESENTATION_PNG_WIDTH = 1200 as const;
export const PRESENTATION_PNG_HEIGHT = 1500 as const;
export const PRESENTATION_MAX_PNG_BYTES = 10 * 1024 * 1024;

export type PresentationSaveErrorCode =
  | "EXPORT_STALE_RESULT"
  | "EXPORT_SCHEMA_INVALID"
  | "EXPORT_LIMIT_EXCEEDED"
  | "EXPORT_RENDER_FAILED"
  | "EXPORT_DIALOG_UNAVAILABLE"
  | "EXPORT_PERMISSION_DENIED"
  | "EXPORT_DISK_FULL"
  | "EXPORT_WRITE_FAILED"
  | "EXPORT_FLUSH_FAILED"
  | "EXPORT_DURABILITY_UNCERTAIN"
  | "EXPORT_RENAME_FAILED"
  | "EXPORT_CLEANUP_REQUIRED"
  | "EXPORT_BUSY"
  | "EXPORT_RESULT_PENDING"
  | "EXPORT_RESULT_NOT_FOUND";

export class NativePresentationSaveError extends Error {
  readonly code: PresentationSaveErrorCode;

  constructor(code: PresentationSaveErrorCode) {
    super(code);
    this.name = "NativePresentationSaveError";
    this.code = code;
  }
}

export type PresentationSaveOutcome = "saved" | "cancelled";

export interface NativePresentationSaveContext {
  readonly sessionId: SessionId;
  readonly generation: Generation;
  readonly resultId: ResultId;
  readonly viewModel: ShareCardViewModelV1;
}

export interface PresentationPrepareRequest {
  readonly protocolVersion: typeof PRESENTATION_SAVE_PROTOCOL_VERSION;
  readonly purpose: typeof PRESENTATION_SAVE_PURPOSE;
  readonly schemaVersion: typeof SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION;
  readonly sessionId: SessionId;
  readonly generation: Generation;
  readonly resultId: ResultId;
  readonly viewModelDigest: string;
  readonly rendererVersion: typeof SHARE_CARD_RENDERER_VERSION;
  readonly width: typeof PRESENTATION_PNG_WIDTH;
  readonly height: typeof PRESENTATION_PNG_HEIGHT;
  readonly suggestedFilename: string;
}

export interface PresentationPrepareAck {
  readonly protocolVersion: typeof PRESENTATION_SAVE_PROTOCOL_VERSION;
  readonly accepted: true;
  readonly leaseId: string;
}

export interface PresentationSaveAck {
  readonly protocolVersion: typeof PRESENTATION_SAVE_PROTOCOL_VERSION;
  readonly accepted: true;
  readonly outcome: PresentationSaveOutcome;
}

export interface PresentationRawInvoker {
  invoke<T>(
    command: string,
    args?: unknown,
    options?: { readonly headers: HeadersInit },
  ): Promise<T>;
}

export interface NativePresentationSaveApi {
  prepare(context: NativePresentationSaveContext): Promise<PresentationPrepareAck>;
  savePrepared(leaseId: string, bytes: Uint8Array): Promise<PresentationSaveOutcome>;
  cancel(leaseId: string): Promise<PresentationSaveOutcome>;
  save(context: NativePresentationSaveContext, bytes: Uint8Array): Promise<PresentationSaveOutcome>;
}

const PRESENTATION_ERROR_CODES = new Set<PresentationSaveErrorCode>([
  "EXPORT_STALE_RESULT",
  "EXPORT_SCHEMA_INVALID",
  "EXPORT_LIMIT_EXCEEDED",
  "EXPORT_RENDER_FAILED",
  "EXPORT_DIALOG_UNAVAILABLE",
  "EXPORT_PERMISSION_DENIED",
  "EXPORT_DISK_FULL",
  "EXPORT_WRITE_FAILED",
  "EXPORT_FLUSH_FAILED",
  "EXPORT_DURABILITY_UNCERTAIN",
  "EXPORT_RENAME_FAILED",
  "EXPORT_CLEANUP_REQUIRED",
  "EXPORT_BUSY",
  "EXPORT_RESULT_PENDING",
  "EXPORT_RESULT_NOT_FOUND",
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLeaseId(value: unknown): value is string {
  return typeof value === "string" && /^lease_[0-9a-f]{32}$/u.test(value);
}

function isPresentationSaveOutcome(value: unknown): value is PresentationSaveOutcome {
  return value === "saved" || value === "cancelled";
}

function parseErrorCode(value: unknown): PresentationSaveErrorCode | undefined {
  if (!record(value) || typeof value.code !== "string") {
    return undefined;
  }
  return PRESENTATION_ERROR_CODES.has(value.code as PresentationSaveErrorCode)
    ? value.code as PresentationSaveErrorCode
    : undefined;
}

function asNativeSaveError(value: unknown, fallback: PresentationSaveErrorCode): NativePresentationSaveError {
  if (value instanceof NativePresentationSaveError) {
    return value;
  }
  return new NativePresentationSaveError(parseErrorCode(value) ?? fallback);
}

function parsePrepareAck(value: unknown): PresentationPrepareAck {
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !== "accepted,leaseId,protocolVersion" ||
    value.protocolVersion !== PRESENTATION_SAVE_PROTOCOL_VERSION ||
    value.accepted !== true ||
    !isLeaseId(value.leaseId)
  ) {
    throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
  }
  return value as unknown as PresentationPrepareAck;
}

function parseSaveAck(value: unknown): PresentationSaveAck {
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !== "accepted,outcome,protocolVersion" ||
    value.protocolVersion !== PRESENTATION_SAVE_PROTOCOL_VERSION ||
    value.accepted !== true ||
    !isPresentationSaveOutcome(value.outcome)
  ) {
    throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
  }
  return value as unknown as PresentationSaveAck;
}

function yearText(year: number): string {
  return String(year).padStart(4, "0");
}

export function suggestedPresentationFilenameV1(viewModel: ShareCardViewModelV1): string {
  const scope = viewModel.scope;
  if (scope.kind === "single-year") {
    return `chat-recap-${yearText(scope.year)}.png`;
  }
  return `chat-recap-${scope.startDate.slice(0, 4)}-${scope.endDate.slice(0, 4)}.png`;
}

export async function digestShareCardViewModelV1(viewModel: ShareCardViewModelV1): Promise<string> {
  let validated: ShareCardViewModelV1;
  try {
    validated = validateShareCardViewModelPrivacyV1(viewModel);
  } catch {
    throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
  }
  if (validated.exportAvailability.status !== "ready") {
    throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
  }
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined || typeof TextEncoder === "undefined") {
    throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
  }
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(validated)));
  } catch {
    throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
  }
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function presentationPrepareRequestV1(
  context: NativePresentationSaveContext,
  viewModelDigest: string,
): PresentationPrepareRequest {
  return {
    protocolVersion: PRESENTATION_SAVE_PROTOCOL_VERSION,
    purpose: PRESENTATION_SAVE_PURPOSE,
    schemaVersion: SHARE_CARD_VIEW_MODEL_SCHEMA_VERSION,
    sessionId: context.sessionId,
    generation: context.generation,
    resultId: context.resultId,
    viewModelDigest,
    rendererVersion: SHARE_CARD_RENDERER_VERSION,
    width: PRESENTATION_PNG_WIDTH,
    height: PRESENTATION_PNG_HEIGHT,
    suggestedFilename: suggestedPresentationFilenameV1(context.viewModel),
  };
}

export function createNativePresentationSaveApi(invoker: PresentationRawInvoker): NativePresentationSaveApi {
  const api: NativePresentationSaveApi = {
    async prepare(context: NativePresentationSaveContext): Promise<PresentationPrepareAck> {
      const digest = await digestShareCardViewModelV1(context.viewModel);
      const request = presentationPrepareRequestV1(context, digest);
      try {
        const value = await invoker.invoke<unknown>("prepare_presentation_png", { request });
        return parsePrepareAck(value);
      } catch (error) {
        throw asNativeSaveError(error, "EXPORT_SCHEMA_INVALID");
      }
    },

    async savePrepared(leaseId: string, bytes: Uint8Array): Promise<PresentationSaveOutcome> {
      if (!isLeaseId(leaseId) || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
      }
      if (bytes.byteLength > PRESENTATION_MAX_PNG_BYTES) {
        throw new NativePresentationSaveError("EXPORT_LIMIT_EXCEEDED");
      }
      try {
        const value = await invoker.invoke<unknown>("save_presentation_png", bytes, {
          headers: { [PRESENTATION_LEASE_HEADER]: leaseId },
        });
        return parseSaveAck(value).outcome;
      } catch (error) {
        throw asNativeSaveError(error, "EXPORT_WRITE_FAILED");
      }
    },

    async cancel(leaseId: string): Promise<PresentationSaveOutcome> {
      if (!isLeaseId(leaseId)) {
        throw new NativePresentationSaveError("EXPORT_STALE_RESULT");
      }
      try {
        const value = await invoker.invoke<unknown>("cancel_presentation_png", {
          request: { leaseId },
        });
        const outcome = parseSaveAck(value).outcome;
        if (outcome !== "cancelled") {
          throw new NativePresentationSaveError("EXPORT_SCHEMA_INVALID");
        }
        return outcome;
      } catch (error) {
        throw asNativeSaveError(error, "EXPORT_STALE_RESULT");
      }
    },

    async save(
      context: NativePresentationSaveContext,
      bytes: Uint8Array,
    ): Promise<PresentationSaveOutcome> {
      const prepared = await api.prepare(context);
      return api.savePrepared(prepared.leaseId, bytes);
    },
  };
  return api;
}

const tauriPresentationInvoker: PresentationRawInvoker = {
  invoke<T>(
    command: string,
    args?: unknown,
    options?: { readonly headers: HeadersInit },
  ): Promise<T> {
    return invoke<T>(command, args as never, options);
  },
};

export const nativePresentationSaveApi = createNativePresentationSaveApi(tauriPresentationInvoker);
