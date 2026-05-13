import { describe, expect, it } from 'vitest';
import { decideTier } from './tier-decider';
import type { DecisionVector } from './types';

describe('decideTier', () => {
  it('allows low-risk satisfied work autonomously', () => {
    expect(decideTier({ decisionVector: vector() })).toEqual({
      decision: 'autonomous',
      reasonCodes: ['low_risk_autonomous'],
      requiresApproval: false,
      abortRequired: false,
    });
  });

  it('blocks safety before approval and notify conditions', () => {
    const result = decideTier({
      decisionVector: vector({
        sandboxTier: 'forbidden',
        reversibility: 'irreversible',
        failureHistoryScore: 1,
      }),
    });

    expect(result.decision).toBe('block');
    expect(result.reasonCodes).toEqual(['safety_block']);
    expect(result.abortRequired).toBe(true);
  });

  it('blocks failed gates before tool cap exhaustion', () => {
    const result = decideTier({
      decisionVector: vector({
        gateStatus: 'failed',
        toolCapRemaining: 0,
      }),
    });

    expect(result.decision).toBe('block');
    expect(result.reasonCodes).toEqual(['gate_failed']);
  });

  it('blocks exhausted tool creation caps before approval', () => {
    const result = decideTier({
      decisionVector: vector({
        toolCapRemaining: 0,
        reversibility: 'irreversible',
      }),
    });

    expect(result.decision).toBe('block');
    expect(result.reasonCodes).toEqual(['tool_cap_exhausted']);
  });

  it('blocks hard budget exhaustion as abort-required', () => {
    const result = decideTier({
      decisionVector: vector({ remainingBudget: { tokens: 0, usd: 1, wallMs: 1_000 } }),
    });

    expect(result.decision).toBe('block');
    expect(result.reasonCodes).toEqual(['budget_exhausted_abort']);
    expect(result.requiresApproval).toBe(true);
    expect(result.abortRequired).toBe(true);
  });

  it('blocks invalid numeric budget values as exhausted', () => {
    const result = decideTier({
      decisionVector: vector({ remainingBudget: { tokens: Number.NaN, usd: 1, wallMs: 1_000 } }),
    });

    expect(result.decision).toBe('block');
    expect(result.reasonCodes).toEqual(['budget_exhausted_abort']);
    expect(result.abortRequired).toBe(true);
  });

  it('does not treat omitted budget dimensions as exhausted', () => {
    const result = decideTier({
      decisionVector: vector({ remainingBudget: { tokens: 10_000 } }),
    });

    expect(result.decision).toBe('autonomous');
  });

  it('keeps the soft token-budget approval boundary exclusive', () => {
    expect(decideTier({
      decisionVector: vector({ remainingBudget: { tokens: 1_000, usd: 10, wallMs: 60_000 } }),
    }).decision).toBe('autonomous');
    expect(decideTier({
      decisionVector: vector({ remainingBudget: { tokens: 999, usd: 10, wallMs: 60_000 } }),
    }).reasonCodes).toContain('budget_approval_required');
  });

  it('requires approval for irreversible effects', () => {
    const result = decideTier({
      decisionVector: vector({ reversibility: 'irreversible' }),
    });

    expect(result.decision).toBe('approve');
    expect(result.requiresApproval).toBe(true);
    expect(result.reasonCodes).toContain('irreversible_effect');
  });

  it('requires approval when estimated money exceeds remaining budget', () => {
    const result = decideTier({
      decisionVector: vector({
        estimatedImpact: { fsScope: [], netReach: [], moneyUsd: 5 },
        remainingBudget: { tokens: 10_000, usd: 1, wallMs: 60_000 },
      }),
    });

    expect(result.decision).toBe('approve');
    expect(result.reasonCodes).toContain('budget_approval_required');
  });

  it('notifies on inferred algorithm coverage without requiring approval', () => {
    const result = decideTier({
      decisionVector: vector({ algorithmCoverage: 'inferred' }),
    });

    expect(result.decision).toBe('notify');
    expect(result.requiresApproval).toBe(false);
    expect(result.reasonCodes).toContain('inferred_algorithm_coverage');
  });

  it('requires approval for retries without new evidence', () => {
    const result = decideTier({
      decisionVector: vector({ loopCount: 1, newEvidencePresent: false }),
    });

    expect(result.decision).toBe('approve');
    expect(result.reasonCodes).toContain('retry_without_new_evidence');
  });

  it('blocks grandfathered nodes from bypassing never-grandfathered gates', () => {
    const result = decideTier({
      gate: 'prompt_injection_scan',
      decisionVector: vector({ algorithmCoverage: 'grandfathered' }),
    });

    expect(result).toEqual({
      decision: 'block',
      reasonCodes: ['never_grandfathered_gate', 'prompt_injection_scan'],
      requiresApproval: false,
      abortRequired: true,
    });
  });

  it('still allows approval path for grandfathered nodes on grandfatherable gates', () => {
    const result = decideTier({
      gate: 'algorithm_declared',
      decisionVector: vector({ algorithmCoverage: 'grandfathered' }),
    });

    expect(result.decision).toBe('approve');
    expect(result.reasonCodes).toContain('legacy_algorithm_coverage');
  });
});

function vector(overrides: Partial<DecisionVector> = {}): DecisionVector {
  return {
    phase: 'execution',
    governedAlgorithm: 'execution_quality_control',
    reversibility: 'reversible',
    sandboxTier: 'wasm',
    toolTrustTier: 'trusted',
    failureHistoryScore: 0,
    estimatedImpact: {
      fsScope: [],
      netReach: [],
      moneyUsd: 0,
    },
    remainingBudget: {
      tokens: 10_000,
      usd: 10,
      wallMs: 60_000,
    },
    loopCount: 0,
    newEvidencePresent: true,
    gateStatus: 'satisfied',
    algorithmCoverage: 'declared',
    toolCapRemaining: 1,
    ...overrides,
  };
}
