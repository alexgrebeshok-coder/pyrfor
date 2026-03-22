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
    const heading = page.locator('h1');
    await expect(heading).toContainText(/Проекты|Projects/i);
  });

  test('should show project cards or table', async ({ page }) => {
    // Arrange & Act - Already on projects page
    
    // Assert - Check for project display (cards or table)
    const projectDisplay = page.locator('[data-testid="project-card"], .project-card, [data-testid="project-table"], table, [class*="project-list"]').first();
    await expect(projectDisplay).toBeVisible({ timeout: 10000 });
  });

  test('should display project count', async ({ page }) => {
    // Arrange & Act - Already on projects page
    
    // Assert - Look for count indicator
    const countElement = page.locator('text=/\\d+.*проект|\\d+.*project|всего.*\\d+/i').first();
    await expect(countElement).toBeVisible({ timeout: 5000 });
  });
});
