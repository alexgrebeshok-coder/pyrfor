/**
 * Playwright Accessibility Test Configuration
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/accessibility',
  fullyParallel: true,
  forbidOnly: true,
  retries: 2,
  workers: process.env.CI ? 2 : 1,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium-accessibility',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
