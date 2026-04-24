// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VoiceConfig } from './voice';

// vi.mock is hoisted — must be at top level so node:child_process is mocked
// before voice.ts module is first imported.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('node:child_process');
  return { ...actual, execFile: vi.fn() };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVoiceConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    enabled: true,
    provider: 'openai',
    model: 'whisper-1',
    language: 'auto',
    whisperBinary: undefined,
    openaiApiKey: undefined,
    ...overrides,
  };
}

/** Build a minimal fetch mock that handles getFile + download + optional OpenAI call */
function makeFetchMock({
  filePath = 'voice/file_123.oga',
  transcriptionText = 'hello world',
  openaiStatus = 200,
}: {
  filePath?: string;
  transcriptionText?: string;
  openaiStatus?: number;
} = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);

    // 1. Telegram getFile
    if (u.includes('/getFile')) {
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: filePath } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    // 2. Telegram file download
    if (u.includes('api.telegram.org/file/')) {
      return new Response(Buffer.from('fake-ogg-bytes'), { status: 200 });
    }

    // 3. OpenAI transcription
    if (u.includes('openai.com/v1/audio/transcriptions')) {
      if (openaiStatus !== 200) {
        return new Response('Bad request', { status: openaiStatus });
      }
      return new Response(
        JSON.stringify({ text: transcriptionText }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    throw new Error(`Unexpected fetch call: ${u}`);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('transcribeTelegramVoice', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Ensure no leaked env key pollutes tests
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  });

  // ── provider: 'openai' ───────────────────────────────────────────────────

  describe("provider 'openai'", () => {
    it('calls getFile, downloads file, POSTs to OpenAI and returns text', async () => {
      const fetchMock = makeFetchMock({ transcriptionText: 'test transcript' });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      const result = await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
      });

      expect(result).toBe('test transcript');

      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls[0]).toContain('/getFile');
      expect(calls[1]).toContain('api.telegram.org/file/');
      expect(calls[2]).toContain('openai.com/v1/audio/transcriptions');
    });

    it('sends Bearer token in Authorization header', async () => {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({ provider: 'openai' }),
        openaiApiKey: 'sk-explicit-key',
      });

      const openaiCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('openai.com'),
      );
      expect(openaiCall).toBeDefined();
      const headers = openaiCall![1]?.headers as Record<string, string>;
      expect(headers?.Authorization).toBe('Bearer sk-explicit-key');
    });

    it('falls back to process.env.OPENAI_API_KEY when no key provided', async () => {
      process.env.OPENAI_API_KEY = 'sk-from-env';
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai' }),
        }),
      ).resolves.toBeDefined();
    });

    it('throws when no API key is available', async () => {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: undefined }),
        }),
      ).rejects.toThrow('OPENAI_API_KEY required');
    });

    it('throws when OpenAI API returns non-200', async () => {
      const fetchMock = makeFetchMock({ openaiStatus: 429 });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('Whisper API error (429)');
    });
  });

  // ── provider disabled ────────────────────────────────────────────────────

  describe('voice disabled', () => {
    it('throws when enabled is false', async () => {
      // No fetch needed — should throw before any network call
      vi.stubGlobal('fetch', vi.fn());

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ enabled: false }),
        }),
      ).rejects.toThrow('voice provider disabled');
    });
  });

  // ── provider: 'local' ────────────────────────────────────────────────────

  describe("provider 'local'", () => {
    it('calls ffmpeg and whisper-cli execFile with expected args, returns parsed text', async () => {
      // Fetch mock for Telegram leg
      const fetchMock = makeFetchMock({ filePath: 'voice/test.oga' });
      vi.stubGlobal('fetch', fetchMock);

      // Mock fs/promises to avoid real disk I/O
      const fsMod = await import('fs');
      vi.spyOn(fsMod.promises, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fsMod.promises, 'unlink').mockResolvedValue(undefined);

      // Retrieve the already-mocked execFile (vi.mock hoisted at top)
      const { execFile: execFileMock } = await import('node:child_process');
      const execFileSpy = execFileMock as unknown as ReturnType<typeof vi.fn>;
      execFileSpy.mockReset();

      // First call = ffmpeg, second call = whisper-cli
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '', stderr: '' });
        },
      );
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '[00:00:00.000 --> 00:00:02.000]  привет мир\n', stderr: '' });
        },
      );

      const { transcribeTelegramVoice } = await import('./voice');
      const result = await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({
          provider: 'local',
          whisperBinary: '/usr/local/bin/whisper-cli',
        }),
      });

      expect(result).toBe('привет мир');

      // Verify ffmpeg call args
      const [ffmpegBin, ffmpegArgs] = execFileSpy.mock.calls[0] as [string, string[]];
      expect(ffmpegBin).toContain('ffmpeg');
      expect(ffmpegArgs).toContain('-ar');
      expect(ffmpegArgs).toContain('16000');
      expect(ffmpegArgs).toContain('-ac');
      expect(ffmpegArgs).toContain('1');

      // Verify whisper-cli call args
      const [whisperBin, whisperArgs] = execFileSpy.mock.calls[1] as [string, string[]];
      expect(whisperBin).toBe('/usr/local/bin/whisper-cli');
      expect(whisperArgs).toContain('-m');
      expect(whisperArgs).toContain('-t');
      expect(whisperArgs).toContain('8');
    });
  });

  // ── language configuration ───────────────────────────────────────────────

  describe('language configuration', () => {
    async function runLocalWithLanguage(language: string) {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const fsMod = await import('fs');
      vi.spyOn(fsMod.promises, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fsMod.promises, 'unlink').mockResolvedValue(undefined);

      const { execFile: execFileMock } = await import('node:child_process');
      const execFileSpy = execFileMock as unknown as ReturnType<typeof vi.fn>;
      execFileSpy.mockReset();

      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '', stderr: '' });
        },
      );
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '[00:00:00.000 --> 00:00:01.000]  hi\n', stderr: '' });
        },
      );

      const { transcribeTelegramVoice } = await import('./voice');
      await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({
          provider: 'local',
          whisperBinary: '/usr/local/bin/whisper-cli',
          language,
        }),
      });

      return execFileSpy.mock.calls[1] as [string, string[]];
    }

    it("local: language 'auto' → no -l flag in whisper-cli args", async () => {
      const [, whisperArgs] = await runLocalWithLanguage('auto');
      expect(whisperArgs).not.toContain('-l');
    });

    it("local: language 'ru' → -l ru in whisper-cli args", async () => {
      const [, whisperArgs] = await runLocalWithLanguage('ru');
      const idx = whisperArgs.indexOf('-l');
      expect(idx).toBeGreaterThan(-1);
      expect(whisperArgs[idx + 1]).toBe('ru');
    });

    it("openai: language 'en' → FormData includes language=en", async () => {
      const fetchMock = makeFetchMock({ transcriptionText: 'hello' });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test', language: 'en' }),
      });

      const openaiCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('openai.com'),
      );
      expect(openaiCall).toBeDefined();
      const formData = openaiCall![1]!.body as FormData;
      expect(formData.get('language')).toBe('en');
    });

    it("openai: language 'auto' → FormData omits language field", async () => {
      const fetchMock = makeFetchMock({ transcriptionText: 'hello' });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test', language: 'auto' }),
      });

      const openaiCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('openai.com'),
      );
      expect(openaiCall).toBeDefined();
      const formData = openaiCall![1]!.body as FormData;
      expect(formData.has('language')).toBe(false);
    });

    it("local: language 'en' → -l en in whisper-cli args", async () => {
      const [, whisperArgs] = await runLocalWithLanguage('en');
      const idx = whisperArgs.indexOf('-l');
      expect(idx).toBeGreaterThan(-1);
      expect(whisperArgs[idx + 1]).toBe('en');
    });
  });

  // ── stdout edge cases (local) ─────────────────────────────────────────────

  describe('local: stdout edge cases', () => {
    async function runLocalWithStdout(stdout: string) {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const fsMod = await import('fs');
      vi.spyOn(fsMod.promises, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fsMod.promises, 'unlink').mockResolvedValue(undefined);

      const { execFile: execFileMock } = await import('node:child_process');
      const execFileSpy = execFileMock as unknown as ReturnType<typeof vi.fn>;
      execFileSpy.mockReset();

      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '', stderr: '' });
        },
      );
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout, stderr: '' });
        },
      );

      const { transcribeTelegramVoice } = await import('./voice');
      return transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({ provider: 'local', whisperBinary: '/usr/local/bin/whisper-cli' }),
      });
    }

    it('empty stdout → returns empty string', async () => {
      const result = await runLocalWithStdout('');
      expect(result).toBe('');
    });

    it('multi-segment stdout → joins segments with space', async () => {
      const result = await runLocalWithStdout(
        '[00:00:00.000 --> 00:00:01.000]  hello\n[00:00:01.000 --> 00:00:02.000]  world\n',
      );
      expect(result).toBe('hello world');
    });
  });

  // ── empty audio buffer ───────────────────────────────────────────────────

  describe('empty audio buffer', () => {
    it('openai: API returns empty text for zero-byte buffer → result is empty string', async () => {
      const fetchMock = makeFetchMock({ transcriptionText: '' });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      const result = await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
      });

      expect(result).toBe('');
    });

    it('openai: API rejects zero-byte audio with 400 → meaningful error propagated', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: 'voice/empty.oga' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (u.includes('api.telegram.org/file/')) {
          // Simulate download returning zero bytes
          return new Response(new Uint8Array(0).buffer, { status: 200 });
        }
        if (u.includes('openai.com/v1/audio/transcriptions')) {
          return new Response('Invalid audio data: empty file', { status: 400 });
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('[voice] Whisper API error (400)');
    });
  });

  // ── large audio buffer (>25 MB Whisper limit) ─────────────────────────────

  describe('large audio buffer (>25 MB Whisper limit)', () => {
    it('openai: API returns 413 for oversized audio → error propagated with status code', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: 'voice/large.oga' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (u.includes('api.telegram.org/file/')) {
          // Buffer is small in test; the 413 is simulated server-side
          return new Response(Buffer.alloc(100), { status: 200 });
        }
        if (u.includes('openai.com/v1/audio/transcriptions')) {
          return new Response('File too large. Max file size is 25 MB.', { status: 413 });
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('[voice] Whisper API error (413)');
    });
  });

  // ── network errors ────────────────────────────────────────────────────────

  describe('network errors', () => {
    it('openai: fetch throws during Whisper API call → error propagated', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: 'voice/file.oga' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (u.includes('api.telegram.org/file/')) {
          return new Response(Buffer.from('fake-ogg'), { status: 200 });
        }
        if (u.includes('openai.com/v1/audio/transcriptions')) {
          throw new TypeError('Failed to fetch');
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('Failed to fetch');
    });

    it('Telegram file download throws network error → propagated before transcription', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: 'voice/file.oga' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (u.includes('api.telegram.org/file/')) {
          throw new TypeError('Failed to fetch');
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('Failed to fetch');
    });
  });

  // ── concurrent transcription requests ─────────────────────────────────────

  describe('concurrent transcription requests', () => {
    it('openai: two concurrent requests complete independently with distinct results', async () => {
      let transcriptionCallCount = 0;
      const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: 'voice/file.oga' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (u.includes('api.telegram.org/file/')) {
          return new Response(Buffer.from('fake-ogg'), { status: 200 });
        }
        if (u.includes('openai.com/v1/audio/transcriptions')) {
          transcriptionCallCount += 1;
          const n = transcriptionCallCount;
          return new Response(
            JSON.stringify({ text: `transcript-${n}` }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      const results = await Promise.all([
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID_1',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID_2',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ]);

      expect(results).toHaveLength(2);
      // Both must succeed and return distinguishable results
      expect(results[0]).toMatch(/^transcript-\d+$/);
      expect(results[1]).toMatch(/^transcript-\d+$/);
      expect(results[0]).not.toBe(results[1]);
    });

    it('local: concurrent requests write to independent temp file paths', async () => {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const fsMod = await import('fs');
      const writtenPaths: string[] = [];
      vi.spyOn(fsMod.promises, 'writeFile').mockImplementation(async (filePath) => {
        writtenPaths.push(String(filePath));
      });
      vi.spyOn(fsMod.promises, 'unlink').mockResolvedValue(undefined);

      const { execFile: execFileMock } = await import('node:child_process');
      const execFileSpy = execFileMock as unknown as ReturnType<typeof vi.fn>;
      execFileSpy.mockReset();
      // Handles all execFile calls (ffmpeg + whisper-cli for both requests)
      execFileSpy.mockImplementation(
        (
          _bin: string,
          _args: string[],
          _opts: unknown,
          cb: (e: null, r: { stdout: string; stderr: string }) => void,
        ) => {
          cb(null, { stdout: '[00:00:00.000 --> 00:00:01.000]  hi\n', stderr: '' });
        },
      );

      const { transcribeTelegramVoice } = await import('./voice');
      await Promise.all([
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID_1',
          voiceConfig: makeVoiceConfig({ provider: 'local', whisperBinary: '/usr/local/bin/whisper-cli' }),
        }),
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID_2',
          voiceConfig: makeVoiceConfig({ provider: 'local', whisperBinary: '/usr/local/bin/whisper-cli' }),
        }),
      ]);

      // Each request writes exactly one .ogg temp file; both paths must be distinct
      expect(writtenPaths).toHaveLength(2);
      expect(writtenPaths[0]).not.toBe(writtenPaths[1]);
    });
  });

  // ── fetchTelegramFileBuffer error paths (lines 34, 38, 44) ─────────────────

  describe('Telegram fetch error paths', () => {
    it('getFile returns non-200 → throws with status code (line 34)', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes('/getFile')) {
          return new Response('Internal Server Error', { status: 500 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('[voice] Telegram getFile failed: 500');
    });

    it('getFile returns ok=false → throws file info error (line 38)', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: false }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('[voice] Failed to get Telegram file info');
    });

    it('getFile returns ok=true but missing file_path → throws file info error (line 38)', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: {} }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('[voice] Failed to get Telegram file info');
    });

    it('audio download returns non-200 → throws with status code (line 44)', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: 'voice/file.oga' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (u.includes('api.telegram.org/file/')) {
          return new Response('Forbidden', { status: 403 });
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test' }),
        }),
      ).rejects.toThrow('[voice] Failed to download voice file: 403');
    });
  });

  // ── unknown provider (lines 180-181) ─────────────────────────────────────

  describe('unknown provider', () => {
    it('throws with unknown provider name (lines 180-181)', async () => {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          // Cast to bypass TypeScript exhaustiveness so we hit the runtime default branch
          voiceConfig: makeVoiceConfig({ provider: 'futuristic' as 'openai' }),
        }),
      ).rejects.toThrow('[voice] unknown provider: futuristic');
    });
  });

  // ── openaiApiKey / model fallbacks ────────────────────────────────────────

  describe('openai: key and model fallbacks', () => {
    it('uses voiceConfig.openaiApiKey when no explicit openaiApiKey arg (line 59)', async () => {
      const fetchMock = makeFetchMock({ transcriptionText: 'from-config-key' });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      const result = await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        // openaiApiKey arg is omitted; key comes from voiceConfig
        voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-from-config' }),
      });

      expect(result).toBe('from-config-key');

      const openaiCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('openai.com'),
      );
      const headers = openaiCall![1]?.headers as Record<string, string>;
      expect(headers?.Authorization).toBe('Bearer sk-from-config');
    });

    it('uses whisper-1 as default model when voiceConfig.model is undefined (line 67)', async () => {
      const fetchMock = makeFetchMock({ transcriptionText: 'default model' });
      vi.stubGlobal('fetch', fetchMock);

      const { transcribeTelegramVoice } = await import('./voice');
      await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        voiceConfig: makeVoiceConfig({ provider: 'openai', openaiApiKey: 'sk-test', model: undefined }),
      });

      const openaiCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('openai.com'),
      );
      const formData = openaiCall![1]!.body as FormData;
      expect(formData.get('model')).toBe('whisper-1');
    });
  });

  // ── local: env-var binary paths ───────────────────────────────────────────

  describe('local: WHISPER_CLI_PATH env var (line 104)', () => {
    it('uses WHISPER_CLI_PATH env var when whisperBinary is not set', async () => {
      process.env.WHISPER_CLI_PATH = '/env/whisper-cli';
      process.env.FFMPEG_PATH = '/env/ffmpeg';

      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const fsMod = await import('fs');
      vi.spyOn(fsMod.promises, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fsMod.promises, 'unlink').mockResolvedValue(undefined);

      const { execFile: execFileMock } = await import('node:child_process');
      const execFileSpy = execFileMock as unknown as ReturnType<typeof vi.fn>;
      execFileSpy.mockReset();

      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '', stderr: '' });
        },
      );
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '[00:00:00.000 --> 00:00:01.000]  hi\n', stderr: '' });
        },
      );

      const { transcribeTelegramVoice } = await import('./voice');
      await transcribeTelegramVoice({
        botToken: 'BOT_TOKEN',
        fileId: 'FILE_ID',
        // whisperBinary not set → should fall back to env var
        voiceConfig: makeVoiceConfig({ provider: 'local', whisperBinary: undefined }),
      });

      const [ffmpegBin] = execFileSpy.mock.calls[0] as [string, string[]];
      const [whisperBin] = execFileSpy.mock.calls[1] as [string, string[]];
      expect(ffmpegBin).toBe('/env/ffmpeg');
      expect(whisperBin).toBe('/env/whisper-cli');

      delete process.env.WHISPER_CLI_PATH;
      delete process.env.FFMPEG_PATH;
    });
  });

  // ── error cases (local) ──────────────────────────────────────────────────

  describe('local: error handling', () => {
    it('non-zero exit from whisper-cli → error is surfaced', async () => {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const fsMod = await import('fs');
      const unlinkSpy = vi.spyOn(fsMod.promises, 'unlink').mockResolvedValue(undefined);
      vi.spyOn(fsMod.promises, 'writeFile').mockResolvedValue(undefined);

      const { execFile: execFileMock } = await import('node:child_process');
      const execFileSpy = execFileMock as unknown as ReturnType<typeof vi.fn>;
      execFileSpy.mockReset();

      // ffmpeg succeeds
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: '', stderr: '' });
        },
      );
      // whisper-cli fails
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: Error, r: null) => void) => {
          cb(new Error('whisper-cli exited with code 1'), null);
        },
      );

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'local', whisperBinary: '/usr/local/bin/whisper-cli' }),
        }),
      ).rejects.toThrow('whisper-cli exited with code 1');

      // Temp files must still be cleaned up despite the error
      expect(unlinkSpy).toHaveBeenCalledTimes(2);
    });

    it('missing whisper binary (ffmpeg fails) → error surfaced and temp files cleaned up', async () => {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const fsMod = await import('fs');
      const unlinkSpy = vi.spyOn(fsMod.promises, 'unlink').mockResolvedValue(undefined);
      vi.spyOn(fsMod.promises, 'writeFile').mockResolvedValue(undefined);

      const { execFile: execFileMock } = await import('node:child_process');
      const execFileSpy = execFileMock as unknown as ReturnType<typeof vi.fn>;
      execFileSpy.mockReset();

      // ffmpeg fails (simulates missing binary)
      execFileSpy.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: unknown, cb: (e: Error, r: null) => void) => {
          const err = new Error('spawn /opt/homebrew/bin/ffmpeg ENOENT');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          cb(err, null);
        },
      );

      const { transcribeTelegramVoice } = await import('./voice');
      await expect(
        transcribeTelegramVoice({
          botToken: 'BOT_TOKEN',
          fileId: 'FILE_ID',
          voiceConfig: makeVoiceConfig({ provider: 'local', whisperBinary: '/no/such/whisper-cli' }),
        }),
      ).rejects.toThrow('ENOENT');

      // Even on ffmpeg failure, the temp .ogg file (and attempt for .wav) must be unlinked
      expect(unlinkSpy).toHaveBeenCalledTimes(2);
    });
  });
});
