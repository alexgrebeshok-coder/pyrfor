import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fsList, fsRead, chat, exec, detectLanguage } from './api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('detectLanguage', () => {
  it('detects typescript', () => expect(detectLanguage('foo.ts')).toBe('typescript'));
  it('detects tsx', () => expect(detectLanguage('App.tsx')).toBe('typescript'));
  it('detects javascript', () => expect(detectLanguage('app.js')).toBe('javascript'));
  it('detects python', () => expect(detectLanguage('main.py')).toBe('python'));
  it('detects json', () => expect(detectLanguage('package.json')).toBe('json'));
  it('defaults to plaintext', () => expect(detectLanguage('Makefile')).toBe('plaintext'));
});

describe('apiFetch wrappers', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockReset();
  });

  it('fsList calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ path: '/test', entries: [] }),
    });
    const result = await fsList('/test');
    expect(result.entries).toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/fs/list?path=%2Ftest'),
      expect.any(Object)
    );
  });

  it('chat posts to /api/chat', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: 'Hello!' }),
    });
    const result = await chat('Hi');
    expect(result.reply).toBe('Hello!');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/chat'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('exec posts to /api/exec', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stdout: 'ok', stderr: '', exitCode: 0, durationMs: 50 }),
    });
    const result = await exec('ls');
    expect(result.exitCode).toBe(0);
  });

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found', code: 'ENOENT' }),
    });
    await expect(fsRead('/missing')).rejects.toThrow('Not found');
  });
});
