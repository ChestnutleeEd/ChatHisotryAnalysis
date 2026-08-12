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

type AnnualSceneDiagnostics = Awaited<ReturnType<typeof readAnnualSceneDiagnostics>>;

async function readAnnualSceneDiagnostics(page: Page) {
  return page.evaluate(() => {
    const sceneIds = [
      "opening",
      "scale-scene",
      "rhythm-scene",
      "balance-scene",
      "conversation-scene",
      "vocabulary-scene",
      "summary-share",
    ] as const;

    function diagnosticsFor(element: Element) {
      const rect = element.getBoundingClientRect();
      const leaves = [element, ...element.querySelectorAll("*")]
        .filter((candidate) => candidate.children.length === 0 && candidate.getClientRects().length > 0);
      const contentBottom = Math.max(
        rect.top,
        ...leaves.map((candidate) => candidate.getBoundingClientRect().bottom),
      );
      const computed = getComputedStyle(element);
      return {
        id: element.id,
        top: Math.round(rect.top + window.scrollY),
        height: Math.round(rect.height),
        bottom: Math.round(rect.bottom + window.scrollY),
        contentBottom: Math.round(contentBottom + window.scrollY),
        tail: Math.round(Math.max(0, rect.bottom - contentBottom)),
        minHeight: computed.minHeight,
      };
    }

    const scenes = sceneIds.map((id) => {
      const element = document.getElementById(id);
      if (element === null) {
        throw new Error(`ANNUAL_SCENE_MISSING:${id}`);
      }
      return diagnosticsFor(element);
    });
    const transitions = scenes.slice(0, -2).map((scene, index) => {
      const nextScene = document.getElementById(scenes[index + 1].id);
      const heading = nextScene?.querySelector(".beta-v2-scene-heading");
      if (nextScene === null || heading === null || heading === undefined) {
        throw new Error(`ANNUAL_SCENE_HEADING_MISSING:${scenes[index + 1].id}`);
      }
      return {
        from: scene.id,
        to: scenes[index + 1].id,
        gap: Math.round(heading.getBoundingClientRect().top - document.getElementById(scene.id)!.getBoundingClientRect().bottom),
      };
    });
    const keywordSection = document.getElementById("distinctive-keywords");
    const keywordNotice = keywordSection?.querySelector(".beta-keyword-empty-notice");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scenes,
      transitions,
      keyword: keywordSection === null || keywordNotice === null || keywordNotice === undefined
        ? null
        : {
          sectionHeight: Math.round(keywordSection.getBoundingClientRect().height),
          noticeHeight: Math.round(keywordNotice.getBoundingClientRect().height),
          marginTop: getComputedStyle(document.querySelector(".beta-v2-word-evidence-scenes")!).marginTop,
        },
    };
  });
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
  const navigatorToggle = page.getByRole("button", { name: "范围与章节", exact: true });
  await expect(page.locator(".v3-progress-navigator")).toBeVisible();
  await navigatorToggle.click();
  await expect(page.getByLabel("回顾范围")).toHaveValue("year:2025");
  await expect(page.locator(".v3-progress-steps button")).toHaveCount(7);
  await expect(page.locator(".v3-progress-steps button").first()).toHaveAttribute("aria-label", "第 1 场：开场");
  await navigatorToggle.click();
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
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.scrollBy(0, -104); });
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await section.screenshot({ path: resolve(screenshotDir, `${name}.png`) });
  }

  await navigatorToggle.click();
  await page.getByLabel("回顾范围").selectOption("all-years");
  await expect(page.locator("#distinctive-keywords")).toHaveAttribute("data-keyword-year", "all-years");
  await expect(page.locator(".beta-keyword-empty-notice")).toContainText("选择一个具体年份后");
  await expect(page.getByRole("button", { name: "选择具体年份", exact: true })).toBeVisible();
  const keywordNotice = page.locator("#distinctive-keywords");
  await keywordNotice.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
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

test("keeps Annual scenes content-driven with bounded vertical rhythm", async ({ page }) => {
  await page.goto("/?fixture=beta-annual-recap");
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  const navigatorToggle = page.getByRole("button", { name: "范围与章节", exact: true });

  const viewports = [
    { width: 1180, height: 760, expectedTransition: 80 },
    { width: 760, height: 900, expectedTransition: 64 },
    { width: 380, height: 900, expectedTransition: 64 },
    { width: 1440, height: 900, expectedTransition: 96 },
  ] as const;
  const ordinarySceneIds = ["scale-scene", "rhythm-scene", "balance-scene", "conversation-scene", "vocabulary-scene"];
  const transitionTolerance = 8;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page);
    const diagnostics = await readAnnualSceneDiagnostics(page);
    test.info().annotations.push({
      type: "annual-scene-diagnostics",
      description: JSON.stringify(diagnostics),
    });

    for (const sceneId of ordinarySceneIds) {
      const scene = diagnostics.scenes.find((candidate) => candidate.id === sceneId);
      expect(scene, `missing diagnostics for ${sceneId}`).toBeDefined();
      expect(scene?.minHeight, `${sceneId} must not use viewport-filling minimum height`).not.toMatch(/vh|svh|dvh/);
      expect(scene?.tail, `${sceneId} tail whitespace`).toBeLessThanOrEqual(96);
    }

    for (const transition of diagnostics.transitions.slice(0, 5)) {
      expect(transition.gap, `${transition.from} -> ${transition.to}`).toBeGreaterThanOrEqual(viewport.expectedTransition - transitionTolerance);
      expect(transition.gap, `${transition.from} -> ${transition.to}`).toBeLessThanOrEqual(viewport.expectedTransition + transitionTolerance);
    }
  }

  await page.setViewportSize({ width: 1180, height: 760 });
  await navigatorToggle.click();
  await page.getByLabel("回顾范围").selectOption("all-years");
  const allYearsDiagnostics: AnnualSceneDiagnostics = await readAnnualSceneDiagnostics(page);
  expect(allYearsDiagnostics.keyword).not.toBeNull();
  expect(allYearsDiagnostics.keyword?.sectionHeight).toBeLessThanOrEqual((allYearsDiagnostics.keyword?.noticeHeight ?? 0) + 96);
  expect(allYearsDiagnostics.keyword?.marginTop).toBe("0px");
});
