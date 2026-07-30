import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^"']+\s+from\s+)?["']([^"']+)["']/gu;

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/u.test(path)
        ? [path]
        : [];
  });
}

describe("module dependency direction", () => {
  const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

  it("keeps foundational contracts dependency-free", () => {
    for (const boundary of [
      "preprocessing",
      "normalized",
      "privacy",
    ]) {
      for (const file of sourceFiles(join(sourceRoot, boundary))) {
        expect(
          [...readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)],
          relative(sourceRoot, file),
        ).toEqual([]);
      }
    }
  });

  it("keeps tokenizer imports inside Worker analysis", () => {
    for (const file of sourceFiles(sourceRoot)) {
      const imports = [
        ...readFileSync(file, "utf8").matchAll(IMPORT_PATTERN),
      ].map((match) => match[1]);

      if (!relative(sourceRoot, file).startsWith("worker-analysis/")) {
        expect(imports, basename(file)).not.toContain("jieba-wasm/web");
      }
    }
  });
});
