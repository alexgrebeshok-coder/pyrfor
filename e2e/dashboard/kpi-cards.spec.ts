import { test, expect } from '@playwright/test';

/**
 * Dashboard Tests - KPI Cards
 */

test.describe('Dashboard - KPI Cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display KPI cards on dashboard', async ({ page }) => {
    // Arrange & Act - Already on dashboard
    
    // Assert - Check for KPI card containers
    const kpiCards = page.locator('[data-testid="kpi-card"], .kpi-card, [class*="metric"], [class*="stat"]').first();
    await expect(kpiCards).toBeVisible({ timeout: 10000 });
  });

  test('should show correct KPI metrics', async ({ page }) => {
    // Arrange & Act - Already on dashboard
    
    // Assert - Check for common KPI metrics
    const expectedMetrics = [
      /проект|project/i,
      /задач|task/i,
      /просроч|overdue/i,
      /завершен|completed|done/i
    ];
    
    let foundMetrics = 0;
    for (const metric of expectedMetrics) {
      const metricElement = page.locator(`text=${metric}`).first();
      if (await metricElement.isVisible({ timeout: 2000 }).catch(() => false)) {
        foundMetrics++;
      }
    }
    
    // At least one metric should be visible
    expect(foundMetrics).toBeGreaterThan(0);
  });

  test('should display numeric values in KPI cards', async ({ page }) => {
    // Arrange & Act - Already on dashboard
    
    // Assert - Look for numbers in KPI cards
    const numbersInCards = page.locator('[data-testid="kpi-card"] text=/\\d+/, .kpi-card text=/\\d+/, [class*="metric"] text=/\\d+/').first();
    await expect(numbersInCards).toBeVisible({ timeout: 5000 });
  });
});
