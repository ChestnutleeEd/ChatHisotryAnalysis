import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

const mode = process.argv[2];
if (mode !== "development" && mode !== "production") {
  process.exitCode = 64;
} else {
  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("BROWSER_TEST_PORT_UNAVAILABLE"));
        return;
      }
      const selected = address.port;
      probe.close((error) => {
        if (error === undefined) {
          resolve(selected);
        } else {
          reject(error);
        }
      });
    });
  });
  if (port === 4_173) {
    throw new Error("RESERVED_PORT_SELECTED");
  }
  const config =
    mode === "development"
      ? "playwright.dev.config.ts"
      : "playwright.preview.config.ts";
  const result = spawnSync(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", `--config=${config}`],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        CHA_BROWSER_TEST_MODE: mode,
        CHA_BROWSER_TEST_PORT: String(port),
      },
      stdio: "inherit",
    },
  );
  process.exitCode = result.status ?? 1;
}
