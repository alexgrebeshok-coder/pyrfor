// @vitest-environment node
/**
 * Tests for runtime HTTP gateway.
 *
 * Uses port 0 so the OS assigns an ephemeral port — no conflicts between runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RuntimeConfig } from './config';
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';
import { DurableMemoryContradictionError } from '../ai/memory/agent-memory-store';
import { createRuntimeGateway, type GatewayDeps } from './gateway';
import { approvalFlow } from './approval-flow';
import { ProviderRouter } from './provider-router';
import type { ConceptRecord, UniversalEngineOrchestrator } from './universal/engine-loop';

// Silence logger output during tests
process.env.LOG_LEVEL = 'silent';

// ─── Minimal config factory ────────────────────────────────────────────────

function makeConfig(
  overrides?: Partial<RuntimeConfig['gateway']>,
  rateLimitOverrides?: Partial<RuntimeConfig['rateLimit']>
): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0, // OS-assigned
      bearerToken: undefined,
      bearerTokens: [],
      ...overrides,
    },
    rateLimit: {
      enabled: false,
      capacity: 60,
      refillPerSec: 1,
      exemptPaths: ['/ping', '/health', '/metrics'],
      ...rateLimitOverrides,
    },
  } as unknown as RuntimeConfig;
}

function makeConfigWithUniversalEngine(enabled = true): RuntimeConfig {
  return {
    ...makeConfig(),
    features: { universalEngine: enabled },
  } as RuntimeConfig;
}

// ─── Minimal mock runtime ──────────────────────────────────────────────────

function makeRuntime(response = 'hello from mock'): PyrforRuntime {
  const session = {
    id: 'sess-1',
    workspaceId: '/tmp/pyrfor-test-workspace',
    title: 'web:chat-1',
    mode: 'chat' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    messageCount: 2,
    summary: 'session summary',
  };
  const messages = [
    { id: 'msg-1', role: 'user' as const, content: 'remember this', createdAt: '2026-01-01T00:00:30.000Z' },
    { id: 'msg-2', role: 'assistant' as const, content: 'remembered', createdAt: '2026-01-01T00:01:00.000Z' },
  ];
  return {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response }),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/pyrfor-test-workspace'),
    getMemorySnapshot: vi.fn().mockReturnValue({
      lines: ['pyrfor memory line'],
      files: ['MEMORY.md'],
      workspaceFiles: { 'MEMORY.md': { present: true, lineCount: 1 } },
      daily: [],
    }),
    getMemoryContinuityStatus: vi.fn().mockResolvedValue({
      workspaceId: '/tmp/pyrfor-test-workspace',
      projectId: 'project-1',
      generatedAt: '2026-01-01T00:06:00.000Z',
      workspaceFiles: {
        present: 1,
        total: 2,
        missing: ['SOUL.md'],
        files: {
          'MEMORY.md': { present: true, lineCount: 1 },
          'SOUL.md': { present: false, lineCount: 0 },
        },
      },
      latestDailyRollup: {
        status: 'ok',
        date: '2026-01-01',
        createdAt: '2026-01-01T00:02:00.000Z',
        artifact: {
          id: 'daily-rollup-1.json',
          kind: 'summary',
          uri: '/tmp/daily-rollup-1.json',
          sha256: 'sha-daily-rollup',
          createdAt: '2026-01-01T00:02:00.000Z',
          meta: { memoryKind: 'daily_rollup', workspaceId: '/tmp/pyrfor-test-workspace' },
        },
      },
      latestProjectRollup: {
        status: 'ok',
        projectId: 'project-1',
        createdAt: '2026-01-01T00:05:00.000Z',
        artifact: {
          id: 'project-rollup-1.json',
          kind: 'summary',
          uri: '/tmp/project-rollup-1.json',
          sha256: 'sha-project-rollup',
          createdAt: '2026-01-01T00:05:00.000Z',
          meta: { memoryKind: 'project_rollup', workspaceId: '/tmp/pyrfor-test-workspace', projectId: 'project-1' },
        },
      },
      latestOpenClawReport: {
        status: 'ok',
        createdAt: '2026-01-01T00:03:00.000Z',
        artifact: {
          id: 'openclaw-report-1.json',
          kind: 'summary',
          uri: '/tmp/openclaw-report-1.json',
          sha256: 'sha-openclaw-report',
          createdAt: '2026-01-01T00:03:00.000Z',
          meta: { memoryKind: 'openclaw_import_report', workspaceId: '/tmp/pyrfor-test-workspace' },
        },
        counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 },
      },
      warnings: ['memory_files_missing'],
    }),
    searchMemory: vi.fn().mockResolvedValue({
      workspaceId: session.workspaceId,
      query: 'delivery',
      projectId: 'project-1',
      results: [{
        id: 'memory-1',
        summary: 'delivery memory',
        content: 'delivery evidence memory',
        createdAt: '2026-01-01T00:00:00.000Z',
        memoryType: 'semantic',
        importance: 0.9,
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        source: 'durable',
        scopeVisibility: 'project',
        projectMemoryCategory: 'decision',
        importState: 'imported_quarantined',
        approvalState: 'pending_approval',
        plannerEligible: false,
        importedFrom: 'openclaw',
        provenanceKinds: ['external'],
      }],
    }),
    createMemoryCorrection: vi.fn().mockResolvedValue({
      memory: {
        id: 'memory-correction-1',
        summary: 'corrected fact',
        content: 'corrected fact content',
        createdAt: '2026-01-01T00:02:00.000Z',
        memoryType: 'semantic',
        importance: 0.8,
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        source: 'durable',
        scopeVisibility: 'project',
        approvalState: 'pending_approval',
        plannerEligible: false,
        correctionKind: 'operator',
        provenanceKinds: ['user'],
      },
    }),
    reviewMemory: vi.fn().mockResolvedValue({
      decision: 'approve',
      memory: {
        id: 'memory-1',
        summary: 'delivery memory',
        content: 'delivery evidence memory',
        createdAt: '2026-01-01T00:00:00.000Z',
        memoryType: 'semantic',
        importance: 0.9,
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        source: 'durable',
        scopeVisibility: 'project',
        importState: 'approved',
        approvalState: 'approved',
        plannerEligible: true,
        importedFrom: 'openclaw',
        provenanceKinds: ['external'],
      },
    }),
    listPendingMemoryReviews: vi.fn().mockResolvedValue({
      memoryReviews: [{
        id: 'memory-pending-1',
        summary: 'Imported roadmap memory',
        content: 'Imported roadmap memory content',
        createdAt: '2026-01-01T00:00:00.000Z',
        memoryType: 'semantic',
        importance: 0.8,
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        source: 'durable',
        scopeVisibility: 'project',
        importState: 'imported_quarantined',
        approvalState: 'pending_approval',
        plannerEligible: false,
        importedFrom: 'openclaw',
        provenanceKinds: ['external'],
      }],
    }),
    previewOpenClawMigration: vi.fn().mockResolvedValue({
      artifact: {
        id: 'openclaw-report-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-report-1.json',
        sha256: 'sha-openclaw-report',
        createdAt: '2026-01-01T00:03:00.000Z',
        meta: { memoryKind: 'openclaw_import_report', workspaceId: session.workspaceId },
      },
      report: {
        schemaVersion: 'openclaw_migration_report.v1',
        generatedAt: '2026-01-01T00:03:00.000Z',
        workspaceId: session.workspaceId,
        sourceRoot: '/tmp/openclaw-workspace',
        counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 },
        entries: [{
          sourceRelPath: 'MEMORY.md',
          sourceKind: 'personality',
          memoryType: 'semantic',
          fingerprint: 'fp-1',
          bytes: 12,
          mtime: '2026-01-01T00:00:00.000Z',
          summary: 'MEMORY.md: imported memory',
          redactionCount: 0,
        }],
        skipped: [],
      },
    }),
    getLatestOpenClawMigrationReport: vi.fn().mockResolvedValue({
      artifact: {
        id: 'openclaw-report-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-report-1.json',
        sha256: 'sha-openclaw-report',
        createdAt: '2026-01-01T00:03:00.000Z',
        meta: { memoryKind: 'openclaw_import_report', workspaceId: session.workspaceId },
      },
      report: {
        schemaVersion: 'openclaw_migration_report.v1',
        generatedAt: '2026-01-01T00:03:00.000Z',
        workspaceId: session.workspaceId,
        sourceRoot: '/tmp/openclaw-workspace',
        counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 },
        entries: [],
        skipped: [],
      },
    }),
    importOpenClawMigration: vi.fn().mockResolvedValue({
      schemaVersion: 'openclaw_migration_result.v1',
      migrationId: 'openclaw-migration-1',
      imported: 1,
      skipped: 0,
      memoryIds: ['memory-import-1'],
      importedEntries: [{
        sourceRelPath: 'MEMORY.md',
        sourceKind: 'personality',
        memoryType: 'semantic',
        fingerprint: 'fp-1',
        memoryId: 'memory-import-1',
      }],
      skippedEntries: [],
      rollbackPlan: {
        status: 'prepared_not_executed',
        action: 'revoke_imported_memories',
        memoryIds: ['memory-import-1'],
        note: 'Use this manifest to revoke imported memories.',
      },
      artifact: {
        id: 'openclaw-result-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-result-1.json',
        sha256: 'sha-openclaw-result',
        createdAt: '2026-01-01T00:04:00.000Z',
        meta: { workspaceId: session.workspaceId, memoryKind: 'openclaw_import_result' },
      },
    }),
    rollbackOpenClawMigration: vi.fn().mockResolvedValue({
      schemaVersion: 'openclaw_migration_rollback_result.v1',
      migrationId: 'openclaw-migration-1',
      workspaceId: session.workspaceId,
      rolledBackAt: '2026-01-01T00:05:00.000Z',
      requested: 1,
      matched: 1,
      revoked: 1,
      missingIds: [],
      skippedIds: [],
      alreadyRevokedIds: [],
      artifact: {
        id: 'openclaw-rollback-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-rollback-1.json',
        sha256: 'sha-openclaw-rollback',
        createdAt: '2026-01-01T00:05:00.000Z',
        meta: { workspaceId: session.workspaceId, memoryKind: 'openclaw_rollback_result' },
      },
    }),
    verifyOpenClawMigration: vi.fn().mockResolvedValue({
      schemaVersion: 'openclaw_migration_verification_result.v1',
      migrationId: 'openclaw-migration-1',
      verifiedAt: '2026-01-01T00:06:00.000Z',
      totalMemories: 1,
      foundCount: 1,
      missCount: 0,
      searchAttemptsFailed: 0,
      entries: [{
        memoryId: 'memory-import-1',
        sourceRelPath: 'MEMORY.md',
        sourceKind: 'personality',
        memoryType: 'semantic',
        searchAttempts: 1,
        foundInResults: true,
        matchedSummary: 'MEMORY.md: Imported memory',
      }],
      artifact: {
        id: 'openclaw-verify-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-verify-1.json',
        sha256: 'sha-openclaw-verify',
        createdAt: '2026-01-01T00:06:00.000Z',
        meta: { workspaceId: session.workspaceId, memoryKind: 'openclaw_verification_result' },
      },
    }),
    getOpenClawMigrationAudit: vi.fn().mockResolvedValue({
      schemaVersion: 'openclaw_migration_audit.v1',
      generatedAt: '2026-01-01T00:07:00.000Z',
      workspaceId: session.workspaceId,
      migrations: [{
        migrationId: 'openclaw-migration-1',
        workspaceId: session.workspaceId,
        status: 'needs_review',
        importedAt: '2026-01-01T00:04:00.000Z',
        imported: 1,
        skipped: 0,
        memoryIds: ['memory-import-1'],
        importArtifact: {
          id: 'openclaw-result-1.json',
          kind: 'summary',
          uri: '/tmp/openclaw-result-1.json',
          sha256: 'sha-openclaw-result',
          createdAt: '2026-01-01T00:04:00.000Z',
          meta: { workspaceId: session.workspaceId, memoryKind: 'openclaw_import_result' },
        },
        latestVerification: {
          artifact: {
            id: 'openclaw-verify-1.json',
            kind: 'summary',
            uri: '/tmp/openclaw-verify-1.json',
            sha256: 'sha-openclaw-verify',
            createdAt: '2026-01-01T00:06:00.000Z',
            meta: { workspaceId: session.workspaceId, memoryKind: 'openclaw_verification_result' },
          },
          verifiedAt: '2026-01-01T00:06:00.000Z',
          totalMemories: 1,
          foundCount: 0,
          missCount: 1,
          searchAttemptsFailed: 0,
          quarantineCandidateCount: 1,
          searchFailureCount: 0,
        },
        quarantineCandidates: [{
          migrationId: 'openclaw-migration-1',
          memoryId: 'memory-import-1',
          sourceRelPath: 'MEMORY.md',
          sourceKind: 'personality',
          memoryType: 'semantic',
          reason: 'verification_missed',
          verificationArtifactId: 'openclaw-verify-1.json',
          verificationSha256: 'sha-openclaw-verify',
        }],
        searchFailures: [],
      }],
      quarantineCandidates: [{
        migrationId: 'openclaw-migration-1',
        memoryId: 'memory-import-1',
        sourceRelPath: 'MEMORY.md',
        sourceKind: 'personality',
        memoryType: 'semantic',
        reason: 'verification_missed',
        verificationArtifactId: 'openclaw-verify-1.json',
        verificationSha256: 'sha-openclaw-verify',
      }],
      searchFailures: [],
      artifactCounts: { importResults: 1, verificationResults: 1, rollbackResults: 0, invalidArtifacts: 0 },
      warnings: [],
    }),
    getOpenClawMigrationQuarantine: vi.fn().mockResolvedValue({
      schemaVersion: 'openclaw_quarantine_state.v1',
      generatedAt: '2026-01-01T00:07:00.000Z',
      workspaceId: session.workspaceId,
      candidateCount: 1,
      searchFailureCount: 0,
      candidates: [{
        migrationId: 'openclaw-migration-1',
        memoryId: 'memory-import-1',
        sourceRelPath: 'MEMORY.md',
        sourceKind: 'personality',
        memoryType: 'semantic',
        reason: 'verification_missed',
        verificationArtifactId: 'openclaw-verify-1.json',
        verificationSha256: 'sha-openclaw-verify',
      }],
      searchFailures: [],
      sourceMigrationCount: 1,
    }),
    listSessions: vi.fn().mockResolvedValue([session]),
    getSession: vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === session.id ? { ...session, messages, metadata: { workspaceId: session.workspaceId } } : null
    )),
    getSessionTimeline: vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === session.id
        ? {
            sessionId: session.id,
            workspaceId: session.workspaceId,
            summary: session.summary,
            events: messages.map((message, index) => ({
              id: message.id,
              sessionId: session.id,
              type: 'message' as const,
              role: message.role,
              content: message.content,
              createdAt: message.createdAt,
              index,
            })),
          }
        : null
    )),
    createDailyMemoryRollup: vi.fn().mockResolvedValue({
      date: '2026-01-01',
      workspaceId: session.workspaceId,
      agentId: 'pyrfor-runtime',
      sessionCount: 1,
      messageCount: 2,
      ledgerEventCount: 0,
      runIds: [],
      summary: 'Daily rollup for 2026-01-01: 1 sessions, 2 messages, 0 ledger events.',
      content: '# Pyrfor daily memory rollup',
      memoryId: 'memory-1',
    }),
    createProjectMemoryRollup: vi.fn().mockResolvedValue({
      workspaceId: session.workspaceId,
      projectId: 'project-1',
      agentId: 'pyrfor-runtime',
      sessionCount: 1,
      ledgerEventCount: 2,
      runIds: ['run-1'],
      artifact: {
        id: 'project-rollup-1.json',
        kind: 'summary',
        uri: '/tmp/project-rollup-1.json',
        sha256: 'sha-project-rollup',
        createdAt: '2026-01-01T00:05:00.000Z',
        meta: { memoryKind: 'project_rollup' },
      },
      memories: [{
        category: 'decision',
        memoryType: 'semantic',
        summary: 'Decisions for project project-1: approved migration',
        content: 'approved migration',
        memoryId: 'project-memory-1',
      }],
    }),
    getRunContextPack: vi.fn().mockResolvedValue({
      artifact: {
        id: 'context-pack-1.json',
        kind: 'context_pack',
        uri: '/tmp/context-pack-1.json',
        sha256: 'sha-context-pack',
        createdAt: '2026-01-01T00:06:00.000Z',
      },
      pack: {
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-run-1',
        hash: 'hash-context',
        compiledAt: '2026-01-01T00:06:00.000Z',
        runId: 'run-1',
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        task: { title: 'Build product', description: `${'sensitive prompt '.repeat(80)}tail` },
        sections: [{
          id: 'project_memory',
          kind: 'memory',
          title: 'Project memory',
          priority: 50,
          content: `${'private memory '.repeat(80)}tail`,
          sources: [{ kind: 'memory', ref: 'memory-1', role: 'memory' }],
        }],
        sourceRefs: [],
      },
    }),
    getRunTimeline: vi.fn().mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product from /tmp/private-spec.md',
        workspace_id: session.workspaceId,
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'autonomous',
        status: 'completed',
        artifact_refs: ['artifact-1', 'artifact-evidence'],
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:08:00.000Z',
        budget_profile: { token: 'secret-budget-token' },
      },
      events: [
        {
          id: 'evt-run-1',
          ts: '2026-01-01T00:00:00.000Z',
          seq: 1,
          run_id: 'run-1',
          type: 'run.created',
          goal: 'Build product from /tmp/private-spec.md token=secret',
        },
        {
          id: 'evt-run-2',
          ts: '2026-01-01T00:08:00.000Z',
          seq: 2,
          run_id: 'run-1',
          type: 'supervisor.decision',
          action: 'rotate_context',
          reason: 'See /Users/aleksandrgrebeshok/private.txt token=secret',
          decision_vector: { phase: 'execute', remainingBudget: 1200 },
        },
      ],
      contextPack: {
        artifact: {
          id: 'context-pack-1.json',
          kind: 'context_pack',
          uri: '/tmp/context-pack-1.json',
          sha256: 'sha-context-pack',
          createdAt: '2026-01-01T00:06:00.000Z',
        },
        pack: {
          schemaVersion: 'context_pack.v1',
          packId: 'ctx-run-1',
          hash: 'hash-context',
          compiledAt: '2026-01-01T00:06:00.000Z',
          runId: 'run-1',
          workspaceId: session.workspaceId,
          projectId: 'project-1',
          task: { title: 'Build product', description: `${'sensitive prompt '.repeat(80)}tail` },
          sections: [{
            id: 'project_memory',
            kind: 'memory',
            title: 'Project memory',
            priority: 50,
            content: `${'private memory '.repeat(80)}tail`,
            sources: [{ kind: 'memory', ref: 'memory-1', role: 'memory' }],
          }],
          sourceRefs: [],
        },
      },
      deliveryEvidence: {
        artifact: {
          id: 'artifact-evidence',
          kind: 'delivery_evidence',
          uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-evidence.json',
          sha256: 'evidence-sha',
          createdAt: '2026-05-01T00:00:00.000Z',
        },
        snapshot: {
          schemaVersion: 'pyrfor.delivery_evidence.v1',
          runId: 'run-1',
          capturedAt: '2026-05-01T00:00:00.000Z',
          summary: 'Delivered /tmp/private-spec.md token=secret',
          git: {
            branch: 'main',
            commit: 'abc123',
            remote: 'git@github.com:alex/private.git',
            dirty: false,
          },
        },
      },
      replay: { available: true },
    }),
    refreshRunContextPack: vi.fn().mockResolvedValue({
      artifact: {
        id: 'context-pack-2.json',
        kind: 'context_pack',
        uri: '/tmp/context-pack-2.json',
        sha256: 'sha-context-pack-2',
        createdAt: '2026-01-01T00:07:00.000Z',
      },
      previousArtifact: {
        id: 'context-pack-1.json',
        kind: 'context_pack',
        uri: '/tmp/context-pack-1.json',
        sha256: 'sha-context-pack',
        createdAt: '2026-01-01T00:06:00.000Z',
      },
      pack: {
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-run-1',
        hash: 'hash-context-2',
        compiledAt: '2026-01-01T00:07:00.000Z',
        runId: 'run-1',
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        task: { title: 'Build product' },
        sections: [{
          id: 'run_evidence',
          kind: 'evidence',
          title: 'Run evidence',
          priority: 58,
          content: { items: [{ artifactKind: 'delivery_evidence' }] },
          sources: [{ kind: 'artifact', ref: 'delivery-evidence-1.json', role: 'evidence' }],
        }],
        sourceRefs: [{ kind: 'artifact', ref: 'delivery-evidence-1.json', role: 'evidence' }],
      },
    }),
  } as unknown as PyrforRuntime;
}

function makeOrchestrationDeps(): NonNullable<GatewayDeps['orchestration']> {
  return {
    runLedger: {
      listRuns: vi.fn().mockReturnValue([]),
      getRun: vi.fn(),
      replayRun: vi.fn(),
      eventsForRun: vi.fn().mockResolvedValue([]),
      transition: vi.fn(),
      completeRun: vi.fn(),
    },
    eventLedger: {
      append: vi.fn(),
      readAll: vi.fn().mockResolvedValue([]),
      byRun: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockReturnValue(() => {}),
    },
    dag: {
      listNodes: vi.fn().mockReturnValue([]),
    },
    memoryStore: {
      query: vi.fn().mockReturnValue([]),
    },
  } as unknown as NonNullable<GatewayDeps['orchestration']>;
}

function makeConceptRecord(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    conceptId: 'concept-1',
    goal: 'test goal',
    runId: 'run-ue-1',
    status: 'done',
    phases: ['plan', 'execute', 'done'],
    artifactRefs: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
}

function makeUniversalEngine(record: ConceptRecord = makeConceptRecord()): Pick<UniversalEngineOrchestrator, 'dispatchConcept' | 'getConceptRecord' | 'listConcepts' | 'abort'> {
  const handle = {
    conceptId: record.conceptId,
    runId: record.runId,
    status: vi.fn(() => 'queued'),
    promise: vi.fn().mockResolvedValue(record),
    abort: vi.fn(),
  };
  return {
    dispatchConcept: vi.fn().mockReturnValue(handle),
    getConceptRecord: vi.fn().mockReturnValue(record),
    listConcepts: vi.fn().mockReturnValue([record]),
    abort: vi.fn(),
  };
}

// ─── Minimal mock health monitor ──────────────────────────────────────────

function makeHealth(status: 'healthy' | 'unhealthy' = 'healthy'): HealthMonitor {
  return {
    getLastSnapshot: vi.fn().mockReturnValue({ status, checks: {} }),
  } as unknown as HealthMonitor;
}

// ─── Minimal mock cron service ─────────────────────────────────────────────

function makeCron(): CronService {
  return {
    getStatus: vi.fn().mockReturnValue([{ name: 'daily', enabled: true }]),
    triggerJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as CronService;
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

async function get(
  port: number,
  path: string,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function post(
  port: number,
  path: string,
  payload: unknown,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function options(
  port: number,
  path: string
): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'OPTIONS' });
  return { status: res.status, headers: res.headers };
}

/** Send raw string body (e.g. malformed JSON) via POST. */
async function postRaw(
  port: number,
  path: string,
  body: string,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Send GET with a raw Authorization header value (no automatic "Bearer " prefix). */
async function getRawAuth(
  port: number,
  path: string,
  authHeader: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: authHeader },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function parseSSE(raw: string): Array<{ event?: string; data: unknown }> {
  const messages: Array<{ event?: string; data: unknown }> = [];
  for (const frame of raw.split(/\n\n+/)) {
    if (!frame.trim()) continue;
    let event: string | undefined;
    let dataLine: string | undefined;
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length).trim();
      if (line.startsWith('data: ')) dataLine = line.slice('data: '.length).trim();
    }
    if (dataLine === undefined) continue;
    let data: unknown = dataLine;
    try { data = JSON.parse(dataLine); } catch { /* keep string */ }
    messages.push({ event, data });
  }
  return messages;
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (messages: Array<{ event?: string; data: unknown }>) => boolean,
): Promise<Array<{ event?: string; data: unknown }>> {
  const decoder = new TextDecoder();
  let raw = '';
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((resolve) => setTimeout(() => resolve({ done: true }), remaining)),
    ]);
    if (result.done && !result.value) break;
    if (result.value) raw += decoder.decode(result.value, { stream: true });
    const messages = parseSSE(raw);
    if (predicate(messages)) return messages;
  }
  return parseSSE(raw);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('createRuntimeGateway', () => {
  let port: number;

  describe('no auth configured', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;
    let runtime: PyrforRuntime;
    let cron: CronService;

    beforeEach(async () => {
      runtime = makeRuntime();
      cron = makeCron();
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime,
        health: makeHealth(),
        cron,
        connectorInventory: {
          getSnapshot: () => ({
            checkedAt: '2026-05-04T00:00:00.000Z',
            statusSource: 'local-config',
            connectors: [{
              id: 'telegram',
              name: 'Telegram',
              description: 'Telegram bridge',
              direction: 'bidirectional',
              sourceSystem: 'Telegram Bot API',
              operations: ['Receive commands'],
              credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
              apiSurface: [{ method: 'WEBHOOK', path: '/api/telegram/webhook', description: 'Webhook' }],
              stub: false,
              configured: false,
              missingSecrets: ['TELEGRAM_BOT_TOKEN'],
              hasProbe: true,
              readiness: {
                state: 'pending',
                reasons: ['Missing required env: TELEGRAM_BOT_TOKEN'],
                nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
              },
              probePreview: {
                mode: 'descriptor-status',
                requiresApproval: true,
                requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
                headerNames: [],
                bodyConfigured: false,
                note: 'Live status comes from the connector adapter and is not executed by inventory.',
              },
              liveProbeSkipped: true,
              statusSource: 'local-config',
            }],
            summary: { total: 1, configured: 0, pending: 1, stubs: 0, liveProbeSkipped: 1 },
          }),
        },
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => {
      await gw.stop();
    });

    it('GET /ping returns 200 { ok: true } without auth', async () => {
      const { status, body } = await get(port, '/ping');
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true });
    });

    it('GET /health returns 200 with snapshot', async () => {
      const { status, body } = await get(port, '/health');
      expect(status).toBe(200);
      expect(body).toMatchObject({ status: 'healthy' });
    });

    it('GET /health returns 503 when status is unhealthy', async () => {
      const gwUnhealthy = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth('unhealthy'),
      });
      await gwUnhealthy.start();
      const p = gwUnhealthy.port;
      const { status } = await get(p, '/health');
      await gwUnhealthy.stop();
      expect(status).toBe(503);
    });

    it('GET /status returns uptime, config, cron, health', async () => {
      const { status, body } = await get(port, '/status');
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(typeof b['uptime']).toBe('number');
      expect(b).toHaveProperty('config');
      expect(b).toHaveProperty('cron');
      expect(b).toHaveProperty('health');
    });

    it('GET /cron/jobs returns job list', async () => {
      const { status, body } = await get(port, '/cron/jobs');
      expect(status).toBe(200);
      expect((body as { jobs: unknown[] }).jobs).toHaveLength(1);
    });

    it('POST /cron/trigger calls cron.triggerJob', async () => {
      const { status, body } = await post(port, '/cron/trigger', { name: 'daily' });
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, name: 'daily' });
      expect(vi.mocked(cron.triggerJob)).toHaveBeenCalledWith('daily');
    });

    it('POST /cron/trigger returns 400 when name missing', async () => {
      const { status } = await post(port, '/cron/trigger', {});
      expect(status).toBe(400);
    });

    it('POST /v1/chat/completions returns OpenAI-shaped response', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'Hi there' }],
      });
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b['object']).toBe('chat.completion');
      const choices = b['choices'] as Array<{
        index: number;
        message: { role: string; content: string };
        finish_reason: string;
      }>;
      expect(choices).toHaveLength(1);
      expect(choices[0].index).toBe(0);
      expect(choices[0].message.role).toBe('assistant');
      expect(choices[0].message.content).toBe('hello from mock');
      expect(choices[0].finish_reason).toBe('stop');
      expect(typeof b['id']).toBe('string');
      expect(typeof b['created']).toBe('number');
    });

    it('POST /api/chat routes FreeClaude execution mode through worker transport', async () => {
      const config = makeConfig();
      config.executionMode = 'freeclaude';
      const modeRuntime = makeRuntime();
      const modeGw = createRuntimeGateway({ config, runtime: modeRuntime, orchestration: makeOrchestrationDeps() });
      await modeGw.start();
      try {
        const { status, body } = await post(modeGw.port, '/api/chat', { text: 'Hi there' });
        expect(status).toBe(200);
        expect(body).toMatchObject({
          reply: 'hello from mock',
        });
        expect((body as Record<string, unknown>)['execution']).toBeUndefined();
        expect(vi.mocked(modeRuntime.handleMessage)).toHaveBeenCalledWith(
          'http',
          'ide-user',
          'ide-chat',
          'Hi there',
          { worker: { transport: 'freeclaude' } },
        );
      } finally {
        await modeGw.stop();
      }
    });

    it('POST /api/chat multipart routes FreeClaude execution mode through worker transport', async () => {
      const config = makeConfig();
      config.executionMode = 'freeclaude';
      const modeRuntime = makeRuntime();
      const modeGw = createRuntimeGateway({ config, runtime: modeRuntime, orchestration: makeOrchestrationDeps() });
      await modeGw.start();
      try {
        const form = new FormData();
        form.set('text', 'Hi multipart');
        form.set('sessionId', 'sess-multipart');
        const res = await fetch(`http://127.0.0.1:${modeGw.port}/api/chat`, {
          method: 'POST',
          body: form,
        });
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(body).toMatchObject({
          reply: 'hello from mock',
          attachments: [],
        });
        expect(body['execution']).toBeUndefined();
        expect(vi.mocked(modeRuntime.handleMessage)).toHaveBeenCalledWith(
          'http',
          'ide-user',
          'ide-chat',
          'Hi multipart',
          { sessionId: 'sess-multipart', worker: { transport: 'freeclaude' } },
        );
      } finally {
        await modeGw.stop();
      }
    });

    it('POST /api/chat surfaces FreeClaude worker failures instead of an empty successful reply', async () => {
      const config = makeConfig();
      config.executionMode = 'freeclaude';
      const modeRuntime = {
        ...makeRuntime(),
        handleMessage: vi.fn().mockResolvedValue({
          success: false,
          response: '',
          error: 'guardrail-block: tier forbidden',
          runId: 'run-failed',
          taskId: 'task-failed',
        }),
      } as unknown as PyrforRuntime;
      const modeGw = createRuntimeGateway({ config, runtime: modeRuntime, orchestration: makeOrchestrationDeps() });
      await modeGw.start();
      try {
        const { status, body } = await post(modeGw.port, '/api/chat', { text: 'Hi there' });
        expect(status).toBe(500);
        expect(body).toMatchObject({
          error: 'guardrail-block: tier forbidden',
          runId: 'run-failed',
          taskId: 'task-failed',
        });
      } finally {
        await modeGw.stop();
      }
    });

    it('POST /api/chat/stream routes FreeClaude execution mode through worker transport', async () => {
      const config = makeConfig();
      config.executionMode = 'freeclaude';
      const modeRuntime = {
        ...makeRuntime(),
        streamChatRequest: vi.fn(async function* () {
          yield { type: 'token', text: 'hello' };
          yield { type: 'final', text: ' done' };
        }),
      } as unknown as PyrforRuntime;
      const modeGw = createRuntimeGateway({ config, runtime: modeRuntime, orchestration: makeOrchestrationDeps() });
      await modeGw.start();
      try {
        const res = await fetch(`http://127.0.0.1:${modeGw.port}/api/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Hi there' }),
        });
        expect(res.status).toBe(200);
        const raw = await res.text();
        const messages = parseSSE(raw);
        expect(messages[0]).toMatchObject({ data: { type: 'token', text: 'hello' } });
        expect(messages[1]).toMatchObject({ data: { type: 'final', text: ' done' } });
        expect(messages[messages.length - 1]).toMatchObject({ event: 'done', data: {} });
        expect(vi.mocked(modeRuntime.streamChatRequest)).toHaveBeenCalledWith(
          expect.objectContaining({ worker: { transport: 'freeclaude' } }),
        );
      } finally {
        await modeGw.stop();
      }
    });

    it('POST /v1/chat/completions forwards channel/userId/chatId to runtime', async () => {
      await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'ping' }],
        channel: 'telegram',
        userId: 'u1',
        chatId: 'c1',
      });
      expect(vi.mocked(runtime.handleMessage)).toHaveBeenCalledWith(
        'telegram',
        'u1',
        'c1',
        'ping'
      );
    });

    it('POST /v1/chat/completions returns 400 when messages empty', async () => {
      const { status } = await post(port, '/v1/chat/completions', { messages: [] });
      expect(status).toBe(400);
    });

    it('OPTIONS returns 204 with CORS headers', async () => {
      const { status, headers } = await options(port, '/v1/chat/completions');
      expect(status).toBe(204);
      expect(headers.get('access-control-allow-origin')).toBe('*');
      expect(headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('unknown route returns 404', async () => {
      const { status } = await get(port, '/not-a-real-route');
      expect(status).toBe(404);
    });

    it('GET /metrics returns 200 text/plain with Prometheus format', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toContain('# HELP pyrfor_runtime_uptime_seconds');
      expect(body).toContain('# TYPE pyrfor_runtime_uptime_seconds gauge');
      expect(body).toContain('pyrfor_runtime_uptime_seconds');
      expect(body).toContain('pyrfor_cron_jobs_registered');
    });

    it('GET /metrics includes cron and health data when deps provided', async () => {
      const gwFull = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth('healthy'),
        cron: makeCron(),
      });
      await gwFull.start();
      const p = gwFull.port;
      try {
        const res = await fetch(`http://127.0.0.1:${p}/metrics`);
        expect(res.status).toBe(200);
        const body = await res.text();
        // Health data (makeHealth returns checks: {} so no check lines, but snapshot exists)
        expect(body).toContain('pyrfor_runtime_uptime_seconds');
        // Cron data (makeCron returns [{name:'daily', ...}])
        expect(body).toContain('pyrfor_cron_jobs_registered 1');
      } finally {
        await gwFull.stop();
      }
    });

    it('stop() closes server cleanly (no hanging handles)', async () => {
      await gw.stop();
      // Double stop should not throw
      await gw.stop();
    });
  });

  describe('bearer auth configured', () => {
    const TOKEN = 'test-secret-token';
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig({ bearerToken: TOKEN }),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => {
      await gw.stop();
    });

    it('GET /ping accessible without auth', async () => {
      const { status } = await get(port, '/ping');
      expect(status).toBe(200);
    });

    it('GET /health accessible without auth', async () => {
      const { status } = await get(port, '/health');
      expect(status).toBe(200);
    });

    it('GET /api/settings/execution-mode accessible without auth', async () => {
      const { status, body } = await get(port, '/api/settings/execution-mode');
      expect(status).toBe(200);
      expect(body).toMatchObject({ executionMode: 'pyrfor' });
    });

    it('GET /metrics returns 401 without bearer token', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(401);
    });

    it('GET /metrics returns 200 with valid bearer token', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
    });

    it('GET /api/agents returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/agents');
      expect(status).toBe(401);
    });

    it('GET /api/settings returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/settings');
      expect(status).toBe(401);
    });

    it('GET /api/effects/pending returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/effects/pending');
      expect(status).toBe(401);
    });

    it('GET /api/approvals/pending returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/approvals/pending');
      expect(status).toBe(401);
    });

    it('GET /api/audit/events returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/audit/events');
      expect(status).toBe(401);
    });

    it('POST /api/approvals/:id/decision returns 401 without bearer token', async () => {
      const { status } = await post(port, '/api/approvals/approval-1/decision', { decision: 'approve' });
      expect(status).toBe(401);
    });

    it('POST /api/memory/project-rollup returns 401 without bearer token', async () => {
      const { status } = await post(port, '/api/memory/project-rollup', { projectId: 'project-1' });
      expect(status).toBe(401);
    });

    it('GET /api/memory/continuity returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/memory/continuity');
      expect(status).toBe(401);
    });

    it('GET /api/runs/:runId/actors returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/runs/run-1/actors');
      expect(status).toBe(401);
    });

    it('GET /api/runs/:runId/actors/messages returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/runs/run-1/actors/messages');
      expect(status).toBe(401);
    });

    it('run detail subresources return 401 without bearer token', async () => {
      expect((await get(port, '/api/runs/run-1/events')).status).toBe(401);
      expect((await get(port, '/api/runs/run-1/dag')).status).toBe(401);
      expect((await get(port, '/api/runs/run-1/frames')).status).toBe(401);
    });

    it('GET /api/runs returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/runs');
      expect(status).toBe(401);
    });

    it('skill inspector routes return 401 without bearer token', async () => {
      expect((await get(port, '/api/skills')).status).toBe(401);
      expect((await post(port, '/api/skills/recommend', { task: 'Fix TypeScript error' })).status).toBe(401);
    });

    it('GET /api/slash-commands returns 401 without bearer token', async () => {
      expect((await get(port, '/api/slash-commands')).status).toBe(401);
    });

    it('GET /api/settings/provider-routing-preview returns 401 without bearer token', async () => {
      expect((await get(port, '/api/settings/provider-routing-preview')).status).toBe(401);
    });

    it('POST /api/settings/execution-mode returns 401 without bearer token', async () => {
      expect((await post(port, '/api/settings/execution-mode', { executionMode: 'freeclaude' })).status).toBe(401);
    });

    it('GET /api/ochag/privacy returns 401 without bearer token', async () => {
      expect((await get(port, '/api/ochag/privacy')).status).toBe(401);
    });

    it('GET /api/release/readiness returns 401 without bearer token', async () => {
      expect((await get(port, '/api/release/readiness')).status).toBe(401);
    });

    it('POST /api/product-factory/plan returns 401 without bearer token', async () => {
      expect((await post(port, '/api/product-factory/plan', {
        templateId: 'ui_scaffold',
        prompt: 'Build settings panel',
      })).status).toBe(401);
    });

    it('vertical Product Factory wrapper routes return 401 without bearer token', async () => {
      expect((await post(port, '/api/ochag/reminders/preview', { title: 'Dinner reminder' })).status).toBe(401);
      expect((await post(port, '/api/ochag/reminders', { title: 'Dinner reminder' })).status).toBe(401);
      expect((await post(port, '/api/ceoclaw/briefs/preview', { decision: 'Approve contract' })).status).toBe(401);
      expect((await post(port, '/api/ceoclaw/briefs', { decision: 'Approve contract' })).status).toBe(401);
    });

    it('POST /api/slash-commands/invoke returns 401 without bearer token', async () => {
      expect((await post(port, '/api/slash-commands/invoke', { command: '/skills' })).status).toBe(401);
    });

    it('GET /api/stats returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/stats');
      expect(status).toBe(401);
    });

    it('GET /status returns 401 without bearer token', async () => {
      const { status, body } = await get(port, '/status');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['error']).toBe('unauthorized');
    });

    it('GET /status returns 200 with valid bearer token', async () => {
      const { status } = await get(port, '/status', TOKEN);
      expect(status).toBe(200);
    });

    it('POST /v1/chat/completions returns 401 without bearer token', async () => {
      const { status } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(status).toBe(401);
    });

    it('POST /v1/chat/completions returns 200 with valid bearer token', async () => {
      const { status } = await post(
        port,
        '/v1/chat/completions',
        { messages: [{ role: 'user', content: 'hi' }] },
        TOKEN
      );
      expect(status).toBe(200);
    });

    it('POST /cron/trigger returns 401 with wrong token', async () => {
      const { status, body } = await post(
        port,
        '/cron/trigger',
        { name: 'daily' },
        'wrong-token'
      );
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['reason']).toBe('unknown');
    });
  });

  describe('bearer token rotation', () => {
    const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
    const PAST = new Date(Date.now() - 86_400_000).toISOString();
    let gw: ReturnType<typeof createRuntimeGateway>;

    afterEach(async () => {
      await gw.stop();
    });

    it('accepts a valid rotated token from bearerTokens list', async () => {
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'rotatedtoken1', label: 'v2', expiresAt: FUTURE }],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
      });
      await gw.start();
      const { status } = await get(gw.port, '/status', 'rotatedtoken1');
      expect(status).toBe(200);
    });

    it('derives verifier waiver operator identity from authenticated token label', async () => {
      const runtime = {
        createRunVerifierWaiver: vi.fn().mockResolvedValue({
          artifact: { id: 'artifact-waiver', kind: 'verifier_waiver' },
          waiver: { schemaVersion: 'pyrfor.verifier_waiver.v1', operator: { id: 'token:operator-a', name: 'operator-a' } },
          decision: { status: 'waived', rawStatus: 'blocked' },
          run: { run_id: 'run-pf-1', status: 'completed' },
        }),
      } as unknown as PyrforRuntime & { createRunVerifierWaiver: ReturnType<typeof vi.fn> };
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'operator-token', label: 'operator-a', expiresAt: FUTURE }],
        }),
        runtime,
        health: makeHealth(),
      });
      await gw.start();

      const result = await post(gw.port, '/api/runs/run-pf-1/verifier-waiver', {
        operatorId: 'spoofed-operator',
        operatorName: 'Spoofed Operator',
        reason: 'Accepted known risk',
      }, 'operator-token');

      expect(result.status).toBe(201);
      expect(runtime.createRunVerifierWaiver).toHaveBeenCalledWith('run-pf-1', {
        operatorId: 'token:operator-a',
        operatorName: 'operator-a',
        reason: 'Accepted known risk',
      });
    });

    it('derives memory correction operator identity from authenticated token label', async () => {
      const runtime = {
        createMemoryCorrection: vi.fn().mockResolvedValue({
          memory: {
            id: 'memory-correction-1',
            content: 'corrected fact',
            createdAt: '2026-01-01T00:00:00.000Z',
            memoryType: 'semantic',
            importance: 0.8,
            source: 'durable',
          },
        }),
      } as unknown as PyrforRuntime & { createMemoryCorrection: ReturnType<typeof vi.fn> };
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'operator-token', label: 'operator-a', expiresAt: FUTURE }],
        }),
        runtime,
        health: makeHealth(),
      });
      await gw.start();

      const result = await post(gw.port, '/api/memory/corrections', {
        content: 'corrected fact',
        operatorId: 'spoofed-operator',
      }, 'operator-token');

      expect(result.status).toBe(201);
      expect(runtime.createMemoryCorrection).toHaveBeenCalledWith(expect.objectContaining({
        content: 'corrected fact',
        operatorId: 'token:operator-a',
      }));
    });

    it('returns controlled error when memory correction is not durably persisted', async () => {
      const runtime = {
        createMemoryCorrection: vi.fn().mockRejectedValue(new Error('Memory correction was not durably persisted')),
      } as unknown as PyrforRuntime;
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime,
        health: makeHealth(),
      });
      await gw.start();

      const result = await post(gw.port, '/api/memory/corrections', {
        content: 'corrected fact',
      });

      expect(result.status).toBe(503);
      expect((result.body as Record<string, unknown>)['error']).toBe('memory_persistence_failed');
    });

    it('rejects an expired token from bearerTokens list with reason expired', async () => {
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'expiredtoken1', label: 'old', expiresAt: PAST }],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
      });
      await gw.start();
      const { status, body } = await get(gw.port, '/status', 'expiredtoken1');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['reason']).toBe('expired');
    });
  });

  describe('rate limiting', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(undefined, {
          enabled: true,
          capacity: 2,
          refillPerSec: 1,
          exemptPaths: ['/ping', '/health', '/metrics'],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => {
      await gw.stop();
    });

    it('third request to /status returns 429 with Retry-After', async () => {
      const first = await get(port, '/status');
      expect(first.status).toBe(200);

      const second = await get(port, '/status');
      expect(second.status).toBe(200);

      const third = await get(port, '/status');
      expect(third.status).toBe(429);
      expect((third.body as Record<string, unknown>)['error']).toBe('rate_limited');
      expect((third.body as Record<string, unknown>)['retryAfterMs']).toBeGreaterThan(0);
    });

    it('429 response includes Retry-After header in seconds', async () => {
      await get(port, '/status');
      await get(port, '/status');
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('retry-after');
      expect(retryAfter).toBeTruthy();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });

    it('exempt paths are not rate-limited', async () => {
      // Exhaust the rate limit via /status
      await get(port, '/status');
      await get(port, '/status');
      expect((await get(port, '/status')).status).toBe(429);

      // Exempt paths should still respond normally
      expect((await get(port, '/ping')).status).toBe(200);
      expect((await get(port, '/health')).status).toBe(200);
    });
  });

  // ─── NEW: wrong HTTP method ─────────────────────────────────────────────

  describe('wrong HTTP method on known paths', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('GET /v1/chat/completions (expects POST) returns 404', async () => {
      const { status } = await get(port, '/v1/chat/completions');
      expect(status).toBe(404);
    });

    it('POST /ping (expects GET) returns 404', async () => {
      const { status } = await post(port, '/ping', {});
      expect(status).toBe(404);
    });

    it('POST /health (expects GET) returns 404', async () => {
      const { status } = await post(port, '/health', {});
      expect(status).toBe(404);
    });

    it('404 body includes path field', async () => {
      const { status, body } = await get(port, '/totally-unknown');
      expect(status).toBe(404);
      const b = body as Record<string, unknown>;
      expect(b['error']).toBeTruthy();
      expect(b['path']).toBe('/totally-unknown');
    });
  });

  // ─── NEW: malformed JSON body ───────────────────────────────────────────

  describe('malformed JSON body', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('POST /v1/chat/completions with invalid JSON returns 400 invalid_json', async () => {
      const { status, body } = await postRaw(port, '/v1/chat/completions', '{not valid json');
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toBe('invalid_json');
    });

    it('POST /cron/trigger with invalid JSON returns 400 invalid_json', async () => {
      const { status, body } = await postRaw(port, '/cron/trigger', 'not-json-at-all');
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toBe('invalid_json');
    });

    it('POST /v1/chat/completions with truncated JSON returns 400', async () => {
      const { status } = await postRaw(port, '/v1/chat/completions', '{"messages":[');
      expect(status).toBe(400);
    });
  });

  // ─── NEW: missing required fields ──────────────────────────────────────

  describe('missing required fields in /v1/chat/completions', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('no messages field returns 400', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {});
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toMatch(/messages/i);
    });

    it('messages array with entry lacking content returns 400', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user' }],
      });
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toMatch(/content/i);
    });

    it('messages with empty string content returns 400', async () => {
      const { status } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: '' }],
      });
      expect(status).toBe(400);
    });
  });

  // ─── NEW: cron trigger 404 / runtime 500 ───────────────────────────────

  describe('cron trigger errors', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;
    let cron: CronService;

    beforeEach(async () => {
      cron = makeCron();
      gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), cron });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('POST /cron/trigger returns 404 when triggerJob throws', async () => {
      vi.mocked(cron.triggerJob).mockRejectedValue(new Error('job not found: unknown'));
      const { status, body } = await post(port, '/cron/trigger', { name: 'unknown' });
      expect(status).toBe(404);
      expect((body as Record<string, unknown>)['error']).toContain('job not found');
    });

    it('POST /cron/trigger returns 503 when cron service not available', async () => {
      const gwNoCron = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
      await gwNoCron.start();
      const p = gwNoCron.port;
      try {
        const { status, body } = await post(p, '/cron/trigger', { name: 'daily' });
        expect(status).toBe(503);
        expect((body as Record<string, unknown>)['error']).toMatch(/CronService/i);
      } finally {
        await gwNoCron.stop();
      }
    });
  });

  describe('runtime.handleMessage rejection returns 500', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;
    let runtime: PyrforRuntime;

    beforeEach(async () => {
      runtime = makeRuntime();
      vi.mocked(runtime.handleMessage).mockRejectedValue(new Error('boom'));
      gw = createRuntimeGateway({ config: makeConfig(), runtime });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('returns 500 with generic error message', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(status).toBe(500);
      expect((body as Record<string, unknown>)['error']).toBe('Internal server error');
    });
  });

  // ─── NEW: /health response shape ───────────────────────────────────────

  describe('/health response shape', () => {
    it('snapshot includes status and uptimeMs when health monitor provided', async () => {
      const healthMock = {
        getLastSnapshot: vi.fn().mockReturnValue({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptimeMs: 12345,
          restartCount: 0,
          checks: {},
        }),
      } as unknown as HealthMonitor;

      const gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: healthMock,
      });
      await gw.start();
      try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/health`);
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(body['status']).toBe('healthy');
        expect(typeof body['uptimeMs']).toBe('number');
        expect(body['uptimeMs']).toBe(12345);
      } finally {
        await gw.stop();
      }
    });

    it('sanitizes health snapshots before returning /health and /status', async () => {
      const healthMock = {
        getLastSnapshot: vi.fn().mockReturnValue({
          status: 'degraded',
          timestamp: new Date().toISOString(),
          uptimeMs: 12345,
          restartCount: 0,
          checks: {
            connector: {
              name: 'connector',
              critical: false,
              consecutiveFailures: 1,
              healthy: false,
              status: 'degraded',
              message: 'Connector failed at /Users/aleksandrgrebeshok/private with accessToken=health-secret',
              metadata: {
                endpoint: 'https://api.example.test/status?api_key=hidden#fragment',
                OPENAI_API_KEY: 'sk-health-secret',
                note: 'file:///tmp/health.txt; Authorization: Bearer ghp_health_auth',
                checkedAt: new Date('2026-05-04T00:00:00.000Z'),
                docsUrl: new URL('https://docs.example.test/health?accessToken=docs-secret#private'),
              },
            },
          },
        }),
      } as unknown as HealthMonitor;

      const gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: healthMock,
      });
      await gw.start();
      try {
        for (const path of ['/health', '/status']) {
          const res = await fetch(`http://127.0.0.1:${gw.port}${path}`);
          expect(res.status).toBe(path === '/health' ? 200 : 200);
          const body = await res.json() as Record<string, unknown>;
          const serialized = JSON.stringify(body);
          expect(serialized).not.toContain('/Users/aleksandrgrebeshok');
          expect(serialized).not.toContain('health-secret');
          expect(serialized).not.toContain('sk-health-secret');
          expect(serialized).not.toContain('ghp_health_auth');
          expect(serialized).not.toContain('/tmp/health.txt');
          expect(serialized).not.toContain('hidden');
          expect(serialized).not.toContain('docs-secret');
          expect(serialized).not.toContain('private');
          expect(serialized).toContain('[redacted-path]');
          expect(serialized).toContain('accessToken=[redacted]');
          expect(serialized).toContain('api_key=[redacted]');
          expect(serialized).toContain('OPENAI_API_KEY');
          expect(serialized).toContain('Authorization: [redacted]');
          expect(serialized).toContain('file://[redacted-path]');
          expect(serialized).toContain('2026-05-04T00:00:00.000Z');
          expect(serialized).toContain('https://docs.example.test/health?accessToken=[redacted]');
        }
      } finally {
        await gw.stop();
      }
    });

    it('returns { status: "unknown" } when no health monitor', async () => {
      const gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
      await gw.start();
      try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/health`);
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(body['status']).toBe('unknown');
      } finally {
        await gw.stop();
      }
    });
  });

  // ─── NEW: /metrics Prometheus counter lines ─────────────────────────────

  describe('/metrics Prometheus counter format', () => {
    it('includes # TYPE ... counter line for cron job runs', async () => {
      const cronWithRuns = {
        getStatus: vi.fn().mockReturnValue([
          { name: 'nightly', enabled: true, successCount: 5, failureCount: 1 },
        ]),
        triggerJob: vi.fn(),
      } as unknown as CronService;

      const gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        cron: cronWithRuns,
      });
      await gw.start();
      try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/metrics`);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('# TYPE pyrfor_cron_job_runs_total counter');
        expect(body).toContain('pyrfor_cron_job_runs_total{job="nightly"} 6');
        expect(body).toContain('pyrfor_cron_job_failures_total{job="nightly"} 1');
      } finally {
        await gw.stop();
      }
    });
  });

  // ─── NEW: bearer token edge cases ──────────────────────────────────────

  describe('bearer token edge cases', () => {
    const TOKEN = 'secret-edge-token';
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig({ bearerToken: TOKEN }),
        runtime: makeRuntime(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('Authorization without "Bearer " prefix is treated as raw token (wrong value → 401)', async () => {
      // Sending "token-value" without "Bearer " prefix — the gateway uses the whole header as token
      const { status, body } = await getRawAuth(port, '/status', 'not-the-right-token');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['error']).toBe('unauthorized');
    });

    it('Authorization without "Bearer " prefix matching actual token → 200', async () => {
      // Gateway falls back to treating the whole header value as the token
      const { status } = await getRawAuth(port, '/status', TOKEN);
      expect(status).toBe(200);
    });

    it('empty token after "Bearer " returns 401', async () => {
      const { status, body } = await getRawAuth(port, '/status', 'Bearer ');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['reason']).toBe('unknown');
    });

    it('missing Authorization header returns 401', async () => {
      const { status } = await get(port, '/status'); // no token arg
      expect(status).toBe(401);
    });
  });

  // ─── NEW: rate-limit capacity=1 ────────────────────────────────────────

  describe('rate-limit with capacity=1', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(undefined, {
          enabled: true,
          capacity: 1,
          refillPerSec: 0.001, // near-zero refill so bucket stays empty
          exemptPaths: ['/ping', '/health', '/metrics'],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('first request succeeds, second is 429', async () => {
      const first = await get(port, '/status');
      expect(first.status).toBe(200);

      const second = await get(port, '/status');
      expect(second.status).toBe(429);
      expect((second.body as Record<string, unknown>)['error']).toBe('rate_limited');
    });

    it('429 includes Retry-After header', async () => {
      await get(port, '/status');
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('retry-after');
      expect(retryAfter).not.toBeNull();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });

    it('429 body includes retryAfterMs > 0', async () => {
      await get(port, '/status');
      const { body } = await get(port, '/status');
      expect((body as Record<string, unknown>)['retryAfterMs']).toBeGreaterThan(0);
    });
  });
});

