// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import {
  createVoiceOutput,
  mockTtsProvider,
  TtsError,
  type TtsRequest,
  type TtsResult,
  type TtsProvider,
} from './voice-output';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `vo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function cleanTmpDirs(): void {
  for (const dir of tmpDirs) {
    try {
      const { rmSync } = require('fs');
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  tmpDirs = [];
}

afterEach(() => cleanTmpDirs());

function makeProvider(audio: Buffer = Buffer.from('audio'), format = 'mp3', durationMs = 100): TtsProvider {
  return async (_req: TtsRequest): Promise<TtsResult> => ({ audio, format, durationMs });
}

function failingProvider(msg = 'fail'): TtsProvider {
  return async () => { throw new Error(msg); };
}

let clockVal = 1000;
function fakeClock(): number { return clockVal++; }

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VoiceOutput', () => {
  describe('synthesize — provider selection', () => {
    it('uses the only provider when one configured', async () => {
      const audio = Buffer.from('hello-audio');
      const vo = createVoiceOutput({ providers: [{ name: 'p1', provider: makeProvider(audio) }] });
      const result = await vo.synthesize({ text: 'hello' });
      expect(result.audio).toEqual(audio);
    });

    it('uses highest-priority provider first', async () => {
      const hi = Buffer.from('hi-priority');
      const lo = Buffer.from('lo-priority');
      const vo = createVoiceOutput({
        providers: [
          { name: 'lo', provider: makeProvider(lo), priority: 1 },
          { name: 'hi', provider: makeProvider(hi), priority: 10 },
        ],
      });
      const result = await vo.synthesize({ text: 'test' });
      expect(result.audio).toEqual(hi);
    });

    it('falls back to next provider when highest-priority fails', async () => {
      const fallback = Buffer.from('fallback');
      const vo = createVoiceOutput({
        providers: [
          { name: 'good', provider: makeProvider(fallback), priority: 1 },
          { name: 'bad', provider: failingProvider(), priority: 10 },
        ],
      });
      const result = await vo.synthesize({ text: 'test' });
      expect(result.audio).toEqual(fallback);
    });

    it('throws TTS_ALL_FAILED with cause when all providers fail', async () => {
      const vo = createVoiceOutput({
        providers: [
          { name: 'p1', provider: failingProvider('err1') },
          { name: 'p2', provider: failingProvider('err2') },
        ],
      });
      let caught: unknown;
      try { await vo.synthesize({ text: 'test' }); }
      catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(TtsError);
      const err = caught as TtsError;
      expect(err.code).toBe('TTS_ALL_FAILED');
      expect(err.cause?.errors).toHaveLength(2);
      expect(err.cause?.errors[0].message).toBe('err1');
      expect(err.cause?.errors[1].message).toBe('err2');
    });

    it('throws TTS_NO_PROVIDER when no providers configured', async () => {
      const vo = createVoiceOutput({ providers: [] });
      let caught: unknown;
      try { await vo.synthesize({ text: 'test' }); }
      catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(TtsError);
      expect((caught as TtsError).code).toBe('TTS_NO_PROVIDER');
    });

    it('applies defaultFormat when request has no format', async () => {
      let capturedReq: TtsRequest | null = null;
      const provider: TtsProvider = async (req) => {
        capturedReq = req;
        return { audio: Buffer.from('x'), format: req.format ?? 'mp3' };
      };
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], defaultFormat: 'wav' });
      await vo.synthesize({ text: 'hi' });
      expect(capturedReq?.format).toBe('wav');
    });

    it('applies defaultVoice when request has no voice', async () => {
      let capturedReq: TtsRequest | null = null;
      const provider: TtsProvider = async (req) => {
        capturedReq = req;
        return { audio: Buffer.from('x'), format: 'mp3' };
      };
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], defaultVoice: 'en-US' });
      await vo.synthesize({ text: 'hi' });
      expect(capturedReq?.voice).toBe('en-US');
    });
  });

  describe('caching', () => {
    it('returns cached=true on cache hit and skips provider', async () => {
      const cacheDir = makeTmpDir();
      let callCount = 0;
      const provider: TtsProvider = async (req) => {
        callCount++;
        return { audio: Buffer.from('data'), format: 'mp3' };
      };
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], cacheDir });
      await vo.synthesize({ text: 'hello' });
      const second = await vo.synthesize({ text: 'hello' });
      expect(callCount).toBe(1);
      expect(second.cached).toBe(true);
    });

    it('cache miss calls provider', async () => {
      const cacheDir = makeTmpDir();
      let callCount = 0;
      const provider: TtsProvider = async () => {
        callCount++;
        return { audio: Buffer.from('data'), format: 'mp3' };
      };
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], cacheDir });
      await vo.synthesize({ text: 'unique-request-xyz' });
      expect(callCount).toBe(1);
    });

    it('different voices produce different cache keys', async () => {
      const cacheDir = makeTmpDir();
      let callCount = 0;
      const provider: TtsProvider = async () => {
        callCount++;
        return { audio: Buffer.from('data'), format: 'mp3' };
      };
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], cacheDir });
      await vo.synthesize({ text: 'hello', voice: 'alice' });
      await vo.synthesize({ text: 'hello', voice: 'bob' });
      expect(callCount).toBe(2);
    });

    it('different formats produce different cache keys', async () => {
      const cacheDir = makeTmpDir();
      let callCount = 0;
      const provider: TtsProvider = async (req) => {
        callCount++;
        return { audio: Buffer.from('data'), format: req.format ?? 'mp3' };
      };
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], cacheDir });
      await vo.synthesize({ text: 'hello', format: 'mp3' });
      await vo.synthesize({ text: 'hello', format: 'wav' });
      expect(callCount).toBe(2);
    });

    it('getCacheSize returns accurate byte count', async () => {
      const cacheDir = makeTmpDir();
      const audio = Buffer.alloc(512, 0);
      const provider: TtsProvider = async () => ({ audio, format: 'mp3' });
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], cacheDir });
      await vo.synthesize({ text: 'hello-size-test' });
      expect(vo.getCacheSize()).toBe(512);
    });

    it('getCacheSize returns 0 when no cacheDir', () => {
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider: makeProvider() }] });
      expect(vo.getCacheSize()).toBe(0);
    });

    it('clearCache empties the cache directory', async () => {
      const cacheDir = makeTmpDir();
      const provider: TtsProvider = async () => ({ audio: Buffer.from('abc'), format: 'mp3' });
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], cacheDir });
      await vo.synthesize({ text: 'clear-test' });
      expect(vo.getCacheSize()).toBeGreaterThan(0);
      vo.clearCache();
      expect(vo.getCacheSize()).toBe(0);
    });

    it('LRU eviction removes oldest files when cacheMaxBytes exceeded', async () => {
      const cacheDir = makeTmpDir();
      const audio = Buffer.alloc(100, 0);
      // max 250 bytes → after 3 writes (300 bytes) oldest is evicted
      const cacheMaxBytes = 250;
      let idx = 0;
      const provider: TtsProvider = async (req) => ({ audio, format: 'mp3' });
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider }], cacheDir, cacheMaxBytes });

      await vo.synthesize({ text: 'text-lru-1' });
      // Touch file to ensure different mtime ordering
      await new Promise<void>(r => setTimeout(r, 10));
      await vo.synthesize({ text: 'text-lru-2' });
      await new Promise<void>(r => setTimeout(r, 10));
      await vo.synthesize({ text: 'text-lru-3' });

      expect(vo.getCacheSize()).toBeLessThanOrEqual(cacheMaxBytes);
    });
  });

  describe('getStats', () => {
    it('tracks misses on cache miss', async () => {
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider: makeProvider() }] });
      await vo.synthesize({ text: 'miss-test' });
      expect(vo.getStats().misses).toBe(1);
      expect(vo.getStats().hits).toBe(0);
    });

    it('tracks hits on cache hit', async () => {
      const cacheDir = makeTmpDir();
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider: makeProvider() }], cacheDir });
      await vo.synthesize({ text: 'stat-hit' });
      await vo.synthesize({ text: 'stat-hit' });
      expect(vo.getStats().hits).toBe(1);
      expect(vo.getStats().misses).toBe(1);
    });

    it('tracks errors when provider fails', async () => {
      const vo = createVoiceOutput({
        providers: [
          { name: 'bad', provider: failingProvider(), priority: 10 },
          { name: 'good', provider: makeProvider(), priority: 1 },
        ],
      });
      await vo.synthesize({ text: 'err-stat' });
      expect(vo.getStats().errors).toBe(1);
    });

    it('tracks providerUses per provider name', async () => {
      const vo = createVoiceOutput({ providers: [{ name: 'myProv', provider: makeProvider() }] });
      await vo.synthesize({ text: 'use-1' });
      await vo.synthesize({ text: 'use-2' });
      expect(vo.getStats().providerUses['myProv']).toBe(2);
    });

    it('getStats returns a snapshot copy (not mutable reference)', async () => {
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider: makeProvider() }] });
      await vo.synthesize({ text: 'snap-test' });
      const snap = vo.getStats();
      snap.hits = 999;
      expect(vo.getStats().hits).toBe(0);
    });
  });

  describe('synthesizeToFile', () => {
    it('writes audio buffer to disk', async () => {
      const cacheDir = makeTmpDir();
      const outDir = makeTmpDir();
      const audio = Buffer.from('file-audio-content');
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider: makeProvider(audio) }], cacheDir });
      const outPath = path.join(outDir, 'out.mp3');
      await vo.synthesizeToFile({ text: 'file-test' }, outPath);
      const { readFileSync } = require('fs');
      expect(readFileSync(outPath)).toEqual(audio);
    });

    it('returns TtsResult from synthesizeToFile', async () => {
      const outDir = makeTmpDir();
      const audio = Buffer.from('result-audio');
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider: makeProvider(audio) }] });
      const result = await vo.synthesizeToFile({ text: 'res-test' }, path.join(outDir, 'res.mp3'));
      expect(result.audio).toEqual(audio);
    });

    it('synthesizeToFile creates parent directories', async () => {
      const baseDir = makeTmpDir();
      const outPath = path.join(baseDir, 'deep', 'nested', 'out.mp3');
      const vo = createVoiceOutput({ providers: [{ name: 'p', provider: makeProvider() }] });
      await vo.synthesizeToFile({ text: 'deep-test' }, outPath);
      expect(existsSync(outPath)).toBe(true);
    });
  });

  describe('mockTtsProvider', () => {
    it('returns a TtsResult with a non-empty buffer', async () => {
      const provider = mockTtsProvider();
      const result = await provider({ text: 'mock-test' });
      expect(result.audio.length).toBeGreaterThan(0);
    });

    it('is deterministic given same input', async () => {
      const provider = mockTtsProvider();
      const r1 = await provider({ text: 'same', format: 'mp3' });
      const r2 = await provider({ text: 'same', format: 'mp3' });
      expect(r1.audio).toEqual(r2.audio);
    });

    it('produces different output for different text', async () => {
      const provider = mockTtsProvider();
      const r1 = await provider({ text: 'aaa' });
      const r2 = await provider({ text: 'bbb' });
      expect(r1.audio).not.toEqual(r2.audio);
    });

    it('failRate=1 always throws', async () => {
      const provider = mockTtsProvider({ failRate: 1 });
      await expect(provider({ text: 'test' })).rejects.toThrow();
    });

    it('failRate=0 never throws', async () => {
      const provider = mockTtsProvider({ failRate: 0 });
      await expect(provider({ text: 'test' })).resolves.toBeDefined();
    });

    it('deterministic given seeded rng', async () => {
      let seed = 0;
      const rng = () => { seed = (seed + 0.1) % 1; return seed; };
      const p1 = mockTtsProvider({ rng });
      seed = 0;
      const p2 = mockTtsProvider({ rng });
      const r1 = await p1({ text: 'seeded' });
      seed = 0;
      const r2 = await p2({ text: 'seeded' });
      expect(r1.audio).toEqual(r2.audio);
    });

    it('mockTtsProvider with failRate=1 causes TTS_ALL_FAILED', async () => {
      const vo = createVoiceOutput({
        providers: [{ name: 'mock', provider: mockTtsProvider({ failRate: 1 }) }],
      });
      await expect(vo.synthesize({ text: 'fail' })).rejects.toMatchObject({ code: 'TTS_ALL_FAILED' });
    });
  });
});
