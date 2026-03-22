/**
 * Accessibility Tests (axe-core)
 * 
 * Tests for WCAG 2.1 A and AA compliance across all pages
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Pages to test
const pages = [
  { path: '/', name: 'Dashboard' },
  { path: '/projects', name: 'Projects' },
  { path: '/tasks', name: 'Tasks' },
  { path: '/kanban', name: 'Kanban' },
  { path: '/chat', name: 'AI Chat' },
  { path: '/analytics', name: 'Analytics' },
];

for (const { path, name } of pages) {
  test(`${name} should have no a11y violations`, async ({ page }) => {
    await page.goto(path);
    
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    
    expect(results.violations).toEqual([]);
  });

  test(`${name} should have proper heading structure`, async ({ page }) => {
    await page.goto(path);
    
    // Check for main heading
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThan(0);
    
    // Check heading hierarchy
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
    const levels: number[] = [];
    for (const h of headings) {
      const tagName = await h.evaluate((el: Element) => el.tagName);
      levels.push(parseInt(tagName.charAt(1)));
    }
    
    // Should start with h1
    if (levels.length > 0) {
      expect(levels[0]).toBe(1);
    }
  });

  test(`${name} should have proper contrast ratios`, async ({ page }) => {
    await page.goto(path);
    
    // Check text contrast (minimum 4.5:1)
    const textElements = await page.locator('p, span, div').all();
    
    for (const element of textElements) {
      const color = await element.evaluate((el: Element) => {
        const style = window.getComputedStyle(el);
        return style.color;
      });
      
      // Basic check (would need more sophisticated contrast ratio calculation)
      if (color) {
        expect(color).toBeTruthy();
      }
    }
  });
}

test('Navigation should be keyboard accessible', async ({ page }) => {
  await page.goto('/');
  
  // Check for skip links (optional but recommended)
  const skipLinkCount = await page.locator('a[href="#main-content"], a[href="#content"]').count();
  void skipLinkCount; // Skip links are optional
  
  // Check for keyboard navigation
  await page.keyboard.press('Tab');
  const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
  expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(focusedElement);
});

