// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from './artifact-model';
import {
  buildOpenClawMigrationAudit,
  buildOpenClawMigrationQuarantine,
  buildOpenClawMigrationReport,
  importOpenClawMigration,
  previewOpenClawMigration,
  rollbackOpenClawMigration,
  verifyOpenClawMigration,
} from './openclaw-migration';
import type { MemoryWriteOptions } from '../ai/memory/agent-memory-store';
import { createToolRegistry } from './universal/tool-registry';

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
    expect(result.schemaVersion).toBe('openclaw_migration_result.v1');
    expect(result.migrationId).toMatch(/^openclaw-/);
    expect(result.importedEntries).toEqual([expect.objectContaining({
      sourceRelPath: 'MEMORY.md',
      fingerprint: preview.report.entries[0]?.fingerprint,
      memoryId: 'memory-1',
    })]);
    expect(result.importedToolEntries).toEqual([]);
    expect(result.skippedToolEntries).toEqual([]);
    expect(result.rollbackPlan).toMatchObject({
      status: 'prepared_not_executed',
      action: 'revoke_imported_memories',
      memoryIds: ['memory-1'],
    });
    const artifactDocument = await artifactStore.readJSON<{
      migrationId: string;
      importedEntries: Array<{ sourceRelPath: string; memoryId: string }>;
      rollbackPlan: { memoryIds: string[] };
    }>(result.artifact);
    expect(artifactDocument.migrationId).toBe(result.migrationId);
    expect(artifactDocument.importedEntries).toEqual([{ sourceRelPath: 'MEMORY.md', sourceKind: 'personality', memoryType: 'semantic', fingerprint: preview.report.entries[0]?.fingerprint, memoryId: 'memory-1' }]);
    expect(artifactDocument.rollbackPlan.memoryIds).toEqual(['memory-1']);
    expect(memoryWriter).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'pyrfor-runtime',
      workspaceId: 'workspace-1',
      memoryType: 'semantic',
      content: 'Remember governed delivery',
      skipShortTerm: true,
    }));
    expect(memoryWriter.mock.calls[0]?.[0].metadata).toMatchObject({
      migratedFrom: 'openclaw',
      importState: 'imported_quarantined',
      approvalState: 'pending_approval',
      plannerEligible: false,
      importedFrom: 'openclaw',
      sourceRelPath: 'MEMORY.md',
      scope: { visibility: 'workspace', workspaceId: 'workspace-1' },
    });
  });

  it('bridges valid migrated skills into governed registry and reports invalid skill docs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-skill-bridge-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await mkdir(path.join(sourcePath, 'skills', 'governed'), { recursive: true });
    await writeFile(path.join(sourcePath, 'skills', 'research.md'), 'Keep evidence linked to sources');
    await writeFile(path.join(sourcePath, 'skills', 'governed', 'SKILL.md'), [
      '---',
      'name: Research Helper',
      'description: Gather governed evidence',
      'trigger: research, evidence',
      '---',
      'Use careful evidence gathering.',
    ].join('\n'));
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const toolRegistry = createToolRegistry(path.join(root, 'registry'));
    let memoryId = 0;

    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      toolRegistry,
      memoryWriter: vi.fn(async () => `memory-${++memoryId}`),
    }, {
      report: preview.report,
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    expect(result.imported).toBe(2);
    expect(result.importedToolEntries).toEqual([expect.objectContaining({
      sourceRelPath: 'skills/governed/SKILL.md',
      toolName: 'skill:research-helper',
      status: 'pending_validation',
      duplicate: false,
    })]);
    expect(result.skippedToolEntries).toEqual([{
      sourceRelPath: 'skills/research.md',
      reason: 'invalid_skill_md',
    }]);
    expect(toolRegistry.get(result.importedToolEntries[0]!.toolId)).toMatchObject({
      name: 'skill:research-helper',
      kind: 'skill',
      status: 'pending_validation',
      tags: expect.arrayContaining(['skill-import', 'state:quarantined']),
    });
    const artifactDocument = await artifactStore.readJSON<{
      importedToolEntries: Array<{ sourceRelPath: string; toolName: string; status: string; duplicate: boolean }>;
      skippedToolEntries: Array<{ sourceRelPath: string; reason: string }>;
    }>(result.artifact);
    expect(artifactDocument.importedToolEntries).toEqual([expect.objectContaining({
      sourceRelPath: 'skills/governed/SKILL.md',
      toolName: 'skill:research-helper',
      status: 'pending_validation',
      duplicate: false,
    })]);
    expect(artifactDocument.skippedToolEntries).toEqual([{
      sourceRelPath: 'skills/research.md',
      reason: 'invalid_skill_md',
    }]);
  });

  it('auto-tests imported governed skills when requested', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-skill-finalize-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await mkdir(path.join(sourcePath, 'skills', 'governed'), { recursive: true });
    await writeFile(path.join(sourcePath, 'skills', 'governed', 'SKILL.md'), [
      '---',
      'name: Research Helper',
      'description: Gather governed evidence',
      'trigger: research, evidence',
      '---',
      'Use careful evidence gathering.',
    ].join('\n'));
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const toolRegistry = createToolRegistry(path.join(root, 'registry'));

    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      toolRegistry,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      report: preview.report,
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      autoTestSkills: true,
      allowNonCanonicalSourceRoot: true,
    });

    expect(result.skillFinalizationSummary).toEqual({
      autoTestSkills: true,
      autoApproveSkills: false,
      tested: 1,
      passed: 1,
      approved: 0,
      testFailed: 0,
      approvalFailed: 0,
    });
    expect(result.importedToolEntries).toEqual([expect.objectContaining({
      sourceRelPath: 'skills/governed/SKILL.md',
      status: 'pending_validation',
      finalization: expect.objectContaining({
        testAttempted: true,
        testPassed: true,
        approvalAttempted: false,
        finalStatus: 'pending_validation',
        failureScore: 0,
        testResultArtifactId: expect.any(String),
      }),
    })]);
    expect(toolRegistry.get(result.importedToolEntries[0]!.toolId)).toMatchObject({
      status: 'pending_validation',
      lastTestResultArtifactId: result.importedToolEntries[0]!.finalization!.testResultArtifactId,
      failureScore: 0,
    });
  });

  it('auto-approves imported governed skills after passing validation when requested', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-skill-approve-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await mkdir(path.join(sourcePath, 'skills', 'governed'), { recursive: true });
    await writeFile(path.join(sourcePath, 'skills', 'governed', 'SKILL.md'), [
      '---',
      'name: Deploy Helper',
      'description: Package governed releases',
      'trigger: deploy, release',
      '---',
      'Prepare governed release notes.',
    ].join('\n'));
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const toolRegistry = createToolRegistry(path.join(root, 'registry'));

    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      toolRegistry,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      report: preview.report,
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      autoApproveSkills: true,
      allowNonCanonicalSourceRoot: true,
    });

    expect(result.skillFinalizationSummary).toEqual({
      autoTestSkills: true,
      autoApproveSkills: true,
      tested: 1,
      passed: 1,
      approved: 1,
      testFailed: 0,
      approvalFailed: 0,
    });
    expect(result.importedToolEntries).toEqual([expect.objectContaining({
      sourceRelPath: 'skills/governed/SKILL.md',
      status: 'vetted',
      finalization: expect.objectContaining({
        testAttempted: true,
        testPassed: true,
        approvalAttempted: true,
        approvalGranted: true,
        finalStatus: 'vetted',
      }),
    })]);
    expect(toolRegistry.get(result.importedToolEntries[0]!.toolId)).toMatchObject({
      status: 'vetted',
      tags: expect.arrayContaining(['state:vetted']),
      failureScore: 0,
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

  it('records fingerprint mismatches in the import manifest without writing memory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-fingerprint-mismatch-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Original memory');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Changed after preview');
    const memoryWriter = vi.fn(async () => 'memory-1');

    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter,
    }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedEntries).toEqual([{
      sourceRelPath: 'MEMORY.md',
      fingerprint: preview.report.entries[0]?.fingerprint,
      reason: 'fingerprint_mismatch',
    }]);
    expect(result.rollbackPlan.memoryIds).toEqual([]);
    expect(memoryWriter).not.toHaveBeenCalled();
  });

  it('rolls back a hash-bound import result by revoking imported OpenClaw memories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-rollback-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Rollback candidate');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });
    const memoryRevoker = vi.fn(async () => ({
      requested: 1,
      matched: 1,
      revoked: 1,
      missingIds: [],
      skippedIds: [],
      alreadyRevokedIds: [],
    }));

    const rollback = await rollbackOpenClawMigration({
      artifactStore,
      memoryRevoker,
      now: () => new Date('2026-05-13T12:00:00.000Z'),
    }, {
      resultArtifact: result.artifact,
      expectedResultSha256: result.artifact.sha256,
    });

    expect(memoryRevoker).toHaveBeenCalledWith({
      memoryIds: ['memory-1'],
      agentId: 'pyrfor-runtime',
      workspaceId: 'workspace-1',
      migratedFrom: 'openclaw',
      reason: `openclaw_migration_rollback:${result.migrationId}`,
      revokedAt: new Date('2026-05-13T12:00:00.000Z'),
    });
    expect(rollback).toMatchObject({
      schemaVersion: 'openclaw_migration_rollback_result.v1',
      migrationId: result.migrationId,
      workspaceId: 'workspace-1',
      rolledBackAt: '2026-05-13T12:00:00.000Z',
      requested: 1,
      matched: 1,
      revoked: 1,
    });
    const rollbackDocument = await artifactStore.readJSON<{ migrationId: string; workspaceId: string; revoked: number }>(rollback.artifact);
    expect(rollbackDocument).toMatchObject({ migrationId: result.migrationId, workspaceId: 'workspace-1', revoked: 1 });
  });

  it('verifies imported memories are retrievable through memory search', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-verify-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Verification candidate');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });
    const memorySearcher = vi.fn(async () => [{
      id: 'memory-1',
      agentId: 'pyrfor-runtime',
      workspaceId: 'workspace-1',
      memoryType: 'semantic' as const,
      content: 'Verification candidate',
      summary: 'MEMORY.md: Verification candidate',
      importance: 0.8,
      createdAt: new Date('2026-05-13T12:00:00.000Z'),
    }]);

    const verification = await verifyOpenClawMigration({
      artifactStore,
      memorySearcher,
      now: () => new Date('2026-05-13T12:30:00.000Z'),
    }, {
      resultArtifact: result.artifact,
      expectedResultSha256: result.artifact.sha256,
      queryLimit: 5,
    });

    expect(memorySearcher).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'pyrfor-runtime',
      workspaceId: 'workspace-1',
      memoryType: 'semantic',
      query: 'MEMORY.md',
      limit: 5,
    }));
    expect(verification).toMatchObject({
      schemaVersion: 'openclaw_migration_verification_result.v1',
      migrationId: result.migrationId,
      verifiedAt: '2026-05-13T12:30:00.000Z',
      totalMemories: 1,
      foundCount: 1,
      missCount: 0,
      searchAttemptsFailed: 0,
      entries: [expect.objectContaining({ memoryId: 'memory-1', foundInResults: true })],
    });
    expect(JSON.stringify(verification.entries)).not.toContain('fingerprint');
    const document = await artifactStore.readJSON<{ migrationId: string; foundCount: number }>(verification.artifact);
    expect(document).toMatchObject({ migrationId: result.migrationId, foundCount: 1 });
    expect(JSON.stringify(document)).not.toContain('fingerprint');
  });

  it('records verification misses and search failures without throwing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-verify-miss-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Verification miss candidate');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });

    const missed = await verifyOpenClawMigration({
      artifactStore,
      memorySearcher: vi.fn(async () => []),
    }, {
      resultArtifact: result.artifact,
      expectedResultSha256: result.artifact.sha256,
    });
    expect(missed).toMatchObject({ foundCount: 0, missCount: 1, searchAttemptsFailed: 0 });

    const failed = await verifyOpenClawMigration({
      artifactStore,
      memorySearcher: vi.fn(async () => { throw new Error('search unavailable'); }),
    }, {
      resultArtifact: result.artifact,
      expectedResultSha256: result.artifact.sha256,
    });
    expect(failed).toMatchObject({
      foundCount: 0,
      missCount: 1,
      searchAttemptsFailed: 1,
      entries: [expect.objectContaining({ searchFailed: true, error: 'search unavailable' })],
    });
  });

  it('builds an operator audit and quarantine snapshot from migration artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-audit-'));
    roots.push(root);
    const sourcePath = await tempWorkspace();
    await writeFile(path.join(sourcePath, 'MEMORY.md'), 'Audit candidate');
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const preview = await previewOpenClawMigration({ artifactStore }, {
      workspaceId: 'workspace-1',
      sourcePath,
      allowNonCanonicalSourceRoot: true,
    });
    const result = await importOpenClawMigration({
      artifactStore,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      reportArtifact: preview.artifact,
      expectedReportSha256: preview.artifact.sha256,
      allowNonCanonicalSourceRoot: true,
    });
    const verification = await verifyOpenClawMigration({
      artifactStore,
      memorySearcher: vi.fn(async () => []),
      now: () => new Date('2026-05-13T12:30:00.000Z'),
    }, {
      resultArtifact: result.artifact,
      expectedResultSha256: result.artifact.sha256,
    });

    const audit = await buildOpenClawMigrationAudit({
      artifactStore,
      now: () => new Date('2026-05-13T12:45:00.000Z'),
    }, {
      workspaceId: 'workspace-1',
    });

    expect(audit).toMatchObject({
      schemaVersion: 'openclaw_migration_audit.v1',
      generatedAt: '2026-05-13T12:45:00.000Z',
      artifactCounts: { importResults: 1, verificationResults: 1, rollbackResults: 0, invalidArtifacts: 0 },
      warnings: [],
      quarantineCandidates: [expect.objectContaining({
        migrationId: result.migrationId,
        memoryId: 'memory-1',
        reason: 'verification_missed',
        verificationArtifactId: verification.artifact.id,
      })],
    });
    expect(audit.migrations[0]).toMatchObject({
      migrationId: result.migrationId,
      status: 'needs_review',
      latestVerification: {
        foundCount: 0,
        missCount: 1,
        quarantineCandidateCount: 1,
      },
    });

    const quarantine = await buildOpenClawMigrationQuarantine({ artifactStore }, { workspaceId: 'workspace-1' });
    expect(quarantine).toMatchObject({
      schemaVersion: 'openclaw_quarantine_state.v1',
      candidateCount: 1,
      searchFailureCount: 0,
      sourceMigrationCount: 1,
      candidates: [expect.objectContaining({ memoryId: 'memory-1', reason: 'verification_missed' })],
    });

    await rollbackOpenClawMigration({
      artifactStore,
      memoryRevoker: vi.fn(async () => ({
        requested: 1,
        matched: 1,
        revoked: 1,
        missingIds: [],
        skippedIds: [],
        alreadyRevokedIds: [],
      })),
    }, {
      resultArtifact: result.artifact,
      expectedResultSha256: result.artifact.sha256,
    });
    const rolledBackAudit = await buildOpenClawMigrationAudit({ artifactStore }, { workspaceId: 'workspace-1' });
    expect(rolledBackAudit.migrations[0]).toMatchObject({ status: 'rolled_back', quarantineCandidates: [] });
  });

  it('sanitizes audit warnings for invalid artifact payloads', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-openclaw-audit-warning-'));
    roots.push(root);
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const invalid = await artifactStore.write('summary', '{not-json', {
      ext: '.json',
      meta: {
        memoryKind: 'openclaw_import_result',
        workspaceId: 'workspace-1',
      },
    });

    const audit = await buildOpenClawMigrationAudit({ artifactStore }, { workspaceId: 'workspace-1' });

    expect(audit.artifactCounts.invalidArtifacts).toBe(1);
    expect(audit.warnings).toEqual([{
      artifactId: invalid.id,
      memoryKind: 'openclaw_import_result',
      reason: 'artifact_json_invalid',
    }]);
    expect(JSON.stringify(audit.warnings)).not.toContain(root);
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
