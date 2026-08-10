import { expect, test, type Page } from "@playwright/test";

async function openPreview(page: Page): Promise<void> {
  await page.goto("/?fixture=beta-annual-recap");
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  const trigger = page.getByTestId("beta-share-preview-trigger");
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.getByTestId("beta-share-preview-dialog")).toBeVisible();
}

test("opens a VM-backed preview with vocabulary opt-in, focus return, and no fake save", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1180, height: 760 });
  await openPreview(page);

  const dialog = page.getByTestId("beta-share-preview-dialog");
  const card = page.getByTestId("beta-share-card-preview");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#beta-share-preview-heading")).toBeFocused();
  await expect(card).toHaveAttribute("data-artwork-state", "loaded");
  await expect(card).toContainText("2025 年聊天回顾");
  await expect(card).toContainText("部分日期范围");
  await expect(page.getByTestId("beta-share-preview-save")).toBeDisabled();
  await expect(page.getByText("下一批接入本地保存。", { exact: true })).toBeVisible();

  const ratio = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width / rect.height;
  });
  expect(ratio).toBeCloseTo(0.8, 2);

  const vocabulary = page.getByRole("switch", { name: /包含词汇摘要/ });
  await expect(vocabulary).not.toBeChecked();
  await expect(dialog).toHaveAttribute("data-vocabulary", "off");
  await vocabulary.check();
  await expect(vocabulary).toBeChecked();
  await expect(dialog).toHaveAttribute("data-vocabulary", "on");
  await expect(card).toContainText("本地版本");
  await expect(card).toContainText("发布计划");

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("beta-share-preview-trigger")).toBeFocused();
  expect(consoleErrors).toEqual([]);
});

test("uses a full-screen single-column sheet at compact and narrow widths without overflow", async ({ page }) => {
  for (const viewport of [{ width: 760, height: 900 }, { width: 380, height: 900 }]) {
    await page.setViewportSize(viewport);
    await openPreview(page);
    const dialog = page.getByTestId("beta-share-preview-dialog");
    const card = page.getByTestId("beta-share-card-preview");
    await expect(dialog).toBeVisible();
    if (viewport.width < 600) {
      await expect(dialog).toHaveCSS("border-radius", "0px");
    }
    const ratio = await card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width / rect.height;
    });
    expect(ratio).toBeCloseTo(0.8, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "关闭年度回顾卡" }).click();
    await expect(dialog).not.toBeVisible();
  }
});

test("falls back to the local CSS field when the generated artwork cannot decode", async ({ page }) => {
  await page.route("**/share-card-field-v1-*.webp", (route) => route.abort());
  await page.setViewportSize({ width: 1180, height: 760 });
  await openPreview(page);
  await expect(page.getByTestId("beta-share-card-preview")).toHaveAttribute("data-artwork-state", "fallback");
  await expect(page.getByText("装饰图不可用，已使用内置线点图案。", { exact: true })).toBeVisible();
});

test("keeps the sheet reachable at a 200% zoom equivalent viewport", async ({ page }) => {
  await page.setViewportSize({ width: 590, height: 900 });
  await openPreview(page);
  await expect(page.getByTestId("beta-share-preview-dialog")).toHaveAttribute("data-state", "ready");
  await expect(page.getByRole("button", { name: "关闭年度回顾卡" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /包含词汇摘要/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
