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

    function canvasPaintBounds(canvas: HTMLCanvasElement | null) {
      if (canvas === null || canvas.width === 0 || canvas.height === 0) {
        return null;
      }
      const context = canvas.getContext("2d");
      if (context === null) {
        return null;
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const step = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) / 600));
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
          if ((pixels[(y * canvas.width + x) * 4 + 3] ?? 0) > 0) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (maxX < minX || maxY < minY) {
        return null;
      }
      const width = maxX - minX + step;
      const height = maxY - minY + step;
      return {
        x: minX,
        y: minY,
        width,
        height,
        occupancy: Number(((width * height) / (canvas.width * canvas.height)).toFixed(3)),
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
    const scaleScene = scenes.find((scene) => scene.id === "scale-scene");
    const scalePrimary = scaleScene?.cells.find((cell) => cell.id === "scale-primary");
    const scaleContext = scaleScene?.cells.find((cell) => cell.id === "scale-context");
    const scalePrimaryHeight = scalePrimary === undefined
      ? 0
      : Math.max(0, scalePrimary.meaningful.bottom - scalePrimary.meaningful.top);
    const scaleContextHeight = scaleContext === undefined
      ? 0
      : Math.max(0, scaleContext.meaningful.bottom - scaleContext.meaningful.top);
    const rhythmShape = {
      monthCadenceCells: document.querySelectorAll('[data-rhythm-visual="month-cadence"] [data-cadence-cell]').length,
      weekdayBeatMarkers: document.querySelectorAll('[data-rhythm-visual="weekday-beat"] [data-beat-marker]').length,
      hourPulseMarkers: document.querySelectorAll('[data-rhythm-visual="hour-pulse"] [data-pulse-marker]').length,
      weekdaySeals: document.querySelectorAll('[data-rhythm-visual="weekday-beat"] [data-beat-seal]').length,
      hourApertures: document.querySelectorAll('[data-rhythm-visual="hour-pulse"] [data-hour-aperture]').length,
      magnitudeStems: document.querySelectorAll(".v3-beat-stem, .v3-pulse-stem").length,
      legacyMarks: document.querySelectorAll(".v3-month-cell-fill, .v3-beat-mark, .v3-hour-pulse-mark, .v3-beat-stem, .v3-pulse-stem").length,
    };
    const vocabularyStage = document.querySelector<HTMLElement>(".v3-vocabulary-stage");
    const vocabularyPrimary = document.querySelector<HTMLElement>(".v3-vocabulary-primary-grid");
    const vocabularyFrequent = document.querySelector<HTMLElement>(".v3-frequent-ledger");
    const vocabularyKeywords = document.querySelector<HTMLElement>(".v3-keyword-field");
    const vocabularyCloud = document.querySelector<HTMLElement>(".v3-word-cloud-stage");
    const vocabularyCanvas = document.querySelector<HTMLCanvasElement>(".v3-word-cloud-stage canvas");
    const vocabularyShape = vocabularyStage === null || vocabularyPrimary === null || vocabularyFrequent === null || vocabularyKeywords === null || vocabularyCloud === null
      ? null
      : {
          state: vocabularyStage.dataset.vocabularyState,
          layout: vocabularyPrimary.dataset.layoutMode,
          primary: rectOf(vocabularyPrimary),
          frequent: { rect: rectOf(vocabularyFrequent), meaningful: meaningfulBounds(vocabularyFrequent) },
          keywords: { rect: rectOf(vocabularyKeywords), meaningful: meaningfulBounds(vocabularyKeywords) },
          cloud: rectOf(vocabularyCloud),
          canvas: vocabularyCanvas === null ? null : rectOf(vocabularyCanvas),
          paintBounds: canvasPaintBounds(vocabularyCanvas),
          hiddenManager: rectOf(document.querySelector<HTMLElement>(".beta-hidden-word-review")!),
        };
    const transitions = scenes.slice(0, -1).map((scene, index) => ({
      from: scene.id,
      to: scenes[index + 1]!.id,
      gap: scenes[index + 1]!.box.top - scene.box.bottom,
    }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, zoom: getComputedStyle(document.documentElement).zoom },
      root: rootBox,
      nav: navBox,
      scaleMass: {
        leftMeaningfulHeight: scalePrimaryHeight,
        rightMeaningfulHeight: scaleContextHeight,
        difference: Math.abs(scalePrimaryHeight - scaleContextHeight),
      },
      rhythmShape,
      vocabularyShape,
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

async function captureElement(page: Page, selector: string, name: string): Promise<void> {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await target.screenshot({ path: resolve(screenshotDir, name) });
}

async function captureTransition(
  page: Page,
  fromSelector: string,
  toSelector: string,
  name: string,
): Promise<void> {
  await page.evaluate(([from, to]) => {
    const previous = document.querySelector<HTMLElement>(from);
    const next = document.querySelector<HTMLElement>(to);
    if (previous === null || next === null) {
      throw new Error(`V3_TRANSITION_TARGET_MISSING:${from}:${to}`);
    }
    const previousBox = previous.getBoundingClientRect();
    const nextBox = next.getBoundingClientRect();
    const boundary = window.scrollY + (previousBox.bottom + nextBox.top) / 2;
    window.scrollTo({ top: Math.max(0, boundary - window.innerHeight / 2), behavior: "auto" });
  }, [fromSelector, toSelector] as const);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: false });
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
    await expect(page.getByTestId("beta-word-cloud-canvas")).toHaveAttribute("data-layout-state", "ready", { timeout: 15_000 });
    await expect.poll(() => page.getByTestId("beta-word-cloud-canvas").evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (context === null || canvas.width === 0 || canvas.height === 0) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 16) {
        if ((pixels[index] ?? 0) > 0) return true;
      }
      return false;
    }), { timeout: 15_000 }).toBe(true);
    await assertNoPageOverflow(page);
    const diagnostic = await collectGeometry(page);
    evidence.push(diagnostic);

    expect(diagnostic.pageOverflow.document).toBeLessThanOrEqual(0);
    expect(diagnostic.pageOverflow.body).toBeLessThanOrEqual(0);
    expect(diagnostic.scenes).toHaveLength(7);
    expect(diagnostic.nav.width).toBeLessThanOrEqual(720);
    expect(diagnostic.scenes.filter((scene) => scene.whitespaceIntent === null)).toHaveLength(5);
    expect(diagnostic.rhythmShape.monthCadenceCells).toBe(12);
    expect(diagnostic.rhythmShape.weekdayBeatMarkers).toBe(7);
    expect(diagnostic.rhythmShape.hourPulseMarkers).toBe(24);
    expect(diagnostic.rhythmShape.weekdaySeals).toBe(7);
    expect(diagnostic.rhythmShape.hourApertures).toBe(24);
    expect(diagnostic.rhythmShape.magnitudeStems).toBe(0);
    expect(diagnostic.rhythmShape.legacyMarks).toBe(0);
    expect(diagnostic.vocabularyShape?.state).toBe("ready");
    expect(diagnostic.vocabularyShape?.paintBounds?.occupancy).toBeGreaterThan(0.08);
    expect(diagnostic.vocabularyShape?.cloud.width).toBeGreaterThanOrEqual(diagnostic.root.width * 0.94);
    expect(diagnostic.vocabularyShape?.frequent.meaningful.count).toBeGreaterThan(0);
    expect(diagnostic.vocabularyShape?.keywords.meaningful.count).toBeGreaterThan(0);
    if (viewport.width >= 960) {
      expect(diagnostic.vocabularyShape?.layout).toBe("5+7");
      expect(diagnostic.vocabularyShape?.frequent.rect.width).toBeGreaterThan(0);
      expect(diagnostic.vocabularyShape?.keywords.rect.width).toBeGreaterThan(diagnostic.vocabularyShape?.frequent.rect.width ?? 0);
    }
    if (viewport.width >= 960) {
      expect(diagnostic.scaleMass.leftMeaningfulHeight).toBeGreaterThan(0);
      expect(diagnostic.scaleMass.rightMeaningfulHeight).toBeGreaterThan(0);
      expect(diagnostic.scaleMass.difference).toBeLessThanOrEqual(200);
    }
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

  await page.setViewportSize({ width: 1440, height: 900 });
  await captureElement(page, "#opening", "annual-opening-1440.png");
  await captureElement(page, "#scale-scene", "annual-scale-1440.png");
  await captureElement(page, "#rhythm-scene", "annual-rhythm-1440.png");
  await captureElement(page, "#peak-weekday", "annual-rhythm-weekday-1440.png");
  await captureElement(page, "#peak-hour", "annual-rhythm-hour-1440.png");
  await captureElement(page, "#balance-scene", "annual-balance-1440.png");

  await page.setViewportSize({ width: 1180, height: 760 });
  await captureElement(page, "#scale-scene", "annual-scale-1180.png");
  await captureElement(page, "#peak-month", "annual-rhythm-month-1180.png");
  await captureElement(page, ".v3-rhythm-beats", "annual-rhythm-pair-1180.png");
  await captureElement(page, "#balance-scene", "annual-balance-1180.png");
  await captureTransition(page, "#scale-scene", "#rhythm-scene", "annual-scale-rhythm-transition-1180.png");
  await captureTransition(page, "#rhythm-scene", "#balance-scene", "annual-rhythm-balance-transition-1180.png");

  await page.setViewportSize({ width: 760, height: 900 });
  await captureElement(page, "#scale-scene", "annual-scale-760.png");
  await captureElement(page, "#rhythm-scene", "annual-rhythm-760.png");
  await captureElement(page, "#peak-weekday", "annual-rhythm-weekday-760.png");
  await captureElement(page, "#peak-hour", "annual-rhythm-hour-760.png");

  await page.setViewportSize({ width: 380, height: 900 });
  await captureElement(page, "#scale-scene", "annual-scale-380.png");
  await captureElement(page, "#peak-month", "annual-rhythm-month-380.png");
  await captureElement(page, ".v3-rhythm-beats", "annual-rhythm-pair-380.png");
  await captureElement(page, "#peak-weekday", "annual-rhythm-weekday-380.png");
  await captureElement(page, "#peak-hour", "annual-rhythm-hour-380.png");

  // A 760px physical viewport at 200% browser zoom exposes 380 CSS px. Use
  // that layout viewport directly; CSS `zoom: 2` does not update media queries
  // and would incorrectly keep the Compact 3 + 5 composition active.
  await page.setViewportSize({ width: 380, height: 900 });
  await assertNoPageOverflow(page);
  await captureElement(page, "#scale-scene", "annual-scale-200-zoom.png");
  await captureElement(page, "#rhythm-scene", "annual-rhythm-200-zoom.png");

  await page.setViewportSize({ width: 1180, height: 760 });
  await openRangePanel(page);
  await page.getByLabel("回顾范围").selectOption("all-years");
  await expect(page.locator("#peak-month .v3-month-matrix-row")).toHaveCount(2);
  await captureElement(page, "#peak-month", "annual-rhythm-all-years-1180.png");
  await openRangePanel(page);
  await page.getByLabel("回顾范围").selectOption("year:2025");
  await expect(page.locator('#peak-month [data-partial="true"]')).toHaveCount(1);
  await captureElement(page, "#peak-month", "annual-rhythm-partial-1180.png");

  await page.goto("/?fixture=beta-annual-recap&sparse=1");
  await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
  await captureElement(page, "#rhythm-scene", "annual-rhythm-sparse-1180.png");

  writeFileSync(resolve(evidenceDir, "annual-geometry.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
});
