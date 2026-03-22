import { test, expect } from '@playwright/test';

/**
 * Smoke Tests for CEOClaw Dashboard
 * 
 * Эти тесты проверяют критические маршруты и базовую функциональность.
 */

test.describe('Smoke Tests - Критические маршруты', () => {
  
  test.describe('Аутентификация', () => {
    test('Страница входа загружается', async ({ page }) => {
      await page.goto('/login');
      
      // Проверяем title (CEOClaw без пробела)
      await expect(page).toHaveTitle(/CEOClaw/);
      
      // Ждём загрузки страницы
      await page.waitForLoadState('networkidle');
      
      // Проверяем, что страница видна
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('Dashboard (Главная)', () => {
    test('Dashboard загружается успешно', async ({ page }) => {
      await page.goto('/');
      
      // Проверяем title
      await expect(page).toHaveTitle(/CEOClaw/);
      
      // Ждём загрузки
      await page.waitForLoadState('networkidle');
      
      // Проверяем наличие заголовка h1
      const heading = page.locator('h1');
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('Dashboard показывает навигацию', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Проверяем наличие ссылок навигации
      const navLinks = page.locator('a[href*="/projects"], a[href*="/tasks"], a[href*="/analytics"]');
      const count = await navLinks.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Страница Проекты', () => {
    test('Страница проектов загружается', async ({ page }) => {
      await page.goto('/projects');
      
      // Ждём загрузки
      await page.waitForLoadState('networkidle');
      
      // Проверяем заголовок (Русский: "Проекты")
      const heading = page.locator('h1');
      await expect(heading).toContainText(/Проекты|Projects/i, { timeout: 10000 });
    });

    test('Страница проектов показывает контент', async ({ page }) => {
      await page.goto('/projects');
      await page.waitForLoadState('networkidle');
      
      // Проверяем наличие body (контент может быть в любом элементе)
      const body = page.locator('body');
      await expect(body).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Страница Задачи', () => {
    test('Страница задач загружается', async ({ page }) => {
      await page.goto('/tasks');
      
      // Ждём загрузки
      await page.waitForLoadState('networkidle');
      
      // Проверяем заголовок (Русский: "Задачи")
      const heading = page.locator('h1');
      await expect(heading).toContainText(/Задачи|Tasks/i, { timeout: 10000 });
    });

    test('Страница задач показывает контент', async ({ page }) => {
      await page.goto('/tasks');
      await page.waitForLoadState('networkidle');
      
      // Проверяем наличие body
      const body = page.locator('body');
      await expect(body).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Оболочка приложения', () => {
    test('Тема применяется корректно', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Проверяем, что тема применена (по умолчанию dark)
      const htmlElement = page.locator('html');
      const theme = await htmlElement.getAttribute('data-theme');
      
      // Тема должна быть 'dark' или 'light'
      expect(theme).toMatch(/^(dark|light)$/);
    });

    test('Локаль установлена корректно', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Проверяем, что локаль установлена (по умолчанию русский)
      const htmlElement = page.locator('html');
      const lang = await htmlElement.getAttribute('lang');
      
      // Язык должен быть установлен
      expect(lang).toBeTruthy();
      expect(['ru', 'en', 'zh-CN']).toContain(lang);
    });
  });
});