// ─── Mini App tests ────────────────────────────────────────────────────────

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { tmpdir as osTmpdir } from 'os';
import pathModule from 'path';
import { fileURLToPath } from 'node:url';
import { GoalStore } from './goal-store';
import { ArtifactStore } from './artifact-model';
import { DomainOverlayRegistry } from './domain-overlay';
import { createCeoclawOverlayManifest, createOchagOverlayManifest } from './domain-overlay-presets';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import { RunLedger } from './run-ledger';
import { createToolRegistry } from './universal/tool-registry';

describe('Approval and audit routes', () => {
  let gw: ReturnType<typeof createRuntimeGateway>;
  let port: number;
  const approvals = {
    pending: [
      { id: 'req-1', toolName: 'exec', summary: 'exec: npm install', args: { command: 'npm install' } },
    ],
    audit: [
      {
        id: 'audit-1',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'req-1',
        toolName: 'exec',
        summary: 'exec: npm install',
        args: { command: 'npm install' },
      },
    ],
    getPending: vi.fn(() => approvals.pending),
    resolveDecision: vi.fn((id: string) => id === 'req-1'),
    listAudit: vi.fn(() => approvals.audit),
    listAuditByRequestId: vi.fn((requestId: string, limit = 100) => approvals.audit
      .filter((event) => event.requestId === requestId)
      .slice(-limit)
      .reverse()),
    getResolvedApproval: vi.fn(() => undefined),
    listeners: [] as Array<(event: any) => void>,
    subscribe: vi.fn((listener: (event: any) => void) => {
      approvals.listeners.push(listener);
      return () => {
        approvals.listeners = approvals.listeners.filter((candidate) => candidate !== listener);
      };
    }),
  };

  beforeEach(async () => {
    approvals.getPending.mockClear();
    approvals.resolveDecision.mockClear();
    approvals.listAudit.mockClear();
    approvals.listAuditByRequestId.mockClear();
    approvals.getResolvedApproval.mockClear();
    approvals.subscribe.mockClear();
    approvals.listeners = [];
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      approvalFlow: approvals,
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
  });

  it('lists pending approvals', async () => {
    const { status, body } = await get(port, '/api/approvals/pending');
    expect(status).toBe(200);
    expect(body).toMatchObject({ approvals: approvals.pending });
  });

  it('redacts sensitive approval metadata before returning pending approvals', async () => {
    approvals.getPending.mockReturnValueOnce([{
      id: 'req-secret',
      toolName: 'connector_live_probe',
      summary: 'Probe https://user:pass@example.test/status?api_key=abc',
      args: {
        connectorId: 'telegram',
        connectorName: 'Telegram',
        sourceSystem: 'Telegram Bot API',
        token: 'secret-token-value',
        path: 'file:///Users/aleksandrgrebeshok/.ssh/id_rsa',
        quotedPath: 'open "/Users/aleksandrgrebeshok/.ssh/id_rsa"',
        optPath: 'read /opt/pyrfor/secret.txt',
        singleSegmentPath: 'inspect "/tmp"',
      },
    }]);

    const { status, body } = await get(port, '/api/approvals/pending');

    expect(status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret-token-value');
    expect(serialized).not.toContain('/Users/aleksandrgrebeshok');
    expect(body).toMatchObject({
      approvals: [expect.objectContaining({
        summary: expect.stringContaining('api_key=[redacted]'),
        args: expect.objectContaining({
          token: '[redacted]',
          path: 'file://[redacted-path]',
          quotedPath: 'open "[redacted-path]"',
          optPath: 'read [redacted-path]',
          singleSegmentPath: 'inspect "[redacted-path]"',
        }),
      })],
    });
  });

  it('accepts approval decisions', async () => {
    const { status, body } = await post(port, '/api/approvals/req-1/decision', { decision: 'approve' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, decision: 'approve' });
    expect(approvals.resolveDecision).toHaveBeenCalledWith('req-1', 'approve');
  });

  it('lists audit events', async () => {
    const { status, body } = await get(port, '/api/audit/events?limit=10');
    expect(status).toBe(200);
    expect(body).toMatchObject({ events: approvals.audit });
    expect(approvals.listAudit).toHaveBeenCalledWith(10);
  });

  it('filters audit events by request id before applying the response limit', async () => {
    approvals.listAuditByRequestId.mockReturnValueOnce([
      {
        id: 'audit-2',
        ts: '2026-05-01T00:01:00.000Z',
        type: 'approval.approved',
        requestId: 'req-2',
        toolName: 'ceoclaw_business_brief_approval',
        summary: 'Approve CEOClaw brief',
        args: { runId: 'run-2' },
      },
    ]);

    const { status, body } = await get(port, '/api/audit/events?limit=1&requestId=req-2');

    expect(status).toBe(200);
    expect(body.events).toEqual([expect.objectContaining({ requestId: 'req-2' })]);
    expect(approvals.listAuditByRequestId).toHaveBeenCalledWith('req-2', 1000);
  });

  it('returns request-scoped resolved approvals even when audit history is truncated', async () => {
    approvals.listAuditByRequestId.mockReturnValueOnce([]);
    approvals.getResolvedApproval.mockReturnValueOnce({
      decision: 'approve',
      request: {
        id: 'req-resolved',
        toolName: 'ceoclaw_business_brief_approval',
        summary: 'Approve CEOClaw brief',
        args: { runId: 'run-1', projectId: 'ceoclaw' },
        run_id: 'run-1',
        approval_required: true,
      },
    });

    const { status, body } = await get(port, '/api/audit/events?limit=1&requestId=req-resolved');

    expect(status).toBe(200);
    expect(body.events).toEqual([
      expect.objectContaining({
        type: 'approval.approved',
        requestId: 'req-resolved',
        toolName: 'ceoclaw_business_brief_approval',
      }),
    ]);
    expect(approvals.getResolvedApproval).toHaveBeenCalledWith('req-resolved');
  });

  it('redacts sensitive approval audit events', async () => {
    approvals.listAudit.mockReturnValueOnce([{
      id: 'audit-secret',
      ts: '2026-05-01T00:00:00.000Z',
      type: 'approval.requested',
      requestId: 'req-secret',
      toolName: 'research_live_search',
      summary: 'Search with token=secret-token-value',
      args: {
        runId: 'run-1',
        queryHash: 'hash',
        provider: 'brave',
        authorization: 'Bearer secret-token-value',
      },
      resultSummary: 'Fetched https://example.test/search?token=secret-token-value',
    }]);

    const { status, body } = await get(port, '/api/audit/events?limit=10');

    expect(status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret-token-value');
    expect(body).toMatchObject({
      events: [expect.objectContaining({
        summary: 'Search with token=[redacted]',
        args: expect.objectContaining({ authorization: '[redacted]' }),
        resultSummary: expect.stringContaining('token=[redacted]'),
      })],
    });
  });

  it('streams approval snapshot and live approval events', async () => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    try {
      const snapshotMessages = await readSseUntil(reader, (messages) => messages.some((message) => message.event === 'snapshot'));
      expect(snapshotMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'snapshot',
          data: expect.objectContaining({
            approvals: expect.arrayContaining([expect.objectContaining({ id: 'req-1' })]),
          }),
        }),
      ]));

      approvals.listeners.forEach((listener) => listener({
        type: 'approval-resolved',
        request: approvals.pending[0],
        decision: 'approve',
      }));
      const resolvedMessages = await readSseUntil(reader, (messages) =>
        messages.some((message) => message.event === 'approval-resolved')
      );
      expect(resolvedMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'approval-resolved',
          data: expect.objectContaining({
            decision: 'approve',
            request: expect.objectContaining({ id: 'req-1' }),
          }),
        }),
      ]));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  it('buffers approval events that arrive while the stream snapshot is being built', async () => {
    approvals.getPending.mockImplementationOnce(() => {
      approvals.listeners.forEach((listener) => listener({
        type: 'approval-requested',
        request: { id: 'req-race', toolName: 'exec', summary: 'exec: pnpm test', args: { command: 'pnpm test' } },
      }));
      return approvals.pending;
    });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    try {
      const messages = await readSseUntil(reader, (items) =>
        items.some((message) => message.event === 'snapshot') &&
        items.some((message) => message.event === 'approval-requested')
      );
      expect(messages.map((message) => message.event)).toEqual(expect.arrayContaining(['snapshot', 'approval-requested']));
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'approval-requested',
          data: expect.objectContaining({
            request: expect.objectContaining({ id: 'req-race' }),
          }),
        }),
      ]));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });
});

