import type { DagNode } from '../durable-dag';
export type GrandfatherableGate = 'algorithm_declared' | 'decision_record_required' | 'completion_gate_presence' | 'feedback_contract_presence' | 'phase_algorithm_mapping_inferred' | 'lesson_sink_required';
export type NeverGrandfatheredGate = 'unsafe_intent_block' | 'declared_effects_enforcement' | 'sandbox_tier_assignment' | 'taint_scan' | 'prompt_injection_scan' | 'approval_for_policy_change' | 'approval_for_budget_change' | 'kill_switch';
export declare const NEVER_GRANDFATHERED_GATES: readonly NeverGrandfatheredGate[];
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
export interface LegacyBaselineManifestInput {
    baselineTag: string;
    baselineCommit: string;
    resolvedBaselineCommit: string;
    baselineManifestArtifactRef: string;
    nodes: DagNode[];
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
export declare function createDefaultGrandfatheringScope(bypasses: GrandfatherableGate[]): GrandfatheringScope;
export declare function materializeLegacyBaselineManifest(input: LegacyBaselineManifestInput): LegacyBaselineManifest;
export declare function assertLegacyEligibility(input: {
    node: DagNode;
    baselineManifest: LegacyBaselineManifest;
    firstSeenEventId: string;
    firstSeenAt: string;
}): LegacyEligibilityProof;
export declare function generateLegacyNodeAuditReport(input: {
    nodes: DagNode[];
    baselineManifest: LegacyBaselineManifest;
    periodStart: string;
    periodEnd: string;
    generatedAt?: string;
}): LegacyNodeAuditReport;
//# sourceMappingURL=legacy-node-auditor.d.ts.map