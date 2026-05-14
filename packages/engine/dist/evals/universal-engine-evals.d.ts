import type { ArtifactRef } from '../runtime/artifact-model.js';
import type { LedgerEvent } from '../runtime/event-ledger.js';
export type UniversalEngineCriterionKind = 'required_event_sequence' | 'terminal_concept_event' | 'no_artifact_uri_leak' | 'delivery_artifacts_have_hashes' | 'human_tier_self_improvement' | 'promotions_have_eval_proof';
export interface UniversalEngineEvalTrace {
    conceptId: string;
    runId: string;
    events: LedgerEvent[];
    artifactRefs: Array<Pick<ArtifactRef, 'id' | 'kind' | 'sha256'> & {
        uri?: string;
    }>;
}
export interface UniversalEngineEvalCriterion {
    kind: UniversalEngineCriterionKind;
    weight?: number;
    params?: Record<string, unknown>;
}
export interface UniversalEngineEvalCase {
    id: string;
    criteria: UniversalEngineEvalCriterion[];
}
export interface UniversalEngineCriterionScore {
    criterion: UniversalEngineEvalCriterion;
    passed: boolean;
    score: number;
    reason: string;
}
export interface UniversalEngineCaseScore {
    caseId: string;
    totalScore: number;
    maxScore: number;
    ratio: number;
    passed: boolean;
    criterionScores: UniversalEngineCriterionScore[];
}
export interface UniversalEngineEvalReport {
    totalCases: number;
    passedCases: number;
    averageRatio: number;
    scores: UniversalEngineCaseScore[];
}
export declare const DEFAULT_UNIVERSAL_ENGINE_EVAL_CASES: UniversalEngineEvalCase[];
export declare function runUniversalEngineEvals(trace: UniversalEngineEvalTrace, cases?: UniversalEngineEvalCase[]): UniversalEngineEvalReport;
export declare function scoreUniversalEngineCriterion(criterion: UniversalEngineEvalCriterion, trace: UniversalEngineEvalTrace): UniversalEngineCriterionScore;
//# sourceMappingURL=universal-engine-evals.d.ts.map