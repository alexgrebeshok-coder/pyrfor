// @vitest-environment node
import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Public Types ──────────────────────────────────────────────────────────────

export interface TranslateRequest {
  text: string;
  from?: string;
  to: string;
}

export interface TranslateResult {
  text: string;
  from: string;
  to: string;
  provider: string;
  cached: boolean;
}

export type TranslateProvider = (
  req: TranslateRequest,
) => Promise<{ text: string; detectedFrom?: string }>;

export type DetectLanguage = (text: string) => Promise<string> | string;

// ─── Options & Router Interface ────────────────────────────────────────────────

export interface TranslatorRouterOpts {
  providers: {
    name: string;
    provider: TranslateProvider;
    priority?: number;
    supportsLangs?: string[];
  }[];
  detect?: DetectLanguage;
  cacheDir?: string;
  maxCacheEntries?: number;
  defaultFrom?: string;
  clock?: () => number;
}

export interface RouterStats {
  calls: number;
  cacheHits: number;
  providerErrors: number;
  perProvider: Record<string, { calls: number; errors: number }>;
}

export interface TranslatorRouter {
  translate(req: TranslateRequest): Promise<TranslateResult>;
  translateBatch(reqs: TranslateRequest[]): Promise<TranslateResult[]>;
  detectLanguage(text: string): Promise<string>;
  clearCache(): Promise<void>;
  cacheSize(): number;
  getStats(): RouterStats;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  text: string;
  from: string;
  to: string;
  provider: string;
  ts: number;
}

// ─── Default Detect Heuristic ─────────────────────────────────────────────────

function defaultHeuristic(text: string): string {
  if (/[а-яА-Я]/.test(text)) return 'ru';
  if (/[一-龥]/.test(text)) return 'zh';
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
  return 'en';
}

// ─── Cache Key ─────────────────────────────────────────────────────────────────

