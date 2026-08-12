import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const evidenceDir = resolve(process.cwd(), "../output/playwright/v3-geometry");
const screenshotDir = resolve(process.cwd(), "../output/playwright/v3-qa");

const sceneIds = [
  "opening",
  "scale-scene",
  "rhythm-scene",
  "balance-scene",
  "conversation-scene",
  "vocabulary-scene",
  "summary-share",
] as const;

type GeometryEvidence = Awaited<ReturnType<typeof collectGeometry>>;

async function collectGeometry(page: Page) {
  return page.evaluate((expectedSceneIds) => {
    const meaningfulSelector = [
      "h1",
      "h2",
      "h3",
      "p",
      "strong",
      "button",
      "select",
      "input",
      "canvas",
      "table",
      "details",
      "dl",
      "figure",
      "ol",
      "ul",
      "img",
      "a",
      "[data-v3-meaningful]",
    ].join(",");

    function rectOf(element: Element) {
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        right: Math.round(rect.right + window.scrollX),
        bottom: Math.round(rect.bottom + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    function isMeaningful(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        (() => {
          const closedDetails = element.closest("details:not([open])");
          return closedDetails !== null && closedDetails !== element && !element.matches("summary");
        })() ||
        element.closest("[hidden]") !== null
      ) {
        return false;
      }
      if (element.matches("canvas, img, table, details, button, select, input")) {
        return true;
      }
      return element.textContent?.trim() !== "";
    }

    function meaningfulBounds(element: Element) {
      const candidates = [...element.querySelectorAll(meaningfulSelector)]
        .filter((candidate) => isMeaningful(candidate));
      const rects = candidates.map((candidate) => candidate.getBoundingClientRect());
      if (rects.length === 0) {
        const rect = element.getBoundingClientRect();
        return { top: Math.round(rect.top + window.scrollY), bottom: Math.round(rect.top + window.scrollY), count: 0 };
      }
      return {
        top: Math.round(Math.min(...rects.map((rect) => rect.top + window.scrollY))),
        bottom: Math.round(Math.max(...rects.map((rect) => rect.bottom + window.scrollY))),
        count: rects.length,
      };
    }

    const root = document.querySelector<HTMLElement>("[data-v3-annual-report]");
    const nav = document.querySelector<HTMLElement>(".v3-reading-dock");
    if (root === null || nav === null) {
      throw new Error("V3_ANNUAL_GEOMETRY_ROOT_MISSING");
    }

    const scenes = expectedSceneIds.map((id) => {
      const element = document.getElementById(id);
      if (element === null) {
        throw new Error(`V3_SCENE_MISSING:${id}`);
      }
      const box = rectOf(element);
      const meaningful = meaningfulBounds(element);
      const computed = getComputedStyle(element);
      const allowlist = element.getAttribute("data-whitespace-intent");
      const tail = Math.max(0, box.bottom - meaningful.bottom);
      return {
        id,
        box,
        meaningful,
        tail,
        whitespaceRatio: box.height === 0 ? 0 : Number((tail / box.height).toFixed(3)),
        minHeight: computed.minHeight,
        alignItems: computed.alignItems,
        layoutMode: element.getAttribute("data-v3-layout-mode") ?? "full",
        whitespaceIntent: allowlist,
        cells: [...element.querySelectorAll<HTMLElement>("[data-v3-geometry-cell]")].map((cell) => {
          const cellBox = rectOf(cell);
          const cellMeaningful = meaningfulBounds(cell);
          const cellArea = Math.max(1, cellBox.width * cellBox.height);
          const meaningfulHeight = Math.max(0, cellMeaningful.bottom - cellMeaningful.top);
          return {
            id: cell.getAttribute("data-v3-geometry-cell"),
            box: cellBox,
            meaningful: cellMeaningful,
            occupancy: Number((Math.min(1, (cellMeaningful.count > 0 ? meaningfulHeight * Math.max(1, cellBox.width) : 0) / cellArea)).toFixed(3)),
            stretch: Math.max(0, cellBox.bottom - cellMeaningful.bottom),
            mode: cell.getAttribute("data-v3-cell-mode") ?? "full",
            columns: getComputedStyle(cell).gridTemplateColumns,
          };
        }),
      };
    });
    const navBox = rectOf(nav);
    const rootBox = rectOf(root);
    const transitions = scenes.slice(0, -1).map((scene, index) => ({
      from: scene.id,
      to: scenes[index + 1]!.id,
      gap: scenes[index + 1]!.box.top - scene.box.bottom,
    }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, zoom: getComputedStyle(document.documentElement).zoom },
      root: rootBox,
      nav: navBox,
      pageOverflow: {
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.documentElement.clientWidth,
      },
      scenes,
      transitions,
    };
  }, sceneIds);
}

async function assertNoPageOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.documentElement.clientWidth,
  ))).toBeLessThanOrEqual(0);
}

