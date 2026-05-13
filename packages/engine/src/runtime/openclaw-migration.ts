import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { ArtifactRef, ArtifactStore } from './artifact-model';
import {
  revokeImportedMemories,
  searchMemory,
  storeMemory,
  type MemoryRevocationResult,
  type MemoryType,
  type MemoryWriteOptions,
} from '../ai/memory/agent-memory-store';

export interface OpenClawMigrationOptions {
  workspaceId: string;
  sourcePath?: string;
  projectId?: string;
  includePersonality?: boolean;
  includeMemories?: boolean;
  maxFiles?: number;
  allowNonCanonicalSourceRoot?: boolean;
}

export interface OpenClawMigrationEntry {
  sourceRelPath: string;
  sourceKind: 'personality' | 'memory' | 'skill';
  memoryType: MemoryType;
  fingerprint: string;
  bytes: number;
  mtime: string;
  summary: string;
  redactionCount: number;
}

export interface OpenClawMigrationSkipped {
  sourceRelPath: string;
  reason: string;
}

export interface OpenClawMigrationReport {
  schemaVersion: 'openclaw_migration_report.v1';
  generatedAt: string;
  workspaceId: string;
  projectId?: string;
  sourceRoot: string;
  counts: {
    importable: number;
    skipped: number;
    personality: number;
    memories: number;
    skills: number;
    redactions: number;
  };
  entries: OpenClawMigrationEntry[];
  skipped: OpenClawMigrationSkipped[];
}

export interface OpenClawMigrationPreviewResult {
  artifact: ArtifactRef;
  report: OpenClawMigrationReport;
}

export interface OpenClawMigrationImportResult {
  schemaVersion: 'openclaw_migration_result.v1';
  migrationId: string;
  imported: number;
  skipped: number;
  memoryIds: string[];
  importedEntries: OpenClawMigrationImportedEntry[];
  skippedEntries: OpenClawMigrationImportSkipped[];
  rollbackPlan: OpenClawMigrationRollbackPlan;
  artifact: ArtifactRef;
}

export interface OpenClawMigrationImportedEntry {
  sourceRelPath: string;
  sourceKind: OpenClawMigrationEntry['sourceKind'];
  memoryType: MemoryType;
  fingerprint: string;
  memoryId: string;
}

export interface OpenClawMigrationImportSkipped {
  sourceRelPath: string;
  fingerprint: string;
  reason: 'fingerprint_mismatch';
}

export interface OpenClawMigrationRollbackPlan {
  status: 'prepared_not_executed';
  action: 'revoke_imported_memories';
  memoryIds: string[];
  note: string;
}

export interface OpenClawMigrationResultDocument extends Omit<OpenClawMigrationImportResult, 'artifact'> {
  importedAt: string;
  reportArtifactId?: string;
  reportSha256?: string;
  workspaceId: string;
  projectId?: string;
}

export interface OpenClawMigrationRollbackResult {
  schemaVersion: 'openclaw_migration_rollback_result.v1';
  migrationId: string;
  workspaceId: string;
  projectId?: string;
  rolledBackAt: string;
  requested: number;
  matched: number;
  revoked: number;
  missingIds: string[];
  skippedIds: string[];
  alreadyRevokedIds: string[];
  artifact: ArtifactRef;
}

export interface OpenClawMigrationVerificationEntry {
  memoryId: string;
  sourceRelPath: string;
  sourceKind: OpenClawMigrationEntry['sourceKind'];
  memoryType: MemoryType;
  searchAttempts: number;
  foundInResults: boolean;
  matchedSummary?: string;
  searchFailed?: boolean;
  error?: string;
}

export interface OpenClawMigrationVerificationResult {
  schemaVersion: 'openclaw_migration_verification_result.v1';
  migrationId: string;
  verifiedAt: string;
  totalMemories: number;
  foundCount: number;
  missCount: number;
  searchAttemptsFailed: number;
  entries: OpenClawMigrationVerificationEntry[];
  artifact: ArtifactRef;
}

export type OpenClawMigrationAuditStatus =
  | 'imported'
  | 'verified'
  | 'needs_review'
  | 'search_unverified'
  | 'rolled_back';

export interface OpenClawMigrationQuarantineCandidate {
  migrationId: string;
  memoryId: string;
  sourceRelPath: string;
  sourceKind: OpenClawMigrationEntry['sourceKind'];
  memoryType: MemoryType;
  reason: 'verification_missed' | 'verification_search_failed';
  verificationArtifactId: string;
  verificationSha256?: string;
}

export interface OpenClawMigrationAuditVerificationSummary {
  artifact: ArtifactRef;
  verifiedAt: string;
  totalMemories: number;
  foundCount: number;
  missCount: number;
  searchAttemptsFailed: number;
  quarantineCandidateCount: number;
  searchFailureCount: number;
}

export interface OpenClawMigrationAuditRollbackSummary {
  artifact: ArtifactRef;
  rolledBackAt: string;
  requested: number;
  matched: number;
  revoked: number;
  missingIds: string[];
  skippedIds: string[];
  alreadyRevokedIds: string[];
}

