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
import {
  buildMemoryContext,
  recallShortTerm,
  reviewDurableMemory,
  revokeImportedMemories,
  searchDurableMemoryForContext,
  searchMemory,
  storeShortTerm,
} from './agent-memory-store';

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

  it('exposes quarantined imports to audit search but excludes them from planner retrieval', async () => {
    agentMemory.findMany.mockResolvedValue([
      row('approved', 'workspace-1', 'project-1', 'semantic', 'approved query memory', {
        importState: 'approved',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      row('imported', 'workspace-1', 'project-1', 'semantic', 'imported query memory', {
        importState: 'imported_quarantined',
        plannerEligible: false,
        approvalState: 'pending_approval',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      row('legacy', 'workspace-1', 'project-1', 'semantic', 'legacy query memory', {
        importState: 'legacy',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
    ]);

    const auditResults = await searchDurableMemoryForContext({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      query: 'query',
      limit: 10,
      audience: 'audit',
    });
    const plannerResults = await searchDurableMemoryForContext({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      query: 'query',
      limit: 10,
      audience: 'planner',
    });

    expect(auditResults.map((entry) => entry.id).sort()).toEqual(['approved', 'imported', 'legacy']);
    expect(plannerResults.map((entry) => entry.id)).toEqual(['approved']);
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

  it('keeps hot short-term corrections available to planner context while blocking quarantined durable imports', async () => {
    storeShortTerm('agent-1', 'operator correction unique-planner-query note', { workspaceId: 'workspace-1', projectId: 'project-1', importance: 1 });
    agentMemory.findMany.mockResolvedValue([
      row('imported', 'workspace-1', 'project-1', 'semantic', 'imported unique-planner-query memory', {
        importState: 'imported_quarantined',
        approvalState: 'pending_approval',
        plannerEligible: false,
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      row('approved', 'workspace-1', 'project-1', 'semantic', 'approved unique-planner-query memory', {
        importState: 'approved',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
    ]);

    const context = await buildMemoryContext('agent-1', 'unique-planner-query', {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      limit: 5,
    });

    expect(context).toContain('operator correction unique-planner-query note');
    expect(context).toContain('approved unique-planner-query memory');
    expect(context).not.toContain('imported unique-planner-query memory');
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

  it('approves quarantined imported memory and makes it planner-eligible', async () => {
    agentMemory.findMany.mockResolvedValueOnce([
      row('imported-1', 'workspace-1', 'project-1', 'semantic', 'imported memory content', {
        importState: 'imported_quarantined',
        approvalState: 'pending_approval',
        plannerEligible: false,
        importedFrom: 'openclaw',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
    ]);
    agentMemory.update.mockResolvedValueOnce(row('imported-1', 'workspace-1', 'project-1', 'semantic', 'imported memory content', {
      importState: 'approved',
      approvalState: 'approved',
      plannerEligible: true,
      importedFrom: 'openclaw',
      reviewedBy: 'token:operator-a',
      reviewDecision: 'approve',
      scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
    }));

    const result = await reviewDurableMemory({
      memoryId: 'imported-1',
      decision: 'approve',
      operatorId: 'token:operator-a',
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
    });

    expect(result.metadata).toMatchObject({
      importState: 'approved',
      approvalState: 'approved',
      plannerEligible: true,
      reviewedBy: 'token:operator-a',
      reviewDecision: 'approve',
    });
    expect(agentMemory.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'imported-1' },
      data: expect.objectContaining({
        metadata: expect.stringContaining('"plannerEligible":true'),
      }),
    }));
  });

  it('rejects pending operator correction without rewriting it as imported memory', async () => {
    agentMemory.findMany.mockResolvedValueOnce([
      row('correction-1', 'workspace-1', null, 'semantic', 'corrected memory content', {
        approvalState: 'pending_approval',
        plannerEligible: false,
        correctionKind: 'operator',
        scope: { visibility: 'workspace', workspaceId: 'workspace-1' },
      }),
    ]);
    agentMemory.update.mockResolvedValueOnce(row('correction-1', 'workspace-1', null, 'semantic', 'corrected memory content', {
      approvalState: 'rejected',
      plannerEligible: false,
      correctionKind: 'operator',
      reviewedBy: 'operator',
      reviewDecision: 'reject',
      reviewReason: 'conflicts with approved fact',
      scope: { visibility: 'workspace', workspaceId: 'workspace-1' },
    }));

    const result = await reviewDurableMemory({
      memoryId: 'correction-1',
      decision: 'reject',
      operatorId: 'operator',
      reason: 'conflicts with approved fact',
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
    });

    expect(result.metadata).toMatchObject({
      approvalState: 'rejected',
      plannerEligible: false,
      correctionKind: 'operator',
      reviewDecision: 'reject',
      reviewReason: 'conflicts with approved fact',
    });
    expect(result.metadata?.importState).toBeUndefined();
  });

  it('rejects review for memories that are no longer pending approval', async () => {
    agentMemory.findMany.mockResolvedValueOnce([
      row('approved-1', 'workspace-1', null, 'semantic', 'approved memory content', {
        approvalState: 'approved',
        plannerEligible: true,
        scope: { visibility: 'workspace', workspaceId: 'workspace-1' },
      }),
    ]);

    await expect(reviewDurableMemory({
      memoryId: 'approved-1',
      decision: 'reject',
      operatorId: 'operator',
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
    })).rejects.toThrow('Memory review target is not pending approval');
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
