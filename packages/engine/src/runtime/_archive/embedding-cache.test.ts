// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createEmbeddingCache } from './embedding-cache';
import type { Embedder } from './embedding-cache';

// ─── Mock embedder ────────────────────────────────────────────────────────────

const mockEmbedder: Embedder = async (texts) =>
  texts.map((t) => [t.length, t.charCodeAt(0) || 0]);

// ─── Tmp dir helpers ──────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('embed()', () => {
  it('returns vectors in same order as input', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    const result = await cache.embed(['hello', 'world', 'foo']);
    expect(result).toEqual([
      [5, 104], // 'hello': length=5, charCode('h')=104
      [5, 119], // 'world': length=5, charCode('w')=119
      [3, 102], // 'foo':   length=3, charCode('f')=102
    ]);
  });

  it('empty input returns [] without calling embedder', async () => {
    let called = false;
    const spy: Embedder = async (texts) => {
      called = true;
      return mockEmbedder(texts);
    };
    const cache = createEmbeddingCache({ embedder: spy });
    const result = await cache.embed([]);
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('second call returns cached vectors, embedder not invoked again', async () => {
    let callCount = 0;
    const spy: Embedder = async (texts) => {
      callCount++;
      return mockEmbedder(texts);
    };
    const cache = createEmbeddingCache({ embedder: spy });
    await cache.embed(['hello']);
    await cache.embed(['hello']);
    expect(callCount).toBe(1);
  });

  it('mixed hit/miss preserves original order', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['a', 'b']); // warm a and b
    const result = await cache.embed(['c', 'a', 'b', 'd']);
    expect(result).toEqual([
      [1, 99],  // c
      [1, 97],  // a (hit)
      [1, 98],  // b (hit)
      [1, 100], // d
    ]);
  });

  it('different model bypasses cache', async () => {
    let callCount = 0;
    const spy: Embedder = async (texts) => {
      callCount++;
      return mockEmbedder(texts);
    };
    const cache = createEmbeddingCache({ embedder: spy, defaultModel: 'A' });
    await cache.embed(['hello'], { model: 'A' });
    await cache.embed(['hello'], { model: 'B' });
    expect(callCount).toBe(2);
  });

  it('uses defaultModel when none specified', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder, defaultModel: 'myModel' });
    await cache.embed(['test']);
    expect(cache.has('test', 'myModel')).toBe(true);
    expect(cache.has('test', 'other')).toBe(false);
  });

  it('embedder rejection propagates', async () => {
    const failEmbedder: Embedder = async () => {
      throw new Error('embedding failed');
    };
    const cache = createEmbeddingCache({ embedder: failEmbedder });
    await expect(cache.embed(['hello'])).rejects.toThrow('embedding failed');
  });

  it('single text embed works', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    const result = await cache.embed(['z']);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([1, 122]);
  });
});

describe('embedOne()', () => {
  it('returns a single vector', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    const vec = await cache.embedOne('hello');
    expect(vec).toEqual([5, 104]);
  });

  it('cache hit on second call', async () => {
    let callCount = 0;
    const spy: Embedder = async (texts) => {
      callCount++;
      return mockEmbedder(texts);
    };
    const cache = createEmbeddingCache({ embedder: spy });
    await cache.embedOne('hi');
    await cache.embedOne('hi');
    expect(callCount).toBe(1);
  });
});

describe('has()', () => {
  it('returns false before embed', () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    expect(cache.has('hello')).toBe(false);
  });

  it('returns true after embed', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['hello']);
    expect(cache.has('hello')).toBe(true);
  });

  it('returns false for different model', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder, defaultModel: 'A' });
    await cache.embed(['hello'], { model: 'A' });
    expect(cache.has('hello', 'B')).toBe(false);
  });
});

describe('prewarm()', () => {
  it('adds entries without returning vectors', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    const result = await cache.prewarm(['a', 'b', 'c']);
    expect(result).toEqual({ added: 3, existed: 0 });
    expect(cache.size()).toBe(3);
  });

  it('reports added vs existed correctly', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['a', 'b']);
    const result = await cache.prewarm(['a', 'b', 'c']);
    expect(result).toEqual({ added: 1, existed: 2 });
  });

  it('empty array returns {added:0, existed:0}', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    const result = await cache.prewarm([]);
    expect(result).toEqual({ added: 0, existed: 0 });
  });

  it('entries added by prewarm are retrievable via embed without calling embedder', async () => {
    let callCount = 0;
    const spy: Embedder = async (texts) => {
      callCount++;
      return mockEmbedder(texts);
    };
    const cache = createEmbeddingCache({ embedder: spy });
    await cache.prewarm(['hello']); // callCount = 1
    await cache.embed(['hello']);   // should hit cache, callCount stays 1
    expect(callCount).toBe(1);
  });
});

