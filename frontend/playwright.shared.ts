import { defineConfig, devices } from "@playwright/test";

export function createBrowserConfig(
  mode: "development" | "production",
) {
  const port = Number(process.env.CHA_BROWSER_TEST_PORT);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("BROWSER_TEST_PORT_MISSING");
  }
  const baseURL = `http://127.0.0.1:${port}`;
  return defineConfig({
    testDir: "./tests/browser",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: "line",
    use: {
      ...devices["Desktop Chrome"],
      baseURL,
      browserName: "chromium",
      headless: true,
      serviceWorkers: "block",
      trace: "off",
      screenshot: "off",
      video: "off",
    },
    webServer: {
      command: `node scripts/browser-test-server.mjs ${mode} ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  });
}
