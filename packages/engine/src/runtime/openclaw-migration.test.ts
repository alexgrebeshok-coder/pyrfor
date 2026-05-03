// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from './artifact-model';
import { buildOpenClawMigrationReport, importOpenClawMigration, previewOpenClawMigration } from './openclaw-migration';
import type { MemoryWriteOptions } from '../ai/memory/agent-memory-store';

const roots: string[] = [];

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openclaw-migration-'));
  roots.push(root);
  const workspace = path.join(root, 'openclaw-workspace');
  await mkdir(path.join(workspace, 'memory', '.backups'), { recursive: true });
  await mkdir(path.join(workspace, 'skills'), { recursive: true });
  return workspace;
}

describe('openclaw migration', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('builds allowlisted dry-run report with redaction and skips unsafe files', async () => {
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'IDENTITY.md'), 'OpenClaw identity');
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'token=super-secret-token\nRemember migration');
    await writeFile(path.join(sourcePath, 'memory', '2026-01-01.md'), 'Daily note');
    await writeFile(path.join(sourcePath, 'memory', 'state.sqlite'), 'sqlite');
    await writeFile(path.join(sourcePath, 'memory', '.backups', 'old.md'), 'old');
    await writeFile(path.join(sourcePath, 'skills', 'research.md'), 'Always cite sources');

    const report = await buildOpenClawMigrationReport({}, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });

    expect(report.counts.importable).toBe(4);
    expect(report.counts.personality).toBe(2);
    expect(report.counts.memories).toBe(1);
    expect(report.counts.skills).toBe(1);
    expect(report.counts.redactions).toBe(1);
    expect(report.entries.map((entry) => entry.sourceRelPath).sort()).toEqual([
      'IDENTITY.md',
      'MEMORY.md',
      'memory/2026-01-01.md',
      'skills/research.md',
    ]);
    expect(report.skipped.map((entry) => entry.sourceRelPath)).toContain('memory/state.sqlite');
    expect(report.skipped.map((entry) => entry.sourceRelPath)).toContain('memory/.backups');
  });

  it('writes preview report and imports hash-bound durable memories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-artifacts-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Remember governed delivery');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    let memoryId = 0;
    const memoryWriter = vi.fn(async (_options: MemoryWriteOptions) => `memory-${++memoryId}`);

    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter,
    }, {
      report: preview.report,
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    expect(result.imported).toBe(1);
    expect(result.memoryIds).toEqual(['memory-1']);
    expect(memoryWriter).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'pyrfor-runtime',
      workspaceId: 'workspace-1',
      memoryType: 'semantic',
      content: 'Remember governed delivery',
    }));
    expect(memoryWriter.mock.calls[0]?.[0].metadata).toMatchObject({
      migratedFrom: 'openclaw',
      sourceRelPath: 'MEMORY.md',
      scope: { visibility: 'workspace', workspaceId: 'workspace-1' },
    });
  });

  it('does not import symlinked root personality files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openclaw-migration-symlink-'));
    roots.push(root);
    const sourcePath = path.join(root, 'openclaw-workspace');
    await mkdir(sourcePath, { recursive: true });
    await writeFile(path.join(root, 'outside.txt'), 'TOP-SECRET-OUTSIDE');
    await symlink(path.join(root, 'outside.txt'), path.join(sourcePath, 'MEMORY.md'));

    const report = await buildOpenClawMigrationReport({}, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });

    expect(report.entries).toHaveLength(0);
  });

  it('rejects arbitrary non-canonical source roots by default', async () => {
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Should not import from arbitrary roots');

    await expect(buildOpenClawMigrationReport({}, {
      workspaceId: 'workspace-1',
      sourcePath,
    })).rejects.toThrow('not an allowed workspace root');
  });

  it('rejects a symlinked OpenClaw source root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openclaw-migration-root-symlink-'));
    roots.push(root);
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'MEMORY.md'), 'TOP-SECRET-OUTSIDE');
    const sourcePath = path.join(root, 'openclaw-workspace');
    await symlink(outside, sourcePath);

    await expect(buildOpenClawMigrationReport({}, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    })).rejects.toThrow('not a directory');
  });

  it('imports the verified artifact report instead of caller supplied report payload', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-hash-binding-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'memory', '2026-01-01.md'), 'Remember original report');
    await writeFile(path.join(sourcePath, 'IDENTITY.md'), 'Injected identity');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      includePersonality: false,
      includeMemories: true,
      allowNonCanonicalSourceRoot: true,
    });
    const suppliedReport = {
      ...preview.report,
      entries: [
        ...preview.report.entries,
        {
          sourceRelPath: 'IDENTITY.md',
          sourceKind: 'personality' as const,
          memoryType: 'policy' as const,
          fingerprint: 'not-the-reviewed-fingerprint',
          bytes: 17,
          mtime: new Date().toISOString(),
          summary: 'Injected identity',
          redactionCount: 0,
        },
      ],
    };
    const memoryWriter = vi.fn(async () => 'memory-1');

    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter,
    }, {
      report: suppliedReport,
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    expect(result.imported).toBe(1);
    expect(memoryWriter).toHaveBeenCalledWith(expect.objectContaining({ content: 'Remember original report' }));
  });

  it('rejects non-canonical report artifacts during public import', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-noncanonical-report-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Should not import from arbitrary roots');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });

    await expect(importOpenClawMigration({
      artifactStore,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
    })).rejects.toThrow('not an allowed workspace root');
  });

  it('fails closed when memory persistence is not durable', async () => {
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Remember governed delivery');
    const report = await buildOpenClawMigrationReport({}, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });

    await expect(importOpenClawMigration({
      artifactStore: new ArtifactStore({ rootDir: path.join(path.dirname(sourcePath), 'artifacts') }),
      memoryWriter: vi.fn(async () => 'short-term-only'),
    }, {
      report,
      allowNonCanonicalSourceRoot: true,
    })).rejects.toThrow('durably persisted');
  });
});
