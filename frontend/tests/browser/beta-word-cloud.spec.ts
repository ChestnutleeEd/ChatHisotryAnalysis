import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & {
      __betaWordCloudLongTasks?: number[];
      __betaWordCloudLongTaskObserver?: PerformanceObserver;
    };
    target.__betaWordCloudLongTasks = [];
    if (typeof PerformanceObserver === "undefined") {
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        target.__betaWordCloudLongTasks?.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
      });
      target.__betaWordCloudLongTaskObserver = observer;
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long-task observation is diagnostic-only and may be unavailable.
    }
  });
});

test("renders the synthetic Beta Canvas cloud through the layout Worker", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-word-cloud");
  await page.goto("/?fixture=beta-word-cloud");
  const cloud = page.getByTestId("beta-word-cloud-harness");
  const canvas = page.getByTestId("beta-word-cloud-canvas");
  await expect(cloud).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-hidden", "true");
  await expect(canvas).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
  await expect.poll(() => page.workers().some((worker) => worker.url().includes("word-cloud-layout"))).toBe(true);
  await expect.poll(async () => canvas.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  }))).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  const canvasSize = await canvas.evaluate((element) => ({
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
    backingWidth: (element as HTMLCanvasElement).width,
    backingHeight: (element as HTMLCanvasElement).height,
  }));
  expect(canvasSize.cssWidth).toBeGreaterThan(0);
  expect(canvasSize.cssHeight).toBeGreaterThan(0);
  expect(canvasSize.backingWidth).toBeGreaterThanOrEqual(Math.floor(canvasSize.cssWidth));
  expect(canvasSize.backingHeight).toBeGreaterThanOrEqual(Math.floor(canvasSize.cssHeight));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const list = page.getByRole("list", { name: "2025 年双方词频列表" });
  const initialCount = await list.locator("li").count();
  expect(initialCount).toBeGreaterThan(0);
  expect(initialCount).toBeLessThanOrEqual(100);

  const perTenThousand = page.getByRole("radio", { name: "每万词频率" });
  await perTenThousand.focus();
  await expect(perTenThousand).toBeFocused();
  await page.keyboard.press("Space");
  await expect(perTenThousand).toBeChecked();
  await expect(list.locator("li").first()).toContainText("每万词频率");
  const other = page.getByRole("radio", { name: "Other" });
  await other.focus();
  await page.keyboard.press("Space");
  const year2024 = page.getByRole("radio", { name: "2024 年" });
  await year2024.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("list", { name: "2024 年Other词频列表" })).toBeVisible({ timeout: 15_000 });
  await expect(canvas).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });

  const currentList = page.getByRole("list", { name: "2024 年Other词频列表" });
  const beforeHide = await currentList.locator("li").count();
  await currentList.getByRole("button", { name: "隐藏此词" }).first().click();
  await expect(currentList.locator("li")).toHaveCount(beforeHide - 1);
  await expect(page.getByRole("button", { name: "清空隐藏词" })).toBeEnabled();
  await page.getByRole("button", { name: "清空隐藏词" }).click();
  await expect(currentList.locator("li")).toHaveCount(beforeHide);

  await page.setViewportSize({ width: 520, height: 900 });
  await expect.poll(() => canvas.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(canvasSize.cssWidth);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const longTasks = await page.evaluate(() => {
    const target = window as Window & {
      __betaWordCloudLongTasks?: number[];
      __betaWordCloudLongTaskObserver?: PerformanceObserver;
    };
    const observed = target.__betaWordCloudLongTaskObserver?.takeRecords().map((entry) => entry.duration) ?? [];
    target.__betaWordCloudLongTaskObserver?.disconnect();
    return [...(target.__betaWordCloudLongTasks ?? []), ...observed];
  });
  process.stdout.write(`BETA_WORD_CLOUD_LONG_TASK_DIAGNOSTICS ${JSON.stringify({
    count: longTasks.length,
    maximumMs: Math.max(0, ...longTasks),
    investigateAboveMs: 50,
    durationsMs: longTasks,
  })}\n`);
});
