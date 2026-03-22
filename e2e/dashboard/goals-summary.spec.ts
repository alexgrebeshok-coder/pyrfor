import { expect, test } from "@playwright/test";

test.describe("Dashboard goals summary", () => {
  test("shows goal rollups and opens the goals screen", async ({ page }) => {
    await page.goto("/");

    const goalsCard = page.getByTestId("dashboard-goals");

    await expect(goalsCard).toBeVisible({ timeout: 15000 });
    await expect(goalsCard.getByRole("heading", { name: /цели и фокус/i })).toBeVisible();
    await expect(goalsCard.getByRole("link", { name: /^цели$/i })).toBeVisible();

    await goalsCard.getByRole("link", { name: /^цели$/i }).click();
    await expect(page).toHaveURL(/\/goals/);
    await expect(page.getByTestId("goals-page")).toBeVisible();
  });
});