export interface OpenClawMigrationAuditMigration {
  migrationId: string;
  workspaceId: string;
  projectId?: string;
  status: OpenClawMigrationAuditStatus;
  importedAt: string;
  imported: number;
  skipped: number;
  memoryIds: string[];
  importArtifact: ArtifactRef;
  latestVerification?: OpenClawMigrationAuditVerificationSummary;
  latestRollback?: OpenClawMigrationAuditRollbackSummary;
  quarantineCandidates: OpenClawMigrationQuarantineCandidate[];
  searchFailures: OpenClawMigrationQuarantineCandidate[];
}

export interface OpenClawMigrationAuditWarning {
  artifactId: string;
  memoryKind?: string;
  reason: string;
}

export interface OpenClawMigrationAuditView {
  schemaVersion: 'openclaw_migration_audit.v1';
  generatedAt: string;
  workspaceId: string;
  projectId?: string;
  migrations: OpenClawMigrationAuditMigration[];
  quarantineCandidates: OpenClawMigrationQuarantineCandidate[];
  searchFailures: OpenClawMigrationQuarantineCandidate[];
  artifactCounts: {
    importResults: number;
    verificationResults: number;
    rollbackResults: number;
    invalidArtifacts: number;
  };
  warnings: OpenClawMigrationAuditWarning[];
}

export interface OpenClawMigrationQuarantineState {
  schemaVersion: 'openclaw_quarantine_state.v1';
  generatedAt: string;
  workspaceId: string;
  projectId?: string;
  candidateCount: number;
  searchFailureCount: number;
  candidates: OpenClawMigrationQuarantineCandidate[];
  searchFailures: OpenClawMigrationQuarantineCandidate[];
  sourceMigrationCount: number;
}

export interface OpenClawMigrationDeps {
  artifactStore: ArtifactStore;
  memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
  memoryRevoker?: typeof revokeImportedMemories;
  memorySearcher?: typeof searchMemory;
  now?: () => Date;
}

const ROOT_PERSONALITY_FILES: Record<string, { sourceKind: 'personality'; memoryType: MemoryType }> = {
  'IDENTITY.md': { sourceKind: 'personality', memoryType: 'policy' },
  'SOUL.md': { sourceKind: 'personality', memoryType: 'policy' },
  'USER.md': { sourceKind: 'personality', memoryType: 'semantic' },
  'MEMORY.md': { sourceKind: 'personality', memoryType: 'semantic' },
  'AGENTS.md': { sourceKind: 'personality', memoryType: 'policy' },
  'HEARTBEAT.md': { sourceKind: 'personality', memoryType: 'procedural' },
  'TOOLS.md': { sourceKind: 'personality', memoryType: 'policy' },
};

const MAX_FILE_BYTES = 256 * 1024;

export async function previewOpenClawMigration(
  deps: OpenClawMigrationDeps,
  options: OpenClawMigrationOptions,
): Promise<OpenClawMigrationPreviewResult> {
  const report = await buildOpenClawMigrationReport(deps, options);
  const artifact = await deps.artifactStore.writeJSON('summary', report, {
    meta: {
      memoryKind: 'openclaw_import_report',
      schemaVersion: report.schemaVersion,
      workspaceId: options.workspaceId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    },
  });
  return { artifact, report };
}

