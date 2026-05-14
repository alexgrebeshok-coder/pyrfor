import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { ConceptRecord } from './engine-loop';
export interface MemoryWriteRecommendation {
    kind: 'episode' | 'strategy' | 'tool_result';
    summary: string;
    evidenceRef: string;
}
export interface RunPostMortem {
    schemaVersion: 'pyrfor.postmortem.v1';
    runId: string;
    conceptId: string;
    goal: string;
    outcome: 'completed' | 'failed' | 'cancelled' | 'blocked';
    summary: string;
    whatWorked: string[];
    whatFailed: string[];
    toolsUsed: string[];
    toolsForged: string[];
    verifierFindings: string[];
    reusablePatterns: string[];
    memoryWriteRecommendations: MemoryWriteRecommendation[];
    createdAt: string;
    phaseArtifactRefs: string[];
    deliveryBundleRef?: string;
    error?: string;
}
export interface PostMortemDeps {
    artifactStore: ArtifactStore;
    ledger: EventLedger;
    clock?: () => number;
}
export interface PostMortemInput {
    conceptRecord: ConceptRecord;
    outcome: RunPostMortem['outcome'];
    summary: string;
    whatWorked?: string[];
    whatFailed?: string[];
    toolsUsed?: string[];
    toolsForged?: string[];
    verifierFindings?: string[];
    reusablePatterns?: string[];
    memoryWriteRecommendations?: MemoryWriteRecommendation[];
    deliveryBundleRef?: string;
}
export declare class PostMortemError extends Error {
    constructor(message: string);
}
export declare function buildPostMortem(input: PostMortemInput, clock?: () => number): RunPostMortem;
export declare function runPostMortem(input: PostMortemInput, deps: PostMortemDeps): Promise<ArtifactRef>;
//# sourceMappingURL=postmortem.d.ts.map