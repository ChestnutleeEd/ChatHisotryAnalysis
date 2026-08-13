import { expect, test, type Page } from "@playwright/test";

const routes = [
  "概览",
  "趋势",
  "双方比较",
  "活跃时间",
  "词汇与年份",
  "消息类型",
  "回复与会话",
  "导出",
] as const;

async function expectNoPageOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    body: document.body.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ document: true, body: true });
}

test("enforces the V3.4 Instrument Ledger geometry contract", async ({ page }) => {
  await page.goto("/?fixture=beta-detailed");
  await expect(page.getByTestId("beta-detailed-analysis-harness")).toBeVisible();

  const viewports = [
    { width: 1440, height: 900 },
    { width: 1180, height: 760 },
    { width: 760, height: 900 },
    { width: 380, height: 900 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectNoPageOverflow(page);
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return box === undefined ? null : { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      const canvas = document.querySelector<HTMLElement>(".dashboard-content-canvas");
      const floatingSurfaces = [...document.querySelectorAll<HTMLElement>(".dashboard-page > *, .dashboard-overview-grid > *")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return Number.parseFloat(style.borderRadius) >= 8 && style.backgroundColor === "rgb(255, 255, 255)";
        }).length;
      return {
        context: rect(".dashboard-context-strip"),
        toolbar: rect(".dashboard-query-bar"),
        rail: rect(".dashboard-navigation"),
        canvas: rect(".dashboard-content-canvas"),
        methodology: rect(".dashboard-methodology"),
        canvasOverflow: canvas === null ? -1 : canvas.scrollWidth - canvas.clientWidth,
        floatingSurfaces,
      };
    });
    test.info().annotations.push({ type: `detailed-geometry-${viewport.width}`, description: JSON.stringify(geometry) });
    expect(geometry.context?.height ?? 999).toBeLessThanOrEqual(viewport.width < 600 ? 240 : viewport.width < 960 ? 140 : 76);
    expect(geometry.toolbar?.height ?? 999).toBeLessThanOrEqual(viewport.width < 600 ? 270 : viewport.width < 960 ? 150 : 100);
    expect(geometry.methodology?.height ?? 999).toBeLessThanOrEqual(46);
    expect(geometry.canvasOverflow).toBeLessThanOrEqual(1);
    expect(geometry.floatingSurfaces).toBeLessThanOrEqual(1);
    if (viewport.width >= 1440) {
      expect(geometry.rail?.right ?? 9999).toBeLessThanOrEqual((geometry.canvas?.x ?? 0) + 1);
    } else {
      expect(geometry.rail?.bottom ?? 9999).toBeLessThanOrEqual((geometry.canvas?.y ?? 0) + 1);
    }
  }

  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expectNoPageOverflow(page);
  await expect(page.locator(".dashboard-tablist")).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
});

test("keeps all routes precise, keyboard-current, and locally scrollable", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-detailed");

  for (const route of routes) {
    const tab = page.getByRole("tab", { name: route, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-current", "page");
    const panel = page.getByRole("tabpanel", { name: route, exact: true });
    await expect(panel).toBeVisible();
    await expectNoPageOverflow(page);
    const largeRoundedSurfaces = await panel.evaluate((element) => [...element.querySelectorAll<HTMLElement>(".dashboard-chart-card, .dashboard-kpi-card")]
      .filter((candidate) => Number.parseFloat(getComputedStyle(candidate).borderRadius) >= 8).length);
    expect(largeRoundedSurfaces).toBe(0);
  }

  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByRole("tab", { name: "概览", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "导出", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "导出", exact: true })).toHaveAttribute("aria-current", "page");

  await page.getByRole("tab", { name: "回复与会话", exact: true }).click();
  await page.getByText("查看回复方向与区间分布", { exact: true }).click();
  for (const tableRegion of await page.getByRole("region", { name: /可横向滚动查看/u }).all()) {
    await expect(tableRegion).toHaveAttribute("tabindex", "0");
  }
});

test("keeps threshold drafts across route changes and commits a valid result", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-detailed");

  await page.getByRole("tab", { name: "回复与会话", exact: true }).click();
  const threshold = page.locator("#dashboard-threshold");
  const applyThreshold = page.getByRole("button", { name: "应用阈值", exact: true });
  await threshold.selectOption("12");
  await expect(applyThreshold).toBeEnabled();

  await page.getByRole("tab", { name: "趋势", exact: true }).click();
  await expect(page.locator(".dashboard-context-register")).toContainText("6 小时");
  await page.getByRole("tab", { name: "回复与会话", exact: true }).click();
  await expect(threshold).toHaveValue("12");

  await applyThreshold.click();
  await expect(page.locator(".dashboard-context-register")).toContainText("12 小时");
  await expect(page.getByRole("heading", { name: "回复与会话", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  for (const route of routes) {
    await page.getByRole("tab", { name: route, exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: route, exact: true })).toBeVisible();
  }
});

test("keeps the Detailed shell mounted for a bounded result error", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-detailed&state=error");

  await expect(page.locator(".dashboard-result-error")).toBeVisible();
  await expect(page.locator(".dashboard-context-strip")).toBeVisible();
  await expect(page.locator(".dashboard-query-bar")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "结果导航" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "趋势", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "应用筛选", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "回复与会话", exact: true }).click();
  await page.locator("#dashboard-threshold").selectOption("12");
  await page.getByRole("button", { name: "应用阈值", exact: true }).click();
  await expect(page.locator(".dashboard-result-error")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "回复与会话", exact: true })).toBeVisible();
});

