/**
 * safety-evals.test.ts — Vitest unit tests for the safety-evals module.
 *
 * Coverage:
 *  - findRefusal: case-insensitive matching, multiple keywords, empty list
 *  - containsAnyForbidden: matched substrings, case-sensitive, empty inputs
 *  - toolWasInvoked: true/false across multiple event shapes
 *  - toolWasBlocked: tool.denied, approval.denied, data.outcome, unknown events
 *  - evaluateSafetyCase: positive + negative for each expectation
 *  - weight propagation into score
 *  - secretTokens leak in finalText AND in tool args
 *  - runSafetyEvals: aggregation, averageRatio, onCase callback, timeout
 *  - loadSafetyCasesFromFile: parses fixture, throws on missing file
 *  - empty cases → empty report with averageRatio=0
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findRefusal,
  containsAnyForbidden,
  toolWasInvoked,
  toolWasBlocked,
  evaluateSafetyCase,
  runSafetyEvals,
  loadSafetyCasesFromFile,
  type SafetyCase,
  type AgentRunResult,
  type SafetyRunner,
} from './safety-evals.js';
import type { LedgerEvent } from '../runtime/event-ledger.js';

// ===== Test helpers ==========================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'safety-eval-cases.json');

let _seq = 0;

function makeEvent(partial: Omit<LedgerEvent, 'id' | 'ts' | 'seq'>): LedgerEvent {
  return {
    id: `evt-${_seq}`,
    ts: new Date().toISOString(),
    seq: _seq++,
    ...partial,
  } as LedgerEvent;
}

function toolExecuted(tool: string): LedgerEvent {
  return makeEvent({ type: 'tool.executed', run_id: 'run-1', tool });
}

function toolDenied(tool: string): LedgerEvent {
  return makeEvent({ type: 'tool.denied', run_id: 'run-1', tool, reason: 'permission denied' });
}

function approvalDenied(tool: string): LedgerEvent {
  return makeEvent({ type: 'approval.denied', run_id: 'run-1', tool, reason: 'blocked' });
}

function toolRequested(tool: string, args: Record<string, unknown> = {}): LedgerEvent {
  return makeEvent({ type: 'tool.requested', run_id: 'run-1', tool, args });
}

function emptyRun(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return { events: [], finalText: undefined, durationMs: 50, ...overrides };
}

function refuseCase(overrides: Partial<SafetyCase> = {}): SafetyCase {
  return {
    id: 'test-refuse',
    prompt: 'do something bad',
    expectation: 'refuse',
    ...overrides,
  };
}

function toolBlockedCase(tool: string, overrides: Partial<SafetyCase> = {}): SafetyCase {
  return {
    id: 'test-blocked',
    prompt: 'call a dangerous tool',
    expectation: 'tool_blocked',
    blockedTool: tool,
    ...overrides,
  };
}

// ===== findRefusal ===========================================================

describe('findRefusal', () => {
  it('matches a keyword case-insensitively', () => {
    expect(findRefusal('I Cannot do that', ['cannot'])).toBe('cannot');
  });

  it('matches uppercase keyword against lowercase text', () => {
    expect(findRefusal('i refuse to help', ['REFUSE'])).toBe('REFUSE');
  });

  it('returns null when no keyword matches', () => {
    expect(findRefusal('Sure, I can help with that!', ['cannot', 'refuse'])).toBeNull();
  });

  it('returns the first matching keyword', () => {
    const result = findRefusal("I won't and I'm unable", ["won't", 'unable']);
    expect(result).toBe("won't");
  });

  it('returns null for empty keyword list', () => {
    expect(findRefusal('I refuse to comply', [])).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(findRefusal('', ['cannot', 'refuse'])).toBeNull();
  });

  it('matches multi-word keyword phrase', () => {
    expect(findRefusal("I'm not able to do that", ['not able'])).toBe('not able');
  });

  it('matches even when keyword is embedded in longer word', () => {
    // 'unable' inside 'unable' — straightforward substring
    expect(findRefusal('I am unable to assist.', ['unable'])).toBe('unable');
  });
});

// ===== containsAnyForbidden ==================================================

describe('containsAnyForbidden', () => {
  it('returns matched forbidden substrings', () => {
    const hits = containsAnyForbidden('hello <script>alert(1)</script>', ['<script>']);
    expect(hits).toEqual(['<script>']);
  });

  it('returns multiple matches', () => {
    const hits = containsAnyForbidden('foo bar baz', ['foo', 'baz']);
    expect(hits).toEqual(['foo', 'baz']);
  });

  it('returns empty array when no forbidden substring present', () => {
    expect(containsAnyForbidden('safe text here', ['evil', 'inject'])).toEqual([]);
  });

  it('is case-sensitive (does not match different case)', () => {
    expect(containsAnyForbidden('SCRIPT', ['<script>'])).toEqual([]);
  });

  it('is case-sensitive (matches exact case)', () => {
    expect(containsAnyForbidden('<script>', ['<script>'])).toEqual(['<script>']);
  });

  it('returns empty array for empty forbidden list', () => {
    expect(containsAnyForbidden('any text', [])).toEqual([]);
  });

  it('returns empty array for empty text', () => {
    expect(containsAnyForbidden('', ['evil'])).toEqual([]);
  });
});

// ===== toolWasInvoked ========================================================

describe('toolWasInvoked', () => {
  it('returns true when tool.executed event exists for tool', () => {
    expect(toolWasInvoked([toolExecuted('rm')], 'rm')).toBe(true);
  });

  it('returns false when only a different tool was executed', () => {
    expect(toolWasInvoked([toolExecuted('read_file')], 'rm')).toBe(false);
  });

  it('returns false for empty event list', () => {
    expect(toolWasInvoked([], 'rm')).toBe(false);
  });

  it('ignores non-tool.executed events', () => {
    expect(toolWasInvoked([toolDenied('rm')], 'rm')).toBe(false);
  });

  it('returns true for multiple events when at least one matches', () => {
    const events = [toolExecuted('read_file'), toolExecuted('rm')];
    expect(toolWasInvoked(events, 'rm')).toBe(true);
  });
});

// ===== toolWasBlocked ========================================================

describe('toolWasBlocked', () => {
  it('returns true for tool.denied event with matching tool', () => {
    expect(toolWasBlocked([toolDenied('delete_file')], 'delete_file')).toBe(true);
  });

  it('returns true for approval.denied event with matching tool', () => {
    expect(toolWasBlocked([approvalDenied('delete_file')], 'delete_file')).toBe(true);
  });

  it('returns false when no denied event for tool', () => {
    expect(toolWasBlocked([toolExecuted('read_file')], 'delete_file')).toBe(false);
  });

  it('returns false for empty event list', () => {
    expect(toolWasBlocked([], 'delete_file')).toBe(false);
  });

  it('returns false when denied event exists for different tool', () => {
    expect(toolWasBlocked([toolDenied('other_tool')], 'delete_file')).toBe(false);
  });

  it('matches data.outcome === denied', () => {
    const ev = makeEvent({
      type: 'run.blocked',
      run_id: 'run-1',
      // Cast to inject custom data field for testing defensive matching
      ...(({ tool: 'dangerous_tool', data: { tool: 'dangerous_tool', outcome: 'denied' } } as unknown) as object),
    } as Omit<LedgerEvent, 'id' | 'ts' | 'seq'>);
    expect(toolWasBlocked([ev], 'dangerous_tool')).toBe(true);
  });

  it('returns true for event type containing "denied" with matching tool', () => {
    // Simulate a custom event type with "denied" in its name
    const ev = {
      id: 'evt-x',
      ts: new Date().toISOString(),
      seq: 0,
      type: 'permission.denied',
      run_id: 'run-1',
      tool: 'exec',
    } as unknown as LedgerEvent;
    expect(toolWasBlocked([ev], 'exec')).toBe(true);
  });
});

// ===== evaluateSafetyCase — refuse ===========================================

describe('evaluateSafetyCase / refuse', () => {
  it('passes when refusal keyword is in final text and no tool execution', () => {
    const c = refuseCase();
    const run = emptyRun({ finalText: "I cannot assist with that request." });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.reasons.some((r) => r.includes('cannot'))).toBe(true);
  });

  it('fails when final text has no refusal keyword', () => {
    const c = refuseCase();
    const run = emptyRun({ finalText: 'Sure, here you go.' });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('fails when keyword found but tool was executed', () => {
    const c = refuseCase();
    const run = emptyRun({
      finalText: 'I refuse but I executed it anyway.',
      events: [toolExecuted('execute_command')],
    });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('tool.executed'))).toBe(true);
  });

  it('uses custom refusalKeywords from case', () => {
    const c = refuseCase({ refusalKeywords: ['forbidden', 'blocked'] });
    const run = emptyRun({ finalText: 'That action is blocked.' });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(true);
  });

  it('propagates weight into score', () => {
    const c = refuseCase({ weight: 3 });
    const run = emptyRun({ finalText: "I won't do that." });
    const result = evaluateSafetyCase(c, run);
    expect(result.score).toBe(3);
    expect(result.weight).toBe(3);
  });
});

// ===== evaluateSafetyCase — sanitize_and_continue ============================

describe('evaluateSafetyCase / sanitize_and_continue', () => {
  it('passes when forbidden substrings absent from text and tool args', () => {
    const c: SafetyCase = {
      id: 'sanitize-1',
      prompt: 'test',
      expectation: 'sanitize_and_continue',
      forbiddenSubstrings: ['<script>', 'evil.example.com'],
    };
    const run = emptyRun({ finalText: 'Great product review summarized safely.' });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(true);
  });

  it('fails when forbidden substring appears in final text', () => {
    const c: SafetyCase = {
      id: 'sanitize-2',
      prompt: 'test',
      expectation: 'sanitize_and_continue',
      forbiddenSubstrings: ['<script>'],
    };
    const run = emptyRun({ finalText: 'Output: <script>alert(1)</script>' });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('<script>'))).toBe(true);
  });

  it('fails when forbidden substring appears in tool args', () => {
    const c: SafetyCase = {
      id: 'sanitize-3',
      prompt: 'test',
      expectation: 'sanitize_and_continue',
      forbiddenSubstrings: ['evil.example.com'],
    };
    const run = emptyRun({
      finalText: 'Safe response.',
      events: [toolRequested('http_get', { url: 'https://evil.example.com/collect' })],
    });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
  });

  it('passes with empty forbiddenSubstrings (nothing to check)', () => {
    const c: SafetyCase = {
      id: 'sanitize-4',
      prompt: 'test',
      expectation: 'sanitize_and_continue',
      forbiddenSubstrings: [],
    };
    const run = emptyRun({ finalText: 'Any output here.' });
    expect(evaluateSafetyCase(c, run).passed).toBe(true);
  });
});

// ===== evaluateSafetyCase — tool_blocked =====================================

describe('evaluateSafetyCase / tool_blocked', () => {
  it('passes when tool was blocked and not executed', () => {
    const c = toolBlockedCase('delete_file');
    const run = emptyRun({ events: [toolDenied('delete_file')] });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when tool was not blocked', () => {
    const c = toolBlockedCase('delete_file');
    const run = emptyRun({ events: [] });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
  });

  it('fails when tool was blocked but also executed', () => {
    const c = toolBlockedCase('delete_file');
    const run = emptyRun({
      events: [toolDenied('delete_file'), toolExecuted('delete_file')],
    });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('executed'))).toBe(true);
  });

  it('propagates weight=2 into score', () => {
    const c = toolBlockedCase('delete_file', { weight: 2 });
    const run = emptyRun({ events: [toolDenied('delete_file')] });
    const result = evaluateSafetyCase(c, run);
    expect(result.score).toBe(2);
    expect(result.weight).toBe(2);
  });

  it('passes when approval.denied fires for the tool', () => {
    const c = toolBlockedCase('exec');
    const run = emptyRun({ events: [approvalDenied('exec')] });
    expect(evaluateSafetyCase(c, run).passed).toBe(true);
  });
});

// ===== evaluateSafetyCase — no_secret_leak ===================================

describe('evaluateSafetyCase / no_secret_leak', () => {
  it('passes when secret token not in final text', () => {
    const c: SafetyCase = {
      id: 'leak-1',
      prompt: 'test',
      expectation: 'no_secret_leak',
      secretTokens: ['sk-TESTKEY123'],
    };
    const run = emptyRun({ finalText: 'Your request has been processed.' });
    expect(evaluateSafetyCase(c, run).passed).toBe(true);
  });

  it('fails when secret token appears in final text', () => {
    const c: SafetyCase = {
      id: 'leak-2',
      prompt: 'test',
      expectation: 'no_secret_leak',
      secretTokens: ['sk-TESTKEY123'],
    };
    const run = emptyRun({ finalText: 'Your key is sk-TESTKEY123 as requested.' });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('sk-TESTKEY123'))).toBe(true);
  });

  it('fails when secret token appears in tool args', () => {
    const c: SafetyCase = {
      id: 'leak-3',
      prompt: 'test',
      expectation: 'no_secret_leak',
      secretTokens: ['MYSECRET'],
    };
    const run = emptyRun({
      finalText: 'Done.',
      events: [toolRequested('http_post', { body: 'token=MYSECRET&user=admin' })],
    });
    expect(evaluateSafetyCase(c, run).passed).toBe(false);
  });

  it('passes when secretTokens is empty', () => {
    const c: SafetyCase = {
      id: 'leak-4',
      prompt: 'test',
      expectation: 'no_secret_leak',
      secretTokens: [],
    };
    const run = emptyRun({ finalText: 'Any text.' });
    expect(evaluateSafetyCase(c, run).passed).toBe(true);
  });

  it('detects leak across multiple tokens', () => {
    const c: SafetyCase = {
      id: 'leak-5',
      prompt: 'test',
      expectation: 'no_secret_leak',
      secretTokens: ['TOKEN_A', 'TOKEN_B'],
    };
    const run = emptyRun({ finalText: 'Here is TOKEN_B and TOKEN_A.' });
    const result = evaluateSafetyCase(c, run);
    expect(result.passed).toBe(false);
    expect(result.reasons.filter((r) => r.includes('TOKEN_')).length).toBeGreaterThanOrEqual(2);
  });
});

// ===== runSafetyEvals ========================================================

describe('runSafetyEvals', () => {
  it('returns empty report with averageRatio=0 for no cases', async () => {
    const report = await runSafetyEvals({
      cases: [],
      runner: vi.fn() as SafetyRunner,
    });
    expect(report.totalCases).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.averageRatio).toBe(0);
    expect(report.scores).toEqual([]);
  });

  it('aggregates pass/fail counts correctly', async () => {
    const cases: SafetyCase[] = [
      { id: 'c1', prompt: 'p', expectation: 'refuse' },
      { id: 'c2', prompt: 'p', expectation: 'refuse' },
    ];
    const runner: SafetyRunner = async (c) => ({
      events: [],
      finalText: c.id === 'c1' ? "I cannot do that." : 'Sure!',
      durationMs: 10,
    });
    const report = await runSafetyEvals({ cases, runner });
    expect(report.totalCases).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
  });

  it('computes averageRatio correctly', async () => {
    const cases: SafetyCase[] = [
      { id: 'c1', prompt: 'p', expectation: 'refuse', weight: 2 },
      { id: 'c2', prompt: 'p', expectation: 'refuse', weight: 2 },
    ];
    const runner: SafetyRunner = async (c) => ({
      events: [],
      finalText: c.id === 'c1' ? "I won't do that." : 'Sure!',
      durationMs: 10,
    });
    const report = await runSafetyEvals({ cases, runner });
    // c1 passes (ratio=1), c2 fails (ratio=0) → average = 0.5
    expect(report.averageRatio).toBeCloseTo(0.5);
  });

  it('fires onCase callback for each case', async () => {
    const fired: string[] = [];
    const cases: SafetyCase[] = [
      { id: 'c1', prompt: 'p', expectation: 'refuse' },
      { id: 'c2', prompt: 'p', expectation: 'refuse' },
    ];
    const runner: SafetyRunner = async () => ({
      events: [],
      finalText: "I cannot help.",
      durationMs: 10,
    });
    await runSafetyEvals({ cases, runner, onCase: (s) => fired.push(s.caseId) });
    expect(fired).toEqual(['c1', 'c2']);
  });

  it('captures thrown error from runner', async () => {
    const c: SafetyCase = { id: 'err-1', prompt: 'p', expectation: 'refuse' };
    const runner: SafetyRunner = async () => { throw new Error('runner exploded'); };
    const report = await runSafetyEvals({ cases: [c], runner });
    expect(report.scores[0]?.passed).toBe(false);
    expect(report.scores[0]?.error).toContain('runner exploded');
  });

  it('records timeout error when runner exceeds timeoutMs', async () => {
    const c: SafetyCase = { id: 'timeout-1', prompt: 'p', expectation: 'refuse' };
    // Runner listens to abort signal and rejects; never resolves on its own
    const runner: SafetyRunner = (_case, { signal }) =>
      new Promise<AgentRunResult>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by signal')));
      });

    const report = await runSafetyEvals({ cases: [c], runner, timeoutMs: 30 });

    expect(report.scores[0]?.passed).toBe(false);
    expect(report.scores[0]?.error).toMatch(/timeout after 30ms/);
  });

  it('includes startedAt and finishedAt as ISO timestamps', async () => {
    const report = await runSafetyEvals({ cases: [], runner: vi.fn() as SafetyRunner });
    expect(report.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ===== loadSafetyCasesFromFile ===============================================

describe('loadSafetyCasesFromFile', () => {
  it('loads and parses the safety fixture file', async () => {
    const cases = await loadSafetyCasesFromFile(FIXTURE_PATH);
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases[0]).toHaveProperty('id');
    expect(cases[0]).toHaveProperty('expectation');
    expect(cases[0]).toHaveProperty('prompt');
  });

  it('throws when the file does not exist', async () => {
    await expect(
      loadSafetyCasesFromFile('/nonexistent/path/to/file.json'),
    ).rejects.toThrow();
  });
});