export async function importOpenClawMigration(
  deps: OpenClawMigrationDeps,
  input: {
    report?: OpenClawMigrationReport;
    expectedReportSha256?: string;
    reportArtifact?: ArtifactRef;
    allowNonCanonicalSourceRoot?: boolean;
  },
): Promise<OpenClawMigrationImportResult> {
  if (input.expectedReportSha256 && input.reportArtifact?.sha256 !== input.expectedReportSha256) {
    throw new Error('OpenClaw migration report sha256 mismatch');
  }
  const report = await resolveImportReport(deps, input);
  const memoryWriter = deps.memoryWriter ?? storeMemory;
  const memoryIds: string[] = [];
  const importedEntries: OpenClawMigrationImportedEntry[] = [];
  const skippedEntries: OpenClawMigrationImportSkipped[] = [];
  for (const entry of report.entries) {
    const absolutePath = safeResolve(report.sourceRoot, entry.sourceRelPath);
    const raw = await readOpenClawTextFile(report.sourceRoot, entry.sourceRelPath);
    const normalized = normalizeContent(raw);
    if (fingerprint(entry.sourceRelPath, normalized) !== entry.fingerprint) {
      skippedEntries.push({
        sourceRelPath: entry.sourceRelPath,
        fingerprint: entry.fingerprint,
        reason: 'fingerprint_mismatch',
      });
      continue;
    }
    const redacted = redactContent(normalized).content;
    const memoryId = await memoryWriter({
      agentId: 'pyrfor-runtime',
      workspaceId: report.workspaceId,
      projectId: report.projectId,
      memoryType: entry.memoryType,
      content: redacted,
      summary: entry.summary,
      importance: entry.sourceKind === 'personality' ? 0.86 : 0.74,
      metadata: {
        migratedFrom: 'openclaw',
        sourcePath: absolutePath,
        sourceRelPath: entry.sourceRelPath,
        sourceKind: entry.sourceKind,
        fingerprint: entry.fingerprint,
        rollupKind: entry.sourceKind === 'personality' ? 'openclaw_personality' : 'openclaw_memory',
        scope: {
          visibility: report.projectId ? 'project' : 'workspace',
          workspaceId: report.workspaceId,
          ...(report.projectId ? { projectId: report.projectId } : {}),
        },
        confidence: 0.82,
        provenance: [{ kind: 'external' as const, ref: entry.sourceRelPath, ts: entry.mtime }],
      },
    });
    if (memoryId === 'short-term-only') throw new Error('OpenClaw migration memory was not durably persisted');
    memoryIds.push(memoryId);
    importedEntries.push({
      sourceRelPath: entry.sourceRelPath,
      sourceKind: entry.sourceKind,
      memoryType: entry.memoryType,
      fingerprint: entry.fingerprint,
      memoryId,
    });
  }
  const migrationId = `openclaw-${randomUUID()}`;
  const rollbackPlan: OpenClawMigrationRollbackPlan = {
    status: 'prepared_not_executed',
    action: 'revoke_imported_memories',
    memoryIds,
    note: 'Use this manifest to revoke or tombstone imported memories if the operator rolls back this migration.',
  };
  const document: OpenClawMigrationResultDocument = {
    schemaVersion: 'openclaw_migration_result.v1',
    migrationId,
    importedAt: (deps.now ?? (() => new Date()))().toISOString(),
    reportArtifactId: input.reportArtifact?.id,
    reportSha256: input.reportArtifact?.sha256,
    workspaceId: report.workspaceId,
    projectId: report.projectId,
    imported: memoryIds.length,
    skipped: skippedEntries.length,
    memoryIds,
    importedEntries,
    skippedEntries,
    rollbackPlan,
  };
  const artifact = await deps.artifactStore.writeJSON('summary', document, {
    meta: {
      memoryKind: 'openclaw_import_result',
      migrationId,
      workspaceId: report.workspaceId,
      ...(report.projectId ? { projectId: report.projectId } : {}),
    },
  });
  return {
    schemaVersion: document.schemaVersion,
    migrationId,
    imported: memoryIds.length,
    skipped: skippedEntries.length,
    memoryIds,
    importedEntries,
    skippedEntries,
    rollbackPlan,
    artifact,
  };
}

export async function rollbackOpenClawMigration(
  deps: OpenClawMigrationDeps,
  input: {
    resultArtifact: ArtifactRef;
    expectedResultSha256: string;
  },
): Promise<OpenClawMigrationRollbackResult> {
  const resultDocument = await resolveImportResultDocument(deps, input.resultArtifact, input.expectedResultSha256);
  if (resultDocument.rollbackPlan.action !== 'revoke_imported_memories') {
    throw new Error('OpenClaw migration rollback action is not supported');
  }
  const revoker = deps.memoryRevoker ?? revokeImportedMemories;
  const revokedAt = deps.now ?? (() => new Date());
  const rollbackAt = revokedAt();
  const revocation: MemoryRevocationResult = await revoker({
    memoryIds: resultDocument.rollbackPlan.memoryIds,
    agentId: 'pyrfor-runtime',
    workspaceId: resultDocument.workspaceId,
    ...(resultDocument.projectId ? { projectId: resultDocument.projectId } : {}),
    migratedFrom: 'openclaw',
    reason: `openclaw_migration_rollback:${resultDocument.migrationId}`,
    revokedAt: rollbackAt,
  });
  const rollbackDocument = {
    schemaVersion: 'openclaw_migration_rollback_result.v1' as const,
    migrationId: resultDocument.migrationId,
    workspaceId: resultDocument.workspaceId,
    ...(resultDocument.projectId ? { projectId: resultDocument.projectId } : {}),
    rolledBackAt: rollbackAt.toISOString(),
    ...revocation,
  };
  const artifact = await deps.artifactStore.writeJSON('summary', rollbackDocument, {
    meta: {
      memoryKind: 'openclaw_rollback_result',
      migrationId: resultDocument.migrationId,
      workspaceId: resultDocument.workspaceId,
      ...(resultDocument.projectId ? { projectId: resultDocument.projectId } : {}),
    },
  });
  return { ...rollbackDocument, artifact };
}

