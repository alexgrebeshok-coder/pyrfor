import type { ArtifactStore } from '../artifact-model';
import type { MemoryStore } from '../memory-store';
import type { TokenBudgetController } from '../token-budget-controller';
import type { ExperienceEntry, ExperienceLibrary } from './experience-library';
export interface PatternMinerDeps {
    experienceLibrary: ExperienceLibrary;
    memoryStore: MemoryStore;
    artifactStore: ArtifactStore;
    budgetController?: TokenBudgetController;
    clock?: () => number;
}
export interface PatternMinerRunInput {
    runId: string;
    conceptId: string;
    conceptKind: 'meta.improvement';
    projectId: string;
    domain?: string;
    maxExperienceEntries?: number;
    maxProposals?: number;
    holdoutRatio?: number;
    minTrainingSupport?: number;
    minHoldoutSupport?: number;
    estimatedTokens?: number;
    estimatedCostUsd?: number;
}
export interface PatternMinerCandidate {
    patternKey: string;
    support: number;
    holdoutSupport: number;
    evidenceEntryIds: string[];
    holdoutEntryIds: string[];
    averageVerifierScore: number;
    averageAcceptancePassRate: number;
    toolSignatures: string[];
    domain?: string;
}
export interface PatternMinerRunResult {
    scanned: number;
    trainingCount: number;
    holdoutCount: number;
    candidates: PatternMinerCandidate[];
    candidateEntryIds: string[];
    proposalArtifactIds: string[];
    budgetBlocked: boolean;
}
export declare class PatternMinerValidationError extends Error {
    constructor(message: string);
}
export declare function splitExperienceHoldout(entries: ExperienceEntry[], holdoutRatio?: number): {
    training: ExperienceEntry[];
    holdout: ExperienceEntry[];
};
export declare class PatternMiner {
    private readonly deps;
    constructor(deps: PatternMinerDeps);
    run(input: PatternMinerRunInput): Promise<PatternMinerRunResult>;
    private writeCandidate;
    private doubleLoopRecord;
    private hasExistingCandidate;
    private nowMs;
    private nowIso;
}
//# sourceMappingURL=pattern-miner.d.ts.map