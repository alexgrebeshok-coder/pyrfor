// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createImageCache } from './image-cache';
import type { ImageOps, ImageTransformer } from './image-cache';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_BYTES = Buffer.from('fake-image-bytes');

function makeFetchFn(status = 200, body: Buffer = FAKE_BYTES): typeof fetch {
  return async (_url: string | URL | Request) => {
    return new Response(body, { status });
  };
}

function makeTransformer(format = 'jpeg', mutate?: (b: Buffer) => Buffer): ImageTransformer {
  return async (input, _ops) => ({
    data: mutate ? mutate(input) : input,
    format,
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `img-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ImageCache', () => {
  // 1. First fetch calls fetchFn + transformer, returns cached=false
  it('first call fetches and transforms, cached=false', async () => {
    const fetchFn = vi.fn(makeFetchFn());
    const transformer = vi.fn(makeTransformer('jpeg'));
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn, transformer });

    const result = await cache.fetch('https://example.com/a.jpg');
    expect(result.cached).toBe(false);
    expect(result.format).toBe('jpeg');
    expect(result.data).toEqual(FAKE_BYTES);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(transformer).toHaveBeenCalledOnce();
  });

  // 2. Second call returns cached=true, skips fetchFn
  it('second call is cached, skips fetchFn', async () => {
    const fetchFn = vi.fn(makeFetchFn());
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn });

    await cache.fetch('https://example.com/a.jpg');
    const result = await cache.fetch('https://example.com/a.jpg');

    expect(result.cached).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  // 3. Different ops → different cache entry
  it('different ops produce different entries', async () => {
    const fetchFn = vi.fn(makeFetchFn());
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn });

    const r1 = await cache.fetch('https://example.com/a.jpg', { width: 100 });
    const r2 = await cache.fetch('https://example.com/a.jpg', { width: 200 });

    expect(r1.entry.hash).not.toBe(r2.entry.hash);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(cache.size().entries).toBe(2);
  });

  // 4. has() reflects state
  it('has() returns true after fetch, false before', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });

    expect(cache.has('https://example.com/a.jpg')).toBe(false);
    await cache.fetch('https://example.com/a.jpg');
    expect(cache.has('https://example.com/a.jpg')).toBe(true);
  });

  // 5. evict removes entry + file
  it('evict removes entry and blob file', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });

    const { entry } = await cache.fetch('https://example.com/a.jpg');
    const blobPath = path.join(tmpDir, 'blobs', `${entry.hash}.${entry.format}`);

    await expect(fs.access(blobPath)).resolves.toBeUndefined();
    const evicted = await cache.evict('https://example.com/a.jpg');
    expect(evicted).toBe(true);
    expect(cache.has('https://example.com/a.jpg')).toBe(false);
    await expect(fs.access(blobPath)).rejects.toThrow();
  });

  // 6. evict returns false for unknown URL
  it('evict returns false for unknown entry', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });
    await cache.fetch('https://example.com/a.jpg');
    const evicted = await cache.evict('https://example.com/unknown.jpg');
    expect(evicted).toBe(false);
  });

  // 7. clear empties cacheDir + index
  it('clear empties all entries', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });

    await cache.fetch('https://example.com/a.jpg');
    await cache.fetch('https://example.com/b.jpg', { width: 100 });
    expect(cache.size().entries).toBe(2);

    await cache.clear();
    expect(cache.size().entries).toBe(0);
    expect(cache.size().bytes).toBe(0);
  });

  // 8. size accurate
  it('size returns accurate entry count and bytes', async () => {
    const cache = createImageCache({
      cacheDir: tmpDir,
      fetchFn: makeFetchFn(),
      transformer: makeTransformer('jpeg'),
    });

    expect(cache.size()).toEqual({ entries: 0, bytes: 0 });
    await cache.fetch('https://example.com/a.jpg');
    expect(cache.size().entries).toBe(1);
    expect(cache.size().bytes).toBe(FAKE_BYTES.length);
  });

  // 9. prune drops over-TTL entries
  it('prune removes entries past TTL', async () => {
    let now = 1000;
    const clock = () => now;
    const cache = createImageCache({
      cacheDir: tmpDir,
      fetchFn: makeFetchFn(),
      defaultTtlMs: 500,
      clock,
    });

    await cache.fetch('https://example.com/a.jpg');
    now = 2000; // past TTL (1000 + 500 = 1500 < 2000)

    const { removed } = await cache.prune();
    expect(removed).toBe(1);
    expect(cache.size().entries).toBe(0);
  });

  // 10. prune respects maxBytes (LRU)
  it('prune evicts LRU entries when over maxBytes', async () => {
    const bigData = Buffer.alloc(100);
    let now = 1000;
    const clock = () => now;
    const cache = createImageCache({
      cacheDir: tmpDir,
      fetchFn: makeFetchFn(200, bigData),
      transformer: async (input) => ({ data: input, format: 'jpeg' }),
      maxBytes: 150, // only fits 1 entry of 100 bytes
      clock,
    });

    await cache.fetch('https://example.com/a.jpg'); // lastAccess=1000
    now = 2000;
    await cache.fetch('https://example.com/b.jpg'); // lastAccess=2000 (also triggers lru during fetch)

    // After fetch of b.jpg, a.jpg should have been evicted (oldest)
    expect(cache.size().entries).toBe(1);
    expect(cache.has('https://example.com/b.jpg')).toBe(true);
    expect(cache.has('https://example.com/a.jpg')).toBe(false);
  });

  // 11. getStats hits/misses/evictions/bytes
  it('getStats tracks hits, misses, evictions, bytesWritten, bytesServed', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });

    await cache.fetch('https://example.com/a.jpg'); // miss
    await cache.fetch('https://example.com/a.jpg'); // hit
    await cache.evict('https://example.com/a.jpg'); // eviction

    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.evictions).toBe(1);
    expect(stats.bytesWritten).toBe(FAKE_BYTES.length);
    expect(stats.bytesServed).toBe(FAKE_BYTES.length);
  });

  // 12. atomic index write (index.json is valid JSON after write)
  it('index.json is valid JSON after writes', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });
    await cache.fetch('https://example.com/a.jpg');

    const raw = await fs.readFile(path.join(tmpDir, 'index.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  // 13. canonical ops hash: {width:100, height:50} same as {height:50, width:100}
  it('canonical ops: key order does not affect hash', async () => {
    const fetchFn = vi.fn(makeFetchFn());
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn });

    const r1 = await cache.fetch('https://example.com/a.jpg', { width: 100, height: 50 });
    const r2 = await cache.fetch('https://example.com/a.jpg', { height: 50, width: 100 });

    expect(r2.cached).toBe(true);
    expect(r1.entry.hash).toBe(r2.entry.hash);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  // 14. transformer error propagates
  it('transformer error propagates to caller', async () => {
    const badTransformer: ImageTransformer = async () => {
      throw new Error('transform-failed');
    };
    const cache = createImageCache({
      cacheDir: tmpDir,
      fetchFn: makeFetchFn(),
      transformer: badTransformer,
    });

    await expect(cache.fetch('https://example.com/a.jpg')).rejects.toThrow('transform-failed');
  });

  // 15. fetchFn 404 → throws
  it('fetchFn 404 throws an error', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn(404) });
    await expect(cache.fetch('https://example.com/missing.jpg')).rejects.toThrow('HTTP 404');
  });

  // 16. accessCount + lastAccess updated on hit
  it('accessCount and lastAccess updated on cache hit', async () => {
    let now = 1000;
    const clock = () => now;
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn(), clock });

    await cache.fetch('https://example.com/a.jpg');
    now = 2000;
    await cache.fetch('https://example.com/a.jpg');

    const entry = cache.getEntry('https://example.com/a.jpg');
    expect(entry?.accessCount).toBe(1);
    expect(entry?.lastAccess).toBe(2000);
  });

  // 17. index roundtrips on reopen
  it('index persists across cache instances (roundtrip)', async () => {
    const cache1 = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });
    await cache1.fetch('https://example.com/a.jpg');

    // New instance reads from disk
    const cache2 = createImageCache({ cacheDir: tmpDir, fetchFn: vi.fn(makeFetchFn()) });
    const result = await cache2.fetch('https://example.com/a.jpg');
    expect(result.cached).toBe(true);
  });

  // 18. maxBytes triggers eviction during fetch
  it('fetch triggers LRU eviction when over maxBytes', async () => {
    const bigData = Buffer.alloc(80);
    let now = 1000;
    const clock = () => now;
    const cache = createImageCache({
      cacheDir: tmpDir,
      fetchFn: makeFetchFn(200, bigData),
      transformer: async (input) => ({ data: input, format: 'jpeg' }),
      maxBytes: 100,
      clock,
    });

    now = 1000;
    await cache.fetch('https://example.com/a.jpg');
    now = 2000;
    await cache.fetch('https://example.com/b.jpg');

    // total would be 160 > 100, oldest (a.jpg) evicted
    expect(cache.size().bytes).toBeLessThanOrEqual(100);
  });

  // 19. defaultTransformer passes through unchanged
  it('default transformer passes data through unchanged with format=jpeg', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });
    const result = await cache.fetch('https://example.com/a.jpg');
    expect(result.data).toEqual(FAKE_BYTES);
    expect(result.format).toBe('jpeg');
  });

  // 20. custom transformer applied with ops
  it('custom transformer receives ops and can mutate data', async () => {
    const transformer: ImageTransformer = async (input, ops) => ({
      data: Buffer.from(`${input.toString()}-w${ops.width ?? 0}`),
      format: 'png',
    });
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn(), transformer });

    const result = await cache.fetch('https://example.com/a.jpg', { width: 200 });
    expect(result.format).toBe('png');
    expect(result.data.toString()).toBe('fake-image-bytes-w200');
  });

  // 21. empty ops normalized (same hash as no ops)
  it('empty ops {} equals no ops (same hash)', async () => {
    const fetchFn = vi.fn(makeFetchFn());
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn });

    const r1 = await cache.fetch('https://example.com/a.jpg');
    const r2 = await cache.fetch('https://example.com/a.jpg', {});

    expect(r2.cached).toBe(true);
    expect(r1.entry.hash).toBe(r2.entry.hash);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  // 22. prune with no expired entries removes nothing
  it('prune does nothing if nothing is expired', async () => {
    const cache = createImageCache({
      cacheDir: tmpDir,
      fetchFn: makeFetchFn(),
      defaultTtlMs: 9999999,
    });

    await cache.fetch('https://example.com/a.jpg');
    const { removed } = await cache.prune();
    expect(removed).toBe(0);
    expect(cache.size().entries).toBe(1);
  });

  // 23. getEntry returns undefined for unknown URL
  it('getEntry returns undefined for unknown URL', async () => {
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn() });
    expect(cache.getEntry('https://example.com/ghost.jpg')).toBeUndefined();
  });

  // 24. multiple different URLs cached independently
  it('multiple URLs cached independently', async () => {
    const fetchFn = vi.fn(makeFetchFn());
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn });

    await cache.fetch('https://example.com/a.jpg');
    await cache.fetch('https://example.com/b.jpg');
    await cache.fetch('https://example.com/c.jpg');

    expect(cache.size().entries).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  // 25. clear then fetch works (re-creates dirs)
  it('fetch works after clear (dirs recreated)', async () => {
    const fetchFn = vi.fn(makeFetchFn());
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn });

    await cache.fetch('https://example.com/a.jpg');
    await cache.clear();

    const result = await cache.fetch('https://example.com/a.jpg');
    expect(result.cached).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // 26. entry fields are correct after first fetch
  it('entry fields are populated correctly after first fetch', async () => {
    let now = 5000;
    const clock = () => now;
    const cache = createImageCache({ cacheDir: tmpDir, fetchFn: makeFetchFn(), clock });

    const { entry } = await cache.fetch('https://example.com/a.jpg', { width: 100 });

    expect(entry.url).toBe('https://example.com/a.jpg');
    expect(entry.ops).toEqual({ width: 100 });
    expect(entry.format).toBe('jpeg');
    expect(entry.bytes).toBe(FAKE_BYTES.length);
    expect(entry.createdAt).toBe(5000);
    expect(entry.lastAccess).toBe(5000);
    expect(entry.accessCount).toBe(0);
    expect(typeof entry.hash).toBe('string');
    expect(entry.hash.length).toBe(64); // sha256 hex
  });
});
