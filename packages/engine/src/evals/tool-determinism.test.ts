// @vitest-environment node
/**
 * tool-determinism.test.ts — Vitest regression suite for the tool-determinism eval module.
 *
 * Tests are organised into four describe blocks:
 *   1. redact()              — dot-path scrubbing behaviour
 *   2. deepEqualCanonical()  — structural equality helper
 *   3. loadCasesFromFile()   — fixture loading
 *   4. runDeterminism()      — end-to-end eval harness with stub runners
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

import {
  redact,
  deepEqualCanonical,
  loadCasesFromFile,
  runDeterminism,
  type ToolCallCase,
  type ToolRunnerLike,
} from './tool-determinism';

// ===== Helpers ================================================================

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');
const CASES_FILE = path.join(FIXTURES_DIR, 'tool-determinism-cases.json');

/** Builds a simple stub runner that always returns the same value. */
function staticRunner(returnValue: unknown): ToolRunnerLike {
  return {
    invoke: vi.fn().mockResolvedValue(returnValue),
  };
}

// ===== 1. redact() ============================================================

describe('redact', () => {
  it('returns the value unchanged when paths is empty', () => {
    const obj = { a: 1, b: { c: 2 } };
    expect(redact(obj, [])).toEqual(obj);
  });

  it('scrubs a top-level path', () => {
    const obj = { id: 'abc-123', name: 'alice' };
    const result = redact(obj, ['id']) as Record<string, unknown>;
    expect(result['id']).toBe('[REDACTED]');
    expect(result['name']).toBe('alice');
  });

  it('scrubs a nested dot-path', () => {
    const obj = { result: { id: 'volatile', stable: 42 } };
    const result = redact(obj, ['result.id']) as { result: Record<string, unknown> };
    expect(result.result['id']).toBe('[REDACTED]');
    expect(result.result['stable']).toBe(42);
  });

  it('scrubs multiple paths independently', () => {
    const obj = { result: { id: 'x', ts: '2024-01-01', value: 7 } };
    const result = redact(obj, ['result.id', 'result.ts']) as {
      result: Record<string, unknown>;
    };
    expect(result.result['id']).toBe('[REDACTED]');
    expect(result.result['ts']).toBe('[REDACTED]');
    expect(result.result['value']).toBe(7);
  });

  it('is a no-op when path is missing from the object', () => {
    const obj = { a: 1 };
    expect(() => redact(obj, ['nonexistent.deep.path'])).not.toThrow();
    expect(redact(obj, ['nonexistent.deep.path'])).toEqual(obj);
  });

  it('does not mutate the original value', () => {
    const obj = { id: 'keep-me' };
    redact(obj, ['id']);
    expect(obj.id).toBe('keep-me');
  });

  it('handles a three-level deep path', () => {
    const obj = { a: { b: { c: 'secret' } } };
    const result = redact(obj, ['a.b.c']) as { a: { b: Record<string, unknown> } };
    expect(result.a.b['c']).toBe('[REDACTED]');
  });

  it('scrubs a path whose intermediate node is an array — silently ignores', () => {
    // Arrays as intermediate nodes are not currently walked; no crash expected.
    const obj = { items: [{ id: 1 }, { id: 2 }] };
    expect(() => redact(obj, ['items.id'])).not.toThrow();
  });

  it('handles primitives as root value gracefully', () => {
    expect(redact('hello', ['any.path'])).toBe('hello');
    expect(redact(42, ['x'])).toBe(42);
    expect(redact(null, ['x'])).toBeNull();
  });
});

// ===== 2. deepEqualCanonical() ================================================

