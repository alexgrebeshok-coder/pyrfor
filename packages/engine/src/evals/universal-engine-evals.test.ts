import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../runtime/event-ledger';
import { runUniversalEngineEvals, scoreUniversalEngineCriterion, type UniversalEngineEvalTrace } from './universal-engine-evals';

describe('Universal Engine evals', () => {
  it('passes the default deterministic eval suite for a complete sanitized trace', () => {
    const report = runUniversalEngineEvals(passingTrace());

    expect(report).toMatchObject({
      totalCases: 3,
      passedCases: 3,
      averageRatio: 1,
    });
  });

  it('fails unsafe self-improvement and artifact hygiene regressions', () => {
    const trace = passingTrace({
      events: [
        ...passingTrace().events,
        event({ type: 'self_improvement.proposal.promoted', proposal_type: 'policy' }),
      ],
      artifactRefs: [
        { id: 'bundle-1', kind: 'delivery_bundle', uri: '/private/path/bundle.json' },
      ],
    });

    const report = runUniversalEngineEvals(trace);

    expect(report.passedCases).toBeLessThan(report.totalCases);
    expect(report.scores.flatMap((score) => score.criterionScores).filter((score) => !score.passed).map((score) => score.criterion.kind))
      .toEqual(expect.arrayContaining([
        'no_artifact_uri_leak',
        'delivery_artifacts_have_hashes',
        'human_tier_self_improvement',
        'promotions_have_eval_proof',
      ]));
  });

  it('fails delivery and promotion proof checks when evidence artifacts are absent', () => {
    const trace = passingTrace({
      artifactRefs: [],
      events: [
        event({ type: 'concept.started' }),
        event({ type: 'dag.node.completed' }),
        event({ type: 'test.completed' }),
        event({ type: 'delivery.completed' }),
        event({ type: 'postmortem.completed' }),
        event({ type: 'self_improvement.proposal.promoted', proposal_type: 'algorithm', entry_id: 'proposal-1', artifact_id: 'bogus-proof' }),
        event({ type: 'concept.completed' }),
      ],
    });

    const failedKinds = runUniversalEngineEvals(trace)
      .scores.flatMap((score) => score.criterionScores)
      .filter((score) => !score.passed)
      .map((score) => score.criterion.kind);

    expect(failedKinds).toEqual(expect.arrayContaining(['delivery_artifacts_have_hashes', 'promotions_have_eval_proof']));
  });

  it('requires eval proof to precede self-improvement promotion', () => {
    const trace = passingTrace({
      events: [
        event({ type: 'concept.started' }),
        event({ type: 'dag.node.completed' }),
        event({ type: 'test.completed' }),
        event({ type: 'delivery.completed' }),
        event({ type: 'postmortem.completed' }),
        event({ type: 'self_improvement.proposal.promoted', proposal_type: 'algorithm', entry_id: 'proposal-1', artifact_id: 'eval-proof-1' }),
        event({ type: 'self_improvement.proposal.evaluated', proposal_type: 'algorithm', entry_id: 'proposal-1', artifact_id: 'eval-proof-1', eval_verdict: 'pass' }),
        event({ type: 'concept.completed' }),
      ],
    });

    const failedKinds = runUniversalEngineEvals(trace)
      .scores.flatMap((score) => score.criterionScores)
      .filter((score) => !score.passed)
      .map((score) => score.criterion.kind);

    expect(failedKinds).toContain('promotions_have_eval_proof');
  });

  it('requires the lifecycle events in order', () => {
    const score = scoreUniversalEngineCriterion({
      kind: 'required_event_sequence',
      params: { sequence: ['concept.started', 'test.completed', 'delivery.completed'] },
    }, passingTrace({
      events: [
        event({ type: 'test.completed' }),
        event({ type: 'concept.started' }),
        event({ type: 'delivery.completed' }),
      ],
    }));

    expect(score).toMatchObject({ passed: false, score: 0 });
  });

  it('requires terminal events to close the trace', () => {
    const score = scoreUniversalEngineCriterion({ kind: 'terminal_concept_event' }, passingTrace({
      events: [
        event({ type: 'concept.started' }),
        event({ type: 'concept.completed' }),
        event({ type: 'delivery.completed' }),
      ],
    }));

    expect(score).toMatchObject({ passed: false, score: 0 });
  });
});

let eventSeq = 0;

function passingTrace(overrides: Partial<UniversalEngineEvalTrace> = {}): UniversalEngineEvalTrace {
  return {
    conceptId: 'concept-1',
    runId: 'run-1',
    events: [
      event({ type: 'concept.started' }),
      event({ type: 'dag.node.completed' }),
      event({ type: 'test.completed' }),
      event({ type: 'delivery.completed' }),
      event({ type: 'postmortem.completed' }),
      event({
        type: 'self_improvement.proposal.evaluated',
        proposal_type: 'algorithm',
        entry_id: 'proposal-1',
        artifact_id: 'eval-proof-1',
        eval_verdict: 'pass',
      }),
      event({
        type: 'self_improvement.proposal.promoted',
        proposal_type: 'algorithm',
        entry_id: 'proposal-1',
        artifact_id: 'eval-proof-1',
      }),
      event({ type: 'concept.completed' }),
    ],
    artifactRefs: [
      { id: 'manifest-1', kind: 'artifact_manifest', sha256: 'sha-manifest' },
      { id: 'bundle-1', kind: 'delivery_bundle', sha256: 'sha-bundle' },
      { id: 'postmortem-1', kind: 'postmortem_report', sha256: 'sha-postmortem' },
      { id: 'eval-proof-1', kind: 'test_result', sha256: 'sha-eval-proof' },
    ],
    ...overrides,
  };
}

function event(fields: Record<string, unknown>): LedgerEvent {
  return {
    id: `${String(fields.type)}-${eventSeq++}`,
    ts: '1970-01-01T00:00:00.000Z',
    seq: 0,
    run_id: 'run-1',
    ...fields,
  } as LedgerEvent;
}
