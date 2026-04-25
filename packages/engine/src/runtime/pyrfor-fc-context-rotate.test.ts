// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rotateContext } from './pyrfor-fc-context-rotate.js';
import type { IterationResult } from './pyrfor-fc-ralph.js';
import type { FCEnvelope } from './pyrfor-fc-adapter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(sessionId: string | null = 'sess-1'): FCEnvelope {
  return {
    status: 'success',
    exitCode: 0,
    filesTouched: [],
    commandsRun: [],
    costUsd: 0.05,
    sessionId,
    durationMs: 500,
    raw: {},
  };
}

function makeIterResult(score: number, sessionId = 'sess-1', costUsd = 0.1): IterationResult {
  return {
    iter: 1,
    envelope: makeEnvelope(sessionId),
    score: { total: score, breakdown: { failedCheck: 'lint-error' } },
    durationMs: 1000,
    filesTouched: [],
    costUsd,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rotateContext', () => {
  it('iter 1: returns basePrompt unchanged, no appendSystemPrompt, no resumeSessionId', async () => {
    const result = await rotateContext({
      iter: 1,
      history: [],
      basePrompt: 'fix the bug',
    });
    expect(result.prompt).toBe('fix the bug');
    expect(result.appendSystemPrompt).toBeUndefined();
    expect(result.resumeSessionId).toBeUndefined();
  });

  it('prev score 30 (< 50): fresh start — no resume, correction note in appendSystemPrompt', async () => {
    const result = await rotateContext({
      iter: 2,
      history: [makeIterResult(30, 'old-sess')],
      basePrompt: 'fix the bug',
    });
    expect(result.prompt).toBe('fix the bug');
    expect(result.resumeSessionId).toBeUndefined();
    expect(result.appendSystemPrompt).toBeDefined();
    expect(result.appendSystemPrompt).toContain('[ITERATION 2]');
    expect(result.appendSystemPrompt).toContain('30/100');
    expect(result.appendSystemPrompt).toContain('Address these specifically');
  });

  it('prev score 65 (50-79): resume previous session + correction note', async () => {
    const result = await rotateContext({
      iter: 3,
      history: [makeIterResult(65, 'sess-abc')],
      basePrompt: 'fix the bug',
    });
    expect(result.prompt).toBe('fix the bug');
    expect(result.resumeSessionId).toBe('sess-abc');
    expect(result.appendSystemPrompt).toBeDefined();
    expect(result.appendSystemPrompt).toContain('[ITERATION 3]');
    expect(result.appendSystemPrompt).toContain('65/100');
    expect(result.appendSystemPrompt).toContain('Address these specifically');
  });

  it('prev score 85 (>= 80): light append + resume, no hard correction', async () => {
    const result = await rotateContext({
      iter: 4,
      history: [makeIterResult(85, 'sess-xyz')],
      basePrompt: 'fix the bug',
    });
    expect(result.prompt).toBe('fix the bug');
    expect(result.resumeSessionId).toBe('sess-xyz');
    expect(result.appendSystemPrompt).toBeDefined();
    expect(result.appendSystemPrompt).toContain('[ITERATION 4]');
    expect(result.appendSystemPrompt).toContain('85/100');
    // Light append should NOT contain hard correction message
    expect(result.appendSystemPrompt).not.toContain('Address these specifically');
  });

  it('lessonsBuilder result is prepended to appendSystemPrompt', async () => {
    const result = await rotateContext({
      iter: 2,
      history: [makeIterResult(65, 'sess-1')],
      basePrompt: 'fix the bug',
      lessonsBuilder: async () => '## Lessons\n- always use strict mode',
    });
    expect(result.appendSystemPrompt).toContain('## Lessons');
    expect(result.appendSystemPrompt).toContain('[ITERATION 2]');
    // Lessons should come before correction note
    const lessonsIdx = result.appendSystemPrompt!.indexOf('## Lessons');
    const corrIdx = result.appendSystemPrompt!.indexOf('[ITERATION 2]');
    expect(lessonsIdx).toBeLessThan(corrIdx);
  });

  it('null sessionId in envelope maps to undefined resumeSessionId', async () => {
    const result = await rotateContext({
      iter: 2,
      history: [makeIterResult(65, null as any)],
      basePrompt: 'fix',
    });
    expect(result.resumeSessionId).toBeUndefined();
  });
});