describe('deepEqualCanonical', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqualCanonical(1, 1)).toBe(true);
    expect(deepEqualCanonical('hello', 'hello')).toBe(true);
    expect(deepEqualCanonical(true, true)).toBe(true);
  });

  it('returns false for different primitives', () => {
    expect(deepEqualCanonical(1, 2)).toBe(false);
    expect(deepEqualCanonical('a', 'b')).toBe(false);
  });

  it('treats null and undefined as distinct', () => {
    expect(deepEqualCanonical(null, undefined)).toBe(false);
    expect(deepEqualCanonical(null, null)).toBe(true);
  });

  it('is key-order-independent for objects', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(deepEqualCanonical(a, b)).toBe(true);
  });

  it('treats array order as significant', () => {
    expect(deepEqualCanonical([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqualCanonical([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it('compares nested objects recursively', () => {
    const a = { x: { y: { z: 'deep' } } };
    const b = { x: { y: { z: 'deep' } } };
    expect(deepEqualCanonical(a, b)).toBe(true);
  });

  it('returns false when nested values differ', () => {
    const a = { x: { y: 1 } };
    const b = { x: { y: 2 } };
    expect(deepEqualCanonical(a, b)).toBe(false);
  });

  it('handles arrays of objects with key-order independence', () => {
    const a = [{ b: 1, a: 2 }];
    const b = [{ a: 2, b: 1 }];
    expect(deepEqualCanonical(a, b)).toBe(true);
  });

  it('returns false for mismatched types', () => {
    expect(deepEqualCanonical(1, '1')).toBe(false);
    expect(deepEqualCanonical([], {})).toBe(false);
  });
});

// ===== 3. loadCasesFromFile() =================================================

describe('loadCasesFromFile', () => {
  it('parses the fixture file and returns an array', async () => {
    const cases = await loadCasesFromFile(CASES_FILE);
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  it('each case has id, tool, and args', async () => {
    const cases = await loadCasesFromFile(CASES_FILE);
    for (const c of cases) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.tool).toBe('string');
      expect(typeof c.args).toBe('object');
    }
  });

  it('throws a descriptive error for a missing file', async () => {
    await expect(loadCasesFromFile('/nonexistent/path/cases.json')).rejects.toThrow(
      'tool-determinism: cannot read cases file',
    );
  });

  it('throws a descriptive error for invalid JSON', async () => {
    // Use the node:fs mock approach — write a temp file in the fixture dir.
    const { writeFile, unlink } = await import('node:fs/promises');
    const bad = path.join(FIXTURES_DIR, '_bad-json.json');
    await writeFile(bad, '{ not valid json }');
    try {
      await expect(loadCasesFromFile(bad)).rejects.toThrow(
        'tool-determinism: cases file',
      );
    } finally {
      await unlink(bad).catch(() => undefined);
    }
  });

  it('throws when file contains a JSON object instead of array', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const bad = path.join(FIXTURES_DIR, '_not-array.json');
    await writeFile(bad, '{"key":"value"}');
    try {
      await expect(loadCasesFromFile(bad)).rejects.toThrow(
        'must contain a JSON array',
      );
    } finally {
      await unlink(bad).catch(() => undefined);
    }
  });
});

// ===== 4. runDeterminism() end-to-end =========================================

describe('runDeterminism', () => {
  // --- deterministic pass ---

  it('passes when all iterations return the same output', async () => {
    const cases: ToolCallCase[] = [
      { id: 'stable', tool: 'echo', args: { msg: 'hi' } },
    ];
    const runner = staticRunner({ echo: 'hi' });
    const report = await runDeterminism({ cases, runner });
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.cases[0]?.passed).toBe(true);
    expect(report.cases[0]?.diffs).toHaveLength(0);
  });

  // --- flipping output ---

  it('fails when the tool flips its output between iterations', async () => {
    let call = 0;
    const runner: ToolRunnerLike = {
      invoke: vi.fn().mockImplementation(async () => {
        call++;
        return call % 2 === 0 ? { value: 'B' } : { value: 'A' };
      }),
    };
    const cases: ToolCallCase[] = [
      { id: 'flipper', tool: 'flip', args: {}, iterations: 3 },
    ];
    const report = await runDeterminism({ cases, runner });
    expect(report.failed).toBe(1);
    expect(report.cases[0]?.passed).toBe(false);
    expect(report.cases[0]?.diffs.length).toBeGreaterThan(0);
    expect(report.cases[0]?.diffs[0]?.reason).toContain('output differs from iteration 0');
  });

  // --- tool throws ---

  it('records "threw:" reason when the runner throws', async () => {
    const runner: ToolRunnerLike = {
      invoke: vi.fn().mockRejectedValue(new Error('network timeout')),
    };
    const cases: ToolCallCase[] = [
      { id: 'thrower', tool: 'bad-tool', args: {} },
    ];
    const report = await runDeterminism({ cases, runner });
    expect(report.failed).toBe(1);
    const diff = report.cases[0]?.diffs[0];
    expect(diff?.reason).toMatch(/^threw: network timeout/);
  });

  it('records "threw:" reason when runner throws on some iterations', async () => {
    let call = 0;
    const runner: ToolRunnerLike = {
      invoke: vi.fn().mockImplementation(async () => {
        call++;
        if (call === 2) throw new Error('intermittent');
        return { ok: true };
      }),
    };
    const cases: ToolCallCase[] = [
      { id: 'intermittent', tool: 'flaky', args: {}, iterations: 3 },
    ];
    const report = await runDeterminism({ cases, runner });
    expect(report.failed).toBe(1);
    const reasons = report.cases[0]?.diffs.map((d) => d.reason) ?? [];
    expect(reasons.some((r) => r.startsWith('threw:'))).toBe(true);
  });

  // --- redact volatile fields ---

  it('passes when a volatile timestamp is redacted', async () => {
    let call = 0;
    const runner: ToolRunnerLike = {
      invoke: vi.fn().mockImplementation(async () => {
        call++;
        return { result: { ts: `2024-01-0${call}T00:00:00Z`, value: 42 } };
      }),
    };
    const cases: ToolCallCase[] = [
      {
        id: 'ts-redact',
        tool: 'volatile',
        args: {},
        redactPaths: ['result.ts'],
        iterations: 3,
      },
    ];
    const report = await runDeterminism({ cases, runner });
    expect(report.passed).toBe(1);
    expect(report.cases[0]?.passed).toBe(true);
  });

  // --- expected matches ---

  it('passes when output matches the pinned expected value', async () => {
    const cases: ToolCallCase[] = [
      {
        id: 'pinned-pass',
        tool: 'echo',
        args: { msg: 'x' },
        expected: { echo: 'x' },
      },
    ];
    const report = await runDeterminism({ cases, runner: staticRunner({ echo: 'x' }) });
    expect(report.passed).toBe(1);
    expect(report.cases[0]?.passed).toBe(true);
  });

  // --- expected mismatches ---

  it('fails when output does not match the pinned expected value', async () => {
    const cases: ToolCallCase[] = [
      {
        id: 'pinned-fail',
        tool: 'echo',
        args: { msg: 'x' },
        expected: { echo: 'WRONG' },
      },
    ];
    const report = await runDeterminism({ cases, runner: staticRunner({ echo: 'x' }) });
    expect(report.failed).toBe(1);
    const diff = report.cases[0]?.diffs[0];
    expect(diff?.reason).toContain('pinned expected');
  });

  // --- onCase callback ---

  it('invokes the onCase callback for each case', async () => {
    const cases: ToolCallCase[] = [
      { id: 'cb-1', tool: 'echo', args: {} },
      { id: 'cb-2', tool: 'echo', args: {} },
    ];
    const captured: string[] = [];
    await runDeterminism({
      cases,
      runner: staticRunner({ ok: true }),
      onCase: (r) => captured.push(r.caseId),
    });
    expect(captured).toEqual(['cb-1', 'cb-2']);
  });

  // --- report counters ---

  it('report counters total/passed/failed are correct', async () => {
    const goodRunner = staticRunner({ v: 1 });
    const badRunner: ToolRunnerLike = {
      invoke: vi.fn().mockRejectedValue(new Error('boom')),
    };

    // Mix: 2 good cases via goodRunner, 1 bad via badRunner — run separately.
    const goodReport = await runDeterminism({
      cases: [
        { id: 'g1', tool: 't', args: {} },
        { id: 'g2', tool: 't', args: {} },
      ],
      runner: goodRunner,
    });
    const badReport = await runDeterminism({
      cases: [{ id: 'b1', tool: 't', args: {} }],
      runner: badRunner,
    });

    expect(goodReport.totalCases).toBe(2);
    expect(goodReport.passed).toBe(2);
    expect(goodReport.failed).toBe(0);

    expect(badReport.totalCases).toBe(1);
    expect(badReport.passed).toBe(0);
    expect(badReport.failed).toBe(1);
  });

  // --- iterations default ---

  it('defaults to 3 iterations when iterations is not specified on case', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ v: 1 });
    const runner: ToolRunnerLike = { invoke: invokeMock };
    const cases: ToolCallCase[] = [{ id: 'iter-default', tool: 't', args: {} }];
    await runDeterminism({ cases, runner });
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('respects per-case iterations override', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ v: 1 });
    const runner: ToolRunnerLike = { invoke: invokeMock };
    const cases: ToolCallCase[] = [
      { id: 'iter-override', tool: 't', args: {}, iterations: 5 },
    ];
    await runDeterminism({ cases, runner });
    expect(invokeMock).toHaveBeenCalledTimes(5);
  });

  it('respects defaultIterations override on the options object', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ v: 1 });
    const runner: ToolRunnerLike = { invoke: invokeMock };
    const cases: ToolCallCase[] = [{ id: 'iter-opt', tool: 't', args: {} }];
    await runDeterminism({ cases, runner, defaultIterations: 7 });
    expect(invokeMock).toHaveBeenCalledTimes(7);
  });

  // --- report timestamps ---

  it('report includes ISO startedAt and finishedAt timestamps', async () => {
    const report = await runDeterminism({
      cases: [{ id: 'ts', tool: 't', args: {} }],
      runner: staticRunner({}),
    });
    expect(new Date(report.startedAt).toISOString()).toBe(report.startedAt);
    expect(new Date(report.finishedAt).toISOString()).toBe(report.finishedAt);
  });

  // --- durationMs ---

  it('case result contains a non-negative durationMs', async () => {
    const report = await runDeterminism({
      cases: [{ id: 'dur', tool: 't', args: {} }],
      runner: staticRunner({ x: 1 }),
    });
    expect(report.cases[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- empty cases ---

  it('handles an empty cases array gracefully', async () => {
    const report = await runDeterminism({ cases: [], runner: staticRunner({}) });
    expect(report.totalCases).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.cases).toHaveLength(0);
  });

  // --- key-order in outputs ---

  it('treats key-order-different outputs as equal (canonical comparison)', async () => {
    let call = 0;
    const runner: ToolRunnerLike = {
      invoke: vi.fn().mockImplementation(async () => {
        call++;
        return call === 1 ? { b: 2, a: 1 } : { a: 1, b: 2 };
      }),
    };
    const cases: ToolCallCase[] = [{ id: 'key-order', tool: 't', args: {}, iterations: 2 }];
    const report = await runDeterminism({ cases, runner });
    expect(report.cases[0]?.passed).toBe(true);
  });
});
