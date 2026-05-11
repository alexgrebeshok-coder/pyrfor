import { createHash } from 'node:crypto';
import type { DagNode } from '../durable-dag';

export type GrandfatherableGate =
  | 'algorithm_declared'
  | 'decision_record_required'
  | 'completion_gate_presence'
  | 'feedback_contract_presence'
  | 'phase_algorithm_mapping_inferred'
  | 'lesson_sink_required';

export type NeverGrandfatheredGate =
  | 'unsafe_intent_block'
  | 'declared_effects_enforcement'
  | 'sandbox_tier_assignment'
  | 'taint_scan'
  | 'prompt_injection_scan'
  | 'approval_for_policy_change'
  | 'approval_for_budget_change'
  | 'kill_switch';

export const NEVER_GRANDFATHERED_GATES: readonly NeverGrandfatheredGate[] = [
  'unsafe_intent_block',
  'declared_effects_enforcement',
  'sandbox_tier_assignment',
  'taint_scan',
  'prompt_injection_scan',
  'approval_for_policy_change',
  'approval_for_budget_change',
  'kill_switch',
];

export interface LegacyEligibilityProof {
  nodeHash: string;
  baselineTag: string;
  baselineCommit: string;
  baselineManifestArtifactRef: string;
  firstSeenEventId: string;
  firstSeenAt: string;
}

export interface LegacyBaselineManifest {
  baselineTag: string;
  baselineCommit: string;
  baselineManifestArtifactRef: string;
  nodeHashes: string[];
}

export interface GrandfatheringScope {
  bypasses: GrandfatherableGate[];
  neverBypassed: readonly NeverGrandfatheredGate[];
  blocksDoubleLoopParticipation: true;
  blocksSystemSelfImprovementParticipation: true;
  emittedLessonProvenance: 'legacy';
  allowsGovernanceProposalEmission: false;
}

export interface LegacyNodeAuditReport {
  id: string;
  periodStart: string;
  periodEnd: string;
  baselineTag: string;
  generatedAt: string;
  totalGrandfatheredNodes: number;
  activeGrandfatheredNodes: number;
  byPhase: Record<string, number>;
  byBypassedGate: Record<GrandfatherableGate, number>;
  neverGrandfatheredViolations: Array<{
    nodeId: string;
    nodeHash: string;
    gate: NeverGrandfatheredGate;
    eventRef?: string;
  }>;
  highRiskNodes: Array<{
    nodeId: string;
    nodeHash: string;
    phase: string;
    bypasses: GrandfatherableGate[];
    sideEffectCount: number;
    lastSeenAt: string;
  }>;
  legacyLessonsEmitted: number;
  governanceProposalsSuppressed: number;
  migrationCandidates: Array<{
    nodeId: string;
    nodeHash: string;
    recommendedActions: string[];
    priority: 'low' | 'medium' | 'high';
  }>;
}

export function createDefaultGrandfatheringScope(bypasses: GrandfatherableGate[]): GrandfatheringScope {
  return {
    bypasses,
    neverBypassed: NEVER_GRANDFATHERED_GATES,
    blocksDoubleLoopParticipation: true,
    blocksSystemSelfImprovementParticipation: true,
    emittedLessonProvenance: 'legacy',
    allowsGovernanceProposalEmission: false,
  };
}

