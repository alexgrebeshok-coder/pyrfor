import { test, expect } from '@playwright/test';

/**
 * Dashboard Tests - Navigation
 */

test.describe('Dashboard - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display sidebar navigation', async ({ page }) => {
    // Arrange & Act - Already on dashboard
    
    // Assert - Check for sidebar
    const sidebar = page.locator('[data-testid="sidebar"], nav, [class*="sidebar"], [class*="nav"]').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to Projects page', async ({ page }) => {
    // Arrange
    const projectsLink = page.locator('a[href="/projects"], a[href*="projects"]').first();
    
    // Act
    await projectsLink.click();
    await page.waitForLoadState('networkidle');
    
    // Assert
    await expect(page).toHaveURL(/\/projects/);
  });

  test('should navigate to Tasks page', async ({ page }) => {
    // Arrange
    const tasksLink = page.locator('a[href="/tasks"], a[href*="tasks"]').first();
    
    // Act
    await tasksLink.click();
    await page.waitForLoadState('networkidle');
    
    // Assert
    await expect(page).toHaveURL(/\/tasks/);
  });

  test('should navigate to Analytics page', async ({ page }) => {
    // Arrange
    const analyticsLink = page.locator('a[href="/analytics"], a[href*="analytics"]').first();
    
    // Act
    await analyticsLink.click();
    await page.waitForLoadState('networkidle');
    
    // Assert
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('should navigate to Documents page', async ({ page }) => {
    const documentsLink = page.locator('a[href="/documents"]').first();

    await documentsLink.click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/documents/);
    await expect(page.locator('[data-testid="documents-page"]')).toBeVisible();
  });

  test('should show map and logistics card on dashboard', async ({ page }) => {
    await expect(page.locator('[data-testid="dashboard-map"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-map"]').first()).toContainText(/Карта|Map/i);
  });
});
