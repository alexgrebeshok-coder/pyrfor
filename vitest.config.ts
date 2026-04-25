import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'packages/engine/src/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'packages/engine/dist/**',
        '*.config.ts',
        'prisma/**',
      ],
    },
    exclude: [
      '**/node_modules/**',
      '**/_archive/**', // archived experimental runtime modules — see runtime/_archive/README.md
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './packages/engine/src'),
      '@pyrfor/engine': path.resolve(__dirname, './packages/engine/src'),
    },
  },
});
