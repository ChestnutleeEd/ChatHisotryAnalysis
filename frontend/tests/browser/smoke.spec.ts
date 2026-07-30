import { expect, test } from "@playwright/test";

function isAllowedLoopback(value: string, expectedOrigin: string): boolean {
  const url = new URL(value);
  const expected = new URL(expectedOrigin);
  return (
    ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname) &&
    (url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "ws:" ||
      url.protocol === "wss:") &&
    url.host === expected.host
  );
}

function safeLocalRequestLabel(value: string): string {
  const url = new URL(value);
  const pathname = url.pathname.startsWith("/@fs/")
    ? "/@fs/[local-module]"
    : url.pathname;
  return `${url.protocol}//${url.host}${pathname}`;
}

test("runs Worker, local WASM, word cloud, and PNG probes offline", async ({
  context,
  page,
  baseURL,
}) => {
  if (baseURL === undefined) {
    throw new Error("LOCAL_BASE_URL_MISSING");
  }

  const requests: string[] = [];
  const blocked: string[] = [];
  const webSockets: string[] = [];
  const consoleErrors: string[] = [];

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (!isAllowedLoopback(url, baseURL)) {
      blocked.push(url);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  page.on("websocket", (socket) => {
    webSockets.push(socket.url());
    if (!isAllowedLoopback(socket.url(), baseURL)) {
      blocked.push(socket.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("worker-status")).toHaveText("ready", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("token-count")).toHaveText(
    "合成探针 token：3",
  );
  await expect(page.getByTestId("token-count")).toHaveAttribute(
    "data-token-signature",
    "本地|隐私|分析测试",
  );
  await expect(page.getByTestId("chart-status")).toHaveText("ready", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("png-status")).toHaveAttribute(
    "data-png-prefix",
    "data:image/png;base64,",
  );
  await expect(page.getByTestId("input-status")).toHaveText("disabled");
  await expect(page.getByTestId("fallback-status")).toHaveText("forbidden");
  const notice = await page.evaluate(async () => {
    const response = await fetch("/THIRD_PARTY_NOTICES.txt");
    return {
      ok: response.ok,
      text: await response.text(),
    };
  });
  expect(notice.ok).toBe(true);
  expect(notice.text).toContain("jieba-wasm 2.4.0");
  expect(notice.text).toContain("echarts-wordcloud 2.1.0");
  expect(notice.text).toContain("wordcloud2.js");

  expect(requests.length).toBeGreaterThan(1);
  expect(requests.every((url) => isAllowedLoopback(url, baseURL))).toBe(true);
  expect(webSockets.every((url) => isAllowedLoopback(url, baseURL))).toBe(true);
  expect(blocked).toEqual([]);
  expect(consoleErrors).toEqual([]);

  const localRequestList = [...new Set(requests.map(safeLocalRequestLabel))]
    .sort()
    .join(", ");
  const localWebSocketList = [...new Set(webSockets.map(safeLocalRequestLabel))]
    .sort()
    .join(", ");
  process.stdout.write(`LOCAL_REQUESTS: ${localRequestList}\n`);
  process.stdout.write(
    `SYNTHETIC_TOKEN_SIGNATURE: ${await page.getByTestId("token-count").getAttribute("data-token-signature")}\n`,
  );
  process.stdout.write(
    `LOCAL_WEBSOCKETS: ${localWebSocketList === "" ? "none" : localWebSocketList}\n`,
  );
});
