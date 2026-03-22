import { test, expect } from '@playwright/test';

/**
 * Tasks Tests - Create Task
 */

test.describe('Tasks - Create', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');
  });

  test('should display create task button', async ({ page }) => {
    // Arrange & Act - Already on tasks page
    
    // Assert - Check for create/add button
    const createButton = page.locator('button:has-text("Создать"), button:has-text("Create"), button:has-text("Добавить"), button:has-text("Add"), button:has-text("Новая задача")').first();
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });

  test('should open create task form', async ({ page }) => {
    // Arrange
    const createButton = page.locator('button:has-text("Создать"), button:has-text("Create"), button:has-text("Добавить"), button:has-text("Новая задача")').first();
    
    // Act
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for form or modal
    const form = page.locator('form, [role="dialog"], [data-testid="create-task-form"], .modal').first();
    await expect(form).toBeVisible({ timeout: 5000 });
  });

  test('should create task with required fields', async ({ page }) => {
    // Arrange
    const taskTitle = `Test Task ${Date.now()}`;
    const createButton = page.locator('button:has-text("Создать"), button:has-text("Create"), button:has-text("Новая задача")').first();
    
    // Act - Open form
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Act - Fill required fields
    const titleInput = page.locator('input[name="title"], input[name="name"], input[placeholder*="название" i], input[placeholder*="title" i]').first();
    await titleInput.fill(taskTitle);
    
    // Act - Submit form
    const submitButton = page.locator('button[type="submit"], button:has-text("Сохранить"), button:has-text("Save"), button:has-text("Создать")').first();
    await submitButton.click();
    
    // Assert - Should show success or task in list
    await page.waitForURL(/\/tasks/, { timeout: 10000 }).catch(async () => {
      // Or check for success message
      return expect(page.locator('text=/создан|created|успешно|success/i')).toBeVisible({ timeout: 5000 });
    });
    
    // Assert - New task should appear
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10000 });
  });
});
