// @vitest-environment node
import * as crypto from 'crypto';
import * as fsp from 'fs/promises';
import * as path from 'path';

// ─── Public types ─────────────────────────────────────────────────────────────

export type Embedder = (texts: string[], opts?: { model?: string }) => Promise<number[][]>;

export interface CachedEmbedding {
  hash: string;
  model: string;
  vector: number[];
  createdAt: number;
  lastAccess: number;
  accessCount: number;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface CacheFile {
  version: 1;
  entries: CachedEmbedding[];
}

export interface CreateEmbeddingCacheOpts {
  embedder: Embedder;
  defaultModel?: string;
  cacheDir?: string;
  maxEntries?: number;
  clock?: () => number;
  flushIntervalMs?: number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface EmbeddingCache {
  embed(texts: string[], opts?: { model?: string }): Promise<number[][]>;
  embedOne(text: string, opts?: { model?: string }): Promise<number[]>;
  has(text: string, model?: string): boolean;
  prewarm(texts: string[], opts?: { model?: string }): Promise<{ added: number; existed: number }>;
  evict(text: string, model?: string): boolean;
  clear(): void;
  size(): number;
  flush(): Promise<void>;
  load(): Promise<void>;
  getStats(): {
    hits: number;
    misses: number;
    entries: number;
    bytes: number;
    perModel: Record<string, number>;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createEmbeddingCache(opts: CreateEmbeddingCacheOpts): EmbeddingCache {
  const {
    embedder,
    defaultModel = 'default',
    cacheDir,
    maxEntries = 100_000,
    clock = () => Date.now(),
    flushIntervalMs = 5000,
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = opts;

  const store = new Map<string, CachedEmbedding>();
  let hits = 0;
  let misses = 0;
  let timerHandle: unknown = null;

  function cacheFilePath(): string | null {
    return cacheDir ? path.join(cacheDir, 'embedding-cache.json') : null;
  }

  function hashKey(model: string, text: string): string {
    return sha256hex(model + '\n' + text);
  }

  function evictLRU(): void {
    if (store.size <= maxEntries) return;
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [key, entry] of store) {
      if (entry.lastAccess < lruTime) {
        lruTime = entry.lastAccess;
        lruKey = key;
      }
    }
    if (lruKey !== null) store.delete(lruKey);
  }

  function scheduleFlush(): void {
    if (!cacheDir || timerHandle !== null) return;
    timerHandle = setTimer(() => {
      timerHandle = null;
      flushToDisk().catch(() => {});
    }, flushIntervalMs);
  }

  async function flushToDisk(): Promise<void> {
    const filePath = cacheFilePath();
    if (!filePath) return;
    const data: CacheFile = { version: 1, entries: Array.from(store.values()) };
    const json = JSON.stringify(data);
    const tmpPath = filePath + '.tmp';
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(tmpPath, json, 'utf8');
    await fsp.rename(tmpPath, filePath);
  }

  const cache: EmbeddingCache = {
    async embed(texts, embedOpts) {
      if (texts.length === 0) return [];

      const model = embedOpts?.model ?? defaultModel;
      const hashes = texts.map((t) => hashKey(model, t));
      const resultVectors = new Array<number[]>(texts.length);
      const missIndices: number[] = [];
      const missTexts: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        const entry = store.get(hashes[i]);
        if (entry) {
          hits++;
          entry.lastAccess = clock();
          entry.accessCount++;
          resultVectors[i] = entry.vector;
        } else {
          misses++;
          missIndices.push(i);
          missTexts.push(texts[i]);
        }
      }

      if (missTexts.length > 0) {
        const newVectors = await embedder(missTexts, embedOpts);
        const now = clock();
        for (let j = 0; j < missIndices.length; j++) {
          const i = missIndices[j];
          resultVectors[i] = newVectors[j];
          store.set(hashes[i], {
            hash: hashes[i],
            model,
            vector: newVectors[j],
            createdAt: now,
            lastAccess: now,
            accessCount: 1,
          });
          evictLRU();
        }
        scheduleFlush();
      }

      return resultVectors;
    },

    async embedOne(text, embedOpts) {
      const results = await cache.embed([text], embedOpts);
      return results[0];
    },

    has(text, model) {
      return store.has(hashKey(model ?? defaultModel, text));
    },

    async prewarm(texts, embedOpts) {
      if (texts.length === 0) return { added: 0, existed: 0 };
      const model = embedOpts?.model ?? defaultModel;
      const hashes = texts.map((t) => hashKey(model, t));
      let existed = 0;
      const missIndices: number[] = [];
      const missTexts: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        if (store.has(hashes[i])) {
          existed++;
        } else {
          missIndices.push(i);
          missTexts.push(texts[i]);
        }
      }

      if (missTexts.length > 0) {
        const newVectors = await embedder(missTexts, embedOpts);
        const now = clock();
        for (let j = 0; j < missIndices.length; j++) {
          const i = missIndices[j];
          store.set(hashes[i], {
            hash: hashes[i],
            model,
            vector: newVectors[j],
            createdAt: now,
            lastAccess: now,
            accessCount: 0,
          });
          evictLRU();
        }
        scheduleFlush();
      }

      return { added: missTexts.length, existed };
    },

    evict(text, model) {
      return store.delete(hashKey(model ?? defaultModel, text));
    },

    clear() {
      store.clear();
    },

    size() {
      return store.size;
    },

    async flush() {
      if (timerHandle !== null) {
        clearTimer(timerHandle);
        timerHandle = null;
      }
      await flushToDisk();
    },

    async load() {
      const filePath = cacheFilePath();
      if (!filePath) return;
      try {
        const content = await fsp.readFile(filePath, 'utf8');
        const data = JSON.parse(content) as CacheFile;
        if (data.version === 1 && Array.isArray(data.entries)) {
          for (const entry of data.entries) {
            store.set(entry.hash, entry);
          }
        }
      } catch {
        // file absent or corrupt — start fresh
      }
    },

    getStats() {
      const perModel: Record<string, number> = {};
      let bytes = 0;
      for (const entry of store.values()) {
        perModel[entry.model] = (perModel[entry.model] ?? 0) + 1;
        bytes += entry.vector.length * 8;
      }
      return { hits, misses, entries: store.size, bytes, perModel };
    },
  };

  return cache;
}
