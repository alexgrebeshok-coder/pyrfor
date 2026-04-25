// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mineTrajectories, PatternMiner } from './pattern-miner';
import type { TrajectoryRecord, ToolCallTrace } from './trajectory';

// ── Builder helper ─────────────────────────────────────────────────────────

let idCounter = 0;

function makeTool(
  name: string,
  success = true,
  latencyMs = 100,
  errorMessage?: string,
): ToolCallTrace {
  return {
    name,
    args: {},
    result: {},
    success,
    latencyMs,
    errorMessage,
    timestamp: new Date().toISOString(),
  };
}

function makeTraj(partial: Partial<TrajectoryRecord> & { sessionId?: string }): TrajectoryRecord {
  const id = String(++idCounter).padStart(4, '0');
  const now = new Date();
  return {
    id,
    sessionId: partial.sessionId ?? `session-${id}`,
    channel: 'cli',
    userInput: partial.userInput ?? 'user input',
    toolCalls: partial.toolCalls ?? [],
    finalAnswer: partial.finalAnswer ?? 'done',
    success: partial.success ?? true,
    iterations: partial.iterations ?? 1,
    tokensUsed: partial.tokensUsed ?? { prompt: 10, completion: 5, total: 15 },
    startedAt: partial.startedAt ?? now.toISOString(),
    completedAt: partial.completedAt ?? now.toISOString(),
    durationMs: partial.durationMs ?? 200,
    private: partial.private ?? false,
    ...partial,
  };
}

function makeSeqTraj(tools: string[], success = true, sessionId?: string): TrajectoryRecord {
  return makeTraj({
    sessionId,
    toolCalls: tools.map((t) => makeTool(t)),
    success,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('mineTrajectories — empty input', () => {
  it('returns empty result for empty array', () => {
    const result = mineTrajectories({ trajectories: [] });
    expect(result.candidates).toHaveLength(0);
    expect(result.scannedTrajectories).toBe(0);
    expect(result.uniqueSequencesFound).toBe(0);
    expect(result.uniqueFailuresFound).toBe(0);
  });
});

describe('tool-sequence detection', () => {
  it('emits 1 candidate for 5 trajectories with same 3-tool sequence', () => {
    const trajs = Array.from({ length: 5 }, () => makeSeqTraj(['read_file', 'grep', 'write_file']));
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    expect(seqCandidates).toHaveLength(1);
    expect(seqCandidates[0].signature).toBe('read_file -> grep -> write_file');
    expect(seqCandidates[0].occurrences).toBe(5);
  });

  it('emits 0 candidates for 4 trajectories (under threshold of 5)', () => {
    const trajs = Array.from({ length: 4 }, () => makeSeqTraj(['read_file', 'grep', 'write_file']));
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    expect(seqCandidates).toHaveLength(0);
  });

  it('detects sequences at both L=3 and L=4 from same 5-tool trajectories', () => {
    const trajs = Array.from({ length: 5 }, () =>
      makeSeqTraj(['a', 'b', 'c', 'd', 'e']),
    );
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 4 },
    });
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    const sigs = seqCandidates.map((c) => c.signature);
    expect(sigs.some((s) => s.includes(' -> ') && s.split(' -> ').length === 3)).toBe(true);
    expect(sigs.some((s) => s.includes(' -> ') && s.split(' -> ').length === 4)).toBe(true);
  });

  it('calculates successRate correctly (3 success, 2 fail → 0.6)', () => {
    const trajs = [
      ...Array.from({ length: 3 }, () => makeSeqTraj(['read_file', 'grep', 'write_file'], true)),
      ...Array.from({ length: 2 }, () => makeSeqTraj(['read_file', 'grep', 'write_file'], false)),
    ];
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    const candidate = result.candidates.find(
      (c) => c.kind === 'tool-sequence' && c.signature === 'read_file -> grep -> write_file',
    );
    expect(candidate).toBeDefined();
    expect(candidate!.successRate).toBeCloseTo(0.6);
  });

  it('skips subsequences longer than toolCalls array', () => {
    const trajs = Array.from({ length: 5 }, () => makeSeqTraj(['a', 'b']));
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 6 },
    });
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    expect(seqCandidates).toHaveLength(0);
  });

  it('does not count trajectories with no tool calls in sequence detection', () => {
    const trajs = [
      ...Array.from({ length: 5 }, () => makeSeqTraj(['read_file', 'grep', 'write_file'])),
      makeTraj({ toolCalls: [] }), // no tools
    ];
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    expect(result.scannedTrajectories).toBe(6);
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    expect(seqCandidates).toHaveLength(1);
  });

  it('keeps duplicate consecutive tool names in sequence', () => {
    const trajs = Array.from({ length: 5 }, () =>
      makeSeqTraj(['read_file', 'read_file', 'write_file']),
    );
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    const candidate = result.candidates.find(
      (c) => c.kind === 'tool-sequence' && c.signature === 'read_file -> read_file -> write_file',
    );
    expect(candidate).toBeDefined();
  });

  it('respects minSequenceLength/maxSequenceLength bounds', () => {
    const trajs = Array.from({ length: 5 }, () =>
      makeSeqTraj(['a', 'b', 'c', 'd', 'e', 'f', 'g']),
    );
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 4, maxSequenceLength: 5 },
    });
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    for (const c of seqCandidates) {
      const len = c.signature.split(' -> ').length;
      expect(len).toBeGreaterThanOrEqual(4);
      expect(len).toBeLessThanOrEqual(5);
    }
  });

  it('collects at most 5 examples per candidate, deduplicated by sessionId', () => {
    const sessionId = 'shared-session';
    // 7 trajectories all with same sessionId → deduplicated to 1 example
    const trajs = Array.from({ length: 7 }, () =>
      makeSeqTraj(['read_file', 'grep', 'write_file'], true, sessionId),
    );
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    const candidate = result.candidates.find((c) => c.kind === 'tool-sequence');
    expect(candidate).toBeDefined();
    expect(candidate!.exampleSessionIds).toHaveLength(1);
    expect(candidate!.exampleInputs).toHaveLength(1);
  });

  it('collects up to 5 distinct session examples', () => {
    const trajs = Array.from({ length: 8 }, (_, i) =>
      makeSeqTraj(['read_file', 'grep', 'write_file'], true, `session-${i}`),
    );
    const result = mineTrajectories({
      trajectories: trajs,
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    const candidate = result.candidates.find((c) => c.kind === 'tool-sequence');
    expect(candidate).toBeDefined();
    expect(candidate!.exampleSessionIds.length).toBeLessThanOrEqual(5);
  });
});

