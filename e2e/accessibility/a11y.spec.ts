/**
 * Accessibility Tests (axe-core)
 *
 * Tests for WCAG 2.1 A and AA compliance across key pages.
 * Covers 15 pages. Run as Tier 3 (weekly/manual).
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = [
  { path: '/', name: 'Dashboard' },
  { path: '/projects', name: 'Projects' },
  { path: '/tasks', name: 'Tasks' },
  { path: '/kanban', name: 'Kanban' },
  { path: '/chat', name: 'AI Chat' },
  { path: '/analytics', name: 'Analytics' },
  { path: '/goals', name: 'Goals' },
  { path: '/finance', name: 'Finance' },
  { path: '/calendar', name: 'Calendar' },
  { path: '/documents', name: 'Documents' },
  { path: '/gantt', name: 'Gantt' },
  { path: '/portfolio', name: 'Portfolio' },
  { path: '/release', name: 'Release' },
  { path: '/settings/agents', name: 'Agent Orchestration' },
  { path: '/risks', name: 'Risks' },
];

test.describe('WCAG 2.1 AA Compliance', () => {
  for (const { path, name } of pages) {
    test(name + ' has no critical a11y violations', async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .disableRules(['color-contrast']) // theme-dependent, tested separately
        .analyze();

      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      if (critical.length > 0) {
        const summary = critical
          .map((v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.length} nodes]`)
          .join('\n');
        expect(critical, `Critical/serious a11y violations found:\n${summary}`).toHaveLength(0);
      }
    });
  }
});

test.describe('Keyboard Navigation', () => {
  test('Dashboard is keyboard navigable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Tab should move focus to interactive elements
    await page.keyboard.press('Tab');
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(tag);
  });

  test('All navigation links have accessible names', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const links = await page.locator('nav a').all();
    for (const link of links) {
      const name = await link.getAttribute('aria-label') || await link.textContent();
      expect(name?.trim().length).toBeGreaterThan(0);
    }
  });
});