async function openRangePanel(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "范围与章节", exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(page.locator("#annual-range-controls")).toBeVisible();
}

test("emits V3 scene/cell geometry and exercises dock navigation at fixed synthetic viewports", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(screenshotDir, { recursive: true });
  await page.goto("/?fixture=beta-annual-recap");
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();

  const evidence: GeometryEvidence[] = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1180, height: 760 },
    { width: 760, height: 900 },
    { width: 380, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await assertNoPageOverflow(page);
    const diagnostic = await collectGeometry(page);
    evidence.push(diagnostic);

    expect(diagnostic.pageOverflow.document).toBeLessThanOrEqual(0);
    expect(diagnostic.pageOverflow.body).toBeLessThanOrEqual(0);
    expect(diagnostic.scenes).toHaveLength(7);
    expect(diagnostic.nav.width).toBeLessThanOrEqual(720);
    expect(diagnostic.scenes.filter((scene) => scene.whitespaceIntent === null)).toHaveLength(5);
    for (const scene of diagnostic.scenes.filter((candidate) => candidate.whitespaceIntent === null)) {
      expect(scene.minHeight, `${scene.id} ordinary scene min-height`).not.toMatch(/vh|svh|dvh/);
      expect(scene.tail, `${scene.id} trailing whitespace`).toBeLessThanOrEqual(Math.min(120, viewport.height * 0.2));
      expect(scene.whitespaceRatio, `${scene.id} whitespace ratio`).toBeLessThanOrEqual(0.2);
    }
    for (const transition of diagnostic.transitions) {
      expect(transition.gap, `${transition.from} → ${transition.to}`).toBeGreaterThanOrEqual(0);
      expect(transition.gap, `${transition.from} → ${transition.to}`).toBeLessThanOrEqual(128);
    }
  }

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.locator("#scale-scene").scrollIntoViewIfNeeded();
  await page.waitForTimeout(140);
  await expect(page.locator(".v3-progress-steps li[data-progress-state='current'] button")).toHaveAttribute("aria-label", "第 2 场：规模");
  await page.evaluate(() => document.getElementById("messages")?.scrollIntoView({ block: "start", behavior: "auto" }));
  await page.waitForTimeout(80);
  const scaleTarget = page.locator("#messages");
  const navBottom = await page.locator(".v3-reading-dock").evaluate((element) => element.getBoundingClientRect().bottom);
  const scaleTargetTop = await scaleTarget.evaluate((element) => element.getBoundingClientRect().top);
  expect(scaleTargetTop).toBeGreaterThanOrEqual(navBottom + 12);
  expect(scaleTargetTop).toBeLessThanOrEqual(navBottom + 120);

  await openRangePanel(page);
  const panel = page.locator("#annual-range-controls");
  const dockBottom = await page.locator(".v3-reading-dock").evaluate((element) => element.getBoundingClientRect().bottom);
  const panelTop = await panel.evaluate((element) => element.getBoundingClientRect().top);
  expect(panelTop).toBeGreaterThan(dockBottom);
  await expect(page.getByLabel("回顾范围")).toBeVisible();
  await expect(page.getByLabel("跳转章节")).toBeVisible();

  await page.getByRole("button", { name: "第 5 场：交流", exact: true }).click();
  await page.waitForTimeout(650);
  await expect(page.locator(".v3-progress-steps li[data-progress-state='current'] button")).toHaveAttribute("aria-label", "第 5 场：交流");
  const chapterTarget = page.locator("#sessions");
  const chapterTop = await chapterTarget.evaluate((element) => element.getBoundingClientRect().top);
  const currentNavBottom = await page.locator(".v3-reading-dock").evaluate((element) => element.getBoundingClientRect().bottom);
  expect(chapterTop).toBeGreaterThanOrEqual(currentNavBottom + 12);
  expect(chapterTop).toBeLessThanOrEqual(currentNavBottom + 120);

  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await assertNoPageOverflow(page);
  await page.screenshot({ path: resolve(screenshotDir, "annual-200-zoom.png"), fullPage: false });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#opening").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(screenshotDir, "annual-opening-1440.png"), fullPage: false });
  await page.locator("#rhythm-scene").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(screenshotDir, "annual-mid-scroll-1440.png"), fullPage: false });
  await openRangePanel(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(screenshotDir, "annual-range-panel-1440.png"), fullPage: false });
  await page.getByRole("button", { name: "第 6 场：词汇", exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(screenshotDir, "annual-scene-jump-1440.png"), fullPage: false });
  await page.setViewportSize({ width: 380, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(screenshotDir, "annual-narrow-380.png"), fullPage: false });

  writeFileSync(resolve(evidenceDir, "annual-geometry.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
});
