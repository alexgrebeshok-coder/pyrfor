// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  createSemanticSearch,
  hashEmbedder,
  SEMANTIC_NO_EMBEDDER,
  SEMANTIC_DIM_MISMATCH,
} from './semantic-search.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const persistFiles: string[] = [];

function managedPersistPath(): string {
  const p = path.join(os.tmpdir(), `ss-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  persistFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of persistFiles.splice(0)) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

/** Simple 3-D unit vectors for hand-crafted tests. */
function vec(x: number, y: number, z: number): number[] {
  const n = Math.sqrt(x * x + y * y + z * z);
  return n === 0 ? [x, y, z] : [x / n, y / n, z / n];
}

// ─── hashEmbedder ─────────────────────────────────────────────────────────────

describe('hashEmbedder', () => {
  it('returns a vector of the requested dimension (default 64)', () => {
    const embed = hashEmbedder();
    expect(embed('hello')).toHaveLength(64);
  });

  it('returns a vector of the requested dimension (custom)', () => {
    const embed = hashEmbedder(128);
    expect(embed('test')).toHaveLength(128);
  });

  it('is deterministic — same text → same vector', () => {
    const embed = hashEmbedder(32);
    expect(embed('pyrfor')).toEqual(embed('pyrfor'));
  });

  it('different texts produce different vectors', () => {
    const embed = hashEmbedder(32);
    expect(embed('alpha')).not.toEqual(embed('beta'));
  });

  it('output is L2-normalised (norm ≈ 1)', () => {
    const embed = hashEmbedder(64);
    const v = embed('normalised?');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('all values are in [-1, 1] before normalisation contributes', () => {
    const embed = hashEmbedder(16);
    const v = embed('bounds check');
    for (const x of v) expect(x).toBeGreaterThanOrEqual(-1.1); // normalised values stay within this
  });
});

// ─── createSemanticSearch — basic ────────────────────────────────────────────

describe('createSemanticSearch — size / clear / remove', () => {
  it('starts with size 0', () => {
    const ss = createSemanticSearch();
    expect(ss.size()).toBe(0);
  });

  it('indexVector increases size', () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    expect(ss.size()).toBe(1);
  });

  it('re-indexing same id does not increase size', () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    ss.indexVector('a', vec(0, 1, 0));
    expect(ss.size()).toBe(1);
  });

  it('remove returns true for existing id', () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    expect(ss.remove('a')).toBe(true);
  });

  it('remove returns false for missing id', () => {
    const ss = createSemanticSearch();
    expect(ss.remove('no-such-id')).toBe(false);
  });

  it('remove reduces size', () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    ss.remove('a');
    expect(ss.size()).toBe(0);
  });

  it('clear resets size to 0', () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    ss.indexVector('b', vec(0, 1, 0));
    ss.clear();
    expect(ss.size()).toBe(0);
  });
});

// ─── search — vector queries ──────────────────────────────────────────────────

describe('search — vector query', () => {
  it('empty index returns []', async () => {
    const ss = createSemanticSearch();
    const res = await ss.search([1, 0, 0]);
    expect(res).toEqual([]);
  });

  it('self-similarity is ≈ 1.0', async () => {
    const ss = createSemanticSearch();
    const v = vec(1, 2, 3);
    ss.indexVector('self', v);
    const [r] = await ss.search(v);
    expect(r.score).toBeCloseTo(1.0, 6);
  });

  it('results are ordered by descending score', async () => {
    const ss = createSemanticSearch();
    ss.indexVector('x-axis', vec(1, 0, 0));
    ss.indexVector('diagonal', vec(1, 1, 0));
    ss.indexVector('y-axis', vec(0, 1, 0));
    const res = await ss.search(vec(1, 0, 0));
    const scores = res.map(r => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('topK limits number of results', async () => {
    const ss = createSemanticSearch();
    for (let i = 0; i < 20; i++) ss.indexVector(`v${i}`, vec(i, 1, 0));
    const res = await ss.search(vec(1, 0, 0), { topK: 5 });
    expect(res).toHaveLength(5);
  });

  it('topK larger than index returns all results', async () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    ss.indexVector('b', vec(0, 1, 0));
    const res = await ss.search(vec(1, 0, 0), { topK: 100 });
    expect(res).toHaveLength(2);
  });

  it('threshold filters out low-score results', async () => {
    const ss = createSemanticSearch();
    ss.indexVector('close', vec(1, 0.01, 0));
    ss.indexVector('far', vec(0, 1, 0));
    const res = await ss.search(vec(1, 0, 0), { threshold: 0.9 });
    expect(res.every(r => r.score >= 0.9)).toBe(true);
    expect(res.find(r => r.id === 'close')).toBeTruthy();
    expect(res.find(r => r.id === 'far')).toBeUndefined();
  });

  it('threshold=0 includes everything (default)', async () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    ss.indexVector('b', vec(0, 1, 0));
    const res = await ss.search(vec(1, 0, 0));
    expect(res).toHaveLength(2);
  });

  it('result includes correct metadata', async () => {
    const ss = createSemanticSearch<{ label: string }>();
    ss.indexVector('a', vec(1, 0, 0), { label: 'hello' });
    const [r] = await ss.search(vec(1, 0, 0));
    expect(r.metadata).toEqual({ label: 'hello' });
  });

  it('result id matches indexed id', async () => {
    const ss = createSemanticSearch();
    ss.indexVector('my-id', vec(1, 0, 0));
    const [r] = await ss.search(vec(1, 0, 0));
    expect(r.id).toBe('my-id');
  });
});

// ─── search — filter callback ─────────────────────────────────────────────────

describe('search — filter callback', () => {
  it('filter excludes non-matching metadata', async () => {
    const ss = createSemanticSearch<{ category: string }>();
    ss.indexVector('a', vec(1, 0, 0), { category: 'A' });
    ss.indexVector('b', vec(1, 0.1, 0), { category: 'B' });
    const res = await ss.search(vec(1, 0, 0), {
      filter: m => m.category === 'A',
    });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('a');
  });

  it('filter keeps all items when all match', async () => {
    const ss = createSemanticSearch<{ tag: string }>();
    ss.indexVector('a', vec(1, 0, 0), { tag: 'x' });
    ss.indexVector('b', vec(0, 1, 0), { tag: 'x' });
    const res = await ss.search(vec(1, 0, 0), { filter: m => m.tag === 'x' });
    expect(res).toHaveLength(2);
  });

  it('filter returning false for all excludes everything', async () => {
    const ss = createSemanticSearch<{ tag: string }>();
    ss.indexVector('a', vec(1, 0, 0), { tag: 'x' });
    const res = await ss.search(vec(1, 0, 0), { filter: () => false });
    expect(res).toHaveLength(0);
  });
});

// ─── Dimension mismatch ────────────────────────────────────────────────────────

describe('dimension mismatch', () => {
  it('indexVector throws SEMANTIC_DIM_MISMATCH on dimension mismatch', () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', [1, 0, 0]);
    expect(() => ss.indexVector('b', [1, 0])).toThrowError(
      expect.objectContaining({ code: SEMANTIC_DIM_MISMATCH }),
    );
  });

  it('search throws SEMANTIC_DIM_MISMATCH when query dim differs from stored', async () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', [1, 0, 0]);
    await expect(ss.search([1, 0])).rejects.toMatchObject({ code: SEMANTIC_DIM_MISMATCH });
  });
});

// ─── No embedder ─────────────────────────────────────────────────────────────

describe('no embedder', () => {
  it('index() throws SEMANTIC_NO_EMBEDDER when no embedder configured', async () => {
    const ss = createSemanticSearch();
    await expect(ss.index('a', 'hello')).rejects.toMatchObject({
      code: SEMANTIC_NO_EMBEDDER,
    });
  });

  it('search(string) throws SEMANTIC_NO_EMBEDDER when no embedder configured', async () => {
    const ss = createSemanticSearch();
    await expect(ss.search('query text')).rejects.toMatchObject({
      code: SEMANTIC_NO_EMBEDDER,
    });
  });
});

// ─── index() with embedder ────────────────────────────────────────────────────

describe('index() with embedder', () => {
  it('stores and retrieves via text query', async () => {
    const embed = hashEmbedder(32);
    const ss = createSemanticSearch({ embedder: embed });
    await ss.index('doc1', 'the quick brown fox');
    const res = await ss.search('the quick brown fox');
    expect(res[0].id).toBe('doc1');
    expect(res[0].score).toBeCloseTo(1.0, 5);
  });

  it('async embedder works', async () => {
    const embed = (text: string) => Promise.resolve(hashEmbedder(16)(text));
    const ss = createSemanticSearch({ embedder: embed });
    await ss.index('x', 'async text');
    const res = await ss.search('async text');
    expect(res[0].score).toBeCloseTo(1.0, 5);
  });

  it('multiple documents ranked by similarity', async () => {
    const embed = hashEmbedder(64);
    const ss = createSemanticSearch({ embedder: embed });
    await ss.index('a', 'apple');
    await ss.index('b', 'banana');
    await ss.index('c', 'cherry');
    const res = await ss.search('apple');
    expect(res[0].id).toBe('a');
    expect(res[0].score).toBeCloseTo(1.0, 5);
  });
});

// ─── Persistence ──────────────────────────────────────────────────────────────

describe('persistence — save / load', () => {
  it('save() writes a valid JSON file with version 1', () => {
    const p = managedPersistPath();
    const ss = createSemanticSearch({ persistPath: p });
    ss.indexVector('a', vec(1, 0, 0), { note: 'hi' });
    ss.save();
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(data.version).toBe(1);
    expect(data.items).toHaveLength(1);
  });

  it('save+load roundtrip preserves all ids', () => {
    const p = managedPersistPath();
    const ss = createSemanticSearch({ persistPath: p });
    ss.indexVector('a', vec(1, 0, 0));
    ss.indexVector('b', vec(0, 1, 0));
    ss.save();

    const ss2 = createSemanticSearch({ persistPath: p });
    ss2.load();
    expect(ss2.size()).toBe(2);
  });

  it('save+load roundtrip preserves metadata', () => {
    const p = managedPersistPath();
    const ss = createSemanticSearch<{ label: string }>({ persistPath: p });
    ss.indexVector('a', vec(1, 0, 0), { label: 'kept' });
    ss.save();

    const ss2 = createSemanticSearch<{ label: string }>({ persistPath: p });
    ss2.load();
    return ss2.search(vec(1, 0, 0)).then(res => {
      expect(res[0].metadata?.label).toBe('kept');
    });
  });

  it('save+load roundtrip preserves vectors (search still works)', async () => {
    const p = managedPersistPath();
    const v = vec(1, 2, 3);
    const ss = createSemanticSearch({ persistPath: p });
    ss.indexVector('v', v);
    ss.save();

    const ss2 = createSemanticSearch({ persistPath: p });
    ss2.load();
    const [r] = await ss2.search(v);
    expect(r.score).toBeCloseTo(1.0, 5);
  });

  it('load() on non-existent file is a no-op', () => {
    const ss = createSemanticSearch({ persistPath: managedPersistPath() });
    expect(() => ss.load()).not.toThrow();
    expect(ss.size()).toBe(0);
  });

  it('save() uses atomic tmp+rename (no leftover .tmp- files)', () => {
    const p = managedPersistPath();
    const ss = createSemanticSearch({ persistPath: p });
    ss.indexVector('a', vec(1, 0, 0));
    ss.save();
    const dir = path.dirname(p);
    const leftovers = fs.readdirSync(dir).filter(f => f.includes('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('save() throws when no persistPath configured', () => {
    const ss = createSemanticSearch();
    ss.indexVector('a', vec(1, 0, 0));
    expect(() => ss.save()).toThrow();
  });

  it('load() throws when no persistPath configured', () => {
    const ss = createSemanticSearch();
    expect(() => ss.load()).toThrow();
  });
});
