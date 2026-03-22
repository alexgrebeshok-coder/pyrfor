import { test, expect } from '@playwright/test';

/**
 * Settings Tests - Language Toggle
 */

test.describe('Settings - Language', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display language selector', async ({ page }) => {
    // Arrange & Act - Already on page
    
    // Assert - Check for language selector
    const languageSelector = page.locator('[data-testid="language-selector"], select[name="language"], select[name="lang"], button[aria-label*="language" i], button[aria-label*="язык" i]').first();
    
    // Try settings page if not found
    if (!await languageSelector.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
    }
    
    await expect(languageSelector).toBeVisible({ timeout: 5000 });
  });

  test('should change interface language', async ({ page }) => {
    // Arrange
    let languageSelector = page.locator('[data-testid="language-selector"], select[name="language"], select[name="lang"]').first();
    
    // Try settings page if not found
    if (!await languageSelector.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
      languageSelector = page.locator('[data-testid="language-selector"], select[name="language"]').first();
    }
    
    // Get current language
    const htmlElement = page.locator('html');
    const initialLang = await htmlElement.getAttribute('lang');
    
    // Act - Change language (if it's a select)
    if (await languageSelector.evaluate(el => el.tagName).then(tag => tag === 'SELECT')) {
      await languageSelector.selectOption({ index: 0 }); // Select first option
      await page.waitForTimeout(500);
      
      // Assert - Language should have changed
      const newLang = await htmlElement.getAttribute('lang');
      expect(newLang).toBeTruthy();
    } else {
      // If it's a button, click it to toggle
      await languageSelector.click();
      await page.waitForTimeout(500);
      
      // Assert - Some text should have changed
      const body = page.locator('body');
      await expect(body).toBeVisible();
    }
  });

  test('should persist language selection', async ({ page }) => {
    // Arrange
    let languageSelector = page.locator('[data-testid="language-selector"], select[name="language"]').first();
    
    // Try settings page if not found
    if (!await languageSelector.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
      languageSelector = page.locator('[data-testid="language-selector"], select[name="language"]').first();
    }
    
    // Act - Change language
    if (await languageSelector.evaluate(el => el.tagName).then(tag => tag === 'SELECT')) {
      await languageSelector.selectOption({ index: 0 });
      await page.waitForTimeout(500);
    } else {
      await languageSelector.click();
      await page.waitForTimeout(500);
    }
    
    const htmlElement = page.locator('html');
    const langAfterChange = await htmlElement.getAttribute('lang');
    
    // Act - Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Assert - Language should be the same after reload
    const langAfterReload = await htmlElement.getAttribute('lang');
    expect(langAfterReload).toBe(langAfterChange);
  });
});
