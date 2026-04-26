// @vitest-environment node
/**
 * Tests for packages/engine/src/subagents/test-fixer.ts
 *
 * Covers: classifyFailure (all categories, ambiguous cases, confidence levels),
 * proposeFix (action kinds, risk levels, module-name extraction, timeout doubling),
 * runTestFixer (summary aggregation, maxProposals truncation, empty input),
 * and subagentSpec (shape validation).
 */

import { describe, it, expect } from 'vitest';

import {
  classifyFailure,
  proposeFix,
  runTestFixer,
  subagentSpec,
  parseTimeoutMs,
  extractModuleName,
  type FailingTest,
  type FailureCategory,
} from './test-fixer.js';

// ====== Fixtures ======

function makeTest(overrides: Partial<FailingTest> = {}): FailingTest {
  return {
    id: 'src/foo.test.ts > suite > case',
    filePath: 'src/foo.test.ts',
    name: 'some test',
    errorMessage: '',
    ...overrides,
  };
}

// ====== parseTimeoutMs ======

describe('parseTimeoutMs', () => {
  it('extracts ms value from "Test timed out in 5000ms"', () => {
    expect(parseTimeoutMs('Test timed out in 5000ms')).toBe(5000);
  });

  it('extracts ms value from "exceeded 3000 ms"', () => {
    expect(parseTimeoutMs('exceeded 3000 ms')).toBe(3000);
  });

  it('returns null when no ms value present', () => {
    expect(parseTimeoutMs('some other error')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTimeoutMs('')).toBeNull();
  });
});

// ====== extractModuleName ======

describe('extractModuleName', () => {
  it('extracts double-quoted module name', () => {
    expect(extractModuleName('Cannot find module "lodash"')).toBe('lodash');
  });

  it('extracts single-quoted module name', () => {
    expect(extractModuleName("Cannot find module 'react'")).toBe('react');
  });

  it('extracts scoped package name', () => {
    expect(extractModuleName('Cannot find module "@scope/pkg"')).toBe('@scope/pkg');
  });

  it('returns null when pattern is absent', () => {
    expect(extractModuleName('SyntaxError: Unexpected token')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractModuleName('')).toBeNull();
  });
});

// ====== classifyFailure — clear-cut cases ======

describe('classifyFailure – timeout', () => {
  it('matches "timeout" keyword', () => {
    const t = makeTest({ errorMessage: 'Test timeout after waiting' });
    const c = classifyFailure(t);
    expect(c.category).toBe('timeout');
    expect(c.confidence).toBe(0.9);
    expect(c.signals.length).toBeGreaterThanOrEqual(1);
  });

  it('matches "exceeded 5000ms"', () => {
    const t = makeTest({ errorMessage: 'exceeded 5000ms limit' });
    const c = classifyFailure(t);
    expect(c.category).toBe('timeout');
    expect(c.confidence).toBe(0.9);
  });

  it('matches "did not complete within"', () => {
    const t = makeTest({ errorMessage: 'did not complete within 2000ms' });
    const c = classifyFailure(t);
    expect(c.category).toBe('timeout');
  });
});

describe('classifyFailure – assertion_mismatch', () => {
  it('matches "toEqual" in error message', () => {
    const t = makeTest({ errorMessage: 'expect(received).toEqual(expected)' });
    const c = classifyFailure(t);
    expect(c.category).toBe('assertion_mismatch');
    expect(c.confidence).toBe(0.9);
  });

  it('matches "toBe"', () => {
    const t = makeTest({ errorMessage: 'expected 1 toBe 2' });
    const c = classifyFailure(t);
    expect(c.category).toBe('assertion_mismatch');
  });

  it('matches "expected … received" pattern', () => {
    const t = makeTest({ errorMessage: 'expected "foo" received "bar"' });
    const c = classifyFailure(t);
    expect(c.category).toBe('assertion_mismatch');
  });

  it('matches "toStrictEqual"', () => {
    const t = makeTest({ errorMessage: 'expect(x).toStrictEqual(y)' });
    const c = classifyFailure(t);
    expect(c.category).toBe('assertion_mismatch');
  });
});

