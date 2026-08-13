import { expect, test } from "@playwright/test";

test("keeps Home as a quiet portal and moves focus across mode entry", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-home");

  await expect(page.locator(".v3-home-portal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "你的本地聊天回顾已经准备好", exact: true })).toBeVisible();
  await expect(page.locator(".v3-home-scope")).toContainText("最新年份");
  await expect(page.getByRole("button", { name: "重新选择文件", exact: true })).toBeVisible();
  await expect(page.locator(".beta-ready-status")).toHaveCount(0);

  await page.getByRole("button", { name: "进入详细分析", exact: true }).click();
  await expect(page.locator(".dashboard-panel-wrap")).toBeFocused();

  await page.getByRole("button", { name: "首页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你的本地聊天回顾已经准备好", exact: true })).toBeFocused();

  for (const width of [1180, 760, 380]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
      document.body.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
  }

  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
    document.body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
});

test("renders synthetic Detailed shell without result validation errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-detailed");
  await expect(page.getByTestId("beta-detailed-analysis-harness")).toBeVisible();
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute("href", "#beta-main-content");
  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("keeps all eight Detailed routes, committed query context, and responsive overflow intact", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-detailed");

  const routes = [
    "Overview",
    "Trends",
    "Comparison",
    "Activity",
    "Words & Years",
    "Message Types",
    "Replies & Sessions",
    "Export",
  ];
  const routeLabels: Record<string, string> = {
    Overview: "概览",
    Trends: "趋势",
    Comparison: "双方比较",
    Activity: "活跃时间",
    "Words & Years": "词汇与年份",
    "Message Types": "消息类型",
    "Replies & Sessions": "回复与会话",
    Export: "导出",
  };
  await expect(page.getByRole("tab", { name: routeLabels.Overview, exact: true })).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(routes.length);

  for (const route of routes) {
    const tab = page.getByRole("tab", { name: routeLabels[route], exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: routeLabels[route] })).toBeVisible();
    if (route !== "Overview") {
      await expect(page.getByRole("tabpanel", { name: routeLabels[route] })).toBeFocused();
    }
  }

  const appliedSummary = page.locator(".dashboard-context-register");
  const applyQuery = page.getByRole("button", { name: "应用筛选", exact: true });
  await expect(applyQuery).toBeDisabled();
  await page.locator('input[name="startDate"]').fill("2025-01-02");
  await expect(applyQuery).toBeEnabled();
  await expect(appliedSummary).toContainText("2025-01-01 → 2025-01-04");
  await expect(page.locator(".dashboard-draft-status")).toContainText("有未应用更改");
  await page.getByRole("tab", { name: routeLabels.Trends, exact: true }).click();
  await expect(appliedSummary).toContainText("2025-01-01 → 2025-01-04");
  await expect(page.locator('input[name="startDate"]')).toHaveValue("2025-01-02");
  await applyQuery.click();
  await expect(appliedSummary).toContainText("2025-01-02 → 2025-01-04");
  await expect(page.locator(".dashboard-draft-status")).toContainText("与当前分析一致");

  await page.getByRole("tab", { name: routeLabels["Words & Years"], exact: true }).click();
  const methodology = page.locator("details.dashboard-words-methodology");
  await expect(methodology).not.toHaveAttribute("open");
  await methodology.locator("summary").click();
  await expect(methodology).toHaveAttribute("open", "");

  await page.getByRole("tab", { name: routeLabels.Overview, exact: true }).click();
  await page.getByRole("tab", { name: routeLabels.Overview, exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: routeLabels.Trends, exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: routeLabels.Trends, exact: true })).toHaveAttribute("aria-selected", "true");

  for (const width of [1180, 760, 380]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  expect(consoleErrors).toEqual([]);
});
