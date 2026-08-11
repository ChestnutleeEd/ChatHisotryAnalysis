import { describe, expect, it } from "vitest";

import {
  createNativePresentationSaveApi,
  NativePresentationSaveError,
  PRESENTATION_LEASE_HEADER,
  PRESENTATION_MAX_PNG_BYTES,
  presentationPrepareRequestV1,
  type NativePresentationSaveContext,
  type PresentationRawInvoker,
} from "../src/desktop/presentation-save";
import { buildBetaReportDto } from "../src/presentation/beta/report-adapter";
import { createBetaSummaryDtoV1 } from "../src/presentation/beta/summary-adapter";
import { presentBetaSummaryZhCN } from "../src/presentation/beta/summary-presenter";
import { syntheticBetaAnnualReportResult } from "../src/presentation/beta/synthetic-report-fixture";

function context(): NativePresentationSaveContext {
  const report = buildBetaReportDto(syntheticBetaAnnualReportResult(2025), { mode: "annual", year: 2025 });
  return {
    sessionId: "ses_0123456789abcdef0123456789abcdef" as never,
    generation: 7 as never,
    resultId: "res_0123456789abcdef0123456789abcdef" as never,
    viewModel: presentBetaSummaryZhCN(createBetaSummaryDtoV1(report)),
  };
}

describe("B5.4 presentation raw IPC contract", () => {
  it("prepares JSON authority metadata and sends only a top-level Uint8Array body", async () => {
    const calls: Array<{ command: string; args: unknown; options?: unknown }> = [];
    const invoker: PresentationRawInvoker = {
      async invoke<T>(
        command: string,
        args?: unknown,
        options?: { readonly headers: HeadersInit },
      ): Promise<T> {
        calls.push({ command, args, options });
        if (command === "prepare_presentation_png") {
          return {
            protocolVersion: "chat-history-analysis.presentation-png-save.v1",
            accepted: true,
            leaseId: "lease_0123456789abcdef0123456789abcdef",
          } as T;
        }
        if (command === "cancel_presentation_png") {
          return {
            protocolVersion: "chat-history-analysis.presentation-png-save.v1",
            accepted: true,
            outcome: "cancelled",
          } as T;
        }
        return {
          protocolVersion: "chat-history-analysis.presentation-png-save.v1",
          accepted: true,
          outcome: "saved",
        } as T;
      },
    };
    const api = createNativePresentationSaveApi(invoker);
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const prepared = await api.prepare(context());
    const outcome = await api.savePrepared(prepared.leaseId, pngBytes);
    const cancelled = await api.cancel(prepared.leaseId);

    expect(outcome).toBe("saved");
    expect(cancelled).toBe("cancelled");
    expect(calls[0]?.command).toBe("prepare_presentation_png");
    expect(calls[0]?.args).toMatchObject({ request: {
      protocolVersion: "chat-history-analysis.presentation-png-save.v1",
      purpose: "presentation-png",
      schemaVersion: "chat-history-analysis.share-card-view-model.v1",
      rendererVersion: "chat-history-analysis.share-card-renderer.v1",
      width: 1200,
      height: 1500,
      suggestedFilename: "chat-recap-2025.png",
    } });
    expect(calls[0]?.args).not.toHaveProperty("bytes");
    expect(calls[1]?.command).toBe("save_presentation_png");
    expect(calls[1]?.args).toBe(pngBytes);
    expect(calls[1]?.args).toBeInstanceOf(Uint8Array);
    expect(Array.isArray(calls[1]?.args)).toBe(false);
    expect(calls[1]?.options).toEqual({ headers: {
      [PRESENTATION_LEASE_HEADER]: "lease_0123456789abcdef0123456789abcdef",
    } });
  });

  it("keeps filename and digest derivation identity-free", async () => {
    const request = presentationPrepareRequestV1(context(), "0".repeat(64));
    expect(request.suggestedFilename).toBe("chat-recap-2025.png");
    expect(request.viewModelDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(request.suggestedFilename).not.toMatch(/session|result|dataset|private|json/iu);
  });

  it("maps content-free host failures and normal cancellation without exposing host text", async () => {
    const invoker: PresentationRawInvoker = {
      async invoke<T>(command: string, _args?: unknown, _options?: { readonly headers: HeadersInit }): Promise<T> {
        void _args;
        void _options;
        if (command === "save_presentation_png") {
          throw { code: "EXPORT_STALE_RESULT", message: "synthetic host detail" };
        }
        return {
          protocolVersion: "chat-history-analysis.presentation-png-save.v1",
          accepted: true,
          leaseId: "lease_0123456789abcdef0123456789abcdef",
        } as T;
      },
    };
    const api = createNativePresentationSaveApi(invoker);
    await expect(api.savePrepared(
      "lease_0123456789abcdef0123456789abcdef",
      Uint8Array.from([1]),
    )).rejects.toEqual(expect.objectContaining({
      code: "EXPORT_STALE_RESULT",
      message: "EXPORT_STALE_RESULT",
    }));
    expect(NativePresentationSaveError).toBeDefined();
  });

  it("rejects empty and oversized payloads before invoking raw IPC", async () => {
    const calls: string[] = [];
    const api = createNativePresentationSaveApi({
      async invoke<T>(command: string): Promise<T> {
        calls.push(command);
        throw new Error("should not invoke");
      },
    });
    const leaseId = "lease_0123456789abcdef0123456789abcdef";
    await expect(api.savePrepared(leaseId, new Uint8Array())).rejects.toMatchObject({
      code: "EXPORT_SCHEMA_INVALID",
    });
    await expect(api.savePrepared(leaseId, new Uint8Array(PRESENTATION_MAX_PNG_BYTES + 1))).rejects.toMatchObject({
      code: "EXPORT_LIMIT_EXCEEDED",
    });
    expect(calls).toEqual([]);
  });
});
