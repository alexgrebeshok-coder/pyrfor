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
    const createButton = page.locator('[data-testid="create-project-button"], button:has-text("Добавить проект"), button:has-text("Создать проект"), button:has-text("Add project")').first();
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });

  test('should open create project form', async ({ page }) => {
    // Arrange
    const createButton = page.locator('[data-testid="create-project-button"], button:has-text("Добавить проект"), button:has-text("Создать проект"), button:has-text("Add project")').first();
    
    // Act
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for form or modal
    const form = page.getByTestId('create-project-form');
    await expect(form).toBeVisible({ timeout: 5000 });
  });

  test('should create project with required fields', async ({ page }) => {
    // Arrange
    const projectName = `Test Project ${Date.now()}`;
    const createButton = page.locator('[data-testid="create-project-button"], button:has-text("Добавить проект"), button:has-text("Создать проект"), button:has-text("Add project")').first();
    
    // Act - Open form
    await createButton.click();
    await page.waitForLoadState('networkidle');
    
    // Act - Fill required fields
    const form = page.getByTestId('create-project-form');
    const nameInput = page.getByTestId('project-name-input');
    await nameInput.fill(projectName);
    
    // Act - Submit form
    const submitButton = page.getByTestId('submit-project-button');
    await submitButton.click();
    
    // Assert - Modal closes and item appears in the portfolio list
    await expect(form).toBeHidden({ timeout: 10000 });
    
    // Assert - New project should appear in list
    await expect(page.getByTestId('projects-page').getByText(projectName)).toBeVisible({ timeout: 10000 });
  });
});
