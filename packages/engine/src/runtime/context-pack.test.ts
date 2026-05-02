// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { hashContextPack, stableStringify, withContextPackHash } from './context-pack';

describe('context-pack', () => {
  it('stableStringify canonicalizes object key order', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('returns the same hash for the same canonical pack input', () => {
    const pack = {
      schemaVersion: 'context_pack.v1' as const,
      packId: 'ctx:run-1',
      compiledAt: '2026-05-01T00:00:00.000Z',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      task: { title: 'Build feature' },
      sections: [
        {
          id: 'task_contract',
          kind: 'task_contract' as const,
          title: 'Task contract',
          priority: 10,
          content: { title: 'Build feature' },
          sources: [{ kind: 'task' as const, ref: 'task-1', role: 'input' as const }],
        },
      ],
      sourceRefs: [{ kind: 'task' as const, ref: 'task-1', role: 'input' as const }],
    };

    expect(hashContextPack(pack)).toBe(hashContextPack({ ...pack }));
    expect(withContextPackHash(pack).hash).toHaveLength(64);
  });

  it('changes hash when included context changes', () => {
    const base = {
      schemaVersion: 'context_pack.v1' as const,
      packId: 'ctx:run-1',
      compiledAt: '2026-05-01T00:00:00.000Z',
      workspaceId: 'workspace-1',
      task: { title: 'Build feature' },
      sections: [],
      sourceRefs: [],
    };

    expect(hashContextPack(base)).not.toBe(
      hashContextPack({ ...base, task: { title: 'Build other feature' } }),
    );
  });
});