describe('classifyFailure – snapshot_mismatch', () => {
  it('matches snapshot + does not match', () => {
    const t = makeTest({ errorMessage: 'snapshot does not match stored snapshot' });
    const c = classifyFailure(t);
    expect(c.category).toBe('snapshot_mismatch');
    expect(c.confidence).toBe(0.9);
  });

  it('matches snapshot + obsolete', () => {
    const t = makeTest({ errorMessage: '1 snapshot obsolete' });
    const c = classifyFailure(t);
    expect(c.category).toBe('snapshot_mismatch');
  });

  it('matches snapshot + mismatch', () => {
    const t = makeTest({ errorMessage: 'Snapshot mismatch detected' });
    const c = classifyFailure(t);
    expect(c.category).toBe('snapshot_mismatch');
  });

  it('does NOT match snapshot alone (no qualifier)', () => {
    const t = makeTest({ errorMessage: 'snapshot created' });
    const c = classifyFailure(t);
    expect(c.category).not.toBe('snapshot_mismatch');
  });
});

describe('classifyFailure – import_error', () => {
  it('matches "Cannot find module"', () => {
    const t = makeTest({ errorMessage: "Cannot find module 'lodash'" });
    const c = classifyFailure(t);
    expect(c.category).toBe('import_error');
    expect(c.confidence).toBe(0.9);
  });

  it('matches MODULE_NOT_FOUND', () => {
    const t = makeTest({ errorMessage: 'Error: MODULE_NOT_FOUND' });
    const c = classifyFailure(t);
    expect(c.category).toBe('import_error');
  });

  it('matches SyntaxError', () => {
    const t = makeTest({ errorMessage: 'SyntaxError: Unexpected token <' });
    const c = classifyFailure(t);
    expect(c.category).toBe('import_error');
  });

  it('matches Unexpected token', () => {
    const t = makeTest({ errorMessage: 'Unexpected token import' });
    const c = classifyFailure(t);
    expect(c.category).toBe('import_error');
  });
});

describe('classifyFailure – unhandled_rejection', () => {
  it('matches UnhandledPromiseRejection', () => {
    const t = makeTest({ errorMessage: 'UnhandledPromiseRejection: something failed' });
    const c = classifyFailure(t);
    expect(c.category).toBe('unhandled_rejection');
    expect(c.confidence).toBe(0.9);
  });

  it('matches "Unhandled rejection"', () => {
    const t = makeTest({ errorMessage: 'Unhandled rejection at Promise' });
    const c = classifyFailure(t);
    expect(c.category).toBe('unhandled_rejection');
  });
});

describe('classifyFailure – thrown_error', () => {
  it('classifies as thrown_error when errorStack present and no other rule fires', () => {
    const t = makeTest({
      errorMessage: 'Some generic error',
      errorStack: 'Error: Some generic error\n  at fn (file.ts:10:5)',
    });
    const c = classifyFailure(t);
    expect(c.category).toBe('thrown_error');
    expect(c.confidence).toBe(0.9);
    expect(c.signals).toContain('errorStack present');
  });

  it('does NOT classify as thrown_error when no errorStack', () => {
    const t = makeTest({ errorMessage: 'Some generic error' });
    const c = classifyFailure(t);
    expect(c.category).toBe('unknown');
  });
});

describe('classifyFailure – unknown', () => {
  it('returns unknown with confidence 0.3 when nothing matches', () => {
    const t = makeTest({ errorMessage: 'something completely different' });
    const c = classifyFailure(t);
    expect(c.category).toBe('unknown');
    expect(c.confidence).toBe(0.3);
    expect(c.signals).toHaveLength(0);
  });
});

// ====== classifyFailure — ambiguous / competing rules ======

