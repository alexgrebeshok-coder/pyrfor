// @vitest-environment node
/**
 * memory-bridge.test.ts — Unit & integration tests for MemoryBridge.
 *
 * Strategy
 * ─────────
 * • Pure helpers (parseFrontmatter, computeContentHash, …) are tested
 *   in-process with no I/O.
 * • syncOnce / watcher tests use:
 *     – os.tmpdir() for an isolated fsRoot (unique mkdtemp per test)
 *     – createMemoryStore({ dbPath: ':memory:' }) for a real SQLite store
 *       cast to MemoryStoreLike — no adapter needed since the real store
 *       is a superset of the interface.
 * • Watcher tests use debounceMs: 50 + 300 ms wait to stay under 2 s.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import {
  parseFrontmatter,
  serializeFrontmatter,
  computeContentHash,
  stableIdForPath,
  resolveConflict,
  MemoryBridge,
  type MemoryStoreLike,
  type BridgeOptions,
} from './memory-bridge.js';
import { createMemoryStore } from '../runtime/memory-store.js';
import type { MemoryStore } from '../runtime/memory-store.js';

// ====== Test helpers ========================================================

async function makeTmpDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'mem-bridge-'));
}

function makeStore(): MemoryStore {
  return createMemoryStore({ dbPath: ':memory:' });
}

function makeBridge(
  fsRoot: string,
  store: MemoryStore,
  extra: Partial<BridgeOptions> = {},
): MemoryBridge {
  return new MemoryBridge({
    fsRoot,
    store: store as unknown as MemoryStoreLike,
    workspaceId: 'test-ws',
    scope: 'test-scope',
    ...extra,
  });
}

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const abs = path.join(dir, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf8');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ====== 1. parseFrontmatter / serializeFrontmatter round-trip ==============

describe('parseFrontmatter / serializeFrontmatter', () => {
  it('round-trips keys and body unchanged', () => {
    const original = [
      '---',
      'kind: reference',
      'title: My Note',
      'weight: 0.8',
      'active: true',
      'tags: [alpha, beta]',
      '---',
      'Body text here.',
    ].join('\n');

    const { frontmatter, body } = parseFrontmatter(original);

    expect(frontmatter['kind']).toBe('reference');
    expect(frontmatter['title']).toBe('My Note');
    expect(frontmatter['weight']).toBe(0.8);
    expect(frontmatter['active']).toBe(true);
    expect(frontmatter['tags']).toEqual(['alpha', 'beta']);
    expect(body).toBe('Body text here.');

    const serialized = serializeFrontmatter(frontmatter, body);
    const { frontmatter: fm2, body: body2 } = parseFrontmatter(serialized);

    expect(fm2).toEqual(frontmatter);
    expect(body2).toBe(body);
  });

  it('handles missing frontmatter — returns empty fm and full text as body', () => {
    const text = 'No frontmatter here.';
    const { frontmatter, body } = parseFrontmatter(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe(text);
  });

  it('serializeFrontmatter with empty fm returns body unchanged', () => {
    const body = 'Plain body.';
    expect(serializeFrontmatter({}, body)).toBe(body);
  });

  it('handles unclosed frontmatter block gracefully', () => {
    const text = '---\nkey: value\nno closing dashes';
    const { frontmatter, body } = parseFrontmatter(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe(text);
  });
});

// ====== 2. computeContentHash — deterministic ==============================

describe('computeContentHash', () => {
  it('is deterministic for the same input', () => {
    const h1 = computeContentHash('hello world');
    const h2 = computeContentHash('hello world');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 = 64 hex chars
  });

  it('differs for different inputs', () => {
    expect(computeContentHash('a')).not.toBe(computeContentHash('b'));
  });
});

// ====== 3. stableIdForPath — stable & 16 hex chars =========================

describe('stableIdForPath', () => {
  it('returns exactly 16 hex characters', () => {
    const id = stableIdForPath('notes/foo.md');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable across calls', () => {
    expect(stableIdForPath('notes/foo.md')).toBe(stableIdForPath('notes/foo.md'));
  });

  it('differs for different paths', () => {
    expect(stableIdForPath('a.md')).not.toBe(stableIdForPath('b.md'));
  });
});

// ====== 4. resolveConflict — each policy ===================================

describe('resolveConflict', () => {
  const older = '2024-01-01T00:00:00.000Z';
  const newer = '2024-06-01T00:00:00.000Z';

  it('returns "equal" when hashes match regardless of policy', () => {
    const side = { hash: 'abc', mtime: older };
    expect(resolveConflict(side, side, 'fail')).toBe('equal');
    expect(resolveConflict(side, side, 'fs-wins')).toBe('equal');
  });

  it('fs-wins always returns "fs"', () => {
    expect(resolveConflict({ hash: 'A', mtime: older }, { hash: 'B', mtime: newer }, 'fs-wins')).toBe('fs');
  });

  it('db-wins always returns "db"', () => {
    expect(resolveConflict({ hash: 'A', mtime: older }, { hash: 'B', mtime: newer }, 'db-wins')).toBe('db');
  });

  it('newest-wins picks fs when fs is newer', () => {
    expect(
      resolveConflict({ hash: 'A', mtime: newer }, { hash: 'B', mtime: older }, 'newest-wins'),
    ).toBe('fs');
  });

  it('newest-wins picks db when db is newer', () => {
    expect(
      resolveConflict({ hash: 'A', mtime: older }, { hash: 'B', mtime: newer }, 'newest-wins'),
    ).toBe('db');
  });

  it('newest-wins picks fs when timestamps are equal', () => {
    expect(
      resolveConflict({ hash: 'A', mtime: older }, { hash: 'B', mtime: older }, 'newest-wins'),
    ).toBe('fs');
  });

  it('fail returns "conflict"', () => {
    expect(resolveConflict({ hash: 'A', mtime: newer }, { hash: 'B', mtime: older }, 'fail')).toBe(
      'conflict',
    );
  });
});

// ====== 5. syncOnce fs-to-db: 3 files → written:3 ==========================

describe('syncOnce — fs-to-db', () => {
  let tmpDir: string;
  let store: MemoryStore;

  afterEach(async () => {
    store.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes 3 new files to the DB', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, { direction: 'fs-to-db' });

    await writeFile(tmpDir, 'a.md', '---\nkind: fact\n---\nContent A.');
    await writeFile(tmpDir, 'b.md', 'Content B.');
    await writeFile(tmpDir, 'sub/c.md', 'Content C.');

    const result = await bridge.syncOnce();

    expect(result.scanned).toBe(3);
    expect(result.written).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.conflicts).toBe(0);
  });

  // ====== 6. syncOnce again — no changes → skipped:3 =======================

  it('skips all 3 files on second pass with no changes', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, { direction: 'fs-to-db' });

    await writeFile(tmpDir, 'a.md', 'Content A.');
    await writeFile(tmpDir, 'b.md', 'Content B.');
    await writeFile(tmpDir, 'c.md', 'Content C.');

    await bridge.syncOnce();
    const result = await bridge.syncOnce();

    expect(result.scanned).toBe(3);
    expect(result.written).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.conflicts).toBe(0);
  });

  // ====== 7. modify one file → updated:1 ====================================

  it('reports updated:1 after modifying one file', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, { direction: 'fs-to-db' });

    await writeFile(tmpDir, 'a.md', 'Content A.');
    await writeFile(tmpDir, 'b.md', 'Content B.');
    await writeFile(tmpDir, 'c.md', 'Content C.');

    await bridge.syncOnce();

    // Modify one file
    await writeFile(tmpDir, 'b.md', 'Content B — modified.');

    const result = await bridge.syncOnce();

    expect(result.scanned).toBe(3);
    expect(result.written).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.conflicts).toBe(0);
  });
});

// ====== 8. db-to-fs: one DB record → one file written ======================

describe('syncOnce — db-to-fs', () => {
  let tmpDir: string;
  let store: MemoryStore;

  afterEach(async () => {
    store.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes one DB record out as a .md file with frontmatter', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, { direction: 'db-to-fs' });

    const bodyText = 'This is the note body.';
    const bodyHash = computeContentHash(bodyText);

    store.add({
      kind: 'reference',
      text: bodyText,
      source: 'memory-bridge',
      scope: 'test-scope',
      tags: [
        'bridge:relPath:notes/page.md',
        'bridge:workspace:test-ws',
        `bridge:hash:${bodyHash}`,
      ],
      weight: 0.5,
    });

    const result = await bridge.syncOnce();

    expect(result.scanned).toBe(1);
    expect(result.written).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);

    const written = await fsp.readFile(path.join(tmpDir, 'notes', 'page.md'), 'utf8');
    const { frontmatter, body } = parseFrontmatter(written);

    expect(body).toBe(bodyText);
    expect(frontmatter['kind']).toBe('reference');
    expect(frontmatter['scope']).toBe('test-scope');
  });
});

// ====== 9. two-way + fs-wins picks FS =====================================

describe('syncOnce — two-way conflicts', () => {
  let tmpDir: string;
  let store: MemoryStore;

  afterEach(async () => {
    store.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('fs-wins: DB entry is updated with FS content', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, {
      direction: 'two-way',
      onConflict: 'fs-wins',
    });

    const fsBody = 'FS version of the note.';
    const dbBody = 'DB version — different.';

    await writeFile(tmpDir, 'conflict.md', fsBody);

    store.add({
      kind: 'reference',
      text: dbBody,
      source: 'memory-bridge',
      scope: 'test-scope',
      tags: [
        'bridge:relPath:conflict.md',
        'bridge:workspace:test-ws',
        `bridge:hash:${computeContentHash(dbBody)}`,
      ],
      weight: 0.5,
    });

    const result = await bridge.syncOnce();

    expect(result.updated).toBe(1);
    expect(result.conflicts).toBe(0);

    // Verify DB now holds the FS version
    const entries = store.query({ scope: 'test-scope', tags: ['bridge:relPath:conflict.md'] });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe(fsBody);
  });

  // ====== 10. two-way + fail → conflicts++ ==================================

  it('fail policy: increments conflicts and leaves both sides unchanged', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, {
      direction: 'two-way',
      onConflict: 'fail',
    });

    const fsBody = 'FS version.';
    const dbBody = 'DB version — different.';

    await writeFile(tmpDir, 'failtest.md', fsBody);

    store.add({
      kind: 'reference',
      text: dbBody,
      source: 'memory-bridge',
      scope: 'test-scope',
      tags: [
        'bridge:relPath:failtest.md',
        'bridge:workspace:test-ws',
        `bridge:hash:${computeContentHash(dbBody)}`,
      ],
      weight: 0.5,
    });

    const result = await bridge.syncOnce();

    expect(result.conflicts).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.written).toBe(0);

    // DB still holds original DB body
    const entries = store.query({ scope: 'test-scope', tags: ['bridge:relPath:failtest.md'] });
    expect(entries[0]!.text).toBe(dbBody);
  });
});

// ====== 11. start/stop watcher — onChange fires with type:'changed' ========

describe('MemoryBridge watcher', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let bridge: MemoryBridge;

  afterEach(async () => {
    await bridge.stop();
    store.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls onChange with type:"changed" after a tracked file is modified', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    bridge = makeBridge(tmpDir, store, {
      direction: 'fs-to-db',
      debounceMs: 50,
    });

    const relPath = 'watch-target.md';
    const absPath = path.join(tmpDir, relPath);

    // Write file and register it in DB so watcher reports 'changed' not 'added'
    await writeFile(tmpDir, relPath, 'Initial content.');
    await bridge.syncOnce();

    const events: Array<{ type: string; relPath: string }> = [];
    bridge.onChange(e => events.push(e));

    await bridge.start();

    // Modify the file to trigger the watcher
    await writeFile(tmpDir, relPath, 'Modified content.');

    // Wait for debounce (50 ms) + generous buffer
    await delay(300);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const relevantEvent = events.find(e => e.relPath === relPath);
    expect(relevantEvent).toBeDefined();
    expect(relevantEvent!.type).toBe('changed');
  });

  it('stop() silences subsequent FS events', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    bridge = makeBridge(tmpDir, store, { debounceMs: 50 });

    await bridge.start();

    const events: Array<{ type: string }> = [];
    bridge.onChange(e => events.push(e));

    await bridge.stop();

    // Any write after stop should not trigger callback
    await writeFile(tmpDir, 'after-stop.md', 'content');
    await delay(200);

    expect(events).toHaveLength(0);
  });

  it('onChange returns an unsubscribe function', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    bridge = makeBridge(tmpDir, store, { debounceMs: 50 });
    await bridge.start();

    const events: string[] = [];
    const unsub = bridge.onChange(e => events.push(e.relPath));
    unsub(); // unsubscribe immediately

    await writeFile(tmpDir, 'unsub-test.md', 'hello');
    await delay(200);

    expect(events).toHaveLength(0);
  });
});

// ====== 12. non-.md files are ignored by the default fileGlob ==============

describe('fileGlob filtering', () => {
  let tmpDir: string;
  let store: MemoryStore;

  afterEach(async () => {
    store.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('ignores non-.md files in fs-to-db direction', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, { direction: 'fs-to-db' });

    await writeFile(tmpDir, 'readme.txt', 'Text file content.');
    await writeFile(tmpDir, 'script.js', 'console.log("hello");');
    await writeFile(tmpDir, 'data.json', '{"key":"value"}');

    const result = await bridge.syncOnce();

    expect(result.scanned).toBe(0);
    expect(result.written).toBe(0);
  });

  it('processes .md files while ignoring others in same directory', async () => {
    tmpDir = await makeTmpDir();
    store = makeStore();
    const bridge = makeBridge(tmpDir, store, { direction: 'fs-to-db' });

    await writeFile(tmpDir, 'note.md', 'A markdown note.');
    await writeFile(tmpDir, 'note.txt', 'A text file.');
    await writeFile(tmpDir, 'note.json', '{}');

    const result = await bridge.syncOnce();

    expect(result.scanned).toBe(1);
    expect(result.written).toBe(1);
  });
});
