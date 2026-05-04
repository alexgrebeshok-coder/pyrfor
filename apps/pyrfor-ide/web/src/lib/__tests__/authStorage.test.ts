import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearBearerToken, getBearerToken, setBearerToken } from '../authStorage';

describe('authStorage browser fallback', () => {
  beforeEach(async () => {
    try {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    } catch {
      // ignore
    }
    localStorage.clear();
    await clearBearerToken();
  });

  afterEach(async () => {
    await clearBearerToken();
    localStorage.clear();
  });

  it('keeps bearer token in memory instead of localStorage', async () => {
    await setBearerToken('test-token');

    expect(await getBearerToken()).toBe('test-token');
    expect(localStorage.getItem('pyrfor-token')).toBeNull();
  });

  it('clears the in-memory bearer token', async () => {
    await setBearerToken('test-token');
    await clearBearerToken();

    expect(await getBearerToken()).toBe('');
    expect(localStorage.getItem('pyrfor-token')).toBeNull();
  });

  it('migrates and clears a legacy localStorage token without persisting it again', async () => {
    localStorage.setItem('pyrfor-token', 'legacy-token');

    expect(await getBearerToken()).toBe('legacy-token');
    expect(localStorage.getItem('pyrfor-token')).toBeNull();
    expect(await getBearerToken()).toBe('legacy-token');
  });
});
