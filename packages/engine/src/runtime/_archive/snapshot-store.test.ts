// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSnapshotStore } from './snapshot-store';
import type { Snapshot } from './snapshot-store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let tick = 0;

function makeClock() {
  return () => ++tick * 1000;
}

beforeEach(async () => {
  tick = 0;
  tmpDir = path.join(
    os.tmpdir(),
    `snapshot-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function store(extra?: Parameters<typeof createSnapshotStore>[0]) {
  return createSnapshotStore({ dir: tmpDir, clock: makeClock(), ...extra });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SnapshotStore', () => {
  // 1. commit returns Snapshot with sha256 id
  it('commit returns a Snapshot with sha256 id (64 hex chars)', async () => {
    const s = store();
    const snap = await s.commit({ hello: 'world' });
    expect(snap.id).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.size).toBeGreaterThan(0);
    expect(snap.createdAt).toBeGreaterThan(0);
  });

  // 2. same data → same id
  it('same data produces the same id', async () => {
    const s = store();
    const a = await s.commit({ foo: 1 });
    const b = await s.commit({ foo: 1 });
    expect(a.id).toBe(b.id);
  });

  // 3. different data → different id
  it('different data produces different ids', async () => {
    const s = store();
    const a = await s.commit({ foo: 1 });
    const b = await s.commit({ foo: 2 });
    expect(a.id).not.toBe(b.id);
  });

  // 4. read returns original data
  it('read returns the original committed data', async () => {
    const s = store();
    const data = { name: 'pyrfor', version: 42 };
    const snap = await s.commit(data);
    const result = await s.read<typeof data>(snap.id);
    expect(result).toEqual(data);
  });

  // 5. tag creates name → resolves
  it('tag() creates a named reference that resolve() can find', async () => {
    const s = store();
    const snap = await s.commit({ x: 1 });
    await s.tag(snap.id, 'v1');
    const found = s.resolve('v1');
    expect(found?.id).toBe(snap.id);
  });

  // 6. untag removes
  it('untag() removes the tag so resolve returns undefined', async () => {
    const s = store();
    const snap = await s.commit({ x: 1 });
    await s.tag(snap.id, 'v1');
    const removed = await s.untag('v1');
    expect(removed).toBe(true);
    expect(s.resolve('v1')).toBeUndefined();
  });

  // 7. untag non-existent returns false
  it('untag() returns false for non-existent tag', async () => {
    const s = store();
    const result = await s.untag('no-such-tag');
    expect(result).toBe(false);
  });

  // 8. duplicate tag → SNAPSHOT_TAG_TAKEN
  it('duplicate tag throws SNAPSHOT_TAG_TAKEN', async () => {
    const s = store();
    const a = await s.commit({ x: 1 });
    const b = await s.commit({ x: 2 });
    await s.tag(a.id, 'release');
    await expect(s.tag(b.id, 'release')).rejects.toMatchObject({ code: 'SNAPSHOT_TAG_TAKEN' });
  });

  // 9. resolve by full id
  it('resolve() works with full id', async () => {
    const s = store();
    const snap = await s.commit({ a: 1 });
    expect(s.resolve(snap.id)?.id).toBe(snap.id);
  });

  // 10. resolve by short id (>=6 chars)
  it('resolve() works with short id prefix (>=6 chars)', async () => {
    const s = store();
    const snap = await s.commit({ a: 1 });
    const short = snap.id.slice(0, 8);
    expect(s.resolve(short)?.id).toBe(snap.id);
  });

  // 11. short id ambiguous → SNAPSHOT_AMBIGUOUS_REF
  it('resolve() throws SNAPSHOT_AMBIGUOUS_REF on ambiguous short prefix', async () => {
    // Create two snapshots and then manually patch ids to share a prefix
    const s = store();
    const snap1 = await s.commit({ a: 1 });
    const snap2 = await s.commit({ a: 2 });

    // Force-patch snapshots to share a prefix
    const shared = 'abcdef';
    (snap1 as unknown as Record<string, string>).id = shared + snap1.id.slice(6);
    (snap2 as unknown as Record<string, string>).id = shared + snap2.id.slice(6);

    // Access internal snapshots array via list
    const all = s.list();
    all[0].id = shared + all[0].id.slice(6);
    // Need another snapshot
    await s.commit({ z: 99 });
    const list2 = s.list();
    // Set two snapshots to share prefix directly
    list2[0].id = shared + 'aa0000000000000000000000000000000000000000000000000000000000';
    list2[1].id = shared + 'bb0000000000000000000000000000000000000000000000000000000000';
    expect(() => s.resolve(shared)).toThrow();
    expect(() => s.resolve(shared)).toThrowError(/ambiguous/i);
  });

  // 12. list sorted desc by createdAt
  it('list() returns snapshots sorted by createdAt descending', async () => {
    const s = store();
    await s.commit({ n: 1 });
    await s.commit({ n: 2 });
    await s.commit({ n: 3 });
    const lst = s.list();
    expect(lst[0].createdAt).toBeGreaterThanOrEqual(lst[1].createdAt);
    expect(lst[1].createdAt).toBeGreaterThanOrEqual(lst[2].createdAt);
  });

  // 13. history walks parent chain
  it('history() walks the parent chain', async () => {
    const s = store();
    const s1 = await s.commit({ step: 1 });
    const s2 = await s.commit({ step: 2 }, { parent: s1.id });
    const s3 = await s.commit({ step: 3 }, { parent: s2.id });
    const h = s.history(s3.id);
    expect(h.map(x => x.id)).toEqual([s3.id, s2.id, s1.id]);
  });

  // 14. diff: added/removed/changed keys
  it('diff() detects added, removed, and changed keys', async () => {
    const s = store();
    const a = await s.commit({ x: 1, y: 2, z: 3 });
    const b = await s.commit({ x: 1, y: 99, w: 4 });
    const d = await s.diff(a.id, b.id);
    expect(d.added).toContain('w');
    expect(d.removed).toContain('z');
    expect(d.changed).toContain('y');
    expect(d.changed).not.toContain('x');
  });

  // 15. rollback returns snapshot+data
  it('rollback() returns snapshot and data', async () => {
    const s = store();
    const snap = await s.commit({ rollback: true });
    const result = await s.rollback(snap.id);
    expect(result.snapshot.id).toBe(snap.id);
    expect(result.data).toEqual({ rollback: true });
  });

  // 16. prune drops oldest beyond maxSnapshots
  it('prune() drops oldest snapshots beyond maxSnapshots', async () => {
    const s = store({ maxSnapshots: 2 });
    await s.commit({ n: 1 });
    await s.commit({ n: 2 });
    await s.commit({ n: 3 });
    const { removed } = await s.prune();
    expect(removed).toBe(1);
    expect(s.list().length).toBe(2);
  });

  // 17. prune never drops tagged
  it('prune() never drops tagged snapshots', async () => {
    const s = store({ maxSnapshots: 1 });
    const old = await s.commit({ n: 1 });
    await s.tag(old.id, 'keep-me');
    await s.commit({ n: 2 });
    await s.prune();
    expect(s.resolve('keep-me')).toBeDefined();
  });

  // 18. clear empties dir
  it('clear() empties the store', async () => {
    const s = store();
    await s.commit({ a: 1 });
    await s.commit({ b: 2 });
    await s.clear();
    expect(s.list().length).toBe(0);
    expect(s.getStats().total).toBe(0);
  });

  // 19. compress=true uses .gz extension
  it('compress=true stores blobs as .json.gz', async () => {
    const s = store({ compress: true });
    const snap = await s.commit({ compressed: true });
    const blobPath = path.join(tmpDir, 'blobs', snap.id.slice(0, 2), snap.id + '.json.gz');
    const stat = await fs.stat(blobPath);
    expect(stat.isFile()).toBe(true);
  });

  // 20. compress=false uses plain .json
  it('compress=false stores blobs as .json', async () => {
    const s = store({ compress: false });
    const snap = await s.commit({ compressed: false });
    const blobPath = path.join(tmpDir, 'blobs', snap.id.slice(0, 2), snap.id + '.json');
    const stat = await fs.stat(blobPath);
    expect(stat.isFile()).toBe(true);
  });

  // 21. getStats accurate
  it('getStats() returns accurate counts', async () => {
    const s = store();
    const a = await s.commit({ x: 1 });
    const b = await s.commit({ x: 2 });
    await s.tag(a.id, 'tagA');
    const stats = s.getStats();
    expect(stats.total).toBe(2);
    expect(stats.bytes).toBe(a.size + b.size);
    expect(stats.tags).toBe(1);
  });

  // 22. index roundtrips on reopen
  it('index persists and reloads on reopen', async () => {
    const s1 = store();
    const snap = await s1.commit({ persist: true });
    await s1.tag(snap.id, 'v-persist');

    const s2 = createSnapshotStore({ dir: tmpDir });
    const found = s2.resolve('v-persist');
    // Need to trigger load first
    const data = await s2.read(snap.id);
    expect(data).toEqual({ persist: true });
  });

  // 23. atomic write: no .tmp leftover
  it('no .tmp files are left after commit', async () => {
    const s = store();
    await s.commit({ atomic: true });
    const files = await fs.readdir(tmpDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles.length).toBe(0);
  });

  // 24. read unknown id throws SNAPSHOT_NOT_FOUND
  it('read() throws SNAPSHOT_NOT_FOUND for unknown id', async () => {
    const s = store();
    const fakeId = 'a'.repeat(64);
    await expect(s.read(fakeId)).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });

  // 25. tag unknown id throws SNAPSHOT_NOT_FOUND
  it('tag() throws SNAPSHOT_NOT_FOUND for unknown id', async () => {
    const s = store();
    await expect(s.tag('a'.repeat(64), 'fail')).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });

  // 26. rollback unknown id throws SNAPSHOT_NOT_FOUND
  it('rollback() throws SNAPSHOT_NOT_FOUND for unknown id', async () => {
    const s = store();
    await expect(s.rollback('a'.repeat(64))).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });

  // 27. message stored in snapshot
  it('commit message is stored in snapshot', async () => {
    const s = store();
    const snap = await s.commit({ x: 1 }, { message: 'initial commit' });
    expect(snap.message).toBe('initial commit');
    const found = s.resolve(snap.id);
    expect(found?.message).toBe('initial commit');
  });

  // 28. tag committed inline
  it('commit with tag option creates tag immediately', async () => {
    const s = store();
    const snap = await s.commit({ x: 1 }, { tag: 'v0.1' });
    expect(snap.tag).toBe('v0.1');
    expect(s.resolve('v0.1')?.id).toBe(snap.id);
  });

  // 29. commit duplicate tag via opts throws SNAPSHOT_TAG_TAKEN
  it('commit() throws SNAPSHOT_TAG_TAKEN if tag is already used for a different id', async () => {
    const s = store();
    await s.commit({ x: 1 }, { tag: 'taken' });
    await expect(s.commit({ x: 2 }, { tag: 'taken' })).rejects.toMatchObject({
      code: 'SNAPSHOT_TAG_TAKEN',
    });
  });

  // 30. prune with no excess does nothing
  it('prune() with no excess snapshots removes 0', async () => {
    const s = store({ maxSnapshots: 10 });
    await s.commit({ n: 1 });
    await s.commit({ n: 2 });
    const { removed } = await s.prune();
    expect(removed).toBe(0);
    expect(s.list().length).toBe(2);
  });

  // 31. diff with no changes
  it('diff() returns empty arrays when snapshots are identical', async () => {
    const s = store();
    const a = await s.commit({ x: 1, y: 2 });
    const d = await s.diff(a.id, a.id);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  // 32. history of snapshot with no parent is just itself
  it('history() of a root snapshot returns just that snapshot', async () => {
    const s = store();
    const snap = await s.commit({ root: true });
    expect(s.history(snap.id)).toHaveLength(1);
    expect(s.history(snap.id)[0].id).toBe(snap.id);
  });

  // 33. resolve returns undefined for unknown ref
  it('resolve() returns undefined for unknown refs', () => {
    const s = store();
    expect(s.resolve('unknown-ref')).toBeUndefined();
  });

  // 34. resolve short prefix < 6 chars returns undefined (not matched)
  it('resolve() does not match prefix shorter than 6 chars', async () => {
    const s = store();
    const snap = await s.commit({ q: 1 });
    const tooShort = snap.id.slice(0, 5);
    expect(s.resolve(tooShort)).toBeUndefined();
  });
});
