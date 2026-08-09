import { expect, test } from "@playwright/test";

test("renders synthetic Annual Recap core cards and preserves responsive semantics", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-annual-recap");
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  await expect(page.locator("#messages")).toContainText("1,248");
  await expect(page.locator(".beta-report-scope-banner")).toContainText("部分日期范围");
  for (const id of [
    "opening", "messages", "active-days", "longest-streak", "peak-month", "peak-weekday",
    "peak-hour", "sender-share", "message-length", "message-types", "sessions", "replies",
    "frequent-words", "distinctive-keywords", "word-cloud", "summary-share",
  ]) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
  await expect(page.locator("#peak-weekday table caption")).toHaveText("按星期一至星期日排列的消息数量");
  await expect(page.locator("#peak-weekday")).toContainText("星期一和星期二");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });

  await page.getByLabel("回顾范围").selectOption("year:2024");
  await expect(page.locator("#beta-report-heading")).toHaveText("2024 年");
  await expect(page.locator(".beta-report-scope-banner")).toHaveCount(0);
  await page.getByLabel("回顾范围").selectOption("multi-year-overview");
  await expect(page.getByLabel("回顾范围")).toHaveValue("multi-year-overview");

  await page.setViewportSize({ width: 520, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
