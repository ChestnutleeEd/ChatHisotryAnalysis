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
