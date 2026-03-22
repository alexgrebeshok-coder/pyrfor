import { expect, test } from "@playwright/test";

test.describe("Поля и логистика", () => {
  test("shows tabs, map, and operational summary cards", async ({ page }) => {
    await page.goto("/field-operations");

    await expect(page.getByRole("heading", { level: 1, name: /поля и логистика/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /карта участков/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /api полевого контура/i })).toBeVisible();

    await expect(page.getByRole("tab", { name: "Карта" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Люди" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Техника" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Геозоны" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "События" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Фото и видео" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Все" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Площадки" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Геозоны" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Живые" })).toBeVisible();

    await page.getByRole("button", { name: "Площадки" }).click();
    await expect(page.getByRole("button", { name: "Площадки" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Живые" }).click();
    await expect(page.getByRole("button", { name: "Живые" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("tab", { name: "Люди" }).click();
    await expect(page.getByRole("heading", { name: /люди и покрытие/i })).toBeVisible();

    await page.getByRole("tab", { name: "Техника" }).click();
    await expect(page.getByRole("heading", { name: /сводка телеметрии/i })).toBeVisible();

    await page.getByRole("tab", { name: "Геозоны" }).click();
    await expect(page.getByRole("heading", { name: /геозоны/i })).toBeVisible();

    await page.getByRole("tab", { name: "События" }).click();
    await expect(page.getByRole("heading", { name: /события поля/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /разрывы телеметрии/i })).toBeVisible();

    await page.getByRole("tab", { name: "Фото и видео" }).click();
    await expect(page.getByRole("heading", { name: /сводка визуальных фактов/i })).toBeVisible();
  });
});
