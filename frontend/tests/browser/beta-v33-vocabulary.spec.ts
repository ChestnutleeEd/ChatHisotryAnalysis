import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const screenshotDir = resolve(process.cwd(), "../output/playwright/v3-qa");

async function openAnnual(page: Page, query = "") {
  await page.goto(`/?fixture=beta-annual-recap${query}`);
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  await page.locator("#vocabulary-scene").scrollIntoViewIfNeeded();
  await expect(page.locator("#vocabulary-scene")).toBeVisible();
}

async function openRangeControls(page: Page) {
  const trigger = page.getByRole("button", { name: "范围与章节", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") {
    await trigger.click();
  }
  await expect(page.locator("#annual-range-controls")).toBeVisible();
}

async function capture(page: Page, name: string, selector = "#vocabulary-scene") {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await target.screenshot({ path: resolve(screenshotDir, name) });
}

async function captureTransition(page: Page, from: string, to: string, name: string) {
  await page.evaluate(([fromSelector, toSelector]) => {
    const previous = document.querySelector<HTMLElement>(fromSelector)!;
    const next = document.querySelector<HTMLElement>(toSelector)!;
    const previousBox = previous.getBoundingClientRect();
    const nextBox = next.getBoundingClientRect();
    const boundary = window.scrollY + (previousBox.bottom + nextBox.top) / 2;
    window.scrollTo({ top: Math.max(0, boundary - window.innerHeight / 2), behavior: "auto" });
  }, [from, to]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: false });
}

test.beforeAll(() => {
  mkdirSync(screenshotDir, { recursive: true });
});

test("renders ready Vocabulary as editorial ranks, deterministic keywords, and a full-width cloud", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await openAnnual(page);

  const stage = page.locator(".v3-vocabulary-stage");
  await expect(stage).toHaveAttribute("data-vocabulary-state", "ready");
  await expect(stage).toHaveAttribute("data-vocabulary-composition", "ready-balanced");
  await expect(page.locator(".v3-vocabulary-primary-grid")).toHaveAttribute("data-layout-mode", "5+7");
  await expect(page.locator(".v3-frequent-heroes li")).toHaveCount(3);
  await expect(page.locator(".beta-word-ranking-remaining li")).toHaveCount(5);
  const keywordFieldItems = page.locator(".v3-keyword-field .beta-keyword-ranking:not(.beta-keyword-ranking-full) [data-keyword-slot]");
  await expect(keywordFieldItems).toHaveCount(6);
  expect(await keywordFieldItems.evaluateAll((items) => items.map((item) => item.getAttribute("data-keyword-slot")))).toEqual(["1", "2", "3", "4", "5", "6"]);

  const canvas = page.getByTestId("beta-word-cloud-canvas");
  await expect(canvas).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
  await expect(page.locator(".v3-word-cloud-stage")).toHaveAttribute("data-reveal-state", "ready");
  await expect.poll(() => canvas.evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).not.toBeNull();
  const revealStart = await canvas.evaluate((element) => element.getAnimations()[0]?.startTime ?? null);
  await page.locator("#conversation-scene").scrollIntoViewIfNeeded();
  await page.locator("#vocabulary-scene").scrollIntoViewIfNeeded();
  expect(await canvas.evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).toBe(revealStart);
  const widths = await page.evaluate(() => ({
    scene: document.querySelector("#vocabulary-scene")!.getBoundingClientRect().width,
    cloud: document.querySelector(".v3-word-cloud-stage")!.getBoundingClientRect().width,
  }));
  expect(widths.cloud / widths.scene).toBeGreaterThan(0.94);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await capture(page, "vocabulary-ready-1180.png");
  await captureTransition(page, "#conversation-scene", "#vocabulary-scene", "annual-conversation-vocabulary-transition-1180.png");
  await captureTransition(page, "#vocabulary-scene", "#summary-share", "annual-vocabulary-closing-transition-1180.png");
});