describe('failure-mode detection', () => {
  it('emits a candidate for 3+ identical normalised error messages', () => {
    const trajs = Array.from({ length: 3 }, () =>
      makeTraj({
        toolCalls: [makeTool('fetch', false, 100, 'Connection refused')],
      }),
    );
    const result = mineTrajectories({
      trajectories: trajs,
      options: { failureThreshold: 3 },
    });
    const failCandidates = result.candidates.filter((c) => c.kind === 'failure-mode');
    expect(failCandidates).toHaveLength(1);
    expect(failCandidates[0].failureSignature?.tool).toBe('fetch');
  });

  it('normalises error messages: same pattern for different numbers', () => {
    const trajs = [
      makeTraj({ toolCalls: [makeTool('fetch', false, 100, 'Connection timeout after 5000ms')] }),
      makeTraj({ toolCalls: [makeTool('fetch', false, 100, 'Connection timeout after 12000ms')] }),
      makeTraj({ toolCalls: [makeTool('fetch', false, 100, 'Connection timeout after 3000ms')] }),
    ];
    const result = mineTrajectories({
      trajectories: trajs,
      options: { failureThreshold: 3 },
    });
    const failCandidates = result.candidates.filter((c) => c.kind === 'failure-mode');
    expect(failCandidates).toHaveLength(1);
    expect(failCandidates[0].occurrences).toBe(3);
    expect(failCandidates[0].failureSignature?.errorMessagePattern).toContain('N');
    expect(failCandidates[0].failureSignature?.errorMessagePattern).not.toMatch(/\d/);
  });

  it('does not emit candidate below failureThreshold', () => {
    const trajs = Array.from({ length: 2 }, () =>
      makeTraj({ toolCalls: [makeTool('fetch', false, 100, 'Connection refused')] }),
    );
    const result = mineTrajectories({
      trajectories: trajs,
      options: { failureThreshold: 3 },
    });
    const failCandidates = result.candidates.filter((c) => c.kind === 'failure-mode');
    expect(failCandidates).toHaveLength(0);
  });
});