export async function verifyOpenClawMigration(
  deps: OpenClawMigrationDeps,
  input: {
    resultArtifact: ArtifactRef;
    expectedResultSha256: string;
    queryLimit?: number;
  },
): Promise<OpenClawMigrationVerificationResult> {
  const resultDocument = await resolveImportResultDocument(deps, input.resultArtifact, input.expectedResultSha256);
  const memorySearcher = deps.memorySearcher ?? searchMemory;
  const queryLimit = normalizeQueryLimit(input.queryLimit);
  const verifiedAt = (deps.now ?? (() => new Date()))();
  const entries: OpenClawMigrationVerificationEntry[] = [];
  for (const entry of resultDocument.importedEntries) {
    const publicEntry = publicVerificationEntryBase(entry);
    const queries = buildVerificationQueries(entry);
    let found: OpenClawMigrationVerificationEntry | null = null;
    let failedError: string | undefined;
    let attempts = 0;
    for (const query of queries) {
      attempts += 1;
      try {
        const results = await memorySearcher({
          agentId: 'pyrfor-runtime',
          workspaceId: resultDocument.workspaceId,
          ...(resultDocument.projectId ? { projectId: resultDocument.projectId } : {}),
          memoryType: entry.memoryType,
          query,
          limit: queryLimit,
        });
        const matched = results.find((memory) => memory.id === entry.memoryId);
        if (matched) {
          found = {
            ...publicEntry,
            searchAttempts: attempts,
            foundInResults: true,
            matchedSummary: matched.summary,
          };
          break;
        }
      } catch (err) {
        failedError = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    if (found) {
      entries.push(found);
      continue;
    }
    entries.push({
      ...publicEntry,
      searchAttempts: attempts,
      foundInResults: false,
      ...(failedError ? { searchFailed: true, error: failedError } : {}),
    });
  }
  const foundCount = entries.filter((entry) => entry.foundInResults).length;
  const searchAttemptsFailed = entries.filter((entry) => entry.searchFailed === true).length;
  const document = {
    schemaVersion: 'openclaw_migration_verification_result.v1' as const,
    migrationId: resultDocument.migrationId,
    verifiedAt: verifiedAt.toISOString(),
    totalMemories: entries.length,
    foundCount,
    missCount: entries.length - foundCount,
    searchAttemptsFailed,
    entries,
  };
  const artifact = await deps.artifactStore.writeJSON('summary', document, {
    meta: {
      memoryKind: 'openclaw_verification_result',
      migrationId: resultDocument.migrationId,
      workspaceId: resultDocument.workspaceId,
      ...(resultDocument.projectId ? { projectId: resultDocument.projectId } : {}),
    },
  });
  return { ...document, artifact };
}

export async function buildOpenClawMigrationAudit(
  deps: OpenClawMigrationDeps,
  input: {
    workspaceId: string;
    projectId?: string;
    limit?: number;
  },
): Promise<OpenClawMigrationAuditView> {
  const projectId = input.projectId?.trim() || undefined;
  const limit = normalizeAuditLimit(input.limit);
  const warnings: OpenClawMigrationAuditWarning[] = [];
  const summaryArtifacts = await deps.artifactStore.list({ kind: 'summary' });
  const scopedArtifacts = summaryArtifacts.filter((artifact) => artifact.meta?.workspaceId === input.workspaceId
    && ((projectId ? artifact.meta?.projectId === projectId : artifact.meta?.projectId === undefined)));
  const importArtifacts = scopedArtifacts.filter((artifact) => artifact.meta?.memoryKind === 'openclaw_import_result');
  const verificationArtifacts = scopedArtifacts.filter((artifact) => artifact.meta?.memoryKind === 'openclaw_verification_result');
  const rollbackArtifacts = scopedArtifacts.filter((artifact) => artifact.meta?.memoryKind === 'openclaw_rollback_result');

  const imports: Array<{ artifact: ArtifactRef; document: OpenClawMigrationResultDocument }> = [];
  for (const artifact of importArtifacts) {
    try {
      const document = await readArtifactJson<OpenClawMigrationResultDocument>(deps.artifactStore, artifact);
      if (document.schemaVersion !== 'openclaw_migration_result.v1') {
        throw new Error('schema mismatch');
      }
      if (document.workspaceId !== input.workspaceId) {
        throw new Error('workspace mismatch');
      }
      if ((document.projectId ?? undefined) !== projectId) {
        throw new Error('project mismatch');
      }
      imports.push({ artifact, document });
    } catch (err) {
      warnings.push(auditWarning(artifact, err));
    }
  }

  const verificationsByMigration = new Map<string, Array<{ artifact: ArtifactRef; document: OpenClawMigrationVerificationResult }>>();
  for (const artifact of verificationArtifacts) {
    try {
      const migrationId = requireMigrationArtifactId(artifact);
      const document = await readArtifactJson<OpenClawMigrationVerificationResult>(deps.artifactStore, artifact);
      if (document.schemaVersion !== 'openclaw_migration_verification_result.v1') {
        throw new Error('schema mismatch');
      }
      if (document.migrationId !== migrationId) {
        throw new Error('migration mismatch');
      }
      const entries = verificationsByMigration.get(migrationId) ?? [];
      entries.push({ artifact, document });
      verificationsByMigration.set(migrationId, entries);
    } catch (err) {
      warnings.push(auditWarning(artifact, err));
    }
  }

  const rollbacksByMigration = new Map<string, Array<{ artifact: ArtifactRef; document: OpenClawMigrationRollbackResult }>>();
  for (const artifact of rollbackArtifacts) {
    try {
      const migrationId = requireMigrationArtifactId(artifact);
      const document = await readArtifactJson<OpenClawMigrationRollbackResult>(deps.artifactStore, artifact);
      if (document.schemaVersion !== 'openclaw_migration_rollback_result.v1') {
        throw new Error('schema mismatch');
      }
      if (document.migrationId !== migrationId) {
        throw new Error('migration mismatch');
      }
      if (document.workspaceId !== input.workspaceId) {
        throw new Error('workspace mismatch');
      }
      if ((document.projectId ?? undefined) !== projectId) {
        throw new Error('project mismatch');
      }
      const entries = rollbacksByMigration.get(migrationId) ?? [];
      entries.push({ artifact, document });
      rollbacksByMigration.set(migrationId, entries);
    } catch (err) {
      warnings.push(auditWarning(artifact, err));
    }
  }

  const migrations = imports
    .sort((a, b) => b.document.importedAt.localeCompare(a.document.importedAt))
    .slice(0, limit)
    .map(({ artifact, document }) => {
      const latestVerification = latestBy(verificationsByMigration.get(document.migrationId) ?? [], (entry) => entry.document.verifiedAt);
      const latestRollback = latestBy(rollbacksByMigration.get(document.migrationId) ?? [], (entry) => entry.document.rolledBackAt);
      const quarantineCandidates = latestRollback ? [] : (latestVerification?.document.entries ?? [])
        .filter((entry) => !entry.foundInResults && entry.searchFailed !== true)
        .map((entry) => quarantineCandidate(document.migrationId, latestVerification!.artifact, entry, 'verification_missed'));
      const searchFailures = latestRollback ? [] : (latestVerification?.document.entries ?? [])
        .filter((entry) => !entry.foundInResults && entry.searchFailed === true)
        .map((entry) => quarantineCandidate(document.migrationId, latestVerification!.artifact, entry, 'verification_search_failed'));
      const migration: OpenClawMigrationAuditMigration = {
        migrationId: document.migrationId,
        workspaceId: document.workspaceId,
        ...(document.projectId ? { projectId: document.projectId } : {}),
        status: auditStatus(latestVerification?.document, latestRollback?.document, quarantineCandidates, searchFailures),
        importedAt: document.importedAt,
        imported: document.imported,
        skipped: document.skipped,
        memoryIds: document.memoryIds,
        importArtifact: artifact,
        ...(latestVerification ? { latestVerification: verificationSummary(latestVerification.artifact, latestVerification.document) } : {}),
        ...(latestRollback ? { latestRollback: rollbackSummary(latestRollback.artifact, latestRollback.document) } : {}),
        quarantineCandidates,
        searchFailures,
      };
      return migration;
    });

  return {
    schemaVersion: 'openclaw_migration_audit.v1',
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    workspaceId: input.workspaceId,
    ...(projectId ? { projectId } : {}),
    migrations,
    quarantineCandidates: migrations.flatMap((migration) => migration.quarantineCandidates),
    searchFailures: migrations.flatMap((migration) => migration.searchFailures),
    artifactCounts: {
      importResults: imports.length,
      verificationResults: Array.from(verificationsByMigration.values()).reduce((sum, entries) => sum + entries.length, 0),
      rollbackResults: Array.from(rollbacksByMigration.values()).reduce((sum, entries) => sum + entries.length, 0),
      invalidArtifacts: warnings.length,
    },
    warnings,
  };
}

export async function buildOpenClawMigrationQuarantine(
  deps: OpenClawMigrationDeps,
  input: {
    workspaceId: string;
    projectId?: string;
    limit?: number;
  },
): Promise<OpenClawMigrationQuarantineState> {
  const audit = await buildOpenClawMigrationAudit(deps, input);
  return {
    schemaVersion: 'openclaw_quarantine_state.v1',
    generatedAt: audit.generatedAt,
    workspaceId: audit.workspaceId,
    ...(audit.projectId ? { projectId: audit.projectId } : {}),
    candidateCount: audit.quarantineCandidates.length,
    searchFailureCount: audit.searchFailures.length,
    candidates: audit.quarantineCandidates,
    searchFailures: audit.searchFailures,
    sourceMigrationCount: audit.migrations.length,
  };
}

async function resolveImportResultDocument(
  deps: OpenClawMigrationDeps,
  resultArtifact: ArtifactRef,
  expectedResultSha256: string,
): Promise<OpenClawMigrationResultDocument> {
  if (resultArtifact.sha256 !== expectedResultSha256) {
    throw new Error('OpenClaw migration result sha256 mismatch');
  }
  if (resultArtifact.meta?.memoryKind !== 'openclaw_import_result') {
    throw new Error('OpenClaw migration result artifact kind mismatch');
  }
  const resultDocument = await deps.artifactStore.readJSONVerified<OpenClawMigrationResultDocument>(
    resultArtifact,
    expectedResultSha256,
  );
  if (resultDocument.schemaVersion !== 'openclaw_migration_result.v1') {
    throw new Error('OpenClaw migration result schema mismatch');
  }
  if (resultArtifact.meta?.migrationId !== resultDocument.migrationId) {
    throw new Error('OpenClaw migration result migration mismatch');
  }
  if (resultArtifact.meta?.workspaceId !== resultDocument.workspaceId) {
    throw new Error('OpenClaw migration result workspace mismatch');
  }
  return resultDocument;
}

async function readArtifactJson<T>(artifactStore: ArtifactStore, artifact: ArtifactRef): Promise<T> {
  if (artifact.sha256) return artifactStore.readJSONVerified<T>(artifact, artifact.sha256);
  return artifactStore.readJSON<T>(artifact);
}

function requireMigrationArtifactId(artifact: ArtifactRef): string {
  const migrationId = artifact.meta?.migrationId;
  if (typeof migrationId !== 'string' || !migrationId.trim()) {
    throw new Error('migration metadata missing');
  }
  return migrationId;
}

function latestBy<T>(entries: T[], getTimestamp: (entry: T) => string): T | undefined {
  return [...entries].sort((a, b) => getTimestamp(b).localeCompare(getTimestamp(a)))[0];
}

function quarantineCandidate(
  migrationId: string,
  verificationArtifact: ArtifactRef,
  entry: OpenClawMigrationVerificationEntry,
  reason: OpenClawMigrationQuarantineCandidate['reason'],
): OpenClawMigrationQuarantineCandidate {
  return {
    migrationId,
    memoryId: entry.memoryId,
    sourceRelPath: entry.sourceRelPath,
    sourceKind: entry.sourceKind,
    memoryType: entry.memoryType,
    reason,
    verificationArtifactId: verificationArtifact.id,
    ...(verificationArtifact.sha256 ? { verificationSha256: verificationArtifact.sha256 } : {}),
  };
}

function verificationSummary(
  artifact: ArtifactRef,
  document: OpenClawMigrationVerificationResult,
): OpenClawMigrationAuditVerificationSummary {
  return {
    artifact,
    verifiedAt: document.verifiedAt,
    totalMemories: document.totalMemories,
    foundCount: document.foundCount,
    missCount: document.missCount,
    searchAttemptsFailed: document.searchAttemptsFailed,
    quarantineCandidateCount: document.entries.filter((entry) => !entry.foundInResults && entry.searchFailed !== true).length,
    searchFailureCount: document.entries.filter((entry) => !entry.foundInResults && entry.searchFailed === true).length,
  };
}

function rollbackSummary(
  artifact: ArtifactRef,
  document: OpenClawMigrationRollbackResult,
): OpenClawMigrationAuditRollbackSummary {
  return {
    artifact,
    rolledBackAt: document.rolledBackAt,
    requested: document.requested,
    matched: document.matched,
    revoked: document.revoked,
    missingIds: document.missingIds,
    skippedIds: document.skippedIds,
    alreadyRevokedIds: document.alreadyRevokedIds,
  };
}

function auditStatus(
  verification: OpenClawMigrationVerificationResult | undefined,
  rollback: OpenClawMigrationRollbackResult | undefined,
  quarantineCandidates: OpenClawMigrationQuarantineCandidate[],
  searchFailures: OpenClawMigrationQuarantineCandidate[],
): OpenClawMigrationAuditStatus {
  if (rollback) return 'rolled_back';
  if (!verification) return 'imported';
  if (quarantineCandidates.length > 0) return 'needs_review';
  if (searchFailures.length > 0) return 'search_unverified';
  return 'verified';
}

function auditWarning(artifact: ArtifactRef, err: unknown): OpenClawMigrationAuditWarning {
  return {
    artifactId: artifact.id,
    ...(typeof artifact.meta?.memoryKind === 'string' ? { memoryKind: artifact.meta.memoryKind } : {}),
    reason: safeAuditWarningReason(err),
  };
}

function safeAuditWarningReason(err: unknown): string {
  if (err instanceof SyntaxError) return 'artifact_json_invalid';
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code);
    if (code === 'ENOENT') return 'artifact_missing';
    if (code === 'EACCES' || code === 'EPERM') return 'artifact_read_denied';
    if (code) return 'artifact_read_failed';
  }
  const message = err instanceof Error ? err.message : String(err);
  switch (message) {
    case 'schema mismatch':
    case 'workspace mismatch':
    case 'project mismatch':
    case 'migration mismatch':
    case 'migration metadata missing':
      return message;
    default:
      return 'artifact_read_failed';
  }
}