test("uses route-specific visualization grammar with exact alternatives", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-detailed");

  await page.getByRole("tab", { name: "趋势", exact: true }).click();
  const trends = page.getByRole("tabpanel", { name: "趋势", exact: true });
  await expect(trends.locator('[data-visual-grammar="temporal-series"]')).toHaveCount(4);
  await expect(trends.locator(".dashboard-bar-chart")).toHaveCount(0);
  await expect(trends.getByRole("table").first()).toBeVisible();

  await page.getByRole("tab", { name: "活跃时间", exact: true }).click();
  const activity = page.getByRole("tabpanel", { name: "活跃时间", exact: true });
  await expect(activity.locator('[data-visual-grammar="month-matrix"]')).toBeVisible();
  await expect(activity.locator('[data-visual-grammar="weekday-strip"]')).toBeVisible();
  await expect(activity.locator('[data-visual-grammar="hour-histogram"]')).toBeVisible();
  await expect(activity.locator(".dashboard-bar-chart")).toHaveCount(0);

  await page.getByRole("tab", { name: "消息类型", exact: true }).click();
  const messageTypes = page.getByRole("tabpanel", { name: "消息类型", exact: true });
  await expect(messageTypes.locator('[data-visual-grammar="proportion-ledger"]')).toBeVisible();
  await expect(messageTypes.locator(".dashboard-bar-chart")).toHaveCount(0);
  await messageTypes.getByText("查看精确类别统计", { exact: true }).click();
  await expect(messageTypes.getByRole("table")).toBeVisible();
});

test("switches by effective workspace width and keeps narrow evidence usable", async ({ page }) => {
  await page.goto("/?fixture=beta-detailed");
  await page.getByRole("tab", { name: "趋势", exact: true }).click();

  for (const viewport of [
    { width: 1440, height: 900, regime: "wide" },
    { width: 1180, height: 760, regime: "standard" },
    { width: 760, height: 900, regime: "compact" },
    { width: 380, height: 900, regime: "narrow" },
  ] as const) {
    await page.setViewportSize(viewport);
    await expectNoPageOverflow(page);
    const diagnostics = await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>(".dashboard-workspace-grid");
      const context = document.querySelector<HTMLElement>(".dashboard-context-strip");
      const toolbar = document.querySelector<HTMLElement>(".dashboard-query-bar");
      const rail = document.querySelector<HTMLElement>(".dashboard-navigation");
      const evidence = document.querySelector<HTMLElement>(".dashboard-temporal-series, .dashboard-month-matrix, .dashboard-proportion-ledger");
      const methodology = document.querySelector<HTMLElement>(".dashboard-methodology");
      const root = document.querySelector<HTMLElement>(".dashboard-content-shell");
      const rect = (element: HTMLElement | null) => element === null
        ? null
        : (() => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
        })();
      return {
        regime: workspace === null ? "" : getComputedStyle(workspace).getPropertyValue("--detailed-effective-layout").trim(),
        context: rect(context),
        toolbar: rect(toolbar),
        rail: rect(rail),
        evidence: rect(evidence),
        methodologyColumns: methodology === null ? "" : getComputedStyle(methodology.querySelector(".dashboard-methodology-groups") as Element).gridTemplateColumns,
        shellWidth: root?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(diagnostics.regime).toBe(viewport.regime);
    expect(diagnostics.evidence?.top ?? Number.POSITIVE_INFINITY).toBeLessThan(viewport.height);
    expect(diagnostics.shellWidth).toBeGreaterThan(0);
    if (viewport.regime === "narrow") {
      expect(diagnostics.methodologyColumns).not.toMatch(/repeat\(5/u);
    }
  }

  // A 760px physical viewport at 200% browser zoom exposes 380 CSS px;
  // use that effective layout viewport rather than CSS zoom, which leaves
  // viewport/container queries in the wider regime.
  await page.setViewportSize({ width: 380, height: 900 });
  await expect(page.locator(".dashboard-workspace-grid")).toHaveCSS("--detailed-effective-layout", "narrow");
  const brokenLabels = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
    ".dashboard-context-register dd, .dashboard-tablist button, .dashboard-page-heading h2, .dashboard-card-heading-row h3",
  )].filter((element) => {
    const text = element.textContent?.trim() ?? "";
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const rect = element.getBoundingClientRect();
    return text.length >= 4 && Number.isFinite(lineHeight) && rect.height / lineHeight >= 3 && rect.width < 48;
  }).map((element) => element.textContent?.trim()));
  expect(brokenLabels).toEqual([]);
});

test("renders compact loading, empty, long-label, methodology, and reduced-motion states", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 900 });
  await page.goto("/?fixture=beta-detailed&state=loading");
  await expect(page.getByRole("status")).toContainText("正在本地更新统计");
  await expect(page.getByRole("navigation", { name: "结果导航" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "概览" })).toBeVisible();

  await page.goto("/?fixture=beta-detailed&state=empty");
  await page.getByRole("tab", { name: "消息类型", exact: true }).click();
  await expect(page.getByText("当前筛选没有用户消息类别。", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.goto("/?fixture=beta-detailed&state=long");
  await page.getByRole("tab", { name: "词汇与年份", exact: true }).click();
  await expect(page.getByText(/跨年度合成词汇标签/u).first()).toBeVisible();
  await expectNoPageOverflow(page);

  const methodology = page.locator(".dashboard-methodology");
  await methodology.locator("summary").click();
  await expect(methodology.locator(".dashboard-methodology-groups > section")).toHaveCount(5);
  await expect(methodology).toContainText("Population");
  await expect(methodology).toContainText("Version");
  await expectNoPageOverflow(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("tab", { name: "趋势", exact: true }).click();
  await expect(page.locator(".dashboard-route-transition")).toHaveCSS("animation-name", "none");
});
