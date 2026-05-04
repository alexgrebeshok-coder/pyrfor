import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetDashboard = vi.fn();
const mockCaptureRunDeliveryEvidence = vi.fn();
const mockCreateRunGithubDeliveryPlan = vi.fn();
const mockListRuns = vi.fn();
const mockGetRun = vi.fn();
const mockGetRunContextPack = vi.fn();
const mockGetRunDeliveryEvidence = vi.fn();
const mockGetRunGithubDeliveryPlan = vi.fn();
const mockGetRunGithubDeliveryApply = vi.fn();
const mockRequestRunGithubDeliveryApply = vi.fn();
const mockGetRunVerifierStatus = vi.fn();
const mockCreateRunVerifierWaiver = vi.fn();
const mockListRunEvents = vi.fn();
const mockListRunDag = vi.fn();
const mockListRunFrames = vi.fn();
const mockListRunActors = vi.fn();
const mockListRunResearchEvidence = vi.fn();
const mockRequestRunResearchSearch = vi.fn();
const mockDispatchNextRunActorMessage = vi.fn();
const mockControlRun = vi.fn();
const mockListOverlays = vi.fn();
const mockGetOverlay = vi.fn();
const mockListProductFactoryTemplates = vi.fn();
const mockListPendingApprovals = vi.fn();
const mockPreviewProductFactoryPlan = vi.fn();
const mockCreateProductFactoryRun = vi.fn();
const mockPreviewOchagReminder = vi.fn();
const mockCreateOchagReminderRun = vi.fn();
const mockGetOchagPrivacy = vi.fn();
const mockPreviewCeoclawBrief = vi.fn();
const mockCreateCeoclawBriefRun = vi.fn();
const mockStreamOperatorEvents = vi.fn();
const mockGetMemorySnapshot = vi.fn();
const mockGetConnectorInventory = vi.fn();
const mockGetSkills = vi.fn();
const mockRecommendSkills = vi.fn();
const mockProbeConnector = vi.fn();
const mockListSessions = vi.fn();
const mockGetSessionTimeline = vi.fn();
const mockCreateMemoryRollup = vi.fn();
const mockCreateProjectMemoryRollup = vi.fn();
const mockCreateMemoryCorrection = vi.fn();
const mockSearchMemory = vi.fn();
const mockCreateOpenClawImportReport = vi.fn();
const mockImportOpenClawMemory = vi.fn();