describe('classifyFailure – ambiguous cases', () => {
  it('timeout + assertion: confidence 0.6, both signals recorded, timeout wins', () => {
    const t = makeTest({
      errorMessage: 'Test timeout: expected value toBe truthy but exceeded 5000ms',
    });
    const c = classifyFailure(t);
    expect(c.confidence).toBe(0.6);
    expect(c.category).toBe('timeout');
    expect(c.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('import_error + assertion: confidence 0.6, import_error wins', () => {
    const t = makeTest({
      errorMessage: "Cannot find module 'x'; expected something toBe defined",
    });
    const c = classifyFailure(t);
    expect(c.category).toBe('import_error');
    expect(c.confidence).toBe(0.6);
  });

  it('snapshot + unhandled: confidence 0.6, snapshot wins', () => {
    const t = makeTest({
      errorMessage: 'snapshot does not match — UnhandledPromiseRejection occurred',
    });
    const c = classifyFailure(t);
    expect(c.category).toBe('snapshot_mismatch');
    expect(c.confidence).toBe(0.6);
  });
});

// ====== proposeFix ======

describe('proposeFix – assertion_mismatch', () => {
  it('returns update_assertion + investigate, risk=low', () => {
    const t = makeTest({ errorMessage: 'expect(x).toBe(y)' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('low');
    const kinds = p.suggestedActions.map(a => a.kind);
    expect(kinds).toContain('update_assertion');
    expect(kinds).toContain('investigate');
  });
});

describe('proposeFix – thrown_error', () => {
  it('returns fix_source + investigate, risk=medium', () => {
    const t = makeTest({ errorMessage: 'err', errorStack: 'Error\n  at fn:1' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('medium');
    const kinds = p.suggestedActions.map(a => a.kind);
    expect(kinds).toContain('fix_source');
    expect(kinds).toContain('investigate');
  });
});

describe('proposeFix – timeout', () => {
  it('doubles parsed ms from error message', () => {
    const t = makeTest({ errorMessage: 'Test timed out in 5000ms' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('low');
    const action = p.suggestedActions.find(a => a.kind === 'increase_timeout');
    expect(action).toBeDefined();
    expect((action as { kind: 'increase_timeout'; targetFile: string; newMs: number }).newMs).toBe(10000);
  });

  it('falls back to 10000 when no ms in message', () => {
    const t = makeTest({ errorMessage: 'did not complete within time' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    const action = p.suggestedActions.find(a => a.kind === 'increase_timeout');
    expect((action as { kind: 'increase_timeout'; targetFile: string; newMs: number }).newMs).toBe(10000);
  });

  it('includes investigate action', () => {
    const t = makeTest({ errorMessage: 'timeout exceeded 2000ms' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.suggestedActions.some(a => a.kind === 'investigate')).toBe(true);
  });
});

describe('proposeFix – snapshot_mismatch', () => {
  it('returns regenerate_snapshot + investigate, risk=low', () => {
    const t = makeTest({ errorMessage: 'snapshot does not match' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('low');
    const kinds = p.suggestedActions.map(a => a.kind);
    expect(kinds).toContain('regenerate_snapshot');
    expect(kinds).toContain('investigate');
  });
});

describe('proposeFix – import_error', () => {
  it('extracts module name and adds install_dep when "Cannot find module" present', () => {
    const t = makeTest({ errorMessage: "Cannot find module 'axios'" });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('high');
    const installAction = p.suggestedActions.find(a => a.kind === 'install_dep') as
      | { kind: 'install_dep'; pkg: string }
      | undefined;
    expect(installAction).toBeDefined();
    expect(installAction!.pkg).toBe('axios');
  });

  it('falls back to fix_source when module name cannot be extracted', () => {
    const t = makeTest({ errorMessage: 'SyntaxError: Unexpected token {' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('high');
    expect(p.suggestedActions.some(a => a.kind === 'fix_source')).toBe(true);
    expect(p.suggestedActions.some(a => a.kind === 'install_dep')).toBe(false);
  });
});

describe('proposeFix – unhandled_rejection', () => {
  it('returns fix_source + investigate, risk=high', () => {
    const t = makeTest({ errorMessage: 'UnhandledPromiseRejection: boom' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('high');
    const kinds = p.suggestedActions.map(a => a.kind);
    expect(kinds).toContain('fix_source');
    expect(kinds).toContain('investigate');
  });
});

describe('proposeFix – unknown', () => {
  it('returns investigate only, risk=medium', () => {
    const t = makeTest({ errorMessage: 'some obscure error' });
    const c = classifyFailure(t);
    const p = proposeFix(t, c);
    expect(p.riskLevel).toBe('medium');
    expect(p.suggestedActions.every(a => a.kind === 'investigate')).toBe(true);
  });
});

// ====== runTestFixer ======

describe('runTestFixer', () => {
  it('returns empty arrays and all-zero summary for empty input', async () => {
    const out = await runTestFixer({ failures: [] });
    expect(out.totalFailures).toBe(0);
    expect(out.classifications).toHaveLength(0);
    expect(out.proposals).toHaveLength(0);
    // all categories zero
    for (const v of Object.values(out.summary.byCategory)) {
      expect(v).toBe(0);
    }
    for (const v of Object.values(out.summary.byRisk)) {
      expect(v).toBe(0);
    }
  });

  it('sets generatedAt to a valid ISO 8601 string', async () => {
    const out = await runTestFixer({ failures: [] });
    expect(() => new Date(out.generatedAt)).not.toThrow();
    expect(new Date(out.generatedAt).toISOString()).toBe(out.generatedAt);
  });

  it('aggregates byCategory summary correctly', async () => {
    const failures: FailingTest[] = [
      makeTest({ id: 'a', errorMessage: 'expect(x).toBe(y)' }),
      makeTest({ id: 'b', errorMessage: 'expect(x).toBe(z)' }),
      makeTest({ id: 'c', errorMessage: 'Test timed out in 3000ms' }),
    ];
    const out = await runTestFixer({ failures });
    expect(out.summary.byCategory.assertion_mismatch).toBe(2);
    expect(out.summary.byCategory.timeout).toBe(1);
  });

  it('aggregates byRisk summary correctly', async () => {
    const failures: FailingTest[] = [
      makeTest({ id: 'a', errorMessage: 'expect(x).toBe(y)' }),                   // low
      makeTest({ id: 'b', errorMessage: 'UnhandledPromiseRejection: boom' }),      // high
      makeTest({ id: 'c', errorMessage: 'Cannot find module "react"' }),           // high
      makeTest({ id: 'd', errorMessage: 'err', errorStack: 'Error\n  at f:1' }),   // medium
    ];
    const out = await runTestFixer({ failures });
    expect(out.summary.byRisk.low).toBe(1);
    expect(out.summary.byRisk.medium).toBe(1);
    expect(out.summary.byRisk.high).toBe(2);
  });

  it('maxProposals truncates proposals but keeps all classifications', async () => {
    const failures: FailingTest[] = [
      makeTest({ id: 'a', errorMessage: 'expect(x).toBe(y)' }),
      makeTest({ id: 'b', errorMessage: 'Test timed out in 2000ms' }),
      makeTest({ id: 'c', errorMessage: "Cannot find module 'lodash'" }),
    ];
    const out = await runTestFixer({ failures, maxProposals: 1 });
    expect(out.proposals).toHaveLength(1);
    expect(out.classifications).toHaveLength(3);
    expect(out.totalFailures).toBe(3);
  });

  it('maxProposals=0 yields empty proposals but full classifications', async () => {
    const failures: FailingTest[] = [
      makeTest({ id: 'a', errorMessage: 'expect(x).toBe(y)' }),
    ];
    const out = await runTestFixer({ failures, maxProposals: 0 });
    expect(out.proposals).toHaveLength(0);
    expect(out.classifications).toHaveLength(1);
  });

  it('byRisk summary counts all proposals (not truncated slice)', async () => {
    const failures: FailingTest[] = [
      makeTest({ id: 'a', errorMessage: 'expect(x).toBe(y)' }),                  // low
      makeTest({ id: 'b', errorMessage: 'UnhandledPromiseRejection: boom' }),     // high
    ];
    const out = await runTestFixer({ failures, maxProposals: 1 });
    // summary should reflect all 2 proposals, not just the 1 in the truncated slice
    expect(out.summary.byRisk.low + out.summary.byRisk.high).toBe(2);
  });

  it('classifications are in same order as input failures', async () => {
    const failures: FailingTest[] = [
      makeTest({ id: 'x1', errorMessage: 'expect(a).toBe(b)' }),
      makeTest({ id: 'x2', errorMessage: 'Test timed out in 1000ms' }),
    ];
    const out = await runTestFixer({ failures });
    expect(out.classifications[0].testId).toBe('x1');
    expect(out.classifications[1].testId).toBe('x2');
  });
});

// ====== subagentSpec ======

describe('subagentSpec', () => {
  it('returns name "test-fixer"', () => {
    expect(subagentSpec().name).toBe('test-fixer');
  });

  it('returns a non-empty description string', () => {
    const { description } = subagentSpec();
    expect(typeof description).toBe('string');
    expect(description.length).toBeGreaterThan(10);
  });

  it('inputSchema has required field "failures"', () => {
    const schema = subagentSpec().inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain('failures');
    expect(schema.properties).toHaveProperty('failures');
  });

  it('inputSchema has optional repoRoot and maxProposals properties', () => {
    const schema = subagentSpec().inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty('repoRoot');
    expect(schema.properties).toHaveProperty('maxProposals');
  });

  it('outputSchema has required output fields', () => {
    const schema = subagentSpec().outputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain('generatedAt');
    expect(schema.required).toContain('totalFailures');
    expect(schema.required).toContain('classifications');
    expect(schema.required).toContain('proposals');
    expect(schema.required).toContain('summary');
  });

  it('returns a fresh object each call (idempotent, no shared state)', () => {
    const a = subagentSpec();
    const b = subagentSpec();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
