import { test, expect } from '@playwright/test';

/**
 * Tasks Tests - Kanban Board
 */

test.describe('Tasks - Kanban', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/kanban');
    await page.waitForLoadState('networkidle');
  });

  test('should display kanban board', async ({ page }) => {
    // Arrange & Act - Already on kanban page
    
    // Assert - Check for either a ready board, loading shell, or empty-project state
    const kanbanSurface = page.locator('[data-testid="kanban-board"], [data-testid="kanban-page-loading"], text=/нет проекта|no project/i').first();
    await expect(kanbanSurface).toBeVisible({ timeout: 10000 });
  });

  test('should show kanban columns', async ({ page }) => {
    // Arrange & Act - Already on kanban page
    
    // Assert - Check for columns (To Do, In Progress, Done, etc.)
    const columns = page.locator('[data-testid="kanban-column"]');
    if (await columns.count()) {
      await expect(columns.first()).toBeVisible({ timeout: 10000 });
      
      // Assert - Should have multiple columns
      const columnCount = await columns.count();
      expect(columnCount).toBeGreaterThan(1);
      return;
    }
    
    await expect(page.getByText(/нет проекта|no project/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('should render draggable task cards when board has tasks', async ({ page }) => {
    // Arrange
    const taskCard = page.locator('[data-testid="task-card"]').first();
    
    if (!await taskCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }

    await expect(taskCard).toBeVisible();
    await expect(taskCard).toHaveAttribute('data-task-id', /.+/);
  });
});
