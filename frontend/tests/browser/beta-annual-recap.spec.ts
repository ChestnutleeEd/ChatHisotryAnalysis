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
  const navigatorToggle = page.getByRole("button", { name: "范围与章节", exact: true });
  await navigatorToggle.click();
  await expect(navigatorToggle).toHaveAttribute("aria-expanded", "true");
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

  const cleanToggle = page.locator(".beta-clean-mode-control input[type='checkbox']");
  await expect(cleanToggle).toBeChecked();
  await expect(page.locator("#frequent-words")).toContainText("本地版本");
  await expect(page.locator("#frequent-words")).not.toContainText("但是");
  await expect(page.locator("#distinctive-keywords")).toHaveAttribute("data-keyword-year", "2025");
  await expect(page.locator("#word-cloud")).toHaveAttribute("data-clean-mode", "on");
  await expect(page.locator("#word-cloud .beta-word-cloud-list")).toContainText("本地版本");
  await expect(page.locator("#peak-hour .beta-core-visual-details")).not.toHaveAttribute("open");
  await expect(page.locator("#frequent-words .beta-word-ranking-disclosure")).not.toHaveAttribute("open");
  await expect(page.locator("#word-cloud .beta-word-cloud-list-disclosure")).not.toHaveAttribute("open");
  await expect(page.locator(".beta-core-card[data-section-status='ready'] .beta-status-pill")).toHaveCount(0);

  await page.getByLabel("跳转章节").selectOption("peak-hour");
  await expect.poll(() => page.locator("#peak-hour").evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(70);
  await page.locator("#peak-hour .beta-core-visual-details summary").click();
  await expect(page.locator("#peak-hour .beta-core-visual-table")).toBeVisible();
  await page.locator("#word-cloud .beta-word-cloud-list-disclosure summary").click();
  await expect(page.locator("#word-cloud .beta-word-cloud-list")).toBeVisible();
  await navigatorToggle.click();

  const compactRanking = page.locator("#frequent-words .beta-word-ranking:not(.beta-word-ranking-full)");
  const meaningfulCount = await compactRanking.locator("li", { hasText: "本地版本" }).textContent();
  await cleanToggle.uncheck();
  await expect(page.locator("#frequent-words")).toContainText("但是");
  await expect(page.locator("#word-cloud")).toHaveAttribute("data-clean-mode", "off");
  await expect(page.locator("#word-cloud .beta-word-cloud-list")).toContainText("但是");
  await page.locator("#frequent-words .beta-word-ranking-disclosure summary").click();
  await expect(page.locator("#frequent-words .beta-word-ranking-full li", { hasText: "本地版本" })).toContainText("350 次");
  expect(meaningfulCount).toContain("350 次");
  await cleanToggle.check();
  await expect(page.locator("#frequent-words")).not.toContainText("但是");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });

  await page.getByLabel("回顾范围").selectOption("year:2024");
  await expect(page.locator("#beta-report-heading")).toHaveText("2024 年");
  await expect(page.locator("#messages")).toContainText("824");
  await expect(page.locator("#frequent-words")).toContainText("海边计划");
  await expect(page.locator("#frequent-words")).not.toContainText("本地版本");
  await expect(page.locator("#distinctive-keywords")).toHaveAttribute("data-keyword-year", "2024");
  await expect(page.locator("#word-cloud .beta-word-cloud-list-heading")).toContainText("2024 年");
  await expect(page.locator("#word-cloud .beta-word-cloud-list")).toContainText("海边计划");
  await expect(page.locator(".beta-report-scope-banner")).toHaveCount(0);

  await page.getByLabel("回顾范围").selectOption("year:2025");
  await expect(page.locator("#messages")).toContainText("1,248");
  await expect(page.locator("#frequent-words")).toContainText("本地版本");
  await expect(page.locator("#distinctive-keywords")).toHaveAttribute("data-keyword-year", "2025");
  await expect(page.locator("#word-cloud .beta-word-cloud-list-heading")).toContainText("2025 年");

  await page.getByLabel("回顾范围").selectOption("all-years");
  await expect(page.getByLabel("回顾范围")).toHaveValue("all-years");
  await expect(page.locator("#messages")).toContainText("2,072");
  await expect(page.locator("#frequent-words")).toContainText("共同回顾");
  await expect(page.locator("#distinctive-keywords")).toHaveAttribute("data-keyword-year", "all-years");
  await expect(page.locator("#distinctive-keywords")).toContainText("全部年份范围不定义年度区分词");
  await expect(page.locator("#distinctive-keywords .beta-keyword-ranking")).toHaveCount(0);
  await expect(page.locator("#word-cloud .beta-word-cloud-list-heading")).toContainText("全部年份");

  await page.getByLabel("回顾范围").selectOption("multi-year-overview");
  await expect(page.getByLabel("回顾范围")).toHaveValue("multi-year-overview");
  await expect(page.locator("#messages")).toContainText("2,072");

  await page.setViewportSize({ width: 520, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
