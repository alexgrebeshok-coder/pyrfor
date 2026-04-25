// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createTranslatorRouter,
  type TranslateProvider,
  type TranslateRequest,
} from './translator-router';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeProvider(
  text: string,
  opts: { detectedFrom?: string; delay?: number } = {},
): TranslateProvider {
  return async () => {
    if (opts.delay) await new Promise<void>((r) => setTimeout(r, opts.delay));
    return { text, ...(opts.detectedFrom ? { detectedFrom: opts.detectedFrom } : {}) };
  };
}

function makeFailProvider(msg = 'provider failed'): TranslateProvider {
  return async () => {
    throw new Error(msg);
  };
}

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `tr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ─── detectLanguage ────────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  const router = createTranslatorRouter({ providers: [] });

  it('detects Russian (Cyrillic)', async () => {
    expect(await router.detectLanguage('привет мир')).toBe('ru');
  });

  it('detects Chinese (CJK)', async () => {
    expect(await router.detectLanguage('你好世界')).toBe('zh');
  });

  it('detects Japanese (Kana)', async () => {
    expect(await router.detectLanguage('こんにちは')).toBe('ja');
  });

  it('defaults to English for Latin text', async () => {
    expect(await router.detectLanguage('hello world')).toBe('en');
  });

  it('uses opts.detect override', async () => {
    const detect = vi.fn().mockResolvedValue('fr');
    const r = createTranslatorRouter({ providers: [], detect });
    expect(await r.detectLanguage('bonjour')).toBe('fr');
    expect(detect).toHaveBeenCalledWith('bonjour');
  });
});

// ─── translate — provider selection ────────────────────────────────────────────

describe('translate — provider selection', () => {
  it('uses highest-priority provider', async () => {
    const low = vi.fn().mockResolvedValue({ text: 'low' });
    const high = vi.fn().mockResolvedValue({ text: 'high' });
    const router = createTranslatorRouter({
      providers: [
        { name: 'low', provider: low, priority: 1 },
        { name: 'high', provider: high, priority: 10 },
      ],
    });
    const result = await router.translate({ text: 'hello', from: 'en', to: 'es' });
    expect(result.text).toBe('high');
    expect(result.provider).toBe('high');
    expect(low).not.toHaveBeenCalled();
  });

  it('includes provider name and cached: false on first call', async () => {
    const router = createTranslatorRouter({
      providers: [{ name: 'alpha', provider: makeProvider('hola') }],
    });
    const result = await router.translate({ text: 'hello', from: 'en', to: 'es' });
    expect(result.provider).toBe('alpha');
    expect(result.cached).toBe(false);
  });

  it('falls back to next provider on error', async () => {
    const router = createTranslatorRouter({
      providers: [
        { name: 'bad', provider: makeFailProvider(), priority: 10 },
        { name: 'good', provider: makeProvider('hola'), priority: 1 },
      ],
    });
    const result = await router.translate({ text: 'hello', from: 'en', to: 'es' });
    expect(result.text).toBe('hola');
    expect(result.provider).toBe('good');
  });

  it('throws TRANSLATE_ALL_FAILED with cause.errors when all providers fail', async () => {
    const router = createTranslatorRouter({
      providers: [
        { name: 'p1', provider: makeFailProvider('e1') },
        { name: 'p2', provider: makeFailProvider('e2') },
      ],
    });
    await expect(router.translate({ text: 'hello', from: 'en', to: 'es' })).rejects.toMatchObject({
      code: 'TRANSLATE_ALL_FAILED',
      cause: { errors: expect.arrayContaining([expect.any(Error)]) },
    });
  });

  it('cause.errors contains all provider errors', async () => {
    const router = createTranslatorRouter({
      providers: [
        { name: 'p1', provider: makeFailProvider('err-one') },
        { name: 'p2', provider: makeFailProvider('err-two') },
      ],
    });
    let caught: any;
    try {
      await router.translate({ text: 'hi', from: 'en', to: 'de' });
    } catch (e) {
      caught = e;
    }
    expect(caught.cause.errors).toHaveLength(2);
    expect(caught.cause.errors[0].message).toBe('err-one');
    expect(caught.cause.errors[1].message).toBe('err-two');
  });

  it('throws TRANSLATE_NO_PROVIDER when no providers configured', async () => {
    const router = createTranslatorRouter({ providers: [] });
    await expect(router.translate({ text: 'hi', from: 'en', to: 'de' })).rejects.toMatchObject({
      code: 'TRANSLATE_NO_PROVIDER',
    });
  });

  it('supportsLangs: excludes provider when lang pair not supported', async () => {
    const restricted = vi.fn().mockResolvedValue({ text: 'restricted' });
    const general = vi.fn().mockResolvedValue({ text: 'general' });
    const router = createTranslatorRouter({
      providers: [
        { name: 'restricted', provider: restricted, priority: 10, supportsLangs: ['en', 'es'] },
        { name: 'general', provider: general, priority: 1 },
      ],
    });
    // from='ru' is not in supportsLangs of 'restricted'
    const result = await router.translate({ text: 'привет', from: 'ru', to: 'en' });
    expect(restricted).not.toHaveBeenCalled();
    expect(result.provider).toBe('general');
  });

  it('supportsLangs: throws TRANSLATE_ALL_FAILED when all are filtered', async () => {
    const router = createTranslatorRouter({
      providers: [{ name: 'en-es-only', provider: makeProvider('ok'), supportsLangs: ['en', 'es'] }],
    });
    await expect(
      router.translate({ text: 'hello', from: 'en', to: 'de' }),
    ).rejects.toMatchObject({ code: 'TRANSLATE_ALL_FAILED' });
  });
});

// ─── translate — language detection ────────────────────────────────────────────

describe('translate — language detection', () => {
  it('from="auto" triggers detect', async () => {
    const detect = vi.fn().mockResolvedValue('ru');
    const provider = vi.fn().mockResolvedValue({ text: 'translated' });
    const router = createTranslatorRouter({
      providers: [{ name: 'p', provider }],
      detect,
    });
    const result = await router.translate({ text: 'привет', from: 'auto', to: 'en' });
    expect(detect).toHaveBeenCalledWith('привет');
    expect(result.from).toBe('ru');
  });

  it('from=undefined with no detect uses defaultFrom', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'translated' });
    const router = createTranslatorRouter({
      providers: [{ name: 'p', provider }],
      defaultFrom: 'de',
    });
    const result = await router.translate({ text: 'hallo', to: 'en' });
    expect(result.from).toBe('de');
  });

  it('from=undefined with detect calls detect instead of defaultFrom', async () => {
    const detect = vi.fn().mockResolvedValue('fr');
    const provider = vi.fn().mockResolvedValue({ text: 'hi' });
    const router = createTranslatorRouter({
      providers: [{ name: 'p', provider }],
      detect,
      defaultFrom: 'de',
    });
    const result = await router.translate({ text: 'bonjour', to: 'en' });
    expect(detect).toHaveBeenCalled();
    expect(result.from).toBe('fr');
  });

  it('from=undefined with no detect and no defaultFrom falls back to heuristic', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'translated' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    const result = await router.translate({ text: 'привет', to: 'en' });
    expect(result.from).toBe('ru');
  });

  it('uses detectedFrom from provider response', async () => {
    const provider = makeProvider('translated', { detectedFrom: 'pt' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    const result = await router.translate({ text: 'olá', from: 'auto', to: 'en' });
    expect(result.from).toBe('pt');
  });
});

// ─── translate — caching ────────────────────────────────────────────────────────

describe('translate — caching', () => {
  it('second call returns cached: true', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'hola' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    await router.translate({ text: 'hello', from: 'en', to: 'es' });
    const result = await router.translate({ text: 'hello', from: 'en', to: 'es' });
    expect(result.cached).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('different "to" language bypasses cache', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'translated' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    await router.translate({ text: 'hello', from: 'en', to: 'es' });
    await router.translate({ text: 'hello', from: 'en', to: 'de' });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('different "from" bypasses cache', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'translated' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    await router.translate({ text: 'hello', from: 'en', to: 'es' });
    await router.translate({ text: 'hello', from: 'fr', to: 'es' });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('disk cache is read by a new router instance', async () => {
    const cacheDir = makeTmpDir();
    const p1 = vi.fn().mockResolvedValue({ text: 'hola' });
    const r1 = createTranslatorRouter({ providers: [{ name: 'p', provider: p1 }], cacheDir });
    await r1.translate({ text: 'hello', from: 'en', to: 'es' });

    const p2 = vi.fn().mockResolvedValue({ text: 'should-not-be-called' });
    const r2 = createTranslatorRouter({ providers: [{ name: 'p', provider: p2 }], cacheDir });
    const result = await r2.translate({ text: 'hello', from: 'en', to: 'es' });
    expect(result.cached).toBe(true);
    expect(p2).not.toHaveBeenCalled();
  });

  it('atomic write: no .tmp file left after translate', async () => {
    const cacheDir = makeTmpDir();
    const router = createTranslatorRouter({
      providers: [{ name: 'p', provider: makeProvider('hola') }],
      cacheDir,
    });
    await router.translate({ text: 'hello', from: 'en', to: 'es' });
    const files = fs.readdirSync(cacheDir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('empty text returns empty result without calling provider', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'should-not' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    const result = await router.translate({ text: '', from: 'en', to: 'es' });
    expect(result.text).toBe('');
    expect(provider).not.toHaveBeenCalled();
  });
});

// ─── cacheSize & clearCache ────────────────────────────────────────────────────

describe('cacheSize and clearCache', () => {
  it('cacheSize increases with each unique translation', async () => {
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider: makeProvider('x') }] });
    expect(router.cacheSize()).toBe(0);
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    expect(router.cacheSize()).toBe(1);
    await router.translate({ text: 'b', from: 'en', to: 'es' });
    expect(router.cacheSize()).toBe(2);
  });

  it('repeated calls with same key do not grow cacheSize', async () => {
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider: makeProvider('x') }] });
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    expect(router.cacheSize()).toBe(1);
  });

  it('clearCache empties memory cache', async () => {
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider: makeProvider('x') }] });
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    await router.clearCache();
    expect(router.cacheSize()).toBe(0);
  });

  it('after clearCache, next translate is a fresh call', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'hola' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    await router.translate({ text: 'hello', from: 'en', to: 'es' });
    await router.clearCache();
    const result = await router.translate({ text: 'hello', from: 'en', to: 'es' });
    expect(result.cached).toBe(false);
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

// ─── maxCacheEntries LRU eviction ─────────────────────────────────────────────

describe('maxCacheEntries LRU eviction', () => {
  it('evicts oldest entry when limit exceeded', async () => {
    const provider = vi.fn().mockImplementation(async (req: TranslateRequest) => ({ text: `t-${req.text}` }));
    const router = createTranslatorRouter({
      providers: [{ name: 'p', provider }],
      maxCacheEntries: 2,
    });
    await router.translate({ text: 'a', from: 'en', to: 'es' }); // oldest
    await router.translate({ text: 'b', from: 'en', to: 'es' });
    // Adding 'c' should evict 'a'
    await router.translate({ text: 'c', from: 'en', to: 'es' });
    expect(router.cacheSize()).toBe(2);

    // 'a' was evicted — should re-call provider
    provider.mockClear();
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('LRU: accessing entry prevents its eviction', async () => {
    const provider = vi.fn().mockImplementation(async (req: TranslateRequest) => ({ text: `t-${req.text}` }));
    const router = createTranslatorRouter({
      providers: [{ name: 'p', provider }],
      maxCacheEntries: 2,
    });
    await router.translate({ text: 'a', from: 'en', to: 'es' }); // would be oldest
    await router.translate({ text: 'b', from: 'en', to: 'es' });
    // Access 'a' to make it recently used
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    // Now 'b' is oldest; adding 'c' should evict 'b'
    await router.translate({ text: 'c', from: 'en', to: 'es' });

    provider.mockClear();
    // 'a' should still be cached
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    expect(provider).not.toHaveBeenCalled();
    // 'b' should have been evicted
    await router.translate({ text: 'b', from: 'en', to: 'es' });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

// ─── translateBatch ────────────────────────────────────────────────────────────

describe('translateBatch', () => {
  it('preserves input order', async () => {
    const router = createTranslatorRouter({
      providers: [
        {
          name: 'p',
          provider: async (req) => ({ text: `translated-${req.text}` }),
        },
      ],
    });
    const results = await router.translateBatch([
      { text: 'one', from: 'en', to: 'es' },
      { text: 'two', from: 'en', to: 'es' },
      { text: 'three', from: 'en', to: 'es' },
    ]);
    expect(results.map((r) => r.text)).toEqual([
      'translated-one',
      'translated-two',
      'translated-three',
    ]);
  });

  it('parallelizes requests (total time < sum of individual delays)', async () => {
    const DELAY = 40;
    const router = createTranslatorRouter({
      providers: [{ name: 'p', provider: makeProvider('ok', { delay: DELAY }) }],
    });
    const reqs = [
      { text: 'a', from: 'en', to: 'es' },
      { text: 'b', from: 'en', to: 'es' },
      { text: 'c', from: 'en', to: 'es' },
    ];
    const start = Date.now();
    await router.translateBatch(reqs);
    const elapsed = Date.now() - start;
    // Sequential would be 3 * DELAY = 120ms; parallel should be ~DELAY
    expect(elapsed).toBeLessThan(DELAY * 2.5);
  });

  it('returns all results even when some are cached', async () => {
    const provider = vi.fn().mockResolvedValue({ text: 'done' });
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider }] });
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    const results = await router.translateBatch([
      { text: 'a', from: 'en', to: 'es' },
      { text: 'b', from: 'en', to: 'es' },
    ]);
    expect(results[0].cached).toBe(true);
    expect(results[1].cached).toBe(false);
  });
});

// ─── getStats ──────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('counts total calls', async () => {
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider: makeProvider('x') }] });
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    await router.translate({ text: 'b', from: 'en', to: 'es' });
    expect(router.getStats().calls).toBe(2);
  });

  it('counts cache hits', async () => {
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider: makeProvider('x') }] });
    await router.translate({ text: 'a', from: 'en', to: 'es' });
    await router.translate({ text: 'a', from: 'en', to: 'es' }); // hit
    expect(router.getStats().cacheHits).toBe(1);
  });

  it('counts provider errors', async () => {
    const router = createTranslatorRouter({
      providers: [
        { name: 'bad', provider: makeFailProvider(), priority: 10 },
        { name: 'good', provider: makeProvider('ok'), priority: 1 },
      ],
    });
    await router.translate({ text: 'hi', from: 'en', to: 'es' });
    expect(router.getStats().providerErrors).toBe(1);
  });

  it('tracks perProvider calls and errors', async () => {
    const router = createTranslatorRouter({
      providers: [
        { name: 'bad', provider: makeFailProvider(), priority: 10 },
        { name: 'good', provider: makeProvider('ok'), priority: 1 },
      ],
    });
    await router.translate({ text: 'hi', from: 'en', to: 'es' });
    const s = router.getStats();
    expect(s.perProvider['bad'].calls).toBe(1);
    expect(s.perProvider['bad'].errors).toBe(1);
    expect(s.perProvider['good'].calls).toBe(1);
    expect(s.perProvider['good'].errors).toBe(0);
  });

  it('getStats returns a snapshot (mutation does not affect internal state)', async () => {
    const router = createTranslatorRouter({ providers: [{ name: 'p', provider: makeProvider('x') }] });
    const s1 = router.getStats();
    s1.calls = 999;
    expect(router.getStats().calls).toBe(0);
  });
});
