import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DisabledBrowserInput } from "../src/browser-input/port";
import { NORMALIZED_RECORD_FIELDS } from "../src/normalized/schema";
import { MAIN_THREAD_ANALYSIS_FALLBACK } from "../src/privacy/constraints";

describe("Stage 1B module boundaries", () => {
  it("keeps browser chat input disabled", () => {
    expect(new DisabledBrowserInput().availability()).toEqual({
      kind: "disabled",
      reason: "STAGE_1B_CONTRACT_ONLY",
    });
  });

  it("defines only the normalized record contract fields", () => {
    expect(NORMALIZED_RECORD_FIELDS).toEqual([
      "createTime",
      "formattedTime",
      "calendarDate",
      "senderScope",
      "content",
      "fileRank",
      "sourceIndex",
    ]);
  });

  it("forbids main-thread analysis fallback", () => {
    expect(MAIN_THREAD_ANALYSIS_FALLBACK).toBe("forbidden");
    const appSource = readFileSync(
      fileURLToPath(new URL("../src/presentation/App.tsx", import.meta.url)),
      "utf8",
    );
    expect(appSource).not.toContain("cut(");
    expect(appSource).not.toContain("jieba-wasm");
  });
});
