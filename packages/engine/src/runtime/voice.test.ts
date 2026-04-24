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
      const execFileSpy = execFileMock as ReturnType<typeof vi.fn>;
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
});
