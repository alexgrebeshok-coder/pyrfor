import { test, expect } from '@playwright/test';

/**
 * Authentication Tests - Login Success
 */

test.describe('Authentication - Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('should display login form with all required fields', async ({ page }) => {
    // Arrange & Act - already on login page
    
    // Assert - Check for email input
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await expect(emailInput).toBeVisible();
    
    // Assert - Check for password input
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible();
    
    // Assert - Check for submit button
    const submitButton = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Sign in")');
    await expect(submitButton).toBeVisible();
  });

  test('should successfully login with valid credentials', async ({ page }) => {
    // Arrange
    const testEmail = 'test@example.com';
    const testPassword = 'TestPassword123!';
    
    // Act - Fill login form
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill(testEmail);
    
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill(testPassword);
    
    // Act - Submit form
    const submitButton = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Sign in")').first();
    await submitButton.click();
    
    // Assert - Should redirect to dashboard or show success
    await page.waitForURL(/\/(dashboard|projects|tasks)?$/, { timeout: 10000 }).catch(() => {
      // If no redirect, check for success message or UI update
      return expect(page.locator('text=/успешно|success|welcome/i')).toBeVisible({ timeout: 5000 });
    });
    
    // Assert - Should not be on login page anymore
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should remember user session after login', async ({ page, context }) => {
    // Arrange
    const testEmail = 'test@example.com';
    const testPassword = 'TestPassword123!';
    
    // Act - Login
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill(testEmail);
    
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill(testPassword);
    
    const submitButton = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Sign in")').first();
    await submitButton.click();
    
    // Wait for navigation
    await page.waitForLoadState('networkidle');
    
    // Act - Reload page
    await page.reload();
    
    // Assert - Should still be logged in (not redirected to login)
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });
  });
});
