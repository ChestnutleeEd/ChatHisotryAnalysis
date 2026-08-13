import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const evidenceDir = resolve(process.cwd(), "../output/playwright/v3-5");

async function assertNoPageOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.documentElement.clientWidth,
  ))).toBeLessThanOrEqual(0);
}

async function readHomeGeometry(page: Page) {
  return page.evaluate(() => {
    const home = document.querySelector<HTMLElement>(".v3-home-portal");
    const copy = document.querySelector<HTMLElement>(".v3-home-copy");
    const scope = document.querySelector<HTMLElement>(".v3-home-scope");
    const heading = document.querySelector<HTMLElement>(".v3-home-title");
    if (home === null || copy === null || scope === null || heading === null) {
      throw new Error("V35_HOME_GEOMETRY_TARGET_MISSING");
    }
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return {
        top: Math.round(box.top + window.scrollY),
        left: Math.round(box.left + window.scrollX),
        width: Math.round(box.width),
        height: Math.round(box.height),
        bottom: Math.round(box.bottom + window.scrollY),
      };
    };
    const controls = [...document.querySelectorAll<HTMLElement>("button, a, input, select, summary")]
      .filter((element) => !element.classList.contains("beta-skip-link"))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
      }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      zoom: getComputedStyle(document.documentElement).zoom,
      home: rect(home),
      copy: rect(copy),
      scope: rect(scope),
      heading: rect(heading),
      controls,
      overflow: {
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.documentElement.clientWidth,
      },
      background: getComputedStyle(home).backgroundColor,
    };
  });
}

test("records V3.5 Home geometry, screenshots, focus, and reduced-motion evidence", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const viewports = [
    { width: 1440, height: 900, name: "1440x900" },
    { width: 1180, height: 760, name: "1180x760" },
    { width: 760, height: 900, name: "760x900" },
    { width: 380, height: 900, name: "380x900" },
  ] as const;
  const geometry: Awaited<ReturnType<typeof readHomeGeometry>>[] = [];

  await page.goto("/?fixture=beta-home");
  await expect(page.locator(".v3-home-portal")).toBeVisible();
  await expect(page.getByRole("button", { name: "查看年度报告", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "进入详细分析", exact: true })).toBeVisible();
  await expect(page.locator(".v3-home-copy")).toHaveCSS("opacity", "1");
  await expect(page.locator(".v3-home-scope")).toHaveCSS("opacity", "1");

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await assertNoPageOverflow(page);
    const snapshot = await readHomeGeometry(page);
    geometry.push(snapshot);
    expect(snapshot.controls.every((control) => control.width >= 44 && control.height >= 44)).toBe(true);
    await page.screenshot({ path: resolve(evidenceDir, `home-${viewport.name}.png`) });
  }

  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await assertNoPageOverflow(page);
  const zoomed = await readHomeGeometry(page);
  geometry.push(zoomed);
  expect(zoomed.controls.every((control) => control.width >= 44 && control.height >= 44)).toBe(true);
  await page.screenshot({ path: resolve(evidenceDir, "home-200-percent.png") });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  await page.getByRole("button", { name: "进入详细分析", exact: true }).click();
  await expect(page.locator(".dashboard-panel-wrap")).toBeFocused();
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你的本地聊天回顾已经准备好", exact: true })).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".v3-home-copy")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".v3-home-scope")).toHaveCSS("animation-name", "none");

  writeFileSync(resolve(evidenceDir, "home-geometry.json"), `${JSON.stringify(geometry, null, 2)}\n`, "utf8");
  expect(consoleErrors).toEqual([]);
});

test("keeps Organic and Swiss shell authorities visibly distinct", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-home");
  const organic = await page.locator(".desktop-app").evaluate((element) => ({
    surface: element.getAttribute("data-v3-surface"),
    background: getComputedStyle(element).backgroundColor,
    active: getComputedStyle(element.querySelector(".beta-mode-home")!).color,
  }));

  await page.goto("/?fixture=beta-detailed");
  const swiss = await page.locator(".desktop-app").evaluate((element) => ({
    surface: element.getAttribute("data-v3-surface"),
    background: getComputedStyle(element).backgroundColor,
    active: getComputedStyle(element.querySelector(".beta-mode-segments button.is-current")!).color,
  }));

  expect(organic).toMatchObject({ surface: "home", background: "rgb(232, 220, 199)" });
  expect(swiss).toMatchObject({ surface: "detailed", background: "rgb(247, 247, 248)", active: "rgb(0, 47, 167)" });
  await assertNoPageOverflow(page);
});
