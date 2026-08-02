import vectors from "../../contracts/desktop-ipc-v1.vectors.json";
import { describe, expect, it } from "vitest";

import {
  DESKTOP_IPC_PROTOCOL_VERSION,
  acceptDesktopEvent,
  isGeneration,
  parseDesktopCommand,
  parseDesktopEvent,
  type EventCursor,
  type Generation,
  type RequestId,
  type SessionId,
} from "../src/desktop/ipc-contract";
import {
  createDesktopApi,
  DESKTOP_COMMAND_ALLOWLIST,
  TAURI_COMMAND_ALLOWLIST,
} from "../src/desktop/ipc";

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
});
