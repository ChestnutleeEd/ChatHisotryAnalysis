import { expect, test, type Page } from "@playwright/test";

async function openPreview(page: Page): Promise<void> {
  await page.goto("/?fixture=beta-annual-recap");
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  const trigger = page.getByTestId("beta-share-preview-trigger");
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.getByTestId("beta-share-preview-dialog")).toBeVisible();
  await expect(page.getByTestId("beta-share-card-preview")).toHaveAttribute("data-render-state", "ready");
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
  await expect(card).toHaveAttribute("data-render-state", "ready");
  await expect(card).toHaveAttribute("data-png-state", "validated");
  await expect(card).toHaveAttribute("data-font-mode", /^(offline-macOS-stack|stable-fallback)$/u);
  await expect(card).toHaveAttribute("data-png-width", "1200");
  await expect(card).toHaveAttribute("data-png-height", "1500");
  await expect(card).toHaveAttribute("data-alpha", "255");
  await expect(card).toHaveAttribute("data-png-forbidden-chunks", "");
  const pngSize = Number(await card.getAttribute("data-png-size"));
  expect(pngSize).toBeGreaterThan(0);
  expect(pngSize).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(Number(await card.getAttribute("data-png-encode-ms"))).toBeLessThan(2_000);
  await expect(card).toHaveAttribute("data-png-chunks", /IHDR/iu);
  await expect(card.locator("canvas")).toHaveAttribute("width", "1200");
  await expect(card.locator("canvas")).toHaveAttribute("height", "1500");
  await expect(card.locator("canvas")).toHaveAttribute("aria-hidden", "true");
  const backgroundPixel = await card.locator("canvas").evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("2d");
    return context === null ? null : Array.from(context.getImageData(0, 0, 1, 1).data);
  });
  expect(backgroundPixel).toHaveLength(4);
  expect(backgroundPixel?.[3]).toBe(255);
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
  await expect(card).toHaveAttribute("data-render-state", "ready");
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

test("keeps the same fixed renderer authority across synthetic single-year and all-years scopes", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-annual-recap");
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  const range = page.getByLabel("回顾范围");

  for (const option of ["year:2024", "all-years"]) {
    await range.selectOption(option);
    await expect(range).toHaveValue(option);
    await page.getByTestId("beta-share-preview-trigger").click();
    const dialog = page.getByTestId("beta-share-preview-dialog");
    const card = page.getByTestId("beta-share-card-preview");
    await expect(dialog).toBeVisible();
    await expect(card).toHaveAttribute("data-render-state", "ready");
    await expect(card).toHaveAttribute("data-evidence-state", "ready");
    await expect(card.locator("canvas")).toHaveAttribute("width", "1200");
    await expect(card.locator("canvas")).toHaveAttribute("height", "1500");
    await expect(card).toHaveAttribute("data-rgba-digest", /^[0-9a-f]{64}$/u);
    await page.getByRole("button", { name: "关闭年度回顾卡" }).click();
    await expect(dialog).not.toBeVisible();
  }
});

test("falls back to the deterministic Canvas field when the generated artwork cannot decode", async ({ page }) => {
  await page.route("**/share-card-field-v1*.webp", (route) => route.abort());
  await page.setViewportSize({ width: 1180, height: 760 });
  await openPreview(page);
  const card = page.getByTestId("beta-share-card-preview");
  await expect(card).toHaveAttribute("data-artwork-state", "fallback");
  await expect(card).toHaveAttribute("data-render-state", "ready");
  await expect(card).toHaveAttribute("data-png-state", "validated");
  await expect(card).toHaveAttribute("data-alpha", "255");
  await expect(card).toHaveAttribute("data-font-mode", /^(offline-macOS-stack|stable-fallback)$/u);
  expect(Number(await card.getAttribute("data-png-encode-ms"))).toBeLessThan(2_000);
  const fallbackDigest = await card.getAttribute("data-rgba-digest");
  expect(fallbackDigest).toMatch(/^[0-9a-f]{64}$/u);
  await page.getByRole("button", { name: "关闭年度回顾卡" }).click();
  await expect(page.getByTestId("beta-share-preview-dialog")).not.toBeVisible();
  await page.getByTestId("beta-share-preview-trigger").click();
  await expect(card).toHaveAttribute("data-render-state", "ready");
  await expect(card).toHaveAttribute("data-artwork-state", "fallback");
  await expect(card).toHaveAttribute("data-rgba-digest", fallbackDigest ?? "");
  await expect(page.getByText("装饰图不可用，已使用内置线点图案。", { exact: true })).toBeVisible();
});

test("keeps decoded RGBA deterministic across vocabulary rerenders and viewport display sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await openPreview(page);
  const card = page.getByTestId("beta-share-card-preview");
  const offDigest = await card.getAttribute("data-rgba-digest");
  expect(offDigest).toMatch(/^[0-9a-f]{64}$/u);

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(card).toHaveAttribute("data-rgba-digest", offDigest ?? "");
  await page.getByRole("switch", { name: /包含词汇摘要/ }).check();
  await expect(card).not.toHaveAttribute("data-rgba-digest", offDigest ?? "");
  await expect(card).toHaveAttribute("data-rgba-digest", /^[0-9a-f]{64}$/u);
  const onDigest = await card.getAttribute("data-rgba-digest");
  expect(onDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(onDigest).not.toBe(offDigest);
  await page.getByRole("switch", { name: /包含词汇摘要/ }).uncheck();
  await expect(card).toHaveAttribute("data-rgba-digest", offDigest ?? "");
});

test("keeps the sheet reachable at a 200% zoom equivalent viewport", async ({ page }) => {
  await page.setViewportSize({ width: 590, height: 900 });
  await openPreview(page);
  await expect(page.getByTestId("beta-share-preview-dialog")).toHaveAttribute("data-state", "ready");
  await expect(page.getByRole("button", { name: "关闭年度回顾卡" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /包含词汇摘要/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByTestId("beta-share-card-preview").locator("canvas")).toHaveAttribute("width", "1200");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