describe('user-correction detection', () => {
  it('matches Russian "не так" correction', () => {
    const base = new Date('2024-01-15T10:00:00Z');
    const prev = makeTraj({
      sessionId: 'sess-ru',
      startedAt: base.toISOString(),
      userInput: 'помоги',
    });
    const corr1 = makeTraj({
      sessionId: 'sess-ru',
      startedAt: new Date(base.getTime() + 60_000).toISOString(),
      userInput: 'не так, переделай',
    });
    const corr2 = makeTraj({
      sessionId: 'sess-ru',
      startedAt: new Date(base.getTime() + 120_000).toISOString(),
      userInput: 'нет, неправильно',
    });
    const result = mineTrajectories({
      trajectories: [prev, corr1, corr2],
      options: { windowDays: undefined },
    });
    const corrCandidates = result.candidates.filter((c) => c.kind === 'user-correction');
    expect(corrCandidates).toHaveLength(1);
    expect(corrCandidates[0].occurrences).toBe(2);
  });

  it('matches English "wrong" correction', () => {
    const base = new Date('2024-01-15T10:00:00Z');
    const prev = makeTraj({ sessionId: 'sess-en', startedAt: base.toISOString(), userInput: 'do task' });
    const corr1 = makeTraj({
      sessionId: 'sess-en',
      startedAt: new Date(base.getTime() + 60_000).toISOString(),
      userInput: 'that\'s wrong, fix this',
    });
    const corr2 = makeTraj({
      sessionId: 'sess-en',
      startedAt: new Date(base.getTime() + 120_000).toISOString(),
      userInput: 'change it please',
    });
    const result = mineTrajectories({
      trajectories: [prev, corr1, corr2],
      options: { windowDays: undefined },
    });
    const corrCandidates = result.candidates.filter((c) => c.kind === 'user-correction');
    expect(corrCandidates).toHaveLength(1);
  });

  it('requires ≥2 corrections per session to emit candidate', () => {
    const base = new Date('2024-01-15T10:00:00Z');
    const prev = makeTraj({ sessionId: 'sess-one', startedAt: base.toISOString(), userInput: 'task' });
    const corr1 = makeTraj({
      sessionId: 'sess-one',
      startedAt: new Date(base.getTime() + 60_000).toISOString(),
      userInput: 'wrong, fix this',
    });
    const result = mineTrajectories({
      trajectories: [prev, corr1],
      options: { windowDays: undefined },
    });
    const corrCandidates = result.candidates.filter((c) => c.kind === 'user-correction');
    expect(corrCandidates).toHaveLength(0);
  });

  it('requires session continuity within 5 minutes', () => {
    const base = new Date('2024-01-15T10:00:00Z');
    const prev = makeTraj({ sessionId: 'sess-gap', startedAt: base.toISOString(), userInput: 'task' });
    // corr1: 10 minutes later — beyond 5-min window → not counted
    const corr1 = makeTraj({
      sessionId: 'sess-gap',
      startedAt: new Date(base.getTime() + 10 * 60_000).toISOString(),
      userInput: 'wrong, fix this',
    });
    // corr2: 11 minutes later (only 1 min after corr1 — within window of corr1)
    const corr2 = makeTraj({
      sessionId: 'sess-gap',
      startedAt: new Date(base.getTime() + 11 * 60_000).toISOString(),
      userInput: 'that\'s not right',
    });
    const result = mineTrajectories({
      trajectories: [prev, corr1, corr2],
      options: { windowDays: undefined },
    });
    const corrCandidates = result.candidates.filter((c) => c.kind === 'user-correction');
    // corr2 is within 5 min of corr1, so both corr1 and corr2 would be corrections
    // but corr1 is more than 5 min from prev, so it may or may not be counted
    // In our impl: corr1 vs prev = 10 min → skip; corr2 vs corr1 = 1 min → count
    // total corrections = 1 (only corr2 counted) → below threshold of 2
    expect(corrCandidates).toHaveLength(0);
  });
});

