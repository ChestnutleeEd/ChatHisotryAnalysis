import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const screenshotDir = resolve(process.cwd(), "../output/playwright/beta-p1");

function assertNoHorizontalOverflow(page: Page): Promise<void> {
  return expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
    document.body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
}

async function hideScreenshotOnlyOverlays(page: Page): Promise<void> {
  await page.addStyleTag({ content: ".beta-skip-link { display: none !important; }" });
}

test("passes synthetic P1 Annual and Detailed presentation QA with fixed screenshots", async ({ page }) => {
  mkdirSync(screenshotDir, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-annual-recap");
  await hideScreenshotOnlyOverlays(page);
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  await expect(page.locator(".beta-report-navigation")).toBeVisible();
  await expect(page.getByLabel("回顾范围")).toHaveValue("year:2025");
  await expect(page.locator(".beta-report-progress button em").first()).toBeHidden();
  await expect.poll(() => page.locator(".beta-v2-scale-support").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
  await expect(page.locator(".beta-v2-month-timeline")).toBeVisible();
  await expect(page.locator(".beta-v2-month-timeline-row ol")).toHaveCount(1);
  await expect(page.locator("#message-types .beta-core-visual-details")).toContainText("查看");
  await expect(page.locator("#message-types")).toContainText("文字");
  await expect(page.locator("#frequent-words .beta-word-ranking-podium")).toBeVisible();
  await expect(page.locator("#frequent-words .beta-word-ranking-podium li")).toHaveCount(3);
  await expect(page.locator("#distinctive-keywords")).toHaveAttribute("data-keyword-year", "2025");

  for (const [name, selector] of [
    ["annual-opening-1180", "#opening"],
    ["annual-scale-1180", "#scale-scene"],
    ["annual-rhythm-1180", "#rhythm-scene"],
    ["annual-balance-1180", "#balance-scene"],
    ["annual-frequent-words-1180", "#frequent-words"],
    ["annual-word-cloud-1180", "#word-cloud"],
    ["annual-closing-1180", "#summary-share"],
  ] as const) {
    const section = page.locator(selector);
    await section.scrollIntoViewIfNeeded();
    await page.evaluate(() => { window.scrollBy(0, -104); });
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await section.screenshot({ path: resolve(screenshotDir, `${name}.png`) });
  }

  await page.getByLabel("回顾范围").selectOption("all-years");
  await expect(page.locator("#distinctive-keywords")).toHaveAttribute("data-keyword-year", "all-years");
  await expect(page.locator(".beta-keyword-empty-notice")).toContainText("选择一个具体年份后");
  await expect(page.getByRole("button", { name: "选择具体年份", exact: true })).toBeVisible();
  const keywordNotice = page.locator("#distinctive-keywords");
  await keywordNotice.scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.scrollBy(0, -104); });
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await keywordNotice.screenshot({ path: resolve(screenshotDir, "annual-keywords-all-years-1180.png") });
  await page.getByRole("button", { name: "选择具体年份", exact: true }).click();
  await expect(page.getByLabel("回顾范围")).toHaveValue("year:2025");

  for (const width of [1180, 760, 380]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await assertNoHorizontalOverflow(page);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  await page.goto("/?fixture=beta-detailed");
  await hideScreenshotOnlyOverlays(page);
  await expect(page.getByTestId("beta-detailed-analysis-harness")).toBeVisible();
  await expect(page.getByText("本地分析 · 详细", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "概览", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "词汇与年份", exact: true })).toBeVisible();
  await expect(page.getByText("已应用筛选", { exact: true })).toBeVisible();
  await expect(page.getByText("比较面板固定包含双方", { exact: true })).toBeVisible();
  await expect(page.locator(".dashboard-query-bar")).toContainText("应用筛选");
  await expect(page.locator(".dashboard-methodology")).not.toHaveAttribute("open");
  await page.screenshot({ path: resolve(screenshotDir, "detailed-top-1180.png") });

  const overviewPanel = page.getByRole("tabpanel", { name: "概览", exact: true });
  await expect(overviewPanel).toBeVisible();
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await overviewPanel.screenshot({ path: resolve(screenshotDir, "detailed-overview-1180.png") });

  await page.getByRole("tab", { name: "活跃时间", exact: true }).click();
  const activityPanel = page.getByRole("tabpanel", { name: "活跃时间", exact: true });
  await expect(activityPanel).toBeVisible();
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await activityPanel.screenshot({ path: resolve(screenshotDir, "detailed-activity-1180.png") });

  const methodology = page.locator("details.dashboard-methodology");
  await methodology.locator("summary").click();
  await expect(methodology.locator(".dashboard-methodology-facts dl")).toBeVisible();
  await expect(methodology).toContainText("处理位置");
  await methodology.screenshot({ path: resolve(screenshotDir, "detailed-methodology-1180.png") });

  for (const width of [1180, 760, 380]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await assertNoHorizontalOverflow(page);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  expect(consoleErrors).toEqual([]);
});
