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
      const evidence = document.querySelector<HTMLElement>('[data-v3-geometry-cell="scale-evidence"]');
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

    await expect(page.locator("#peak-month .v3-month-matrix-row ol li")).toHaveCount(12);
    await expect(page.locator("#peak-weekday .v3-weekday-beats > ol > li")).toHaveCount(7);
    await expect(page.locator("#peak-hour .v3-hour-pulse > ol > li")).toHaveCount(24);
    await expect(page.locator("#sender-share .v3-role-band-legend li")).toHaveCount(2);
    await expect(page.locator("#sender-share .v3-role-band-legend")).toContainText("Owner");
    await expect(page.locator("#sender-share .v3-role-band-legend")).toContainText("Other");
    await expect(page.locator("#sessions .v3-role-band-legend")).toContainText("Unknown");
    await expect(page.locator("#replies .v3-reply-evidence")).toContainText("Owner → Other");
    await expect(page.locator(".v3-conversation-connector")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".v3-visual-details:not([open])")).toHaveCount(9);
    await expect(page.locator(".beta-report-core .beta-v2-scale-grid, .beta-report-core .beta-v2-rhythm, .beta-report-core .beta-v2-balance-grid, .beta-report-core .beta-v2-conversation-grid")).toHaveCount(0);

    const rangeToggle = page.getByRole("button", { name: "范围与章节", exact: true });
    await rangeToggle.focus();
    await expect.poll(() => rangeToggle.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
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

  test("settles the same V3.2 scenes immediately under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.getByTestId("beta-annual-recap-harness")).toBeVisible();
    await expect(page.locator("[data-v3-scene][data-motion-state='complete']")).toHaveCount(7);
    const animationNames = await page.locator(".v3-annual-report [data-v3-scene]").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
    expect(new Set(animationNames)).toEqual(new Set(["none"]));
    await expect(page.locator(".v3-weekday-beats .v3-beat-mark").first()).toHaveCSS("transform", /matrix/);
    await expect.poll(() => page.evaluate(() => Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.documentElement.clientWidth,
    ))).toBeLessThanOrEqual(0);
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
    await expect(page.locator("#peak-month .v3-month-matrix-row ol li")).toHaveCount(12);
  });
});