export function generateLegacyNodeAuditReport(input: {
  nodes: DagNode[];
  baselineManifest: LegacyBaselineManifest;
  periodStart: string;
  periodEnd: string;
  generatedAt?: string;
}): LegacyNodeAuditReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const baselineHashes = new Set(input.baselineManifest.nodeHashes);
  const grandfathered = input.nodes.filter((node) => node.payload['algorithmCoverage'] === 'grandfathered');
  const byPhase: Record<string, number> = {};
  const byBypassedGate = Object.create(null) as Record<GrandfatherableGate, number>;
  const neverGrandfatheredViolations: LegacyNodeAuditReport['neverGrandfatheredViolations'] = [];
  const highRiskNodes: LegacyNodeAuditReport['highRiskNodes'] = [];
  const migrationCandidates: LegacyNodeAuditReport['migrationCandidates'] = [];
  let legacyLessonsEmitted = 0;
  let governanceProposalsSuppressed = 0;

  for (const node of grandfathered) {
    const nodeHash = nodeHashForAudit(node);
    const phase = stringPayload(node, 'phase') ?? stringPayload(node, 'engine_phase') ?? 'unknown';
    byPhase[phase] = (byPhase[phase] ?? 0) + 1;
    const bypasses = grandfatheringBypasses(node);
    for (const gate of bypasses) byBypassedGate[gate] = (byBypassedGate[gate] ?? 0) + 1;

    if (!baselineHashes.has(nodeHash)) {
      neverGrandfatheredViolations.push({
        nodeId: node.id,
        nodeHash,
        gate: 'unsafe_intent_block',
        eventRef: stringPayload(node, 'firstSeenEventId'),
      });
    }

    if (numberPayload(node, 'sideEffectCount') > 0 || bypasses.length > 2) {
      highRiskNodes.push({
        nodeId: node.id,
        nodeHash,
        phase,
        bypasses,
        sideEffectCount: numberPayload(node, 'sideEffectCount'),
        lastSeenAt: new Date(node.updatedAt).toISOString(),
      });
    }

    if (node.payload['lessonProvenance'] === 'legacy') legacyLessonsEmitted += 1;
    if (node.payload['suppressedGovernanceProposal'] === true) governanceProposalsSuppressed += 1;
    migrationCandidates.push({
      nodeId: node.id,
      nodeHash,
      recommendedActions: [
        'declare governedByAlgorithm',
        'attach completionGate',
        'attach feedbackContract',
        'create canonical DecisionRecord',
      ],
      priority: bypasses.length > 2 ? 'high' : 'medium',
    });
  }

  return {
    id: createHash('sha256')
      .update(`${input.baselineManifest.baselineTag}:${input.periodStart}:${input.periodEnd}:${grandfathered.length}`)
      .digest('hex')
      .slice(0, 24),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    baselineTag: input.baselineManifest.baselineTag,
    generatedAt,
    totalGrandfatheredNodes: grandfathered.length,
    activeGrandfatheredNodes: grandfathered.filter((node) => node.status !== 'succeeded' && node.status !== 'cancelled').length,
    byPhase,
    byBypassedGate,
    neverGrandfatheredViolations,
    highRiskNodes,
    legacyLessonsEmitted,
    governanceProposalsSuppressed,
    migrationCandidates,
  };
}

function grandfatheringBypasses(node: DagNode): GrandfatherableGate[] {
  const raw = node.payload['grandfatheringScope'];
  if (!isRecord(raw) || !Array.isArray(raw['bypasses'])) return [];
  return raw['bypasses'].filter((item): item is GrandfatherableGate => typeof item === 'string' && isGrandfatherableGate(item));
}

function isGrandfatherableGate(value: string): value is GrandfatherableGate {
  return [
    'algorithm_declared',
    'decision_record_required',
    'completion_gate_presence',
    'feedback_contract_presence',
    'phase_algorithm_mapping_inferred',
    'lesson_sink_required',
  ].includes(value);
}

function nodeHashForAudit(node: DagNode): string {
  const configured = stringPayload(node, 'nodeHash');
  if (configured) return configured;
  return createHash('sha256').update(JSON.stringify({
    id: node.id,
    kind: node.kind,
    idempotencyKey: node.idempotencyKey,
  })).digest('hex');
}

function stringPayload(node: DagNode, key: string): string | undefined {
  const value = node.payload[key];
  return typeof value === 'string' ? value : undefined;
}

function numberPayload(node: DagNode, key: string): number {
  const value = node.payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
