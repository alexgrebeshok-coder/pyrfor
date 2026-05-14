import type { GateArtifactRequirement, GovernedAlgorithm } from './completion-gate-engine';
import type { DoubleLoopRecord, SingleLoopRecord } from './memory/types';
export type AlgorithmCoverage = 'declared' | 'inferred' | 'grandfathered';
export interface CompletionGateContract {
    gateId: string;
    gateKind: 'admission' | 'completion';
    requiredArtifacts: GateArtifactRequirement[];
    successCriteria: string[];
    failureArtifact: string;
    onMissingArtifacts: 'block' | 'escalate' | 'postmortem';
}
export interface FeedbackLoopContract {
    maxLoops: number;
    requiresNewEvidence: boolean;
    escalationTriggers: string[];
    stopArtifactKind: string;
}
export interface FeedbackStopReport {
    loopId: string;
    actualLoops: number;
    stopReason: 'max_loops' | 'escalation_trigger' | 'completion_gate_failed' | 'budget_exhausted';
    triggeredBy?: string;
    evidenceRefs: string[];
}
export interface AlgorithmicGovernanceContract {
    governedByAlgorithm: GovernedAlgorithm;
    checkpointPolicy: {
        requiredArtifacts: string[];
        maxLoops: number;
        escalationTriggers: string[];
    };
    completionGate: CompletionGateContract;
    feedbackContract: FeedbackLoopContract;
    decisionRecordRequired: boolean;
    completionCriteria: string[];
    feedbackPolicy: {
        onFailure: 'retry' | 'replan' | 'forge_tool' | 'escalate' | 'block';
        requiresNewEvidence: boolean;
    };
    budgetProfile: {
        tokens?: number;
        usd?: number;
        wallMs?: number;
        sideEffectTier?: 'none' | 'fs' | 'net_allowlist' | 'host';
    };
    bottleneckHypothesis?: string;
    lessonSink?: {
        writeLessons: boolean;
        lessonKind: 'run' | 'tool' | 'policy' | 'strategy';
    };
    algorithmCoverage?: AlgorithmCoverage;
}
export interface DecisionVector {
    phase: string;
    governedAlgorithm: GovernedAlgorithm;
    reversibility: 'reversible' | 'partial' | 'irreversible';
    sandboxTier: string;
    toolTrustTier: string;
    failureHistoryScore: number;
    estimatedImpact: {
        fsScope: string[];
        netReach: string[];
        moneyUsd: number;
    };
    remainingBudget: {
        tokens?: number;
        usd?: number;
        wallMs?: number;
    };
    loopCount: number;
    newEvidencePresent: boolean;
    gateStatus: 'satisfied' | 'partial' | 'failed';
    algorithmCoverage: AlgorithmCoverage;
    toolCapRemaining: number;
}
export interface UniversalEngineDecisionRecord {
    nodeId: string;
    nodeHash: string;
    algorithm: GovernedAlgorithm;
    alternativesConsidered: string[];
    selectedAlternative: string;
    selectedToolVersion?: string;
    rationale: string;
    evidenceRefs: string[];
    risksAccepted: string[];
    budgetImpact: {
        estimatedTokens?: number;
        estimatedUsd?: number;
        estimatedWallMs?: number;
    };
    decisionVectorRef?: string;
    lessonsConsidered?: Array<{
        lessonId: string;
        lessonSnapshotHash: string;
        disposition: 'followed' | 'adapted' | 'rejected_as_not_applicable' | 'overridden';
        changedSelectedAlternative: boolean;
        impactSummary: string;
    }>;
    timestamp: string;
    author: 'system' | `agent:${string}` | 'human';
}
export interface LessonsLearnedArtifact {
    scope: 'tool' | 'run' | 'policy' | 'strategy';
    whatWorked: string[];
    whatFailed: string[];
    rootCause: 'spec_gap' | 'tool_gap' | 'execution_bug' | 'test_gap' | 'verifier_disagreement' | 'budget_or_tier' | 'external_dependency';
    strategyDelta?: string;
    toolDelta?: string;
    policyProposal?: string;
    evidenceRefs: string[];
    confidence: 'low' | 'medium' | 'high';
    algorithmOutcome?: 'improved' | 'neutral' | 'worsened' | 'success' | 'partial' | 'failed_to_meet_criteria';
    derivedRecords?: Array<SingleLoopRecord | DoubleLoopRecord>;
}
//# sourceMappingURL=types.d.ts.map