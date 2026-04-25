import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Snapshot {
  id: string;
  createdAt: number;
  parent?: string;
  message?: string;
  tag?: string;
  size: number;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface IndexFile {
  version: 1;
  snapshots: Snapshot[];
  tags: Record<string, string>;
}

interface SnapshotStoreOpts {
  dir: string;
  compress?: boolean;
  maxSnapshots?: number;
  clock?: () => number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

function err(code: string, msg: string): Error {
  const e = new Error(msg) as Error & { code: string };
  (e as unknown as Record<string, string>).code = code;
  return e;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function writeAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSnapshotStore(opts: SnapshotStoreOpts) {
  const { dir, compress = true, maxSnapshots = Infinity } = opts;
  const clock = opts.clock ?? (() => Date.now());

  let snapshots: Snapshot[] = [];
  let tags: Record<string, string> = {};
  let loaded = false;

  const blobsDir = path.join(dir, 'blobs');
  const indexPath = path.join(dir, 'index.json');

  // ── Index I/O ──────────────────────────────────────────────────────────────

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    await fs.mkdir(blobsDir, { recursive: true });
    try {
      const raw = await fs.readFile(indexPath, 'utf8');
      const idx: IndexFile = JSON.parse(raw);
      snapshots = idx.snapshots ?? [];
      tags = idx.tags ?? {};
    } catch {
      snapshots = [];
      tags = {};
    }
    loaded = true;
  }

  async function persistIndex(): Promise<void> {
    const idx: IndexFile = { version: 1, snapshots, tags };
    await writeAtomic(indexPath, Buffer.from(JSON.stringify(idx)));
  }

  // ── Blob paths ─────────────────────────────────────────────────────────────

  function blobPath(id: string): string {
    const ext = compress ? '.json.gz' : '.json';
    return path.join(blobsDir, id.slice(0, 2), id + ext);
  }

  async function writeBlob(id: string, payload: Buffer): Promise<void> {
    const p = blobPath(id);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const data = compress ? gzipSync(payload) : payload;
    await writeAtomic(p, data);
  }

  async function readBlob(id: string): Promise<Buffer> {
    const p = blobPath(id);
    const data = await fs.readFile(p).catch(() => null);
    if (data === null) {
      // try alternate extension
      const altPath = compress
        ? path.join(blobsDir, id.slice(0, 2), id + '.json')
        : path.join(blobsDir, id.slice(0, 2), id + '.json.gz');
      const alt = await fs.readFile(altPath).catch(() => null);
      if (alt === null) throw err('SNAPSHOT_NOT_FOUND', `Snapshot ${id} not found`);
      return compress ? alt : gunzipSync(alt);
    }
    return compress ? gunzipSync(data) : data;
  }

  // ── Resolve helper ─────────────────────────────────────────────────────────

  function resolveInternal(ref: string): Snapshot | undefined {
    // exact id
    const exact = snapshots.find(s => s.id === ref);
    if (exact) return exact;

    // tag
    const tagId = tags[ref];
    if (tagId) {
      return snapshots.find(s => s.id === tagId);
    }

    // short id (>=6 chars)
    if (ref.length >= 6) {
      const matches = snapshots.filter(s => s.id.startsWith(ref));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw err('SNAPSHOT_AMBIGUOUS_REF', `Ref "${ref}" is ambiguous`);
    }

    return undefined;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async function commit<T>(
    data: T,
    commitOpts?: { message?: string; tag?: string; parent?: string },
  ): Promise<Snapshot> {
    await ensureLoaded();

    const payload = Buffer.from(JSON.stringify(data));
    const id = sha256(payload);

    // if tag requested, check uniqueness before writing
    if (commitOpts?.tag && tags[commitOpts.tag] && tags[commitOpts.tag] !== id) {
      throw err('SNAPSHOT_TAG_TAKEN', `Tag "${commitOpts.tag}" is already in use`);
    }

    const existing = snapshots.find(s => s.id === id);
    if (!existing) {
      await writeBlob(id, payload);

      const snap: Snapshot = {
        id,
        createdAt: clock(),
        size: payload.length,
        ...(commitOpts?.parent ? { parent: commitOpts.parent } : {}),
        ...(commitOpts?.message ? { message: commitOpts.message } : {}),
        ...(commitOpts?.tag ? { tag: commitOpts.tag } : {}),
      };

      snapshots.push(snap);

      if (commitOpts?.tag) {
        tags[commitOpts.tag] = id;
      }

      await persistIndex();
      return snap;
    }

    // snapshot already exists — optionally update tag
    if (commitOpts?.tag) {
      if (!tags[commitOpts.tag]) {
        tags[commitOpts.tag] = id;
        existing.tag = commitOpts.tag;
        await persistIndex();
      }
    }

    return existing;
  }

  async function read<T = unknown>(id: string): Promise<T> {
    await ensureLoaded();
    const snap = resolveInternal(id);
    if (!snap) throw err('SNAPSHOT_NOT_FOUND', `Snapshot "${id}" not found`);
    const buf = await readBlob(snap.id);
    return JSON.parse(buf.toString('utf8')) as T;
  }

  async function tag(id: string, tagName: string): Promise<void> {
    await ensureLoaded();
    const snap = resolveInternal(id);
    if (!snap) throw err('SNAPSHOT_NOT_FOUND', `Snapshot "${id}" not found`);
    if (tags[tagName] && tags[tagName] !== snap.id) {
      throw err('SNAPSHOT_TAG_TAKEN', `Tag "${tagName}" is already in use`);
    }
    tags[tagName] = snap.id;
    snap.tag = tagName;
    await persistIndex();
  }

  async function untag(tagName: string): Promise<boolean> {
    await ensureLoaded();
    if (!tags[tagName]) return false;
    const id = tags[tagName];
    delete tags[tagName];
    const snap = snapshots.find(s => s.id === id);
    if (snap && snap.tag === tagName) delete snap.tag;
    await persistIndex();
    return true;
  }

  function resolve(ref: string): Snapshot | undefined {
    return resolveInternal(ref);
  }

  function list(): Snapshot[] {
    return [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
  }

  function history(id: string): Snapshot[] {
    const result: Snapshot[] = [];
    let current: Snapshot | undefined = resolveInternal(id);
    while (current) {
      result.push(current);
      current = current.parent ? resolveInternal(current.parent) : undefined;
    }
    return result;
  }

  async function diff(
    idA: string,
    idB: string,
  ): Promise<{ added: string[]; removed: string[]; changed: string[] }> {
    const [dataA, dataB] = await Promise.all([read<unknown>(idA), read<unknown>(idB)]);
    const objA = (dataA !== null && typeof dataA === 'object' && !Array.isArray(dataA))
      ? (dataA as Record<string, unknown>)
      : {} as Record<string, unknown>;
    const objB = (dataB !== null && typeof dataB === 'object' && !Array.isArray(dataB))
      ? (dataB as Record<string, unknown>)
      : {} as Record<string, unknown>;

    const keysA = new Set(Object.keys(objA));
    const keysB = new Set(Object.keys(objB));

    const added = [...keysB].filter(k => !keysA.has(k));
    const removed = [...keysA].filter(k => !keysB.has(k));
    const changed = [...keysA].filter(
      k => keysB.has(k) && JSON.stringify(objA[k]) !== JSON.stringify(objB[k]),
    );

    return { added, removed, changed };
  }

  async function rollback(id: string): Promise<{ snapshot: Snapshot; data: unknown }> {
    await ensureLoaded();
    const snap = resolveInternal(id);
    if (!snap) throw err('SNAPSHOT_NOT_FOUND', `Snapshot "${id}" not found`);
    const data = await read(snap.id);
    return { snapshot: snap, data };
  }

  async function prune(): Promise<{ removed: number }> {
    await ensureLoaded();
    if (snapshots.length <= maxSnapshots) return { removed: 0 };

    const taggedIds = new Set(Object.values(tags));
    const sorted = [...snapshots].sort((a, b) => a.createdAt - b.createdAt);
    const toRemove: Snapshot[] = [];
    let remaining = sorted.length;

    for (const snap of sorted) {
      if (remaining <= maxSnapshots) break;
      if (!taggedIds.has(snap.id)) {
        toRemove.push(snap);
        remaining--;
      }
    }

    for (const snap of toRemove) {
      const p = blobPath(snap.id);
      await fs.unlink(p).catch(() => undefined);
      snapshots = snapshots.filter(s => s.id !== snap.id);
    }

    await persistIndex();
    return { removed: toRemove.length };
  }

  async function clear(): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(blobsDir, { recursive: true });
    snapshots = [];
    tags = {};
    loaded = true;
    await persistIndex();
  }

  function getStats(): { total: number; bytes: number; tags: number } {
    return {
      total: snapshots.length,
      bytes: snapshots.reduce((s, snap) => s + snap.size, 0),
      tags: Object.keys(tags).length,
    };
  }

  return {
    commit,
    read,
    tag,
    untag,
    resolve,
    list,
    history,
    diff,
    rollback,
    prune,
    clear,
    getStats,
  };
}