test("recomposes all-years, sparse, loading, error, and zero without phantom cloud columns", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await openAnnual(page);
  await openRangeControls(page);
  await page.getByLabel("回顾范围").selectOption("all-years");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "unavailable");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "keywords-unavailable");
  await expect(page.locator(".v3-vocabulary-primary-grid")).toHaveAttribute("data-layout-mode", "8+4");
  await expect(page.locator(".beta-keyword-empty-notice")).toContainText("请选择一个具体年份");
  await page.getByRole("button", { name: "范围与章节", exact: true }).click();
  await expect(page.locator("#annual-range-controls")).toHaveCount(0);
  await capture(page, "vocabulary-all-years-1180.png");

  await openAnnual(page, "&vocabulary=sparse");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "sparse");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "frequent-sparse-keywords-rich");
  await expect(page.locator(".v3-vocabulary-primary-grid")).toHaveAttribute("data-layout-mode", "4+8");
  await expect(page.locator(".v3-frequent-heroes li")).toHaveCount(3);
  await expect(page.locator(".v3-vocabulary-sparse-note")).toContainText("仅保留实际结果");
  const sparseGeometry = await page.evaluate(() => {
    const frequent = document.querySelector<HTMLElement>(".v3-frequent-ledger")!.getBoundingClientRect();
    const keywords = document.querySelector<HTMLElement>(".v3-keyword-field")!.getBoundingClientRect();
    return {
      frequentWidth: frequent.width,
      keywordWidth: keywords.width,
      heightDifference: Math.abs(frequent.height - keywords.height),
    };
  });
  expect(sparseGeometry.keywordWidth).toBeGreaterThan(sparseGeometry.frequentWidth * 1.7);
  expect(sparseGeometry.heightDifference).toBeLessThanOrEqual(200);
  await capture(page, "vocabulary-sparse-1180.png");
  await captureTransition(page, "#conversation-scene", "#vocabulary-scene", "annual-conversation-vocabulary-sparse-transition-1180.png");

  await openAnnual(page, "&vocabulary=keywords-sparse");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "keywords-sparse");
  await expect(page.locator(".v3-vocabulary-primary-grid")).toHaveAttribute("data-layout-mode", "8+4");
  await expect(page.locator(".v3-vocabulary-sparse-note")).toContainText("年度关键词较少");
  await capture(page, "vocabulary-keywords-sparse-1180.png");

  await openAnnual(page, "&vocabulary=both-sparse");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "both-sparse-or-empty");
  await expect(page.locator(".v3-vocabulary-primary-grid")).toHaveAttribute("data-layout-mode", "12");
  const bothSparseColumns = await page.locator(".v3-vocabulary-primary-grid > section").evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().width));
  expect(Math.abs(bothSparseColumns[0]! - bothSparseColumns[1]!)).toBeLessThanOrEqual(1);
  await capture(page, "vocabulary-both-sparse-1180.png");

  await openAnnual(page, "&vocabulary=loading");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "loading");
  await expect(page.locator(".v3-word-cloud-stage")).toHaveAttribute("data-shell-state", "loading");
  await expect(page.getByText("词云会在当前范围的词频就绪后出现。")).toBeVisible();
  await capture(page, "vocabulary-loading-1180.png");

  await openAnnual(page, "&vocabulary=error");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "error");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "frequency-error");
  await expect(page.locator(".v3-vocabulary-primary-grid")).toHaveAttribute("data-layout-mode", "12");
  await expect(page.getByRole("alert")).toContainText("合成词频暂时不可用");
  await expect(page.locator(".v3-word-cloud-stage")).toHaveAttribute("data-shell-state", "error");
  await expect(page.getByText("当前词云暂不可用，可调整范围后重试。")).toBeVisible();
  await expect(page.getByText(/正在准备当前范围的词频与词云/u)).toHaveCount(0);
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveCount(0);
  await expect(page.locator(".v3-keyword-field .beta-keyword-ranking:not(.beta-keyword-ranking-full) [data-keyword-slot]")).toHaveCount(6);
  const errorGeometry = await page.evaluate(() => {
    const primary = document.querySelector<HTMLElement>(".v3-vocabulary-primary-grid")!.getBoundingClientRect();
    const frequent = document.querySelector<HTMLElement>(".v3-frequent-ledger")!.getBoundingClientRect();
    const keywords = document.querySelector<HTMLElement>(".v3-keyword-field")!.getBoundingClientRect();
    const cloud = document.querySelector<HTMLElement>(".v3-word-cloud-stage")!.getBoundingClientRect();
    return { primaryWidth: primary.width, frequentWidth: frequent.width, keywordWidth: keywords.width, cloudHeight: cloud.height };
  });
  expect(errorGeometry.frequentWidth).toBeGreaterThanOrEqual(errorGeometry.primaryWidth * 0.99);
  expect(errorGeometry.keywordWidth).toBeGreaterThanOrEqual(errorGeometry.primaryWidth * 0.99);
  expect(errorGeometry.cloudHeight).toBeLessThan(420);
  await capture(page, "vocabulary-error-1180.png");
  await captureTransition(page, "#conversation-scene", "#vocabulary-scene", "annual-conversation-vocabulary-error-transition-1180.png");

  await openAnnual(page, "&vocabulary=zero");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "zero");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "both-sparse-or-empty");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveCount(0);
  await expect(page.getByText("当前范围没有可组成词云的展示词语。")).toBeVisible();
  await capture(page, "vocabulary-zero-1180.png");
});

