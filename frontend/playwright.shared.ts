import { defineConfig, devices } from "@playwright/test";

export function createBrowserConfig(
  baseURL: string,
  command: string,
) {
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
      command,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  });
}
