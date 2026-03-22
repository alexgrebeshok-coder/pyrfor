import { test, expect } from '@playwright/test';

/**
 * Tasks Tests - List View
 */

test.describe('Tasks - List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');
  });

  test('should display tasks list page', async ({ page }) => {
    // Arrange & Act - Already on tasks page
    
    // Assert - Check for page heading
    const heading = page.locator('h1');
    await expect(heading).toContainText(/Задач|Tasks/i);
  });

  test('should show task list or cards', async ({ page }) => {
    // Arrange & Act - Already on tasks page
    
    // Assert - Check for task display
    const taskDisplay = page.locator('[data-testid="task-card"], .task-card, [data-testid="task-list"], [class*="task-item"]').first();
    await expect(taskDisplay).toBeVisible({ timeout: 10000 });
  });

  test('should display task count or summary', async ({ page }) => {
    // Arrange & Act - Already on tasks page
    
    // Assert - Look for count or summary
    const countElement = page.locator('text=/\\d+.*задач|\\d+.*task|всего.*\\d+/i').first();
    await expect(countElement).toBeVisible({ timeout: 5000 });
  });
});
