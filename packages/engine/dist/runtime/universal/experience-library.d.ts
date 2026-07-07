import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { MemoryEntry, MemoryStore } from '../memory-store';
export type ExperienceProjectionVersion = 'pyrfor.experience.v1';
export type ExperienceOutcome = 'completed' | 'failed' | 'cancelled' | 'blocked';
export type ExperienceAudience = 'planner' | 'audit' | 'operator';
export type ExperienceRetrievalBackend = 'fts' | 'embedding';
export type ExperienceEmbedder = (texts: string[]) => Promise<number[][]> | number[][];
export interface ExperienceProvenance {
    sourceRunId: string;
    conceptId?: string;
    parentConceptId?: string;
    retryOf?: string;
    memoryEntryIds: string[];
    artifactIds: string[];
}
export interface ExperienceEntry {
    id: string;
    runId: string;
    conceptId?: string;
    projectId: string;
    schemaVersion: ExperienceProjectionVersion;
    approvalState: 'approved' | 'quarantined' | 'rejected';
    legacy: boolean;
    quarantined: boolean;
    provenance: ExperienceProvenance;
    retrievalKey: {
        fts: string;
        goalKeywords: string[];
        toolSignatures: string[];
    };
    domain?: string;
    outcome: ExperienceOutcome;
    whatWorked: string[];
    whatFailed: string[];
    reusablePatterns: string[];
    durationMs?: number;
    toolCallCount?: number;
    costUsd?: number;
    verifierScore?: number;
    acceptanceTestPassRate?: number;
    wasPatternApplied: boolean;
    patternEffectiveness?: number;
    createdAt: string;
    indexedAt: string;
    sourceMemory: MemoryEntry;
    sourceArtifacts: ArtifactRef[];
}
export interface ExperienceQuery {
    goal?: string;
    projectId: string;
    domain?: string;
    toolSignatures?: string[];
    minVerifierScore?: number;
    outcome?: ExperienceOutcome;
    limit?: number;
    includeFailed?: boolean;
    audience: ExperienceAudience;
    retrievalBackend?: ExperienceRetrievalBackend;
}
export interface ExperienceLibrary {
    query(q: ExperienceQuery): Promise<ExperienceEntry[]>;
    queryForPlanner(q: Omit<ExperienceQuery, 'audience'>): Promise<ExperienceEntry[]>;
    findSimilar(q: {
        goal: string;
        projectId: string;
        limit: number;
    }): Promise<ExperienceEntry[]>;
    getPatternEffectiveness(patternKey: string): Promise<number>;
    getTopPatterns(domain: string, limit: number): Promise<PatternStat[]>;
}
export interface PatternStat {
    patternKey: string;
    occurrences: number;
    averageEffectiveness: number;
    evidenceEntryIds: string[];
}
export interface ExperienceLibraryOptions {
    memoryStore: MemoryStore;
    artifactStore?: ArtifactStore;
    embeddings?: {
        enabled: boolean;
        embedder?: ExperienceEmbedder;
        minScore?: number;
        onFallback?: (reason: string, error?: unknown) => void;
    };
    now?: () => Date;
}
export declare function createExperienceLibrary(options: ExperienceLibraryOptions): ExperienceLibrary;
export declare class ExperienceLibraryError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=experience-library.d.ts.map