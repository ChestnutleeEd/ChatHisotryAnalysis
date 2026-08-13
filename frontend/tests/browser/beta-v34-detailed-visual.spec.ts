import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const screenshotDir = resolve(process.cwd(), "../output/playwright/v3-4r");

async function prepare(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/?fixture=beta-detailed");
  await page.addStyleTag({ content: ".beta-skip-link { display: none !important; }" });
  await expect(page.getByTestId("beta-detailed-analysis-harness")).toBeVisible();
}

async function capturePanel(page: Page, route: string, name: string): Promise<void> {
  await page.getByRole("tab", { name: route, exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: route, exact: true });
  await expect(panel).toBeVisible();
  await panel.screenshot({ path: resolve(screenshotDir, `${name}.png`) });
}

test("captures the V3.4R Detailed synthetic visual review inventory", async ({ page }) => {
  mkdirSync(screenshotDir, { recursive: true });

  await prepare(page, 1180, 760);
  await page.screenshot({ path: resolve(screenshotDir, "detailed-overview-1180.png") });
  await page.locator('input[name="startDate"]').fill("2025-01-02");
  await page.screenshot({ path: resolve(screenshotDir, "detailed-dirty-toolbar-1180.png") });
  await capturePanel(page, "趋势", "detailed-trends-1180");
  await capturePanel(page, "活跃时间", "detailed-activity-1180");
  await capturePanel(page, "消息类型", "detailed-message-types-1180");
  await capturePanel(page, "回复与会话", "detailed-replies-default-1180");
  await page.locator("#dashboard-threshold").selectOption("12");
  await page.screenshot({ path: resolve(screenshotDir, "detailed-replies-draft-12-1180.png") });
  await page.getByRole("button", { name: "应用阈值", exact: true }).click();
  await expect(page.locator(".dashboard-context-register")).toContainText("12 小时");
  await page.screenshot({ path: resolve(screenshotDir, "detailed-replies-applied-12-1180.png") });
  await page.goto("/?fixture=beta-detailed&state=error");
  await page.addStyleTag({ content: ".beta-skip-link { display: none !important; }" });
  await expect(page.locator(".dashboard-result-error")).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDir, "detailed-result-error-1180.png") });

  await prepare(page, 1440, 900);
  await capturePanel(page, "趋势", "detailed-trends-1440");
  await capturePanel(page, "活跃时间", "detailed-activity-1440");
  await capturePanel(page, "消息类型", "detailed-message-types-1440");
  await capturePanel(page, "回复与会话", "detailed-replies-1440");

  await prepare(page, 760, 900);
  await page.screenshot({ path: resolve(screenshotDir, "detailed-top-760.png") });
  await capturePanel(page, "趋势", "detailed-trends-760");
  await capturePanel(page, "活跃时间", "detailed-activity-760");
  await capturePanel(page, "消息类型", "detailed-message-types-760");

  await prepare(page, 380, 900);
  await page.screenshot({ path: resolve(screenshotDir, "detailed-top-380.png") });
  await capturePanel(page, "趋势", "detailed-trends-380");
  await capturePanel(page, "活跃时间", "detailed-activity-380");
  await capturePanel(page, "消息类型", "detailed-message-types-380");
  const methodology = page.locator("details.dashboard-methodology");
  await methodology.locator("summary").click();
  await methodology.screenshot({ path: resolve(screenshotDir, "detailed-methodology-expanded-380.png") });

  // A 760px physical viewport at 200% browser zoom exposes 380 CSS px.
  // The direct 380px layout viewport is the meaningful effective-width test.
  await prepare(page, 380, 900);
  await page.screenshot({ path: resolve(screenshotDir, "detailed-top-200-zoom.png") });
  await capturePanel(page, "趋势", "detailed-trends-200-zoom");
  await capturePanel(page, "活跃时间", "detailed-activity-200-zoom");
  await capturePanel(page, "消息类型", "detailed-message-types-200-zoom");
});