describe('window filtering', () => {
  it('excludes trajectories older than windowDays', () => {
    const old = makeSeqTraj(['read_file', 'grep', 'write_file']);
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    old.completedAt = oldDate.toISOString();
    old.startedAt = oldDate.toISOString();

    const recent = Array.from({ length: 5 }, () => makeSeqTraj(['read_file', 'grep', 'write_file']));

    const result = mineTrajectories({
      trajectories: [old, ...recent],
      options: { windowDays: 30, minOccurrences: 6, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    // 5 recent + 1 old (excluded), so only 5 qualify — but minOccurrences=6 → no candidate
    expect(result.scannedTrajectories).toBe(6);
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    expect(seqCandidates).toHaveLength(0);
  });

  it('includes all when windowDays is undefined', () => {
    const old = makeSeqTraj(['a', 'b', 'c']);
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 5);
    old.completedAt = oldDate.toISOString();
    old.startedAt = oldDate.toISOString();

    const trajs = [old, ...Array.from({ length: 4 }, () => makeSeqTraj(['a', 'b', 'c']))];
    const result = mineTrajectories({
      trajectories: trajs,
      options: { windowDays: undefined, minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3 },
    });
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    expect(seqCandidates).toHaveLength(1);
    expect(seqCandidates[0].occurrences).toBe(5);
  });
});

describe('weight ordering', () => {
  it('sorts candidates by weight descending', () => {
    // Create 5 trajectories with a sequence that appears 5× (weight ~low)
    // Create 50 trajectories with another sequence (weight ~high)
    const lowTrajs = Array.from({ length: 5 }, () =>
      makeSeqTraj(['a', 'b', 'c'], true, `low-session-${Math.random()}`),
    );
    const highTrajs = Array.from({ length: 50 }, () =>
      makeSeqTraj(['x', 'y', 'z'], true, `high-session-${Math.random()}`),
    );

    const result = mineTrajectories({
      trajectories: [...lowTrajs, ...highTrajs],
      options: { minOccurrences: 5, minSequenceLength: 3, maxSequenceLength: 3, windowDays: undefined },
    });

    const weights = result.candidates.map((c) => c.weight);
    for (let i = 0; i < weights.length - 1; i++) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i + 1]);
    }
  });
});

describe('ULID uniqueness', () => {
  it('generates unique IDs across one mining run', () => {
    const trajs = Array.from({ length: 10 }, () =>
      makeTraj({ toolCalls: [makeTool('fetch', false, 100, 'Connection refused')] }),
    );
    // Also add sequence candidates
    const seqTrajs = Array.from({ length: 5 }, () =>
      makeSeqTraj(['a', 'b', 'c']),
    );
    const result = mineTrajectories({
      trajectories: [...trajs, ...seqTrajs],
      options: { minOccurrences: 5, failureThreshold: 3, minSequenceLength: 3, maxSequenceLength: 3, windowDays: undefined },
    });

    const ids = result.candidates.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe('PatternMiner class', () => {
  it('calls query with correct since date when windowDays is set', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const miner = new PatternMiner({ windowDays: 7 });

    const before = new Date();
    before.setDate(before.getDate() - 8); // 8 days ago

    await miner.run(queryFn);

    expect(queryFn).toHaveBeenCalledOnce();
    const [filter] = queryFn.mock.calls[0];
    expect(filter.since).toBeInstanceOf(Date);
    // The since date should be approximately 7 days ago
    const sinceMs = filter.since.getTime();
    const expectedMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000); // within 5s
  });

  it('returns empty result when query returns empty array', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const miner = new PatternMiner();
    const result = await miner.run(queryFn);
    expect(result.candidates).toHaveLength(0);
    expect(result.scannedTrajectories).toBe(0);
  });

  it('passes trajectories through mineTrajectories correctly', async () => {
    const trajs = Array.from({ length: 5 }, () =>
      makeSeqTraj(['read_file', 'grep', 'write_file']),
    );
    const queryFn = vi.fn().mockResolvedValue(trajs);
    const miner = new PatternMiner({
      minOccurrences: 5,
      minSequenceLength: 3,
      maxSequenceLength: 3,
      windowDays: undefined,
    });
    const result = await miner.run(queryFn);
    const seqCandidates = result.candidates.filter((c) => c.kind === 'tool-sequence');
    expect(seqCandidates).toHaveLength(1);
  });
});
