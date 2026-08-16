import { expect, test, type Page } from "@playwright/test";

type AnnualGeometry = {
  root: { clientWidth: number; scrollWidth: number };
  containerType: string;
  containerName: string;
  viewportMediaNarrow: boolean;
  rhythm: {
    weekday: { clientWidth: number; gridColumn: string };
    hour: { clientWidth: number; gridColumn: string };
  };
  vocabulary: {
    controls: Array<{ clientWidth: number; clientHeight: number }>;
    frequent: { clientWidth: number; gridColumn: string };
    keywords: { clientWidth: number; gridColumn: string };
    cloud: { clientWidth: number; gridColumn: string };
  };
  closing: {
    gridTracks: number;
    copy: { clientWidth: number; top: number; bottom: number };
    art: { clientWidth: number; top: number };
    poster: { clientWidth: number; clientHeight: number };
    cta: { clientWidth: number; height: number };
    copyBeforeArt: boolean;
  };
  pageOverflow: number;
};

async function readAnnualGeometry(page: Page) {
  return page.evaluate((): AnnualGeometry => {
    const root = document.querySelector<HTMLElement>(".v3-annual-report");
    const weekday = document.querySelector<HTMLElement>(".v3-rhythm-weekday");
    const hour = document.querySelector<HTMLElement>(".v3-rhythm-hour");
    const frequent = document.querySelector<HTMLElement>(".v3-frequent-ledger");
    const keywords = document.querySelector<HTMLElement>(".v3-keyword-field");
    const cloud = document.querySelector<HTMLElement>(".v3-word-cloud-stage");
    const controlStrip = document.querySelector<HTMLElement>(
      ".v3-vocabulary-control-strip",
    );
    const closing = document.querySelector<HTMLElement>(".beta-closing-scene");
    const copy = document.querySelector<HTMLElement>(".beta-closing-copy");
    const art = document.querySelector<HTMLElement>(".beta-closing-art");
    const poster = document.querySelector<HTMLElement>(".beta-closing-poster");
    const cta = document.querySelector<HTMLElement>(".beta-closing-copy > .beta-button");

    if (
      !root ||
      !weekday ||
      !hour ||
      !frequent ||
      !keywords ||
      !cloud ||
      !controlStrip ||
      !closing ||
      !copy ||
      !art ||
      !poster ||
      !cta
    ) {
      throw new Error("Annual geometry fixture is incomplete");
    }

    const rect = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        top: bounds.top,
        bottom: bounds.bottom,
      };
    };

    return {
      root: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth },
      containerType: getComputedStyle(root).containerType,
      containerName: getComputedStyle(root).containerName,
      viewportMediaNarrow: matchMedia("(max-width: 599px)").matches,
      rhythm: {
        weekday: {
          clientWidth: weekday.clientWidth,
          gridColumn: getComputedStyle(weekday).gridColumn,
        },
        hour: {
          clientWidth: hour.clientWidth,
          gridColumn: getComputedStyle(hour).gridColumn,
        },
      },
      vocabulary: {
        controls: Array.from(controlStrip.querySelectorAll<HTMLElement>("label"))
          .filter((element) => element.offsetParent !== null)
          .map((element) => ({
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
          })),
        frequent: {
          clientWidth: frequent.clientWidth,
          gridColumn: getComputedStyle(frequent).gridColumn,
        },
        keywords: {
          clientWidth: keywords.clientWidth,
          gridColumn: getComputedStyle(keywords).gridColumn,
        },
        cloud: {
          clientWidth: cloud.clientWidth,
          gridColumn: getComputedStyle(cloud).gridColumn,
        },
      },
      closing: {
        gridTracks: getComputedStyle(closing).gridTemplateColumns
          .trim()
          .split(/\s+/u).length,
        copy: rect(copy),
        art: rect(art),
        poster: rect(poster),
        cta: {
          clientWidth: cta.clientWidth,
          height: cta.getBoundingClientRect().height,
        },
        copyBeforeArt: Boolean(
          copy.compareDocumentPosition(art) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      },
      pageOverflow: Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      ),
    };
  });
}

