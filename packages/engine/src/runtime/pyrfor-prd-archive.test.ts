import { describe, it, expect, beforeEach } from 'vitest';
import { PrdArchive, type MemoryStoreLike, type PrdRecord } from './pyrfor-prd-archive';

// ── Fake MemoryStoreLike (in-memory Map) ─────────────────────────────────────

interface StoreEntry {
  id: string;
  text: string;
  tags: string[];
  scope: string;
  meta: Record<string, unknown>;
}

function createFakeStore(): MemoryStoreLike & { _entries: Map<string, StoreEntry> } {
  const _entries = new Map<string, StoreEntry>();

  return {
    _entries,

    async add(args) {
      _entries.set(args.id, {
        id: args.id,
        text: args.text,
        tags: args.tags,
        scope: args.scope,
        meta: args.meta ?? {},
      });
    },

    async remove(id) {
      return _entries.delete(id);
    },

    async search(q, opts) {
      const results: Array<{ id: string; text: string; tags: string[]; meta: Record<string, unknown>; score: number }> = [];
      let rank = 0;

      for (const entry of _entries.values()) {
        // Scope filter
        if (opts?.scope !== undefined && entry.scope !== opts.scope) continue;

        // Tag filter — all required tags must be present
        if (opts?.tags && opts.tags.length > 0) {
          if (!opts.tags.every(t => entry.tags.includes(t))) continue;
        }

        // Text filter — empty query matches everything
        if (q !== '' && !entry.text.toLowerCase().includes(q.toLowerCase())) continue;

        results.push({ id: entry.id, text: entry.text, tags: entry.tags, meta: entry.meta, score: 1 / (rank + 1) });
        rank++;
      }

      if (opts?.topK !== undefined) return results.slice(0, opts.topK);
      return results;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrd(
  partial: Partial<Omit<PrdRecord, 'createdAt' | 'updatedAt'>> & Pick<PrdRecord, 'id'>,
): Omit<PrdRecord, 'createdAt' | 'updatedAt'> {
  return {
    id: partial.id,
    taskId: partial.taskId ?? 'task-1',
    title: partial.title ?? 'Test PRD',
    body: partial.body ?? 'Some body text.',
    tags: partial.tags ?? [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PrdArchive', () => {
  let store: ReturnType<typeof createFakeStore>;
  let archive: PrdArchive;

  beforeEach(() => {
    store = createFakeStore();
    archive = new PrdArchive({ store });
  });

  it('upsert then get returns the same record', async () => {
    const prd = makePrd({ id: 'prd-1', title: 'My Spec', body: 'Detailed spec.' });
    const upserted = await archive.upsert(prd);
    const fetched = await archive.get('prd-1');
    expect(fetched).toEqual(upserted);
    expect(fetched?.title).toBe('My Spec');
    expect(fetched?.body).toBe('Detailed spec.');
  });

  it('upsert twice: updatedAt advances, createdAt is preserved', async () => {
    const prd = makePrd({ id: 'prd-2' });
    const first = await archive.upsert({ ...prd, createdAt: 1000, updatedAt: 1000 });
    const second = await archive.upsert({ ...prd, title: 'Updated', updatedAt: 2000 });

    expect(second.createdAt).toBe(first.createdAt); // preserved
    expect(second.updatedAt).toBe(2000);             // advanced
    expect(second.title).toBe('Updated');
  });

  it('upsert writes to store with correct scope and task tag', async () => {
    await archive.upsert(makePrd({ id: 'prd-3', taskId: 'task-99' }));
    const entry = store._entries.get('prd-3');
    expect(entry?.scope).toBe('prd');
    expect(entry?.tags).toContain('task:task-99');
  });

  it('search delegates to store with scope and returns PrdRecords with score', async () => {
    await archive.upsert(makePrd({ id: 'prd-4', body: 'authentication flow design' }));
    const results = await archive.search('authentication');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('prd-4');
    expect(typeof results[0].score).toBe('number');
  });

  it('listByTask filters records by taskId', async () => {
    await archive.upsert(makePrd({ id: 'prd-5', taskId: 'task-A' }));
    await archive.upsert(makePrd({ id: 'prd-6', taskId: 'task-B' }));
    await archive.upsert(makePrd({ id: 'prd-7', taskId: 'task-A' }));

    const results = await archive.listByTask('task-A');
    const ids = results.map(r => r.id).sort();
    expect(ids).toEqual(['prd-5', 'prd-7']);
  });

  it('search with taskId opts post-filters by task tag', async () => {
    await archive.upsert(makePrd({ id: 'prd-8', taskId: 'task-X', body: 'foo feature spec' }));
    await archive.upsert(makePrd({ id: 'prd-9', taskId: 'task-Y', body: 'foo feature spec' }));

    const results = await archive.search('foo', { taskId: 'task-X' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('prd-8');
  });

  it('remove returns true and subsequent get returns null', async () => {
    await archive.upsert(makePrd({ id: 'prd-10' }));
    const removed = await archive.remove('prd-10');
    expect(removed).toBe(true);
    const fetched = await archive.get('prd-10');
    expect(fetched).toBeNull();
  });

  it('remove on unknown id returns false', async () => {
    const result = await archive.remove('nonexistent');
    expect(result).toBe(false);
  });

  it('empty search (blank query, no filters) returns all records in scope', async () => {
    await archive.upsert(makePrd({ id: 'prd-11' }));
    await archive.upsert(makePrd({ id: 'prd-12' }));
    const results = await archive.search('');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('search on empty archive returns empty array', async () => {
    const results = await archive.search('anything');
    expect(results).toEqual([]);
  });

  it('custom scope is forwarded to store', async () => {
    const customArchive = new PrdArchive({ store, scope: 'specs' });
    await customArchive.upsert(makePrd({ id: 'prd-13' }));
    const entry = store._entries.get('prd-13');
    expect(entry?.scope).toBe('specs');
  });
});
