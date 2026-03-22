import { test, expect } from "@playwright/test";

test.describe("Документы", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
  });

  test("shows folders, document list, and preview", async ({ page }) => {
    await expect(page.locator('[data-testid="documents-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="documents-tree"]')).toBeVisible();
    await expect(page.locator('[data-testid="documents-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="documents-preview"]')).toBeVisible();

    await page.locator('[data-testid="documents-folder-normative"]').click();
    await page.locator('[data-testid="documents-folder-normative-finance"]').click();
    await expect(page.locator('[data-testid="documents-item"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="documents-list"]')).toContainText("EVM");

    const firstDocument = page.locator('[data-testid="documents-item"]').first();
    await firstDocument.click();

    await expect(page.locator('[data-testid="documents-preview"]')).toContainText(/Источник|source/i);
  });
});