function makeCacheKey(from: string, to: string, text: string): string {
  return crypto.createHash('sha256').update(`${from}\n${to}\n${text}`).digest('hex');
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createTranslatorRouter(opts: TranslatorRouterOpts): TranslatorRouter {
  const { providers, detect: detectFn, cacheDir, maxCacheEntries, defaultFrom, clock = Date.now } =
    opts;

  // Sort by priority descending; higher priority → tried first
  const sorted = [...providers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // LRU via Map insertion order: delete+reinsert on access, evict first key on overflow
  const memCache = new Map<string, CacheEntry>();

  const stats: RouterStats = {
    calls: 0,
    cacheHits: 0,
    providerErrors: 0,
    perProvider: Object.fromEntries(providers.map((p) => [p.name, { calls: 0, errors: 0 }])),
  };

  // ── Disk helpers ────────────────────────────────────────────────────────────

  function diskPath(key: string): string {
    return path.join(cacheDir ?? os.tmpdir(), `trcache-${key}.json`);
  }

  async function diskGet(key: string): Promise<CacheEntry | undefined> {
    if (!cacheDir) return undefined;
    try {
      return JSON.parse(await fsp.readFile(diskPath(key), 'utf8')) as CacheEntry;
    } catch {
      return undefined;
    }
  }

  async function diskSet(key: string, entry: CacheEntry): Promise<void> {
    if (!cacheDir) return;
    const fp = diskPath(key);
    const tmp = `${fp}.tmp`;
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify(entry), 'utf8');
      await fsp.rename(tmp, fp);
    } catch {
      fsp.unlink(tmp).catch(() => {});
    }
  }

  // ── LRU helpers ─────────────────────────────────────────────────────────────

  function memGet(key: string): CacheEntry | undefined {
    const entry = memCache.get(key);
    if (entry) {
      // Move to end → most recently used
      memCache.delete(key);
      memCache.set(key, entry);
    }
    return entry;
  }

  function evictIfNeeded(): void {
    if (maxCacheEntries == null) return;
    while (memCache.size > maxCacheEntries) {
      const iter = memCache.keys().next();
      if (iter.done) break;
      const oldest = iter.value;
      memCache.delete(oldest);
      if (cacheDir) fsp.unlink(diskPath(oldest)).catch(() => {});
    }
  }

  async function setEntry(key: string, entry: CacheEntry): Promise<void> {
    if (memCache.has(key)) memCache.delete(key);
    memCache.set(key, entry);
    evictIfNeeded();
    await diskSet(key, entry);
  }

  // ── detectLanguage ──────────────────────────────────────────────────────────

  async function detectLanguage(text: string): Promise<string> {
    if (detectFn) return await detectFn(text);
    return defaultHeuristic(text);
  }

  // ── resolveFrom ─────────────────────────────────────────────────────────────

  async function resolveFrom(req: TranslateRequest): Promise<string> {
    if (req.from === 'auto') return detectLanguage(req.text);
    if (req.from !== undefined) return req.from;
    // from is undefined: use detect if available, else defaultFrom, else heuristic
    if (detectFn !== undefined) return detectLanguage(req.text);
    if (defaultFrom !== undefined) return defaultFrom;
    return detectLanguage(req.text);
  }

  // ── translate ───────────────────────────────────────────────────────────────

  async function translate(req: TranslateRequest): Promise<TranslateResult> {
    stats.calls++;

    // Empty text shortcut — no provider call
    if (req.text === '') {
      const from = await resolveFrom(req);
      return { text: '', from, to: req.to, provider: 'none', cached: false };
    }

    const from = await resolveFrom(req);
    const key = makeCacheKey(from, req.to, req.text);

    // Memory cache check
    let hit = memGet(key);
    if (!hit) {
      // Disk cache check
      hit = await diskGet(key);
      if (hit) {
        if (memCache.has(key)) memCache.delete(key);
        memCache.set(key, hit);
        evictIfNeeded();
      }
    }
    if (hit) {
      stats.cacheHits++;
      return { text: hit.text, from: hit.from, to: hit.to, provider: hit.provider, cached: true };
    }

    if (sorted.length === 0) {
      const err = new Error('No translation providers configured');
      (err as NodeJS.ErrnoException).code = 'TRANSLATE_NO_PROVIDER' as unknown as string;
      throw err;
    }

    const errors: Error[] = [];
    let attempted = false;

    for (const pc of sorted) {
      // Skip if language pair not supported
      if (pc.supportsLangs && (!pc.supportsLangs.includes(from) || !pc.supportsLangs.includes(req.to))) {
        continue;
      }

      attempted = true;

      if (!stats.perProvider[pc.name]) {
        stats.perProvider[pc.name] = { calls: 0, errors: 0 };
      }
      stats.perProvider[pc.name].calls++;

      try {
        const result = await pc.provider({ text: req.text, from, to: req.to });
        const resolvedFrom = result.detectedFrom ?? from;
        const entry: CacheEntry = { text: result.text, from: resolvedFrom, to: req.to, provider: pc.name, ts: clock() };
        await setEntry(key, entry);
        return { text: result.text, from: resolvedFrom, to: req.to, provider: pc.name, cached: false };
      } catch (e) {
        stats.providerErrors++;
        stats.perProvider[pc.name].errors++;
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    const err = new Error(
      attempted ? 'All translation providers failed' : 'No providers support this language pair',
    );
    (err as any).code = 'TRANSLATE_ALL_FAILED';
    (err as any).cause = { errors };
    throw err;
  }

  // ── translateBatch ──────────────────────────────────────────────────────────

  async function translateBatch(reqs: TranslateRequest[]): Promise<TranslateResult[]> {
    return Promise.all(reqs.map((r) => translate(r)));
  }

  // ── clearCache ──────────────────────────────────────────────────────────────

  async function clearCache(): Promise<void> {
    const keys = [...memCache.keys()];
    memCache.clear();
    if (cacheDir) {
      await Promise.all(keys.map((k) => fsp.unlink(diskPath(k)).catch(() => {})));
    }
  }

  function cacheSize(): number {
    return memCache.size;
  }

  function getStats(): RouterStats {
    return {
      ...stats,
      perProvider: Object.fromEntries(Object.entries(stats.perProvider).map(([k, v]) => [k, { ...v }])),
    };
  }

  return { translate, translateBatch, detectLanguage, clearCache, cacheSize, getStats };
}
