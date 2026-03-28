import { expect, test } from "@playwright/test";

test.describe("Центр загрузок", () => {
  test("shows install paths for web, desktop, and iPhone", async ({ page }) => {
    await page.goto("/release");

    await expect(page.getByRole("heading", { name: /установите ceoclaw в любом месте|install ceoclaw anywhere/i })).toBeVisible();
    await expect(page.getByText(/одна живая продуктовая основа и три способа доставки|one live product core, three delivery surfaces/i)).toBeVisible();
    await expect(page.getByText(/готово \d\/3/i)).toBeVisible();
    await expect(page.getByText(/живой веб|локальный preview|нужен публичный url/i).first()).toBeVisible();
    await expect(page.getByText(/готово к загрузке|нужна ссылка/i).first()).toBeVisible();
    await expect(page.getByText(/testflight готов|app store готов|нужна ссылка на testflight/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /размещённое веб-приложение|hosted web app/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /приложение для macos|macos desktop app/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /приложение для iphone|iphone app/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /текущий блокер|current blocker/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /статус распространения|distribution status/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /открыть веб-версию|open web version/i })).toBeVisible();
    await expect(page.locator("#web").getByRole("link", { name: /открыть веб-приложение|open web app/i })).toBeVisible();
  });
});