vi.mock('../../lib/api', () => ({
  getDashboard: (...args: unknown[]) => mockGetDashboard(...args),
  captureRunDeliveryEvidence: (...args: unknown[]) => mockCaptureRunDeliveryEvidence(...args),
  createRunGithubDeliveryPlan: (...args: unknown[]) => mockCreateRunGithubDeliveryPlan(...args),
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  getRun: (...args: unknown[]) => mockGetRun(...args),
  getRunContextPack: (...args: unknown[]) => mockGetRunContextPack(...args),
  getRunDeliveryEvidence: (...args: unknown[]) => mockGetRunDeliveryEvidence(...args),
  getRunGithubDeliveryPlan: (...args: unknown[]) => mockGetRunGithubDeliveryPlan(...args),
  getRunGithubDeliveryApply: (...args: unknown[]) => mockGetRunGithubDeliveryApply(...args),
  requestRunGithubDeliveryApply: (...args: unknown[]) => mockRequestRunGithubDeliveryApply(...args),
  getRunVerifierStatus: (...args: unknown[]) => mockGetRunVerifierStatus(...args),
  createRunVerifierWaiver: (...args: unknown[]) => mockCreateRunVerifierWaiver(...args),
  listRunEvents: (...args: unknown[]) => mockListRunEvents(...args),
  listRunDag: (...args: unknown[]) => mockListRunDag(...args),
  listRunFrames: (...args: unknown[]) => mockListRunFrames(...args),
  listRunActors: (...args: unknown[]) => mockListRunActors(...args),
  listRunResearchEvidence: (...args: unknown[]) => mockListRunResearchEvidence(...args),
  requestRunResearchSearch: (...args: unknown[]) => mockRequestRunResearchSearch(...args),
  dispatchNextRunActorMessage: (...args: unknown[]) => mockDispatchNextRunActorMessage(...args),
  controlRun: (...args: unknown[]) => mockControlRun(...args),
  listOverlays: (...args: unknown[]) => mockListOverlays(...args),
  getOverlay: (...args: unknown[]) => mockGetOverlay(...args),
  listProductFactoryTemplates: (...args: unknown[]) => mockListProductFactoryTemplates(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  previewProductFactoryPlan: (...args: unknown[]) => mockPreviewProductFactoryPlan(...args),
  createProductFactoryRun: (...args: unknown[]) => mockCreateProductFactoryRun(...args),
  previewOchagReminder: (...args: unknown[]) => mockPreviewOchagReminder(...args),
  createOchagReminderRun: (...args: unknown[]) => mockCreateOchagReminderRun(...args),
  getOchagPrivacy: (...args: unknown[]) => mockGetOchagPrivacy(...args),
  previewCeoclawBrief: (...args: unknown[]) => mockPreviewCeoclawBrief(...args),
  createCeoclawBriefRun: (...args: unknown[]) => mockCreateCeoclawBriefRun(...args),
  streamOperatorEvents: (...args: unknown[]) => mockStreamOperatorEvents(...args),
  getMemorySnapshot: (...args: unknown[]) => mockGetMemorySnapshot(...args),
  getConnectorInventory: (...args: unknown[]) => mockGetConnectorInventory(...args),
  getSkills: (...args: unknown[]) => mockGetSkills(...args),
  recommendSkills: (...args: unknown[]) => mockRecommendSkills(...args),
  probeConnector: (...args: unknown[]) => mockProbeConnector(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
  getSessionTimeline: (...args: unknown[]) => mockGetSessionTimeline(...args),
  createMemoryRollup: (...args: unknown[]) => mockCreateMemoryRollup(...args),
  createProjectMemoryRollup: (...args: unknown[]) => mockCreateProjectMemoryRollup(...args),
  createMemoryCorrection: (...args: unknown[]) => mockCreateMemoryCorrection(...args),
  searchMemory: (...args: unknown[]) => mockSearchMemory(...args),
  createOpenClawImportReport: (...args: unknown[]) => mockCreateOpenClawImportReport(...args),
  importOpenClawMemory: (...args: unknown[]) => mockImportOpenClawMemory(...args),
}));

import OrchestrationPanel from '../OrchestrationPanel';

describe('OrchestrationPanel', () => {
  beforeEach(() => {
    mockGetDashboard.mockReset();
    mockCaptureRunDeliveryEvidence.mockReset();
    mockCreateRunGithubDeliveryPlan.mockReset();
    mockListRuns.mockReset();
    mockGetRun.mockReset();
    mockGetRunContextPack.mockReset();
    mockGetRunDeliveryEvidence.mockReset();
    mockGetRunGithubDeliveryPlan.mockReset();
    mockGetRunGithubDeliveryApply.mockReset();
    mockRequestRunGithubDeliveryApply.mockReset();
    mockGetRunVerifierStatus.mockReset();
    mockCreateRunVerifierWaiver.mockReset();
    mockListRunEvents.mockReset();
    mockListRunDag.mockReset();
    mockListRunFrames.mockReset();
    mockListRunActors.mockReset();
    mockListRunResearchEvidence.mockReset();
    mockRequestRunResearchSearch.mockReset();
    mockDispatchNextRunActorMessage.mockReset();
    mockControlRun.mockReset();
    mockListOverlays.mockReset();
    mockGetOverlay.mockReset();
    mockListProductFactoryTemplates.mockReset();
    mockListPendingApprovals.mockReset();
    mockPreviewProductFactoryPlan.mockReset();
    mockCreateProductFactoryRun.mockReset();
    mockPreviewOchagReminder.mockReset();
    mockCreateOchagReminderRun.mockReset();
    mockGetOchagPrivacy.mockReset();
    mockPreviewCeoclawBrief.mockReset();
    mockCreateCeoclawBriefRun.mockReset();
    mockStreamOperatorEvents.mockReset();
    mockGetMemorySnapshot.mockReset();
    mockGetConnectorInventory.mockReset();
    mockGetSkills.mockReset();
    mockRecommendSkills.mockReset();
    mockProbeConnector.mockReset();
    mockListSessions.mockReset();
    mockGetSessionTimeline.mockReset();
    mockCreateMemoryRollup.mockReset();
    mockCreateProjectMemoryRollup.mockReset();
    mockCreateMemoryCorrection.mockReset();
    mockSearchMemory.mockReset();
    mockCreateOpenClawImportReport.mockReset();
    mockImportOpenClawMemory.mockReset();

    mockGetDashboard.mockResolvedValue({
      orchestration: {
        runs: { total: 1, active: 1, blocked: 0, latest: [] },
        dag: { total: 2, ready: 1, running: 1, blocked: 0 },
        effects: { pending: 1 },
        approvals: { pending: 2 },
        verifier: { blocked: 0, status: 'warning' },
        workerFrames: { total: 3, pending: 0, lastType: 'final_report' },
        contextPack: null,
        overlays: { total: 2, domainIds: ['ceoclaw', 'ochag'] },
      },
    });
    mockListRuns.mockResolvedValue({
      runs: [
        {
          run_id: 'run-1',
          task_id: 'Build product',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'running',
          artifact_refs: [],
          created_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-01T00:05:00.000Z',
        },
      ],
    });
    mockListOverlays.mockResolvedValue({
      overlays: [
        {
          schemaVersion: 'domain_overlay.v1',
          domainId: 'ceoclaw',
          version: '1.0.0',
          title: 'CEOClaw',
          workflowTemplates: [{ id: 'evidence-approval' }],
          adapterRegistrations: [{ id: 'ceoclaw-mcp' }],
          privacyRules: [{ id: 'finance-write-approval' }],
          toolPermissionOverrides: { network_write: 'deny', secrets_access: 'ask_every_time' },
        },
        { schemaVersion: 'domain_overlay.v1', domainId: 'ochag', version: '1.0.0', title: 'Ochag' },
      ],
    });
    mockListProductFactoryTemplates.mockResolvedValue({
      templates: [
        {
          id: 'feature',
          title: 'Feature delivery',
          description: 'Feature template',
          recommendedDomainIds: [],
          clarifications: [{ id: 'acceptance', question: 'Acceptance?', required: true }],
          deliveryArtifacts: ['implementation_summary'],
          qualityGates: ['build'],
        },
        {
          id: 'ochag_family_reminder',
          title: 'Ochag family reminder',
          description: 'Ochag template',
          recommendedDomainIds: ['ochag'],
          clarifications: [{ id: 'privacy', question: 'Privacy?', required: false }],
          deliveryArtifacts: ['telegram_message_preview'],
          qualityGates: ['telegram_smoke'],
        },
        {
          id: 'business_brief',
          title: 'Business/CEO brief',
          description: 'Business brief template',
          recommendedDomainIds: ['ceoclaw'],
          clarifications: [{ id: 'decision', question: 'Decision?', required: true }],
          deliveryArtifacts: ['executive_summary'],
          qualityGates: ['evidence_check'],
        },
      ],
    });
    mockListPendingApprovals.mockResolvedValue({ approvals: [] });
    mockGetMemorySnapshot.mockResolvedValue({ lines: [], files: [], workspaceFiles: {}, daily: [] });
    mockGetConnectorInventory.mockResolvedValue({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      summary: { total: 2, configured: 1, pending: 1, stubs: 1, liveProbeSkipped: 2 },
      connectors: [
        {
          id: 'github',
          name: 'GitHub',
          description: 'GitHub integration',
          direction: 'outbound',
          sourceSystem: 'GitHub API',
          operations: ['Create draft PR'],
          credentials: [{ envVar: 'GITHUB_TOKEN', description: 'GitHub token' }],
          apiSurface: [{ method: 'POST', path: '/api/github', description: 'GitHub actions' }],
          stub: false,
          configured: true,
          missingSecrets: [],
          hasProbe: true,
          readiness: {
            state: 'configured',
            reasons: ['Required env names are present in local configuration.', 'Live health check requires explicit Trust approval.'],
            nextStep: 'Request live probe approval to verify remote health.',
          },
          probePreview: {
            mode: 'descriptor-status',
            requiresApproval: true,
            requiredEnvVars: [],
            headerNames: [],
            bodyConfigured: false,
            note: 'Live status comes from the connector adapter and is not executed by inventory.',
          },
          liveProbeSkipped: true,
          statusSource: 'local-config',
        },
        {
          id: 'telegram',
          name: 'Telegram',
          description: 'Telegram bridge',
          direction: 'bidirectional',
          sourceSystem: 'Telegram Bot API',
          operations: ['Send reminders'],
          credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
          apiSurface: [{ method: 'WEBHOOK', path: '/api/telegram/webhook', description: 'Webhook' }],
          stub: true,
          configured: false,
          missingSecrets: ['TELEGRAM_BOT_TOKEN'],
          hasProbe: false,
          readiness: {
            state: 'pending',
            reasons: ['Missing required env: TELEGRAM_BOT_TOKEN'],
            nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
          },
          liveProbeSkipped: true,
          statusSource: 'local-config',
        },
      ],
    });
    mockGetSkills.mockResolvedValue({
      total: 2,
      skills: [
        {
          id: 'debug',
          name: 'Debug',
          description: 'Diagnose failures without exposing raw prompts.',
          whenToUse: ['when fixing errors'],
          tags: ['debugging', 'typescript'],
          stepsCount: 4,
          examplesCount: 1,
          estimatedTokens: 120,
          systemPromptHash: 'a'.repeat(64),
        },
        {
          id: 'refactor',
          name: 'Refactor',
          description: 'Restructure code safely.',
          whenToUse: ['when improving code'],
          tags: ['coding'],
          stepsCount: 3,
          examplesCount: 1,
          estimatedTokens: 100,
          systemPromptHash: 'b'.repeat(64),
        },
      ],
    });
    mockRecommendSkills.mockResolvedValue({
      taskPreview: 'Fix a TypeScript error',
      limit: 5,
      recommendations: [{
        id: 'debug',
        name: 'Debug',
        description: 'Diagnose failures without exposing raw prompts.',
        whenToUse: ['when fixing errors'],
        tags: ['debugging', 'typescript'],
        stepsCount: 4,
        examplesCount: 1,
        estimatedTokens: 120,
        systemPromptHash: 'a'.repeat(64),
      }],
    });
    mockProbeConnector.mockResolvedValue({
      status: 'approval_required',
      connectorId: 'telegram',
      approval: {
        id: 'connector-live-probe:telegram',
        toolName: 'connector_live_probe',
        summary: 'Run live connector probe for Telegram',
        args: { connectorId: 'telegram' },
      },
      liveProbe: true,
    });
    mockListSessions.mockResolvedValue({ sessions: [] });
    mockGetSessionTimeline.mockResolvedValue({ sessionId: 'session-1', events: [] });
    mockCreateMemoryRollup.mockResolvedValue({ rollup: { date: '2026-05-01', sessionCount: 0, ledgerEventCount: 0 } });
    mockCreateProjectMemoryRollup.mockResolvedValue({
      rollup: {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        agentId: 'pyrfor-runtime',
        sessionCount: 2,
        ledgerEventCount: 3,
        runIds: ['run-1'],
        memories: [
          {
            category: 'decision',
            memoryType: 'semantic',
            summary: 'Decisions for project project-1: approved migration path',
            content: 'approved migration path',
            memoryId: 'project-memory-decision',
          },
          {
            category: 'risk',
            memoryType: 'semantic',
            summary: 'Risks for project project-1: memory fragmentation',
            content: 'memory fragmentation',
            memoryId: 'project-memory-risk',
          },
        ],
      },
    });
    mockCreateMemoryCorrection.mockResolvedValue({ memory: { id: 'memory-1', content: 'correction', memoryType: 'semantic', createdAt: '2026-05-01T00:00:00.000Z', source: 'durable' } });
    mockSearchMemory.mockResolvedValue({ results: [] });
    mockCreateOpenClawImportReport.mockResolvedValue({
      artifact: { id: 'openclaw-report-1', kind: 'summary', uri: 'memory://openclaw-report-1', sha256: 'sha', createdAt: '2026-05-01T00:00:00.000Z' },
      report: { schemaVersion: 'openclaw_migration_report.v1', generatedAt: '2026-05-01T00:00:00.000Z', workspaceId: 'workspace-1', sourceRoot: '~/openclaw-workspace', counts: { importable: 0, skipped: 0, personality: 0, memories: 0, skills: 0, redactions: 0 }, entries: [], skipped: [] },
    });
    mockImportOpenClawMemory.mockResolvedValue({ status: 'imported', result: { imported: 0, skipped: 0, memoryIds: [], artifact: { id: 'openclaw-import-result-1', kind: 'summary', uri: 'memory://openclaw-result', createdAt: '2026-05-01T00:00:00.000Z' } } });
    mockPreviewProductFactoryPlan.mockResolvedValue({
      preview: {
        intent: { id: 'pf-1', templateId: 'feature', title: 'Build delivery package', goal: 'Build delivery package', domainIds: [] },
        template: { id: 'feature', title: 'Feature delivery' },
        missingClarifications: [{ id: 'acceptance', question: 'Acceptance?', required: true }],
        scopedPlan: { objective: 'Build delivery package', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
        dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
        deliveryChecklist: ['implementation_summary'],
      },
    });
    mockCreateProductFactoryRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'pf-1',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'planned',
        artifact_refs: ['artifact-1'],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
      preview: {
        intent: { id: 'pf-1', templateId: 'feature', title: 'Build delivery package', goal: 'Build delivery package', domainIds: [] },
        template: { id: 'feature', title: 'Feature delivery' },
        missingClarifications: [],
        scopedPlan: { objective: 'Build delivery package', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
        dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
        deliveryChecklist: ['implementation_summary'],
      },
      artifact: { id: 'artifact-1' },
    });
    mockPreviewOchagReminder.mockResolvedValue({
      preview: {
        intent: { id: 'pf-ochag', templateId: 'ochag_family_reminder', title: 'Send dinner reminder', goal: 'Send dinner reminder', domainIds: ['ochag'] },
        template: { id: 'ochag_family_reminder', title: 'Ochag family reminder' },
        missingClarifications: [],
        scopedPlan: { objective: 'Send dinner reminder', scope: [], assumptions: [], risks: [], qualityGates: ['telegram_smoke'] },
        dagPreview: { nodes: [{ id: 'pf-ochag/notify', kind: 'ochag.telegram_notify' }] },
        deliveryChecklist: ['telegram_message_preview'],
      },
    });
    mockCreateOchagReminderRun.mockResolvedValue({
      run: {
        run_id: 'run-ochag',
        task_id: 'pf-ochag',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'planned',
        artifact_refs: ['artifact-ochag'],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
      preview: {
        intent: { id: 'pf-ochag', templateId: 'ochag_family_reminder', title: 'Send dinner reminder', goal: 'Send dinner reminder', domainIds: ['ochag'] },
        template: { id: 'ochag_family_reminder', title: 'Ochag family reminder' },
        missingClarifications: [],
        scopedPlan: { objective: 'Send dinner reminder', scope: [], assumptions: [], risks: [], qualityGates: ['telegram_smoke'] },
        dagPreview: { nodes: [{ id: 'pf-ochag/notify', kind: 'ochag.telegram_notify' }] },
        deliveryChecklist: ['telegram_message_preview'],
      },
      artifact: { id: 'artifact-ochag' },
    });
    mockGetOchagPrivacy.mockResolvedValue({
      domainId: 'ochag',
      privacyRules: [{ id: 'member-private-memory' }, { id: 'family-visibility-boundary' }],
      toolPermissionOverrides: { telegram_send: 'ask_once' },
      adapterRegistrations: [{ target: 'telegram' }],
    });
    mockPreviewCeoclawBrief.mockResolvedValue({
      preview: {
        intent: { id: 'pf-ceoclaw', templateId: 'business_brief', title: 'Approve evidence-backed project action', goal: 'Approve evidence-backed project action', domainIds: ['ceoclaw'] },
        template: { id: 'business_brief', title: 'Business/CEO brief' },
        missingClarifications: [],
        scopedPlan: { objective: 'Approve evidence-backed project action', scope: [], assumptions: [], risks: [], qualityGates: ['evidence_check'] },
        dagPreview: { nodes: [{ id: 'pf-ceoclaw/approval', kind: 'ceoclaw.request_approval' }] },
        deliveryChecklist: ['executive_summary'],
      },
    });
    mockCreateCeoclawBriefRun.mockResolvedValue({
      run: {
        run_id: 'run-ceoclaw',
        task_id: 'pf-ceoclaw',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'planned',
        artifact_refs: ['artifact-ceoclaw'],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
      preview: {
        intent: { id: 'pf-ceoclaw', templateId: 'business_brief', title: 'Approve evidence-backed project action', goal: 'Approve evidence-backed project action', domainIds: ['ceoclaw'] },
        template: { id: 'business_brief', title: 'Business/CEO brief' },
        missingClarifications: [],
        scopedPlan: { objective: 'Approve evidence-backed project action', scope: [], assumptions: [], risks: [], qualityGates: ['evidence_check'] },
        dagPreview: { nodes: [{ id: 'pf-ceoclaw/approval', kind: 'ceoclaw.request_approval' }] },
        deliveryChecklist: ['executive_summary'],
      },
      artifact: { id: 'artifact-ceoclaw' },
    });
    mockGetRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'running',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    });
    mockGetRunDeliveryEvidence.mockResolvedValue({
      artifact: { id: 'artifact-evidence', kind: 'delivery_evidence', createdAt: '2026-05-01T00:06:00.000Z', uri: '/private/path' },
      snapshot: {
        schemaVersion: 'pyrfor.delivery_evidence.v1',
        capturedAt: '2026-05-01T00:06:00.000Z',
        runId: 'run-1',
        verifierStatus: 'warning',
        deliveryChecklist: ['implementation_summary', 'tests'],
        git: {
          available: true,
          branch: 'main',
          headSha: '1234567890abcdef',
          ahead: 0,
          behind: 0,
          dirtyFiles: [],
          latestCommits: [],
          remote: { name: 'origin', url: 'https://github.com/acme/pyrfor.git', repository: 'acme/pyrfor' },
        },
        github: {
          provider: 'github',
          available: true,
          repository: 'acme/pyrfor',
          branch: { name: 'main', commitSha: '1234567890abcdef' },
          issue: { number: 5, title: 'Track delivery', state: 'open', url: 'https://github.com/acme/pyrfor/issues/5' },
          pullRequests: [{ number: 42, title: 'Ship Product Factory', state: 'open', url: 'https://github.com/acme/pyrfor/pull/42' }],
          workflowRuns: [{ id: 7, name: 'CI', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/pyrfor/actions/runs/7' }],
          errors: [],
        },
      },
    });
    mockGetRunContextPack.mockResolvedValue({
      artifact: { id: 'context-pack-1', kind: 'context_pack', createdAt: '2026-05-01T00:06:00.000Z', sha256: 'sha-context' },
      pack: {
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-run-1',
        hash: 'abcdef1234567890',
        compiledAt: '2026-05-01T00:06:00.000Z',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        task: { id: 'task-1', title: 'Build product' },
        sections: [
          {
            id: 'workspace_files',
            kind: 'workspace',
            title: 'Workspace memory files',
            priority: 30,
            content: [{ path: 'MEMORY.md', content: 'User prefers safe governed actions.' }],
            sources: [{ kind: 'workspace_file', ref: 'MEMORY.md', role: 'input' }],
          },
          {
            id: 'project_memory',
            kind: 'memory',
            title: 'Project memory',
            priority: 65,
            content: [{ id: 'memory-project-1', summary: 'Keep OpenClaw migration reliable.' }],
            sources: [{ kind: 'memory', ref: 'memory-project-1', role: 'memory' }],
          },
        ],
        sourceRefs: [
          { kind: 'workspace_file', ref: 'MEMORY.md', role: 'input' },
          { kind: 'memory', ref: 'memory-project-1', role: 'memory' },
        ],
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        { id: 'event-1', ts: '2026-05-01T00:01:00.000Z', type: 'run.created' },
        { id: 'event-2', ts: '2026-05-01T00:02:00.000Z', type: 'effect.proposed', effect_id: 'effect-1' },
        { id: 'event-3', ts: '2026-05-01T00:03:00.000Z', type: 'verifier.completed', status: 'warning', reason: 'tests pending' },
      ],
    });
    mockListRunDag.mockResolvedValue({
      nodes: [
        {
          id: 'node-1',
          kind: 'workflow.step',
          status: 'running',
          dependsOn: [],
          payload: { runId: 'run-1' },
          provenance: [],
        },
      ],
    });
    mockListRunFrames.mockResolvedValue({
      frames: [{ nodeId: 'frame-node-1', frame_id: 'frame-1', type: 'tool_call', disposition: 'applied', seq: 1 }],
    });
    mockListRunActors.mockResolvedValue({
      runId: 'run-1',
      actors: [{
        actorId: 'actor-planner',
        agentId: 'planner',
        agentName: 'Planner',
        role: 'planner',
        status: 'running',
        currentWork: 'Review worker frames',
        outputs: ['Actor proof recorded'],
        blockers: [],
        mailbox: { pending: 1, leased: 0, completed: 0, failed: 0 },
        budget: { profile: 'standard' },
      }],
      totals: { actors: 1, running: 1, blocked: 0, failed: 0, mailboxPending: 1 },
    });
    mockListRunResearchEvidence.mockResolvedValue({
      evidence: [{
        artifact: { id: 'research-1', kind: 'summary', createdAt: '2026-05-01T00:07:00.000Z' },
        snapshot: {
          schemaVersion: 'pyrfor.research_evidence.v1',
          createdAt: '2026-05-01T00:07:00.000Z',
          runId: 'run-1',
          query: 'OpenClaw memory reliability',
          queryHash: 'hash',
          sourceMode: 'operator_supplied',
          effectsExecuted: [],
          sources: [{ url: 'https://example.com/research', title: 'Research source' }],
          summary: 'Evidence captured without live web execution.',
          notes: [],
        },
      }],
    });
    mockRequestRunResearchSearch.mockResolvedValue({
      status: 'approval_required',
      runId: 'run-1',
      approval: {
        id: 'research-search:default',
        toolName: 'research_live_search',
        summary: 'Run governed web search',
        args: { runId: 'run-1' },
      },
      liveSearch: true,
    });
    mockDispatchNextRunActorMessage.mockResolvedValue({
      ok: true,
      dispatch: { response: 'Actor dispatch done' },
      snapshot: {
        runId: 'run-1',
        actors: [{
          actorId: 'actor-planner',
          agentId: 'planner',
          agentName: 'Planner',
          role: 'planner',
          status: 'completed',
          currentWork: null,
          outputs: ['Actor dispatch done'],
          blockers: [],
          mailbox: { pending: 0, leased: 0, completed: 1, failed: 0 },
          budget: { profile: 'standard' },
        }],
        totals: { actors: 1, running: 0, blocked: 0, failed: 0, mailboxPending: 0 },
      },
    });
    mockCaptureRunDeliveryEvidence.mockResolvedValue({
      artifact: { id: 'artifact-evidence-new', kind: 'delivery_evidence' },
      snapshot: {
        schemaVersion: 'pyrfor.delivery_evidence.v1',
        capturedAt: '2026-05-01T00:07:00.000Z',
        runId: 'run-1',
        verifierStatus: 'passed',
        deliveryChecklist: ['release_notes'],
        git: {
          available: true,
          branch: 'feature/evidence',
          headSha: 'abcdef1234567890',
          ahead: 1,
          behind: 0,
          dirtyFiles: [],
          latestCommits: [],
          remote: { name: 'origin', url: 'https://github.com/acme/pyrfor.git', repository: 'acme/pyrfor' },
        },
        github: {
          provider: 'github',
          available: true,
          repository: 'acme/pyrfor',
          branch: { name: 'feature/evidence', commitSha: 'abcdef1234567890' },
          issue: { number: 42, title: 'Capture evidence', state: 'open', url: 'https://github.com/acme/pyrfor/issues/42' },
          pullRequests: [],
          workflowRuns: [],
          errors: [],
        },
      },
    });
    mockGetRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', createdAt: '2026-05-01T00:08:00.000Z', uri: '/private/path', sha256: 'plan-sha' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:08:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: false,
        approvalRequired: true,
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: '1234567890abcdef',
        proposedBranch: 'pyrfor/build-product-12345678',
        pullRequest: { title: 'Pyrfor delivery: Build product', body: 'No writes', draft: true },
        issue: { number: 5, commentBody: 'Dry-run plan' },
        ci: { observeWorkflowRuns: [] },
        blockers: [],
        evidenceArtifactId: 'artifact-evidence',
      },
    });
    mockCreateRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan-new', kind: 'delivery_plan', sha256: 'plan-new-sha' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:09:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: false,
        approvalRequired: true,
        repository: 'acme/pyrfor',
        baseBranch: 'feature/evidence',
        headSha: 'abcdef1234567890',
        proposedBranch: 'pyrfor/capture-evidence-abcdef12',
        pullRequest: { title: 'Pyrfor delivery: Capture evidence', body: 'No writes', draft: true },
        issue: { number: 42, commentBody: 'Dry-run plan' },
        ci: { observeWorkflowRuns: [] },
        blockers: [],
      },
    });
    mockGetRunGithubDeliveryApply.mockResolvedValue({ artifact: null, result: null });
    mockRequestRunGithubDeliveryApply.mockResolvedValue({
      status: 'awaiting_approval',
      approval: { id: 'approval-1', toolName: 'github_delivery_apply', summary: 'Create draft PR', args: {} },
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    });
    mockGetRunVerifierStatus.mockResolvedValue({
      decision: {
        status: 'passed',
        rawStatus: 'passed',
        waiverEligible: false,
        waiverPath: '/api/runs/run-1/verifier-waiver',
      },
    });
    mockCreateRunVerifierWaiver.mockResolvedValue({
      artifact: { id: 'artifact-waiver', kind: 'verifier_waiver' },
      waiver: {
        schemaVersion: 'pyrfor.verifier_waiver.v1',
        runId: 'run-1',
        rawStatus: 'blocked',
        operator: { id: 'operator' },
        reason: 'Accepted known risk',
        scope: 'all',
        waivedAt: '2026-05-03T00:00:00.000Z',
      },
      decision: {
        status: 'waived',
        rawStatus: 'blocked',
        waiverEligible: true,
        waiverPath: '/api/runs/run-1/verifier-waiver',
      },
      run: { run_id: 'run-1', status: 'completed' },
    });
    mockControlRun.mockResolvedValue({ ok: true, action: 'replay', run: { run_id: 'run-1' } });
    mockGetOverlay.mockResolvedValue({
      overlay: {
        schemaVersion: 'domain_overlay.v1',
        domainId: 'ochag',
        version: '1.0.0',
        title: 'Ochag',
        workflowTemplates: [{ id: 'family-reminder' }],
        adapterRegistrations: [{ id: 'telegram' }],
        privacyRules: [{ id: 'member-private-memory' }],
      },
    });
    mockStreamOperatorEvents.mockImplementation(() => new Promise<void>(() => {}));
  });

  it('renders dashboard summary, runs, and overlays', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText('1 total / 1 active')).toBeTruthy();
      expect(screen.getByText('Build product')).toBeTruthy();
      expect(screen.getByText('CEOClaw')).toBeTruthy();
      expect(screen.getByText('Ochag')).toBeTruthy();
      expect(screen.getByText('Product Factory')).toBeTruthy();
      expect(screen.getByText('Feature delivery')).toBeTruthy();
      expect(screen.getByText('Ochag family assistant')).toBeTruthy();
      expect(screen.getByText('CEOClaw business overlay')).toBeTruthy();
      expect(screen.getByText(/network_write:deny/)).toBeTruthy();
      expect(screen.getByText(/member-private-memory/)).toBeTruthy();
      expect(screen.getByText('2 pending')).toBeTruthy();
      expect(screen.getByText('3 total')).toBeTruthy();
      expect(screen.getByText('warning')).toBeTruthy();
    });
  });

  it('renders local-only connector doctor inventory', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetConnectorInventory).toHaveBeenCalled();
      expect(screen.getByText('Connector doctor')).toBeTruthy();
      expect(screen.getByText('1/2 configured')).toBeTruthy();
      expect(screen.getByText('local-config')).toBeTruthy();
      expect(screen.getByText(/Telegram · pending · Missing required env: TELEGRAM_BOT_TOKEN/)).toBeTruthy();
      expect(screen.getByText(/next: Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor/)).toBeTruthy();
      expect(screen.getByText(/probe preview: descriptor-status/)).toBeTruthy();
      expect(screen.getAllByText(/live probes skipped/).length).toBeGreaterThan(0);
    });
  });

  it('renders read-only skill inspector and recommends skills on request', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetSkills).toHaveBeenCalled();
      expect(screen.getByText('Skill inspector')).toBeTruthy();
      expect(screen.getByText('hash-only')).toBeTruthy();
      expect(screen.getByText('Debug')).toBeTruthy();
      expect(screen.getByText(/prompt hash: aaaaaaaaaaaa/)).toBeTruthy();
    });
    expect(mockRecommendSkills).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Recommend skills/i }));

    await waitFor(() => {
      expect(mockRecommendSkills).toHaveBeenCalledWith({ task: 'Fix a TypeScript error', limit: 5 });
      expect(screen.queryByText('Refactor')).toBeNull();
    });

    fireEvent.change(screen.getByPlaceholderText('Describe task for skill recommendation'), {
      target: { value: 'Write documentation' },
    });

    await waitFor(() => {
      expect(screen.getByText('Refactor')).toBeTruthy();
    });
  });

  it('shows an explicit empty state for no matching skill recommendations', async () => {
    mockRecommendSkills.mockResolvedValueOnce({
      taskPreview: 'unmatched task',
      limit: 5,
      recommendations: [],
    });
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText('Skill inspector')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Recommend skills/i }));

    await waitFor(() => {
      expect(screen.getByText('No matching skills for this task.')).toBeTruthy();
    });
  });

  it('ignores stale skill recommendation responses after task text changes', async () => {
    let resolveRecommendation: ((value: {
      taskPreview: string;
      limit: number;
      recommendations: Array<{
        id: string;
        name: string;
        description: string;
        whenToUse: string[];
        tags: string[];
        stepsCount: number;
        examplesCount: number;
        estimatedTokens: number;
        systemPromptHash: string;
      }>;
    }) => void) | undefined;
    mockRecommendSkills.mockReturnValueOnce(new Promise((resolve) => {
      resolveRecommendation = resolve;
    }));
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText('Skill inspector')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Recommend skills/i }));
    fireEvent.change(screen.getByPlaceholderText('Describe task for skill recommendation'), {
      target: { value: 'Write documentation' },
    });
    resolveRecommendation?.({
      taskPreview: 'Fix a TypeScript error',
      limit: 5,
      recommendations: [{
        id: 'debug',
        name: 'Debug',
        description: 'Stale recommendation',
        whenToUse: ['debugging'],
        tags: ['debugging'],
        stepsCount: 4,
        examplesCount: 1,
        estimatedTokens: 120,
        systemPromptHash: 'a'.repeat(64),
      }],
    });

    await waitFor(() => {
      expect(screen.getByText('Refactor')).toBeTruthy();
      expect(screen.queryByText('Stale recommendation')).toBeNull();
      expect(screen.getByRole('button', { name: /Recommend skills/i })).toBeTruthy();
    });
  });

  it('requests and runs approval-gated live connector probes from connector doctor', async () => {
    mockProbeConnector
      .mockResolvedValueOnce({
        status: 'approval_required',
        connectorId: 'github',
        approval: {
          id: 'connector-live-probe:github',
          toolName: 'connector_live_probe',
          summary: 'Run live connector probe for GitHub',
          args: { connectorId: 'github' },
        },
        liveProbe: true,
      })
      .mockResolvedValueOnce({
        status: 'probed',
        connectorId: 'github',
        approvalId: 'connector-live-probe:github',
        liveProbe: true,
        connector: {
          id: 'github',
          name: 'GitHub',
          description: 'GitHub integration',
          direction: 'outbound',
          sourceSystem: 'GitHub API',
          operations: ['Create draft PR'],
          credentials: [{ envVar: 'GITHUB_TOKEN', description: 'GitHub token' }],
          apiSurface: [{ method: 'POST', path: '/api/github', description: 'GitHub actions' }],
          stub: false,
          status: 'ok',
          configured: true,
          checkedAt: '2026-05-04T00:01:00.000Z',
          message: 'GitHub probe succeeded.',
          missingSecrets: [],
        },
      });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Connector doctor')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Request live probe/i }));

    await waitFor(() => {
      expect(mockProbeConnector).toHaveBeenCalledWith('github');
      expect(screen.getByText(/Approval pending: connector-live-probe:github/)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);

    mockListPendingApprovals.mockRejectedValueOnce(new Error('approvals unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);
    });

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Run approved probe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Run approved probe/i }));

    await waitFor(() => {
      expect(mockProbeConnector).toHaveBeenCalledWith('github', { approvalId: 'connector-live-probe:github' });
      expect(screen.getByText(/live status: ok · GitHub probe succeeded/)).toBeTruthy();
    });
  });

  it('creates project memory rollups from memory continuity', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Memory continuity')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Create project rollup/i }));

    await waitFor(() => {
      expect(mockCreateProjectMemoryRollup).toHaveBeenCalledWith({ projectId: 'project-1', sessionLimit: 200 });
      expect(screen.getByText(/project-1: 2 sessions, 3 events, 1 runs/)).toBeTruthy();
      expect(screen.getByText(/decision · Decisions for project project-1/)).toBeTruthy();
      expect(screen.getByText(/risk · Risks for project project-1/)).toBeTruthy();
    });
  });

  it('uses operator stream snapshots to refresh live run summary', async () => {
    let onEvent: ((event: { type: string; dashboard?: unknown; runs?: unknown[] }) => void) | undefined;
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });

    render(<OrchestrationPanel />);
    await waitFor(() => expect(screen.getByText('1 total / 1 active')).toBeTruthy());

    onEvent?.({
      type: 'snapshot',
      dashboard: {
        runs: { total: 2, active: 1, blocked: 1, latest: [] },
        dag: { total: 3, ready: 1, running: 1, blocked: 1 },
        effects: { pending: 0 },
        approvals: { pending: 0 },
        verifier: { blocked: 1, status: 'blocked' },
        workerFrames: { total: 4, pending: 0, lastType: 'failure_report' },
        contextPack: null,
        overlays: { total: 2, domainIds: ['ceoclaw', 'ochag'] },
      },
      runs: [
        {
          run_id: 'run-2',
          task_id: 'Blocked product',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'blocked',
          artifact_refs: [],
          created_at: '2026-05-01T00:10:00.000Z',
          updated_at: '2026-05-01T00:15:00.000Z',
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('2 total / 1 active')).toBeTruthy();
      expect(screen.getByText('Blocked product')).toBeTruthy();
      expect(screen.getAllByText('blocked').length).toBeGreaterThan(0);
    });
  });

  it('loads run details when a run is selected', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(mockGetRun).toHaveBeenCalledWith('run-1');
      expect(mockGetRunContextPack).toHaveBeenCalledWith('run-1');
      expect(mockListRunEvents).toHaveBeenCalledWith('run-1');
      expect(mockListRunDag).toHaveBeenCalledWith('run-1');
      expect(mockListRunFrames).toHaveBeenCalledWith('run-1');
      expect(mockListRunActors).toHaveBeenCalledWith('run-1');
      expect(mockListRunResearchEvidence).toHaveBeenCalledWith('run-1');
      expect(mockGetRunDeliveryEvidence).toHaveBeenCalledWith('run-1');
      expect(mockGetRunGithubDeliveryPlan).toHaveBeenCalledWith('run-1');
      expect(mockGetRunVerifierStatus).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('run.created')).toBeTruthy();
      expect(screen.getByText('workflow.step')).toBeTruthy();
      expect(screen.getByText('tool_call')).toBeTruthy();
      expect(screen.getByText('Planner')).toBeTruthy();
      expect(screen.getByText('output: Actor proof recorded')).toBeTruthy();
      expect(screen.getByText('OpenClaw memory reliability')).toBeTruthy();
      expect(screen.getByText('Research source')).toBeTruthy();
      expect(screen.getByText('ctx-run-1')).toBeTruthy();
      expect(screen.getByText('Workspace memory files')).toBeTruthy();
      expect(screen.getByText('Project memory')).toBeTruthy();
      expect(screen.getByText(/Keep OpenClaw migration reliable/)).toBeTruthy();
      expect(screen.getAllByText('effect.proposed').length).toBeGreaterThan(0);
      expect(screen.getByText('tests pending')).toBeTruthy();
      expect(screen.getAllByText('acme/pyrfor').length).toBeGreaterThan(0);
      expect(screen.getByText('Issue #5')).toBeTruthy();
      expect(screen.getByText('Track delivery')).toBeTruthy();
      expect(screen.getByText('PR #42')).toBeTruthy();
      expect(screen.getByText('CI')).toBeTruthy();
      expect(screen.getByText(/implementation_summary, tests/)).toBeTruthy();
      expect(screen.getByText('pyrfor/build-product-12345678')).toBeTruthy();
      expect(screen.getByText('Pyrfor delivery: Build product')).toBeTruthy();
    });
  });

  it('requests and runs approval-gated governed research search for the selected run', async () => {
    mockRequestRunResearchSearch
      .mockResolvedValueOnce({
        status: 'approval_required',
        runId: 'run-1',
        approval: {
          id: 'research-search:abc',
          toolName: 'research_live_search',
          summary: 'Run governed web search for run-1',
          args: { runId: 'run-1', query: 'Pyrfor memory reliability' },
        },
        liveSearch: true,
      })
      .mockResolvedValueOnce({
        status: 'captured',
        artifact: { id: 'research-2', kind: 'summary', createdAt: '2026-05-01T00:08:00.000Z' },
        snapshot: {
          schemaVersion: 'pyrfor.research_evidence.v2',
          createdAt: '2026-05-01T00:08:00.000Z',
          runId: 'run-1',
          query: 'Pyrfor memory reliability',
          queryHash: 'hash-2',
          sourceMode: 'governed_search',
          effectsExecuted: [{
            kind: 'web_search',
            provider: 'brave',
            approvalId: 'research-search:abc',
            executedAt: '2026-05-01T00:08:00.000Z',
            maxResults: 5,
            resultCount: 1,
          }],
          sources: [{ url: 'https://example.com/search', title: 'Search result' }],
          summary: 'Governed brave search captured 1 source.',
          notes: [],
        },
      });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByLabelText(/Governed web search/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Governed web search/i), {
      target: { value: 'Pyrfor memory reliability' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request live search/i }));

    await waitFor(() => {
      expect(mockRequestRunResearchSearch).toHaveBeenCalledWith('run-1', {
        query: 'Pyrfor memory reliability',
        maxResults: 5,
      });
      expect(screen.getByText(/Approval pending: research-search:abc/)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Run approved search/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Run approved search/i }));

    await waitFor(() => {
      expect(mockRequestRunResearchSearch).toHaveBeenCalledWith('run-1', {
        query: 'Pyrfor memory reliability',
        maxResults: 5,
        approvalId: 'research-search:abc',
      });
      expect(screen.getByText('Search result')).toBeTruthy();
      expect(screen.getByText('effect: web_search/brave')).toBeTruthy();
    });
  });

  it('dispatches the next pending actor mailbox task from the actor card', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Dispatch next/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Dispatch next/i }));

    await waitFor(() => {
      expect(mockDispatchNextRunActorMessage).toHaveBeenCalledWith('run-1', { actorId: 'actor-planner' });
    });
  });

  it('hides actor dispatch control when the mailbox has no pending tasks', async () => {
    mockListRunActors.mockResolvedValue({
      runId: 'run-1',
      actors: [{
        actorId: 'actor-planner',
        agentId: 'planner',
        agentName: 'Planner',
        role: 'planner',
        status: 'completed',
        currentWork: null,
        outputs: ['Actor proof recorded'],
        blockers: [],
        mailbox: { pending: 0, leased: 0, completed: 1, failed: 0 },
        budget: { profile: 'standard' },
      }],
      totals: { actors: 1, running: 0, blocked: 0, failed: 0, mailboxPending: 0 },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByText('Planner')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Dispatch next/i })).toBeNull();
  });

  it('creates verifier waivers from blocked verifier state', async () => {
    mockGetRunVerifierStatus.mockResolvedValue({
      decision: {
        status: 'blocked',
        rawStatus: 'blocked',
        reason: 'policy violation',
        waiverEligible: true,
        waiverPath: '/api/runs/run-1/verifier-waiver',
      },
    });
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Create verifier waiver')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('waiver reason'), {
      target: { value: 'Accepted known risk' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create verifier waiver/i }));

    await waitFor(() => {
      expect(mockCreateRunVerifierWaiver).toHaveBeenCalledWith('run-1', {
        operatorId: 'operator',
        reason: 'Accepted known risk',
        scope: 'all',
      });
    });
  });

  it('captures delivery evidence for the selected run', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Capture evidence')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/GitHub issue #/i), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /Capture evidence/i }));

    await waitFor(() => {
      expect(mockCaptureRunDeliveryEvidence).toHaveBeenCalledWith('run-1', { issueNumber: 42 });
      expect(screen.getByText(/feature\/evidence/)).toBeTruthy();
      expect(screen.getByText('Issue #42')).toBeTruthy();
      expect(screen.getByText(/release_notes/)).toBeTruthy();
    });
  });

  it('creates a dry-run GitHub delivery plan for the selected run', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Plan GitHub delivery')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/GitHub issue #/i), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /Plan GitHub delivery/i }));

    await waitFor(() => {
      expect(mockCreateRunGithubDeliveryPlan).toHaveBeenCalledWith('run-1', { issueNumber: 42 });
      expect(screen.getByText('pyrfor/capture-evidence-abcdef12')).toBeTruthy();
      expect(screen.getByText('Pyrfor delivery: Capture evidence')).toBeTruthy();
      expect(screen.getByText('links issue #42')).toBeTruthy();
    });
  });

  it('requests GitHub delivery apply approval only after typed confirmation', async () => {
    mockGetRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', createdAt: '2026-05-01T00:08:00.000Z', uri: '/private/path', sha256: 'plan-sha' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:08:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: true,
        approvalRequired: true,
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: '1234567890abcdef',
        proposedBranch: 'pyrfor/build-product-12345678',
        pullRequest: { title: 'Pyrfor delivery: Build product', body: 'No writes', draft: true },
        ci: { observeWorkflowRuns: [] },
        blockers: [],
        evidenceArtifactId: 'artifact-evidence',
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Apply GitHub delivery')).toBeTruthy());

    const requestButton = screen.getByRole('button', { name: /Request apply approval/i });
    expect(requestButton).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('APPLY pyrfor/build-product-12345678'), {
      target: { value: 'APPLY pyrfor/build-product-12345678' },
    });
    fireEvent.click(requestButton);

    await waitFor(() => {
      expect(mockRequestRunGithubDeliveryApply).toHaveBeenCalledWith('run-1', {
        planArtifactId: 'artifact-plan',
        expectedPlanSha256: 'plan-sha',
      });
      expect(screen.getByText(/Approval pending: approval-1/)).toBeTruthy();
    });
  });

  it('restores pending GitHub delivery apply approval from run events', async () => {
    mockGetRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', createdAt: '2026-05-01T00:08:00.000Z', uri: '/private/path', sha256: 'plan-sha' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:08:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: true,
        approvalRequired: true,
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: '1234567890abcdef',
        proposedBranch: 'pyrfor/build-product-12345678',
        pullRequest: { title: 'Pyrfor delivery: Build product', body: 'No writes', draft: true },
        ci: { observeWorkflowRuns: [] },
        blockers: [],
        evidenceArtifactId: 'artifact-evidence',
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        { id: 'event-1', seq: 1, ts: '2026-05-01T00:01:00.000Z', type: 'run.created' },
        {
          id: 'event-2',
          seq: 2,
          ts: '2026-05-01T00:09:00.000Z',
          type: 'approval.requested',
          tool: 'github_delivery_apply',
          approval_id: 'approval-restored',
          artifact_id: 'artifact-plan',
          reason: 'approval required for delivery plan artifact-plan',
        },
      ],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText(/Approval pending: approval-restored/)).toBeTruthy();
      expect(screen.getByText('Repository: acme/pyrfor')).toBeTruthy();
      expect(screen.getByText('Base branch: main')).toBeTruthy();
      expect(screen.getByText('Proposed branch: pyrfor/build-product-12345678')).toBeTruthy();
      expect(screen.getByText('Head SHA: 1234567890abcdef')).toBeTruthy();
      expect(screen.getByText('Plan artifact: artifact-plan')).toBeTruthy();
    });
  });

  it('loads overlay details when an overlay is selected', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Ochag')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: /Ochag/i }).find((button) => (
      button.className === 'orchestration-row'
    ))!);

    await waitFor(() => {
      expect(mockGetOverlay).toHaveBeenCalledWith('ochag');
      expect(screen.getByText('1 workflows / 1 adapters')).toBeTruthy();
      expect(screen.getByText(/Privacy rules: member-private-memory/)).toBeTruthy();
      expect(screen.getByText(/family-reminder/)).toBeTruthy();
    });
  });

  it('previews product factory plans', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Feature delivery')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Preview plan/i }));

    await waitFor(() => {
      expect(mockPreviewProductFactoryPlan).toHaveBeenCalledWith({
        templateId: 'feature',
        prompt: 'Describe the product idea or task to plan',
        answers: {
          acceptance: 'Visible outcome is available in the operator console.',
        },
      });
      expect(screen.getByText('Build delivery package')).toBeTruthy();
      expect(screen.getByText(/product_factory\.scoped_plan/)).toBeTruthy();
      expect(screen.getByText(/implementation_summary/)).toBeTruthy();
    });
  });

  it('creates product factory runs with required clarification answers', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Feature delivery')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Create run$/i }));

    await waitFor(() => {
      expect(mockCreateProductFactoryRun).toHaveBeenCalledWith({
        templateId: 'feature',
        prompt: 'Describe the product idea or task to plan',
        answers: {
          acceptance: 'Visible outcome is available in the operator console.',
        },
      });
    });
  });

  it('previews Ochag family reminder plans', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Ochag family assistant')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Preview Ochag reminder/i }));

    await waitFor(() => {
      expect(mockPreviewOchagReminder).toHaveBeenCalledWith({
        title: 'Send dinner reminder',
        familyId: 'family-1',
        dueAt: '18:00 today',
        audience: 'family',
        visibility: 'family',
      });
      expect(screen.getByText('Send dinner reminder')).toBeTruthy();
      expect(screen.getByText(/ochag\.telegram_notify/)).toBeTruthy();
      expect(screen.getByText(/telegram_message_preview/)).toBeTruthy();
    });
  });

  it('creates Ochag reminder runs with family context', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Ochag family assistant')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Create Ochag run/i }));

    await waitFor(() => {
      expect(mockCreateOchagReminderRun).toHaveBeenCalledWith({
        title: 'Send dinner reminder',
        familyId: 'family-1',
        dueAt: '18:00 today',
        audience: 'family',
        visibility: 'family',
      });
    });
  });

  it('previews CEOClaw business brief plans', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('CEOClaw business overlay')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Preview CEOClaw brief/i }));

    await waitFor(() => {
      expect(mockPreviewCeoclawBrief).toHaveBeenCalledWith({
        decision: 'Approve evidence-backed project action',
        evidence: 'evidence-1',
        deadline: 'this week',
      });
      expect(screen.getByText('Approve evidence-backed project action')).toBeTruthy();
      expect(screen.getByText(/ceoclaw\.request_approval/)).toBeTruthy();
      expect(screen.getByText(/executive_summary/)).toBeTruthy();
    });
  });
});
