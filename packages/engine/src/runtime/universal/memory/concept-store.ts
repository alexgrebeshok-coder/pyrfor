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

export function createConceptStore(memoryStore: MemoryStore): ConceptStore {
  function upsert(conceptId: string, text: string, algorithm?: GovernedAlgorithm): MemoryEntry {
    const scope = conceptScope(conceptId);
    const existing = memoryStore.query({
      scope,
      kind: 'fact',
      tags: ['concept', conceptId],
      limit: 1,
    })[0];
    const tags = ['concept', conceptId, ...(algorithm ? [algorithm] : [])];
    if (existing) {
      const updated = memoryStore.update(existing.id, {
        text,
        tags,
        weight: Math.max(existing.weight, 0.7),
      });
      if (!updated) throw new Error(`ConceptStore: failed to update concept "${conceptId}"`);
      return updated;
    }
    return memoryStore.add({
      kind: 'fact',
      text,
      source: `concept:${conceptId}`,
      scope,
      tags,
      weight: 0.7,
    });
  }

  function link(input: ConceptLink): MemoryEntry {
    return memoryStore.add({
      kind: 'reference',
      text: JSON.stringify({
        fromConceptId: input.fromConceptId,
        toConceptId: input.toConceptId,
        relationKind: input.relationKind,
        algorithm: input.algorithm,
        evidenceRef: input.evidenceRef,
      }),
      source: input.evidenceRef,
      scope: conceptScope(input.fromConceptId),
      tags: [
        'concept_link',
        input.fromConceptId,
        input.toConceptId,
        input.relationKind,
        ...(input.algorithm ? [input.algorithm] : []),
      ],
      weight: clampWeight(input.weight),
    });
  }

  function get(conceptId: string): MemoryEntry[] {
    return memoryStore.query({
      scope: conceptScope(conceptId),
      kind: ['fact', 'reference'],
      tags: [conceptId],
      limit: 100,
    });
  }

  function search(text: string, limit = 20): MemoryEntry[] {
    return memoryStore.search(text, { limit })
      .filter((entry) => entry.tags.includes('concept') || entry.tags.includes('concept_link'))
      .slice(0, limit);
  }

  return { upsert, link, get, search };
}

export function conceptScope(conceptId: string): string {
  return `concept:${conceptId}`;
}

function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0.5;
  return Math.max(0, Math.min(1, weight));
}
