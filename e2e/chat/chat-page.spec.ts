import { expect, test } from "@playwright/test";

test.describe("AI chat cockpit", () => {
  test("shows the redesigned left rail and quick launches", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("main h2").filter({ hasText: /^ИИ-чат$/i })).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#chat-sidebar-panel")).toBeVisible();
    await expect(page.getByLabel(/Поиск агентов|Search agents/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Новый чат$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Портфельный бриф/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Статус бюджета/i }).first()).toBeVisible();
  });
});
