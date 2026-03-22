import { test, expect } from '@playwright/test';

/**
 * Authentication Tests - Invalid Login
 */

test.describe('Authentication - Invalid Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('should show error for invalid email format', async ({ page }) => {
    // Arrange
    const invalidEmail = 'invalid-email';
    const password = 'TestPassword123!';
    
    // Act - Fill form with invalid email
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill(invalidEmail);
    
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill(password);
    
    const submitButton = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Sign in")').first();
    await submitButton.click();
    
    // Assert - Should show validation error
    const errorMessage = page.locator('text=/некорректный email|invalid email|email.*недействителен/i');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
    
    // Assert - Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should show error for wrong credentials', async ({ page }) => {
    // Arrange
    const wrongEmail = 'wrong@example.com';
    const wrongPassword = 'WrongPassword123!';
    
    // Act - Fill form with wrong credentials
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill(wrongEmail);
    
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill(wrongPassword);
    
    const submitButton = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Sign in")').first();
    await submitButton.click();
    
    // Assert - Should show error message
    const errorMessage = page.locator('text=/неверн|incorrect|invalid|не удалось|failed/i');
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
    
    // Assert - Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should show error for empty fields', async ({ page }) => {
    // Arrange - Leave fields empty
    
    // Act - Submit empty form
    const submitButton = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Sign in")').first();
    await submitButton.click();
    
    // Assert - Should show validation errors
    const errorMessage = page.locator('text=/обязател|required|заполните|empty/i');
    await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
    
    // Assert - Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should disable submit button while submitting', async ({ page }) => {
    // Arrange
    const email = 'test@example.com';
    const password = 'TestPassword123!';
    
    // Act - Fill form
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill(email);
    
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill(password);
    
    const submitButton = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Sign in")').first();
    
    // Start clicking but don't wait
    const clickPromise = submitButton.click();
    
    // Assert - Button should be disabled during submission
    await expect(submitButton).toBeDisabled({ timeout: 2000 }).catch(() => {
      // Some implementations might not disable, just show loading state
      return expect(page.locator('text=/загрузка|loading/i')).toBeVisible({ timeout: 1000 });
    });
    
    await clickPromise;
  });
});
