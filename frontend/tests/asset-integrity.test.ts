import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STOP_WORDS_SHA256,
  STOP_WORDS_VERSION,
} from "../src/worker-analysis/protocol";

describe("local analysis asset integrity", () => {
  it("pins the versioned stop-word bytes and package versions", () => {
    const stopWords = readFileSync(
      fileURLToPath(
        new URL(
          "../src/worker-analysis/assets/stopwords-zh-en-v1.txt",
          import.meta.url,
        ),
      ),
    );
    expect(createHash("sha256").update(stopWords).digest("hex")).toBe(
      STOP_WORDS_SHA256,
    );
    expect(STOP_WORDS_VERSION).toBe(
      "chat-history-analysis.stopwords.zh-en.v1",
    );

    const packageJson = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };
    expect(packageJson.dependencies).toMatchObject({
      "jieba-wasm": "2.4.0",
      echarts: "5.6.0",
      "echarts-wordcloud": "2.1.0",
    });
  });
});
