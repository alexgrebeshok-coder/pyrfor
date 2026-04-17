import { expect, test } from "@playwright/test";

test.describe("AI chat cockpit", () => {
  test("shows the redesigned left rail and quick launches", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator("#chat-sidebar-panel");

    await expect(sidebar).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel(/Поиск агентов|Search agents/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Новый чат$/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Портфельный бриф/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Статус бюджета/i }).first()).toBeVisible();
  });
});
