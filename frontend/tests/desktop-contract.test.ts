import vectors from "../../contracts/desktop-ipc-v1.vectors.json";
import { describe, expect, it } from "vitest";

import {
  DESKTOP_IPC_PROTOCOL_VERSION,
  acceptDesktopEvent,
  isApprovedChartKey,
  isGeneration,
  parseSelectionCommandAck,
  parseDesktopCommand,
  parseDesktopEvent,
  type EventCursor,
  type Generation,
  type RequestId,
  type SessionId,
  type SelectionId,
} from "../src/desktop/ipc-contract";
import {
  createDesktopApi,
  DESKTOP_COMMAND_ALLOWLIST,
  TAURI_COMMAND_ALLOWLIST,
} from "../src/desktop/ipc";
import { applySelectionCommand } from "../src/desktop/selection-state";
import type { SelectionCommandAck } from "../src/desktop/ipc-contract";
import { isRendererAggregateInput } from "../src/desktop/export-contract";

const SESSION = "ses_00000000000000000000000000000001" as SessionId;
const GENERATION = 1 as Generation;

describe("versioned desktop IPC contract", () => {
  it("round-trips every shared valid command and event vector", () => {
    for (const vector of vectors.commands) {
      expect(parseDesktopCommand(vector.value)).toEqual(vector.value);
    }
    for (const vector of vectors.events) {
      expect(parseDesktopEvent(vector.value)).toEqual(vector.value);
    }
    expect(DESKTOP_IPC_PROTOCOL_VERSION).toBe(
      "chat-history-analysis.desktop-ipc.v1",
    );
  });

  it("rejects unknown commands, fields, versions, and stale generations", () => {
    for (const vector of vectors.invalidCommands) {
      expect(() => parseDesktopCommand(vector.value)).toThrow();
    }
    expect(() =>
      parseDesktopCommand({
        ...vectors.commands[0].value,
        protocolVersion: "chat-history-analysis.desktop-ipc.v0",
      }),
    ).toThrow("UNSUPPORTED_PROTOCOL_VERSION");
    expect(isGeneration(0)).toBe(true);
    expect(isGeneration(-1)).toBe(false);
    expect(DESKTOP_COMMAND_ALLOWLIST).not.toContain("run-shell");
    expect(DESKTOP_COMMAND_ALLOWLIST).not.toContain("read-file");
  });

  it("rejects malformed event payloads and reordered sequence values", () => {
    for (const vector of vectors.invalidEvents) {
      expect(() => parseDesktopEvent(vector.value)).toThrow();
    }
    expect(() =>
      parseDesktopEvent({
        ...vectors.events[2].value,
        payload: {
          ...vectors.events[2].value.payload,
          percentage: 101,
        },
      }),
    ).toThrow();
  });

  it("accepts the Stage 3 supervision failure categories", () => {
    const failure = vectors.events.find((vector) => vector.value.type === "failure")
      ?.value;
    expect(failure).toBeDefined();
    for (const code of [
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
    ] as const) {
      expect(
        parseDesktopEvent({
          ...failure,
          payload: { ...failure!.payload, code },
        }),
      ).toBeDefined();
    }
  });

  it("suppresses wrong-window, stale, duplicate, and invalid-transition events", () => {
    const cursor: EventCursor = {
      windowId: "main",
      sessionId: SESSION,
      generation: GENERATION,
      sequence: 1,
      state: "ready",
      terminal: false,
    };
    const progress = vectors.events[2].value;
    expect(acceptDesktopEvent(cursor, progress, "other-window")).toEqual({
      accepted: false,
      code: "WINDOW_NOT_AUTHORIZED",
    });
    expect(acceptDesktopEvent(cursor, progress, "main")).toMatchObject({
      accepted: true,
      cursor: { sequence: 2 },
    });
    expect(
      acceptDesktopEvent(cursor, { ...progress, generation: 0 }, "main"),
    ).toEqual({ accepted: false, code: "STALE_GENERATION" });
    expect(
      acceptDesktopEvent(cursor, { ...progress, sequence: 1 }, "main"),
    ).toEqual({ accepted: false, code: "STALE_EVENT" });
    const invalidTransition = {
      ...progress,
      sequence: 2,
      type: "state",
      payload: { state: "complete" },
    };
    expect(acceptDesktopEvent(cursor, invalidTransition, "main")).toEqual({
      accepted: false,
      code: "INVALID_STATE",
    });
  });

  it("keeps the shared lifecycle race vectors rejected", () => {
    for (const vector of vectors.raceVectors) {
      const result = acceptDesktopEvent(
        vector.cursor as unknown as EventCursor,
        vector.event,
        vector.originWindowId,
      );
      expect(result).toEqual({
        accepted: false,
        code: vector.expected,
      });
    }
  });

  it("allows a fresh sessionless source selection after a closed terminal run", () => {
    const selection = vectors.events[0].value;
    const result = acceptDesktopEvent(
      {
        windowId: "main",
        sessionId: SESSION,
        generation: GENERATION,
        sequence: 7,
        state: "complete",
        terminal: true,
        terminalOutcome: "complete",
        cleanupStatus: "complete",
        closed: true,
      },
      selection,
      "main",
    );
    expect(result).toMatchObject({
      accepted: true,
      cursor: {
        sessionId: null,
        generation: GENERATION,
        sequence: 1,
        state: "ready",
        terminal: false,
      },
    });
    if (!result.accepted) {
      throw new Error("selection reset was rejected");
    }
    expect(
      acceptDesktopEvent(
        result.cursor,
        vectors.events[2].value,
        "main",
      ),
    ).toEqual({ accepted: false, code: "STALE_GENERATION" });
  });

  it("maps typed methods to the finite Tauri command names", async () => {
    const invoke = {
      invoke: async <T>(
        command: (typeof TAURI_COMMAND_ALLOWLIST)[number],
        args: unknown,
      ): Promise<T> => {
        expect(TAURI_COMMAND_ALLOWLIST).toContain(command);
        expect(command).toBe("select_annual_sources");
        expect(args).toEqual({
          request: expect.objectContaining({
            protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
          }),
        });
        return {
          protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
          requestId: "req_00000000000000000000000000000001",
          accepted: true,
          outcome: "registered",
          selection: {
            selectionId: "sel_00000000000000000000000000000001" as SelectionId,
            annualSourceCount: 1,
            verificationSourceCount: 0,
          },
        } as T;
      },
    };
    const api = createDesktopApi(invoke);
    await expect(
      api.selectAnnualSources(
        "req_00000000000000000000000000000001" as RequestId,
      ),
    ).resolves.toMatchObject({ accepted: true });
  });

  it("uses the command response as the canonical registered selection", async () => {
    const response: SelectionCommandAck = {
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      requestId: "req_00000000000000000000000000000001" as RequestId,
      accepted: true,
      outcome: "registered",
      selection: {
        selectionId: "sel_00000000000000000000000000000001" as SelectionId,
        annualSourceCount: 1,
        verificationSourceCount: 0,
      },
    };
    const next = applySelectionCommand(
      {
        selectionId: undefined,
        annualCount: 0,
        verificationCount: 0,
        desktopState: "selecting",
        status: "正在打开本地文件选择器",
      },
      response,
    );
    expect(next).toMatchObject({
      selectionId: "sel_00000000000000000000000000000001",
      annualCount: 1,
      verificationCount: 0,
      desktopState: "ready",
    });
  });

  it("keeps the previous valid selection when the native dialog is cancelled", () => {
    const previous = {
      selectionId: "sel_00000000000000000000000000000001" as never,
      annualCount: 1,
      verificationCount: 0,
      desktopState: "ready" as const,
      status: "本地源选择已更新",
    };
    const cancelled: SelectionCommandAck = {
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      requestId: "req_00000000000000000000000000000001" as RequestId,
      accepted: true,
      outcome: "cancelled",
      selection: null,
    };
    expect(applySelectionCommand(previous, cancelled)).toEqual(previous);
  });

  it("rejects an uncorrelated or path-bearing selection response", () => {
    const response = {
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      requestId: "req_00000000000000000000000000000001",
      accepted: true,
      outcome: "registered",
      selection: {
        selectionId: "sel_00000000000000000000000000000001",
        annualSourceCount: 1,
        verificationSourceCount: 0,
      },
    };
    expect(() => parseSelectionCommandAck(response, "req_00000000000000000000000000000002" as RequestId)).toThrow("INVALID_STATE");
    expect(() => parseSelectionCommandAck({ ...response, path: "synthetic" })).toThrow("INVALID_REQUEST");
  });

  it("keeps production export requests host-owned and chart allow-listed", async () => {
    expect(isApprovedChartKey("trends")).toBe(true);
    expect(isApprovedChartKey("word-cloud")).toBe(false);
    expect(() =>
      parseDesktopCommand({
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        type: "export-aggregate",
        requestId: "req_00000000000000000000000000000001",
        sessionId: SESSION,
        generation: GENERATION,
        reportFormat: "json",
        resultId: "res_00000000000000000000000000000001",
        chartKey: "word-cloud",
      }),
    ).toThrow("INVALID_REQUEST");

    let received: unknown;
    const api = createDesktopApi({
      invoke: async <T>(_command: (typeof TAURI_COMMAND_ALLOWLIST)[number], args: unknown) => {
        received = args;
        return {
          protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
          requestId: "req_00000000000000000000000000000001",
          accepted: true,
        } as T;
      },
    });
    await api.exportAggregate(
      "req_00000000000000000000000000000001" as RequestId,
      SESSION,
      GENERATION,
      "csv",
      "res_00000000000000000000000000000001" as never,
      "sender-comparison",
    );
    expect(received).toEqual({
      request: {
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        type: "export-aggregate",
        requestId: "req_00000000000000000000000000000001",
        sessionId: SESSION,
        generation: GENERATION,
        reportFormat: "csv",
        resultId: "res_00000000000000000000000000000001",
        chartKey: "sender-comparison",
      },
    });
    expect(JSON.stringify(received)).not.toMatch(/path|body|token|keyword|participant|source/iu);
  });

  it("validates the synthetic aggregate commit boundary before IPC", () => {
    const vector = vectors.commands.find((candidate) => candidate.name === "commit-aggregate-result");
    expect(vector).toBeDefined();
    const aggregate = (vector!.value as { aggregate: unknown }).aggregate;
    expect(isRendererAggregateInput(aggregate)).toBe(true);
    const unsafe = structuredClone(aggregate) as { methodology: string };
    unsafe.methodology = "raw message body";
    expect(isRendererAggregateInput(unsafe)).toBe(false);
  });
});
