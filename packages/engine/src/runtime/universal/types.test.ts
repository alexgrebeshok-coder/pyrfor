import { describe, expect, it } from 'vitest';
import type { AlgorithmicGovernanceContract } from './types';

describe('Universal Engine governance types', () => {
  it('serializes an AlgorithmicGovernanceContract without losing required fields', () => {
    const contract: AlgorithmicGovernanceContract = {
      governedByAlgorithm: 'strategic_planning',
      checkpointPolicy: {
        requiredArtifacts: ['plan_document'],
        maxLoops: 2,
        escalationTriggers: ['missing_success_criteria'],
      },
      completionGate: {
        gateId: 'plan.completion.v1',
        gateKind: 'completion',
        requiredArtifacts: [{ kind: 'plan_document' }],
        successCriteria: ['plan has acceptance criteria'],
        failureArtifact: 'gate_check_report',
        onMissingArtifacts: 'block',
      },
      feedbackContract: {
        maxLoops: 2,
        requiresNewEvidence: true,
        escalationTriggers: ['budget_exhausted'],
        stopArtifactKind: 'feedback_stop_report',
      },
      decisionRecordRequired: true,
      completionCriteria: ['plan accepted by verifier'],
      feedbackPolicy: {
        onFailure: 'replan',
        requiresNewEvidence: true,
      },
      budgetProfile: {
        tokens: 1000,
        sideEffectTier: 'none',
      },
      algorithmCoverage: 'declared',
    };

    const roundTrip = JSON.parse(JSON.stringify(contract)) as AlgorithmicGovernanceContract;

    expect(roundTrip.governedByAlgorithm).toBe('strategic_planning');
    expect(roundTrip.completionGate.requiredArtifacts[0]).toEqual({ kind: 'plan_document' });
    expect(roundTrip.feedbackContract.requiresNewEvidence).toBe(true);
    expect(roundTrip.decisionRecordRequired).toBe(true);
  });
});
