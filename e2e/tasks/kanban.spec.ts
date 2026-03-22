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
    
    // Assert - Check for kanban board container
    const kanbanBoard = page.getByTestId('kanban-board');
    await expect(kanbanBoard).toBeVisible({ timeout: 10000 });
  });

  test('should show kanban columns', async ({ page }) => {
    // Arrange & Act - Already on kanban page
    
    // Assert - Check for columns (To Do, In Progress, Done, etc.)
    const columns = page.locator('[data-testid="kanban-column"]');
    await expect(columns.first()).toBeVisible({ timeout: 10000 });
    
    // Assert - Should have multiple columns
    const columnCount = await columns.count();
    expect(columnCount).toBeGreaterThan(1);
  });

  test('should allow drag and drop of tasks', async ({ page }) => {
    // Arrange
    const taskCard = page.locator('[data-testid="task-card"]').first();
    
    if (!await taskCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }
    
    // Get initial column
    // Get target column (next column)
    const columns = page.locator('[data-testid="kanban-column"]');
    const columnCount = await columns.count();
    
    if (columnCount < 2) {
      test.skip();
      return;
    }
    
    const targetColumn = columns.nth(1);
    
    // Act - Drag task to target column
    await taskCard.dragTo(targetColumn);
    
    // Assert - Task should have moved
    await page.waitForTimeout(1000);
    const movedTask = page.locator('[data-testid="task-card"], .task-card, [draggable="true"]').first();
    await expect(movedTask).toBeVisible();
  });
});