describe('evict()', () => {
  it('removes a single entry', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['hello', 'world']);
    const removed = cache.evict('hello');
    expect(removed).toBe(true);
    expect(cache.has('hello')).toBe(false);
    expect(cache.has('world')).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it('returns false for non-existent entry', () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    expect(cache.evict('nope')).toBe(false);
  });

  it('evict with explicit model removes correct entry', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder, defaultModel: 'A' });
    await cache.embed(['hello'], { model: 'A' });
    await cache.embed(['hello'], { model: 'B' });
    cache.evict('hello', 'A');
    expect(cache.has('hello', 'A')).toBe(false);
    expect(cache.has('hello', 'B')).toBe(true);
  });
});

describe('clear()', () => {
  it('empties the entire cache', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['a', 'b', 'c']);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.has('a')).toBe(false);
  });
});

describe('size()', () => {
  it('returns 0 initially', () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    expect(cache.size()).toBe(0);
  });

  it('increments correctly', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['a']);
    expect(cache.size()).toBe(1);
    await cache.embed(['b']);
    expect(cache.size()).toBe(2);
    await cache.embed(['a']); // hit — no change
    expect(cache.size()).toBe(2);
  });
});

describe('LRU eviction', () => {
  it('evicts least-recently-accessed entry when over maxEntries', async () => {
    let t = 0;
    const clock = () => t;
    const cache = createEmbeddingCache({ embedder: mockEmbedder, maxEntries: 2, clock });

    t = 1; await cache.embed(['A']); // A lastAccess=1
    t = 2; await cache.embed(['B']); // B lastAccess=2
    t = 3; await cache.embed(['A']); // A hit → lastAccess=3
    t = 4; await cache.embed(['C']); // C inserted → evict B (LRU=2)

    expect(cache.has('B')).toBe(false);
    expect(cache.has('A')).toBe(true);
    expect(cache.has('C')).toBe(true);
    expect(cache.size()).toBe(2);
  });

  it('accessCount increments on cache hit', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['hello']);
    await cache.embed(['hello']);
    await cache.embed(['hello']);
    // Access count is internal; verify via getStats that hits accumulate
    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
  });

  it('lastAccess is updated on hit', async () => {
    let t = 0;
    const clock = () => t;
    const cache = createEmbeddingCache({ embedder: mockEmbedder, maxEntries: 10, clock });

    t = 1; await cache.embed(['hello']); // createdAt=1, lastAccess=1
    t = 99; await cache.embed(['hello']); // hit → lastAccess=99

    // LRU eviction should not remove 'hello' since it was recently accessed
    // Fill with older entries to force eviction
    for (let i = 0; i < 9; i++) {
      t = 2 + i;
      await cache.embed([`item${i}`]);
    }
    // Now size=10, add one more (maxEntries=10 so we need 11 to evict)
    const cache2 = createEmbeddingCache({ embedder: mockEmbedder, maxEntries: 3, clock });
    t = 1; await cache2.embed(['A']);
    t = 2; await cache2.embed(['B']);
    t = 3; await cache2.embed(['C']);
    t = 50; await cache2.embed(['A']); // A lastAccess updated to 50
    t = 4; await cache2.embed(['D']); // evict B (lastAccess=2, oldest)

    expect(cache2.has('B')).toBe(false);
    expect(cache2.has('A')).toBe(true);
  });
});

describe('getStats()', () => {
  it('hits/misses count accurately', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['a', 'b']); // 2 misses
    await cache.embed(['a']);      // 1 hit
    await cache.embed(['c']);      // 1 miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(3);
  });

  it('entries matches size', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['x', 'y', 'z']);
    const stats = cache.getStats();
    expect(stats.entries).toBe(3);
    expect(stats.entries).toBe(cache.size());
  });

  it('perModel counts entries per model correctly', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['a', 'b'], { model: 'modelA' });
    await cache.embed(['c'], { model: 'modelB' });
    const stats = cache.getStats();
    expect(stats.perModel['modelA']).toBe(2);
    expect(stats.perModel['modelB']).toBe(1);
  });

  it('bytes is positive for non-empty cache', async () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    await cache.embed(['hello']);
    const stats = cache.getStats();
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('bytes is 0 for empty cache', () => {
    const cache = createEmbeddingCache({ embedder: mockEmbedder });
    expect(cache.getStats().bytes).toBe(0);
  });
});