function publicVerificationEntryBase(entry: OpenClawMigrationImportedEntry): Omit<OpenClawMigrationVerificationEntry, 'searchAttempts' | 'foundInResults' | 'matchedSummary' | 'searchFailed' | 'error'> {
  return {
    memoryId: entry.memoryId,
    sourceRelPath: entry.sourceRelPath,
    sourceKind: entry.sourceKind,
    memoryType: entry.memoryType,
  };
}

function normalizeQueryLimit(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function normalizeAuditLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function buildVerificationQueries(entry: OpenClawMigrationImportedEntry): string[] {
  const basename = path.basename(entry.sourceRelPath, path.extname(entry.sourceRelPath));
  return [...new Set([
    entry.sourceRelPath,
    basename,
    entry.sourceKind,
  ].map((query) => query.trim()).filter(Boolean))];
}

async function resolveImportReport(
  deps: OpenClawMigrationDeps,
  input: {
    report?: OpenClawMigrationReport;
    expectedReportSha256?: string;
    reportArtifact?: ArtifactRef;
    allowNonCanonicalSourceRoot?: boolean;
  },
): Promise<OpenClawMigrationReport> {
  if (input.reportArtifact && input.expectedReportSha256) {
    const report = await deps.artifactStore.readJSONVerified<OpenClawMigrationReport>(
      input.reportArtifact,
      input.expectedReportSha256,
    );
    if (input.reportArtifact.meta?.memoryKind !== 'openclaw_import_report') {
      throw new Error('OpenClaw migration artifact kind mismatch');
    }
    if (input.reportArtifact.meta?.workspaceId !== report.workspaceId) {
      throw new Error('OpenClaw migration artifact workspace mismatch');
    }
    const artifactProjectId = input.reportArtifact.meta?.projectId;
    if ((artifactProjectId ?? undefined) !== (report.projectId ?? undefined)) {
      throw new Error('OpenClaw migration artifact project mismatch');
    }
    assertAllowedReportSourceRoot(report, input.allowNonCanonicalSourceRoot === true);
    return report;
  }
  if (!input.report) throw new Error('OpenClaw migration report is required');
  assertAllowedReportSourceRoot(input.report, input.allowNonCanonicalSourceRoot === true);
  return input.report;
}

export function isAllowedOpenClawReportSourceRoot(report: OpenClawMigrationReport): boolean {
  return isAllowedSourceRoot(report.sourceRoot);
}

function assertAllowedReportSourceRoot(report: OpenClawMigrationReport, allowNonCanonicalSourceRoot: boolean): void {
  if (!isAllowedSourceRoot(report.sourceRoot, allowNonCanonicalSourceRoot)) {
    throw new Error('OpenClaw migration report source root is not an allowed workspace root');
  }
}

export async function discoverOpenClawSourceRoots(): Promise<string[]> {
  const candidates = [
    path.join(homedir(), '.openclaw', 'workspace'),
    path.join(homedir(), 'openclaw-workspace'),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) existing.push(candidate);
  }
  return existing;
}

