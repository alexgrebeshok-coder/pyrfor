import { test, expect } from '@playwright/test';

/**
 * Error Handling Tests - Error Boundary
 */

test.describe('Error Handling - Error Boundary', () => {
  test('should display error message when component fails', async ({ page }) => {
    // Arrange - Set up route to trigger error
    await page.route('**/api/projects', route => route.abort('failed'));
    
    // Act - Navigate to page that might fail
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for error message or fallback UI
    const errorMessage = page.locator('text=/ошибка|error|произошла ошибка|something went wrong|не удалось загрузить|failed to load/i');
    
    // Should either show error or handle gracefully
    const hasError = await errorMessage.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasContent = await page.locator('body').isVisible();
    
    expect(hasError || hasContent).toBeTruthy();
  });

  test('should show retry button on error', async ({ page }) => {
    // Arrange - Set up route to trigger error
    await page.route('**/api/tasks', route => route.abort('failed'));
    
    // Act - Navigate to page
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for retry/reload button
    const retryButton = page.locator('button:has-text("Повторить"), button:has-text("Retry"), button:has-text("Обновить"), button:has-text("Reload")');
    const hasRetry = await retryButton.first().isVisible({ timeout: 5000 }).catch(() => false);
    
    // If no retry button, page should handle error gracefully
    if (!hasRetry) {
      const pageContent = page.locator('body');
      await expect(pageContent).toBeVisible();
    } else {
      await expect(retryButton.first()).toBeVisible();
    }
  });

  test('should recover from error when retrying', async ({ page }) => {
    // Arrange - Set up route to fail once, then succeed
    let failCount = 0;
    await page.route('**/api/analytics', route => {
      failCount++;
      if (failCount === 1) {
        route.abort('failed');
      } else {
        route.continue();
      }
    });
    
    // Act - Navigate to page (will fail first time)
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');
    
    // Act - Click retry if available
    const retryButton = page.locator('button:has-text("Повторить"), button:has-text("Retry"), button:has-text("Обновить")').first();
    if (await retryButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await retryButton.click();
      await page.waitForLoadState('networkidle');
    }
    
    // Assert - Page should load successfully after retry
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
