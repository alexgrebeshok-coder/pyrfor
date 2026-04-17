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
    const createButton = page.locator('[data-testid="create-task-button"], button:has-text("Добавить задачу"), button:has-text("Создать задачу"), button:has-text("Add task")').first();
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });

  test('should open create task form', async ({ page }) => {
    // Arrange
    const createButton = page.locator('[data-testid="create-task-button"], button:has-text("Добавить задачу"), button:has-text("Создать задачу"), button:has-text("Add task")').first();
    
    // Act
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for form or modal
    const form = page.getByTestId('create-task-form');
    await expect(form).toBeVisible({ timeout: 5000 });
  });

  test('should create task with required fields', async ({ page }) => {
    // Arrange
    const taskTitle = `Test Task ${Date.now()}`;
    const createButton = page.locator('[data-testid="create-task-button"], button:has-text("Добавить задачу"), button:has-text("Создать задачу"), button:has-text("Add task")').first();
    
    // Act - Open form
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Act - Fill required fields
    const form = page.getByTestId('create-task-form');
    const titleInput = page.getByTestId('task-title-input');
    await titleInput.fill(taskTitle);
    const projectSelect = page.getByTestId('task-project-select');
    const firstProjectValue = await projectSelect.locator('option').nth(1).getAttribute('value');
    if (firstProjectValue) {
      await projectSelect.selectOption(firstProjectValue);
    }
    
    // Act - Submit form
    const submitButton = page.getByTestId('submit-task-button');
    await submitButton.click();
    
    // Assert - When at least one project is available, task gets created and the modal closes
    if (firstProjectValue) {
      await expect(form).toBeHidden({ timeout: 10000 });
      await expect(page.getByTestId('tasks-page').getByText(taskTitle)).toBeVisible({ timeout: 10000 });
    } else {
      await expect(form).toBeVisible();
    }
  });
});