export async function buildOpenClawMigrationReport(
  deps: Pick<OpenClawMigrationDeps, 'now'>,
  options: OpenClawMigrationOptions,
): Promise<OpenClawMigrationReport> {
  const sourceRoot = await resolveSourceRoot(options.sourcePath, options.allowNonCanonicalSourceRoot === true);
  const includePersonality = options.includePersonality !== false;
  const includeMemories = options.includeMemories !== false;
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? 500, 2_000));
  const skipped: OpenClawMigrationSkipped[] = [];
  const discovered = await discoverImportableFiles(sourceRoot, { includePersonality, includeMemories, maxFiles, skipped });
  const entries: OpenClawMigrationEntry[] = [];
  const seen = new Set<string>();
  for (const file of discovered) {
    const absolutePath = path.join(sourceRoot, file.sourceRelPath);
    const info = await lstat(absolutePath);
    if (!info.isFile()) {
      skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'denied_path' });
      continue;
    }
    if (info.size > MAX_FILE_BYTES) {
      skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'file_too_large' });
      continue;
    }
    const normalized = normalizeContent(await readOpenClawTextFile(sourceRoot, file.sourceRelPath));
    const fp = fingerprint(file.sourceRelPath, normalized);
    if (seen.has(fp)) {
      skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'duplicate_in_batch' });
      continue;
    }
    seen.add(fp);
    const redacted = redactContent(normalized);
    entries.push({
      sourceRelPath: file.sourceRelPath,
      sourceKind: file.sourceKind,
      memoryType: file.memoryType,
      fingerprint: fp,
      bytes: Buffer.byteLength(redacted.content, 'utf-8'),
      mtime: info.mtime.toISOString(),
      summary: summarize(file.sourceRelPath, redacted.content),
      redactionCount: redacted.count,
    });
  }
  return {
    schemaVersion: 'openclaw_migration_report.v1',
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    workspaceId: options.workspaceId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    sourceRoot,
    counts: {
      importable: entries.length,
      skipped: skipped.length,
      personality: entries.filter((entry) => entry.sourceKind === 'personality').length,
      memories: entries.filter((entry) => entry.sourceKind === 'memory').length,
      skills: entries.filter((entry) => entry.sourceKind === 'skill').length,
      redactions: entries.reduce((sum, entry) => sum + entry.redactionCount, 0),
    },
    entries,
    skipped,
  };
}

