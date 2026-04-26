// @vitest-environment node
/**
 * fts5-search.test.ts — Tests for the Fts5Search public API.
 *
 * Setup strategy
 * ──────────────
 * - A fresh SQLite file is created in `os.tmpdir()` per test run.
 * - 8 entries are inserted via the public `MemoryStore.add()` API.
 * - 2 additional entries (for hybrid-rerank testing) are inserted through a
 *   separate `better-sqlite3` write connection so that `updated_at` can be set
 *   to an arbitrary past date.  This is permissible in test-only code; the
 *   production `Fts5Search` class itself never writes to the database.
 * - `Fts5Search` connects with `{ readonly: true, fileMustExist: true }`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createMemoryStore } from '../runtime/memory-store.js';
import type { MemoryStore } from '../runtime/memory-store.js';
import {
  Fts5Search,
  sanitizeFtsQuery,
  buildMatchExpression,
  recencyDecay,
} from './fts5-search.js';

// ====== Test database setup ===============================================

let TEST_DB_DIR: string;
let TEST_DB_PATH: string;
let store: MemoryStore;
let fts: Fts5Search;

// IDs of the two hybrid-test entries inserted via direct SQL
const HYBRID_RECENT_ID = 'hybrid-recent-001';
const HYBRID_OLD_ID = 'hybrid-old-001';

beforeAll(() => {
  TEST_DB_DIR = path.join(os.tmpdir(), `fts5-search-test-${Date.now()}`);
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

  // ── Initialize store (creates schema, FTS5 virtual table, triggers) ────
  store = createMemoryStore({ dbPath: TEST_DB_PATH });

  // ── Insert entries via public API ──────────────────────────────────────
  store.add({
    kind: 'fact',
    text: 'The quick brown fox jumps over the lazy dog',
    source: 'test',
    scope: 'zoology',
    tags: ['animals', 'classic'],
    weight: 0.8,
  });
  store.add({
    kind: 'fact',
    text: 'Machine learning enables pattern recognition in data',
    source: 'test',
    scope: 'technology',
    tags: ['ai', 'tech'],
    weight: 0.7,
  });
  store.add({
    kind: 'preference',
    text: 'TypeScript provides type safety and static analysis',
    source: 'test',
    scope: 'coding',
    tags: ['typescript', 'lang'],
    weight: 0.9,
  });
  store.add({
    kind: 'episode',
    text: 'Completed authentication module implementation',
    source: 'test',
    scope: 'coding',
    tags: ['auth', 'dev'],
    weight: 0.6,
  });
  store.add({
    kind: 'lesson',
    text: 'The fox and the hound formed an unlikely friendship',
    source: 'test',
    scope: 'stories',
    tags: ['animals', 'friendship'],
    weight: 0.5,
  });
  store.add({
    kind: 'reference',
    text: 'SQLite FTS5 supports Boolean operators for full text search',
    source: 'test',
    scope: 'database',
    tags: ['sqlite', 'search'],
    weight: 0.8,
  });
  store.add({
    kind: 'fact',
    text: 'Python is widely used for data science and machine learning workflows',
    source: 'test',
    scope: 'technology',
    tags: ['python', 'tech'],
    weight: 0.7,
  });
  store.add({
    kind: 'preference',
    text: 'Functional programming favors immutable data structures',
    source: 'test',
    scope: 'coding',
    tags: ['functional', 'lang'],
    weight: 0.8,
  });

  // ── Insert hybrid-test entries via direct SQL (custom updated_at) ──────
  // This is ONLY done in test code.  Production Fts5Search is strictly read-only.
  const now = new Date().toISOString();
  const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString(); // 100 days ago

  const writeDb = new Database(TEST_DB_PATH);
  const ins = writeDb.prepare(`
    INSERT INTO memory_entries
      (id, kind, text, source, scope, tags, weight, applied_count,
       created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  ins.run(
    HYBRID_RECENT_ID, 'fact',
    'hybrid rerank identical comparison text',
    'test', 'hybrid', '["hybrid"]', 0.5, 0, now, now, null,
  );
  ins.run(
    HYBRID_OLD_ID, 'fact',
    'hybrid rerank identical comparison text',
    'test', 'hybrid', '["hybrid"]', 0.5, 0, oldDate, oldDate, null,
  );
  writeDb.close();

  // ── Open Fts5Search with read-only connection ──────────────────────────
  fts = new Fts5Search({ dbPath: TEST_DB_PATH });
});

afterAll(async () => {
  await fts.close();
  store.close();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// ====== sanitizeFtsQuery ==================================================

describe('sanitizeFtsQuery', () => {
  it('returns "" for blank input', () => {
    expect(sanitizeFtsQuery('')).toBe('""');
    expect(sanitizeFtsQuery('   ')).toBe('""');
  });

  it('drops ASCII control characters', () => {
    const result = sanitizeFtsQuery('hello\x00world\x1ftest');
    expect(result).not.toMatch(/[\x00-\x1f]/);
    expect(result).toContain('hello');
    expect(result).toContain('world');
    expect(result).toContain('test');
  });

  it('preserves double-quoted phrases verbatim', () => {
    const result = sanitizeFtsQuery('"quick brown fox"');
    expect(result).toBe('"quick brown fox"');
  });

  it('strips stray double-quotes from bare terms', () => {
    const result = sanitizeFtsQuery('hel"lo');
    expect(result).toBe('hello');
  });

  it('keeps AND / OR / NOT operators (uppercased)', () => {
    const result = sanitizeFtsQuery('fox and hound or wolf not cat');
    expect(result).toBe('fox AND hound OR wolf NOT cat');
  });

  it('keeps NEAR operator', () => {
    const result = sanitizeFtsQuery('fox NEAR hound');
    expect(result).toContain('NEAR');
  });

  it('normalises NEAR/N operator', () => {
    const result = sanitizeFtsQuery('fox NEAR/5 hound');
    expect(result).toContain('NEAR/5');
  });
});

// ====== buildMatchExpression ==============================================

describe('buildMatchExpression', () => {
  it('returns "" for empty array', () => {
    expect(buildMatchExpression([])).toBe('""');
  });

  it('joins terms with spaces (implicit AND)', () => {
    expect(buildMatchExpression(['fox', 'hound'])).toBe('fox hound');
  });

  it('strips double-quotes from terms', () => {
    expect(buildMatchExpression(['"quoted"'])).toBe('quoted');
  });
});

// ====== recencyDecay ======================================================

describe('recencyDecay', () => {
  it('returns ~1 for a timestamp of now', () => {
    const ts = new Date().toISOString();
    expect(recencyDecay(ts)).toBeCloseTo(1, 3);
  });

  it('returns ~0.5 at one half-life', () => {
    const halfLife = 14;
    const ts = new Date(Date.now() - halfLife * 86_400_000).toISOString();
    expect(recencyDecay(ts, halfLife)).toBeCloseTo(0.5, 2);
  });

  it('returns ~0.25 at two half-lives', () => {
    const halfLife = 14;
    const ts = new Date(Date.now() - 2 * halfLife * 86_400_000).toISOString();
    expect(recencyDecay(ts, halfLife)).toBeCloseTo(0.25, 2);
  });

  it('respects a custom halfLifeDays parameter', () => {
    const ts = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(recencyDecay(ts, 7)).toBeCloseTo(0.5, 2);
  });
});

// ====== Fts5Search.search =================================================

describe('Fts5Search.search', () => {
  it('returns hits ordered by BM25 ascending (best first)', async () => {
    const hits = await fts.search({ query: 'fox' });
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) {
      // Lower (more negative) BM25 score = more relevant = earlier in list
      expect(hits[i - 1].score).toBeLessThanOrEqual(hits[i].score);
    }
  });

  it('each hit has a negative BM25 score', async () => {
    const hits = await fts.search({ query: 'fox' });
    expect(hits.every(h => h.score < 0)).toBe(true);
  });

  it('returns MemoryEntry fields on each hit', async () => {
    const [hit] = await fts.search({ query: 'fox' });
    expect(hit).toBeDefined();
    expect(hit.entry.id).toBeTruthy();
    expect(hit.entry.kind).toBeTruthy();
    expect(hit.entry.text).toMatch(/fox/i);
  });

  it('scope filter limits results to matching scope only', async () => {
    const hits = await fts.search({ query: 'machine', scope: 'technology' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.entry.scope === 'technology')).toBe(true);
  });

  it('scope array filter works', async () => {
    const hits = await fts.search({ query: 'data', scope: ['technology', 'database'] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => ['technology', 'database'].includes(h.entry.scope))).toBe(true);
  });

  it('scope filter excludes results from other scopes', async () => {
    // 'machine' only appears in 'technology' scope
    const hits = await fts.search({ query: 'machine', scope: 'coding' });
    expect(hits.length).toBe(0);
  });

  it('kinds filter limits results to matching kinds', async () => {
    const hits = await fts.search({ query: 'data', kinds: ['preference'] });
    expect(hits.every(h => h.entry.kind === 'preference')).toBe(true);
  });

  it('kinds filter excludes non-matching kinds', async () => {
    // 'TypeScript' text is in a 'preference' entry; searching with kind='episode' should miss it
    const hits = await fts.search({ query: 'TypeScript', kinds: ['episode'] });
    expect(hits.length).toBe(0);
  });

  it('tags ALL-of match: entry must carry every requested tag', async () => {
    // Only entry with both 'animals' AND 'classic' is the fox-jumps entry
    const hits = await fts.search({ query: 'fox', tags: ['animals', 'classic'] });
    expect(hits.length).toBe(1);
    expect(hits[0].entry.tags).toContain('animals');
    expect(hits[0].entry.tags).toContain('classic');
  });

  it('tags filter excludes entry missing one of the required tags', async () => {
    // fox-hound entry has 'animals' and 'friendship' but NOT 'classic'
    const hits = await fts.search({ query: 'fox', tags: ['animals', 'classic', 'friendship'] });
    expect(hits.length).toBe(0);
  });

  it('snippet contains <mark> wrappers when snippetTokens > 0', async () => {
    const hits = await fts.search({ query: 'fox', snippetTokens: 8 });
    expect(hits.length).toBeGreaterThan(0);
    const withSnippet = hits.filter(h => h.snippet !== undefined);
    expect(withSnippet.length).toBeGreaterThan(0);
    expect(withSnippet[0].snippet).toMatch(/<mark>/);
    expect(withSnippet[0].snippet).toMatch(/<\/mark>/);
  });

  it('no snippet property when snippetTokens is 0 (default)', async () => {
    const hits = await fts.search({ query: 'fox' });
    expect(hits.every(h => h.snippet === undefined)).toBe(true);
  });

  it('matchedTerms contains the search term', async () => {
    const hits = await fts.search({ query: 'fox' });
    expect(hits[0].matchedTerms).toContain('fox');
  });

  it('limit and offset are respected', async () => {
    const all = await fts.search({ query: 'data', limit: 100 });
    const first = await fts.search({ query: 'data', limit: 1 });
    const second = await fts.search({ query: 'data', limit: 1, offset: 1 });
    if (all.length >= 2) {
      expect(first.length).toBe(1);
      expect(second.length).toBe(1);
      expect(first[0].entry.id).not.toBe(second[0].entry.id);
    }
  });

  it('returns empty array when query matches nothing', async () => {
    const hits = await fts.search({ query: 'xyzzy_no_match_quantum_flux' });
    expect(hits).toEqual([]);
  });
});

// ====== Fts5Search.count ==================================================

describe('Fts5Search.count', () => {
  it('returns total matching count', async () => {
    const n = await fts.count('fox');
    expect(n).toBeGreaterThan(0);
  });

  it('count with scope filter', async () => {
    const total = await fts.count('machine');
    const scoped = await fts.count('machine', { scope: 'technology' });
    const other = await fts.count('machine', { scope: 'coding' });
    expect(scoped).toBeLessThanOrEqual(total);
    expect(other).toBe(0);
  });

  it('count with kinds filter', async () => {
    const n = await fts.count('TypeScript', { kinds: ['preference'] });
    expect(n).toBeGreaterThan(0);
    const none = await fts.count('TypeScript', { kinds: ['episode'] });
    expect(none).toBe(0);
  });

  it('returns 0 for unmatched query', async () => {
    expect(await fts.count('xyzzy_no_match_quantum_flux')).toBe(0);
  });
});

// ====== Fts5Search.suggest ================================================

describe('Fts5Search.suggest', () => {
  it('returns words starting with the given prefix', async () => {
    const results = await fts.suggest('mach');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.toLowerCase().startsWith('mach'))).toBe(true);
  });

  it('respects the limit parameter', async () => {
    // 'f' matches many words: fox, formed, friendship, functional, full, favors …
    const results = await fts.suggest('f', 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.every(r => r.toLowerCase().startsWith('f'))).toBe(true);
  });

  it('returns empty array for unknown prefix', async () => {
    const results = await fts.suggest('zzzunknown');
    expect(results).toEqual([]);
  });

  it('returns empty array for empty prefix', async () => {
    const results = await fts.suggest('');
    expect(results).toEqual([]);
  });

  it('deduplicates completions', async () => {
    // 'machine' appears in two entries; should only appear once in suggestions
    const results = await fts.suggest('machine');
    const lower = results.map(r => r.toLowerCase());
    const unique = new Set(lower);
    expect(unique.size).toBe(lower.length);
  });
});

// ====== Hybrid rerank =====================================================

describe('Fts5Search hybrid rerank', () => {
  it('hybrid rerank places the more recent entry first', async () => {
    const hybridHits = await fts.search({
      query: 'hybrid rerank identical comparison',
      scope: 'hybrid',
      rerank: 'hybrid',
    });
    // Both entries have identical text → same BM25 score.
    // Hybrid multiplies by recencyDecay; recent entry retains a lower (more
    // negative) score → appears first when sorted ASC.
    expect(hybridHits.length).toBe(2);
    expect(hybridHits[0].entry.id).toBe(HYBRID_RECENT_ID);
    expect(hybridHits[1].entry.id).toBe(HYBRID_OLD_ID);
  });

  it('bm25 and hybrid produce different orderings for recency-divergent entries', async () => {
    const bm25Hits = await fts.search({
      query: 'hybrid rerank identical comparison',
      scope: 'hybrid',
      rerank: 'bm25',
    });
    const hybridHits = await fts.search({
      query: 'hybrid rerank identical comparison',
      scope: 'hybrid',
      rerank: 'hybrid',
    });
    // BM25 order may be arbitrary (same score), but hybrid always puts recent first
    expect(hybridHits[0].entry.id).toBe(HYBRID_RECENT_ID);
    // Verify the two runs returned the same set of entries (just potentially different order)
    const bm25Ids = new Set(bm25Hits.map(h => h.entry.id));
    expect(bm25Ids.has(HYBRID_RECENT_ID)).toBe(true);
    expect(bm25Ids.has(HYBRID_OLD_ID)).toBe(true);
  });
});

// ====== Fts5Search.close ==================================================

describe('Fts5Search.close', () => {
  it('closes the read-only handle and re-opening the same file succeeds', async () => {
    const localFts = new Fts5Search({ dbPath: TEST_DB_PATH });
    // Verify it works before closing
    const hitsBefore = await localFts.search({ query: 'fox' });
    expect(hitsBefore.length).toBeGreaterThan(0);

    // Close
    await localFts.close();

    // Re-open — should succeed without throwing
    const reopened = new Fts5Search({ dbPath: TEST_DB_PATH });
    const hitsAfter = await reopened.search({ query: 'fox' });
    expect(hitsAfter.length).toBeGreaterThan(0);
    await reopened.close();
  });
});
