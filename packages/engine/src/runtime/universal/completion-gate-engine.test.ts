import { describe, expect, it } from 'vitest';
import type { DagNode } from '../durable-dag';
import { evaluateCompletionGate } from './completion-gate-engine';

describe('evaluateCompletionGate legacy enforcement', () => {
  it('terminally blocks grandfathered nodes from never-grandfathered gates', () => {
    const result = evaluateCompletionGate({
      runId: 'run-1',
      gateId: 'prompt_injection_scan',
      node: node({ payload: { algorithmCoverage: 'grandfathered' } }),
      provenance: [],
    });

    expect(result).toMatchObject({
      disposition: 'block_terminal',
      gateDisposition: 'failed_terminal',
      gateId: 'prompt_injection_scan',
      reason: 'grandfathered legacy node cannot bypass gate: prompt_injection_scan',
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'governance.gate.checked',
      'governance.gate.violation',
    ]);
    expect(result.events[1]).toMatchObject({
      violation_code: 'never_grandfathered_gate',
      retryable: false,
      blocked_completion: true,
    });
  });

  it('keeps never-grandfathered blocks terminal even for duplicate evidence snapshots', () => {
    const first = evaluateCompletionGate({
      runId: 'run-1',
      gateId: 'prompt_injection_scan',
      node: node({ payload: { algorithmCoverage: 'grandfathered' } }),
      provenance: [],
    });
    const second = evaluateCompletionGate({
      runId: 'run-1',
      gateId: 'prompt_injection_scan',
      node: node({ payload: { algorithmCoverage: 'grandfathered' } }),
      previousEvidenceSnapshotHash: first.evidenceSnapshot.evidenceSnapshotHash,
      provenance: [],
    });

    expect(second).toMatchObject({
      disposition: 'block_terminal',
      gateDisposition: 'failed_terminal',
      reason: 'grandfathered legacy node cannot bypass gate: prompt_injection_scan',
    });
    expect(second.events[1]).toMatchObject({
      violation_code: 'never_grandfathered_gate',
      retryable: false,
      blocked_completion: true,
    });
  });

  it('does not block declared nodes on never-grandfathered gate names', () => {
    const result = evaluateCompletionGate({
      runId: 'run-1',
      gateId: 'prompt_injection_scan',
      node: node({ payload: { algorithmCoverage: 'declared' } }),
      provenance: [],
    });

    expect(result.disposition).toBe('allow_complete');
  });
});

function node(overrides: Partial<DagNode> = {}): DagNode {
  return {
    id: 'node-1',
    kind: 'task',
    payload: {},
    status: 'running',
    dependsOn: [],
    idempotencyKey: 'idem-1',
    retryClass: 'none',
    timeoutClass: 'short',
    compensation: { kind: 'none' },
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
    provenance: [],
    ...overrides,
    payload: {
      ...overrides.payload,
    },
  };
}
