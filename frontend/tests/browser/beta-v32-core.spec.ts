import { expect, test, type Page } from "@playwright/test";

async function openRangePanel(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "范围与章节", exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(page.locator("#annual-range-controls")).toBeVisible();
}

test.describe("V3.2 Annual core story contracts", () => {
  test("keeps the five core scenes in their frozen compositions with exact alternatives", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();

    const composition = await page.evaluate(() => {
      const primary = document.querySelector<HTMLElement>('[data-v3-geometry-cell="scale-primary"]');
      const evidence = document.querySelector<HTMLElement>('[data-v3-geometry-cell="scale-context"]');
      const roleBand = document.querySelector<HTMLElement>(".v3-role-band-track");
      return {
        scaleRatio: primary === null || evidence === null
          ? null
          : primary.getBoundingClientRect().width / evidence.getBoundingClientRect().width,
        roleBandHeight: roleBand?.getBoundingClientRect().height ?? 0,
        scaleColumns: primary === null ? "" : getComputedStyle(primary).gridColumn,
        evidenceColumns: evidence === null ? "" : getComputedStyle(evidence).gridColumn,
      };
    });
    expect(composition.scaleRatio).not.toBeNull();
    expect(composition.scaleRatio ?? 0).toBeGreaterThan(.95);
    expect(composition.scaleRatio ?? 0).toBeLessThan(1.65);
    expect(composition.scaleColumns).toContain("span 7");
    expect(composition.evidenceColumns).toContain("8");
    expect(composition.roleBandHeight).toBeGreaterThan(0);

    const scaleMass = await page.evaluate(() => {
      const left = document.querySelector<HTMLElement>('[data-v3-geometry-cell="scale-primary"]');
      const right = document.querySelector<HTMLElement>('[data-v3-geometry-cell="scale-context"]');
      const lowerBand = document.querySelector<HTMLElement>('[data-v3-geometry-cell="scale-activity-band"]');
      return {
        left: left?.getBoundingClientRect().height ?? 0,
        right: right?.getBoundingClientRect().height ?? 0,
        lowerBand: lowerBand?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(scaleMass.left).toBeGreaterThan(0);
    expect(scaleMass.right).toBeGreaterThan(0);
    expect(scaleMass.lowerBand).toBeGreaterThan(0);
    expect(Math.abs(scaleMass.left - scaleMass.right)).toBeLessThanOrEqual(200);

    await expect(page.locator('[data-rhythm-visual="month-cadence"] [data-cadence-cell]')).toHaveCount(12);
    await expect(page.locator('[data-rhythm-visual="weekday-beat"] [data-beat-marker]')).toHaveCount(7);
    await expect(page.locator('[data-rhythm-visual="hour-pulse"] [data-pulse-marker]')).toHaveCount(24);
    await expect(page.locator('[data-rhythm-visual="weekday-beat"] [data-beat-seal]')).toHaveCount(7);
    await expect(page.locator('[data-rhythm-visual="hour-pulse"] [data-hour-aperture]')).toHaveCount(24);
    await expect(page.locator('.v3-beat-stem, .v3-pulse-stem')).toHaveCount(0);
    await expect(page.locator('[data-rhythm-visual="weekday-beat"] line, [data-rhythm-visual="hour-pulse"] line')).toHaveCount(0);
    await expect(page.locator('[data-rhythm-visual="hour-pulse"] [data-hour-anchor]')).toHaveCount(5);
    await expect(page.locator('[data-rhythm-visual="weekday-beat"] [data-peak="true"]')).toHaveCount(2);
    await expect(page.locator('[data-rhythm-visual="hour-pulse"] [data-peak="true"]')).toHaveCount(2);
    await expect(page.locator('[data-rhythm-visual] svg:not([aria-hidden="true"])')).toHaveCount(0);
    await expect(page.locator('[data-rhythm-visual] svg:not([role="presentation"])')).toHaveCount(0);
    await expect(page.locator(".v3-month-cell-fill, .v3-beat-mark, .v3-hour-pulse-mark")).toHaveCount(0);
    await expect(page.locator("#rhythm-scene .v3-rhythm-evidence-zone")).toHaveCount(1);
    await expect(page.locator("#rhythm-scene .v3-rhythm-evidence-zone table")).toHaveCount(3);
    await expect(page.locator("#sender-share .v3-role-band-legend li")).toHaveCount(2);
    await expect(page.locator("#sender-share .v3-role-band-legend")).toContainText("Owner");
    await expect(page.locator("#sender-share .v3-role-band-legend")).toContainText("Other");
    await expect(page.locator("#sessions .v3-role-band-legend")).toContainText("Unknown");
    await expect(page.locator("#replies .v3-reply-evidence")).toContainText("Owner → Other");
    await expect(page.locator(".v3-conversation-connector")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".v3-visual-details:not([open])")).toHaveCount(7);
    await expect(page.locator(".beta-report-core .beta-v2-scale-grid, .beta-report-core .beta-v2-rhythm, .beta-report-core .beta-v2-balance-grid, .beta-report-core .beta-v2-conversation-grid")).toHaveCount(0);

    const registerGeometry = await page.evaluate(() => {
      const boxes = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
        .map((element) => element.getBoundingClientRect());
      const sealBoxes = boxes("[data-beat-seal]");
      const apertureBoxes = boxes("[data-hour-aperture]");
      const apertureCenters = apertureBoxes.map((box) => box.top + box.height / 2);
      return {
        sealWidths: [...new Set(sealBoxes.map((box) => Math.round(box.width)))],
        sealHeights: [...new Set(sealBoxes.map((box) => Math.round(box.height)))],
        apertureWidths: [...new Set(apertureBoxes.map((box) => Math.round(box.width)))],
        apertureHeights: [...new Set(apertureBoxes.map((box) => Math.round(box.height)))],
        apertureCenterSpread: Math.max(...apertureCenters) - Math.min(...apertureCenters),
      };
    });
    expect(registerGeometry.sealWidths).toEqual([58]);
    expect(registerGeometry.sealHeights).toEqual([58]);
    expect(registerGeometry.apertureWidths).toEqual([22]);
    expect(registerGeometry.apertureHeights).toEqual([22]);
    expect(registerGeometry.apertureCenterSpread).toBeLessThanOrEqual(1);

    const rangeToggle = page.getByRole("button", { name: "范围与章节", exact: true });
    await rangeToggle.focus();
    await expect.poll(() => rangeToggle.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  });

  test("keeps the compact Rhythm field at the frozen 3 + 5 composition", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const weekday = document.querySelector<HTMLElement>('[data-v3-geometry-cell="rhythm-weekday"]');
      const hour = document.querySelector<HTMLElement>('[data-v3-geometry-cell="rhythm-hour"]');
      if (weekday === null || hour === null) {
        throw new Error("RHYTHM_COMPACT_GEOMETRY_MISSING");
      }
      const weekdayBox = weekday.getBoundingClientRect();
      const hourBox = hour.getBoundingClientRect();
      const sealList = document.querySelector<HTMLElement>(".v3-weekday-seal-list");
      const registerList = document.querySelector<HTMLElement>(".v3-hour-register-list");
      const apertureRows = [...document.querySelectorAll<HTMLElement>("[data-hour-aperture]")]
        .reduce<Record<string, number>>((rows, aperture) => {
          const box = aperture.getBoundingClientRect();
          const center = String(Math.round(box.top + box.height / 2));
          rows[center] = (rows[center] ?? 0) + 1;
          return rows;
        }, {});
      return {
        weekdayColumn: getComputedStyle(weekday).gridColumn,
        hourColumn: getComputedStyle(hour).gridColumn,
        widthRatio: weekdayBox.width / hourBox.width,
        topDelta: Math.abs(weekdayBox.top - hourBox.top),
        sealColumns: sealList === null ? 0 : getComputedStyle(sealList).gridTemplateColumns.split(" ").length,
        registerColumns: registerList === null ? 0 : getComputedStyle(registerList).gridTemplateColumns.split(" ").length,
        apertureRowSizes: Object.values(apertureRows),
      };
    });
    expect(geometry.weekdayColumn).toContain("span 3");
    expect(geometry.hourColumn).toContain("4");
    expect(geometry.widthRatio).toBeGreaterThan(.5);
    expect(geometry.widthRatio).toBeLessThan(.75);
    expect(geometry.topDelta).toBeLessThanOrEqual(2);
    expect(geometry.sealColumns).toBe(4);
    expect(geometry.registerColumns).toBe(12);
    expect(geometry.apertureRowSizes).toEqual([12, 12]);
  });

  test("renders one 12-cell month row per represented year in all-years mode", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
    await openRangePanel(page);
    await page.getByLabel("回顾范围").selectOption("all-years");
    await expect(page.locator("#beta-report-heading")).toHaveText("2024–2025");
    await expect(page.locator("#messages")).toContainText("2,072");
    await expect(page.locator("#peak-month .v3-month-matrix-row")).toHaveCount(2);
    for (const row of await page.locator("#peak-month .v3-month-matrix-row").all()) {
      await expect(row.locator("ol > li")).toHaveCount(12);
    }
  });

  test("keeps core scope facts synchronized through all → 2024 → 2025 → all", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
    await openRangePanel(page);
    const range = page.getByLabel("回顾范围");

    await range.selectOption("all-years");
    await expect(page.locator("#messages")).toContainText("2,072");
    await expect(page.locator("#peak-month .v3-month-matrix-row")).toHaveCount(2);

    await range.selectOption("year:2024");
    await expect(page.locator("#messages")).toContainText("824");
    await expect(page.locator("#peak-month .v3-month-matrix-row")).toHaveCount(1);

    await range.selectOption("year:2025");
    await expect(page.locator("#messages")).toContainText("1,248");
    await expect(page.locator("#active-days")).toContainText("112");
    await expect(page.locator("#longest-streak")).toContainText("14");
    await expect(page.locator("#sender-share")).toContainText("Owner");
    await expect(page.locator("#sender-share")).toContainText("720 条");

    await range.selectOption("all-years");
    await expect(page.locator("#messages")).toContainText("2,072");
    await expect(page.locator("#peak-month .v3-month-matrix-row")).toHaveCount(2);
    await expect(page.locator("#sender-share")).toContainText("720 条");
  });

  test("settles the same V3.2 scenes immediately under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
    await expect(page.locator("[data-v3-scene][data-motion-state='complete']")).toHaveCount(7);
    const animationNames = await page.locator(".v3-annual-report [data-v3-scene]").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
    expect(new Set(animationNames)).toEqual(new Set(["none"]));
    await expect(page.locator('[data-rhythm-visual="weekday-beat"] [data-beat-marker]').first()).toHaveCSS("transform", "none");
    await expect.poll(() => page.evaluate(() => Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.documentElement.clientWidth,
    ))).toBeLessThanOrEqual(0);
  });

  test("reveals the three rhythm grammars once without layout movement or replay", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();

    const rhythm = page.locator("#rhythm-scene");
    await expect(rhythm).toHaveAttribute("data-motion-state", "idle");
    const before = await rhythm.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      scrollHeight: document.documentElement.scrollHeight,
      markerOpacity: getComputedStyle(element.querySelector(".v3-cadence-mark")!).opacity,
    }));
    expect(before.markerOpacity).toBe("1");

    await rhythm.scrollIntoViewIfNeeded();
    await expect(rhythm).toHaveAttribute("data-motion-state", "entering");
    const animations = await rhythm.evaluate((element) => element.getAnimations({ subtree: true }).map((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return {
        name: animation instanceof CSSAnimation ? animation.animationName : "",
        endTime: typeof timing?.endTime === "number" ? timing.endTime : 0,
      };
    }));
    expect(animations.map((animation) => animation.name)).toEqual(expect.arrayContaining([
      "v3-cadence-reveal",
      "v3-beat-activate",
      "v3-pulse-point-reveal",
    ]));
    expect(Math.max(...animations.map((animation) => animation.endTime))).toBeLessThanOrEqual(700);

    await expect(rhythm).toHaveAttribute("data-motion-state", "complete");
    const after = await rhythm.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    expect(after.scrollHeight).toBe(before.scrollHeight);

    await page.locator("#opening").scrollIntoViewIfNeeded();
    await rhythm.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await expect(rhythm).toHaveAttribute("data-motion-state", "complete");
    expect(await rhythm.evaluate((element) => element.getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running").length)).toBe(0);
  });

  test("keeps sparse synthetic facts legible without manufacturing counterpart data", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?fixture=beta-annual-recap&sparse=1");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
    await expect(page.locator("#messages")).toContainText("当前范围没有可回顾的用户消息");
    await expect(page.locator("#active-days")).toContainText("这一范围内有 0 个聊天日");
    await expect(page.locator("#message-length")).toContainText("没有足够的合资格文字消息样本");
    await expect(page.locator("#message-types")).toContainText("没有可展示的用户消息类型分布");
    await expect(page.locator("#sender-share .v3-role-band-segment")).toHaveCount(2);
    await expect(page.locator("#sender-share .v3-role-band-track")).toBeVisible();
    await expect(page.locator('#peak-month [data-cadence-cell]')).toHaveCount(12);
  });
});