describe('flush() and load()', () => {
  it('flush writes entries to disk', async () => {
    const dir = makeTmpDir();
    const cache = createEmbeddingCache({ embedder: mockEmbedder, cacheDir: dir });
    await cache.embed(['hello', 'world']);
    await cache.flush();
    const filePath = path.join(dir, 'embedding-cache.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(raw.version).toBe(1);
    expect(raw.entries).toHaveLength(2);
  });

  it('flush+load roundtrip preserves all entries', async () => {
    const dir = makeTmpDir();
    const cache1 = createEmbeddingCache({ embedder: mockEmbedder, cacheDir: dir });
    await cache1.embed(['alpha', 'beta', 'gamma']);
    await cache1.flush();

    const cache2 = createEmbeddingCache({ embedder: mockEmbedder, cacheDir: dir });
    await cache2.load();
    expect(cache2.size()).toBe(3);
    expect(cache2.has('alpha')).toBe(true);
    expect(cache2.has('beta')).toBe(true);
    expect(cache2.has('gamma')).toBe(true);
  });

  it('loaded entries produce correct vectors without calling embedder', async () => {
    const dir = makeTmpDir();
    const cache1 = createEmbeddingCache({ embedder: mockEmbedder, cacheDir: dir });
    await cache1.embed(['hello']);
    await cache1.flush();

    let callCount = 0;
    const spy: Embedder = async (texts) => {
      callCount++;
      return mockEmbedder(texts);
    };
    const cache2 = createEmbeddingCache({ embedder: spy, cacheDir: dir });
    await cache2.load();
    const result = await cache2.embed(['hello']);
    expect(callCount).toBe(0);
    expect(result[0]).toEqual([5, 104]);
  });

  it('load is no-op when no file exists', async () => {
    const dir = makeTmpDir();
    const cache = createEmbeddingCache({ embedder: mockEmbedder, cacheDir: dir });
    await expect(cache.load()).resolves.toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('load handles corrupted file gracefully', async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'embedding-cache.json'), 'NOT_JSON!!!');
    const cache = createEmbeddingCache({ embedder: mockEmbedder, cacheDir: dir });
    await expect(cache.load()).resolves.toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('flush uses atomic write (tmp+rename, no leftover .tmp file)', async () => {
    const dir = makeTmpDir();
    const cache = createEmbeddingCache({ embedder: mockEmbedder, cacheDir: dir });
    await cache.embed(['hello']);
    await cache.flush();
    expect(fs.existsSync(path.join(dir, 'embedding-cache.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'embedding-cache.json.tmp'))).toBe(false);
  });

  it('flush is debounced via setTimer', async () => {
    const dir = makeTmpDir();
    let capturedCb: (() => void) | null = null;
    let timerCallCount = 0;
    const cache = createEmbeddingCache({
      embedder: mockEmbedder,
      cacheDir: dir,
      flushIntervalMs: 5000,
      setTimer: (cb) => {
        timerCallCount++;
        capturedCb = cb;
        return timerCallCount;
      },
      clearTimer: () => {},
    });

    await cache.embed(['a']);
    await cache.embed(['b']); // timer already scheduled; should not schedule again
    expect(timerCallCount).toBe(1);

    // File should NOT exist yet (timer hasn't fired)
    expect(fs.existsSync(path.join(dir, 'embedding-cache.json'))).toBe(false);

    // Fire the timer manually
    capturedCb!();
    // Give the async flush (mkdir + writeFile + rename) enough time to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(fs.existsSync(path.join(dir, 'embedding-cache.json'))).toBe(true);
  });

  it('explicit flush() cancels pending timer', async () => {
    const dir = makeTmpDir();
    let clearCalled = false;
    const cache = createEmbeddingCache({
      embedder: mockEmbedder,
      cacheDir: dir,
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => {
        clearCalled = true;
        clearTimeout(h as ReturnType<typeof setTimeout>);
      },
    });
    await cache.embed(['hello']);
    await cache.flush(); // should cancel timer and write immediately
    expect(clearCalled).toBe(true);
    expect(fs.existsSync(path.join(dir, 'embedding-cache.json'))).toBe(true);
  });
});
