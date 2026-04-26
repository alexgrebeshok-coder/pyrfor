/**
 * Tests for chatStream cloud-fallback behaviour in api.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatStream } from '../api';
import * as cloudFallback from '../cloudFallback';

// ─── localStorage mock ────────────────────────────────────────────────────────

const store: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
    configurable: true,
  });

  vi.restoreAllMocks();
});

describe('chatStream cloud fallback', () => {
  it('calls chatStreamCloud when daemonFetch rejects with TypeError and fallback is enabled', async () => {
    // Make fetch throw a TypeError (daemon unreachable)
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')) as any;

    // Enable cloud fallback
    cloudFallback.setCloudFallbackConfig({ enabled: true, apiKey: 'sk-cloud-key' });

    const mockChatStreamCloud = vi
      .spyOn(cloudFallback, 'chatStreamCloud')
      .mockResolvedValueOnce(undefined);

    const chunks: string[] = [];
    const res = await chatStream({
      text: 'hello',
      sessionId: 'sess-1',
      onChunk: (t) => chunks.push(t),
    });

    expect(mockChatStreamCloud).toHaveBeenCalledOnce();
    expect(mockChatStreamCloud).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello', sessionId: 'sess-1' })
    );
    // Synthetic 200 response returned
    expect(res.status).toBe(200);
  });

  it('rethrows original TypeError when cloud fallback is disabled', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')) as any;

    // Disable cloud fallback
    cloudFallback.setCloudFallbackConfig({ enabled: false, apiKey: 'sk-key' });

    const mockChatStreamCloud = vi.spyOn(cloudFallback, 'chatStreamCloud');

    await expect(
      chatStream({ text: 'hello', onChunk: () => {} })
    ).rejects.toThrow(TypeError);

    expect(mockChatStreamCloud).not.toHaveBeenCalled();
  });

  it('rethrows original TypeError when onChunk is not provided even with fallback enabled', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')) as any;

    cloudFallback.setCloudFallbackConfig({ enabled: true, apiKey: 'sk-key' });

    const mockChatStreamCloud = vi.spyOn(cloudFallback, 'chatStreamCloud');

    await expect(chatStream({ text: 'hello' })).rejects.toThrow(TypeError);

    // Cloud should NOT be called when no onChunk handler is present
    expect(mockChatStreamCloud).not.toHaveBeenCalled();
  });

  it('rethrows original TypeError when cloud fallback also fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')) as any;

    cloudFallback.setCloudFallbackConfig({ enabled: true, apiKey: 'sk-key' });

    vi.spyOn(cloudFallback, 'chatStreamCloud').mockRejectedValueOnce(
      new Error('cloud also down')
    );

    await expect(
      chatStream({ text: 'hello', onChunk: () => {} })
    ).rejects.toThrow(TypeError);
  });

  it('does NOT invoke cloud fallback for non-TypeError errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Generic error')) as any;

    cloudFallback.setCloudFallbackConfig({ enabled: true, apiKey: 'sk-key' });

    const mockChatStreamCloud = vi.spyOn(cloudFallback, 'chatStreamCloud');

    await expect(
      chatStream({ text: 'hello', onChunk: () => {} })
    ).rejects.toThrow('Generic error');

    expect(mockChatStreamCloud).not.toHaveBeenCalled();
  });
});
