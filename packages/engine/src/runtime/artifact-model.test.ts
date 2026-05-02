// @vitest-environment node
/**
 * artifact-model.test.ts — unit tests for ArtifactStore and pure helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ArtifactStore,
  computeSha256,
  serializeRef,
  deserializeRef,
  type ArtifactKind,
  type ArtifactRef,
} from './artifact-model';

// ====== Helpers ==============================================================

function tmpDir(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `artifact-model-test-${hex}`);
}

// ====== computeSha256 ========================================================

describe('computeSha256', () => {
  it('returns hex string of expected length', () => {
    const result = computeSha256(Buffer.from('hello'));
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('is stable for identical content', () => {
    const buf = Buffer.from('deterministic content');
    expect(computeSha256(buf)).toBe(computeSha256(buf));
    expect(computeSha256(Buffer.from('abc'))).toBe(computeSha256(Buffer.from('abc')));
  });

  it('differs for distinct content', () => {
    expect(computeSha256(Buffer.from('a'))).not.toBe(computeSha256(Buffer.from('b')));
  });
});

// ====== serializeRef / deserializeRef ========================================

describe('serializeRef / deserializeRef', () => {
  const sample: ArtifactRef = {
    id: 'uuid-1.json',
    kind: 'plan',
    uri: '/tmp/x/plan/uuid-1.json',
    sha256: 'abc123',
    bytes: 42,
    createdAt: new Date().toISOString(),
    runId: 'run-1',
    meta: { custom: true },
  };

  it('round-trips a full ref', () => {
    const line = serializeRef(sample);
    expect(deserializeRef(line)).toEqual(sample);
  });

  it('returns null for empty string', () => {
    expect(deserializeRef('')).toBeNull();
    expect(deserializeRef('  ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(deserializeRef('not-json{{')).toBeNull();
  });

  it('returns null for JSON missing required fields', () => {
    expect(deserializeRef(JSON.stringify({ id: 'x' }))).toBeNull();
  });
});

// ====== ArtifactStore ========================================================

describe('ArtifactStore', () => {
  let rootDir: string;
  let store: ArtifactStore;

  beforeEach(() => {
    rootDir = tmpDir();
    store = new ArtifactStore({ rootDir });
  });

  afterEach(async () => {
    try {
      await rm(rootDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  // ── write + read text round-trip ──────────────────────────────────────────

  it('write + readText round-trip', async () => {
    const content = 'hello artifact world';
    const ref = await store.write('log', content);

    expect(ref.id).toBeTruthy();
    expect(ref.kind).toBe('log');
    expect(ref.uri).toBeTruthy();
    expect(ref.sha256).toHaveLength(64);
    expect(ref.bytes).toBe(Buffer.byteLength(content, 'utf-8'));
    expect(ref.createdAt).toBeTruthy();

    const text = await store.readText(ref);
    expect(text).toBe(content);
  });

  // ── write + read binary round-trip ────────────────────────────────────────

  it('write + read binary round-trip', async () => {
    const binary = randomBytes(256);
    const ref = await store.write('screenshot', binary);

    const result = await store.read(ref);
    expect(result).toEqual(binary);
    expect(ref.bytes).toBe(256);
  });

  // ── writeJSON + readJSON typed round-trip ─────────────────────────────────

  it('writeJSON + readJSON typed round-trip', async () => {
    interface Payload { score: number; labels: string[] }
    const value: Payload = { score: 0.95, labels: ['pass', 'green'] };

    const ref = await store.writeJSON('test_result', value);
    expect(ref.id).toMatch(/\.json$/);

    const result = await store.readJSON<Payload>(ref);
    expect(result).toEqual(value);
  });

  it('readJSONVerified rejects artifacts whose bytes changed after indexing', async () => {
    interface Payload { score: number }
    const ref = await store.writeJSON('delivery_plan', { score: 1 });
    await writeFile(store.resolvePath(ref), JSON.stringify({ score: 2 }), 'utf-8');

    await expect(store.readJSONVerified<Payload>(ref, ref.sha256!)).rejects.toThrow(/sha256 mismatch/);
  });

  // ── sha256 stable for same content ────────────────────────────────────────

  it('sha256 is stable for identical content', async () => {
    const content = 'stable content';
    const ref1 = await store.write('diff', content);
    const ref2 = await store.write('diff', content);

    expect(ref1.sha256).toBe(ref2.sha256);
  });

  // ── ext is embedded in id ─────────────────────────────────────────────────

  it('id includes ext when provided', async () => {
    const ref = await store.write('patch', 'data', { ext: '.patch' });
    expect(ref.id).toMatch(/\.patch$/);
  });

  // ── resolvePath ───────────────────────────────────────────────────────────

  it('resolvePath returns correct path structure', async () => {
    const ref = await store.write('summary', 'text', { runId: 'run-42' });
    const resolved = store.resolvePath(ref);
    expect(resolved).toContain(path.join('run-42', 'summary'));
    expect(resolved).toContain(ref.id);
  });

  it('resolvePath uses _global bucket when runId is absent', async () => {
    const ref = await store.write('log', 'text');
    const resolved = store.resolvePath(ref);
    expect(resolved).toContain(path.join('_global', 'log'));
  });

  // ── list() ────────────────────────────────────────────────────────────────

  it('list() returns all written refs', async () => {
    const r1 = await store.write('log', 'a');
    const r2 = await store.write('diff', 'b');
    const r3 = await store.write('plan', 'c');

    const all = await store.list();
    const ids = all.map(r => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
    expect(ids).toContain(r3.id);
  });

  it('list() filters by runId', async () => {
    await store.write('log', 'a', { runId: 'run-a' });
    await store.write('log', 'b', { runId: 'run-b' });
    await store.write('log', 'c', { runId: 'run-a' });

    const results = await store.list({ runId: 'run-a' });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.runId === 'run-a')).toBe(true);
  });

  it('list() filters by kind', async () => {
    await store.write('log', 'a');
    await store.write('diff', 'b');
    await store.write('log', 'c');

    const results = await store.list({ kind: 'log' });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.kind === 'log')).toBe(true);
  });

  it('list() filters by runId and kind together', async () => {
    await store.write('log', 'a', { runId: 'run-x' });
    await store.write('diff', 'b', { runId: 'run-x' });
    await store.write('log', 'c', { runId: 'run-y' });

    const results = await store.list({ runId: 'run-x', kind: 'log' });
    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe('run-x');
    expect(results[0].kind).toBe('log');
  });

  it('list() returns empty array when index does not exist', async () => {
    const fresh = new ArtifactStore({ rootDir: tmpDir() });
    const results = await fresh.list();
    expect(results).toEqual([]);
  });

  // ── remove() ──────────────────────────────────────────────────────────────

  it('remove() deletes the file and returns true', async () => {
    const ref = await store.write('log', 'to delete');
    const result = await store.remove(ref);
    expect(result).toBe(true);
  });

  it('remove() returns false for a missing file', async () => {
    const ref = await store.write('log', 'x');
    await store.remove(ref); // first removal
    const result = await store.remove(ref); // second removal
    expect(result).toBe(false);
  });

  it('read() after remove() throws', async () => {
    const ref = await store.write('log', 'gone');
    await store.remove(ref);
    await expect(store.read(ref)).rejects.toThrow();
  });

  // ── persistence across process restart ────────────────────────────────────

  it('list() works after simulated process restart (new ArtifactStore on same rootDir)', async () => {
    const r1 = await store.write('plan', 'plan content', { runId: 'run-persist' });
    const r2 = await store.write('summary', 'summary content', { runId: 'run-persist' });

    // Simulate restart by creating a new instance on the same rootDir
    const store2 = new ArtifactStore({ rootDir });
    const results = await store2.list();

    const ids = results.map(r => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
  });

  // ── corrupt index lines are skipped ───────────────────────────────────────

  it('corrupt _index.jsonl line is skipped; valid entries still returned', async () => {
    const ref = await store.write('log', 'valid entry');

    // Inject a corrupt line into the index
    const indexPath = path.join(rootDir, '_index.jsonl');
    await appendFile(indexPath, 'THIS IS NOT JSON\n');
    await appendFile(indexPath, '{"broken":true}\n'); // valid JSON but missing required fields

    const store2 = new ArtifactStore({ rootDir });
    const results = await store2.list();

    // Valid entry is present; corrupt lines are silently skipped
    const ids = results.map(r => r.id);
    expect(ids).toContain(ref.id);
    // Corrupt entries should not appear
    expect(results.every(r => typeof r.id === 'string' && typeof r.uri === 'string')).toBe(true);
  });

  // ── meta is persisted ─────────────────────────────────────────────────────

  it('meta is round-tripped through the index', async () => {
    const meta = { pr: 42, reviewer: 'alice' };
    const ref = await store.write('pm_update', 'body', { meta });

    const [listed] = await store.list({ kind: 'pm_update' });
    expect(listed.meta).toEqual(meta);
  });

  // ── runId stored in ref ───────────────────────────────────────────────────

  it('runId is stored in ArtifactRef', async () => {
    const ref = await store.write('risk_report', 'risk', { runId: 'run-001' });
    expect(ref.runId).toBe('run-001');
  });

  // ── all ArtifactKind values are accepted ─────────────────────────────────

  it('all ArtifactKind values are accepted without error', async () => {
    const kinds: ArtifactKind[] = [
      'diff',
      'patch',
      'log',
      'test_result',
      'screenshot',
      'browser_trace',
      'plan',
      'summary',
      'risk_report',
      'pm_update',
      'release_note',
      'delivery_evidence',
      'delivery_plan',
      'delivery_apply',
      'context_pack',
    ];

    const refs: ArtifactRef[] = [];
    for (const kind of kinds) {
      refs.push(await store.write(kind, `content for ${kind}`));
    }

    expect(refs).toHaveLength(kinds.length);
    expect(refs.map(r => r.kind)).toEqual(kinds);

    const all = await store.list();
    expect(all).toHaveLength(kinds.length);
  });

  it('writes and reads context_pack JSON artifacts', async () => {
    const pack = { schemaVersion: 'context_pack.v1', hash: 'abc', sections: [] };
    const ref = await store.writeJSON('context_pack', pack, { runId: 'run-context' });

    expect(ref.kind).toBe('context_pack');
    expect(ref.runId).toBe('run-context');
    await expect(store.readJSON(ref)).resolves.toEqual(pack);
  });
});
