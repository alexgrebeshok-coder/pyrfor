import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard Tests - Navigation
 */

test.describe('Dashboard - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  const getMainNavigation = (page: Page) =>
    page.getByRole('navigation', { name: /main navigation/i });

  test('should display sidebar navigation', async ({ page }) => {
    // Arrange & Act - Already on dashboard
    
    // Assert - Check for sidebar
    const sidebar = getMainNavigation(page);
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test('should expose core sidebar routes', async ({ page }) => {
    const sidebar = getMainNavigation(page);

    await expect(sidebar.getByRole('link', { name: /^Проекты/ })).toHaveAttribute('href', '/projects');
    await expect(sidebar.getByRole('link', { name: /^Задачи/ })).toHaveAttribute('href', '/tasks');
    await expect(sidebar.getByRole('link', { name: /^Аналитика/ })).toHaveAttribute('href', '/analytics');
    await expect(sidebar.getByRole('link', { name: /^Документы/ })).toHaveAttribute('href', '/documents');
  });

  test('should open Projects page', async ({ page }) => {
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByTestId('projects-page')).toBeVisible();
  });

  test('should open Tasks page', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByTestId('tasks-page')).toBeVisible();
  });

  test('should open Analytics page', async ({ page }) => {
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.locator('main')).toBeVisible();
  });

  test('should show map and logistics card on dashboard', async ({ page }) => {
    await expect(page.locator('[data-testid="dashboard-map"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-map"]').first()).toContainText(/Карта и логистика|Map/i);
    await expect(page.locator('[data-testid="dashboard-map"]').first()).toContainText(/Активные контуры/i);
    await expect(page.locator('[data-testid="dashboard-map"]').first()).toContainText(/Открыть карту/i);
  });
});
