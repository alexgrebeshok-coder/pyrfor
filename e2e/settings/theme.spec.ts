import { test, expect } from '@playwright/test';

/**
 * Settings Tests - Theme Toggle
 */

test.describe('Settings - Theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display theme toggle option', async ({ page }) => {
    // Arrange & Act - Already on page
    
    // Assert - Check for theme toggle button
    const themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i], button[aria-label*="тема" i], button:has-text("тема"), button:has-text("theme")').first();
    
    // If not visible, try to open settings menu
    if (!await themeToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const settingsButton = page.locator('a[href="/settings"], button:has-text("Настройки"), button:has-text("Settings")').first();
      if (await settingsButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await settingsButton.click();
        await page.waitForLoadState('networkidle');
      }
    }
    
    await expect(themeToggle).toBeVisible({ timeout: 5000 });
  });

  test('should toggle between light and dark themes', async ({ page }) => {
    // Arrange
    const htmlElement = page.locator('html');
    const initialTheme = await htmlElement.getAttribute('data-theme') || await htmlElement.getAttribute('class');
    
    // Find theme toggle
    let themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i], button[aria-label*="тема" i]').first();
    
    // Try settings page if not found
    if (!await themeToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
      themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i]').first();
    }
    
    // Act - Toggle theme
    await themeToggle.click();
    await page.waitForTimeout(500);
    
    // Assert - Theme should have changed
    const newTheme = await htmlElement.getAttribute('data-theme') || await htmlElement.getAttribute('class');
    expect(newTheme).not.toBe(initialTheme);
  });

  test('should persist theme selection', async ({ page }) => {
    // Arrange
    const htmlElement = page.locator('html');
    let themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i]').first();
    
    // Try settings page if not found
    if (!await themeToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
      themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i]').first();
    }
    
    // Act - Toggle theme
    await themeToggle.click();
    await page.waitForTimeout(500);
    
    const themeAfterToggle = await htmlElement.getAttribute('data-theme') || await htmlElement.getAttribute('class');
    
    // Act - Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Assert - Theme should be the same after reload
    const themeAfterReload = await htmlElement.getAttribute('data-theme') || await htmlElement.getAttribute('class');
    expect(themeAfterReload).toBe(themeAfterToggle);
  });
});
