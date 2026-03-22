import { expect, test } from "@playwright/test";

test.describe("Цели и OKR", () => {
  test("shows portfolio goals and linked project objectives", async ({ page }) => {
    await page.goto("/goals");

    const goalsPage = page.getByTestId("goals-page");

    await expect(goalsPage).toBeVisible({ timeout: 15000 });
    await expect(goalsPage.getByRole("heading", { name: /цели и ключевые результаты/i })).toBeVisible();
    await expect(goalsPage.getByText(/целей и ключевых результатов \(okr\)/i)).toBeVisible();
    await expect(goalsPage.getByTestId("goal-priority")).toBeVisible();
    await expect(goalsPage.getByRole("heading", { name: /приоритет внимания/i })).toBeVisible();
    await expect(goalsPage.getByRole("heading", { name: "Ключевые результаты", exact: true })).toBeVisible();
    await expect(goalsPage.getByText(/целевой уровень/i).first()).toBeVisible();
    await expect(goalsPage.getByRole("heading", { name: /защитить ритм поставки/i })).toBeVisible();
    await expect(goalsPage.getByRole("heading", { name: /проекты и цели/i })).toBeVisible();
    await expect(goalsPage.getByRole("link", { name: /открыть портфель/i }).first()).toBeVisible();

    const firstObjectiveFilter = goalsPage.getByTestId("objective-filter-first");
    if (await firstObjectiveFilter.count()) {
      await expect(firstObjectiveFilter).toBeVisible();
      await firstObjectiveFilter.click();
      await expect(goalsPage.getByTestId("active-objective-filter")).toBeVisible();

      await goalsPage.getByRole("button", { name: /^Все цели$/i }).click();
      await expect(goalsPage.getByTestId("active-objective-filter")).toHaveCount(0);
    } else {
      await expect(goalsPage.getByTestId("objective-filters-empty")).toBeVisible();
    }
  });
});
