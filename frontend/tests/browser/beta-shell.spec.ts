import { expect, test } from "@playwright/test";

test("renders synthetic Detailed shell without result validation errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/?fixture=beta-detailed");
  await expect(page.getByTestId("beta-detailed-analysis-harness")).toBeVisible();
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute("href", "#beta-main-content");
  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