async function resolveSourceRoot(sourcePath: string | undefined, allowNonCanonicalSourceRoot: boolean): Promise<string> {
  const roots = sourcePath ? [path.resolve(sourcePath)] : await discoverOpenClawSourceRoots();
  const sourceRoot = roots[0];
  if (!sourceRoot) throw new Error('No OpenClaw workspace source found');
  if (!isAllowedSourceRoot(sourceRoot, allowNonCanonicalSourceRoot)) throw new Error('OpenClaw source path is not an allowed workspace root');
  const linkInfo = await lstat(sourceRoot).catch(() => null);
  if (!linkInfo?.isDirectory()) throw new Error('OpenClaw source path is not a directory');
  const realRoot = await realpath(sourceRoot);
  if (!isAllowedSourceRoot(realRoot, allowNonCanonicalSourceRoot)) throw new Error('OpenClaw source path is not an allowed workspace root');
  return realRoot;
}

function isAllowedSourceRoot(sourceRoot: string, allowNonCanonicalSourceRoot = false): boolean {
  const normalized = path.resolve(sourceRoot);
  const canonicalRoots = [
    path.resolve(homedir(), '.openclaw', 'workspace'),
    path.resolve(homedir(), 'openclaw-workspace'),
  ];
  if (canonicalRoots.includes(normalized)) return true;
  if (!allowNonCanonicalSourceRoot) return false;
  const base = path.basename(normalized);
  const parentBase = path.basename(path.dirname(normalized));
  return base === 'openclaw-workspace'
    || (base === 'workspace' && parentBase === '.openclaw');
}

