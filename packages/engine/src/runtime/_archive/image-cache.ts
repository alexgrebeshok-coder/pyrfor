/**
 * image-cache.ts — Disk-cached image fetcher with transform pipeline for Pyrfor.
 *
 * - SHA-256 keyed by URL + canonical ops hash
 * - Atomic index writes via tmp + rename
 * - LRU eviction by lastAccess when bytes > maxBytes
 * - TTL-based pruning
 */

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ImageOps {
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
  fit?: 'cover' | 'contain' | 'fill';
}

export interface ImageEntry {
  hash: string;
  url: string;
  ops: ImageOps;
  format: string;
  bytes: number;
  createdAt: number;
  lastAccess: number;
  accessCount: number;
}

export type ImageTransformer = (
  input: Buffer,
  ops: ImageOps,
) => Promise<{ data: Buffer; format: string }>;

// ─── Internal ────────────────────────────────────────────────────────────────

interface CacheIndex {
  entries: Record<string, ImageEntry>;
}

interface Stats {
  hits: number;
  misses: number;
  evictions: number;
  bytesWritten: number;
  bytesServed: number;
}

function canonicalOps(ops: ImageOps): string {
  const sorted = Object.keys(ops)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (ops as Record<string, unknown>)[k];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function makeHash(url: string, ops: ImageOps): string {
  return createHash('sha256')
    .update(`${url}\n${canonicalOps(ops)}`)
    .digest('hex');
}

const defaultTransformer: ImageTransformer = async (input, _ops) => ({
  data: input,
  format: 'jpeg',
});

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface ImageCacheOptions {
  cacheDir: string;
  maxBytes?: number;
  defaultTtlMs?: number;
  transformer?: ImageTransformer;
  fetchFn?: typeof fetch;
  clock?: () => number;
}

export interface ImageCacheResult {
  data: Buffer;
  format: string;
  cached: boolean;
  entry: ImageEntry;
}

export interface ImageCache {
  fetch(url: string, ops?: ImageOps): Promise<ImageCacheResult>;
  has(url: string, ops?: ImageOps): boolean;
  evict(url: string, ops?: ImageOps): Promise<boolean>;
  clear(): Promise<void>;
  size(): { entries: number; bytes: number };
  getEntry(url: string, ops?: ImageOps): ImageEntry | undefined;
  prune(): Promise<{ removed: number }>;
  getStats(): Stats;
}

export function createImageCache(opts: ImageCacheOptions): ImageCache {
  const {
    cacheDir,
    maxBytes = 500 * 1024 * 1024,
    defaultTtlMs = Infinity,
    transformer = defaultTransformer,
    fetchFn = globalThis.fetch,
    clock = () => Date.now(),
  } = opts;

  const blobsDir = path.join(cacheDir, 'blobs');
  const indexPath = path.join(cacheDir, 'index.json');

  let index: CacheIndex = { entries: {} };
  let loaded = false;

  const stats: Stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    bytesWritten: 0,
    bytesServed: 0,
  };

  // ── Index I/O ──────────────────────────────────────────────────────────────

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      await fs.mkdir(blobsDir, { recursive: true });
      const raw = await fs.readFile(indexPath, 'utf8');
      index = JSON.parse(raw) as CacheIndex;
    } catch {
      index = { entries: {} };
    }
  }

  async function persistIndex(): Promise<void> {
    const tmp = path.join(cacheDir, `.index-${randomBytes(8).toString('hex')}.tmp`);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(index), 'utf8');
    await fs.rename(tmp, indexPath);
  }

  // ── LRU eviction ──────────────────────────────────────────────────────────

  function totalBytes(): number {
    return Object.values(index.entries).reduce((s, e) => s + e.bytes, 0);
  }

  async function lruEvict(): Promise<void> {
    const sorted = Object.values(index.entries).sort(
      (a, b) => a.lastAccess - b.lastAccess,
    );
    for (const entry of sorted) {
      if (totalBytes() <= maxBytes) break;
      await removeEntry(entry.hash);
      stats.evictions++;
    }
  }

  async function removeEntry(hash: string): Promise<void> {
    const entry = index.entries[hash];
    if (!entry) return;
    const blobPath = path.join(blobsDir, `${hash}.${entry.format}`);
    delete index.entries[hash];
    try {
      await fs.unlink(blobPath);
    } catch {
      // file may already be gone
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    async fetch(url: string, ops: ImageOps = {}): Promise<ImageCacheResult> {
      await ensureLoaded();
      const hash = makeHash(url, ops);
      const existing = index.entries[hash];

      if (existing) {
        const blobPath = path.join(blobsDir, `${hash}.${existing.format}`);
        const data = await fs.readFile(blobPath);
        existing.lastAccess = clock();
        existing.accessCount++;
        stats.hits++;
        stats.bytesServed += existing.bytes;
        await persistIndex();
        return { data, format: existing.format, cached: true, entry: existing };
      }

      // Cache miss — fetch
      stats.misses++;
      const response = await fetchFn(url);
      if (!response.ok) {
        throw new Error(`ImageCache: fetch failed for ${url} — HTTP ${response.status}`);
      }
      const arrayBuf = await response.arrayBuffer();
      const raw = Buffer.from(arrayBuf);

      const { data, format } = await transformer(raw, ops);

      const now = clock();
      const entry: ImageEntry = {
        hash,
        url,
        ops,
        format,
        bytes: data.length,
        createdAt: now,
        lastAccess: now,
        accessCount: 0,
      };

      await fs.mkdir(blobsDir, { recursive: true });
      const blobPath = path.join(blobsDir, `${hash}.${format}`);
      const tmpBlob = blobPath + `.${randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmpBlob, data);
      await fs.rename(tmpBlob, blobPath);

      index.entries[hash] = entry;
      stats.bytesWritten += data.length;

      // LRU evict if over cap
      if (totalBytes() > maxBytes) {
        await lruEvict();
      }

      await persistIndex();
      return { data, format, cached: false, entry };
    },

    has(url: string, ops: ImageOps = {}): boolean {
      const hash = makeHash(url, ops);
      return hash in index.entries;
    },

    async evict(url: string, ops: ImageOps = {}): Promise<boolean> {
      await ensureLoaded();
      const hash = makeHash(url, ops);
      if (!(hash in index.entries)) return false;
      await removeEntry(hash);
      stats.evictions++;
      await persistIndex();
      return true;
    },

    async clear(): Promise<void> {
      await ensureLoaded();
      index = { entries: {} };
      // Remove blobs dir contents
      try {
        const files = await fs.readdir(blobsDir);
        await Promise.all(files.map((f) => fs.unlink(path.join(blobsDir, f))));
      } catch {
        // blobs dir may not exist
      }
      await persistIndex();
    },

    size(): { entries: number; bytes: number } {
      return {
        entries: Object.keys(index.entries).length,
        bytes: totalBytes(),
      };
    },

    getEntry(url: string, ops: ImageOps = {}): ImageEntry | undefined {
      const hash = makeHash(url, ops);
      return index.entries[hash];
    },

    async prune(): Promise<{ removed: number }> {
      await ensureLoaded();
      const now = clock();
      let removed = 0;

      // TTL pruning
      if (defaultTtlMs !== Infinity) {
        for (const entry of Object.values(index.entries)) {
          if (entry.createdAt + defaultTtlMs < now) {
            await removeEntry(entry.hash);
            removed++;
          }
        }
      }

      // LRU cap pruning
      const sorted = Object.values(index.entries).sort(
        (a, b) => a.lastAccess - b.lastAccess,
      );
      for (const entry of sorted) {
        if (totalBytes() <= maxBytes) break;
        await removeEntry(entry.hash);
        stats.evictions++;
        removed++;
      }

      if (removed > 0) await persistIndex();
      return { removed };
    },

    getStats(): Stats {
      return { ...stats };
    },
  };
}
