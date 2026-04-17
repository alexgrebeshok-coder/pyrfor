import { test, expect } from '@playwright/test';

/**
 * Authentication Tests - Logout
 */

test.describe('Authentication - Logout', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app (assumes user is logged in or can access)
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display logout button when user is logged in', async ({ page }) => {
    // Arrange & Act - Already on main page
    
    // Assert - Look for logout button/link
    const logoutButton = page.locator('button:has-text("Выйти"), button:has-text("Logout"), a:has-text("Выйти"), a:has-text("Logout")');
    
    // If not visible, try to open user menu first
    const userMenuButton = page.locator('[data-testid="user-menu"], button[aria-label*="user" i], button[aria-label*="профиль" i]').first();
    if (await userMenuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userMenuButton.click();
      await page.waitForTimeout(500);
    }
    
    await expect(logoutButton.first()).toBeVisible({ timeout: 5000 });
  });

  test('should successfully logout and redirect to login page', async ({ page }) => {
    // Arrange - Find logout button
    const logoutButton = page.locator('button:has-text("Выйти"), button:has-text("Logout"), a:has-text("Выйти"), a:has-text("Logout")').first();
    if (!await logoutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const userMenuButton = page.locator('[data-testid="user-menu"], button[aria-label*="user" i], button[aria-label*="профиль" i]').first();
      if (await userMenuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await userMenuButton.click();
        await page.waitForTimeout(500);
      }
    }
    
    // Act - Click logout
    await logoutButton.click();
    
    // Assert - Should redirect to login page
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('should clear session after logout', async ({ page, context: _context }) => {
    // Arrange - Find and click logout
    const logoutButton = page.locator('button:has-text("Выйти"), button:has-text("Logout"), a:has-text("Выйти"), a:has-text("Logout")').first();
    
    // Try to open user menu if needed
    if (!await logoutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const userMenuButton = page.locator('[data-testid="user-menu"], button[aria-label*="user" i], button[aria-label*="профиль" i]').first();
      if (await userMenuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await userMenuButton.click();
        await page.waitForTimeout(500);
      }
    }
    
    // Act - Logout
    await logoutButton.click();
    await page.waitForLoadState('networkidle');
    
    // Act - Try to navigate to protected page
    await page.goto('/projects');
    
    // Assert - Should redirect back to login (session cleared)
    await page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {
      // Or should show unauthorized message
      return expect(page.locator('text=/войдите|unauthorized|login required/i')).toBeVisible({ timeout: 5000 });
    });
  });
});
