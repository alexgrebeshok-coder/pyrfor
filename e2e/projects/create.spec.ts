import { test, expect } from '@playwright/test';

/**
 * Projects Tests - Create Project
 */

test.describe('Projects - Create', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
  });

  test('should display create project button', async ({ page }) => {
    // Arrange & Act - Already on projects page
    
    // Assert - Check for create/add button
    const createButton = page.locator('button:has-text("Создать"), button:has-text("Create"), button:has-text("Добавить"), button:has-text("Add"), a:has-text("Создать")').first();
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });

  test('should open create project form', async ({ page }) => {
    // Arrange
    const createButton = page.locator('button:has-text("Создать"), button:has-text("Create"), button:has-text("Добавить"), a:has-text("Создать")').first();
    
    // Act
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for form or modal
    const form = page.locator('form, [role="dialog"], [data-testid="create-project-form"], .modal').first();
    await expect(form).toBeVisible({ timeout: 5000 });
  });

  test('should create project with required fields', async ({ page }) => {
    // Arrange
    const projectName = `Test Project ${Date.now()}`;
    const createButton = page.locator('button:has-text("Создать"), button:has-text("Create")').first();
    
    // Act - Open form
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Act - Fill required fields
    const nameInput = page.locator('input[name="name"], input[placeholder*="название" i], input[placeholder*="name" i]').first();
    await nameInput.fill(projectName);
    
    // Act - Submit form
    const submitButton = page.locator('button[type="submit"], button:has-text("Сохранить"), button:has-text("Save")').first();
    await submitButton.click();
    
    // Assert - Should show success or redirect
    await page.waitForURL(/\/projects/, { timeout: 10000 }).catch(async () => {
      // Or check for success message
      return expect(page.locator('text=/создан|created|успешно|success/i')).toBeVisible({ timeout: 5000 });
    });
    
    // Assert - New project should appear in list
    await expect(page.locator(`text=${projectName}`)).toBeVisible({ timeout: 10000 });
  });
});
