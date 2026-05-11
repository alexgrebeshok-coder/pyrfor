import { describe, expect, it } from 'vitest';
import {
  EnsembleDiversityError,
  aggregateQuorum,
  executableVerifier,
  llmVerifier,
  resolveModelFamily,
  runCriticEnsemble,
  validateEnsembleDiversity,
  type CriticInput,
  type EnsembleConfig,
  type VerifierResult,
  type VerifierRunner,
} from './critic';

describe('critic ensemble diversity', () => {
  it('accepts independent model-family and executable verifier coverage', () => {
    expect(() => validateEnsembleDiversity({
      coderFamily: 'openai',
      verifiers: [
        llmVerifier('anthropic-judge', 'claude-sonnet-4.6'),
        executableVerifier('test-runner'),
      ],
    })).not.toThrow();
  });

  it('rejects the Critic-agrees-with-Coder failure mode', () => {
    expect(() => validateEnsembleDiversity({
      coderFamily: 'openai',
      verifiers: [
        llmVerifier('gpt-judge-a', 'gpt-5.4'),
        llmVerifier('gpt-judge-b', 'gpt-5.4-mini'),
      ],
      requireExecutable: false,
    })).toThrow(EnsembleDiversityError);
  });

  it('rejects a single verifier', () => {
    expect(() => validateEnsembleDiversity({
      coderFamily: 'openai',
      verifiers: [llmVerifier('anthropic-judge', 'claude-sonnet-4.6')],
      requireExecutable: false,
    })).toThrow(EnsembleDiversityError);
  });

  it('requires executable verifier coverage by default', () => {
    expect(() => validateEnsembleDiversity({
      coderFamily: 'openai',
      verifiers: [
        llmVerifier('anthropic-judge', 'claude-sonnet-4.6'),
        llmVerifier('openai-judge', 'gpt-5.4'),
      ],
    })).toThrow(EnsembleDiversityError);
  });

  it('allows non-executable ensembles only when explicitly configured', () => {
    expect(() => validateEnsembleDiversity({
      coderFamily: 'openai',
      requireExecutable: false,
      verifiers: [
        llmVerifier('anthropic-judge', 'claude-sonnet-4.6'),
        llmVerifier('openai-judge', 'gpt-5.4'),
      ],
    })).not.toThrow();
  });
});

describe('critic model family policy', () => {
  it('maps allowed models to capped families', () => {
    expect(resolveModelFamily('claude-sonnet-4.6')).toBe('anthropic');
    expect(resolveModelFamily('gpt-5.4')).toBe('openai');
    expect(resolveModelFamily('gpt-5.3-codex')).toBe('openai');
  });

  it('rejects models above the M5 cap', () => {
    expect(() => resolveModelFamily('gpt-5.5')).toThrow(/disallowed/);
    expect(() => resolveModelFamily('claude-opus-4.7')).toThrow(/disallowed/);
  });
});

describe('critic quorum aggregation', () => {
  it('passes only when every verifier passes', () => {
    expect(aggregateQuorum([
      result('a', 'openai', 'pass'),
      result('b', 'executable', 'pass'),
    ])).toBe('pass');
  });

  it('asks for rework when any verifier asks for rework', () => {
    expect(aggregateQuorum([
      result('a', 'openai', 'pass'),
      result('b', 'executable', 'rework'),
    ])).toBe('rework');
  });

  it('blocks when any verifier blocks', () => {
    expect(aggregateQuorum([
      result('a', 'openai', 'pass'),
      result('b', 'anthropic', 'rework'),
      result('c', 'executable', 'block'),
    ])).toBe('block');
  });
});

describe('runCriticEnsemble', () => {
  it('runs all verifiers and aggregates a pass', async () => {
    const config: EnsembleConfig = {
      coderFamily: 'openai',
      verifiers: [
        llmVerifier('anthropic-judge', 'claude-sonnet-4.6'),
        executableVerifier('test-runner'),
      ],
    };
    const report = await runCriticEnsemble(config, input(), new Map<string, VerifierRunner>([
      ['anthropic-judge', async () => ({ verdict: 'pass', rationale: 'independent review passed' })],
      ['test-runner', async () => ({ verdict: 'pass', rationale: 'tests passed' })],
    ]));

    expect(report.aggregateVerdict).toBe('pass');
    expect(report.familyDiversityMet).toBe(true);
    expect(report.executableVerifierPresent).toBe(true);
    expect(report.results).toHaveLength(2);
  });

  it('rejects same-family passing judges before any runner is called', async () => {
    const calls: string[] = [];
    await expect(runCriticEnsemble({
      coderFamily: 'anthropic',
      requireExecutable: false,
      verifiers: [
        llmVerifier('sonnet-a', 'claude-sonnet-4.6'),
        llmVerifier('haiku-b', 'claude-haiku-4.5'),
      ],
    }, input(), new Map<string, VerifierRunner>([
      ['sonnet-a', async () => {
        calls.push('sonnet-a');
        return { verdict: 'pass', rationale: 'same family says pass' };
      }],
      ['haiku-b', async () => {
        calls.push('haiku-b');
        return { verdict: 'pass', rationale: 'same family says pass' };
      }],
    ]))).rejects.toThrow(EnsembleDiversityError);
    expect(calls).toEqual([]);
  });
});

function input(): CriticInput {
  return { artifactRef: 'artifact:demo', specSummary: 'demo acceptance' };
}

function result(
  verifierId: string,
  family: VerifierResult['family'],
  verdict: VerifierResult['verdict'],
): VerifierResult {
  return {
    verifierId,
    family,
    kind: family === 'executable' ? 'executable' : 'llm',
    verdict,
    rationale: verdict,
    durationMs: 1,
  };
}