test("recovers from a known frequency error on a new committed role scope without stale cloud content", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await openAnnual(page, "&vocabulary=error-recover");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "error");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveCount(0);

  await page.getByRole("radio", { name: "Owner", exact: true }).check();
  await expect(page.locator(".v3-vocabulary-control-context strong")).toHaveText("Owner · 2025 年");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "ready");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".v3-word-cloud-stage")).toHaveAttribute("data-word-cloud-role", "owner");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
  await expect(page.locator(".beta-word-cloud-list-heading")).toContainText("Owner");
  await capture(page, "vocabulary-error-restored-ready-1180.png");
});

test("keeps loading, error, and ready shell transitions synchronized", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });

  await openAnnual(page, "&vocabulary=loading-error");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "loading");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "error", { timeout: 4_000 });
  await expect(page.getByText(/正在准备当前范围的词频与词云/u)).toHaveCount(0);
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveCount(0);

  await openAnnual(page, "&vocabulary=loading-recover");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "loading");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "ready", { timeout: 4_000 });
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });

  await openAnnual(page, "&vocabulary=scope-transition");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "ready");
  await page.getByRole("radio", { name: "Owner", exact: true }).check();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "loading");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveCount(0);
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-state", "ready", { timeout: 4_000 });
  await expect(page.locator(".v3-word-cloud-stage")).toHaveAttribute("data-word-cloud-role", "owner");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
});

test("updates composition with committed scope, role, Clean Mode, and hidden-word presentation facts", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await openAnnual(page);
  await openRangeControls(page);
  await page.getByLabel("回顾范围").selectOption("year:2024");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");
  await openRangeControls(page);
  await page.getByLabel("回顾范围").selectOption("all-years");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "keywords-unavailable");
  await openRangeControls(page);
  await page.getByLabel("回顾范围").selectOption("year:2025");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");

  await openAnnual(page, "&vocabulary=role-shift");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");
  await page.getByRole("radio", { name: "Owner", exact: true }).check();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "frequent-sparse-keywords-rich");
  await page.getByRole("radio", { name: "Other", exact: true }).check();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");
  await page.getByRole("radio", { name: "双方", exact: true }).check();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");

  await openAnnual(page, "&vocabulary=clean-shift");
  const clean = page.getByRole("checkbox", { name: "净化常用词" });
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "frequent-sparse-keywords-rich");
  await clean.uncheck();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");
  await clean.check();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "frequent-sparse-keywords-rich");

  await openAnnual(page, "&vocabulary=hidden-shift");
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");
  await page.locator(".v3-frequent-heroes .beta-button").first().click();
  await page.locator(".v3-frequent-heroes .beta-button").first().click();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "frequent-sparse-keywords-rich");
  await page.locator(".beta-hidden-word-review summary").click();
  await page.getByRole("button", { name: "清空自定义隐藏" }).click();
  await expect(page.locator(".v3-vocabulary-stage")).toHaveAttribute("data-vocabulary-composition", "ready-balanced");
});

