import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildLessons,
  lessonsAsFcOptions,
  markLessonsApplied,
  type LessonsBridgeOptions,
  type BuildLessonsInput,
} from './pyrfor-fc-lessons-bridge';
import type { MemoryStore, MemoryEntry } from './memory-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(id: string, kind: MemoryEntry['kind'], text: string, tags: string[] = []): MemoryEntry {
  return {
    id,
    kind,
    text,
    source: 'test',
    scope: 'lessons',
    tags,
    weight: 1,
    applied_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeStore(entries: MemoryEntry[]): MemoryStore {
  return {
    add: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    query: vi.fn((q) => {
      if (!q) return entries;
      const tagFilter = q.tags;
      if (tagFilter && tagFilter.length > 0) {
        return entries.filter(e => tagFilter.some((t: string) => e.tags.includes(t)));
      }
      return entries;
    }),
    search: vi.fn((_text, opts) => {
      const scope = opts?.scope;
      const limit = opts?.limit ?? entries.length;
      const scoped = scope ? entries.filter(e => e.scope === scope) : entries;
      return scoped.slice(0, limit);
    }),
    recordApplied: vi.fn(),
    prune: vi.fn(),
    count: vi.fn(() => entries.length),
    close: vi.fn(),
    exportAll: vi.fn(() => entries),
    importMany: vi.fn(),
  } as unknown as MemoryStore;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pyrfor-fc-lessons-bridge', () => {
  // 1. Empty store → empty result
  it('empty store returns empty text, usedIds=[], truncated=false', () => {
    const store = makeStore([]);
    const opts: LessonsBridgeOptions = { store };
    const result = buildLessons({ task: 'anything' }, opts);
    expect(result.text).toBe('');
    expect(result.usedIds).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  // 2. 5 entries, topK=3 → 3 in result
  it('returns topK entries when store has more', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`id-${i}`, 'lesson', `lesson text ${i}`),
    );
    const store = makeStore(entries);
    const opts: LessonsBridgeOptions = { store, scopes: ['lessons'], topK: 3 };
    const result = buildLessons({ task: 'task' }, opts);
    expect(result.usedIds).toHaveLength(3);
    // Text should contain 3 lesson lines
    const lessonLines = result.text.split('\n').filter(l => l.startsWith('### lesson:'));
    expect(lessonLines).toHaveLength(3);
  });

  // 3. Pinned lines appear before fetched entries
  it('pinned lines appear before fetched entries', () => {
    const entries = [makeEntry('id-1', 'lesson', 'fetched lesson')];
    const store = makeStore(entries);
    const opts: LessonsBridgeOptions = { store };
    const result = buildLessons({ task: 'task', pinned: ['PINNED LINE'] }, opts);
    const pinnedIdx = result.text.indexOf('PINNED LINE');
    const fetchedIdx = result.text.indexOf('### lesson: fetched lesson');
    expect(pinnedIdx).toBeGreaterThanOrEqual(0);
    expect(fetchedIdx).toBeGreaterThanOrEqual(0);
    expect(pinnedIdx).toBeLessThan(fetchedIdx);
  });

  // 4. Truncation with low maxChars → truncated=true; text length ≤ maxChars
  it('truncates text to maxChars and sets truncated=true', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`id-${i}`, 'lesson', `lesson text ${i} `.repeat(20)),
    );
    const store = makeStore(entries);
    const opts: LessonsBridgeOptions = { store, maxChars: 100 };
    const result = buildLessons({ task: 'task' }, opts);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(100);
  });

  // 5. Multiple scopes queried; results deduped by id
  it('queries multiple scopes and dedupes by id', () => {
    const shared = makeEntry('shared-id', 'lesson', 'shared lesson');
    const storeEntries = [
      { ...shared, scope: 'lessons' },
      { ...shared, scope: 'project' },
    ];
    // The search mock returns entries matching scope
    const store: MemoryStore = {
      search: vi.fn((_text, opts) => {
        const scope = opts?.scope;
        return storeEntries.filter(e => e.scope === scope);
      }),
    } as unknown as MemoryStore;

    const opts: LessonsBridgeOptions = { store, scopes: ['lessons', 'project'] };
    const result = buildLessons({ task: 'task' }, opts);
    // Only one entry despite appearing in two scopes
    expect(result.usedIds).toHaveLength(1);
    expect(result.usedIds[0]).toBe('shared-id');
  });

  // 6. lessonsAsFcOptions concatenates with base.appendSystemPrompt
  it('lessonsAsFcOptions concatenates with existing appendSystemPrompt', () => {
    const entries = [makeEntry('id-1', 'lesson', 'useful lesson')];
    const store = makeStore(entries);
    const opts: LessonsBridgeOptions = { store };
    const result = lessonsAsFcOptions({ task: 'task' }, opts, {
      appendSystemPrompt: 'BASE PROMPT',
    });
    expect(result.appendSystemPrompt).toContain('BASE PROMPT');
    expect(result.appendSystemPrompt).toContain('useful lesson');
  });

  // 7. lessonsAsFcOptions does not mutate base
  it('lessonsAsFcOptions does not mutate the base object', () => {
    const store = makeStore([makeEntry('id-1', 'lesson', 'text')]);
    const opts: LessonsBridgeOptions = { store };
    const base = { appendSystemPrompt: 'original' };
    lessonsAsFcOptions({ task: 'task' }, opts, base);
    expect(base.appendSystemPrompt).toBe('original');
  });

  // 8. markLessonsApplied calls recordApplied for each id
  it('markLessonsApplied calls store.recordApplied for each id', () => {
    const store = makeStore([]);
    markLessonsApplied(['id-a', 'id-b', 'id-c'], store);
    expect(store.recordApplied).toHaveBeenCalledTimes(3);
    expect(store.recordApplied).toHaveBeenCalledWith('id-a');
    expect(store.recordApplied).toHaveBeenCalledWith('id-b');
    expect(store.recordApplied).toHaveBeenCalledWith('id-c');
  });

  // 9. Tags filter passed to search / filters entries
  it('filters entries by tags', () => {
    const entries = [
      makeEntry('id-tagged', 'lesson', 'tagged lesson', ['important']),
      makeEntry('id-plain', 'lesson', 'plain lesson', []),
    ];
    const store = makeStore(entries);
    // Override search to return all within scope
    (store.search as ReturnType<typeof vi.fn>).mockImplementation((_text, _opts) => entries);

    const opts: LessonsBridgeOptions = { store };
    const result = buildLessons({ task: 'task', tags: ['important'] }, opts);
    expect(result.usedIds).toEqual(['id-tagged']);
  });

  // 10. lessonsAsFcOptions with empty store returns base appendSystemPrompt unchanged structure
  it('lessonsAsFcOptions with empty store still returns appendSystemPrompt', () => {
    const store = makeStore([]);
    const opts: LessonsBridgeOptions = { store };
    const result = lessonsAsFcOptions({ task: 'task' }, opts, {
      appendSystemPrompt: 'BASE',
    });
    // When text is empty, combined should be 'BASE\n\n' or just 'BASE'
    expect(result.appendSystemPrompt).toContain('BASE');
  });
});
