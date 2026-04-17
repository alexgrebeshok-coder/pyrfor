import { test, expect } from '@playwright/test';

/**
 * Projects Tests - List View
 */

test.describe('Projects - List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
  });

  test('should display projects list page', async ({ page }) => {
    // Arrange & Act - Already on projects page
    
    // Assert - Check for page heading
    const heading = page.getByRole('heading', { level: 1, name: /Проекты|Projects/i }).first();
    await expect(heading).toContainText(/Проекты|Projects/i);
  });

  test('should show project cards or table', async ({ page }) => {
    // Arrange & Act - Already on projects page
    
    // Assert - Check for either populated or empty portfolio surface
    const projectDisplay = page.locator('[data-testid="projects-grid"], [data-testid="projects-empty-state"]').first();
    await expect(projectDisplay).toBeVisible({ timeout: 10000 });
  });

  test('should display project count', async ({ page }) => {
    // Arrange & Act - Already on projects page
    
    // Assert - Look for count indicator
    const countElement = page.locator('[data-testid="projects-summary"], [data-testid="projects-empty-state"]').first();
    await expect(countElement).toBeVisible({ timeout: 5000 });
  });
});