test("keeps role, metric, Clean Mode, hidden words, and the accessible list synchronized", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await openAnnual(page);
  const firstWord = (await page.locator(".v3-frequent-heroes strong").first().textContent())!;

  await page.getByRole("radio", { name: "Owner", exact: true }).check();
  await expect(page.locator(".v3-vocabulary-control-context strong")).toHaveText("Owner · 2025 年");
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
  await page.getByRole("radio", { name: "Other", exact: true }).check();
  await expect(page.locator(".v3-vocabulary-control-context strong")).toHaveText("Other · 2025 年");
  await page.getByRole("radio", { name: "双方", exact: true }).check();

  await page.getByRole("radio", { name: "每万词频率", exact: true }).check();
  await expect(page.locator(".v3-frequent-heroes")).toContainText("/ 万");
  await page.getByRole("radio", { name: "原始次数", exact: true }).check();
  await expect(page.locator(".v3-frequent-heroes")).toContainText("次");

  const clean = page.getByRole("checkbox", { name: "净化常用词" });
  await clean.uncheck();
  await expect(clean).not.toBeChecked();
  await clean.check();
  await expect(clean).toBeChecked();

  const manager = page.locator(".beta-hidden-word-review");
  await manager.locator("summary").click();
  await page.locator("#v3-hidden-word-input").fill(firstWord);
  await page.getByRole("button", { name: "添加隐藏词" }).click();
  await expect(page.locator(".v3-frequent-heroes strong", { hasText: firstWord })).toHaveCount(0);
  await expect(page.locator(".v3-keyword-field strong", { hasText: firstWord })).toHaveCount(0);
  const listDisclosure = page.getByTestId("beta-word-cloud-list-disclosure");
  await listDisclosure.locator("summary").click();
  await expect(page.locator(".beta-word-cloud-list-token strong", { hasText: firstWord })).toHaveCount(0);

  await page.getByTestId("beta-share-preview-trigger").click();
  await expect(page.getByTestId("beta-share-card-preview")).toHaveAttribute("data-render-state", "ready");
  await page.getByRole("switch", { name: /包含词汇摘要/ }).check();
  await expect(page.getByTestId("beta-share-card-preview")).not.toContainText(firstWord);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: `恢复显示隐藏词 ${firstWord}` }).click();
  await expect(page.locator(".v3-frequent-heroes strong", { hasText: firstWord })).toHaveCount(1);
  await capture(page, "vocabulary-hidden-manager-1180.png", ".v3-vocabulary-secondary");
  await page.setViewportSize({ width: 380, height: 900 });
  await capture(page, "vocabulary-hidden-manager-380.png", ".v3-vocabulary-secondary");
});

test("reflows at Compact, Narrow, and 200% equivalent and honors reduced motion", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900, name: "1440" },
    { width: 760, height: 900, name: "760" },
    { width: 380, height: 900, name: "380" },
  ]) {
    await page.setViewportSize(viewport);
    await openAnnual(page);
    await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await capture(page, `vocabulary-ready-${viewport.name}.png`);
  }
  await capture(page, "vocabulary-200-zoom.png");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAnnual(page);
  await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
  expect(await page.getByTestId("beta-word-cloud-canvas").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

test("keeps sparse and error compositions intentional across responsive review widths", async ({ page }) => {
  for (const fixture of ["sparse", "error"] as const) {
    for (const viewport of [
      { width: 1440, height: 900, name: "1440" },
      { width: 760, height: 900, name: "760" },
      { width: 380, height: 900, name: "380" },
    ]) {
      await page.setViewportSize(viewport);
      await openAnnual(page, `&vocabulary=${fixture}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (viewport.width <= 760) {
        const widths = await page.locator(".v3-vocabulary-primary-grid > section").evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().width));
        expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThanOrEqual(1);
      }
      await capture(page, `vocabulary-${fixture}-${viewport.name}.png`);
    }
    await page.setViewportSize({ width: 380, height: 900 });
    await capture(page, `vocabulary-${fixture}-200-zoom.png`);
  }
});