describe('Product Factory API routes', () => {
  let gw: ReturnType<typeof createRuntimeGateway>;
  let port: number;
  const deliveryEvidenceSnapshot = {
    schemaVersion: 'pyrfor.delivery_evidence.v1',
    runId: 'run-pf-1',
    capturedAt: '2026-05-01T00:00:00.000Z',
    deliveryChecklist: [],
    git: {
      available: true,
      branch: 'main',
      headSha: 'abc123',
      ahead: 0,
      behind: 0,
      dirtyFiles: [],
      latestCommits: [],
      remote: {
        name: 'origin',
        url: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.git',
      },
    },
    github: {
      provider: 'github',
      available: false,
      repository: null,
      branch: null,
      pullRequests: [],
      workflowRuns: [],
      errors: [],
    },
  };
  const runtime = {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
    listProductFactoryTemplates: vi.fn().mockReturnValue([
      {
        id: 'feature',
        title: 'Feature delivery',
        description: 'Feature template',
        recommendedDomainIds: [],
        clarifications: [],
        deliveryArtifacts: ['implementation_summary'],
        qualityGates: ['build'],
      },
    ]),
    previewProductFactoryPlan: vi.fn().mockReturnValue({
      intent: { id: 'pf-1', templateId: 'feature', title: 'Build a feature', goal: 'Build a feature', domainIds: [] },
      template: { id: 'feature', title: 'Feature delivery' },
      missingClarifications: [],
      scopedPlan: { objective: 'Build a feature', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
      dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
      deliveryChecklist: ['implementation_summary'],
    }),
    createProductFactoryRun: vi.fn().mockResolvedValue({
      run: { run_id: 'run-pf-1', task_id: 'pf-1', mode: 'pm', status: 'planned' },
      preview: { intent: { id: 'pf-1' } },
      artifact: { id: 'artifact-1', kind: 'plan' },
    }),
    executeProductFactoryRun: vi.fn().mockResolvedValue({
      run: { run_id: 'run-pf-1', task_id: 'pf-1', mode: 'pm', status: 'completed' },
      deliveryArtifact: { id: 'artifact-delivery', kind: 'summary' },
      deliveryEvidenceArtifact: { id: 'artifact-evidence', kind: 'delivery_evidence' },
      deliveryEvidence: { schemaVersion: 'pyrfor.delivery_evidence.v1', runId: 'run-pf-1' },
      summary: 'Product Factory executed',
    }),
    captureRunDeliveryEvidence: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-evidence',
        kind: 'delivery_evidence',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-evidence.json',
        sha256: 'evidence-sha',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      snapshot: deliveryEvidenceSnapshot,
    }),
    getRunDeliveryEvidence: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-evidence',
        kind: 'delivery_evidence',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-evidence.json',
        sha256: 'evidence-sha',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      snapshot: deliveryEvidenceSnapshot,
    }),
    createRunGithubDeliveryPlan: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-plan',
        kind: 'delivery_plan',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-plan.json',
        sha256: 'plan-sha',
        createdAt: '2026-05-01T00:01:00.000Z',
      },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        runId: 'run-pf-1',
        mode: 'dry_run',
        applySupported: false,
        pullRequest: {
          title: 'Ship feature from /Users/aleksandrgrebeshok/private',
          body: 'Summary at /Users/aleksandrgrebeshok/private and file:///tmp/pyrfor-plan.md with accessToken=plan-secret apiKey=plan-key OPENAI_API_KEY=sk-live-secret AWS_SECRET_ACCESS_KEY=aws-secret awsAccessKeyId=AKIA123 algorithmSignatureVersion=4 tokenBudget=4096 tokenCount: 17 refreshTokenTtl=3600 {"apiKey":"json-plan-key","accessToken":"json-plan-secret"} authorization: Bearer ghp_plan_authsecret; Authorization=Basic dXNlcjpwYXNz; authorization: Token ghp_scheme_authsecret; authorization: Digest username="a", response="deadbeef"; authorization: "Bearer ghp_quoted_authsecret"',
          draft: true,
        },
        blockers: ['Blocked by -/tmp/plan-blocker with clientSecret=blocker-secret'],
      },
      evidenceArtifact: {
        id: 'artifact-evidence',
        kind: 'delivery_evidence',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-evidence.json',
        sha256: 'evidence-sha',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    }),
    getRunGithubDeliveryPlan: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-plan',
        kind: 'delivery_plan',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-plan.json',
        sha256: 'plan-sha',
        createdAt: '2026-05-01T00:01:00.000Z',
      },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        runId: 'run-pf-1',
        mode: 'dry_run',
        applySupported: false,
        pullRequest: {
          title: 'Ship feature from /Users/aleksandrgrebeshok/private',
          body: 'Summary at /Users/aleksandrgrebeshok/private and file:///tmp/pyrfor-plan.md with accessToken=plan-secret apiKey=plan-key OPENAI_API_KEY=sk-live-secret AWS_SECRET_ACCESS_KEY=aws-secret awsAccessKeyId=AKIA123 algorithmSignatureVersion=4 tokenBudget=4096 tokenCount: 17 refreshTokenTtl=3600 {"apiKey":"json-plan-key","accessToken":"json-plan-secret"} authorization: Bearer ghp_plan_authsecret; Authorization=Basic dXNlcjpwYXNz; authorization: Token ghp_scheme_authsecret; authorization: Digest username="a", response="deadbeef"; authorization: "Bearer ghp_quoted_authsecret"',
          draft: true,
        },
        blockers: ['Blocked by -/tmp/plan-blocker with clientSecret=blocker-secret'],
      },
    }),
    getRunGithubDeliveryApply: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-apply',
        kind: 'delivery_apply',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-apply.json',
        sha256: 'apply-sha',
        createdAt: '2026-05-01T00:02:00.000Z',
      },
      result: {
        schemaVersion: 'pyrfor.github_delivery_apply.v1',
        runId: 'run-pf-1',
        draftPullRequest: { number: 12, url: 'https://github.com/acme/pyrfor/pull/12', title: 'Ship feature', draft: true },
      },
    }),
    requestRunGithubDeliveryApply: vi.fn().mockResolvedValue({
      status: 'awaiting_approval',
      approval: { id: 'approval-1', toolName: 'github_delivery_apply', summary: 'Create draft PR', args: {} },
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    }),
    applyApprovedRunGithubDelivery: vi.fn().mockResolvedValue({
      status: 'applied',
      artifact: {
        id: 'artifact-apply',
        kind: 'delivery_apply',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-apply.json',
        sha256: 'apply-sha',
        createdAt: '2026-05-01T00:02:00.000Z',
      },
      result: {
        schemaVersion: 'pyrfor.github_delivery_apply.v1',
        runId: 'run-pf-1',
        draftPullRequest: { number: 12, url: 'https://github.com/acme/pyrfor/pull/12', title: 'Ship feature', draft: true },
      },
    }),
    getRunVerifierStatus: vi.fn().mockResolvedValue({
      decision: {
        status: 'blocked',
        rawStatus: 'blocked',
        reason: 'policy violation',
        waiverEligible: true,
        waiverPath: '/api/runs/run-pf-1/verifier-waiver',
      },
    }),
    createRunVerifierWaiver: vi.fn().mockResolvedValue({
      artifact: { id: 'artifact-waiver', kind: 'verifier_waiver' },
      waiver: {
        schemaVersion: 'pyrfor.verifier_waiver.v1',
        runId: 'run-pf-1',
        rawStatus: 'blocked',
        operator: { id: 'operator' },
        reason: 'Accepted known risk',
        scope: 'all',
        waivedAt: '2026-05-03T00:00:00.000Z',
      },
      decision: { status: 'waived', rawStatus: 'blocked', waiverEligible: true, waiverPath: '/api/runs/run-pf-1/verifier-waiver' },
      run: { run_id: 'run-pf-1', status: 'completed' },
    }),
  } as unknown as PyrforRuntime & {
    listProductFactoryTemplates: ReturnType<typeof vi.fn>;
    previewProductFactoryPlan: ReturnType<typeof vi.fn>;
    createProductFactoryRun: ReturnType<typeof vi.fn>;
    executeProductFactoryRun: ReturnType<typeof vi.fn>;
    captureRunDeliveryEvidence: ReturnType<typeof vi.fn>;
    getRunDeliveryEvidence: ReturnType<typeof vi.fn>;
    createRunGithubDeliveryPlan: ReturnType<typeof vi.fn>;
    getRunGithubDeliveryPlan: ReturnType<typeof vi.fn>;
    getRunGithubDeliveryApply: ReturnType<typeof vi.fn>;
    requestRunGithubDeliveryApply: ReturnType<typeof vi.fn>;
    applyApprovedRunGithubDelivery: ReturnType<typeof vi.fn>;
    getRunVerifierStatus: ReturnType<typeof vi.fn>;
    createRunVerifierWaiver: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    runtime.listProductFactoryTemplates.mockClear();
    runtime.previewProductFactoryPlan.mockClear();
    runtime.createProductFactoryRun.mockClear();
    runtime.executeProductFactoryRun.mockClear();
    runtime.captureRunDeliveryEvidence.mockClear();
    runtime.getRunDeliveryEvidence.mockClear();
    runtime.createRunGithubDeliveryPlan.mockClear();
    runtime.getRunGithubDeliveryPlan.mockClear();
    runtime.getRunGithubDeliveryApply.mockClear();
    runtime.requestRunGithubDeliveryApply.mockClear();
    runtime.applyApprovedRunGithubDelivery.mockClear();
    runtime.getRunVerifierStatus.mockClear();
    runtime.createRunVerifierWaiver.mockClear();
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime,
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
  });

  it('lists and previews product factory templates', async () => {
    await expect(get(port, '/api/product-factory/templates')).resolves.toMatchObject({
      status: 200,
      body: { templates: [expect.objectContaining({ id: 'feature' })] },
    });

    await expect(post(port, '/api/product-factory/plan', {
      templateId: 'feature',
      prompt: 'Build a feature',
    })).resolves.toMatchObject({
      status: 200,
      body: { preview: expect.objectContaining({ intent: expect.objectContaining({ id: 'pf-1' }) }) },
    });
    expect(runtime.previewProductFactoryPlan).toHaveBeenCalledWith({
      templateId: 'feature',
      prompt: 'Build a feature',
    });
  });

  it('serializes Product Factory browser smoke quality gate readiness from fallback previews', async () => {
    const partialRuntime = runtime as Partial<typeof runtime>;
    const originalPreview = partialRuntime.previewProductFactoryPlan;
    partialRuntime.previewProductFactoryPlan = undefined;
    try {
      await expect(post(port, '/api/product-factory/plan', {
        templateId: 'ui_scaffold',
        prompt: 'Build settings panel',
        answers: {
          users: 'operators',
          states: 'empty and error',
        },
      })).resolves.toMatchObject({
        status: 200,
        body: {
          preview: expect.objectContaining({
            scopedPlan: expect.objectContaining({
              qualityGates: expect.arrayContaining(['browser_smoke']),
            }),
            qualityGateReadiness: [
              expect.objectContaining({
                gate: 'browser_smoke',
                statusSource: 'local-config',
                liveProbeSkipped: true,
                approvalRequired: true,
              }),
            ],
          }),
        },
      });
    } finally {
      partialRuntime.previewProductFactoryPlan = originalPreview;
    }
  });

  it('serializes Product Factory release readiness quality gate from fallback feature previews', async () => {
    const partialRuntime = runtime as Partial<typeof runtime>;
    const originalPreview = partialRuntime.previewProductFactoryPlan;
    partialRuntime.previewProductFactoryPlan = undefined;
    try {
      const response = await post(port, '/api/product-factory/plan', {
        templateId: 'feature',
        prompt: 'Build signed release notes',
        answers: {
          acceptance: 'Operators see release notes.',
          surface: 'Desktop release panel.',
        },
      });
      expect(response).toMatchObject({
        status: 200,
        body: {
          preview: expect.objectContaining({
            scopedPlan: expect.objectContaining({
              qualityGates: expect.arrayContaining(['release_readiness']),
            }),
            qualityGateReadiness: expect.arrayContaining([
              expect.objectContaining({
                gate: 'release_readiness',
                statusSource: 'local-config',
                liveProbeSkipped: true,
                approvalRequired: true,
              }),
            ]),
          }),
        },
      });
      expect(JSON.stringify(response.body)).not.toContain('/Users/');
      expect(JSON.stringify(response.body)).not.toContain('APPLE_PASSWORD=');
    } finally {
      partialRuntime.previewProductFactoryPlan = originalPreview;
    }
  });

  it('rejects unknown product factory templates before runtime dispatch', async () => {
    await expect(post(port, '/api/product-factory/plan', {
      templateId: 'unknown_template',
      prompt: 'Build a feature',
    })).resolves.toMatchObject({
      status: 400,
      body: { error: 'templateId and prompt are required' },
    });
    expect(runtime.previewProductFactoryPlan).not.toHaveBeenCalled();
  });

  it('creates product factory runs through POST /api/runs', async () => {
    await expect(post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Build a feature',
        answers: {
          acceptance: 'Visible to users',
          surface: 'operator console',
        },
      },
    })).resolves.toMatchObject({
      status: 201,
      body: {
        run: expect.objectContaining({ run_id: 'run-pf-1', mode: 'pm', status: 'planned' }),
        artifact: expect.objectContaining({ id: 'artifact-1' }),
      },
    });
    expect(runtime.createProductFactoryRun).toHaveBeenCalledWith({
      templateId: 'feature',
      prompt: 'Build a feature',
      answers: {
        acceptance: 'Visible to users',
        surface: 'operator console',
      },
    });
  });

  it('rejects product factory run creation until required clarifications are answered', async () => {
    await expect(post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Build a feature',
      },
    })).resolves.toMatchObject({
      status: 400,
      body: {
        error: 'missing_required_clarifications',
        missingClarifications: ['acceptance', 'surface'],
      },
    });
    expect(runtime.createProductFactoryRun).not.toHaveBeenCalled();
  });

  it('executes product factory runs through run control', async () => {
    await expect(post(port, '/api/runs/run-pf-1/control', { action: 'execute' })).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        action: 'execute',
        run: expect.objectContaining({ run_id: 'run-pf-1', status: 'completed' }),
        deliveryArtifact: expect.objectContaining({ id: 'artifact-delivery', kind: 'summary' }),
        deliveryEvidenceArtifact: expect.objectContaining({ id: 'artifact-evidence', kind: 'delivery_evidence' }),
      },
    });
    expect(runtime.executeProductFactoryRun).toHaveBeenCalledWith('run-pf-1');
  });

  it('captures delivery evidence through POST /api/runs/:runId/delivery-evidence', async () => {
    const response = await post(port, '/api/runs/run-pf-1/delivery-evidence', {
      issueNumber: 42,
      summary: 'Delivered',
    });
    expect(response).toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({
          id: 'artifact-evidence',
          kind: 'delivery_evidence',
          sha256: 'evidence-sha',
          createdAt: '2026-05-01T00:00:00.000Z',
        }),
        snapshot: expect.objectContaining({ schemaVersion: 'pyrfor.delivery_evidence.v1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(response.body.snapshot.git.remote).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(JSON.stringify(response.body)).not.toContain('[redacted-path]');
    expect(runtime.captureRunDeliveryEvidence).toHaveBeenCalledWith('run-pf-1', {
      issueNumber: 42,
      summary: 'Delivered',
    });
  });

  it('returns latest delivery evidence through GET /api/runs/:runId/delivery-evidence', async () => {
    const response = await get(port, '/api/runs/run-pf-1/delivery-evidence');
    expect(response).toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({
          id: 'artifact-evidence',
          kind: 'delivery_evidence',
          sha256: 'evidence-sha',
          createdAt: '2026-05-01T00:00:00.000Z',
        }),
        snapshot: expect.objectContaining({ runId: 'run-pf-1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(response.body.snapshot.git.remote).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(JSON.stringify(response.body)).not.toContain('[redacted-path]');
    expect(runtime.getRunDeliveryEvidence).toHaveBeenCalledWith('run-pf-1');
  });

  it('creates dry-run GitHub delivery plans through POST /api/runs/:runId/github-delivery-plan', async () => {
    const response = await post(port, '/api/runs/run-pf-1/github-delivery-plan', {
      issueNumber: 42,
      title: 'Ship feature',
    });
    expect(response).toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-plan', kind: 'delivery_plan', sha256: 'plan-sha' }),
        evidenceArtifact: expect.objectContaining({ id: 'artifact-evidence', kind: 'delivery_evidence', sha256: 'evidence-sha' }),
        plan: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_plan.v1', mode: 'dry_run', applySupported: false }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(response.body.evidenceArtifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('/tmp/pyrfor-plan.md');
    expect(JSON.stringify(response.body)).not.toContain('/tmp/plan-blocker');
    expect(JSON.stringify(response.body)).not.toContain('plan-secret');
    expect(JSON.stringify(response.body)).not.toContain('plan-key');
    expect(JSON.stringify(response.body)).not.toContain('sk-live-secret');
    expect(JSON.stringify(response.body)).not.toContain('aws-secret');
    expect(JSON.stringify(response.body)).not.toContain('AKIA123');
    expect(JSON.stringify(response.body)).not.toContain('ghp_plan_authsecret');
    expect(JSON.stringify(response.body)).not.toContain('ghp_quoted_authsecret');
    expect(JSON.stringify(response.body)).not.toContain('ghp_scheme_authsecret');
    expect(JSON.stringify(response.body)).not.toContain('deadbeef');
    expect(JSON.stringify(response.body)).not.toContain('dXNlcjpwYXNz');
    expect(JSON.stringify(response.body)).not.toContain('json-plan-key');
    expect(JSON.stringify(response.body)).not.toContain('json-plan-secret');
    expect(JSON.stringify(response.body)).not.toContain('blocker-secret');
    expect(response.body.plan.pullRequest.title).toContain('[redacted-path]');
    expect(response.body.plan.pullRequest.body).toContain('file://[redacted-path]');
    expect(response.body.plan.pullRequest.body).toContain('accessToken=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('apiKey=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('OPENAI_API_KEY=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('AWS_SECRET_ACCESS_KEY=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('awsAccessKeyId=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('algorithmSignatureVersion=4');
    expect(response.body.plan.pullRequest.body).toContain('tokenBudget=4096');
    expect(response.body.plan.pullRequest.body).toContain('tokenCount: 17');
    expect(response.body.plan.pullRequest.body).toContain('refreshTokenTtl=3600');
    expect(response.body.plan.pullRequest.body).toContain('authorization: [redacted]');
    expect(response.body.plan.pullRequest.body).toContain('Authorization=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('"apiKey":[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('"accessToken":[redacted]');
    expect(response.body.plan.blockers[0]).toContain('-[redacted-path]');
    expect(response.body.plan.blockers[0]).toContain('clientSecret=[redacted]');
    expect(runtime.createRunGithubDeliveryPlan).toHaveBeenCalledWith('run-pf-1', {
      issueNumber: 42,
      title: 'Ship feature',
    });
  });

  it('returns latest dry-run GitHub delivery plan through GET /api/runs/:runId/github-delivery-plan', async () => {
    const response = await get(port, '/api/runs/run-pf-1/github-delivery-plan');
    expect(response).toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-plan', kind: 'delivery_plan', sha256: 'plan-sha' }),
        plan: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_plan.v1', runId: 'run-pf-1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('/tmp/pyrfor-plan.md');
    expect(JSON.stringify(response.body)).not.toContain('/tmp/plan-blocker');
    expect(JSON.stringify(response.body)).not.toContain('plan-secret');
    expect(JSON.stringify(response.body)).not.toContain('plan-key');
    expect(JSON.stringify(response.body)).not.toContain('sk-live-secret');
    expect(JSON.stringify(response.body)).not.toContain('aws-secret');
    expect(JSON.stringify(response.body)).not.toContain('AKIA123');
    expect(JSON.stringify(response.body)).not.toContain('ghp_plan_authsecret');
    expect(JSON.stringify(response.body)).not.toContain('ghp_quoted_authsecret');
    expect(JSON.stringify(response.body)).not.toContain('ghp_scheme_authsecret');
    expect(JSON.stringify(response.body)).not.toContain('deadbeef');
    expect(JSON.stringify(response.body)).not.toContain('dXNlcjpwYXNz');
    expect(JSON.stringify(response.body)).not.toContain('json-plan-key');
    expect(JSON.stringify(response.body)).not.toContain('json-plan-secret');
    expect(JSON.stringify(response.body)).not.toContain('blocker-secret');
    expect(response.body.plan.pullRequest.title).toContain('[redacted-path]');
    expect(response.body.plan.pullRequest.body).toContain('file://[redacted-path]');
    expect(response.body.plan.pullRequest.body).toContain('accessToken=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('apiKey=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('OPENAI_API_KEY=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('AWS_SECRET_ACCESS_KEY=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('awsAccessKeyId=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('algorithmSignatureVersion=4');
    expect(response.body.plan.pullRequest.body).toContain('tokenBudget=4096');
    expect(response.body.plan.pullRequest.body).toContain('tokenCount: 17');
    expect(response.body.plan.pullRequest.body).toContain('refreshTokenTtl=3600');
    expect(response.body.plan.pullRequest.body).toContain('authorization: [redacted]');
    expect(response.body.plan.pullRequest.body).toContain('Authorization=[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('"apiKey":[redacted]');
    expect(response.body.plan.pullRequest.body).toContain('"accessToken":[redacted]');
    expect(response.body.plan.blockers[0]).toContain('-[redacted-path]');
    expect(response.body.plan.blockers[0]).toContain('clientSecret=[redacted]');
    expect(runtime.getRunGithubDeliveryPlan).toHaveBeenCalledWith('run-pf-1');
  });

  it('requests GitHub delivery apply approval through POST /api/runs/:runId/github-delivery-apply', async () => {
    await expect(post(port, '/api/runs/run-pf-1/github-delivery-apply', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    })).resolves.toMatchObject({
      status: 202,
      body: {
        status: 'awaiting_approval',
        approval: expect.objectContaining({ id: 'approval-1' }),
      },
    });
    expect(runtime.requestRunGithubDeliveryApply).toHaveBeenCalledWith('run-pf-1', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    });
  });

  it('applies approved GitHub delivery through POST /api/runs/:runId/github-delivery-apply', async () => {
    const response = await post(port, '/api/runs/run-pf-1/github-delivery-apply', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    });
    expect(response).toMatchObject({
      status: 201,
      body: {
        status: 'applied',
        artifact: expect.objectContaining({ id: 'artifact-apply', kind: 'delivery_apply', sha256: 'apply-sha' }),
        result: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_apply.v1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(runtime.applyApprovedRunGithubDelivery).toHaveBeenCalledWith('run-pf-1', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    });
  });

  it('returns latest GitHub delivery apply result through GET /api/runs/:runId/github-delivery-apply', async () => {
    const response = await get(port, '/api/runs/run-pf-1/github-delivery-apply');
    expect(response).toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-apply', kind: 'delivery_apply', sha256: 'apply-sha' }),
        result: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_apply.v1', runId: 'run-pf-1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(runtime.getRunGithubDeliveryApply).toHaveBeenCalledWith('run-pf-1');
  });

  it('returns verifier status through GET /api/runs/:runId/verifier-status', async () => {
    await expect(get(port, '/api/runs/run-pf-1/verifier-status')).resolves.toMatchObject({
      status: 200,
      body: {
        decision: expect.objectContaining({
          status: 'blocked',
          rawStatus: 'blocked',
          waiverEligible: true,
        }),
      },
    });
    expect(runtime.getRunVerifierStatus).toHaveBeenCalledWith('run-pf-1');
  });

  it('forwards verifier status scope through GET /api/runs/:runId/verifier-status', async () => {
    await expect(get(port, '/api/runs/run-pf-1/verifier-status?scope=delivery_plan')).resolves.toMatchObject({
      status: 200,
      body: {
        decision: expect.objectContaining({ status: 'blocked' }),
      },
    });
    expect(runtime.getRunVerifierStatus).toHaveBeenCalledWith('run-pf-1', 'delivery_plan');
  });

  it('rejects invalid verifier status scope before runtime dispatch', async () => {
    await expect(get(port, '/api/runs/run-pf-1/verifier-status?scope=workspace')).resolves.toMatchObject({
      status: 400,
      body: { error: 'invalid_verifier_scope' },
    });
    expect(runtime.getRunVerifierStatus).not.toHaveBeenCalled();
  });

  it('creates verifier waivers through POST /api/runs/:runId/verifier-waiver', async () => {
    await expect(post(port, '/api/runs/run-pf-1/verifier-waiver', {
      operatorId: 'operator',
      reason: 'Accepted known risk',
      scope: 'all',
    })).resolves.toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-waiver', kind: 'verifier_waiver' }),
        waiver: expect.objectContaining({ schemaVersion: 'pyrfor.verifier_waiver.v1' }),
        decision: expect.objectContaining({ status: 'waived' }),
      },
    });
    expect(runtime.createRunVerifierWaiver).toHaveBeenCalledWith('run-pf-1', {
      operatorId: 'operator',
      reason: 'Accepted known risk',
      scope: 'all',
    });
  });

  it('maps CEOClaw brief routes to business_brief product factory input', async () => {
    await expect(post(port, '/api/ceoclaw/briefs/preview', {
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf', 'finance-note.md'],
      deadline: 'Friday',
    })).resolves.toMatchObject({
      status: 200,
      body: { preview: expect.objectContaining({ intent: expect.objectContaining({ id: 'pf-1' }) }) },
    });
    expect(runtime.previewProductFactoryPlan).toHaveBeenLastCalledWith({
      templateId: 'business_brief',
      prompt: 'Approve supplier contract',
      answers: {
        decision: 'Approve supplier contract',
        evidence: 'contract.pdf,finance-note.md',
        deadline: 'Friday',
      },
      domainIds: ['ceoclaw'],
    });

    await expect(post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve supplier contract',
      evidence: 'contract.pdf',
    })).resolves.toMatchObject({
      status: 201,
      body: { run: expect.objectContaining({ run_id: 'run-pf-1' }) },
    });
    expect(runtime.createProductFactoryRun).toHaveBeenLastCalledWith({
      templateId: 'business_brief',
      prompt: 'Approve supplier contract',
      answers: {
        decision: 'Approve supplier contract',
        evidence: 'contract.pdf',
      },
      domainIds: ['ceoclaw'],
    });
  });

  it('maps Ochag reminder create route to ochag_family_reminder product factory input', async () => {
    await expect(post(port, '/api/ochag/reminders', {
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00 daily',
      audience: 'parents',
      visibility: 'family',
    })).resolves.toMatchObject({
      status: 201,
      body: { run: expect.objectContaining({ run_id: 'run-pf-1' }) },
    });

    expect(runtime.createProductFactoryRun).toHaveBeenLastCalledWith({
      templateId: 'ochag_family_reminder',
      prompt: 'Send dinner reminder',
      answers: {
        familyId: 'fam-1',
        dueAt: '18:00 daily',
        audience: 'parents',
        visibility: 'family',
      },
      domainIds: ['ochag'],
    });
  });

  it('rejects Ochag reminder creation until required scheduling context is present', async () => {
    await expect(post(port, '/api/ochag/reminders', {
      title: 'Send dinner reminder',
    })).resolves.toMatchObject({
      status: 400,
      body: {
        error: 'missing_required_clarifications',
        missingClarifications: ['familyId', 'audience', 'dueAt', 'visibility'],
      },
    });
    expect(runtime.createProductFactoryRun).not.toHaveBeenCalled();
  });

  it('rejects CEOClaw brief creation until evidence is present', async () => {
    await expect(post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve supplier contract',
    })).resolves.toMatchObject({
      status: 400,
      body: {
        error: 'missing_required_clarifications',
        missingClarifications: ['evidence'],
      },
    });
    expect(runtime.createProductFactoryRun).not.toHaveBeenCalled();
  });
});

describe('Orchestration API routes', () => {
  let gw: ReturnType<typeof createRuntimeGateway>;
  let port: number;
  let tmpDir: string;
  let eventLedger: EventLedger;

  beforeEach(async () => {
    tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-orch-test-'));
    eventLedger = new EventLedger(pathModule.join(tmpDir, 'events.jsonl'));
    const runLedger = new RunLedger({ ledger: eventLedger });
    await runLedger.createRun({
      run_id: 'run-1',
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      mode: 'autonomous',
      task_id: 'task-1',
      goal: 'Expose orchestration API',
    });
    await runLedger.transition('run-1', 'planned', 'test plan');
    await runLedger.transition('run-1', 'running', 'test run');
    await eventLedger.append({
      type: 'effect.proposed',
      run_id: 'run-1',
      effect_id: 'effect-1',
      effect_kind: 'tool_call',
      tool: 'read_file',
      preview: 'cat "/Users/aleksandrgrebeshok/.ssh/id_rsa" token=stream-secret',
    });
    await eventLedger.append({
      type: 'verifier.completed',
      run_id: 'run-1',
      subject_id: 'run-1',
      status: 'warning',
      action: 'allow_with_warning',
      reason: 'smoke verifier warning',
    });
    await eventLedger.append({
      type: 'actor.spawned',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      agent_id: 'planner',
      agent_name: 'Planner',
      role: 'planner',
      current_work: 'Plan the orchestration API',
      budget: { profile: 'standard', tokensUsed: 1200, tokenLimit: 4000 },
    });
    await eventLedger.append({
      type: 'actor.mailbox.enqueued',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      task: 'Review worker frames',
    });
    await eventLedger.append({
      type: 'actor.work.started',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      current_work: 'Review worker frames',
    });
    await eventLedger.append({
      type: 'actor.work.completed',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      summary: 'Actor proof recorded',
    });

    const dag = new DurableDag({ storePath: pathModule.join(tmpDir, 'dag.json') });
    const dagNode = dag.addNode({
      id: 'node-1',
      kind: 'test.node',
      payload: { runId: 'run-1' },
      provenance: [{ kind: 'run', ref: 'run-1', role: 'input' }],
    });
    dag.leaseNode(dagNode.id, 'test', 60_000);
    dag.addNode({
      id: 'frame-node-1',
      kind: 'worker.frame.tool_call',
      payload: {
        runId: 'run-1',
        frameType: 'tool_call',
        source: 'freeclaude',
        disposition: 'applied',
        seq: 1,
      },
      provenance: [
        { kind: 'run', ref: 'run-1', role: 'input' },
        { kind: 'worker_frame', ref: 'frame-1', role: 'input' },
      ],
    });
    dag.addNode({
      id: 'actor-mailbox-1',
      kind: 'actor.mailbox.task',
      payload: {
        runId: 'run-1',
        actorId: 'actor-planner',
        agentId: '/Users/aleksandrgrebeshok/agents/planner token=agent-secret',
        task: 'Review /Users/aleksandrgrebeshok/.ssh/id_rsa with token=actor-secret and artifact://run/diff',
        payload: {
          contextPack: { content: 'raw context pack should never leak' },
          proof: 'raw proof should never leak',
          uri: `file://${tmpDir}/actor-proof.json`,
          capability: {
            kind: 'research_source_capture',
            url: 'https://example.com/source?accessToken=actor-secret&ok=1',
            note: 'note token=note-secret',
          },
        },
        priority: 5,
        allowConcurrent: false,
      },
      provenance: [{ kind: 'run', ref: 'run-1', role: 'input' }],
    });

    const artifactStore = new ArtifactStore({ rootDir: pathModule.join(tmpDir, 'artifacts') });
    await artifactStore.writeJSON('context_pack', {
      schemaVersion: 'context_pack.v1',
      hash: 'abc123',
      sections: [],
    }, { runId: 'run-1' });

    const overlays = new DomainOverlayRegistry();
    overlays.register({
      manifest: createCeoclawOverlayManifest(),
    });
    overlays.register({
      manifest: createOchagOverlayManifest(),
    });

    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      orchestration: { runLedger, eventLedger, dag, artifactStore, overlays },
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
    await eventLedger.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('adds orchestration summary to dashboard', async () => {
    const { status, body } = await get(port, '/api/dashboard');
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(tmpDir);
    const orchestration = (body as { orchestration?: Record<string, any> }).orchestration;
    expect(orchestration?.['runs']).toMatchObject({ total: 1, active: 1 });
    expect(orchestration?.['effects']).toMatchObject({ pending: 1 });
    expect(orchestration?.['approvals']).toMatchObject({ pending: 0 });
    expect(orchestration?.['workerFrames']).toMatchObject({ total: 1, lastType: 'tool_call' });
    expect(orchestration?.['verifier']).toMatchObject({ blocked: 0, status: 'warning' });
    expect(orchestration?.['dag']).toMatchObject({ total: 3, running: 1 });
    expect(orchestration?.['overlays']).toMatchObject({ total: 2, domainIds: ['ceoclaw', 'ochag'] });
    expect(orchestration?.['contextPack']).toMatchObject({ kind: 'context_pack', runId: 'run-1' });
  });

  it('lists pending effects derived from unsettled effect ledger events', async () => {
    await expect(get(port, '/api/effects/pending')).resolves.toMatchObject({
      status: 200,
      body: {
        effects: [
          expect.objectContaining({
            effect_id: 'effect-1',
            run_id: 'run-1',
            effect_kind: 'tool_call',
            tool: 'read_file',
            preview: 'cat "[redacted-path]" token=[redacted]',
          }),
        ],
      },
    });

    await eventLedger.append({ type: 'effect.denied', run_id: 'run-1', effect_id: 'effect-1', reason: 'test denial' });
    await expect(get(port, '/api/effects/pending')).resolves.toMatchObject({
      status: 200,
      body: { effects: [] },
    });
  });

  it('streams operator snapshot and live ledger events', async () => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    try {
      const snapshotMessages = await readSseUntil(reader, (messages) => messages.some((message) => message.event === 'snapshot'));
      expect(snapshotMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'snapshot',
          data: expect.objectContaining({
            runs: expect.arrayContaining([expect.objectContaining({ run_id: 'run-1' })]),
            effects: expect.arrayContaining([expect.objectContaining({
              effect_id: 'effect-1',
              preview: 'cat "[redacted-path]" token=[redacted]',
            })]),
          }),
        }),
      ]));
      expect(JSON.stringify(snapshotMessages)).not.toContain('/Users/aleksandrgrebeshok');
      expect(JSON.stringify(snapshotMessages)).not.toContain('stream-secret');
      expect(JSON.stringify(snapshotMessages)).not.toContain(tmpDir);

      await eventLedger.append({
        type: 'run.blocked',
        run_id: 'run-1',
        reason: 'stream test block at "/Users/aleksandrgrebeshok/.ssh/id_rsa" token=stream-secret',
      });
      const ledgerMessages = await readSseUntil(reader, (messages) =>
        messages.some((message) =>
          message.event === 'ledger'
          && (message.data as { event?: { type?: string; reason?: string } }).event?.type === 'run.blocked'
        )
      );
      expect(JSON.stringify(ledgerMessages)).not.toContain('/Users/aleksandrgrebeshok');
      expect(JSON.stringify(ledgerMessages)).not.toContain('stream-secret');
      expect(ledgerMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'ledger',
          data: expect.objectContaining({
            event: expect.objectContaining({
              type: 'run.blocked',
              reason: 'stream test block at "[redacted-path]" token=[redacted]',
            }),
          }),
        }),
      ]));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  it('lists runs and returns run details/events/DAG nodes', async () => {
    await expect(get(port, '/api/runs')).resolves.toMatchObject({
      status: 200,
      body: { runs: [expect.objectContaining({ run_id: 'run-1' })] },
    });
    await expect(get(port, '/api/runs/run-1')).resolves.toMatchObject({
      status: 200,
      body: { run: expect.objectContaining({ run_id: 'run-1', status: 'running' }) },
    });
    const events = await get(port, '/api/runs/run-1/events');
    expect(events.status).toBe(200);
    expect((events.body as { events: Array<{ type: string }> }).events.map((event) => event.type)).toContain('effect.proposed');
    expect((events.body as { events: Array<{ type: string; preview?: string }> }).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'effect.proposed', preview: 'cat "[redacted-path]" token=[redacted]' }),
    ]));
    const serializedEvents = JSON.stringify(events.body);
    expect(serializedEvents).not.toContain('/Users/aleksandrgrebeshok');
    expect(serializedEvents).not.toContain('stream-secret');
    const dagResponse = await get(port, '/api/runs/run-1/dag');
    expect(dagResponse.status).toBe(200);
    expect((dagResponse.body as { nodes: Array<{ id: string }> }).nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'node-1' })]),
    );
    const serializedDag = JSON.stringify(dagResponse.body);
    expect(serializedDag).toContain('sourceHost');
    expect(serializedDag).not.toContain('https://example.com/source');
    expect(serializedDag).not.toContain('actor-secret');
    expect(serializedDag).not.toContain('note-secret');
    expect(serializedDag).not.toContain('raw context pack');
    expect(serializedDag).not.toContain('raw proof');
    expect(serializedDag).not.toContain(tmpDir);
    await expect(get(port, '/api/runs/run-1/frames')).resolves.toMatchObject({
      status: 200,
      body: { frames: [expect.objectContaining({ frame_id: 'frame-1', type: 'tool_call', disposition: 'applied' })] },
    });
    await expect(get(port, '/api/runs/run-1/actors')).resolves.toMatchObject({
      status: 200,
      body: {
        runId: 'run-1',
        actors: expect.arrayContaining([
          expect.objectContaining({
            actorId: 'actor-planner',
            agentId: 'planner',
            agentName: 'Planner',
            status: 'idle',
            currentWork: 'Review worker frames',
            mailbox: expect.objectContaining({ pending: 2, oldestPendingAgeMs: expect.any(Number) }),
            budget: expect.objectContaining({ profile: 'standard', tokensUsed: 1200 }),
            outputs: expect.arrayContaining(['Actor proof recorded']),
          }),
        ]),
        totals: expect.objectContaining({ actors: 2, mailboxPending: 2, oldestPendingAgeMs: expect.any(Number) }),
      },
    });
    const actorSnapshot = (await get(port, '/api/runs/run-1/actors')).body as {
      actors: Array<{ actorId: string; mailbox: { oldestPendingAgeMs?: number } }>;
      totals: { oldestPendingAgeMs?: number };
    };
    const planner = actorSnapshot.actors.find((actor) => actor.actorId === 'actor-planner');
    expect(planner?.mailbox.oldestPendingAgeMs).toBeGreaterThanOrEqual(0);
    expect(actorSnapshot.totals.oldestPendingAgeMs).toBeGreaterThanOrEqual(planner?.mailbox.oldestPendingAgeMs ?? 0);
  });

  it('lists sanitized read-only actor mailbox messages', async () => {
    const result = await get(port, '/api/runs/run-1/actors/messages?staleAfterMs=1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      runId: 'run-1',
      messages: [
        expect.objectContaining({
          nodeId: 'actor-mailbox-1',
          actorId: 'actor-planner',
          status: 'pending',
          priority: 5,
          allowConcurrent: false,
          dependencyBlocked: false,
          dependsOn: [],
        }),
      ],
    });
    const serialized = JSON.stringify(result.body);
    expect(serialized).toContain('[redacted-path]');
    expect(serialized).toContain('token=[redacted]');
    expect(serialized).toContain('[redacted-uri]');
    expect(serialized).not.toContain('/Users/aleksandrgrebeshok');
    expect(serialized).not.toContain('actor-secret');
    expect(serialized).not.toContain('agent-secret');
    expect(serialized).not.toContain('artifact://run/diff');
    expect(serialized).not.toContain('raw context pack');
    expect(serialized).not.toContain('raw proof');
    expect(serialized).not.toContain(tmpDir);
    expect((result.body as { messages: Array<Record<string, unknown>> }).messages[0]).not.toHaveProperty('payload');
    expect((result.body as { messages: Array<Record<string, unknown>> }).messages).toHaveLength(1);
  });

  it('controls runs with replay and abort actions', async () => {
    await expect(post(port, '/api/runs/run-1/control', { action: 'replay' })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, action: 'replay', run: expect.objectContaining({ run_id: 'run-1' }) },
    });
    await expect(post(port, '/api/runs/run-1/control', { action: 'abort' })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, action: 'abort', run: expect.objectContaining({ run_id: 'run-1', status: 'cancelled' }) },
    });
  });

  it('lists overlay manifests and folds kernel ledger events into audit timeline', async () => {
    const overlayList = await get(port, '/api/overlays');
    expect(overlayList).toMatchObject({
      status: 200,
      body: { overlays: expect.arrayContaining([expect.objectContaining({ domainId: 'ochag' })]) },
    });
    const legacyOchagOverlay = (overlayList.body as { overlays: Array<Record<string, unknown>> }).overlays
      .find((overlay) => overlay.domainId === 'ochag');
    expect(legacyOchagOverlay).toMatchObject({
      workflowTemplates: expect.any(Array),
      adapterRegistrations: expect.any(Array),
      toolPermissionOverrides: expect.any(Object),
    });

    const publicOverlayList = await get(port, '/api/overlay-summaries');
    expect(publicOverlayList).toMatchObject({
      status: 200,
      body: { overlays: expect.arrayContaining([expect.objectContaining({ domainId: 'ochag' })]) },
    });
    const publicOchagOverlay = (publicOverlayList.body as { overlays: Array<Record<string, unknown>> }).overlays
      .find((overlay) => overlay.domainId === 'ochag');
    expect(publicOchagOverlay).toMatchObject({
      workflowCount: expect.any(Number),
      adapterCount: expect.any(Number),
      privacyRuleIds: expect.any(Array),
      toolPermissionSummaries: expect.any(Array),
    });
    expect(publicOchagOverlay).not.toHaveProperty('workflowTemplates');
    expect(publicOchagOverlay).not.toHaveProperty('adapterRegistrations');
    expect(publicOchagOverlay).not.toHaveProperty('toolPermissionOverrides');
    expect(publicOchagOverlay).not.toHaveProperty('staticPolicyFacts');

    await expect(get(port, '/api/overlays/ochag')).resolves.toMatchObject({
      status: 200,
      body: { overlay: expect.objectContaining({ domainId: 'ochag', workflowTemplates: expect.any(Array) }) },
    });
    await expect(get(port, '/api/overlay-summaries/ceoclaw')).resolves.toMatchObject({
      status: 200,
      body: {
        overlay: expect.objectContaining({
          domainId: 'ceoclaw',
          workflowCount: expect.any(Number),
          adapterCount: expect.any(Number),
          toolPermissionSummaries: expect.arrayContaining(['network_write:deny']),
        }),
      },
    });
    const ceoclawOverlay = (await get(port, '/api/overlay-summaries/ceoclaw')).body as { overlay: Record<string, unknown> };
    expect(ceoclawOverlay.overlay).not.toHaveProperty('workflowTemplates');
    expect(ceoclawOverlay.overlay).not.toHaveProperty('adapterRegistrations');
    expect(ceoclawOverlay.overlay).not.toHaveProperty('toolPermissionOverrides');
    expect(ceoclawOverlay.overlay).not.toHaveProperty('staticPolicyFacts');
    const audit = await get(port, '/api/audit/events?limit=20');
    expect(audit.status).toBe(200);
    expect((audit.body as { events: Array<{ type: string }> }).events.map((event) => event.type)).toContain('effect.proposed');
  });

  it('exposes Ochag privacy and reminder preview through real overlay/Product Factory fallback', async () => {
    await expect(get(port, '/api/ochag/privacy')).resolves.toMatchObject({
      status: 200,
      body: {
        domainId: 'ochag',
        privacyRules: expect.arrayContaining([
          expect.objectContaining({ id: 'member-private-memory' }),
          expect.objectContaining({ id: 'family-visibility-boundary' }),
        ]),
        toolPermissionOverrides: expect.objectContaining({ telegram_send: 'ask_once' }),
        adapterRegistrations: expect.arrayContaining([expect.objectContaining({ target: 'telegram' })]),
      },
    });

    await expect(post(port, '/api/ochag/reminders/preview', {
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00 daily',
      audience: 'parents',
      visibility: 'family',
    })).resolves.toMatchObject({
      status: 200,
      body: {
        preview: expect.objectContaining({
          intent: expect.objectContaining({ domainIds: ['ochag'] }),
          missingClarifications: [],
          dagPreview: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ kind: 'ochag.privacy_check' }),
              expect.objectContaining({ kind: 'ochag.telegram_notify' }),
            ]),
          }),
        }),
      },
    });
  });
});