test.describe("approved V3.6 bounded remediation", () => {
  test("F-01 stacks Annual by effective width under true zoom", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.locator(".v3-annual-report")).toBeVisible();
    await expect(page.locator(".v3-word-cloud-stage canvas")).toHaveAttribute(
      "data-layout-state",
      "ready",
      { timeout: 15_000 },
    );

    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });

    await expect
      .poll(() => readAnnualGeometry(page))
      .toMatchObject({
        containerType: "inline-size",
        containerName: "annual-workspace",
        viewportMediaNarrow: false,
        rhythm: {
          weekday: { gridColumn: "1 / -1" },
          hour: { gridColumn: "1 / -1" },
        },
        vocabulary: {
          frequent: { gridColumn: "1 / -1" },
          keywords: { gridColumn: "1 / -1" },
        },
        closing: { gridTracks: 1, copyBeforeArt: true },
      });

    const geometry = await readAnnualGeometry(page);
    expect(geometry.root.clientWidth).toBeLessThan(599);
    expect(geometry.rhythm.weekday.clientWidth).toBeGreaterThanOrEqual(
      geometry.root.clientWidth * 0.8,
    );
    expect(geometry.rhythm.hour.clientWidth).toBeGreaterThanOrEqual(
      geometry.root.clientWidth * 0.8,
    );
    expect(geometry.vocabulary.frequent.clientWidth).toBeGreaterThanOrEqual(
      geometry.root.clientWidth * 0.8,
    );
    expect(geometry.vocabulary.keywords.clientWidth).toBeGreaterThanOrEqual(
      geometry.root.clientWidth * 0.8,
    );
    expect(geometry.vocabulary.cloud.clientWidth).toBeGreaterThanOrEqual(
      geometry.root.clientWidth * 0.8,
    );
    expect(geometry.vocabulary.controls.length).toBeGreaterThan(0);
    for (const control of geometry.vocabulary.controls) {
      expect(control.clientWidth).toBeGreaterThanOrEqual(44);
      expect(control.clientHeight).toBeGreaterThanOrEqual(44);
    }
    expect(geometry.closing.copy.clientWidth).toBeGreaterThanOrEqual(
      geometry.root.clientWidth * 0.8,
    );
    expect(geometry.closing.art.clientWidth).toBeGreaterThanOrEqual(
      geometry.root.clientWidth * 0.8,
    );
    expect(geometry.closing.art.top).toBeGreaterThan(geometry.closing.copy.bottom);
    expect(geometry.closing.poster.clientWidth).toBeGreaterThan(0);
    expect(geometry.closing.poster.clientWidth).toBeLessThanOrEqual(
      geometry.closing.art.clientWidth,
    );
    expect(geometry.closing.cta.clientWidth).toBeGreaterThanOrEqual(44);
    expect(geometry.closing.cta.height).toBeGreaterThanOrEqual(44);
    expect(geometry.pageOverflow).toBeLessThanOrEqual(0);
  });

  test("F-01 keeps Annual smoke layouts usable at the required viewports", async ({
    page,
  }) => {
    await page.goto("/?fixture=beta-annual-recap");
    await expect(page.locator(".v3-annual-report")).toBeVisible();

    for (const viewport of [
      { width: 1180, height: 900 },
      { width: 760, height: 900 },
      { width: 380, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator(".v3-opening-grid")).toBeVisible();
      await expect(page.locator(".v3-rhythm-beats")).toBeVisible();
      await expect(page.locator(".v3-vocabulary-stage")).toBeVisible();
      await expect(page.locator(".beta-closing-scene")).toBeVisible();

      const geometry = await readAnnualGeometry(page);
      expect(geometry.root.clientWidth).toBeGreaterThan(0);
      expect(geometry.pageOverflow).toBeLessThanOrEqual(0);
    }
  });

  test("F-02 retains the Detailed year draft across route switches", async ({
    page,
  }) => {
    await page.goto("/?fixture=beta-detailed");
    await page.getByRole("tab", { name: "词汇与年份" }).click();

    const year = page.locator("#dashboard-year");
    const applyYear = page.getByRole("button", { name: "应用年度" });
    const committedYear = page.locator(".dashboard-context-register dd").nth(1);
    await expect(year).toHaveValue("");
    await expect(committedYear).toHaveText("全部");

    await year.selectOption("2025");
    await expect(year).toHaveValue("2025");
    await expect(applyYear).toBeEnabled();
    await expect(committedYear).toHaveText("全部");

    await page.getByRole("tab", { name: "概览" }).click();
    await page.getByRole("tab", { name: "词汇与年份" }).click();
    await expect(year).toHaveValue("2025");
    await expect(committedYear).toHaveText("全部");

    await applyYear.click();
    await expect(committedYear).toHaveText("2025");
    await expect(applyYear).toBeDisabled();
  });
});
