import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../memory-store';
import { createConceptStore } from './concept-store';

describe('ConceptStore', () => {
  it('upserts a concept and retrieves it by id', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const conceptStore = createConceptStore(memoryStore);

    const entry = conceptStore.upsert('c1', 'Use short PRs', 'strategic_planning');
    const results = conceptStore.get('c1');

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(entry.id);
    expect(results[0]?.tags).toEqual(expect.arrayContaining(['concept', 'c1', 'strategic_planning']));
    memoryStore.close();
  });

  it('records a concept link as a reference entry', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const conceptStore = createConceptStore(memoryStore);

    conceptStore.upsert('c1', 'concept A');
    conceptStore.upsert('c2', 'concept B');
    conceptStore.link({
      fromConceptId: 'c1',
      toConceptId: 'c2',
      relationKind: 'reinforces',
      evidenceRef: 'artifact-1',
      weight: 0.8,
    });

    const results = conceptStore.get('c1');
    expect(results.some((entry) => entry.kind === 'reference')).toBe(true);
    expect(results.some((entry) => entry.tags.includes('reinforces'))).toBe(true);
    memoryStore.close();
  });

  it('FTS-searches across concept text only', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const conceptStore = createConceptStore(memoryStore);

    conceptStore.upsert('c3', 'backtracking reduces wasted tokens');
    memoryStore.add({
      kind: 'fact',
      text: 'backtracking but not a concept',
      source: 'manual',
      scope: 'other',
      tags: ['other'],
      weight: 0.5,
    });

    const hits = conceptStore.search('backtracking');
    expect(hits.length).toBe(1);
    expect(hits[0]?.scope).toBe('concept:c3');
    memoryStore.close();
  });
});
