// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';

import { Reflector } from './reflection.js';
import type { PipelineSummary, ReflectionLLM, Lesson } from './reflection.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const tmpRoots: string[] = [];

async function makeTempDir(): Promise<string> {
  const base = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '__reflection_test_tmp__',
  );
  await fsp.mkdir(base, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(base, 'refl-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tmpRoots.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => undefined);
  }
  const base = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '__reflection_test_tmp__',
  );
  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined);
});

function makeSummary(overrides: Partial<PipelineSummary> = {}): PipelineSummary {
  return {
    sessionId: 'sess-001',
    userInput: 'Analyse sales data',
    toolCalls: [
      { name: 'read_file', success: true, latencyMs: 120 },
      { name: 'run_sql', success: true, latencyMs: 450 },
    ],
    finalAnswer: 'Sales grew 12%.',
    success: true,
    iterations: 6,
    durationMs: 3000,
    ...overrides,
  };
}

function mockLlm(response: string): ReflectionLLM {
  return {
    chat: vi.fn().mockResolvedValue(response),
  };
}

const VALID_JSON = JSON.stringify([
  { category: 'success-pattern', insight: 'Use run_sql for aggregations.', context: 'sales query', weight: 0.9 },
  { category: 'tool-tip', insight: 'read_file is fast for small files.', context: 'csv read', weight: 0.7 },
]);

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Reflector.reflect()', () => {
  it('returns parsed lessons when LLM returns valid JSON array', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm(VALID_JSON) });

    const lessons = await r.reflect(makeSummary());

    expect(lessons).toHaveLength(2);
    expect(lessons[0].category).toBe('success-pattern');
    expect(lessons[0].insight).toBe('Use run_sql for aggregations.');
    expect(lessons[0].sessionId).toBe('sess-001');
    expect(typeof lessons[0].id).toBe('string');
    expect(lessons[0].id.length).toBeGreaterThan(4);
    expect(lessons[0].appliedCount).toBe(0);
    expect(lessons[1].category).toBe('tool-tip');
  });

  it('returns empty array and does not throw on malformed JSON', async () => {
    const baseDir = await makeTempDir();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm('not json at all!!!') });

    const lessons = await r.reflect(makeSummary());

    expect(lessons).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('strips markdown fences and parses correctly', async () => {
    const wrapped = '```json\n' + VALID_JSON + '\n```';
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm(wrapped) });

    const lessons = await r.reflect(makeSummary());

    expect(lessons).toHaveLength(2);
  });

  it('returns empty array for pipelines below minIterations', async () => {
    const baseDir = await makeTempDir();
    const llm = mockLlm(VALID_JSON);
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm });

    const lessons = await r.reflect(makeSummary({ iterations: 4 }));

    expect(lessons).toHaveLength(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('returns empty array immediately when enabled:false', async () => {
    const baseDir = await makeTempDir();
    const llm = mockLlm(VALID_JSON);
    const r = new Reflector({ baseDir, enabled: false, minIterations: 5, llm });

    const lessons = await r.reflect(makeSummary());

    expect(lessons).toHaveLength(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('drops entries with invalid category', async () => {
    const badJson = JSON.stringify([
      { category: 'invalid-cat', insight: 'Bad category.', context: 'x', weight: 0.5 },
      { category: 'general', insight: 'Good lesson.', context: 'y', weight: 0.6 },
    ]);
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm(badJson) });

    const lessons = await r.reflect(makeSummary());

    expect(lessons).toHaveLength(1);
    expect(lessons[0].category).toBe('general');
  });

  it('drops entries with weight out of 0..1 range', async () => {
    const badJson = JSON.stringify([
      { category: 'general', insight: 'Over weight.', context: 'x', weight: 1.5 },
      { category: 'failure-mode', insight: 'Valid.', context: 'y', weight: 0.4 },
    ]);
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm(badJson) });

    const lessons = await r.reflect(makeSummary());

    expect(lessons).toHaveLength(1);
    expect(lessons[0].category).toBe('failure-mode');
  });
});

describe('Reflector persist + loadAll', () => {
  it('round-trips lessons through JSONL file', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm(VALID_JSON) });

    const lessons = await r.reflect(makeSummary());
    await r.persist(lessons);
    const loaded = await r.loadAll();

    expect(loaded).toHaveLength(2);
    expect(loaded[0].insight).toBe(lessons[0].insight);
    expect(loaded[1].insight).toBe(lessons[1].insight);
  });

  it('loadAll returns empty array when file does not exist', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm('[]') });

    const lessons = await r.loadAll();
    expect(lessons).toHaveLength(0);
  });

  it('loadAll skips malformed lines with a warning', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm('[]') });

    await fsp.mkdir(baseDir, { recursive: true });
    const file = path.join(baseDir, 'lessons.jsonl');
    await fsp.writeFile(file, '{"id":"a","appliedCount":0}\nNOT_JSON\n{"id":"b","appliedCount":0}\n', 'utf-8');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const lessons = await r.loadAll();

    expect(lessons).toHaveLength(2);
    warnSpy.mockRestore();
  });

  it('persist does nothing when passed empty array', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm('[]') });

    await r.persist([]);
    // file should not be created
    await expect(fsp.access(path.join(baseDir, 'lessons.jsonl'))).rejects.toThrow();
  });
});

describe('Reflector.markApplied()', () => {
  it('increments appliedCount for the target lesson', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm(VALID_JSON) });

    const lessons = await r.reflect(makeSummary());
    await r.persist(lessons);

    const targetId = lessons[0].id;
    await r.markApplied(targetId);

    const loaded = await r.loadAll();
    const updated = loaded.find((l) => l.id === targetId)!;
    expect(updated.appliedCount).toBe(1);
    // other lesson unchanged
    const other = loaded.find((l) => l.id !== targetId)!;
    expect(other.appliedCount).toBe(0);
  });

  it('does not throw when id is not found', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm('[]') });

    await r.persist([{
      id: 'x1', sessionId: 's', category: 'general', insight: 'hi',
      context: '', weight: 0.5, createdAt: new Date().toISOString(), appliedCount: 0,
    } satisfies Lesson]);

    await expect(r.markApplied('nonexistent')).resolves.toBeUndefined();
  });
});

describe('Concurrent persist calls', () => {
  it('no interleaving under concurrent appends', async () => {
    const baseDir = await makeTempDir();
    const r = new Reflector({ baseDir, enabled: true, minIterations: 5, llm: mockLlm('[]') });

    const makeBatch = (tag: string): Lesson[] => [
      {
        id: `${tag}-1`, sessionId: 's', category: 'general' as const,
        insight: `insight-${tag}`, context: tag, weight: 0.5,
        createdAt: new Date().toISOString(), appliedCount: 0,
      },
    ];

    // Fire 5 concurrent persists
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => r.persist(makeBatch(`batch${i}`))),
    );

    const loaded = await r.loadAll();
    expect(loaded).toHaveLength(5);
    // Each line must be a valid JSON object
    const file = await fsp.readFile(path.join(baseDir, 'lessons.jsonl'), 'utf-8');
    const lines = file.split('\n').filter(Boolean);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
