import { describe, expect, it } from 'vitest';
import { buildMermaidTrace } from '../panels/concept-trace-view';
import type { ConceptRecord } from '../universal-api';

describe('buildMermaidTrace', () => {
  it('renders concept phases and recent SSE events as a Mermaid graph', () => {
    const concept: ConceptRecord = {
      conceptId: 'concept-1',
      goal: 'Build universal thing',
      runId: 'run-1',
      status: 'executing',
      phases: ['plan', 'execute', 'done'],
      currentPhase: 'execute',
      createdAt: '1970-01-01T00:00:00.000Z',
    };

    const graph = buildMermaidTrace(concept, [{ type: 'concept.started' }, { type: 'concept.completed' }]);

    expect(graph).toContain('graph TD');
    expect(graph).toContain('concept-1');
    expect(graph).toContain('execute (current)');
    expect(graph).toContain('concept.started');
    expect(graph).toContain('concept.completed');
  });
});
