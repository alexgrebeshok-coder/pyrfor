// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../prisma', () => ({
  prisma: {
    agentMemory: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

import { prisma } from '../../prisma';
import { recallShortTerm, revokeImportedMemories, searchDurableMemoryForContext, searchMemory, storeShortTerm } from './agent-memory-store';

const agentMemory = vi.mocked(prisma.agentMemory);

describe('searchDurableMemoryForContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns durable scoped memory only and excludes short-term recall', async () => {
    storeShortTerm('agent-1', 'short term leak query', { workspaceId: 'workspace-1', importance: 1 });
    agentMemory.findMany.mockResolvedValue([
      row('global', null, null, 'semantic', 'global query memory', { scope: { visibility: 'global' } }),
      row('workspace', 'workspace-1', null, 'semantic', 'workspace query memory', { scope: { visibility: 'workspace', workspaceId: 'workspace-1' } }),
      row('project', 'workspace-1', 'project-1', 'semantic', 'project query memory', { scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' } }),
      row('other-project', 'workspace-1', 'project-2', 'semantic', 'other project query memory', { scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-2' } }),
      row('revoked', 'workspace-1', 'project-1', 'semantic', 'revoked query memory', { revoked: true, scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' } }),
    ]);

    const results = await searchDurableMemoryForContext({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      query: 'query',
      memoryType: 'semantic',
      limit: 10,
    });

    expect(results.map((entry) => entry.id).sort()).toEqual(['global', 'project', 'workspace']);
    expect(results.map((entry) => entry.content).join('\n')).not.toContain('short term leak');
    expect(agentMemory.updateMany).toHaveBeenCalled();
  });

  it('filters project memory categories after scope filtering', async () => {
    agentMemory.findMany.mockResolvedValue([
      row('decision', 'workspace-1', 'project-1', 'semantic', 'decision query memory', {
        projectMemoryCategory: 'decision',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      row('risk', 'workspace-1', 'project-1', 'semantic', 'risk query memory', {
        projectMemoryCategory: 'risk',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
    ]);

    const results = await searchDurableMemoryForContext({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      query: 'query',
      projectMemoryCategories: ['risk'],
      limit: 10,
    });

    expect(results.map((entry) => entry.id)).toEqual(['risk']);
  });

  it('requires workspace match for project-scoped durable memories', async () => {
    agentMemory.findMany.mockResolvedValue([
      row('workspace-a-project', 'workspace-a', 'alpha', 'semantic', 'alpha query memory', {
        scope: { visibility: 'project', workspaceId: 'workspace-a', projectId: 'alpha' },
      }),
      row('workspace-b-project', 'workspace-b', 'alpha', 'semantic', 'alpha query memory in correct workspace', {
        scope: { visibility: 'project', workspaceId: 'workspace-b', projectId: 'alpha' },
      }),
    ]);

    const results = await searchDurableMemoryForContext({
      agentId: 'agent-1',
      workspaceId: 'workspace-b',
      projectId: 'alpha',
      query: 'query',
      limit: 10,
    });

    expect(results.map((entry) => entry.id)).toEqual(['workspace-b-project']);
  });

  it('keeps short-term project memories isolated by projectId', async () => {
    storeShortTerm('agent-1', 'project a query memory', { workspaceId: 'workspace-1', projectId: 'project-a', importance: 1 });
    storeShortTerm('agent-1', 'project b query memory', { workspaceId: 'workspace-1', projectId: 'project-b', importance: 1 });
    agentMemory.findMany.mockRejectedValue(new Error('db unavailable'));

    const results = await searchMemory({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-b',
      query: 'query',
      limit: 10,
    });
    expect(results.map((entry) => entry.content)).toEqual(['project b query memory']);
  });

  it('excludes revoked durable memories from regular memory search', async () => {
    agentMemory.findMany.mockResolvedValue([
      row('active', 'workspace-1', null, 'semantic', 'active unique-durable-token memory', { scope: { visibility: 'workspace', workspaceId: 'workspace-1' } }),
      row('revoked', 'workspace-1', null, 'semantic', 'revoked unique-durable-token memory', { revoked: true, scope: { visibility: 'workspace', workspaceId: 'workspace-1' } }),
    ]);

    const results = await searchMemory({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      query: 'unique-durable-token',
      limit: 10,
    });

    expect(results.map((entry) => entry.id)).toEqual(['active']);
  });

  it('revokes only matching imported OpenClaw memories without touching short-term copies', async () => {
    storeShortTerm('agent-1', 'openclaw memory content', { workspaceId: 'workspace-1', projectId: 'project-1', importance: 1 });
    agentMemory.findMany.mockResolvedValue([
      row('openclaw-1', 'workspace-1', 'project-1', 'semantic', 'openclaw memory content', {
        migratedFrom: 'openclaw',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      row('manual-1', 'workspace-1', 'project-1', 'semantic', 'manual memory content', {
        migratedFrom: 'manual',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      row('already-1', 'workspace-1', 'project-1', 'semantic', 'already revoked content', {
        migratedFrom: 'openclaw',
        revoked: true,
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
    ]);
    agentMemory.update.mockResolvedValue(row('openclaw-1', 'workspace-1', 'project-1', 'semantic', 'openclaw memory content', {
      migratedFrom: 'openclaw',
      revoked: true,
    }));

    const result = await revokeImportedMemories({
      memoryIds: ['openclaw-1', 'manual-1', 'already-1', 'missing-1', 'openclaw-1'],
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      migratedFrom: 'openclaw',
      reason: 'rollback-test',
      revokedAt: new Date('2026-05-13T00:00:00.000Z'),
    });

    expect(result).toEqual({
      requested: 4,
      matched: 3,
      revoked: 1,
      missingIds: ['missing-1'],
      skippedIds: ['manual-1'],
      alreadyRevokedIds: ['already-1'],
    });
    expect(agentMemory.update).toHaveBeenCalledWith({
      where: { id: 'openclaw-1' },
      data: {
        metadata: JSON.stringify({
          migratedFrom: 'openclaw',
          scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
          revoked: true,
          revokedAt: '2026-05-13T00:00:00.000Z',
          revokedReason: 'rollback-test',
        }),
      },
    });
    expect(recallShortTerm('agent-1', 'openclaw', { workspaceId: 'workspace-1', projectId: 'project-1' })).toEqual(['openclaw memory content']);
  });
});

function row(
  id: string,
  workspaceId: string | null,
  projectId: string | null,
  memoryType: string,
  content: string,
  metadata: Record<string, unknown>,
) {
  return {
    id,
    agentId: 'agent-1',
    workspaceId,
    projectId,
    memoryType,
    content,
    summary: content,
    metadata: JSON.stringify(metadata),
    importance: 0.8,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    expiresAt: null,
    accessCount: 0,
    lastAccessedAt: null,
    embeddingJson: null,
  };
}
