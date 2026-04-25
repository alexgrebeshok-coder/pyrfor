import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, './__tests__/setup.ts')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '__tests__/',
        'lib/__tests__/**', // archived legacy tests
        '*.config.ts',
        'app/api/**',
        'prisma/**',
      ],
    },
    exclude: [
      '**/node_modules/**',
      '**/_archive/**', // archived experimental runtime modules — see runtime/_archive/README.md
      'lib/__tests__/**', // archived legacy tests (run manually with npx tsx)
      'e2e/**', // Playwright tests (run with npx playwright test)
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@ceoclaw/engine': path.resolve(__dirname, './packages/engine/src'),
      '@ceoclaw/business': path.resolve(__dirname, './packages/business/src'),
      '@ochag/family': path.resolve(__dirname, './packages/ochag/src'),
      '@freeclaude/coder': path.resolve(__dirname, './packages/freeclaude/src'),
      '@ceoclaw/ui': path.resolve(__dirname, './packages/ui/src'),
    },
  },
});
