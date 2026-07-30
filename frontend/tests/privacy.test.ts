import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isLoopbackRuntimeUrl,
  isSameLoopbackOriginRequest,
} from "../src/privacy/constraints";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : [".ts", ".tsx", ".css", ".html"].includes(extname(path))
        ? [path]
        : [];
  });
}

describe("offline and privacy constraints", () => {
  it("allows loopback runtime URLs and rejects remote requests", () => {
    expect(isLoopbackRuntimeUrl("http://127.0.0.1:5173/app.js")).toBe(true);
    expect(isLoopbackRuntimeUrl("ws://localhost:5173/")).toBe(true);
    expect(isLoopbackRuntimeUrl("https://example.invalid/app.js")).toBe(false);
    expect(
      isSameLoopbackOriginRequest(
        "http://127.0.0.1:5173/app.js",
        "http://127.0.0.1:5173",
      ),
    ).toBe(true);
    expect(
      isSameLoopbackOriginRequest(
        "http://127.0.0.1:4173/app.js",
        "http://127.0.0.1:5173",
      ),
    ).toBe(false);
  });

  it("contains no remote runtime resource literals", () => {
    const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
    const runtimeFiles = [
      ...sourceFiles(join(frontendRoot, "src")),
      join(frontendRoot, "index.html"),
    ];
    const remoteLiteral = /https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])/u;

    for (const path of runtimeFiles) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(remoteLiteral);
    }
  });
});
