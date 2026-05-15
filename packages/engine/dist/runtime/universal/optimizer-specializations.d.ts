import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { MemoryStore } from '../memory-store';
import type { DoubleLoopRecord } from './memory/types';
export type OptimizerSpecialization = 'prompt_engineer' | 'tool_smith' | 'skill_architect' | 'strategy_planner';
export type OptimizerAlgorithm = 'failure_correction' | 'prompt_optimization';
export type NeverEditableByOptimizer = 'verifier_rules' | 'sandbox_tier' | 'taint_scanners' | 'prompt_injection_gate' | 'kill_switch' | 'approval_thresholds' | 'budget_approval_rules' | 'effect_gateway_allowlists' | 'never_grandfathered_gate' | 'meta_critic_auto_apply_rules';
export declare const OPTIMIZER_SPECIALIZATIONS: readonly OptimizerSpecialization[];
export declare const NEVER_EDITABLE_BY_OPTIMIZER: readonly NeverEditableByOptimizer[];
export interface OptimizerProposalInput {
    runId: string;
    conceptId: string;
    conceptKind: 'meta.improvement';
    projectId: string;
    specialization: OptimizerSpecialization;
    algorithm: OptimizerAlgorithm;
    targetKey: string;
    currentBehavior: string;
    proposedBehavior: string;
    rationale: string;
    rollbackPlan: string;
    evidenceArtifactIds: string[];
    domain?: string;
    toolSignatures?: string[];
}
export interface OptimizerProposalResult {
    entryId: string;
    reportRef: ArtifactRef;
    proposalRef: ArtifactRef;
    record: DoubleLoopRecord;
}
export declare class OptimizerSpecializationError extends Error {
    constructor(message: string);
}
export declare class OptimizerSpecializationRunner {
    private readonly deps;
    constructor(deps: {
        memoryStore: MemoryStore;
        artifactStore: ArtifactStore;
        clock?: () => number;
    });
    propose(input: OptimizerProposalInput): Promise<OptimizerProposalResult>;
    private doubleLoopRecord;
    private nowIso;
}
export declare function assertOptimizerTargetEditable(targetKey: string): void;
//# sourceMappingURL=optimizer-specializations.d.ts.map