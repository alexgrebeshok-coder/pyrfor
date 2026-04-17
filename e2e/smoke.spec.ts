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
      
      // Проверяем title (в app metadata используется CEO Claw с пробелом)
      await expect(page).toHaveTitle(/CEO ?Claw/i);
      
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
      
      // Проверяем, что основной dashboard surface отрисован
      const dashboardMap = page.getByTestId('dashboard-map').last();
      await expect(dashboardMap).toBeVisible({ timeout: 10000 });
      await expect(dashboardMap).toContainText(/Карта и логистика/i);
      await expect(dashboardMap).toContainText(/Активные контуры/i);
      await expect(dashboardMap).toContainText(/Открыть карту/i);
    });

    test('Dashboard показывает навигацию', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      const navigation = page.getByRole('navigation', { name: /main navigation/i });
      await expect(navigation).toBeVisible({ timeout: 10000 });

      const navLinks = navigation.locator('a');
      const count = await navLinks.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Страница Проекты', () => {
    test('Страница проектов загружается', async ({ page }) => {
      await page.goto('/projects');
      
      // Ждём загрузки
      await page.waitForLoadState('networkidle');
      
      await expect(page.getByTestId('projects-page')).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('heading', { name: /Портфель проектов|Portfolio View/i })).toBeVisible({
        timeout: 10000,
      });
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
      
      await expect(page.getByTestId('tasks-page')).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('heading', { name: /Таблица задач|Task table/i })).toBeVisible({
        timeout: 10000,
      });
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

  test.describe('Orchestration surfaces', () => {
    const routeHeadings = [
      {
        path: '/release',
        heading: 'Установите CEOClaw в любом месте.',
      },
      {
        path: '/settings/agents',
        heading: 'Agent Orchestration',
      },
      {
        path: '/settings/agents/dashboard',
        heading: 'Agent Dashboard',
      },
      {
        path: '/settings/agents/workflows',
        heading: 'Workflow Builder',
      },
    ] as const;

    for (const route of routeHeadings) {
      test(`loads ${route.path}`, async ({ page }) => {
        await page.goto(route.path);
        await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
      });
    }
  });
});