const __testFilename = fileURLToPath(import.meta.url);
const ACTUAL_STATIC_DIR = pathModule.join(pathModule.dirname(__testFilename), 'telegram', 'app');

describe('Mini App routes', () => {
  let port: number;
  let gw: ReturnType<typeof createRuntimeGateway>;
  let tmpDir: string;
  let goalStore: GoalStore;
  let runtime: PyrforRuntime;
  let connectorProbeStatus: ReturnType<typeof vi.fn>;
  let researchSearchCapture: ReturnType<typeof vi.fn>;
  let researchSourceCapture: ReturnType<typeof vi.fn>;
  let browserSmokeCapture: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    approvalFlow.resetForTests();
    tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-test-'));
    goalStore = new GoalStore(tmpDir);
    runtime = makeRuntime();
    (runtime as unknown as { getRunProductFactoryPlan: ReturnType<typeof vi.fn> }).getRunProductFactoryPlan = vi.fn(async (runId: string) => ({
      artifact: {
        id: 'product-plan-1.json',
        kind: 'plan',
        uri: '/tmp/product-plan-1.json',
        sha256: 'sha-product-plan',
        createdAt: '2026-05-05T00:03:00.000Z',
        meta: { productFactory: true, templateId: 'feature' },
      },
      preview: {
        intent: { id: 'pf-1', templateId: 'feature', title: 'Build product', goal: 'Build product', domainIds: [] },
        template: { id: 'feature', title: 'Feature delivery' },
        missingClarifications: [],
        scopedPlan: { objective: 'Build product', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
        qualityGateReadiness: [],
        actorWorkflow: { enabled: true, recommendedModel: 'gpt-5.4', actors: [], nextStep: 'GPT-5.4 is recommended for this multi-agent workflow.' },
        dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
        deliveryChecklist: ['implementation_summary'],
      },
    }));
    researchSearchCapture = vi.fn(async (_runId: string, input: { query: string; approvalId: string }) => ({
      artifact: {
        id: 'research-search-1.json',
        kind: 'summary',
        uri: '/tmp/research-search-1.json',
        sha256: 'sha-research-search',
        createdAt: '2026-05-04T00:02:00.000Z',
        meta: { artifactKind: 'research_evidence', sourceMode: 'governed_search' },
      },
      snapshot: {
        schemaVersion: 'pyrfor.research_evidence.v2',
        createdAt: '2026-05-04T00:02:00.000Z',
        runId: _runId,
        query: input.query,
        queryHash: 'query-hash',
        sourceMode: 'governed_search',
        effectsExecuted: [{
          kind: 'web_search',
          provider: 'brave',
          approvalId: input.approvalId,
          executedAt: '2026-05-04T00:02:00.000Z',
          maxResults: 5,
          resultCount: 1,
        }],
        sources: [{ url: 'https://example.com/search', title: 'Search result' }],
        summary: 'Governed brave search captured 1 source.',
        notes: [],
      },
    }));
    (runtime as unknown as { captureRunResearchSearch: typeof researchSearchCapture }).captureRunResearchSearch = researchSearchCapture;
    researchSourceCapture = vi.fn(async (_runId: string, input: { url: string; approvalId: string; note?: string }) => ({
      artifact: {
        id: 'research-source-1.json',
        kind: 'research_source_capture',
        uri: '/tmp/research-source-1.json',
        sha256: 'sha-research-source',
        createdAt: '2026-05-05T00:04:00.000Z',
        meta: { artifactKind: 'research_source_capture', sourceMode: 'governed_source_capture' },
      },
      snapshot: {
        schemaVersion: 'pyrfor.research_source_capture.v1',
        createdAt: '2026-05-05T00:04:00.000Z',
        runId: _runId,
        sourceMode: 'governed_source_capture',
        requestedUrl: 'https://example.com/redacted-path?token=redacted',
        requestedUrlHash: 'source-url-hash',
        requestedHost: 'example.com',
        requestedPathHash: 'source-path-hash',
        finalUrl: 'https://example.com/redacted-path?token=redacted',
        finalUrlHash: 'source-url-hash',
        finalHost: 'example.com',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Source title',
        contentHash: 'content-hash',
        capturedBytes: 32,
        truncated: false,
        excerpt: 'captured safe excerpt',
        ...(input.note ? { note: input.note } : {}),
        effectsExecuted: [{
          kind: 'research_source_capture',
          approvalId: input.approvalId,
          executedAt: '2026-05-05T00:04:00.000Z',
          requestedUrlHash: 'source-url-hash',
          finalUrlHash: 'source-url-hash',
        }],
      },
    }));
    (runtime as unknown as { captureRunResearchSource: typeof researchSourceCapture }).captureRunResearchSource = researchSourceCapture;
    (runtime as unknown as { listRunResearchSourceCaptures: ReturnType<typeof vi.fn> }).listRunResearchSourceCaptures = vi.fn(async () => ([{
      artifact: {
        id: 'research-source-1.json',
        kind: 'research_source_capture',
        uri: '/tmp/research-source-1.json',
        sha256: 'sha-research-source',
        createdAt: '2026-05-05T00:04:00.000Z',
        meta: { artifactKind: 'research_source_capture' },
      },
      snapshot: {
        schemaVersion: 'pyrfor.research_source_capture.v1',
        createdAt: '2026-05-05T00:04:00.000Z',
        runId: 'run-1',
        sourceMode: 'governed_source_capture',
        requestedUrl: 'https://example.com/redacted-path?token=redacted',
        requestedUrlHash: 'source-url-hash',
        requestedHost: 'example.com',
        requestedPathHash: 'source-path-hash',
        finalUrl: 'https://example.com/redacted-path?token=redacted',
        finalUrlHash: 'source-url-hash',
        finalHost: 'example.com',
        statusCode: 200,
        contentType: 'text/html',
        contentHash: 'content-hash',
        capturedBytes: 32,
        truncated: false,
        excerpt: 'captured safe excerpt',
        effectsExecuted: [],
      },
    }]));
    browserSmokeCapture = vi.fn(async (_runId: string, input: { url: string; approvalId: string }) => ({
      artifact: {
        id: 'browser-smoke-1.json',
        kind: 'summary',
        uri: '/tmp/browser-smoke-1.json',
        sha256: 'sha-browser-smoke',
        createdAt: '2026-05-05T00:02:00.000Z',
        meta: { artifactKind: 'browser_smoke', sourceMode: 'governed_browser_smoke' },
      },
      screenshotArtifact: {
        id: 'browser-smoke-shot-1.png',
        kind: 'screenshot',
        uri: '/tmp/browser-smoke-shot-1.png',
        sha256: 'sha-browser-smoke-shot',
        bytes: 9,
        createdAt: '2026-05-05T00:02:00.000Z',
        meta: { artifactKind: 'browser_smoke_screenshot' },
      },
      snapshot: {
        schemaVersion: 'pyrfor.browser_smoke.v1',
        createdAt: '2026-05-05T00:02:00.000Z',
        runId: _runId,
        status: 'passed',
        sourceMode: 'governed_browser_smoke',
        targetUrlHash: 'target-url-hash',
        targetHost: 'localhost:5173',
        targetPathHash: 'target-path-hash',
        finalHost: 'localhost:5173',
        finalUrlHash: 'final-url-hash',
        title: 'Pyrfor',
        assertion: { selector: '#root', containsTextHash: 'assertion-text-hash', matched: true },
        screenshot: {
          artifactId: 'browser-smoke-shot-1.png',
          sha256: 'sha-browser-smoke-shot',
          bytes: 9,
          createdAt: '2026-05-05T00:02:00.000Z',
        },
        effectsExecuted: [{
          kind: 'browser_smoke',
          approvalId: input.approvalId,
          executedAt: '2026-05-05T00:02:00.000Z',
          targetUrlHash: 'target-url-hash',
          finalUrlHash: 'final-url-hash',
        }],
        notes: [],
      },
    }));
    (runtime as unknown as {
      captureRunBrowserSmoke: typeof browserSmokeCapture;
      listRunBrowserSmoke: typeof browserSmokeCapture;
    }).captureRunBrowserSmoke = browserSmokeCapture;
    (runtime as unknown as { listRunBrowserSmoke: ReturnType<typeof vi.fn> }).listRunBrowserSmoke = vi.fn(async () => ([{
      artifact: {
        id: 'browser-smoke-1.json',
        kind: 'summary',
        uri: '/tmp/browser-smoke-1.json',
        sha256: 'sha-browser-smoke',
        createdAt: '2026-05-05T00:02:00.000Z',
        meta: { artifactKind: 'browser_smoke' },
      },
      screenshotArtifact: {
        id: 'browser-smoke-shot-1.png',
        kind: 'screenshot',
        uri: '/tmp/browser-smoke-shot-1.png',
        sha256: 'sha-browser-smoke-shot',
        bytes: 9,
        createdAt: '2026-05-05T00:02:00.000Z',
        meta: { artifactKind: 'browser_smoke_screenshot' },
      },
      snapshot: {
        schemaVersion: 'pyrfor.browser_smoke.v1',
        createdAt: '2026-05-05T00:02:00.000Z',
        runId: 'run-1',
        status: 'passed',
        sourceMode: 'governed_browser_smoke',
        targetUrlHash: 'target-url-hash',
        targetHost: 'localhost:5173',
        targetPathHash: 'target-path-hash',
        finalHost: 'localhost:5173',
        finalUrlHash: 'final-url-hash',
        title: 'Pyrfor',
        screenshot: { artifactId: 'browser-smoke-shot-1.png' },
        effectsExecuted: [],
        notes: [],
      },
    }]));
    connectorProbeStatus = vi.fn(async () => ({
      id: 'telegram',
      name: 'Telegram',
      description: 'Telegram bridge',
      direction: 'bidirectional' as const,
      sourceSystem: 'Telegram Bot API',
      operations: ['Receive commands'],
      credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
      apiSurface: [{ method: 'WEBHOOK' as const, path: '/api/telegram/webhook', description: 'Webhook' }],
      stub: false,
      status: 'pending' as const,
      configured: false,
      checkedAt: '2026-05-04T00:01:00.000Z',
      message: 'Probe reached https://bot:secret@example.test/status?api_key=secret&ok=1 with token=telegram-token-123456 and Bearer abcdefghijk.',
      missingSecrets: ['TELEGRAM_BOT_TOKEN'],
      metadata: {
        probeUrl: 'https://bot:secret@example.test/status?api_key=secret&ok=1',
        authToken: 'secret',
        lastErrorMessage: 'upstream echoed password: hunter2 and api_key=telegram-token-123456',
      },
    }));
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime,
      goalStore,
      approvalSettingsPath: pathModule.join(tmpDir, 'approval-settings.json'),
      staticDir: ACTUAL_STATIC_DIR,
      connectorInventory: {
        getSnapshot: () => ({
          checkedAt: '2026-05-04T00:00:00.000Z',
          statusSource: 'local-config',
          connectors: [{
            id: 'telegram',
            name: 'Telegram',
            description: 'Telegram bridge',
            direction: 'bidirectional',
            sourceSystem: 'Telegram Bot API',
            operations: ['Receive commands'],
            credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
            apiSurface: [{ method: 'WEBHOOK', path: '/api/telegram/webhook', description: 'Webhook' }],
            stub: false,
            configured: false,
            missingSecrets: ['TELEGRAM_BOT_TOKEN'],
            hasProbe: true,
            readiness: {
              state: 'pending',
              reasons: ['Missing required env: TELEGRAM_BOT_TOKEN'],
              nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
            },
            probePreview: {
              mode: 'descriptor-status',
              requiresApproval: true,
              requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
              headerNames: [],
              bodyConfigured: false,
              note: 'Live status comes from the connector adapter and is not executed by inventory.',
            },
            liveProbeSkipped: true,
            statusSource: 'local-config',
          }],
          summary: { total: 1, configured: 0, pending: 1, stubs: 0, liveProbeSkipped: 1 },
        }),
        probeStatus: connectorProbeStatus,
      },
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
    approvalFlow.resetForTests();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── Static files ───────────────────────────────────────────────────────

  it('GET /app → 200 with text/html', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const text = await res.text();
    expect(text).toContain('<title');
  });

  it('GET /app/ → 200 index.html', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<title');
  });

  it('GET /app/index.html → 200 text/html with <title', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<title');
  });

  it('GET /app/style.css → 200 text/css', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('GET /app/app.js → 200 application/javascript', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('GET /app/missing.css → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/missing.css`);
    expect(res.status).toBe(404);
  });

  // ── OPTIONS preflight ──────────────────────────────────────────────────

  it('OPTIONS preflight → 204 with CORS headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/goals`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  // ── Dashboard ──────────────────────────────────────────────────────────

    it('GET /api/dashboard → 200 JSON with required keys', async () => {
      const { status, body } = await get(port, '/api/dashboard');
      const res = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(d).toHaveProperty('status');
    expect(d).toHaveProperty('model');
    expect(d).toHaveProperty('costToday');
    expect(d).toHaveProperty('sessionsCount');
    expect(d).toHaveProperty('activeGoals');
    expect(d).toHaveProperty('recentActivity');
    expect(d).toHaveProperty('workspaceRoot');
    expect(d).toHaveProperty('cwd');
      expect(Array.isArray(d['activeGoals'])).toBe(true);
      expect(Array.isArray(d['recentActivity'])).toBe(true);
    });

    // Regression for the "false green" lesson: costToday must NOT be fed by the
    // optional token-budget controller (a per-worker budget) nor by a mock. With
    // no provider router wired it stays null — an explicit "not connected"
    // signal, never a fake 0. The real aggregation path is exercised in the
    // 'dashboard costToday (real runtime spend)' suite below.
    it('GET /api/dashboard → costToday is null when no provider router is wired', async () => {
      const { status, body } = await get(port, '/api/dashboard');
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).costToday).toBeNull();
    });

    it('GET /api/connectors/inventory returns local-only connector inventory', async () => {
      const { status, body } = await get(port, '/api/connectors/inventory');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        statusSource: 'local-config',
        summary: { total: 1, pending: 1, liveProbeSkipped: 1 },
        connectors: [expect.objectContaining({
          id: 'telegram',
          missingSecrets: ['TELEGRAM_BOT_TOKEN'],
          readiness: expect.objectContaining({
            state: 'pending',
            nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
          }),
          probePreview: expect.objectContaining({
            mode: 'descriptor-status',
            requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
          }),
          liveProbeSkipped: true,
          statusSource: 'local-config',
        })],
      });
    });

    it('GET /api/research/readiness reports local-only governed search setup without live effects', async () => {
      const originalProvider = process.env['PYRFOR_RESEARCH_SEARCH_PROVIDER'];
      const originalBraveKey = process.env['BRAVE_API_KEY'];
      delete process.env['PYRFOR_RESEARCH_SEARCH_PROVIDER'];
      delete process.env['BRAVE_API_KEY'];
      try {
        const unavailable = await get(port, '/api/research/readiness');
        expect(unavailable.status).toBe(200);
        expect(unavailable.body).toMatchObject({
          statusSource: 'local-config',
          liveProbeSkipped: true,
          approvalRequired: true,
          status: 'unavailable',
          defaultProvider: null,
          reasons: ['ResearchSearch: BRAVE_API_KEY is required for governed search, or set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo'],
          providers: expect.arrayContaining([
            expect.objectContaining({
              provider: 'brave',
              configured: false,
              missingEnv: ['BRAVE_API_KEY'],
            }),
            expect.objectContaining({
              provider: 'duckduckgo',
              configured: true,
              missingEnv: [],
            }),
          ]),
        });
        expect(researchSearchCapture).not.toHaveBeenCalled();

        process.env['PYRFOR_RESEARCH_SEARCH_PROVIDER'] = 'duckduckgo';
        const duckduckgo = await get(port, '/api/research/readiness');
        expect(duckduckgo.status).toBe(200);
        expect(duckduckgo.body).toMatchObject({
          status: 'ready',
          defaultProvider: 'duckduckgo',
          configuredProvider: 'duckduckgo',
          reasons: ['Default governed search provider is duckduckgo.'],
        });
      } finally {
        if (originalProvider === undefined) delete process.env['PYRFOR_RESEARCH_SEARCH_PROVIDER'];
        else process.env['PYRFOR_RESEARCH_SEARCH_PROVIDER'] = originalProvider;
        if (originalBraveKey === undefined) delete process.env['BRAVE_API_KEY'];
        else process.env['BRAVE_API_KEY'] = originalBraveKey;
      }
    });

    it('GET /api/github/delivery-readiness reports unavailable local delivery prerequisites without live effects', async () => {
      const originalPyrforToken = process.env['PYRFOR_GITHUB_TOKEN'];
      const originalGithubToken = process.env['GITHUB_TOKEN'];
      const originalGhToken = process.env['GH_TOKEN'];
      delete process.env['PYRFOR_GITHUB_TOKEN'];
      delete process.env['GITHUB_TOKEN'];
      delete process.env['GH_TOKEN'];
      try {
        const result = await get(port, '/api/github/delivery-readiness');
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          statusSource: 'local-config',
          liveProbeSkipped: true,
          approvalRequired: true,
          status: 'unavailable',
          tokenConfigured: false,
          tokenEnvVar: null,
          git: expect.objectContaining({ available: false }),
          github: { repository: null, remoteConfigured: false },
        });
        expect((result.body as { reasons: string[] }).reasons).toEqual(expect.arrayContaining([
          'GitHub token env is missing: set PYRFOR_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN.',
        ]));
        expect((result.body as Record<string, unknown>)['token']).toBeUndefined();
      } finally {
        if (originalPyrforToken === undefined) delete process.env['PYRFOR_GITHUB_TOKEN'];
        else process.env['PYRFOR_GITHUB_TOKEN'] = originalPyrforToken;
        if (originalGithubToken === undefined) delete process.env['GITHUB_TOKEN'];
        else process.env['GITHUB_TOKEN'] = originalGithubToken;
        if (originalGhToken === undefined) delete process.env['GH_TOKEN'];
        else process.env['GH_TOKEN'] = originalGhToken;
      }
    });

    it('GET /api/github/delivery-readiness reports ready local GitHub delivery setup', async () => {
      const workspace = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-github-readiness-test-'));
      const originalPyrforToken = process.env['PYRFOR_GITHUB_TOKEN'];
      const originalGithubToken = process.env['GITHUB_TOKEN'];
      const originalGhToken = process.env['GH_TOKEN'];
      let readyGw: ReturnType<typeof createRuntimeGateway> | null = null;
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
        writeFileSync(pathModule.join(workspace, 'README.md'), '# Pyrfor\n');
        execFileSync('git', ['add', 'README.md'], { cwd: workspace, stdio: 'ignore' });
        execFileSync('git', ['-c', 'user.name=Pyrfor Test', '-c', 'user.email=pyrfor@example.test', 'commit', '-m', 'Initial commit'], { cwd: workspace, stdio: 'ignore' });
        execFileSync('git', ['remote', 'add', 'origin', 'https://token:secret@github.com/acme/pyrfor.git'], { cwd: workspace, stdio: 'ignore' });
        process.env['PYRFOR_GITHUB_TOKEN'] = 'test-token';
        delete process.env['GITHUB_TOKEN'];
        delete process.env['GH_TOKEN'];

        const runtime = makeRuntime();
        runtime.getWorkspacePath = vi.fn().mockReturnValue(workspace);
        readyGw = createRuntimeGateway({ config: makeConfig(), runtime, health: makeHealth(), cron: makeCron() });
        await readyGw.start();

        const result = await get(readyGw.port, '/api/github/delivery-readiness');
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          statusSource: 'local-config',
          liveProbeSkipped: true,
          approvalRequired: true,
          status: 'ready',
          tokenConfigured: true,
          tokenEnvVar: 'PYRFOR_GITHUB_TOKEN',
          git: expect.objectContaining({ available: true, branch: 'main', dirtyFileCount: 0 }),
          github: { repository: 'acme/pyrfor', remoteConfigured: true },
          reasons: ['Local GitHub delivery prerequisites are configured.'],
        });
        expect(JSON.stringify(result.body)).not.toContain('test-token');
        expect(JSON.stringify(result.body)).not.toContain('token:secret');
      } finally {
        if (readyGw) await readyGw.stop();
        rmSync(workspace, { recursive: true, force: true });
        if (originalPyrforToken === undefined) delete process.env['PYRFOR_GITHUB_TOKEN'];
        else process.env['PYRFOR_GITHUB_TOKEN'] = originalPyrforToken;
        if (originalGithubToken === undefined) delete process.env['GITHUB_TOKEN'];
        else process.env['GITHUB_TOKEN'] = originalGithubToken;
        if (originalGhToken === undefined) delete process.env['GH_TOKEN'];
        else process.env['GH_TOKEN'] = originalGhToken;
      }
    });

    it('GET /api/github/delivery-readiness reports unborn git repositories without hiding git availability', async () => {
      const workspace = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-github-unborn-test-'));
      const originalPyrforToken = process.env['PYRFOR_GITHUB_TOKEN'];
      let unbornGw: ReturnType<typeof createRuntimeGateway> | null = null;
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
        execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/pyrfor.git'], { cwd: workspace, stdio: 'ignore' });
        process.env['PYRFOR_GITHUB_TOKEN'] = 'test-token';

        const runtime = makeRuntime();
        runtime.getWorkspacePath = vi.fn().mockReturnValue(workspace);
        unbornGw = createRuntimeGateway({ config: makeConfig(), runtime, health: makeHealth(), cron: makeCron() });
        await unbornGw.start();

        const result = await get(unbornGw.port, '/api/github/delivery-readiness');
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          status: 'unavailable',
          tokenConfigured: true,
          git: expect.objectContaining({ available: true, branch: 'main', headSha: null }),
          github: { repository: 'acme/pyrfor', remoteConfigured: true },
        });
        expect((result.body as { reasons: string[] }).reasons).toEqual(expect.arrayContaining([
          'Git HEAD sha is unavailable; create an initial commit.',
        ]));
      } finally {
        if (unbornGw) await unbornGw.stop();
        rmSync(workspace, { recursive: true, force: true });
        if (originalPyrforToken === undefined) delete process.env['PYRFOR_GITHUB_TOKEN'];
        else process.env['PYRFOR_GITHUB_TOKEN'] = originalPyrforToken;
      }
    });

    it('GET /api/browser/readiness reports local-only Browser QA setup without launching browser probes', async () => {
      const result = await get(port, '/api/browser/readiness');
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        browserTool: expect.objectContaining({
          name: 'browser',
          available: true,
          actions: expect.arrayContaining(['screenshot', 'extract']),
        }),
        playwright: expect.objectContaining({
          packageName: 'playwright',
          installed: expect.any(Boolean),
          chromiumInstalled: expect.any(Boolean),
        }),
        permission: { toolName: 'browser_navigate', permissionClass: 'ask_once', sideEffect: 'network' },
      });
      expect(JSON.stringify(result.body)).not.toContain('http://');
      expect(JSON.stringify(result.body)).not.toContain('https://');
    });

    it('GET /api/release/readiness reports local-only release setup without running release effects', async () => {
      const result = await get(port, '/api/release/readiness');
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        secrets: expect.arrayContaining([
          expect.objectContaining({ name: 'APPLE_SIGNING_IDENTITY', configured: expect.any(Boolean) }),
          expect.objectContaining({ name: 'TAURI_SIGNING_PRIVATE_KEY', configured: expect.any(Boolean) }),
        ]),
        artifacts: expect.arrayContaining([
          expect.objectContaining({ name: 'pyrfor-daemon-aarch64-apple-darwin', present: expect.any(Boolean) }),
        ]),
        contracts: expect.arrayContaining([
          expect.objectContaining({ id: 'tauri-updater-active', passed: expect.any(Boolean) }),
        ]),
      });
      expect(JSON.stringify(result.body)).not.toContain('/Users/aleksandrgrebeshok');
      expect(JSON.stringify(result.body)).not.toContain('APPLE_PASSWORD=');
      expect(JSON.stringify(result.body)).not.toContain('TAURI_SIGNING_PRIVATE_KEY=');
    });

    it('GET /api/runs/:id/product-factory-plan returns persisted plan without local artifact uri', async () => {
      const result = await get(port, '/api/runs/run-1/product-factory-plan');
      expect(result.status).toBe(200);
      expect((result.body as { artifact: { uri?: string } }).artifact.uri).toBeUndefined();
      expect(result.body).toMatchObject({
        artifact: expect.objectContaining({
          id: 'product-plan-1.json',
          kind: 'plan',
          meta: expect.objectContaining({ productFactory: true, templateId: 'feature' }),
        }),
        preview: expect.objectContaining({
          intent: expect.objectContaining({ id: 'pf-1', title: 'Build product' }),
          actorWorkflow: expect.objectContaining({ recommendedModel: 'gpt-5.4' }),
        }),
      });
      expect(JSON.stringify(result.body)).not.toContain('/tmp/product-plan');
    });

    it('skill inspector routes return metadata only and bounded recommendations', async () => {
      const catalog = await get(port, '/api/skills');
      expect(catalog.status).toBe(200);
      expect(catalog.body).toMatchObject({
        total: expect.any(Number),
        skills: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            systemPromptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            stepsCount: expect.any(Number),
          }),
        ]),
      });
      for (const skill of (catalog.body as { skills: Array<Record<string, unknown>> }).skills) {
        expect(skill.systemPrompt).toBeUndefined();
      }

      const recommended = await post(port, '/api/skills/recommend', { task: 'Fix a TypeScript type error', limit: 50 });
      expect(recommended.status).toBe(200);
      expect(recommended.body).toMatchObject({
        limit: 10,
        recommendations: expect.any(Array),
      });
      for (const skill of (recommended.body as { recommendations: Array<Record<string, unknown>> }).recommendations) {
        expect(skill.systemPrompt).toBeUndefined();
      }
    });

    it('imports SKILL.md into the governed tool registry without exposing prompt or local paths', async () => {
      const registryDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-skill-registry-'));
      const toolRegistry = createToolRegistry(registryDir);
      const skillGateway = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        orchestration: { toolRegistry },
      });
      await skillGateway.start();
      try {
        const response = await post(skillGateway.port, '/api/skills/import', {
          sourceLabel: '/Users/aleksandrgrebeshok/.openclaw/skills/deploy/SKILL.md',
          content: [
            '---',
            'name: /Users/aleksandrgrebeshok/private/API_KEY=secret',
            'description: Deploy from /Users/aleksandrgrebeshok/private/app with API_KEY=secret',
            'trigger: deploy, release',
            'category: automation',
            '---',
            'Use /Users/aleksandrgrebeshok/private/deploy.sh and TOKEN=secret.',
          ].join('\n'),
        });
        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
          schemaVersion: 'pyrfor.skill_import.v1',
          imported: true,
          duplicate: false,
          entry: expect.objectContaining({
            name: 'skill:redacted-path',
            kind: 'skill',
            status: 'pending_validation',
            quality: expect.objectContaining({
              provenance: 'imported',
              provenanceTrust: 'quarantined',
              approvalRequired: true,
              testsPassed: false,
            }),
          }),
        });
        expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
        expect(JSON.stringify(response.body)).not.toContain('=secret');
        expect(JSON.stringify(response.body)).not.toContain('deploy.sh');

        const listed = await get(skillGateway.port, '/api/tools/registry?status=pending_validation&tag=skill-import');
        expect(listed.status).toBe(200);
        expect(listed.body).toMatchObject({
          schemaVersion: 'pyrfor.tool_registry.v1',
          total: 1,
          tools: [expect.objectContaining({ name: 'skill:redacted-path', status: 'pending_validation' })],
        });
        expect(JSON.stringify(listed.body)).not.toContain('/Users/aleksandrgrebeshok');
        expect(JSON.stringify(listed.body)).not.toContain('TOKEN=secret');
      } finally {
        await skillGateway.stop();
        rmSync(registryDir, { recursive: true, force: true });
      }
    });

    it('POST /api/skills/import rejects malformed or oversized SKILL.md content', async () => {
      const registryDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-skill-registry-'));
      const skillGateway = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        orchestration: { toolRegistry: createToolRegistry(registryDir) },
      });
      await skillGateway.start();
      try {
        const malformed = await post(skillGateway.port, '/api/skills/import', { content: 'name: missing frontmatter' });
        expect(malformed.status).toBe(400);
        expect(malformed.body).toMatchObject({ error: 'invalid_skill_md' });

        const oversized = await post(skillGateway.port, '/api/skills/import', {
          content: `---\nname: too-big\n---\n${'x'.repeat((128 * 1024) + 1)}`,
        });
        expect(oversized.status).toBe(400);
        expect(oversized.body).toMatchObject({ error: 'skill_content_too_large' });
      } finally {
        await skillGateway.stop();
        rmSync(registryDir, { recursive: true, force: true });
      }
    });

    it('POST /api/skills/recommend rejects invalid input', async () => {
      const invalid = await post(port, '/api/skills/recommend', { task: '   ' });
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ error: 'invalid_skill_task' });
    });

    it('GET /api/slash-commands returns auto-allow metadata only', async () => {
      const response = await get(port, '/api/slash-commands');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        commands: [
          expect.objectContaining({
            name: 'skills',
            permissionClass: 'auto_allow',
            description: expect.any(String),
          }),
        ],
      });
      const commands = (response.body as { commands: Array<Record<string, unknown>> }).commands;
      expect(commands.map((command) => command.name)).toEqual(['skills']);
      expect(JSON.stringify(commands)).not.toContain('handler');
      expect(JSON.stringify(commands)).not.toContain('systemPrompt');
    });

    it('POST /api/slash-commands/invoke only runs exposed /skills command', async () => {
      const listed = await post(port, '/api/slash-commands/invoke', { command: '/skills --limit=3' });
      expect(listed.status).toBe(200);
      expect(listed.body).toMatchObject({
        ok: true,
        output: expect.stringContaining('Available governed skills'),
      });
      expect(JSON.stringify(listed.body)).not.toContain('expert software engineer specialising');
      expect(JSON.stringify(listed.body)).not.toContain('methodical debugger');

      const recommended = await post(port, '/api/slash-commands/invoke', { command: '/skills "Fix a TypeScript error" --limit=5' });
      expect(recommended.status).toBe(200);
      expect(recommended.body).toMatchObject({
        ok: true,
        output: expect.stringContaining('Recommended skills for "Fix a TypeScript error"'),
      });

      const deniedStub = await post(port, '/api/slash-commands/invoke', { command: '/help' });
      expect(deniedStub.status).toBe(403);
      expect(deniedStub.body).toMatchObject({ error: 'slash_command_not_exposed', command: 'help' });

      const deniedUnknown = await post(port, '/api/slash-commands/invoke', { command: '/unknown' });
      expect(deniedUnknown.status).toBe(403);
      expect(deniedUnknown.body).toMatchObject({ error: 'slash_command_not_exposed', command: 'unknown' });
    });

    it('POST /api/slash-commands/invoke rejects malformed or blank input', async () => {
      const invalidJson = await postRaw(port, '/api/slash-commands/invoke', '{not json');
      expect(invalidJson.status).toBe(400);
      expect(invalidJson.body).toMatchObject({ error: 'invalid_json' });

      const blank = await post(port, '/api/slash-commands/invoke', { command: '   ' });
      expect(blank.status).toBe(400);
      expect(blank.body).toMatchObject({ error: 'invalid_slash_command' });
    });

    it('POST /api/slash-commands/invoke rejects client-supplied scope overrides', async () => {
      const response = await post(port, '/api/slash-commands/invoke', {
        command: '/skills --limit=3',
        workspaceId: 'other-workspace',
        sessionId: 'other-session',
        runId: 'other-run',
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'scope_override_not_allowed',
        fields: ['workspaceId', 'sessionId', 'runId'],
      });
    });

    it('POST /api/connectors/:id/probe requires approval before running live status probe', async () => {
      const requested = await post(port, '/api/connectors/telegram/probe', {});
      expect(requested.status).toBe(202);
      expect(requested.body).toMatchObject({
        status: 'approval_required',
        connectorId: 'telegram',
        liveProbe: true,
        approval: expect.objectContaining({
          id: 'connector-live-probe:telegram',
          toolName: 'connector_live_probe',
        }),
      });
      expect(connectorProbeStatus).not.toHaveBeenCalled();

      const pendingAttempt = await post(port, '/api/connectors/telegram/probe', { approvalId: 'connector-live-probe:telegram' });
      expect(pendingAttempt.status).toBe(409);
      expect(connectorProbeStatus).not.toHaveBeenCalled();

      const decision = await post(port, '/api/approvals/connector-live-probe:telegram/decision', { decision: 'approve' });
      expect(decision.status).toBe(200);

      const probed = await post(port, '/api/connectors/telegram/probe', { approvalId: 'connector-live-probe:telegram' });
      expect(probed.status).toBe(200);
      expect(probed.body).toMatchObject({
        status: 'probed',
        connectorId: 'telegram',
        liveProbe: true,
        connector: expect.objectContaining({
          id: 'telegram',
          status: 'pending',
          message: 'Probe reached https://redacted:redacted@example.test/status?api_key=[redacted] with token=[redacted] and Bearer [redacted]',
          missingSecrets: ['TELEGRAM_BOT_TOKEN'],
          metadata: {
            probeUrl: 'https://redacted:redacted@example.test/status?api_key=[redacted]',
            authToken: '[redacted]',
            lastErrorMessage: 'upstream echoed password: [redacted] and api_key=[redacted]',
          },
        }),
      });
      expect(connectorProbeStatus).toHaveBeenCalledWith('telegram');
    });

    it('redacts live probe exception text before returning or auditing failures', async () => {
      connectorProbeStatus.mockRejectedValueOnce(
        new Error('fetch failed for https://bot:secret@example.test/status?api_key=secret with token=telegram-token-123456 and Bearer abcdefghijk'),
      );

      const requested = await post(port, '/api/connectors/telegram/probe', {});
      expect(requested.status).toBe(202);
      const decision = await post(port, '/api/approvals/connector-live-probe:telegram/decision', { decision: 'approve' });
      expect(decision.status).toBe(200);

      const failed = await post(port, '/api/connectors/telegram/probe', { approvalId: 'connector-live-probe:telegram' });
      expect(failed.status).toBe(500);
      expect(failed.body).toMatchObject({
        error: 'connector_probe_failed',
        message: 'fetch failed for https://redacted:redacted@example.test/status?api_key=[redacted] with token=[redacted] and Bearer [redacted]',
      });

      const audit = await get(port, '/api/audit/events?limit=10');
      expect(audit.status).toBe(200);
      expect(JSON.stringify(audit.body)).not.toContain('telegram-token-123456');
      expect(JSON.stringify(audit.body)).not.toContain('bot:secret');
      expect(JSON.stringify(audit.body)).not.toContain('abcdefghijk');
    });

    it('POST /api/runs/:id/research-search requires approval before live search capture', async () => {
      const originalBraveKey = process.env['BRAVE_API_KEY'];
      process.env['BRAVE_API_KEY'] = 'test-brave-key';
      const requested = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        maxResults: 5,
      });
      expect(requested.status).toBe(202);
      expect(requested.body).toMatchObject({
        status: 'approval_required',
        runId: 'run-1',
        liveSearch: true,
        approval: expect.objectContaining({
          toolName: 'research_live_search',
          args: expect.objectContaining({
            runId: 'run-1',
            queryHash: expect.any(String),
            maxResults: 5,
            provider: 'brave',
          }),
        }),
      });
      expect(researchSearchCapture).not.toHaveBeenCalled();
      const approvalId = (requested.body as { approval: { id: string } }).approval.id;

      const narrowerRequest = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        maxResults: 1,
      });
      expect(narrowerRequest.status).toBe(202);
      expect((narrowerRequest.body as { approval: { id: string } }).approval.id).not.toBe(approvalId);

      const pendingAttempt = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId,
      });
      expect(pendingAttempt.status).toBe(409);
      expect(researchSearchCapture).not.toHaveBeenCalled();

      const mismatch = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId: 'research-search:wrong',
      });
      expect(mismatch.status).toBe(403);
      expect(researchSearchCapture).not.toHaveBeenCalled();

      const decision = await post(port, `/api/approvals/${approvalId}/decision`, { decision: 'approve' });
      expect(decision.status).toBe(200);

      const captured = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId,
      });
      expect(captured.status).toBe(201);
      expect((captured.body as { artifact: { uri?: string } }).artifact.uri).toBeUndefined();
      expect(captured.body).toMatchObject({
        status: 'captured',
        artifact: expect.objectContaining({ id: 'research-search-1.json' }),
        snapshot: expect.objectContaining({
          sourceMode: 'governed_search',
          sources: [expect.objectContaining({ url: 'https://example.com/search' })],
        }),
      });
      expect(researchSearchCapture).toHaveBeenCalledWith('run-1', {
        query: 'Pyrfor OpenClaw memory migration',
        maxResults: 5,
        provider: 'brave',
        approvalId,
      });

      const reused = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId,
      });
      expect(reused.status).toBe(409);
      const audit = await get(port, '/api/audit/events?limit=10');
      expect(JSON.stringify(audit.body)).not.toContain('Pyrfor OpenClaw memory migration');
      expect(JSON.stringify(audit.body)).toContain('queryHash');
      if (originalBraveKey === undefined) delete process.env['BRAVE_API_KEY'];
      else process.env['BRAVE_API_KEY'] = originalBraveKey;
    });

    it('POST /api/runs/:id/research-search accepts explicit governed provider', async () => {
      const requested = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor migration research',
        maxResults: 2,
        provider: 'duckduckgo',
      });
      expect(requested.status).toBe(202);
      expect(requested.body).toMatchObject({
        status: 'approval_required',
        runId: 'run-1',
        approval: expect.objectContaining({
          args: expect.objectContaining({
            provider: 'duckduckgo',
            maxResults: 2,
          }),
        }),
      });
      const approvalId = (requested.body as { approval: { id: string } }).approval.id;

      const decision = await post(port, `/api/approvals/${approvalId}/decision`, { decision: 'approve' });
      expect(decision.status).toBe(200);

      const captured = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor migration research',
        maxResults: 2,
        provider: 'duckduckgo',
        approvalId,
      });
      expect(captured.status).toBe(201);
      expect(researchSearchCapture).toHaveBeenCalledWith('run-1', {
        query: 'Pyrfor migration research',
        maxResults: 2,
        provider: 'duckduckgo',
        approvalId,
      });

      const wrongProvider = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor migration research',
        maxResults: 2,
        provider: 'brave',
        approvalId,
      });
      expect(wrongProvider.status).toBe(403);
    });

    it('POST /api/runs/:id/research-search rejects unsupported provider', async () => {
      const invalid = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor migration research',
        provider: 'invalid',
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ error: 'invalid_research_search_request' });
    });

    it('POST /api/runs/:id/research-source-captures requires approval before bounded source fetch', async () => {
      const requested = await post(port, '/api/runs/run-1/research-source-captures', {
        url: 'https://example.com/article?token=secret&topic=pyrfor#frag',
        note: 'source note',
      });
      expect(requested.status).toBe(202);
      expect(requested.body).toMatchObject({
        status: 'approval_required',
        runId: 'run-1',
        sourceCapture: true,
        approval: expect.objectContaining({
          toolName: 'research_source_capture',
          args: expect.objectContaining({
            runId: 'run-1',
            sourceHost: 'example.com',
            sourceUrlHash: expect.any(String),
            sourcePathHash: expect.any(String),
            governedSourceCapture: true,
          }),
        }),
      });
      expect(JSON.stringify(requested.body)).not.toContain('secret');
      expect(JSON.stringify(requested.body)).not.toContain('/article');
      expect(researchSourceCapture).not.toHaveBeenCalled();
      const approvalId = (requested.body as { approval: { id: string } }).approval.id;

      const pendingAttempt = await post(port, '/api/runs/run-1/research-source-captures', {
        url: 'https://example.com/article?token=secret&topic=pyrfor',
        approvalId,
      });
      expect(pendingAttempt.status).toBe(409);

      const mismatch = await post(port, '/api/runs/run-1/research-source-captures', {
        url: 'https://example.com/other',
        approvalId,
      });
      expect(mismatch.status).toBe(403);

      const decision = await post(port, `/api/approvals/${approvalId}/decision`, { decision: 'approve' });
      expect(decision.status).toBe(200);

      const captured = await post(port, '/api/runs/run-1/research-source-captures', {
        url: 'https://example.com/article?token=secret&topic=pyrfor',
        note: 'source note',
        approvalId,
      });
      expect(captured.status).toBe(201);
      expect((captured.body as { artifact: { uri?: string } }).artifact.uri).toBeUndefined();
      expect(captured.body).toMatchObject({
        status: 'captured',
        artifact: expect.objectContaining({ id: 'research-source-1.json' }),
        snapshot: expect.objectContaining({
          sourceMode: 'governed_source_capture',
          finalHost: 'example.com',
          finalUrl: 'https://example.com/redacted-path?token=[redacted]',
          excerpt: 'captured safe excerpt',
        }),
      });
      expect(JSON.stringify(captured.body)).not.toContain('/tmp/research-source');
      expect(JSON.stringify(captured.body)).not.toContain('token=secret');
      expect(researchSourceCapture).toHaveBeenCalledWith('run-1', {
        url: 'https://example.com/article?token=secret&topic=pyrfor',
        note: 'source note',
        approvalId,
      });

      const reused = await post(port, '/api/runs/run-1/research-source-captures', {
        url: 'https://example.com/article?token=secret&topic=pyrfor',
        approvalId,
      });
      expect(reused.status).toBe(409);
    });

    it('GET /api/runs/:id/research-source-captures omits local artifact URIs', async () => {
      const listed = await get(port, '/api/runs/run-1/research-source-captures');
      expect(listed.status).toBe(200);
      expect(listed.body).toMatchObject({
        captures: [
          expect.objectContaining({
            artifact: expect.objectContaining({ id: 'research-source-1.json' }),
            snapshot: expect.objectContaining({ sourceMode: 'governed_source_capture' }),
          }),
        ],
      });
      expect(JSON.stringify(listed.body)).not.toContain('/tmp/research-source');
    });

    it('POST /api/runs/:id/browser-smoke requires approval before launching local browser capture', async () => {
      const requested = await post(port, '/api/runs/run-1/browser-smoke', {
        url: 'http://localhost:5173/app?token=secret&ok=1#ignored',
        assertion: { selector: '#root', containsText: 'Ready' },
        fullPage: true,
      });
      expect(requested.status).toBe(202);
      expect(requested.body).toMatchObject({
        status: 'approval_required',
        runId: 'run-1',
        browserSmoke: true,
        approval: expect.objectContaining({
          toolName: 'browser_smoke',
          args: expect.objectContaining({
            runId: 'run-1',
            targetUrlHash: expect.any(String),
            host: 'localhost:5173',
            pathHash: expect.any(String),
            assertionHash: expect.any(String),
            fullPage: true,
            browserSmoke: true,
          }),
        }),
      });
      expect(JSON.stringify(requested.body)).not.toContain('secret');
      expect(browserSmokeCapture).not.toHaveBeenCalled();
      const approvalId = (requested.body as { approval: { id: string } }).approval.id;

      const pendingAttempt = await post(port, '/api/runs/run-1/browser-smoke', {
        url: 'http://localhost:5173/app?token=secret&ok=1',
        assertion: { selector: '#root', containsText: 'Ready' },
        fullPage: true,
        approvalId,
      });
      expect(pendingAttempt.status).toBe(409);
      expect(browserSmokeCapture).not.toHaveBeenCalled();

      const mismatch = await post(port, '/api/runs/run-1/browser-smoke', {
        url: 'http://localhost:5173/other',
        approvalId,
      });
      expect(mismatch.status).toBe(403);

      const decision = await post(port, `/api/approvals/${approvalId}/decision`, { decision: 'approve' });
      expect(decision.status).toBe(200);

      const captured = await post(port, '/api/runs/run-1/browser-smoke', {
        url: 'http://localhost:5173/app?token=secret&ok=1',
        assertion: { selector: '#root', containsText: 'Ready' },
        fullPage: true,
        approvalId,
      });
      expect(captured.status).toBe(201);
      expect((captured.body as { artifact: { uri?: string }; screenshotArtifact: { uri?: string } }).artifact.uri).toBeUndefined();
      expect((captured.body as { artifact: { uri?: string }; screenshotArtifact: { uri?: string } }).screenshotArtifact.uri).toBeUndefined();
      expect(captured.body).toMatchObject({
        status: 'captured',
        artifact: expect.objectContaining({ id: 'browser-smoke-1.json' }),
        screenshotArtifact: expect.objectContaining({ id: 'browser-smoke-shot-1.png' }),
        snapshot: expect.objectContaining({
          sourceMode: 'governed_browser_smoke',
          targetHost: 'localhost:5173',
          targetUrlHash: expect.any(String),
          targetPathHash: expect.any(String),
          finalHost: 'localhost:5173',
          finalUrlHash: expect.any(String),
          screenshot: expect.objectContaining({ artifactId: 'browser-smoke-shot-1.png' }),
        }),
      });
      expect(JSON.stringify(captured.body)).not.toContain('/tmp/browser-smoke');
      expect(JSON.stringify(captured.body)).not.toContain('secret');
      expect(JSON.stringify(captured.body)).not.toContain('/app');
      expect(JSON.stringify(captured.body)).not.toContain('ok=1');
      expect(browserSmokeCapture).toHaveBeenCalledWith('run-1', {
        url: 'http://localhost:5173/app?token=secret&ok=1',
        assertion: { selector: '#root', containsText: 'Ready' },
        fullPage: true,
        approvalId,
      });

      const reused = await post(port, '/api/runs/run-1/browser-smoke', {
        url: 'http://localhost:5173/app?token=secret&ok=1',
        assertion: { selector: '#root', containsText: 'Ready' },
        fullPage: true,
        approvalId,
      });
      expect(reused.status).toBe(409);
    });

    it('GET /api/runs/:id/browser-smoke lists public artifact refs only', async () => {
      const listed = await get(port, '/api/runs/run-1/browser-smoke');
      expect(listed.status).toBe(200);
      expect((listed.body as { smoke: Array<{ artifact: { uri?: string }; screenshotArtifact: { uri?: string } }> }).smoke[0]?.artifact.uri).toBeUndefined();
      expect((listed.body as { smoke: Array<{ artifact: { uri?: string }; screenshotArtifact: { uri?: string } }> }).smoke[0]?.screenshotArtifact.uri).toBeUndefined();
      expect(listed.body).toMatchObject({
        smoke: [expect.objectContaining({
          artifact: expect.objectContaining({ id: 'browser-smoke-1.json' }),
          screenshotArtifact: expect.objectContaining({ id: 'browser-smoke-shot-1.png' }),
          snapshot: expect.objectContaining({
            sourceMode: 'governed_browser_smoke',
            targetHost: 'localhost:5173',
            targetPathHash: 'target-path-hash',
            finalHost: 'localhost:5173',
            finalUrlHash: 'final-url-hash',
          }),
        })],
      });
      expect(JSON.stringify(listed.body)).not.toContain('/tmp/browser-smoke');
      expect(JSON.stringify(listed.body)).not.toContain('secret');
      expect(JSON.stringify(listed.body)).not.toContain('/app');
      expect(JSON.stringify(listed.body)).not.toContain('ok=1');
    });

    it('POST /api/runs/:id/browser-smoke rejects non-local targets before approval', async () => {
      const invalid = await post(port, '/api/runs/run-1/browser-smoke', {
        url: 'https://example.com/app',
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ error: 'invalid_browser_smoke_request' });
      expect(browserSmokeCapture).not.toHaveBeenCalled();
    });

    // ── Goals CRUD ─────────────────────────────────────────────────────────

  it('GET /api/goals → 200 empty array initially', async () => {
    const { status, body } = await get(port, '/api/goals');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/goals → creates goal, GET returns it', async () => {
    const { status: s1, body: b1 } = await post(port, '/api/goals', { title: 'test goal' });
    expect(s1).toBe(200);
    const created = b1 as Record<string, unknown>;
    expect(created['description']).toBe('test goal');
    expect(created['status']).toBe('active');
    expect(created['id']).toBeTruthy();

    const { body: list } = await get(port, '/api/goals');
    const goals = list as { description: string }[];
    expect(goals.some(g => g.description === 'test goal')).toBe(true);
  });

  it('POST /api/goals missing title → 400', async () => {
    const { status } = await post(port, '/api/goals', {});
    expect(status).toBe(400);
  });

  it('POST /api/goals/:id/done → marks done', async () => {
    const { body: created } = await post(port, '/api/goals', { title: 'to be done' });
    const id = (created as Record<string, unknown>)['id'] as string;

    const { status, body } = await post(port, `/api/goals/${id}/done`, {});
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)['status']).toBe('done');
  });

  it('POST /api/goals/:id/done for unknown id → 404', async () => {
    const { status } = await post(port, '/api/goals/nonexistent/done', {});
    expect(status).toBe(404);
  });

  it('DELETE /api/goals/:id → cancels goal', async () => {
    const { body: created } = await post(port, '/api/goals', { title: 'to cancel' });
    const id = (created as Record<string, unknown>)['id'] as string;

    const res = await fetch(`http://127.0.0.1:${port}/api/goals/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['status']).toBe('cancelled');
  });

  it('DELETE /api/goals/:id for unknown id → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/goals/nope`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  // ── Agents ─────────────────────────────────────────────────────────────

  it('GET /api/agents → 200 empty array', async () => {
    const { status, body } = await get(port, '/api/agents');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  it('GET /api/agents returns live runtime subagent summaries', async () => {
    (runtime as unknown as { listSubagents: ReturnType<typeof vi.fn> }).listSubagents = vi.fn().mockReturnValue([
      {
        id: 'sub-1',
        name: 'Research OpenClaw memory migration',
        status: 'running',
        startedAt: '2026-05-04T00:00:00.000Z',
      },
      {
        id: 'sub-2',
        name: 'Review connector manifest',
        status: 'completed',
        startedAt: '2026-05-04T00:01:00.000Z',
      },
    ]);

    const { status, body } = await get(port, '/api/agents');

    expect(status).toBe(200);
    expect(body).toEqual([
      {
        id: 'sub-1',
        name: 'Research OpenClaw memory migration',
        status: 'running',
        startedAt: '2026-05-04T00:00:00.000Z',
      },
      {
        id: 'sub-2',
        name: 'Review connector manifest',
        status: 'completed',
        startedAt: '2026-05-04T00:01:00.000Z',
      },
    ]);
  });

  // ── Memory ─────────────────────────────────────────────────────────────

  it('GET /api/memory → 200 JSON with lines and files arrays', async () => {
    const { status, body } = await get(port, '/api/memory');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(Array.isArray(d['lines'])).toBe(true);
    expect(Array.isArray(d['files'])).toBe(true);
    expect(d['lines']).toEqual(['pyrfor memory line']);
    expect(d).toHaveProperty('workspaceFiles');
    expect(d).toHaveProperty('daily');
  });

  it('GET /api/memory/continuity → returns read-only continuity doctor without local artifact URIs', async () => {
    const { status, body } = await get(port, '/api/memory/continuity?projectId=project-1');
    expect(status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/daily-rollup-1.json');
    expect(serialized).not.toContain('/tmp/project-rollup-1.json');
    expect(serialized).not.toContain('/tmp/openclaw-report-1.json');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
    expect(body).toMatchObject({
      workspaceId: 'current-workspace',
      projectId: 'project-1',
      workspaceFiles: {
        present: 1,
        total: 2,
        missing: ['SOUL.md'],
      },
      latestDailyRollup: {
        status: 'ok',
        date: '2026-01-01',
        artifact: { id: 'daily-rollup-1.json', sha256: 'sha-daily-rollup' },
      },
      latestProjectRollup: {
        status: 'ok',
        projectId: 'project-1',
        artifact: { id: 'project-rollup-1.json', sha256: 'sha-project-rollup' },
      },
      latestOpenClawReport: {
        status: 'ok',
        artifact: { id: 'openclaw-report-1.json', sha256: 'sha-openclaw-report' },
        counts: { importable: 1 },
      },
      warnings: ['memory_files_missing'],
    });
    expect(runtime.getMemoryContinuityStatus).toHaveBeenCalledWith({ projectId: 'project-1' });
  });

  it('GET /api/memory/continuity rejects client-controlled scope overrides', async () => {
    const { status, body } = await get(port, '/api/memory/continuity?workspaceId=/tmp/other');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('GET /api/memory/search → 200 JSON with durable memory hits', async () => {
    const { status, body } = await get(port, '/api/memory/search?q=delivery&projectId=project-1&limit=5');
    expect(status).toBe(200);
    const d = body as { workspaceId?: string; projectId?: string; results?: Array<Record<string, unknown>> };
    expect(d.workspaceId).toBe('current-workspace');
    expect(d.projectId).toBe('project-1');
    expect(d.results?.[0]).toMatchObject({
      id: 'memory-1',
      source: 'durable',
      projectMemoryCategory: 'decision',
      importState: 'imported_quarantined',
      approvalState: 'pending_approval',
      plannerEligible: false,
      importedFrom: 'openclaw',
      provenanceKinds: ['external'],
    });
    expect(d.results?.[0]?.['workspaceId']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('/tmp/pyrfor-test-workspace');
  });

  it('GET /api/memory/search without q → 400', async () => {
    const { status, body } = await get(port, '/api/memory/search');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_query');
  });

  it('GET /api/memory/search rejects client-controlled scope overrides', async () => {
    const { status, body } = await get(port, '/api/memory/search?q=delivery&workspaceId=/tmp/other');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/corrections → creates durable operator correction', async () => {
    const { status, body } = await post(port, '/api/memory/corrections', {
      content: 'corrected fact content',
      summary: 'corrected fact',
      projectId: 'project-1',
    });
    expect(status).toBe(201);
    const d = body as { memory?: Record<string, unknown> };
    expect(d.memory).toMatchObject({
      id: 'memory-correction-1',
      source: 'durable',
      scopeVisibility: 'project',
      approvalState: 'pending_approval',
      plannerEligible: false,
      correctionKind: 'operator',
      provenanceKinds: ['user'],
    });
    expect(d.memory?.['workspaceId']).toBeUndefined();
  });

  it('POST /api/memory/corrections rejects empty content', async () => {
    const { status, body } = await post(port, '/api/memory/corrections', { content: ' ' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_content');
  });

  it('POST /api/memory/corrections rejects client-controlled scope overrides', async () => {
    const { status, body } = await post(port, '/api/memory/corrections', {
      content: 'corrected fact',
      workspaceId: '/tmp/other',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/:id/review approves pending durable memory', async () => {
    const { status, body } = await post(port, '/api/memory/memory-1/review', {
      decision: 'approve',
      reason: 'verified against latest source',
    });
    expect(status).toBe(200);
    const d = body as { decision?: string; memory?: Record<string, unknown> };
    expect(d.decision).toBe('approve');
    expect(d.memory).toMatchObject({
      id: 'memory-1',
      importState: 'approved',
      approvalState: 'approved',
      plannerEligible: true,
      importedFrom: 'openclaw',
      provenanceKinds: ['external'],
    });
    expect(d.memory?.['workspaceId']).toBeUndefined();
  });

  it('POST /api/memory/:id/review derives operator identity from authenticated token label', async () => {
    const runtime = {
      reviewMemory: vi.fn().mockResolvedValue({
        decision: 'approve',
        memory: {
          id: 'memory-1',
          content: 'reviewed memory',
          createdAt: '2026-01-01T00:00:00.000Z',
          memoryType: 'semantic',
          importance: 0.8,
          source: 'durable',
        },
      }),
    } as unknown as PyrforRuntime & { reviewMemory: ReturnType<typeof vi.fn> };
    gw = createRuntimeGateway({
      config: makeConfig({
        bearerTokens: [{ value: 'operator-token', label: 'operator-a', expiresAt: '2999-01-01T00:00:00.000Z' }],
      }),
      runtime,
      health: makeHealth(),
    });
    await gw.start();

    const result = await post(gw.port, '/api/memory/memory-1/review', {
      decision: 'approve',
      operatorId: 'spoofed-operator',
    }, 'operator-token');

    expect(result.status).toBe(200);
    expect(runtime.reviewMemory).toHaveBeenCalledWith(expect.objectContaining({
      memoryId: 'memory-1',
      decision: 'approve',
      operatorId: 'token:operator-a',
    }));
  });

  it('POST /api/memory/:id/review rejects invalid decisions and scope overrides', async () => {
    const invalidDecision = await post(port, '/api/memory/memory-1/review', { decision: 'merge' });
    expect(invalidDecision.status).toBe(400);
    expect((invalidDecision.body as Record<string, unknown>)['error']).toBe('invalid_decision');

    const scopeOverride = await post(port, '/api/memory/memory-1/review', {
      decision: 'approve',
      workspaceId: '/tmp/other',
    });
    expect(scopeOverride.status).toBe(400);
    expect((scopeOverride.body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/:id/review maps missing and non-pending targets to controlled errors', async () => {
    (runtime as unknown as { reviewMemory: ReturnType<typeof vi.fn> }).reviewMemory
      .mockRejectedValueOnce(new Error('Memory review target not found'))
      .mockRejectedValueOnce(new Error('Memory review target is not pending approval'));

    const missing = await post(port, '/api/memory/missing-1/review', { decision: 'approve' });
    expect(missing.status).toBe(404);
    expect((missing.body as Record<string, unknown>)['error']).toBe('memory_not_found');

    const notPending = await post(port, '/api/memory/memory-1/review', { decision: 'reject' });
    expect(notPending.status).toBe(409);
    expect((notPending.body as Record<string, unknown>)['error']).toBe('memory_review_not_pending');
  });

  it('POST /api/memory/:id/review surfaces contradiction conflicts without mutating memory state', async () => {
    (runtime as unknown as { reviewMemory: ReturnType<typeof vi.fn> }).reviewMemory
      .mockRejectedValueOnce(new DurableMemoryContradictionError([{ memoryId: 'approved-1', reason: 'summary_mismatch' }]));

    const result = await post(port, '/api/memory/memory-1/review', { decision: 'approve' });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: 'memory_contradiction',
      conflictingMemoryIds: ['approved-1'],
    });
  });

  it('GET /api/memory/pending-reviews returns pending durable memory review inbox', async () => {
    const { status, body } = await get(port, '/api/memory/pending-reviews?limit=10');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      memoryReviews: [{
        id: 'memory-pending-1',
        summary: 'Imported roadmap memory',
        approvalState: 'pending_approval',
        importState: 'imported_quarantined',
        plannerEligible: false,
        importedFrom: 'openclaw',
        provenanceKinds: ['external'],
      }],
    });
    expect(JSON.stringify(body)).not.toContain('/tmp/pyrfor-test-workspace');
    expect(runtime.listPendingMemoryReviews).toHaveBeenCalledWith({ limit: 10 });
  });

  it('POST /api/memory/openclaw-import-report → creates dry-run report', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import-report', {
      includePersonality: true,
      includeMemories: false,
    });
    expect(status).toBe(201);
    const d = body as {
      artifact?: { id?: string; sha256?: string; uri?: string; meta?: Record<string, unknown> };
      report?: { workspaceId?: string; sourceRoot?: string; counts?: { importable?: number } };
    };
    expect(d.artifact?.id).toBe('openclaw-report-1.json');
    expect(d.artifact?.sha256).toBe('sha-openclaw-report');
    expect(d.artifact?.uri).toBeUndefined();
    expect(d.artifact?.meta?.['workspaceId']).toBeUndefined();
    expect(d.report?.workspaceId).toBe('current-workspace');
    expect(d.report?.sourceRoot).toBe('openclaw-source');
    expect(d.report?.counts?.importable).toBe(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/openclaw-workspace');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
    expect(serialized).not.toContain('/tmp/openclaw-report-1.json');
    expect(serialized).not.toContain('file://');
  });

  it('GET /api/memory/openclaw-import-report → returns latest dry-run report', async () => {
    const { status, body } = await get(port, '/api/memory/openclaw-import-report');
    expect(status).toBe(200);
    const d = body as {
      artifact?: { id?: string; uri?: string; meta?: Record<string, unknown> };
      report?: { workspaceId?: string; sourceRoot?: string };
    };
    expect(d.artifact?.id).toBe('openclaw-report-1.json');
    expect(d.artifact?.uri).toBeUndefined();
    expect(d.artifact?.meta?.['workspaceId']).toBeUndefined();
    expect(d.report?.workspaceId).toBe('current-workspace');
    expect(d.report?.sourceRoot).toBe('openclaw-source');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/openclaw-workspace');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
    expect(serialized).not.toContain('/tmp/openclaw-report-1.json');
    expect(serialized).not.toContain('file://');
    expect(runtime.getLatestOpenClawMigrationReport).toHaveBeenCalledWith({});
  });

  it('GET /api/memory/openclaw-import-report scopes latest report by project id', async () => {
    const { status } = await get(port, '/api/memory/openclaw-import-report?projectId=project-a');
    expect(status).toBe(200);
    expect(runtime.getLatestOpenClawMigrationReport).toHaveBeenCalledWith({ projectId: 'project-a' });
  });

  it('POST /api/memory/openclaw-import → imports hash-bound report', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import', {
      reportArtifactId: 'openclaw-report-1.json',
      expectedReportSha256: 'sha-openclaw-report',
    });
    expect(status).toBe(201);
    const d = body as {
      status?: string;
      result?: { migrationId?: string; imported?: number; memoryIds?: string[]; rollbackPlan?: { memoryIds?: string[] }; artifact?: { id?: string; sha256?: string; uri?: string; meta?: Record<string, unknown> } };
    };
    expect(d.status).toBe('imported');
    expect(d.result?.migrationId).toBe('openclaw-migration-1');
    expect(d.result?.imported).toBe(1);
    expect(d.result?.memoryIds).toEqual(['memory-import-1']);
    expect(d.result?.rollbackPlan?.memoryIds).toEqual(['memory-import-1']);
    expect(d.result?.artifact?.id).toBe('openclaw-result-1.json');
    expect(d.result?.artifact?.sha256).toBe('sha-openclaw-result');
    expect(d.result?.artifact?.uri).toBeUndefined();
    expect(d.result?.artifact?.meta?.['workspaceId']).toBeUndefined();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/openclaw-result-1.json');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
  });

  it('POST /api/memory/openclaw-import forwards project scope for project reports', async () => {
    const { status } = await post(port, '/api/memory/openclaw-import', {
      reportArtifactId: 'openclaw-report-1.json',
      expectedReportSha256: 'sha-openclaw-report',
      projectId: 'project-a',
    });
    expect(status).toBe(201);
    expect(runtime.importOpenClawMigration).toHaveBeenCalledWith({
      reportArtifactId: 'openclaw-report-1.json',
      expectedReportSha256: 'sha-openclaw-report',
      projectId: 'project-a',
    });
  });

  it('POST /api/memory/openclaw-rollback → rolls back a hash-bound import result', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-rollback', {
      resultArtifactId: 'openclaw-result-1.json',
      expectedResultSha256: 'sha-openclaw-result',
    });
    expect(status).toBe(201);
    const d = body as {
      status?: string;
      result?: { migrationId?: string; workspaceId?: string; revoked?: number; artifact?: { id?: string; sha256?: string; uri?: string; meta?: Record<string, unknown> } };
    };
    expect(d.status).toBe('rolled_back');
    expect(d.result?.migrationId).toBe('openclaw-migration-1');
    expect(d.result?.workspaceId).toBe('current-workspace');
    expect(d.result?.revoked).toBe(1);
    expect(d.result?.artifact?.id).toBe('openclaw-rollback-1.json');
    expect(d.result?.artifact?.sha256).toBe('sha-openclaw-rollback');
    expect(d.result?.artifact?.uri).toBeUndefined();
    expect(d.result?.artifact?.meta?.['workspaceId']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('/tmp/pyrfor-test-workspace');
    expect(runtime.rollbackOpenClawMigration).toHaveBeenCalledWith({
      resultArtifactId: 'openclaw-result-1.json',
      expectedResultSha256: 'sha-openclaw-result',
    });
  });

  it('POST /api/memory/openclaw-rollback rejects bad result reference', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-rollback', {
      resultArtifactId: 'openclaw-result-1.json',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_result_reference');
  });

  it('POST /api/memory/openclaw-verify → verifies a hash-bound import result', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-verify', {
      resultArtifactId: 'openclaw-result-1.json',
      expectedResultSha256: 'sha-openclaw-result',
      queryLimit: 15,
    });
    expect(status).toBe(201);
    const d = body as {
      status?: string;
      result?: { migrationId?: string; foundCount?: number; missCount?: number; artifact?: { id?: string; sha256?: string; uri?: string; meta?: Record<string, unknown> } };
    };
    expect(d.status).toBe('verified');
    expect(d.result?.migrationId).toBe('openclaw-migration-1');
    expect(d.result?.foundCount).toBe(1);
    expect(d.result?.missCount).toBe(0);
    expect(d.result?.artifact?.id).toBe('openclaw-verify-1.json');
    expect(d.result?.artifact?.sha256).toBe('sha-openclaw-verify');
    expect(d.result?.artifact?.uri).toBeUndefined();
    expect(d.result?.artifact?.meta?.['workspaceId']).toBeUndefined();
    expect(runtime.verifyOpenClawMigration).toHaveBeenCalledWith({
      resultArtifactId: 'openclaw-result-1.json',
      expectedResultSha256: 'sha-openclaw-result',
      queryLimit: 15,
    });
  });

  it('POST /api/memory/openclaw-verify rejects bad result reference', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-verify', {
      resultArtifactId: 'openclaw-result-1.json',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_result_reference');
  });

  it('GET /api/memory/openclaw-audit → returns sanitized operator audit view', async () => {
    const { status, body } = await get(port, '/api/memory/openclaw-audit?projectId=project-a&limit=25');
    expect(status).toBe(200);
    const d = body as {
      workspaceId?: string;
      migrations?: Array<{
        workspaceId?: string;
        status?: string;
        importArtifact?: { id?: string; uri?: string; meta?: Record<string, unknown> };
        latestVerification?: { artifact?: { id?: string; uri?: string; meta?: Record<string, unknown> } };
      }>;
      quarantineCandidates?: Array<{ memoryId?: string }>;
    };
    expect(d.workspaceId).toBe('current-workspace');
    expect(d.migrations?.[0]?.workspaceId).toBe('current-workspace');
    expect(d.migrations?.[0]?.status).toBe('needs_review');
    expect(d.migrations?.[0]?.importArtifact?.id).toBe('openclaw-result-1.json');
    expect(d.migrations?.[0]?.importArtifact?.uri).toBeUndefined();
    expect(d.migrations?.[0]?.importArtifact?.meta?.['workspaceId']).toBeUndefined();
    expect(d.migrations?.[0]?.latestVerification?.artifact?.uri).toBeUndefined();
    expect(d.quarantineCandidates?.[0]?.memoryId).toBe('memory-import-1');
    expect(JSON.stringify(body)).not.toContain('/tmp/pyrfor-test-workspace');
    expect(JSON.stringify(body)).not.toContain('/tmp/openclaw-result-1.json');
    expect(runtime.getOpenClawMigrationAudit).toHaveBeenCalledWith({ projectId: 'project-a', limit: 25 });
  });

  it('GET /api/memory/openclaw-quarantine → returns quarantine candidates', async () => {
    const { status, body } = await get(port, '/api/memory/openclaw-quarantine?limit=10');
    expect(status).toBe(200);
    const d = body as {
      workspaceId?: string;
      candidateCount?: number;
      candidates?: Array<{ memoryId?: string; reason?: string }>;
    };
    expect(d.workspaceId).toBe('current-workspace');
    expect(d.candidateCount).toBe(1);
    expect(d.candidates?.[0]).toMatchObject({ memoryId: 'memory-import-1', reason: 'verification_missed' });
    expect(JSON.stringify(body)).not.toContain('/tmp/pyrfor-test-workspace');
    expect(runtime.getOpenClawMigrationQuarantine).toHaveBeenCalledWith({ limit: 10 });
  });

  it('GET /api/memory/openclaw-audit rejects client scope overrides', async () => {
    const { status, body } = await get(port, '/api/memory/openclaw-audit?workspaceId=/tmp/other');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/openclaw-import rejects bad report reference', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import', {
      reportArtifactId: 'openclaw-report-1.json',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_report_reference');
  });

  it('POST /api/memory/openclaw-import-report rejects client scope overrides', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import-report', { workspaceId: '/tmp/other' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('GET /api/memory/openclaw-import-report rejects client scope overrides', async () => {
    const workspaceOverride = await get(port, '/api/memory/openclaw-import-report?workspaceId=/tmp/other');
    expect(workspaceOverride.status).toBe(400);
    expect((workspaceOverride.body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');

    const agentOverride = await get(port, '/api/memory/openclaw-import-report?agentId=other');
    expect(agentOverride.status).toBe(400);
    expect((agentOverride.body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('GET /api/sessions → 200 JSON with workspace-scoped session summaries', async () => {
    const { status, body } = await get(port, '/api/sessions?limit=5');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(d['workspaceId']).toBe('/tmp/pyrfor-test-workspace');
    expect(d['limit']).toBe(5);
    expect(Array.isArray(d['sessions'])).toBe(true);
    expect((d['sessions'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'sess-1',
      title: 'web:chat-1',
      messageCount: 2,
    });
  });

  it('GET /api/sessions/:id → 200 JSON with messages', async () => {
    const { status, body } = await get(port, '/api/sessions/sess-1');
    expect(status).toBe(200);
    const d = body as { session?: { id?: string; messages?: unknown[] } };
    expect(d.session?.id).toBe('sess-1');
    expect(d.session?.messages?.length).toBe(2);
  });

  it('GET /api/sessions/:id/timeline → 200 JSON with ordered message events', async () => {
    const { status, body } = await get(port, '/api/sessions/sess-1/timeline');
    expect(status).toBe(200);
    const d = body as { sessionId?: string; events?: Array<Record<string, unknown>> };
    expect(d.sessionId).toBe('sess-1');
    expect(d.events?.map((event) => event['content'])).toEqual(['remember this', 'remembered']);
  });

  it('GET /api/sessions/:id → 404 for missing session', async () => {
    const { status, body } = await get(port, '/api/sessions/missing');
    expect(status).toBe(404);
    expect((body as Record<string, unknown>)['error']).toBe('session_not_found');
  });

  it('POST /api/memory/rollup → promotes a daily memory rollup', async () => {
    const { status, body } = await post(port, '/api/memory/rollup', { date: '2026-01-01' });
    expect(status).toBe(201);
    const d = body as { rollup?: { date?: string; memoryId?: string; sessionCount?: number } };
    expect(d.rollup?.date).toBe('2026-01-01');
    expect(d.rollup?.memoryId).toBe('memory-1');
    expect(d.rollup?.sessionCount).toBe(1);
  });

  it('POST /api/memory/rollup invalid date → 400', async () => {
    const { status, body } = await post(port, '/api/memory/rollup', { date: 'not-a-date' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_date');
  });

  it('POST /api/memory/rollup rejects client-controlled memory scope', async () => {
    const { status, body } = await post(port, '/api/memory/rollup', { agentId: 'other-agent' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/project-rollup → promotes project continuity memories', async () => {
    const { status, body } = await post(port, '/api/memory/project-rollup', {
      projectId: 'project-1',
      sessionLimit: 200,
    });
    expect(status).toBe(201);
    const d = body as { rollup?: { projectId?: string; artifact?: { uri?: string }; memories?: Array<{ category?: string; memoryId?: string }> } };
    expect(d.rollup?.projectId).toBe('project-1');
    expect(d.rollup?.artifact?.uri).toBeUndefined();
    expect(d.rollup?.memories).toEqual([
      expect.objectContaining({ category: 'decision', memoryId: 'project-memory-1' }),
    ]);
  });

  it('POST /api/memory/project-rollup rejects invalid input and client-controlled scope', async () => {
    const missingProject = await post(port, '/api/memory/project-rollup', {});
    expect(missingProject.status).toBe(400);
    expect((missingProject.body as Record<string, unknown>)['error']).toBe('project_id_required');

    const scopeOverride = await post(port, '/api/memory/project-rollup', { projectId: 'project-1', workspaceId: '/tmp/other' });
    expect(scopeOverride.status).toBe(400);
    expect((scopeOverride.body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');

    const invalidLimit = await post(port, '/api/memory/project-rollup', { projectId: 'project-1', sessionLimit: 501 });
    expect(invalidLimit.status).toBe(400);
    expect((invalidLimit.body as Record<string, unknown>)['error']).toBe('invalid_session_limit');
  });

  it('GET /api/runs/:runId/context-pack returns public context pack artifact', async () => {
    const { status, body } = await get(port, '/api/runs/run-1/context-pack');
    expect(status).toBe(200);
    expect((body as { artifact: { uri?: string } }).artifact.uri).toBeUndefined();
    expect(body).toMatchObject({
      artifact: expect.objectContaining({ id: 'context-pack-1.json', kind: 'context_pack' }),
      pack: expect.objectContaining({
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-run-1',
        projectId: 'project-1',
      }),
    });
    const pack = (body as { pack: { task: { description: string }; sections: Array<{ content: string }> } }).pack;
    expect(pack.task.description.length).toBeLessThanOrEqual(600);
    expect(pack.sections[0].content.length).toBeLessThanOrEqual(600);
  });

  it('GET /api/runs/:runId/context-pack returns 404 when absent', async () => {
    (runtime as unknown as { getRunContextPack: ReturnType<typeof vi.fn> }).getRunContextPack.mockResolvedValueOnce(null);
    const { status, body } = await get(port, '/api/runs/run-missing/context-pack');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: 'context_pack_not_found' });
  });

  it('GET /api/runs/:runId/timeline returns sanitized run aggregate', async () => {
    const { status, body } = await get(port, '/api/runs/run-1/timeline');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: 'pyrfor.run_timeline.v1',
      run: expect.objectContaining({ run_id: 'run-1', status: 'completed' }),
      summary: expect.objectContaining({
        eventCount: 2,
        artifactCount: 2,
        latestEventType: 'supervisor.decision',
        hasContextPack: true,
        hasDeliveryEvidence: true,
        replayAvailable: true,
      }),
      replay: expect.objectContaining({ available: true, controlPath: '/api/runs/run-1/control' }),
    });
    expect((body as { run: { budget_profile?: unknown } }).run.budget_profile).toEqual({ token: '[redacted]' });
    expect(JSON.stringify(body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(body)).not.toContain('/tmp/private-spec.md');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('file://');
    expect((runtime as unknown as { getRunTimeline: ReturnType<typeof vi.fn> }).getRunTimeline).toHaveBeenCalledWith('run-1');
  });

  it('GET /api/runs/:runId/timeline returns 404 when absent', async () => {
    (runtime as unknown as { getRunTimeline: ReturnType<typeof vi.fn> }).getRunTimeline.mockResolvedValueOnce(null);
    const { status, body } = await get(port, '/api/runs/run-missing/timeline');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: 'run_not_found' });
  });

  it('GET /api/runs/:runId/timeline returns 503 when orchestration is unavailable', async () => {
    (runtime as unknown as { getRunTimeline: ReturnType<typeof vi.fn> }).getRunTimeline
      .mockRejectedValueOnce(new Error('RunTimeline: orchestration is disabled'));
    const { status, body } = await get(port, '/api/runs/run-1/timeline');
    expect(status).toBe(503);
    expect(body).toMatchObject({ error: 'run_timeline_unavailable' });
  });

  it('GET /api/runs/:runId/timeline returns 501 when runtime helper is unavailable', async () => {
    const original = (runtime as unknown as { getRunTimeline?: ReturnType<typeof vi.fn> }).getRunTimeline;
    delete (runtime as unknown as { getRunTimeline?: ReturnType<typeof vi.fn> }).getRunTimeline;
    const { status, body } = await get(port, '/api/runs/run-1/timeline');
    expect(status).toBe(501);
    expect(body).toMatchObject({ error: 'run_timeline_unavailable' });
    (runtime as unknown as { getRunTimeline?: ReturnType<typeof vi.fn> }).getRunTimeline = original;
  });

  it('POST /api/runs/:runId/context-pack refreshes and returns public context pack artifacts', async () => {
    const { status, body } = await post(port, '/api/runs/run-1/context-pack', {});
    expect(status).toBe(200);
    expect((body as { artifact: { uri?: string }; previousArtifact: { uri?: string } }).artifact.uri).toBeUndefined();
    expect((body as { artifact: { uri?: string }; previousArtifact: { uri?: string } }).previousArtifact.uri).toBeUndefined();
    expect(body).toMatchObject({
      artifact: expect.objectContaining({ id: 'context-pack-2.json', kind: 'context_pack' }),
      previousArtifact: expect.objectContaining({ id: 'context-pack-1.json', kind: 'context_pack' }),
      pack: expect.objectContaining({
        sections: [expect.objectContaining({ id: 'run_evidence', kind: 'evidence' })],
      }),
    });
    expect((runtime as unknown as { refreshRunContextPack: ReturnType<typeof vi.fn> }).refreshRunContextPack)
      .toHaveBeenCalledWith('run-1');
  });

  // ── Settings ───────────────────────────────────────────────────────────

  it('GET /api/settings → 200 JSON with required keys', async () => {
    const { status, body } = await get(port, '/api/settings');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(d).toHaveProperty('defaultAction');
    expect(d).toHaveProperty('whitelist');
    expect(d).toHaveProperty('blacklist');
    expect(Array.isArray(d['whitelist'])).toBe(true);
    expect(Array.isArray(d['blacklist'])).toBe(true);
  });

  it('POST /api/settings → updates and returns ok', async () => {
    const { status, body } = await post(port, '/api/settings', {
      defaultAction: 'approve',
      whitelist: ['read', 'write'],
      blacklist: ['sudo'],
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)['ok']).toBe(true);

    // Verify persistence
    const { body: s2 } = await get(port, '/api/settings');
    const d = s2 as Record<string, unknown>;
    expect(d['defaultAction']).toBe('approve');
    expect(d['whitelist']).toEqual(['read', 'write']);
    expect(d['blacklist']).toEqual(['sudo']);
  });

  it('POST /api/settings invalid defaultAction → 400', async () => {
    const { status } = await post(port, '/api/settings', { defaultAction: 'invalid' });
    expect(status).toBe(400);
  });

  it('POST /api/settings/execution-mode updates in-memory state and persists config', async () => {
    const tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-mode-test-'));
    const cfgPath = pathModule.join(tmpDir, 'runtime.json');
    writeFileSync(cfgPath, JSON.stringify({ executionMode: 'pyrfor' }), 'utf-8');
    const config = makeConfig();
    config.executionMode = 'pyrfor';
    const modeGw = createRuntimeGateway({
      config,
      runtime: makeRuntime(),
      configPath: cfgPath,
      orchestration: makeOrchestrationDeps(),
    });
    await modeGw.start();
    const modePort = modeGw.port;
    try {
      const { status, body } = await post(modePort, '/api/settings/execution-mode', { executionMode: 'freeclaude' });
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, executionMode: 'freeclaude' });

      const current = await get(modePort, '/api/settings/execution-mode');
      expect(current.body).toMatchObject({ executionMode: 'freeclaude' });

      const persisted = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
      expect(persisted['executionMode']).toBe('freeclaude');
    } finally {
      await modeGw.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('POST /api/settings/execution-mode rejects FreeClaude mode when orchestration is unavailable', async () => {
    const tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-mode-test-'));
    const cfgPath = pathModule.join(tmpDir, 'runtime.json');
    writeFileSync(cfgPath, JSON.stringify({ executionMode: 'pyrfor' }), 'utf-8');
    const config = makeConfig();
    config.executionMode = 'pyrfor';
    const modeGw = createRuntimeGateway({
      config,
      runtime: makeRuntime(),
      configPath: cfgPath,
    });
    await modeGw.start();
    try {
      const { status, body } = await post(modeGw.port, '/api/settings/execution-mode', { executionMode: 'freeclaude' });
      expect(status).toBe(409);
      expect(body).toMatchObject({
        error: 'freeclaude_execution_unavailable',
      });
      expect(config.executionMode).toBe('pyrfor');
      const persisted = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
      expect(persisted['executionMode']).toBe('pyrfor');
    } finally {
      await modeGw.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('POST /api/settings/execution-mode rejects invalid mode', async () => {
    const { status, body } = await post(port, '/api/settings/execution-mode', { executionMode: 'legacy' });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'invalid_execution_mode' });
  });

  // ── Universal Engine concepts ─────────────────────────────────────────

  it('POST /api/concepts returns 503 when Universal Engine is unavailable', async () => {
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: makeOrchestrationDeps(),
    });
    await conceptGw.start();
    try {
      const { status, body } = await post(conceptGw.port, '/api/concepts', { goal: 'build something' });
      expect(status).toBe(503);
      expect(body).toMatchObject({ error: 'universal_engine_unavailable' });
    } finally {
      await conceptGw.stop();
    }
  });

  it('POST /api/concepts returns 503 when Universal Engine feature flag is disabled', async () => {
    const ue = makeUniversalEngine();
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(false),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await post(conceptGw.port, '/api/concepts', { goal: 'build something' });
      expect(status).toBe(503);
      expect(body).toMatchObject({ error: 'universal_engine_unavailable' });
      expect(ue.dispatchConcept).not.toHaveBeenCalled();
    } finally {
      await conceptGw.stop();
    }
  });

  it('POST /api/concepts dispatches a concept and returns an async handle shape', async () => {
    const ue = makeUniversalEngine();
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await post(conceptGw.port, '/api/concepts', {
        goal: 'add dark mode',
        workspaceId: 'workspace-1',
        dryRun: true,
        strategies: ['keep tests green'],
      });
      expect(status).toBe(202);
      expect(body).toMatchObject({ conceptId: 'concept-1', runId: 'run-ue-1', status: 'queued' });
      expect(ue.dispatchConcept).toHaveBeenCalledWith({
        goal: 'add dark mode',
        workspaceId: 'workspace-1',
        dryRun: true,
        strategies: ['keep tests green'],
      });
    } finally {
      await conceptGw.stop();
    }
  });

  it('POST /api/concepts returns 400 when goal is missing', async () => {
    const ue = makeUniversalEngine();
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await post(conceptGw.port, '/api/concepts', {});
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: 'goal_required' });
      expect(ue.dispatchConcept).not.toHaveBeenCalled();
    } finally {
      await conceptGw.stop();
    }
  });

  it('POST /api/concepts rejects path-like conceptId values before dispatch', async () => {
    const ue = makeUniversalEngine();
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await post(conceptGw.port, '/api/concepts', {
        goal: 'build safely',
        conceptId: '../../tmp/evil',
      });
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: 'invalid_concept_id' });
      expect(ue.dispatchConcept).not.toHaveBeenCalled();
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts lists sanitized concept records', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({
      goal: 'Fix ~/projects/app',
      workspaceId: '/tmp/secret-workspace',
      artifactRefs: [{
        id: 'artifact-1',
        kind: 'plan',
        uri: '/tmp/secret-plan.json',
        sha256: 'sha-plan',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    }));
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        concepts: [expect.objectContaining({
          conceptId: 'concept-1',
          goal: 'Fix ~/projects/app',
          workspaceId: '/tmp/secret-workspace',
        })],
      });
      expect(JSON.stringify(body)).not.toContain('/tmp/secret-plan.json');
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id preserves public concept fields while stripping artifact URIs', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({
      goal: 'Refactor ~/projects/api',
      workspaceId: '/tmp/secret-workspace',
      error: 'failed at ~/projects/api/log.txt',
      artifactRefs: [{
        id: 'artifact-1',
        kind: 'evidence',
        uri: '/tmp/secret-evidence.json',
        sha256: 'sha-evidence',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    }));
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        conceptId: 'concept-1',
        goal: 'Refactor ~/projects/api',
        workspaceId: '/tmp/secret-workspace',
        error: 'failed at ~/projects/api/log.txt',
        artifactRefs: [expect.objectContaining({ id: 'artifact-1', kind: 'evidence' })],
      });
      expect(JSON.stringify(body)).not.toContain('/tmp/secret-evidence.json');
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id returns 404 for an unknown concept', async () => {
    const ue = makeUniversalEngine();
    vi.mocked(ue.getConceptRecord).mockReturnValueOnce(undefined);
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/missing');
      expect(status).toBe(404);
      expect(body).toMatchObject({ error: 'concept_not_found' });
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/plan returns the sanitized plan ref', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({
      planRef: {
        id: 'plan-artifact-1',
        kind: 'plan',
        uri: '/tmp/plan-artifact-1.json',
        sha256: 'sha-plan',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1/plan');
      expect(status).toBe(200);
      expect(body).toMatchObject({ id: 'plan-artifact-1', kind: 'plan' });
      expect(JSON.stringify(body)).not.toContain('/tmp/plan-artifact-1.json');
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/phases returns phase summaries', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({ status: 'executing', currentPhase: 'execute' }));
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1/phases');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        phases: expect.arrayContaining([
          { phase: 'execute', status: 'current' },
        ]),
      });
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/trace returns a sanitized durable ledger trace', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({
      goal: 'Fix ~/projects/app and /tmp/secret-plan.json',
      status: 'executing',
      currentPhase: 'execute',
      workspaceId: '/tmp/secret-workspace',
      error: 'failed at ~/projects/app/error.log',
      artifactRefs: [{
        id: 'plan-artifact-1',
        kind: 'plan',
        uri: '/tmp/secret-plan.json',
        sha256: 'sha-plan',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    }));
    const orchestration = makeOrchestrationDeps();
    orchestration.eventLedger!.readAll = vi.fn().mockRejectedValue(new Error('readAll should not be used for concept trace'));
    orchestration.eventLedger!.byRun = vi.fn().mockResolvedValue([
      {
        id: 'event-1',
        ts: '2026-01-01T00:00:01.000Z',
        seq: 1,
        type: 'concept.received',
        run_id: 'run-ue-1',
        concept_id: 'concept-1',
        summary: 'read /tmp/secret-plan.json',
      },
      {
        id: 'event-2',
        ts: '2026-01-01T00:00:02.000Z',
        seq: 2,
        type: 'artifact.created',
        run_id: 'run-ue-1',
        artifact_id: 'plan-artifact-1',
      },
      {
        id: 'event-3',
        ts: '2026-01-01T00:00:03.000Z',
        seq: 3,
        type: 'dag.node.completed',
        run_id: 'run-ue-1',
        artifact_refs: ['evidence-artifact-1'],
      },
      {
        id: 'event-4',
        ts: '2026-01-01T00:00:04.000Z',
        seq: 4,
        type: 'concept.received',
        run_id: 'other-run',
        concept_id: 'other-concept',
      },
    ]);
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...orchestration, universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1/trace');
      expect(status).toBe(200);
      const d = body as {
        schemaVersion?: string;
        concept?: { conceptId?: string; goal?: string; workspaceId?: string; error?: string; artifactRefs?: Array<{ id?: string; uri?: string }> };
        phases?: Array<{ phase?: string; status?: string }>;
        events?: Array<Record<string, unknown>>;
        artifactIds?: string[];
        totalEvents?: number;
        truncated?: boolean;
      };
      expect(d.schemaVersion).toBe('pyrfor.concept_trace.v1');
      expect(d.concept?.conceptId).toBe('concept-1');
      expect(d.concept?.workspaceId).toBe('current-workspace');
      expect(d.concept?.goal).toContain('~/[redacted-path]');
      expect(d.concept?.goal).toContain('[redacted-path]');
      expect(d.concept?.error).toContain('~/[redacted-path]');
      expect(d.concept?.artifactRefs?.[0]?.id).toBe('plan-artifact-1');
      expect(d.concept?.artifactRefs?.[0]?.uri).toBeUndefined();
      expect(d.phases).toEqual(expect.arrayContaining([{ phase: 'execute', status: 'current' }]));
      expect(d.events?.map((event) => event['type'])).toEqual(['concept.received', 'artifact.created', 'dag.node.completed']);
      expect(d.artifactIds).toEqual(['evidence-artifact-1', 'plan-artifact-1']);
      expect(d.totalEvents).toBe(3);
      expect(d.truncated).toBe(false);
      expect(JSON.stringify(body)).not.toContain('/tmp/secret-plan.json');
      expect(JSON.stringify(body)).not.toContain('/tmp/secret-workspace');
      expect(JSON.stringify(body)).not.toContain('~/projects/app');
      expect(orchestration.eventLedger!.byRun).toHaveBeenCalledWith('run-ue-1');
      expect(orchestration.eventLedger!.readAll).not.toHaveBeenCalled();
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/export returns an incident packet from the trace', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({ status: 'failed' }));
    const orchestration = makeOrchestrationDeps();
    orchestration.eventLedger!.byRun = vi.fn().mockResolvedValue([
      {
        id: 'event-1',
        ts: '2026-01-01T00:00:01.000Z',
        seq: 1,
        type: 'concept.received',
        run_id: 'run-ue-1',
        concept_id: 'concept-1',
      },
      {
        id: 'event-2',
        ts: '2026-01-01T00:00:02.000Z',
        seq: 2,
        type: 'run.failed',
        run_id: 'run-ue-1',
        error: 'failed in /tmp/secret-workspace',
      },
    ]);
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...orchestration, universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1/export?kind=incident-packet');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        schemaVersion: 'pyrfor.concept_incident_packet.v1',
        exportKind: 'incident-packet',
        summary: {
          conceptId: 'concept-1',
          runId: 'run-ue-1',
          status: 'failed',
          eventCount: 2,
          traceTruncated: false,
          terminalEvents: ['run.failed'],
        },
      });
      expect(JSON.stringify(body)).not.toContain('/tmp/secret-workspace');
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/lessons returns approved concept lessons from Universal MemoryStore', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({
      postmortemRef: {
        id: 'postmortem-1',
        kind: 'postmortem_report',
        uri: '/tmp/postmortem-1.json',
        sha256: 'sha-postmortem',
        createdAt: '2026-01-01T00:00:03.000Z',
      },
    }));
    const orchestration = makeOrchestrationDeps();
    vi.mocked(orchestration.memoryStore!.query).mockReturnValue([
      {
        id: 'lesson-1',
        kind: 'lesson',
        text: JSON.stringify({
          kind: 'single_loop',
          defectRootCause: 'execution_bug',
          fixApplied: 'Added verifier coverage',
          fixType: 'test_rewrite',
          context: {
            phase: 'postmortem',
            nodeKind: 'consequential',
            algorithm: 'lessons_learned',
          },
        }),
        source: 'historian:run-ue-1',
        scope: 'universal',
        tags: ['single_loop', 'approved', 'native', 'conceptId:concept-1', 'runId:run-ue-1'],
        weight: 0.9,
        applied_count: 0,
        created_at: '2026-01-01T00:04:00.000Z',
        updated_at: '2026-01-01T00:04:00.000Z',
      },
      {
        id: 'lesson-2',
        kind: 'lesson',
        text: JSON.stringify({ kind: 'double_loop', expectedImpact: 'hidden' }),
        source: 'historian:run-ue-1',
        scope: 'universal',
        tags: ['double_loop', 'quarantined', 'native', 'conceptId:concept-1'],
        weight: 0.6,
        applied_count: 0,
        created_at: '2026-01-01T00:05:00.000Z',
        updated_at: '2026-01-01T00:05:00.000Z',
      },
    ]);
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...orchestration, universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1/lessons');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        conceptId: 'concept-1',
        runId: 'run-ue-1',
        postmortemRef: { id: 'postmortem-1', kind: 'postmortem_report' },
        lessons: [
          expect.objectContaining({
            id: 'lesson-1',
            kind: 'single_loop',
            approvalState: 'approved',
            provenance: 'native',
            summary: 'execution_bug: Added verifier coverage',
          }),
        ],
      });
      expect(orchestration.memoryStore!.query).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'lesson',
        tags: ['conceptId:concept-1'],
      }));
      expect(JSON.stringify(body)).not.toContain('/tmp/postmortem-1.json');
      expect((body as { lessons: unknown[] }).lessons).toHaveLength(1);
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/export reports total event count when trace is truncated', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({ status: 'failed' }));
    const orchestration = makeOrchestrationDeps();
    orchestration.eventLedger!.byRun = vi.fn().mockResolvedValue([
      ...Array.from({ length: 2_000 }, (_, index) => ({
        id: `event-${index}`,
        ts: '2026-01-01T00:00:01.000Z',
        seq: index,
        type: 'tool.executed',
        run_id: 'run-ue-1',
      })),
      {
        id: 'event-terminal',
        ts: '2026-01-01T00:30:00.000Z',
        seq: 2_000,
        type: 'run.failed',
        run_id: 'run-ue-1',
      },
    ]);
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...orchestration, universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1/export?kind=incident-packet');
      expect(status).toBe(200);
      const packet = body as {
        trace?: { events?: unknown[]; totalEvents?: number; truncated?: boolean };
        summary?: { eventCount?: number; traceTruncated?: boolean; terminalEvents?: string[] };
      };
      expect(packet.trace?.events).toHaveLength(2_000);
      expect(packet.trace?.totalEvents).toBe(2_001);
      expect(packet.trace?.truncated).toBe(true);
      expect(packet.summary?.eventCount).toBe(2_001);
      expect(packet.summary?.traceTruncated).toBe(true);
      expect(packet.summary?.terminalEvents).toEqual(['run.failed']);
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/export rejects unsupported export kinds', async () => {
    const ue = makeUniversalEngine();
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const { status, body } = await get(conceptGw.port, '/api/concepts/concept-1/export?kind=raw');
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: 'unsupported_export_kind' });
    } finally {
      await conceptGw.stop();
    }
  });

  it('DELETE /api/concepts/:id delegates abort', async () => {
    const ue = makeUniversalEngine(makeConceptRecord({ status: 'executing' }));
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration: { ...makeOrchestrationDeps(), universalEngine: ue },
    });
    await conceptGw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${conceptGw.port}/api/concepts/concept-1`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ aborted: true, conceptId: 'concept-1' });
      expect(ue.abort).toHaveBeenCalledWith('concept-1', 'aborted via gateway');
    } finally {
      await conceptGw.stop();
    }
  });

  it('GET /api/concepts/:id/events/stream emits a snapshot and filtered live ledger events', async () => {
    const ue = makeUniversalEngine();
    const listeners: Array<(event: unknown) => void> = [];
    const orchestration = makeOrchestrationDeps();
    orchestration.eventLedger = {
      append: vi.fn(),
      readAll: vi.fn().mockResolvedValue([
        { type: 'concept.received', run_id: 'run-ue-1', concept_id: 'concept-1' },
        { type: 'concept.received', run_id: 'other-run', concept_id: 'other-concept' },
      ]),
      byRun: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        listeners.push(listener);
        return () => {};
      }),
    };
    orchestration.universalEngine = ue;
    const conceptGw = createRuntimeGateway({
      config: makeConfigWithUniversalEngine(true),
      runtime: makeRuntime(),
      orchestration,
    });
    await conceptGw.start();
    const controller = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${conceptGw.port}/api/concepts/concept-1/events/stream`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      try {
        const snapshotMessages = await readSseUntil(reader, (messages) => messages.some((message) => message.event === 'snapshot'));
        expect(snapshotMessages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            event: 'snapshot',
            data: expect.objectContaining({
              concept: expect.objectContaining({ conceptId: 'concept-1' }),
              events: [expect.objectContaining({ concept_id: 'concept-1' })],
            }),
          }),
        ]));

        listeners.forEach((listener) => listener({
          type: 'concept.completed',
          run_id: 'run-ue-1',
          concept_id: 'concept-1',
          status: 'done',
        }));
        listeners.forEach((listener) => listener({
          type: 'concept.completed',
          run_id: 'other-run',
          concept_id: 'other-concept',
          status: 'done',
        }));
        const liveMessages = await readSseUntil(reader, (messages) =>
          messages.some((message) => message.event === 'ledger')
        );
        expect(liveMessages.filter((message) => message.event === 'ledger')).toEqual([
          expect.objectContaining({
            data: {
              event: expect.objectContaining({ concept_id: 'concept-1' }),
            },
          }),
        ]);
      } finally {
        controller.abort();
        await reader.cancel().catch(() => {});
      }
    } finally {
      await conceptGw.stop();
    }
  });

  // ── Stats ──────────────────────────────────────────────────────────────

  it('GET /api/stats → 200 JSON with uptime', async () => {
    const { status, body } = await get(port, '/api/stats');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(typeof d['uptime']).toBe('number');
    expect(d).toHaveProperty('costToday');
    expect(d).toHaveProperty('sessionsCount');
  });
});

