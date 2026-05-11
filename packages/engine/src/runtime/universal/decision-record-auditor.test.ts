import { describe, expect, it } from 'vitest';
import { assessDecisionRecord, type DecisionRecord } from './decision-record-auditor';

function record(patch: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: patch.id ?? 'decision-1',
    nodeId: patch.nodeId ?? 'node-1',
    nodeHash: patch.nodeHash ?? 'hash-1',
    attempt: patch.attempt ?? 1,
    selectedAlternative: patch.selectedAlternative ?? 'a',
    alternativesConsidered: patch.alternativesConsidered ?? ['a', 'b'],
    rationale: patch.rationale ?? 'Use alternative a because evidence supports lower risk',
    evidenceRefs: patch.evidenceRefs ?? ['artifact-1'],
    budgetImpact: patch.budgetImpact,
    timestamp: patch.timestamp ?? '2026-05-11T00:00:00.000Z',
    supersedesDecisionId: patch.supersedesDecisionId,
    nodeStartedAt: patch.nodeStartedAt,
  };
}

describe('DecisionRecordAuditor', () => {
  it('keeps a valid canonical record accepted', () => {
    const assessment = assessDecisionRecord({ record: record() });

    expect(assessment.canonical).toBe(true);
    expect(assessment.block).toBe(false);
    expect(assessment.safetyBlock).toBe(false);
  });

  it('safety-blocks conflicting canonical records for the same node hash', () => {
    const current = record({ id: 'decision-2', selectedAlternative: 'b' });
    const assessment = assessDecisionRecord({
      record: current,
      peerRecords: [record({ id: 'decision-1', selectedAlternative: 'a' })],
    });

    expect(assessment.safetyBlock).toBe(true);
    expect(assessment.signals.map((signal) => signal.code)).toContain('conflicting_same_node_hash');
  });
});
