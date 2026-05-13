import { describe, expect, it } from 'vitest';
import type { DagNode } from '../durable-dag';
import {
  createDefaultGrandfatheringScope,
  assertLegacyEligibility,
  generateLegacyNodeAuditReport,
  materializeLegacyBaselineManifest,
  NEVER_GRANDFATHERED_GATES,
  type GrandfatherableGate,
  type LegacyBaselineManifest,
} from './legacy-node-auditor';

describe('legacy-node-auditor', () => {
  it('materializes a deterministic baseline manifest from node hashes', () => {
    const nodes = [
      node({ id: 'b', payload: { nodeHash: 'hash-b' } }),
      node({ id: 'a', payload: { nodeHash: 'hash-a' } }),
      node({ id: 'duplicate', payload: { nodeHash: 'hash-a' } }),
    ];

    expect(materializeLegacyBaselineManifest({
      baselineTag: 'ue-governance-baseline-m1',
      baselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      resolvedBaselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      baselineManifestArtifactRef: 'artifact-baseline',
      nodes,
    })).toEqual({
      baselineTag: 'ue-governance-baseline-m1',
      baselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      baselineManifestArtifactRef: 'artifact-baseline',
      nodeHashes: ['hash-a', 'hash-b'],
    });
  });

  it('creates an empty manifest for the pre-M1 commit with no legacy nodes', () => {
    const manifest = materializeLegacyBaselineManifest({
      baselineTag: 'ue-governance-baseline-m1',
      baselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      resolvedBaselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      baselineManifestArtifactRef: 'artifact-baseline',
      nodes: [],
    });

    expect(manifest.nodeHashes).toEqual([]);
  });

  it('audits grandfathered nodes whose hashes are in the baseline manifest', () => {
    const report = generateLegacyNodeAuditReport({
      nodes: [legacyNode({ payload: { nodeHash: 'hash-1', phase: 'execution' } })],
      baselineManifest: manifest(['hash-1']),
      periodStart: '1970-01-01T00:00:00.000Z',
      periodEnd: '1970-01-02T00:00:00.000Z',
      generatedAt: '1970-01-02T00:00:00.000Z',
    });

    expect(report.totalGrandfatheredNodes).toBe(1);
    expect(report.neverGrandfatheredViolations).toEqual([]);
    expect(report.byPhase).toEqual({ execution: 1 });
  });

  it('flags grandfathered nodes outside the baseline manifest as safety violations', () => {
    const report = generateLegacyNodeAuditReport({
      nodes: [legacyNode({ payload: { nodeHash: 'unknown-hash', firstSeenEventId: 'event-1' } })],
      baselineManifest: manifest(['hash-1']),
      periodStart: '1970-01-01T00:00:00.000Z',
      periodEnd: '1970-01-02T00:00:00.000Z',
      generatedAt: '1970-01-02T00:00:00.000Z',
    });

    expect(report.neverGrandfatheredViolations).toEqual([{
      nodeId: 'node-1',
      nodeHash: 'unknown-hash',
      gate: 'unsafe_intent_block',
      eventRef: 'event-1',
    }]);
  });

  it('keeps never-grandfathered gates fixed in the default grandfathering scope', () => {
    const scope = createDefaultGrandfatheringScope(['algorithm_declared']);

    expect(scope.bypasses).toEqual(['algorithm_declared']);
    expect(scope.neverBypassed).toEqual(NEVER_GRANDFATHERED_GATES);
    expect(scope.blocksDoubleLoopParticipation).toBe(true);
    expect(scope.allowsGovernanceProposalEmission).toBe(false);
  });

  it('tracks high-risk and migration metadata for active legacy nodes', () => {
    const bypasses: GrandfatherableGate[] = ['algorithm_declared', 'decision_record_required', 'completion_gate_presence'];
    const report = generateLegacyNodeAuditReport({
      nodes: [legacyNode({
        payload: {
          nodeHash: 'hash-1',
          phase: 'planning',
          grandfatheringScope: { bypasses },
          sideEffectCount: 2,
          lessonProvenance: 'legacy',
          suppressedGovernanceProposal: true,
        },
      })],
      baselineManifest: manifest(['hash-1']),
      periodStart: '1970-01-01T00:00:00.000Z',
      periodEnd: '1970-01-02T00:00:00.000Z',
      generatedAt: '1970-01-02T00:00:00.000Z',
    });

    expect(report.byBypassedGate).toMatchObject({
      algorithm_declared: 1,
      decision_record_required: 1,
      completion_gate_presence: 1,
    });
    expect(report.highRiskNodes).toHaveLength(1);
    expect(report.legacyLessonsEmitted).toBe(1);
    expect(report.governanceProposalsSuppressed).toBe(1);
    expect(report.migrationCandidates[0]?.priority).toBe('high');
  });

  it('rejects baseline manifests whose tag target does not match the declared commit', () => {
    expect(() => materializeLegacyBaselineManifest({
      baselineTag: 'ue-governance-baseline-m1',
      baselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      resolvedBaselineCommit: '131ab64b0d000000000000000000000000000000',
      baselineManifestArtifactRef: 'artifact-baseline',
      nodes: [],
    })).toThrow(/resolves to/);
  });

  it('rejects malformed baseline commit identifiers', () => {
    expect(() => materializeLegacyBaselineManifest({
      baselineTag: 'ue-governance-baseline-m1',
      baselineCommit: '084ae02',
      resolvedBaselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      baselineManifestArtifactRef: 'artifact-baseline',
      nodes: [],
    })).toThrow(/baselineCommit must be a full 40-character git commit SHA/);

    expect(() => materializeLegacyBaselineManifest({
      baselineTag: 'ue-governance-baseline-m1',
      baselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
      resolvedBaselineCommit: '',
      baselineManifestArtifactRef: 'artifact-baseline',
      nodes: [],
    })).toThrow(/resolvedBaselineCommit must be a full 40-character git commit SHA/);
  });

  it('creates an eligibility proof only for nodes in the baseline manifest', () => {
    const proof = assertLegacyEligibility({
      node: legacyNode({ payload: { nodeHash: 'hash-1' } }),
      baselineManifest: manifest(['hash-1']),
      firstSeenEventId: 'event-1',
      firstSeenAt: '1970-01-01T00:00:00.000Z',
    });

    expect(proof).toMatchObject({
      nodeHash: 'hash-1',
      baselineTag: 'ue-governance-baseline-m1',
      baselineManifestArtifactRef: 'artifact-baseline',
      firstSeenEventId: 'event-1',
    });
    expect(() => assertLegacyEligibility({
      node: legacyNode({ payload: { nodeHash: 'outside' } }),
      baselineManifest: manifest(['hash-1']),
      firstSeenEventId: 'event-2',
      firstSeenAt: '1970-01-01T00:00:00.000Z',
    })).toThrow(/outside baseline manifest/);
  });

  it('propagates malformed legacy node timestamps instead of misclassifying eligibility', () => {
    expect(() => generateLegacyNodeAuditReport({
      nodes: [legacyNode({ createdAt: Number.NaN, payload: { nodeHash: 'hash-1' } })],
      baselineManifest: manifest(['hash-1']),
      periodStart: '1970-01-01T00:00:00.000Z',
      periodEnd: '1970-01-02T00:00:00.000Z',
      generatedAt: '1970-01-02T00:00:00.000Z',
    })).toThrow(/Invalid time value/);
  });
});

function manifest(nodeHashes: string[]): LegacyBaselineManifest {
  return {
    baselineTag: 'ue-governance-baseline-m1',
    baselineCommit: '084ae02dad8d6c05b58f8c77fcd78b36f72c428f',
    baselineManifestArtifactRef: 'artifact-baseline',
    nodeHashes,
  };
}

function legacyNode(overrides: Partial<DagNode> = {}): DagNode {
  return node({
    ...overrides,
    payload: {
      algorithmCoverage: 'grandfathered',
      nodeHash: 'hash-1',
      grandfatheringScope: { bypasses: ['algorithm_declared'] },
      ...overrides.payload,
    },
  });
}

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