// ── Real runtime cost aggregation (variant A) ───────────────────────────────
// Lesson: green tests ≠ working feature. The dashboard's costToday is fed by a
// REAL provider router (the same cost log as getSessionCost), not a mock and not
// the per-worker token budget. These tests drive the real path end-to-end: a
// real chat call writes to the cost log, and the gateway surfaces the same sum.
describe('dashboard costToday (real runtime spend)', () => {
  let port: number;
  let gw: ReturnType<typeof createRuntimeGateway>;
  let tmpDir: string;

  beforeEach(() => {
    approvalFlow.resetForTests();
    tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-cost-'));
  });

  afterEach(async () => {
    if (gw) await gw.stop();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('aggregates real provider spend logged today (not a mock)', async () => {
    // Real provider router + real chat → logCost records a non-zero spend for
    // today (openai carries a non-zero rate in estimateCost).
    const router = new ProviderRouter({ maxRetries: 1, timeoutMs: 5000 });
    router.register('openai', {
      name: 'openai',
      models: ['gpt-4o-mini'],
      chat: vi.fn().mockResolvedValue('openai real response with enough tokens to bill'),
    });
    await router.chat(
      [{ role: 'user', content: 'charge the real cost ledger please' }] as Parameters<typeof router.chat>[0],
      { provider: 'openai', sessionId: 'e2e-spend' },
    );
    // The aggregation mechanism itself works on the real cost log.
    expect(router.getTodaysCost()).toBeGreaterThan(0);

    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      goalStore: new GoalStore(tmpDir),
      approvalSettingsPath: pathModule.join(tmpDir, 'approval-settings.json'),
      staticDir: ACTUAL_STATIC_DIR,
      providerRouter: router,
    });
    await gw.start();
    port = gw.port;

    const { status, body } = await get(port, '/api/dashboard');
    expect(status).toBe(200);
    const costToday = (body as Record<string, unknown>).costToday;
    // Wired end-to-end: the dashboard surfaces the SAME real sum the router
    // computes — not a mock, not a parallel ledger, never a fake 0.
    expect(costToday).toBe(router.getTodaysCost());
    expect(costToday as number).toBeGreaterThan(0);
  });

  it('is 0 when the runtime has logged no spend today', async () => {
    const router = new ProviderRouter({ maxRetries: 1, timeoutMs: 5000 });
    expect(router.getTodaysCost()).toBe(0);

    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      goalStore: new GoalStore(tmpDir),
      approvalSettingsPath: pathModule.join(tmpDir, 'approval-settings.json'),
      staticDir: ACTUAL_STATIC_DIR,
      providerRouter: router,
    });
    await gw.start();
    port = gw.port;

    const { status, body } = await get(port, '/api/dashboard');
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).costToday).toBe(0);
  });
});
