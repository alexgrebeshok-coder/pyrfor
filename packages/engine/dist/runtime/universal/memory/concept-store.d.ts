import type { MemoryEntry, MemoryStore } from '../../memory-store';
import type { GovernedAlgorithm } from '../completion-gate-engine';
export type ConceptRelationKind = 'reinforces' | 'contradicts' | 'depends_on' | 'supersedes';
export interface ConceptLink {
    fromConceptId: string;
    toConceptId: string;
    relationKind: ConceptRelationKind;
    algorithm?: GovernedAlgorithm;
    evidenceRef: string;
    weight: number;
}
export interface ConceptStore {
    upsert(conceptId: string, text: string, algorithm?: GovernedAlgorithm): MemoryEntry;
    link(link: ConceptLink): MemoryEntry;
    get(conceptId: string): MemoryEntry[];
    search(text: string, limit?: number): MemoryEntry[];
}
export declare function createConceptStore(memoryStore: MemoryStore): ConceptStore;
export declare function conceptScope(conceptId: string): string;
//# sourceMappingURL=concept-store.d.ts.map