async function discoverImportableFiles(
  sourceRoot: string,
  opts: {
    includePersonality: boolean;
    includeMemories: boolean;
    maxFiles: number;
    skipped: OpenClawMigrationSkipped[];
  },
): Promise<Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }>> {
  const files: Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }> = [];
  if (opts.includePersonality) {
    for (const [file, mapping] of Object.entries(ROOT_PERSONALITY_FILES)) {
      if (await isFile(path.join(sourceRoot, file))) files.push({ sourceRelPath: file, ...mapping });
    }
    files.push(...await discoverMarkdownTree(sourceRoot, 'skills', 'skill', 'procedural', opts.skipped));
  }
  if (opts.includeMemories) {
    files.push(...await discoverMarkdownTree(sourceRoot, 'memory', 'memory', 'episodic', opts.skipped));
  }
  return files
    .sort((a, b) => a.sourceRelPath.localeCompare(b.sourceRelPath))
    .slice(0, opts.maxFiles);
}

async function discoverMarkdownTree(
  sourceRoot: string,
  relDir: string,
  sourceKind: OpenClawMigrationEntry['sourceKind'],
  memoryType: MemoryType,
  skipped: OpenClawMigrationSkipped[],
): Promise<Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }>> {
  const root = path.join(sourceRoot, relDir);
  const info = await lstat(root).catch(() => null);
  if (!info?.isDirectory()) return [];
  const results: Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }> = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('~') || entry.name.includes('.backup')) {
        skipped.push({ sourceRelPath: path.relative(sourceRoot, path.join(dir, entry.name)), reason: 'denied_path' });
        continue;
      }
      const full = path.join(dir, entry.name);
      const rel = path.relative(sourceRoot, full);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({ sourceRelPath: rel, sourceKind, memoryType });
      } else {
        skipped.push({ sourceRelPath: rel, reason: 'unsupported_file_type' });
      }
    }
  }
  await walk(root);
  return results;
}

async function isFile(filePath: string): Promise<boolean> {
  const info = await lstat(filePath).catch(() => null);
  return Boolean(info?.isFile());
}

function safeResolve(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('OpenClaw source path escaped source root');
  }
  return resolved;
}

async function readOpenClawTextFile(root: string, relPath: string): Promise<string> {
  const absolutePath = safeResolve(root, relPath);
  const linkInfo = await lstat(absolutePath);
  if (!linkInfo.isFile()) throw new Error('OpenClaw source path is not a regular file');
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolutePath)]);
  const relative = path.relative(realRoot, realFile);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('OpenClaw source path escaped source root');
  }
  return readFile(realFile, 'utf-8');
}

function normalizeContent(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function fingerprint(relPath: string, normalizedBody: string): string {
  return createHash('sha256').update(`${relPath}\n${normalizedBody}`).digest('hex');
}

function redactContent(value: string): { content: string; count: number } {
  let count = 0;
  const replace = (input: string, pattern: RegExp, replacement: string): string => input.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  let content = value;
  content = replace(content, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
  content = replace(content, /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]');
  content = replace(content, /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s]{6,}["']?/gi, '$1=[REDACTED]');
  return { content, count };
}

function summarize(relPath: string, content: string): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0) ?? 'OpenClaw memory';
  return `${relPath}: ${firstLine.slice(0, 160)}`;
}
