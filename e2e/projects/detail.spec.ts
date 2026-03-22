import { test, expect } from '@playwright/test';

/**
 * Projects Tests - Project Detail
 */

test.describe('Projects - Detail', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to projects page first
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
  });

  test('should navigate to project detail page', async ({ page }) => {
    // Arrange
    const projectCard = page.locator('[data-testid="project-card"], .project-card, a[href*="/projects/"]').first();
    
    // Skip test if no projects
    if (!await projectCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }
    
    // Act
    await projectCard.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Should be on project detail page
    await expect(page).toHaveURL(/\/projects\/[\w-]+/);
  });

  test('should display project information', async ({ page }) => {
    // Arrange
    const projectCard = page.locator('[data-testid="project-card"], .project-card, a[href*="/projects/"]').first();
    
    if (!await projectCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }
    
    // Act
    await projectCard.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Check for project details
    const projectTitle = page.locator('h1, h2').first();
    await expect(projectTitle).toBeVisible({ timeout: 5000 });
    
    // Assert - Check for project metadata (dates, status, etc.)
    const metadata = page.locator('text=/статус|status|дата|date|прогресс|progress/i').first();
    await expect(metadata).toBeVisible({ timeout: 5000 });
  });

  test('should show project tasks or activities', async ({ page }) => {
    // Arrange
    const projectCard = page.locator('[data-testid="project-card"], .project-card, a[href*="/projects/"]').first();
    
    if (!await projectCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }
    
    // Act
    await projectCard.click();
    await page.waitForLoadState('networkidle');
    
    // Assert - Look for tasks section
    const tasksSection = page.locator('text=/задач|task|активност|activity/i').first();
    await expect(tasksSection).toBeVisible({ timeout: 5000 });
  });
});
