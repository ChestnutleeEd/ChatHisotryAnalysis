import { Buffer } from "node:buffer";

import { expect, test, type Page } from "@playwright/test";

import {
  browserFile,
  createSyntheticDataset,
  sha256,
  syntheticRecords,
} from "../synthetic-dataset";

function isAllowedLoopback(value: string, expectedOrigin: string): boolean {
  const url = new URL(value);
  const expected = new URL(expectedOrigin);
  return (
    ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname) &&
    ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
    url.host === expected.host
  );
}

async function payloads(files: readonly File[]) {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer: Buffer.from(await file.arrayBuffer()),
    })),
  );
}

async function importFiles(page: Page, files: readonly File[]): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(
    await payloads(files),
  );
}

test("runs the production normalized analysis workflow offline", async ({
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
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "normalized dataset",
  );
  await page
    .getByRole("checkbox", { name: "这是公开合成测试数据" })
    .check();

  const dataset = createSyntheticDataset();
  await importFiles(page, dataset.files);
  await expect(page.getByTestId("attempt-status")).toContainText(
    "数据集已接受",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("dataset-kind")).toContainText(
    "公开合成测试数据",
  );
  await expect(page.getByTestId("record-count")).toHaveText("3");
  await expect(page.getByTestId("analyzed-message-count")).toHaveText("3");
  await expect(page.getByTestId("unique-token-count")).toHaveText("7");
  await expect(page.locator(".ranking li").first()).toContainText(
    "hello",
  );
  await expect(page.locator(".ranking li").first()).toContainText("2");
  await expect(page.locator(".ranking li")).toHaveText([
    "hello2",
    "local2",
    "world2",
    "分析2",
    "本地2",
    "测试1",
    "隐私1",
  ]);
  await expect(page.getByTestId("date-ribbon")).toContainText(
    "2025-01-01",
  );
  await expect(page.getByTestId("date-ribbon")).toContainText(
    "2025-01-03",
  );
  await expect(page.getByTestId("word-cloud").locator("canvas")).toBeVisible();

  await page.getByLabel("发送方").selectOption("owner");
  await page.getByRole("button", { name: "更新分析" }).click();
  await expect(page.getByTestId("analyzed-message-count")).toHaveText("2");
  await expect(page.getByTestId("active-scope")).toContainText(
    "仅本人发送",
  );

  await page.getByLabel("发送方").selectOption("all");
  await page.getByLabel("开始").fill("2025-01-02");
  await page.getByLabel("结束").fill("2025-01-02");
  await page.getByRole("button", { name: "更新分析" }).click();
  await expect(page.getByTestId("analyzed-message-count")).toHaveText("1");

  await page.getByLabel("开始").fill("2025-01-01");
  await page.getByLabel("结束").fill("2025-01-03");
  await page.getByLabel("最低词频").fill("99");
  await page.getByRole("button", { name: "更新分析" }).click();
  await expect(
    page.getByText("当前条件下没有达到显示阈值的词。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 PNG" })).toBeDisabled();

  await page.getByLabel("最低词频").fill("1");
  await page.getByRole("button", { name: "更新分析" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("chat-wordcloud.png");

  const previousRanking = await page.locator(".ranking").textContent();
  const rawSecret = "SENSITIVE_SYNTHETIC_BODY_MUST_NOT_APPEAR";
  const rawManifest = browserFile(
    [
      `${JSON.stringify({
        exportInfo: { format: "detailed-json" },
        session: { type: "private" },
        messages: [{ content: rawSecret }],
      })}\n`,
    ],
    "manifest.json",
  );
  await importFiles(page, [rawManifest, dataset.files[1]]);
  await expect(page.getByTestId("safe-error")).toContainText(
    "不支持原始 CipherTalk detailed JSON",
  );
  await expect(page.locator(".ranking")).toHaveText(previousRanking ?? "");
  expect(await page.locator("body").textContent()).not.toContain(rawSecret);
  expect(consoleErrors.join("\n")).not.toContain(rawSecret);

  await page
    .getByRole("button", { name: "停止并释放 cache" })
    .click();
  await expect(page.getByTestId("attempt-status")).toContainText(
    "cache 已释放",
  );
  await expect
    .poll(() => page.workers().length, { timeout: 5_000 })
    .toBe(0);
  const restartButton = page.getByRole("button", { name: "重新开始" });
  await expect(restartButton).toBeFocused();
  await restartButton.click();
  await expect(page.getByTestId("attempt-status")).toContainText(
    "数据集已接受",
  );
  await expect(page.getByTestId("record-count")).toHaveText("3");

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
  expect(requests.length).toBeGreaterThan(3);
  expect(requests.every((url) => isAllowedLoopback(url, baseURL))).toBe(true);
  expect(webSockets.every((url) => isAllowedLoopback(url, baseURL))).toBe(true);
  expect(blocked).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("keeps the keyboard order logical and file actions visibly focused", async ({
  page,
}) => {
  await page.goto("/");
  const fileInputs = page.locator('input[type="file"]');
  await page.keyboard.press("Tab");
  await expect(fileInputs.nth(0)).toBeFocused();
  await expect(fileInputs.nth(0).locator("..")).toHaveCSS(
    "outline-style",
    "solid",
  );
  await page.keyboard.press("Tab");
  await expect(fileInputs.nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: "这是公开合成测试数据" }),
  ).toBeFocused();
});

test("renders one long high-frequency token and resizes the real chart", async ({
  page,
}) => {
  await page.goto("/");
  const token = "extraordinarylongsynthetictoken";
  const first = syntheticRecords()[0];
  const dataset = createSyntheticDataset([
    {
      ...first,
      content: Array.from({ length: 50_000 }, () => token).join(" "),
    },
  ]);
  await importFiles(page, dataset.files);
  await expect(page.getByTestId("attempt-status")).toContainText(
    "数据集已接受",
    { timeout: 30_000 },
  );
  const ranking = page.locator(".ranking li");
  await expect(ranking).toHaveCount(1);
  await expect(ranking.first()).toContainText(token);
  await expect(ranking.first()).toContainText("50,000");
  const canvas = page.getByTestId("word-cloud").locator("canvas");
  await expect(canvas).toBeVisible();
  const desktopWidth = await canvas.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await page.setViewportSize({ width: 480, height: 900 });
  await expect
    .poll(
      () =>
        canvas.evaluate(
          (element) => element.getBoundingClientRect().width,
        ),
      { timeout: 5_000 },
    )
    .toBeLessThan(desktopWidth);
  await expect(canvas).toBeVisible();
});

test("rejects tampering without replacing the accepted result and validates controls", async ({
  page,
}) => {
  await page.goto("/");
  const dataset = createSyntheticDataset();
  await importFiles(page, dataset.files);
  await expect(page.getByTestId("attempt-status")).toContainText(
    "数据集已接受",
  );

  const changed = dataset.chunkText.replace("本地", "异地");
  await importFiles(page, [
    dataset.files[0],
    browserFile([changed], "chunk-0001.ndjson"),
  ]);
  await expect(page.getByTestId("safe-error")).toContainText(
    "完整性校验失败",
  );
  await expect(page.getByTestId("record-count")).toHaveText("3");
  await expect(page.locator(".ranking li").first()).toContainText(
    "hello",
  );

  await page.getByLabel("开始").fill("2025-01-03");
  await page.getByLabel("结束").fill("2025-01-01");
  await page.getByRole("button", { name: "更新分析" }).click();
  await expect(
    page.getByText("开始日期不能晚于结束日期", { exact: false }),
  ).toBeVisible();

  const duplicateRecord = `${dataset.chunkText.split("\n")[0]?.replace(
    '"createTime":',
    '"createTime":1735689600,"createTime":',
  )}\n`;
  const bytes = new TextEncoder().encode(duplicateRecord);
  const manifest = structuredClone(dataset.manifest);
  const chunks = manifest.chunks as Record<string, unknown>[];
  chunks[0].byteSize = bytes.byteLength;
  chunks[0].recordCount = 1;
  chunks[0].sha256 = sha256(bytes);
  const aggregates = manifest.aggregates as Record<string, unknown>;
  aggregates.rawMessageCount = 1;
  aggregates.eligibleTextRecordCount = 1;
  aggregates.normalizedRecordCount = 1;
  aggregates.senderCounts = { owner: 1, other: 0 };
  const range = manifest.timeRange as Record<string, unknown>;
  const first = syntheticRecords()[0];
  range.maximumCreateTime = first.createTime;
  range.maximumFormattedTime = first.formattedTime;
  range.maximumCalendarDate = first.calendarDate;
  await importFiles(page, [
    browserFile([`${JSON.stringify(manifest)}\n`], "manifest.json"),
    browserFile([bytes], "chunk-0001.ndjson"),
  ]);
  await expect(page.getByTestId("safe-error")).toContainText(
    "NDJSON 语法无效",
  );
  await expect(page.getByTestId("record-count")).toHaveText("3");
});
