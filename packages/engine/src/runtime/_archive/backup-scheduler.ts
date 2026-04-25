/**
 * backup-scheduler — Self-contained backup scheduler with retention and
 * pluggable storage adapter abstraction.
 *
 * Only Node built-ins: node:fs, node:path, node:crypto, node:zlib, node:os
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';

// ── zlib helpers ──────────────────────────────────────────────────────────────

function gzipBuf(input: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) =>
    zlib.gzip(input, (err, result) => (err ? reject(err) : resolve(result))),
  );
}

function gunzipBuf(input: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) =>
    zlib.gunzip(input, (err, result) => (err ? reject(err) : resolve(result))),
  );
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface StorageEntry {
  key: string;
  size: number;
  createdAt: number; // unix milliseconds
}

export interface StorageAdapter {
  name: string;
  put(key: string, data: Buffer, meta: Record<string, unknown>): Promise<void>;
  list(): Promise<StorageEntry[]>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export interface RetentionOptions {
  count?: number;
  maxAgeMs?: number;
  minKeep?: number;
}

export type BackupSource = string | (() => Promise<Buffer>);

export interface BackupSchedulerOptions {
  source: BackupSource;
  target: StorageAdapter;
  intervalMs: number;
  retention?: RetentionOptions;
  compress?: 'gzip' | 'none';
  hashAlgo?: string;
  clock?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface RestoreOptions {
  key?: string;
  latest?: boolean;
  into?: string;
}

export interface BackupScheduler {
  start(): void;
  stop(): void;
  runNow(): Promise<void>;
  restore(opts: RestoreOptions): Promise<Buffer | undefined>;
  verify(key: string): Promise<boolean>;
}

// ── Blob header ───────────────────────────────────────────────────────────────
// Blob wire format:
//   [uint32BE: header JSON byte-length] [header JSON bytes] [payload bytes]

interface BlobHeader {
  compressed: boolean;
  hash: string;
  hashAlgo: string;
  sourceType: 'dir' | 'fn';
}

function wrapBlob(payload: Buffer, header: BlobHeader): Buffer {
  const headerBuf = Buffer.from(JSON.stringify(header), 'utf8');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);
  return Buffer.concat([lenBuf, headerBuf, payload]);
}

function unwrapBlob(blob: Buffer): { header: BlobHeader; payload: Buffer } {
  const headerLen = blob.readUInt32BE(0);
  const headerJson = blob.subarray(4, 4 + headerLen).toString('utf8');
  const header = JSON.parse(headerJson) as BlobHeader;
  const payload = blob.subarray(4 + headerLen);
  return { header, payload };
}

// ── Dir blob encoding ─────────────────────────────────────────────────────────
// Frame per file: [uint32BE pathLen][path bytes][uint32BE dataLen][data bytes]
// Sentinel      : [uint32BE = 0]

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), relPath);
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  }
  await walk(dir, '');
  return results;
}

export async function buildDirBlob(dir: string): Promise<Buffer> {
  const files = await walkDir(dir);
  const parts: Buffer[] = [];
  for (const relPath of files) {
    const absPath = path.join(dir, relPath);
    const data = await fs.promises.readFile(absPath);
    const pathBuf = Buffer.from(relPath, 'utf8');
    const hdr = Buffer.allocUnsafe(8);
    hdr.writeUInt32BE(pathBuf.length, 0);
    hdr.writeUInt32BE(data.length, 4);
    parts.push(hdr, pathBuf, data);
  }
  parts.push(Buffer.alloc(4)); // sentinel: uint32(0)
  return Buffer.concat(parts);
}

export function extractDirBlob(blob: Buffer): Array<{ path: string; data: Buffer }> {
  const files: Array<{ path: string; data: Buffer }> = [];
  let offset = 0;
  while (offset + 4 <= blob.length) {
    const pathLen = blob.readUInt32BE(offset);
    offset += 4;
    if (pathLen === 0) break; // sentinel
    if (offset + 4 > blob.length) break;
    const dataLen = blob.readUInt32BE(offset);
    offset += 4;
    if (offset + pathLen + dataLen > blob.length) break;
    const filePath = blob.subarray(offset, offset + pathLen).toString('utf8');
    offset += pathLen;
    const data = blob.subarray(offset, offset + dataLen);
    offset += dataLen;
    files.push({ path: filePath, data: Buffer.from(data) });
  }
  return files;
}

async function restoreDirBlob(blob: Buffer, into: string): Promise<void> {
  await fs.promises.mkdir(into, { recursive: true });
  for (const { path: relPath, data } of extractDirBlob(blob)) {
    const abs = path.join(into, relPath);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, data);
  }
}

// ── createBackupScheduler ──────────────────────────────────────────────────────

export function createBackupScheduler(opts: BackupSchedulerOptions): BackupScheduler {
  const {
    source,
    target,
    intervalMs,
    retention,
    hashAlgo = 'sha256',
    clock = (): number => Date.now(),
  } = opts;

  const compress: 'gzip' | 'none' =
    opts.compress ?? (typeof source === 'string' ? 'gzip' : 'none');

  const setTimerFn: (fn: () => void, ms: number) => unknown =
    opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const clearTimerFn: (h: unknown) => void =
    opts.clearTimer ??
    ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let running = false;
  let runSeq = 0;
  let timerHandle: unknown = null;
  let runningPromise: Promise<void> | null = null;

  // ── Retention ───────────────────────────────────────────────────────────────

  async function applyRetention(): Promise<void> {
    if (!retention) return;
    const minKeep = retention.minKeep ?? 1;
    const entries = await target.list();
    if (entries.length === 0) return;

    // oldest → newest
    const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
    const toRemove = new Set<string>();

    if (retention.maxAgeMs != null) {
      const cutoff = clock() - retention.maxAgeMs;
      for (const e of sorted) {
        if (e.createdAt < cutoff) toRemove.add(e.key);
      }
    }

    if (retention.count != null && sorted.length > retention.count) {
      const excess = sorted.slice(0, sorted.length - retention.count);
      for (const e of excess) toRemove.add(e.key);
    }

    // Never drop below minKeep: un-remove the newest candidates
    const remaining = sorted.length - toRemove.size;
    if (remaining < minKeep) {
      const needToKeep = minKeep - remaining;
      const candidatesSorted = [...toRemove]
        .map((k) => sorted.find((e) => e.key === k))
        .filter((e): e is StorageEntry => e !== undefined)
        .sort((a, b) => b.createdAt - a.createdAt); // newest first
      for (let i = 0; i < needToKeep && i < candidatesSorted.length; i++) {
        toRemove.delete(candidatesSorted[i].key);
      }
    }

    for (const key of toRemove) {
      await target.remove(key);
    }
  }

  // ── Core backup ──────────────────────────────────────────────────────────────

  async function _doRun(): Promise<void> {
    const sourceType: 'dir' | 'fn' = typeof source === 'string' ? 'dir' : 'fn';

    let rawPayload: Buffer;
    if (typeof source === 'string') {
      rawPayload = await buildDirBlob(source);
    } else {
      rawPayload = await source();
    }

    let payload: Buffer;
    if (compress === 'gzip') {
      payload = await gzipBuf(rawPayload);
    } else {
      payload = rawPayload;
    }

    const hash = crypto.createHash(hashAlgo).update(payload).digest('hex');
    const shortHash = hash.slice(0, 8);

    const blobHeader: BlobHeader = {
      compressed: compress === 'gzip',
      hash,
      hashAlgo,
      sourceType,
    };
    const blob = wrapBlob(payload, blobHeader);

    const ts = new Date(clock()).toISOString().replace(/[:.]/g, '-');
    runSeq += 1;
    const key = `${ts}-${runSeq.toString(36)}-${shortHash}`;

    const meta: Record<string, unknown> = {
      hash,
      hashAlgo,
      compressed: compress === 'gzip',
      createdAt: clock(),
      sourceType,
    };
    await target.put(key, blob, meta);

    await applyRetention();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  function runNow(): Promise<void> {
    if (runningPromise !== null) return runningPromise;
    runningPromise = _doRun().finally(() => {
      runningPromise = null;
    });
    return runningPromise;
  }

  function scheduleNext(): void {
    timerHandle = setTimerFn(() => {
      void runNow().finally(() => {
        if (running) scheduleNext();
      });
    }, intervalMs);
  }

  function start(): void {
    if (running) return;
    running = true;
    scheduleNext();
  }

  function stop(): void {
    running = false;
    if (timerHandle !== null) {
      clearTimerFn(timerHandle);
      timerHandle = null;
    }
  }

  async function restore(restoreOpts: RestoreOptions): Promise<Buffer | undefined> {
    const { key, latest = true, into } = restoreOpts;

    let targetKey: string;
    if (key != null) {
      targetKey = key;
    } else if (latest) {
      const entries = await target.list();
      if (entries.length === 0) throw new Error('No backups available');
      const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
      targetKey = sorted[0].key;
    } else {
      throw new Error('Must specify key or set latest: true');
    }

    const blob = await target.get(targetKey);
    const { header, payload } = unwrapBlob(blob);

    let rawData: Buffer;
    if (header.compressed) {
      rawData = await gunzipBuf(payload);
    } else {
      rawData = payload;
    }

    if (into != null) {
      if (header.sourceType === 'dir') {
        await restoreDirBlob(rawData, into);
      } else {
        await fs.promises.mkdir(into, { recursive: true });
        await fs.promises.writeFile(path.join(into, 'snapshot.bin'), rawData);
      }
      return undefined;
    }

    return rawData;
  }

  async function verify(key: string): Promise<boolean> {
    const blob = await target.get(key);
    const { header, payload } = unwrapBlob(blob);
    const actualHash = crypto.createHash(header.hashAlgo).update(payload).digest('hex');
    return actualHash === header.hash;
  }

  return { start, stop, runNow, restore, verify };
}

// ── localFsAdapter ────────────────────────────────────────────────────────────

export function localFsAdapter(dir: string): StorageAdapter {
  return {
    name: `localFs:${dir}`,

    async put(key, data, meta) {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, `${key}.bak`), data);
      await fs.promises.writeFile(
        path.join(dir, `${key}.bak.meta.json`),
        JSON.stringify(meta),
        'utf8',
      );
    },

    async list() {
      await fs.promises.mkdir(dir, { recursive: true });
      const names = await fs.promises.readdir(dir);
      const bakFiles = names.filter(
        (n) => n.endsWith('.bak') && !n.includes('.meta.json'),
      );
      const result: StorageEntry[] = [];
      for (const f of bakFiles) {
        const key = f.slice(0, -4); // strip ".bak"
        const stat = await fs.promises.stat(path.join(dir, f));
        let createdAt = stat.mtimeMs;
        try {
          const raw = await fs.promises.readFile(
            path.join(dir, `${key}.bak.meta.json`),
            'utf8',
          );
          const m = JSON.parse(raw) as Record<string, unknown>;
          if (typeof m['createdAt'] === 'number') createdAt = m['createdAt'];
        } catch {
          // fall back to mtime
        }
        result.push({ key, size: stat.size, createdAt });
      }
      return result;
    },

    async get(key) {
      return fs.promises.readFile(path.join(dir, `${key}.bak`));
    },

    async remove(key) {
      await fs.promises.rm(path.join(dir, `${key}.bak`), { force: true });
      await fs.promises.rm(path.join(dir, `${key}.bak.meta.json`), { force: true });
    },
  };
}

// ── memoryAdapter ─────────────────────────────────────────────────────────────

export function memoryAdapter(): StorageAdapter {
  const store = new Map<string, { data: Buffer; createdAt: number; size: number }>();

  return {
    name: 'memory',

    async put(key, data, meta) {
      const createdAt =
        typeof meta['createdAt'] === 'number' ? (meta['createdAt'] as number) : Date.now();
      store.set(key, { data: Buffer.from(data), createdAt, size: data.length });
    },

    async list() {
      return [...store.entries()].map(([key, v]) => ({
        key,
        size: v.size,
        createdAt: v.createdAt,
      }));
    },

    async get(key) {
      const entry = store.get(key);
      if (!entry) throw new Error(`Key not found: ${key}`);
      return Buffer.from(entry.data);
    },

    async remove(key) {
      store.delete(key);
    },
  };
}
