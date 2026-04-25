// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryStore, type MemoryStore } from './memory-store.js';
import {
  createMemoryNudge,
  defaultBuildText,
  defaultScoring,
  formatPromptInjection,
  type SkillAppliedEvent,
  type MemoryNudge,
} from './memory-nudge.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeStore(): MemoryStore {
  return createMemoryStore({ dbPath: ':memory:' });
}

function baseEvent(overrides: Partial<SkillAppliedEvent> = {}): SkillAppliedEvent {
  return {
    skillId: 'skill-001',
    skillName: 'summarise',
    scope: 'global',
    task: 'Summarise the meeting notes',
    outcome: 'success',
    toolsUsed: ['read_file', 'write_file'],
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('MemoryNudge', () => {
  let store: MemoryStore;
  let nudge: MemoryNudge;

  beforeEach(() => {
    store = makeStore();
    nudge = createMemoryNudge({ memory: store });
  });

  afterEach(() => {
    try { store.close(); } catch { /* already closed */ }
  });

  // ── recordSkillApplied ─────────────────────────────────────────────────

  it('recordSkillApplied creates an entry with kind=episode', () => {
    const entry = nudge.recordSkillApplied(baseEvent());
    expect(entry.kind).toBe('episode');
  });

  it('recordSkillApplied sets source=agent', () => {
    const entry = nudge.recordSkillApplied(baseEvent());
    expect(entry.source).toBe('agent');
  });

  it('recordSkillApplied persists to store (count increases)', () => {
    expect(store.count()).toBe(0);
    nudge.recordSkillApplied(baseEvent());
    expect(store.count()).toBe(1);
  });

  it('recordSkillApplied sets expires_at', () => {
    const entry = nudge.recordSkillApplied(baseEvent());
    expect(entry.expires_at).toBeTruthy();
    const expiresMs = new Date(entry.expires_at!).getTime();
    const nowMs = Date.now();
    // Should expire roughly 90 days from now (allow 5 second tolerance)
    expect(expiresMs).toBeGreaterThan(nowMs + 89 * 86_400_000);
    expect(expiresMs).toBeLessThan(nowMs + 91 * 86_400_000);
  });

  it('weight mapping: success → weightSuccess (default 0.6)', () => {
    const entry = nudge.recordSkillApplied(baseEvent({ outcome: 'success' }));
    expect(entry.weight).toBe(0.6);
  });

  it('weight mapping: failure → weightFailure (default 0.4)', () => {
    const entry = nudge.recordSkillApplied(baseEvent({ outcome: 'failure' }));
    expect(entry.weight).toBe(0.4);
  });

  it('weight mapping: partial → weightPartial (default 0.5)', () => {
    const entry = nudge.recordSkillApplied(baseEvent({ outcome: 'partial' }));
    expect(entry.weight).toBe(0.5);
  });

  it('weight overrides respected', () => {
    const n2 = createMemoryNudge({ memory: store, weightSuccess: 0.9, weightFailure: 0.1 });
    const s = n2.recordSkillApplied(baseEvent({ outcome: 'success' }));
    const f = n2.recordSkillApplied(baseEvent({ outcome: 'failure' }));
    expect(s.weight).toBe(0.9);
    expect(f.weight).toBe(0.1);
  });

  it('tags include skillName + outcome + toolsUsed', () => {
    const entry = nudge.recordSkillApplied(
      baseEvent({ skillName: 'analyse', outcome: 'partial', toolsUsed: ['search'] }),
    );
    expect(entry.tags).toContain('analyse');
    expect(entry.tags).toContain('partial');
    expect(entry.tags).toContain('search');
  });

  it('tags capped at 10', () => {
    const tools = Array.from({ length: 15 }, (_, i) => `tool${i}`);
    const entry = nudge.recordSkillApplied(baseEvent({ toolsUsed: tools }));
    expect(entry.tags.length).toBeLessThanOrEqual(10);
  });

  it('scope falls back to defaultScope when event scope is empty', () => {
    const n2 = createMemoryNudge({ memory: store, defaultScope: 'project-x' });
    // Pass empty scope to trigger fallback
    const entry = n2.recordSkillApplied(baseEvent({ scope: '' }));
    expect(entry.scope).toBe('project-x');
  });

  it('scope uses event.scope when provided', () => {
    const entry = nudge.recordSkillApplied(baseEvent({ scope: 'user:42' }));
    expect(entry.scope).toBe('user:42');
  });

  // ── buildText override ─────────────────────────────────────────────────

  it('buildText override is used', () => {
    const n2 = createMemoryNudge({
      memory: store,
      buildText: (e) => `CUSTOM:${e.skillName}:${e.outcome}`,
    });
    const entry = n2.recordSkillApplied(baseEvent());
    expect(entry.text).toBe('CUSTOM:summarise:success');
  });

  // ── defaultBuildText ───────────────────────────────────────────────────

  it('defaultBuildText formats correctly with tools', () => {
    const e = baseEvent({ skillName: 'translate', outcome: 'success', toolsUsed: ['api_call'] });
    const text = defaultBuildText(e);
    expect(text).toContain("Skill 'translate'");
    expect(text).toContain('success');
    expect(text).toContain(e.task);
    expect(text).toContain('api_call');
  });

  it('defaultBuildText handles no tools', () => {
    const text = defaultBuildText(baseEvent({ toolsUsed: [] }));
    expect(text).toContain('Tools: []');
  });

  // ── ingestLesson ───────────────────────────────────────────────────────

  it('ingestLesson creates entry with kind=lesson', () => {
    const entry = nudge.ingestLesson('Always validate input');
    expect(entry.kind).toBe('lesson');
  });

  it('ingestLesson default weight is 0.7', () => {
    const entry = nudge.ingestLesson('Always validate input');
    expect(entry.weight).toBe(0.7);
  });

  it('ingestLesson accepts custom weight and tags', () => {
    const entry = nudge.ingestLesson('Prefer async', { weight: 0.9, tags: ['coding', 'async'] });
    expect(entry.weight).toBe(0.9);
    expect(entry.tags).toContain('coding');
    expect(entry.tags).toContain('async');
  });

  it('ingestLesson sets expires_at', () => {
    const entry = nudge.ingestLesson('A lesson');
    expect(entry.expires_at).toBeTruthy();
  });

  // ── nudge ──────────────────────────────────────────────────────────────

  it('nudge returns entries and promptInjection', () => {
    nudge.recordSkillApplied(baseEvent());
    const result = nudge.nudge({ query: 'Summarise the meeting notes' });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.promptInjection).toContain('## Relevant memory');
  });

  it('nudge with empty query returns empty result', () => {
    nudge.recordSkillApplied(baseEvent());
    const result = nudge.nudge({ query: '' });
    expect(result.entries).toHaveLength(0);
    expect(result.promptInjection).toBe('');
    expect(result.scores).toHaveLength(0);
  });

  it('nudge with whitespace-only query returns empty result', () => {
    nudge.recordSkillApplied(baseEvent());
    const result = nudge.nudge({ query: '   ' });
    expect(result.entries).toHaveLength(0);
  });

  it('nudge with maxNudgesPerCall=0 returns empty', () => {
    const n2 = createMemoryNudge({ memory: store, maxNudgesPerCall: 0 });
    n2.recordSkillApplied(baseEvent());
    const result = n2.nudge({ query: 'summarise meeting notes' });
    expect(result.entries).toHaveLength(0);
  });

  it('nudge respects maxNudgesPerCall', () => {
    const n2 = createMemoryNudge({ memory: store, maxNudgesPerCall: 2 });
    for (let i = 0; i < 6; i++) {
      n2.recordSkillApplied(baseEvent({ task: `task ${i}` }));
    }
    const result = n2.nudge({ query: 'task' });
    expect(result.entries.length).toBeLessThanOrEqual(2);
  });

  it('nudge filters by tags intersection', () => {
    // Entry with tag 'coding' and one without
    nudge.recordSkillApplied(baseEvent({ skillName: 'code-gen', outcome: 'success', toolsUsed: [] }));
    nudge.ingestLesson('A generic lesson', { tags: ['other'] });
    const result = nudge.nudge({ query: 'code-gen success', tags: ['code-gen'] });
    // All returned entries must have the 'code-gen' tag
    for (const e of result.entries) {
      expect(e.tags).toContain('code-gen');
    }
  });

  it('nudge minScore filters out low-scoring entries', () => {
    // Use a very high minScore so nothing passes
    const n2 = createMemoryNudge({ memory: store, minScore: 999 });
    n2.recordSkillApplied(baseEvent());
    const result = n2.nudge({ query: 'summarise' });
    expect(result.entries).toHaveLength(0);
  });

  it('nudge returns scores array with matching ids', () => {
    const entry = nudge.recordSkillApplied(baseEvent());
    const result = nudge.nudge({ query: 'summarise meeting notes' });
    if (result.entries.length > 0) {
      expect(result.scores.some((s) => s.id === entry.id)).toBe(true);
    }
  });

  it('nudge across all scopes when scope omitted', () => {
    const storeB = makeStore();
    const n2 = createMemoryNudge({ memory: storeB });
    n2.recordSkillApplied(baseEvent({ scope: 'user:1' }));
    n2.recordSkillApplied(baseEvent({ scope: 'user:2', task: 'summarise notes again' }));
    // No scope filter: should find entries from any scope
    const result = n2.nudge({ query: 'summarise notes' });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    storeB.close();
  });

  // ── defaultScoring ─────────────────────────────────────────────────────

  it('defaultScoring weight component is weight*0.5', () => {
    const entry = store.add({
      kind: 'episode',
      text: 'hello world',
      source: 'agent',
      scope: 'global',
      tags: [],
      weight: 1.0,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    // weight * 0.5 = 0.5; recency near-fresh; no textOverlap for empty query concept
    const score = defaultScoring(entry, '');
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('defaultScoring recency: recent entry scores higher than old entry', () => {
    const recent = store.add({
      kind: 'episode',
      text: 'recent entry',
      source: 'agent',
      scope: 'global',
      tags: [],
      weight: 0.5,
    });
    // Simulate old entry by mutating updated_at to 100 days ago
    const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    store.update(recent.id, {}); // no-op update to get fresh entry
    const old = store.add({
      kind: 'episode',
      text: 'recent entry',
      source: 'agent',
      scope: 'global',
      tags: [],
      weight: 0.5,
      // expires_at far future
      expires_at: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    });
    // Hack: override updated_at using update (not directly supported but weight same)
    // Instead, just use a custom fake MemoryEntry
    const fakeOld: typeof old = { ...old, updated_at: oldDate };
    const scoreRecent = defaultScoring(recent, 'test');
    const scoreOld = defaultScoring(fakeOld, 'test');
    expect(scoreRecent).toBeGreaterThan(scoreOld);
  });

  it('defaultScoring textOverlap component increases score for matching tokens', () => {
    const entry = store.add({
      kind: 'episode',
      text: 'summarise meeting notes quickly',
      source: 'agent',
      scope: 'global',
      tags: [],
      weight: 0.5,
    });
    const scoreMatch = defaultScoring(entry, 'summarise meeting notes');
    const scoreMiss = defaultScoring(entry, 'translate document');
    expect(scoreMatch).toBeGreaterThan(scoreMiss);
  });

  // ── formatPromptInjection ──────────────────────────────────────────────

  it('formatPromptInjection returns empty string for empty entries', () => {
    expect(formatPromptInjection([])).toBe('');
  });

  it('formatPromptInjection includes ## Relevant memory header', () => {
    const entry = store.add({
      kind: 'lesson',
      text: 'Always check edge cases',
      source: 'agent',
      scope: 'global',
      tags: [],
      weight: 0.8,
    });
    const output = formatPromptInjection([entry]);
    expect(output).toMatch(/^## Relevant memory/);
  });

  it('formatPromptInjection includes kind, weight, and text', () => {
    const entry = store.add({
      kind: 'lesson',
      text: 'Always check edge cases',
      source: 'agent',
      scope: 'global',
      tags: [],
      weight: 0.8,
    });
    const output = formatPromptInjection([entry]);
    expect(output).toContain('lesson');
    expect(output).toContain('0.80');
    expect(output).toContain('Always check edge cases');
  });

  it('formatPromptInjection renders multiple entries', () => {
    const e1 = store.add({ kind: 'episode', text: 'First', source: 'agent', scope: 'g', tags: [], weight: 0.5 });
    const e2 = store.add({ kind: 'lesson', text: 'Second', source: 'agent', scope: 'g', tags: [], weight: 0.7 });
    const output = formatPromptInjection([e1, e2]);
    expect(output).toContain('First');
    expect(output).toContain('Second');
  });

  // ── forget ─────────────────────────────────────────────────────────────

  it('forget deletes entry from store', () => {
    const entry = nudge.recordSkillApplied(baseEvent());
    expect(store.get(entry.id)).not.toBeNull();
    const result = nudge.forget(entry.id);
    expect(result).toBe(true);
    expect(store.get(entry.id)).toBeNull();
  });

  it('forget returns false for unknown id', () => {
    expect(nudge.forget('no-such-id')).toBe(false);
  });

  // ── prune ──────────────────────────────────────────────────────────────

  it('prune calls memory.prune and returns its result', () => {
    let pruneCalledWith: { olderThanDays?: number; maxRows?: number } | undefined;
    let pruneCalled = false;
    const fakeStore: MemoryStore = {
      ...store,
      prune(opts) { pruneCalled = true; pruneCalledWith = opts; return 7; },
    };
    const n2 = createMemoryNudge({ memory: fakeStore, expireDays: 30 });
    const removed = n2.prune();
    expect(pruneCalled).toBe(true);
    // expireDays * 2 = 60
    expect(pruneCalledWith?.olderThanDays).toBe(60);
    expect(removed).toBe(7);
  });

  // ── memory.search throws → safe empty result ───────────────────────────

  it('nudge returns empty result when memory.search throws', () => {
    const brokenStore = {
      ...store,
      search: () => { throw new Error('DB error'); },
    } as MemoryStore;
    const n2 = createMemoryNudge({ memory: brokenStore });
    const result = n2.nudge({ query: 'some query' });
    expect(result.entries).toHaveLength(0);
    expect(result.promptInjection).toBe('');
  });

  // ── scoringFn override ─────────────────────────────────────────────────

  it('scoringFn override is used in nudge', () => {
    const called: string[] = [];
    const n2 = createMemoryNudge({
      memory: store,
      scoringFn: (m, _q) => { called.push(m.id); return 1.0; },
    });
    // Add an entry whose text the FTS will find with a simple query
    store.add({
      kind: 'lesson',
      text: 'custom scoring lesson entry',
      source: 'agent',
      scope: 'global',
      tags: [],
      weight: 0.5,
    });
    n2.nudge({ query: 'custom scoring lesson' });
    expect(called.length).toBeGreaterThan(0);
  });

  // ── entries with no tags handled ──────────────────────────────────────

  it('handles entries with empty tags gracefully', () => {
    store.add({ kind: 'episode', text: 'no tags here', source: 'agent', scope: 'global', tags: [], weight: 0.5 });
    // Should not throw even with tag filter
    const result = nudge.nudge({ query: 'no tags', tags: ['something'] });
    // Entries with no tags should be filtered out by tag intersection
    expect(result.entries.every((e) => e.tags.length > 0)).toBe(true);
  });
});
