import { describe, expect, it, vi } from 'vitest';
import {
  ConceptClarifier,
  scoreClarify,
  type ClarificationAdapter,
} from './concept-clarifier';

describe('scoreClarify', () => {
  it('treats concrete scoped concepts as clear', () => {
    const result = scoreClarify('Build a REST API for user management so that tests can verify CRUD behavior');

    expect(result.needsClarification).toBe(false);
    expect(result.clarity).toBeGreaterThanOrEqual(0.75);
    expect(result.questions).toEqual([]);
  });

  it('asks bounded required-first questions for vague concepts', () => {
    const result = scoreClarify('do the thing with stuff');

    expect(result.needsClarification).toBe(true);
    expect(result.questions.length).toBeLessThanOrEqual(3);
    const optionalIndex = result.questions.findIndex((question) => !question.required);
    const requiredAfterOptional = result.questions.findIndex((question, index) => question.required && optionalIndex !== -1 && index > optionalIndex);
    expect(requiredAfterOptional).toBe(-1);
  });
});

describe('ConceptClarifier', () => {
  it('skips the loop for trivially clear concepts', async () => {
    const adapter = neverCalledAdapter();
    const clarifier = new ConceptClarifier({ adapter });

    const result = await clarifier.clarify('Build a REST API for user management so that tests can verify CRUD behavior');

    expect(result.stoppedAt).toBe('trivially_clear');
    expect(result.totalRounds).toBe(0);
    expect(adapter.ask).not.toHaveBeenCalled();
  });

  it('does not call the adapter in non-interactive mode', async () => {
    const adapter = neverCalledAdapter();
    const clarifier = new ConceptClarifier({ adapter, nonInteractive: true });

    const result = await clarifier.clarify('build something');

    expect(result.stoppedAt).toBe('non_interactive');
    expect(result.totalRounds).toBe(0);
    expect(result.refinedConcept).toContain('Clarifications:');
    expect(adapter.ask).not.toHaveBeenCalled();
  });

  it('records a skipped round when the adapter returns null', async () => {
    const adapter = nullAdapter();
    const clarifier = new ConceptClarifier({ adapter });

    const result = await clarifier.clarify('build something');

    expect(result.stoppedAt).toBe('non_interactive');
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].skipped).toBe(true);
    expect(adapter.ask).toHaveBeenCalledTimes(1);
  });

  it('resolves with adapter answers and stays within max rounds', async () => {
    const adapter: ClarificationAdapter = {
      ask: vi.fn().mockResolvedValue({
        'scope:0': 'Deliver a local CLI command for project reports.',
        'ambiguity:0': 'Use the existing TypeScript runtime.',
        'priority:0': 'Prioritize deterministic tests.',
      }),
    };
    const clarifier = new ConceptClarifier({ adapter, maxRounds: 99 });

    const result = await clarifier.clarify('build something');

    expect(result.stoppedAt).toBe('resolved');
    expect(result.totalRounds).toBeLessThanOrEqual(3);
    expect(result.refinedConcept).toContain('Deliver a local CLI command');
  });
});

function neverCalledAdapter(): ClarificationAdapter {
  return { ask: vi.fn().mockRejectedValue(new Error('adapter should not be called')) };
}

function nullAdapter(): ClarificationAdapter {
  return { ask: vi.fn().mockResolvedValue(null) };
}
