import { expect, test } from "@playwright/test";

test.describe("Portfolio cockpit", () => {
  test("renders executive cockpit sections", async ({ page }) => {
    await page.goto("/portfolio");

    await expect(page.getByTestId("portfolio-page")).toBeVisible();
    await expect(page.getByTestId("portfolio-forecast")).toBeVisible();
    await expect(page.getByTestId("portfolio-forecast-finance")).toBeVisible();
    await expect(page.getByTestId("portfolio-forecast-capacity")).toBeVisible();
    await expect(page.getByTestId("portfolio-scenarios")).toBeVisible();
    await expect(page.getByTestId("portfolio-scenario-finance")).toBeVisible();
    await expect(page.getByTestId("portfolio-scenario-capacity")).toBeVisible();
    await expect(page.getByTestId("portfolio-goals")).toBeVisible();
    await expect(page.getByTestId("portfolio-finance")).toBeVisible();
    await expect(page.getByTestId("portfolio-finance-summary")).toBeVisible();
    await expect(page.getByTestId("portfolio-resources")).toBeVisible();
    await expect(page.getByTestId("portfolio-timeline")).toBeVisible();
    await expect(page.getByTestId("portfolio-risks")).toBeVisible();
    await expect(page.getByRole("heading", { name: /progress vs budget|прогресс и бюджет|进度与预算/i })).toBeVisible();
    await expect(page.getByTestId("portfolio-actions").getByRole("link", { name: /центр исключений|command center|指挥中心/i })).toBeVisible();
    await expect(page.getByTestId("portfolio-actions").getByRole("link", { name: /сводки|briefs|简报/i })).toBeVisible();
  });

  test("dashboard quick action opens the portfolio cockpit", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /открыть портфель|open portfolio/i }).click();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/\/portfolio/);
    await expect(page.getByTestId("portfolio-page")).toBeVisible();
  });
});
