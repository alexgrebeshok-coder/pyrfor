// @vitest-environment node
/**
 * Block B + F: OpenClaw migration dry-run/import/quarantine/rollback + memory concurrency.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from '../artifact-model';
import {
  buildOpenClawMigrationReport,
  importOpenClawMigration,
  previewOpenClawMigration,
  rollbackOpenClawMigration,
} from '../openclaw-migration';
import type { MemoryWriteOptions } from '../../ai/memory/agent-memory-store';
import { createMemoryStore, type MemoryStore } from '../memory-store';

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
  DurableMemoryContradictionError,
  reviewDurableMemory,
  revokeImportedMemories,
  searchDurableMemoryForContext,
} from '../../ai/memory/agent-memory-store';

const roots: string[] = [];
const agentMemory = vi.mocked(prisma.agentMemory);

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'migration-dry-run-'));
  roots.push(root);
  const workspace = path.join(root, 'openclaw-workspace');
  await mkdir(path.join(workspace, 'memory', '.backups'), { recursive: true });
  await mkdir(path.join(workspace, 'skills'), { recursive: true });
  return workspace;
}

async function buildFakeOpenClawWorkspace(): Promise<string> {
  const sourcePath = await tempWorkspace();
  await writeFile(path.join(sourcePath, 'MEMORY.md'), 'token=secret\nRemember migration dry-run');
  await writeFile(path.join(sourcePath, 'AGENTS.md'), 'Agent operating rules');
  await writeFile(path.join(sourcePath, 'SOUL.md'), 'Soul and tone');
  await writeFile(path.join(sourcePath, 'memory', '2026-01-01.md'), 'Daily note content');
  await writeFile(path.join(sourcePath, 'skills', 'research.md'), 'Always cite sources');
  return sourcePath;
}

function row(
  id: string,
  workspaceId: string,
  projectId: string | null,
  memoryType: 'semantic' | 'episodic' | 'policy',
  content: string,
  metadata: Record<string, unknown>,
  summary?: string,
) {
  return {
    id,
    agentId: 'agent-1',
    workspaceId,
    projectId,
    memoryType,
    content,
    summary: summary ?? content.slice(0, 80),
    importance: 0.8,
    metadata: JSON.stringify(metadata),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('migration dry-run — Block B', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('buildOpenClawMigrationReport lists importable entries with redaction counts', async () => {
    const sourcePath = await buildFakeOpenClawWorkspace();
    const report = await buildOpenClawMigrationReport({}, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });

    expect(report.counts.importable).toBeGreaterThanOrEqual(4);
    expect(report.counts.redactions).toBeGreaterThanOrEqual(1);
    expect(report.entries.map((e) => e.sourceRelPath)).toEqual(
      expect.arrayContaining(['MEMORY.md', 'AGENTS.md', 'SOUL.md', 'memory/2026-01-01.md', 'skills/research.md']),
    );
  });

  it('dry-run report entries do not include import quarantine metadata', async () => {
    const sourcePath = await buildFakeOpenClawWorkspace();
    const report = await buildOpenClawMigrationReport({}, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    expect(JSON.stringify(report.entries)).not.toContain('imported_quarantined');
    expect(JSON.stringify(report.entries)).not.toContain('plannerEligible');
  });

  it('previewOpenClawMigration mirrors dry-run without quarantine metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'migration-preview-artifacts-'));
    roots.push(root);
    const sourcePath = await buildFakeOpenClawWorkspace();
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });

    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });

    expect(preview.report.counts.importable).toBeGreaterThan(0);
    expect(preview.artifact.sha256).toBeTruthy();
  });

  it('importOpenClawMigration attaches quarantine metadata on import', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'migration-import-artifacts-'));
    roots.push(root);
    const sourcePath = await buildFakeOpenClawWorkspace();
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const memoryWriter = vi.fn(async (_opts: MemoryWriteOptions) => 'memory-1');
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });

    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter,
    }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    expect(result.imported).toBeGreaterThan(0);
    for (const call of memoryWriter.mock.calls) {
      expect(call[0].metadata).toMatchObject({
        importState: 'imported_quarantined',
        approvalState: 'pending_approval',
        plannerEligible: false,
        migratedFrom: 'openclaw',
      });
      expect(call[0].metadata?.provenance).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'external' })]),
      );
    }
  });

  it('records provenance on every imported memory item', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'migration-provenance-artifacts-'));
    roots.push(root);
    const sourcePath = await buildFakeOpenClawWorkspace();
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    let id = 0;
    const memoryWriter = vi.fn(async () => `memory-${++id}`);
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    await importOpenClawMigration({ artifactStore, memoryWriter }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    expect(memoryWriter.mock.calls.every((call) => Array.isArray(call[0].metadata?.provenance))).toBe(true);
    expect(memoryWriter.mock.calls.every((call) => (call[0].metadata?.provenance?.length ?? 0) > 0)).toBe(true);
  });

  it('fail-closes approve when imported memory contradicts approved entry', async () => {
    agentMemory.findMany
      .mockResolvedValueOnce([
        row('imported-1', 'workspace-1', 'project-1', 'semantic', 'new policy text', {
          importState: 'imported_quarantined',
          approvalState: 'pending_approval',
          plannerEligible: false,
          importedFrom: 'openclaw',
          fingerprint: 'new-fp',
          sourceRelPath: 'MEMORY.md',
          scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
        }, 'Delivery policy'),
      ])
      .mockResolvedValueOnce([
        row('approved-1', 'workspace-1', 'project-1', 'semantic', 'existing approved', {
          importState: 'approved',
          approvalState: 'approved',
          plannerEligible: true,
          fingerprint: 'old-fp',
          sourceRelPath: 'MEMORY.md',
          scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
        }, 'Delivery policy'),
      ]);

    const error = await reviewDurableMemory({
      memoryId: 'imported-1',
      decision: 'approve',
      operatorId: 'operator',
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DurableMemoryContradictionError);
    expect(agentMemory.update).not.toHaveBeenCalled();
  });

  it('excludes quarantined imports from planner retrieval', async () => {
    agentMemory.findMany.mockResolvedValue([
      row('approved', 'workspace-1', 'project-1', 'semantic', 'approved memory', {
        importState: 'approved',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      row('quarantined', 'workspace-1', 'project-1', 'semantic', 'quarantined memory', {
        importState: 'imported_quarantined',
        plannerEligible: false,
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
    ]);

    const planner = await searchDurableMemoryForContext({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      query: 'memory',
      audience: 'planner',
    });

    expect(planner.map((e) => e.id)).toEqual(['approved']);
  });

  it('rollback tombstones imported memories via revokeImportedMemories', async () => {
    agentMemory.findMany.mockResolvedValue([
      row('memory-1', 'workspace-1', null, 'semantic', 'rollback me', {
        migratedFrom: 'openclaw',
        importState: 'imported_quarantined',
      }),
    ]);
    agentMemory.update.mockResolvedValue(row('memory-1', 'workspace-1', null, 'semantic', 'rollback me', {
      revoked: true,
      revokedAt: '2026-05-13T00:00:00.000Z',
    }));

    const result = await revokeImportedMemories({
      memoryIds: ['memory-1'],
      agentId: 'pyrfor-runtime',
      workspaceId: 'workspace-1',
      migratedFrom: 'openclaw',
      reason: 'rollback-test',
    });

    expect(result.revoked).toBe(1);
    expect(agentMemory.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.stringContaining('"revoked":true'),
      }),
    }));
  });

  it('re-import after rollback produces new memory ids', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'migration-reimport-artifacts-'));
    roots.push(root);
    const sourcePath = await buildFakeOpenClawWorkspace();
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    let seq = 0;
    const memoryWriter = vi.fn(async () => `memory-${++seq}`);
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const first = await importOpenClawMigration({ artifactStore, memoryWriter }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    await rollbackOpenClawMigration({
      artifactStore,
      memoryRevoker: vi.fn(async () => ({
        requested: first.memoryIds.length,
        matched: first.memoryIds.length,
        revoked: first.memoryIds.length,
        missingIds: [],
        skippedIds: [],
        alreadyRevokedIds: [],
      })),
    }, {
      resultArtifact: first.artifact,
      expectedResultSha256: first.artifact.sha256,
    });

    const preview2 = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const second = await importOpenClawMigration({ artifactStore, memoryWriter }, {
      reportArtifact: preview2.artifact,
      expectedReportSha256: preview2.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    const allIds = memoryWriter.mock.results.map((r) => (r as PromiseFulfilledResult<string>).value ?? '');
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(second.memoryIds.some((id) => !first.memoryIds.includes(id))).toBe(true);
  });
});

describe('migration dry-run — Block F concurrency', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = createMemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    try { store.close(); } catch { /* closed */ }
  });

  it('100 parallel memory-store adds produce distinct ids without loss', async () => {
    const entries = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() => store.add({
          kind: 'fact',
          text: `parallel entry ${i}`,
          source: 'test',
          scope: 'global',
          tags: [],
          weight: 0.5,
        })),
      ),
    );
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.size).toBe(100);
    expect(store.count()).toBe(100);
  });

  it('FTS search over 1000 rows completes within CI budget', async () => {
    if (process.env.CI === 'true' && process.env.SKIP_FTS_PERF === '1') {
      return;
    }
    for (let i = 0; i < 1000; i++) {
      store.add({
        kind: 'fact',
        text: `searchable reliability token ${i}`,
        source: 'test',
        scope: 'perf',
        tags: [],
        weight: 0.5,
      });
    }
    const start = performance.now();
    const results = store.search('reliability', { scope: 'perf', limit: 50 });
    const elapsed = performance.now() - start;
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(process.env.CI === 'true' ? 2000 : 1000);
  });

  it('500 sequential imports all carry provenance metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'migration-500-artifacts-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        writeFile(path.join(sourcePath, 'memory', `2026-entry-${i}.md`), `memory line ${i}`),
      ),
    );
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const memoryWriter = vi.fn(async () => `mem-${Math.random()}`);
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      includeMemories: true,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({ artifactStore, memoryWriter }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });
    expect(result.imported).toBe(500);
    expect(memoryWriter.mock.calls).toHaveLength(500);
    expect(memoryWriter.mock.calls.every((c) => (c[0].metadata?.provenance?.length ?? 0) > 0)).toBe(true);
  });

  it('quarantine approve/reject race leaves one consistent final state', async () => {
    agentMemory.findMany.mockResolvedValue([
      row('race-1', 'workspace-1', null, 'semantic', 'race memory', {
        importState: 'imported_quarantined',
        plannerEligible: false,
        approvalState: 'pending_approval',
        scope: { visibility: 'workspace', workspaceId: 'workspace-1' },
      }),
    ]);
    agentMemory.update
      .mockResolvedValueOnce(row('race-1', 'workspace-1', null, 'semantic', 'race memory', {
        approvalState: 'approved',
        plannerEligible: true,
      }))
      .mockResolvedValueOnce(row('race-1', 'workspace-1', null, 'semantic', 'race memory', {
        approvalState: 'rejected',
        plannerEligible: false,
      }));

    const [approveResult, rejectResult] = await Promise.allSettled([
      reviewDurableMemory({
        memoryId: 'race-1',
        decision: 'approve',
        operatorId: 'op-a',
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
      }),
      reviewDurableMemory({
        memoryId: 'race-1',
        decision: 'reject',
        operatorId: 'op-b',
        reason: 'reject race',
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
      }),
    ]);

    const fulfilled = [approveResult, rejectResult].filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    if (fulfilled.length === 2) {
      const states = fulfilled.map((r) =>
        (r as PromiseFulfilledResult<{ metadata?: { approvalState?: string } }>).value.metadata?.approvalState,
      );
      expect(new Set(states).size).toBe(1);
    }
  });
});
