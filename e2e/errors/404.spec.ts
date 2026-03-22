import { test, expect } from '@playwright/test';

/**
 * Error Handling Tests - 404 Not Found
 */

test.describe('Error Handling - 404', () => {
  test('should display 404 page for non-existent route', async ({ page }) => {
    // Arrange & Act - Navigate to non-existent route
    await page.goto('/non-existent-page-' + Date.now());
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for 404 message
    const notFoundMessage = page.locator('text=/404|не найден|not found|страница не существует/i');
    await expect(notFoundMessage.first()).toBeVisible({ timeout: 5000 });
  });

  test('should show navigation back to home on 404 page', async ({ page }) => {
    // Arrange & Act - Navigate to non-existent route
    await page.goto('/non-existent-page-' + Date.now());
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for home link or button
    const homeLink = page.locator('a[href="/"], button:has-text("На главную"), button:has-text("Home"), a:has-text("На главную")');
    await expect(homeLink.first()).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to home from 404 page', async ({ page }) => {
    // Arrange - Navigate to non-existent route
    await page.goto('/non-existent-page-' + Date.now());
    await page.waitForLoadState('networkidle');
    
    // Act - Click home link
    const homeLink = page.locator('a[href="/"], button:has-text("На главную"), a:has-text("На главную")').first();
    await homeLink.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Should be on home page
    await expect(page).toHaveURL('/');
  });
});
