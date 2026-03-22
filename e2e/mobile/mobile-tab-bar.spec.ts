import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
});

test.describe("Mobile tab bar", () => {
  test("shows the phone nav and opens the drawer", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");

    const nav = page.locator('nav[aria-label="Primary mobile"]');
    await expect(nav).toBeVisible({ timeout: 10000 });
    await expect(nav.locator('a[href="/projects"]')).toBeVisible();

    await page.getByLabel(/Ещё|More|更多/).click();
    await expect(page.getByLabel("Close navigation")).toBeVisible({ timeout: 10000 });
  });

  test("navigates between primary mobile sections", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");

    await Promise.all([
      page.waitForURL(/\/chat$/),
      page.locator('nav[aria-label="Primary mobile"] a[href="/chat"]').click({ force: true }),
    ]);

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator("main h2").filter({ hasText: /^ИИ-чат$/i })).toBeVisible({ timeout: 10000 });
  });
});
