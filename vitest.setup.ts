import { afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

afterEach(async () => {
  if (typeof document === 'undefined') {
    return;
  }

  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
