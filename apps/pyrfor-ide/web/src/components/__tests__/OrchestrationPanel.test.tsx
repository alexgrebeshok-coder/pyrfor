import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetDashboard = vi.fn();
const mockCaptureRunDeliveryEvidence = vi.fn();
const mockCreateRunGithubDeliveryPlan = vi.fn();
const mockListRuns = vi.fn();
const mockGetRun = vi.fn();
const mockGetRunContextPack = vi.fn();
const mockRefreshRunContextPack = vi.fn();
const mockGetRunProductFactoryPlan = vi.fn();
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
const mockCreateRunResearchEvidence = vi.fn();
const mockRequestRunResearchSearch = vi.fn();
const mockListRunResearchSourceCaptures = vi.fn();
const mockRequestRunResearchSourceCapture = vi.fn();
const mockListRunBrowserSmoke = vi.fn();
const mockRequestRunBrowserSmoke = vi.fn();
const mockDispatchNextRunActorMessage = vi.fn();
const mockRecoverStuckRunActorMessages = vi.fn();
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
const mockListAuditEvents = vi.fn();
const mockPreviewCeoclawBrief = vi.fn();
const mockCreateCeoclawBriefRun = vi.fn();
const mockStreamOperatorEvents = vi.fn();
const mockGetAgents = vi.fn();
const mockGetMemorySnapshot = vi.fn();
const mockGetMemoryContinuity = vi.fn();
const mockGetConnectorInventory = vi.fn();
const mockGetResearchReadiness = vi.fn();
const mockGetGithubDeliveryReadiness = vi.fn();
const mockGetBrowserReadiness = vi.fn();
const mockGetReleaseReadiness = vi.fn();
const mockGetSkills = vi.fn();
const mockGetSlashCommands = vi.fn();
const mockInvokeSlashCommand = vi.fn();
const mockRecommendSkills = vi.fn();
const mockProbeConnector = vi.fn();
const mockListSessions = vi.fn();
const mockGetSessionTimeline = vi.fn();
const mockCreateMemoryRollup = vi.fn();
const mockCreateProjectMemoryRollup = vi.fn();
const mockCreateMemoryCorrection = vi.fn();
const mockSearchMemory = vi.fn();
const mockCreateOpenClawImportReport = vi.fn();
const mockGetOpenClawImportReport = vi.fn();
const mockImportOpenClawMemory = vi.fn();

vi.mock('../../lib/api', () => ({
  getDashboard: (...args: unknown[]) => mockGetDashboard(...args),
  captureRunDeliveryEvidence: (...args: unknown[]) => mockCaptureRunDeliveryEvidence(...args),
  createRunGithubDeliveryPlan: (...args: unknown[]) => mockCreateRunGithubDeliveryPlan(...args),
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  getRun: (...args: unknown[]) => mockGetRun(...args),
  getRunContextPack: (...args: unknown[]) => mockGetRunContextPack(...args),
  refreshRunContextPack: (...args: unknown[]) => mockRefreshRunContextPack(...args),
  getRunProductFactoryPlan: (...args: unknown[]) => mockGetRunProductFactoryPlan(...args),
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
  createRunResearchEvidence: (...args: unknown[]) => mockCreateRunResearchEvidence(...args),
  requestRunResearchSearch: (...args: unknown[]) => mockRequestRunResearchSearch(...args),
  listRunResearchSourceCaptures: (...args: unknown[]) => mockListRunResearchSourceCaptures(...args),
  requestRunResearchSourceCapture: (...args: unknown[]) => mockRequestRunResearchSourceCapture(...args),
  listRunBrowserSmoke: (...args: unknown[]) => mockListRunBrowserSmoke(...args),
  requestRunBrowserSmoke: (...args: unknown[]) => mockRequestRunBrowserSmoke(...args),
  dispatchNextRunActorMessage: (...args: unknown[]) => mockDispatchNextRunActorMessage(...args),
  recoverStuckRunActorMessages: (...args: unknown[]) => mockRecoverStuckRunActorMessages(...args),
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
  listAuditEvents: (...args: unknown[]) => mockListAuditEvents(...args),
  previewCeoclawBrief: (...args: unknown[]) => mockPreviewCeoclawBrief(...args),
  createCeoclawBriefRun: (...args: unknown[]) => mockCreateCeoclawBriefRun(...args),
  streamOperatorEvents: (...args: unknown[]) => mockStreamOperatorEvents(...args),
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
  getMemorySnapshot: (...args: unknown[]) => mockGetMemorySnapshot(...args),
  getMemoryContinuity: (...args: unknown[]) => mockGetMemoryContinuity(...args),
  getConnectorInventory: (...args: unknown[]) => mockGetConnectorInventory(...args),
  getResearchReadiness: (...args: unknown[]) => mockGetResearchReadiness(...args),
  getGithubDeliveryReadiness: (...args: unknown[]) => mockGetGithubDeliveryReadiness(...args),
  getBrowserReadiness: (...args: unknown[]) => mockGetBrowserReadiness(...args),
  getReleaseReadiness: (...args: unknown[]) => mockGetReleaseReadiness(...args),
  getSkills: (...args: unknown[]) => mockGetSkills(...args),
  getSlashCommands: (...args: unknown[]) => mockGetSlashCommands(...args),
  invokeSlashCommand: (...args: unknown[]) => mockInvokeSlashCommand(...args),
  recommendSkills: (...args: unknown[]) => mockRecommendSkills(...args),
  probeConnector: (...args: unknown[]) => mockProbeConnector(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
  getSessionTimeline: (...args: unknown[]) => mockGetSessionTimeline(...args),
  createMemoryRollup: (...args: unknown[]) => mockCreateMemoryRollup(...args),
  createProjectMemoryRollup: (...args: unknown[]) => mockCreateProjectMemoryRollup(...args),
  createMemoryCorrection: (...args: unknown[]) => mockCreateMemoryCorrection(...args),
  searchMemory: (...args: unknown[]) => mockSearchMemory(...args),
  createOpenClawImportReport: (...args: unknown[]) => mockCreateOpenClawImportReport(...args),
  getOpenClawImportReport: (...args: unknown[]) => mockGetOpenClawImportReport(...args),
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
    mockRefreshRunContextPack.mockReset();
    mockGetRunProductFactoryPlan.mockReset();
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
    mockCreateRunResearchEvidence.mockReset();
    mockRequestRunResearchSearch.mockReset();
    mockListRunResearchSourceCaptures.mockReset();
    mockRequestRunResearchSourceCapture.mockReset();
    mockListRunBrowserSmoke.mockReset();
    mockRequestRunBrowserSmoke.mockReset();
    mockDispatchNextRunActorMessage.mockReset();
    mockRecoverStuckRunActorMessages.mockReset();
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
    mockListAuditEvents.mockReset();
    mockPreviewCeoclawBrief.mockReset();
    mockCreateCeoclawBriefRun.mockReset();
    mockStreamOperatorEvents.mockReset();
    mockGetAgents.mockReset();
    mockGetMemorySnapshot.mockReset();
    mockGetMemoryContinuity.mockReset();
    mockGetConnectorInventory.mockReset();
    mockGetResearchReadiness.mockReset();
    mockGetGithubDeliveryReadiness.mockReset();
    mockGetBrowserReadiness.mockReset();
    mockGetReleaseReadiness.mockReset();
    mockGetSkills.mockReset();
    mockGetSlashCommands.mockReset();
    mockInvokeSlashCommand.mockReset();
    mockRecommendSkills.mockReset();
    mockProbeConnector.mockReset();
    mockListSessions.mockReset();
    mockGetSessionTimeline.mockReset();
    mockCreateMemoryRollup.mockReset();
    mockCreateProjectMemoryRollup.mockReset();
    mockCreateMemoryCorrection.mockReset();
    mockSearchMemory.mockReset();
    mockCreateOpenClawImportReport.mockReset();
    mockGetOpenClawImportReport.mockReset();
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
          workflowCount: 1,
          adapterCount: 1,
          privacyRuleIds: ['finance-write-approval'],
          toolPermissionSummaries: ['network_write:deny', 'secrets_access:ask_every_time'],
        },
        {
          schemaVersion: 'domain_overlay.v1',
          domainId: 'ochag',
          version: '1.0.0',
          title: 'Ochag',
          workflowCount: 0,
          adapterCount: 0,
          privacyRuleIds: [],
          toolPermissionSummaries: [],
        },
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
        {
          id: 'ui_scaffold',
          title: 'UI scaffold',
          description: 'UI template',
          recommendedDomainIds: [],
          clarifications: [
            { id: 'users', question: 'Users?', required: true },
            { id: 'states', question: 'States?', required: true },
          ],
          deliveryArtifacts: ['visual_qa_notes'],
          qualityGates: ['browser_smoke'],
        },
      ],
    });
    mockListPendingApprovals.mockResolvedValue({ approvals: [] });
    mockGetAgents.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Research OpenClaw migration',
        status: 'running',
        startedAt: '2026-05-04T00:00:00.000Z',
      },
      {
        id: 'sub-2',
        name: 'Review connector manifests',
        status: 'completed',
        startedAt: '2026-05-04T00:01:00.000Z',
      },
    ]);
    mockGetMemorySnapshot.mockResolvedValue({ lines: [], files: [], workspaceFiles: {}, daily: [] });
    mockGetMemoryContinuity.mockResolvedValue({
      workspaceId: '/workspace',
      generatedAt: '2026-05-01T00:00:00.000Z',
      workspaceFiles: {
        present: 1,
        total: 2,
        missing: ['SOUL.md'],
        files: {
          'MEMORY.md': { present: true, lineCount: 1 },
          'SOUL.md': { present: false, lineCount: 0 },
        },
      },
      latestDailyRollup: { status: 'ok', date: '2026-05-01', artifact: { id: 'daily-rollup-1', kind: 'summary', sha256: 'daily-sha', createdAt: '2026-05-01T00:00:00.000Z' } },
      latestProjectRollup: { status: 'not_configured' },
      latestOpenClawReport: { status: 'ok', artifact: { id: 'openclaw-report-1', kind: 'summary', sha256: 'openclaw-sha', createdAt: '2026-05-01T00:00:00.000Z' }, counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 } },
      warnings: ['memory_files_missing', 'no_project_id'],
    });
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
    mockGetResearchReadiness.mockResolvedValue({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'ready',
      defaultProvider: 'duckduckgo',
      configuredProvider: 'duckduckgo',
      allowedProviders: ['brave', 'duckduckgo'],
      reasons: ['Default governed search provider is duckduckgo.'],
      nextStep: 'Request governed search approval from a run to capture evidence.',
      providers: [
        {
          provider: 'brave',
          configured: false,
          missingEnv: ['BRAVE_API_KEY'],
          readiness: {
            state: 'pending',
            reasons: ['Missing required env: BRAVE_API_KEY'],
            nextStep: 'Set BRAVE_API_KEY or choose DuckDuckGo as the governed search provider.',
          },
        },
        {
          provider: 'duckduckgo',
          configured: true,
          missingEnv: [],
          readiness: {
            state: 'configured',
            reasons: ['DuckDuckGo governed search requires no local credential env vars.'],
            nextStep: 'Set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo or select DuckDuckGo for an individual search.',
          },
        },
      ],
    });
    mockGetGithubDeliveryReadiness.mockResolvedValue({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'ready',
      tokenConfigured: true,
      tokenEnvVar: 'PYRFOR_GITHUB_TOKEN',
      git: { available: true, branch: 'main', headSha: 'abcdef1234567890', dirtyFileCount: 0 },
      github: { repository: 'acme/pyrfor', remoteConfigured: true },
      reasons: ['Local GitHub delivery prerequisites are configured.'],
      nextStep: 'Review verifier status, create a dry-run delivery plan, then request GitHub apply approval.',
    });
    mockGetBrowserReadiness.mockResolvedValue({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'ready',
      browserTool: { name: 'browser', available: true, actions: ['screenshot', 'extract', 'click', 'type'] },
      playwright: {
        packageName: 'playwright',
        installed: true,
        chromiumInstalled: true,
        installHint: 'Install Playwright and Chromium with: pnpm add -w playwright @playwright/browsers && pnpm exec playwright install chromium',
      },
      permission: { toolName: 'browser_navigate', permissionClass: 'ask_once', sideEffect: 'network' },
      reasons: ['Browser QA local prerequisites are configured.'],
      nextStep: 'Request Trust approval before running any live browser smoke or screenshot capture.',
    });
    mockGetReleaseReadiness.mockResolvedValue({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'unavailable',
      secrets: [
        { name: 'APPLE_SIGNING_IDENTITY', configured: false },
        { name: 'APPLE_CERTIFICATE_P12', configured: false },
        { name: 'APPLE_CERTIFICATE_PASSWORD', configured: false },
        { name: 'APPLE_ID', configured: false },
        { name: 'APPLE_TEAM_ID', configured: false },
        { name: 'APPLE_PASSWORD', configured: false },
        { name: 'TAURI_SIGNING_PRIVATE_KEY', configured: true },
      ],
      artifacts: [
        { name: 'pyrfor-daemon-aarch64-apple-darwin', present: false },
      ],
      contracts: [
        { id: 'tauri-updater-active', passed: true, description: 'Tauri updater is active' },
      ],
      reasons: ['Release secret env is missing: APPLE_SIGNING_IDENTITY.'],
      nextStep: 'Set missing release secrets, build sidecar artifacts, and refresh Release readiness before tagging.',
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
    mockGetSlashCommands.mockResolvedValue({
      commands: [{
        name: 'skills',
        description: 'List or recommend governed skills without exposing raw prompts',
        aliases: [],
        argSchema: {
          positional: [{ name: 'task', type: 'string', description: 'Optional task to recommend skills for' }],
          flags: { limit: { type: 'number', description: 'Maximum skills to return', default: 5 } },
        },
        permissionClass: 'auto_allow',
      }],
    });
    mockInvokeSlashCommand.mockResolvedValue({
      ok: true,
      output: 'Recommended skills for "Fix a TypeScript error": debug',
      ms: 3,
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
    mockCreateOpenClawImportReport.mockImplementation(async (input: { projectId?: string } = {}) => ({
      artifact: { id: 'openclaw-report-1', kind: 'summary', uri: 'memory://openclaw-report-1', sha256: 'sha', createdAt: '2026-05-01T00:00:00.000Z' },
      report: {
        schemaVersion: 'openclaw_migration_report.v1',
        generatedAt: '2026-05-01T00:00:00.000Z',
        workspaceId: 'workspace-1',
        ...(input.projectId ? { projectId: input.projectId } : {}),
        sourceRoot: '~/openclaw-workspace',
        counts: { importable: 0, skipped: 0, personality: 0, memories: 0, skills: 0, redactions: 0 },
        entries: [],
        skipped: [],
      },
    }));
    mockGetOpenClawImportReport.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    mockImportOpenClawMemory.mockResolvedValue({ status: 'imported', result: { imported: 0, skipped: 0, memoryIds: [], artifact: { id: 'openclaw-import-result-1', kind: 'summary', uri: 'memory://openclaw-result', createdAt: '2026-05-01T00:00:00.000Z' } } });
    mockPreviewProductFactoryPlan.mockResolvedValue({
      preview: {
        intent: { id: 'pf-1', templateId: 'feature', title: 'Build delivery package', goal: 'Build delivery package', domainIds: [] },
        template: { id: 'feature', title: 'Feature delivery' },
        missingClarifications: [{ id: 'acceptance', question: 'Acceptance?', required: true }],
        scopedPlan: { objective: 'Build delivery package', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
        qualityGateReadiness: [],
        actorWorkflow: {
          enabled: true,
          recommendedModel: 'gpt-5.4',
          actors: [
            { actorId: 'product-planner', role: 'planner', agentName: 'Product Planner', messageCount: 1, dependsOn: [] },
            { actorId: 'product-implementer', role: 'implementer', agentName: 'Product Implementer', messageCount: 1, dependsOn: ['product-planner'] },
            { actorId: 'product-reviewer', role: 'reviewer', agentName: 'Product Reviewer', messageCount: 1, dependsOn: ['product-implementer'] },
          ],
          nextStep: 'Create the run, execute the governed Product Factory flow, then dispatch actor mailbox tasks in planner -> implementer -> reviewer order. GPT-5.4 is recommended for this multi-agent workflow.',
        },
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
        qualityGateReadiness: [],
        actorWorkflow: { enabled: true, recommendedModel: 'gpt-5.4', actors: [], nextStep: 'GPT-5.4 is recommended for this multi-agent workflow.' },
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
        qualityGateReadiness: [],
        actorWorkflow: { enabled: false, recommendedModel: 'gpt-5.4', actors: [], nextStep: 'This template does not seed Product Factory actor mailbox work.' },
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
        qualityGateReadiness: [],
        actorWorkflow: { enabled: false, recommendedModel: 'gpt-5.4', actors: [], nextStep: 'This template does not seed Product Factory actor mailbox work.' },
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
    mockListAuditEvents.mockResolvedValue({ events: [] });
    mockPreviewCeoclawBrief.mockResolvedValue({
      preview: {
        intent: { id: 'pf-ceoclaw', templateId: 'business_brief', title: 'Approve evidence-backed project action', goal: 'Approve evidence-backed project action', domainIds: ['ceoclaw'] },
        template: { id: 'business_brief', title: 'Business/CEO brief' },
        missingClarifications: [],
        scopedPlan: { objective: 'Approve evidence-backed project action', scope: [], assumptions: [], risks: [], qualityGates: ['evidence_check'] },
        qualityGateReadiness: [],
        actorWorkflow: { enabled: false, recommendedModel: 'gpt-5.4', actors: [], nextStep: 'This template does not seed Product Factory actor mailbox work.' },
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
        qualityGateReadiness: [],
        actorWorkflow: { enabled: false, recommendedModel: 'gpt-5.4', actors: [], nextStep: 'This template does not seed Product Factory actor mailbox work.' },
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
    mockRefreshRunContextPack.mockResolvedValue({
      artifact: { id: 'context-pack-2', kind: 'context_pack', createdAt: '2026-05-01T00:07:00.000Z', sha256: 'sha-context-2' },
      previousArtifact: { id: 'context-pack-1', kind: 'context_pack', createdAt: '2026-05-01T00:06:00.000Z', sha256: 'sha-context' },
      pack: {
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-run-1',
        hash: 'refreshed1234567890',
        compiledAt: '2026-05-01T00:07:00.000Z',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        task: { id: 'task-1', title: 'Build product' },
        sections: [
          {
            id: 'run_evidence',
            kind: 'evidence',
            title: 'Run evidence',
            priority: 58,
            content: [{ artifactId: 'research-1', kind: 'research_evidence', summary: 'Reviewed governed evidence.' }],
            sources: [{ kind: 'artifact', ref: 'research-1', role: 'evidence' }],
          },
        ],
        sourceRefs: [{ kind: 'artifact', ref: 'research-1', role: 'evidence' }],
      },
    });
    mockGetRunProductFactoryPlan.mockResolvedValue({
      artifact: { id: 'product-plan-1', kind: 'plan', sha256: 'plan-sha-1', createdAt: '2026-05-01T00:06:30.000Z' },
      preview: {
        intent: { id: 'pf-1', templateId: 'feature', title: 'Build delivery package', goal: 'Build delivery package', domainIds: [] },
        template: { id: 'feature', title: 'Feature delivery' },
        missingClarifications: [],
        scopedPlan: { objective: 'Build delivery package', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
        qualityGateReadiness: [{
          gate: 'browser_smoke',
          status: 'ready',
          statusSource: 'local-config',
          liveProbeSkipped: true,
          approvalRequired: true,
          reasons: ['Browser smoke can run after Trust approval.'],
          nextStep: 'Request browser smoke approval.',
        }],
        actorWorkflow: {
          enabled: true,
          recommendedModel: 'gpt-5.4',
          actors: [{ actorId: 'planner', role: 'planner', agentName: 'Planner', messageCount: 1, dependsOn: [] }],
          nextStep: 'GPT-5.4 is recommended for this multi-agent workflow.',
        },
        dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
        deliveryChecklist: ['implementation_summary'],
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        { id: 'event-1', ts: '2026-05-01T00:01:00.000Z', type: 'run.created' },
        { id: 'event-2', ts: '2026-05-01T00:02:00.000Z', type: 'effect.proposed', effect_id: 'effect-1' },
        { id: 'event-3', ts: '2026-05-01T00:03:00.000Z', type: 'verifier.completed', status: 'warning', reason: 'tests pending' },
        {
          id: 'event-4',
          ts: '2026-05-01T00:04:00.000Z',
          type: 'tool.requested',
          tool: 'capability:browser_qa',
          args: {
            capability: 'browser_qa',
            frameId: 'frame-capability-1',
            reason: 'Run screenshot QA',
            scope: { origin: 'local' },
          },
        },
        {
          id: 'event-5',
          ts: '2026-05-01T00:05:00.000Z',
          type: 'tool.requested',
          tool: 'capability:browser_qa',
          args: {
            capability: 'browser_qa',
            frameId: 'frame-capability-2',
            reason: 'Retry screenshot QA',
            scope: {
              origin: 'local',
              attempt: 2,
              token: 'github_pat_secret',
              nested: { password: 'super-secret' },
            },
          },
        },
        {
          id: 'event-6',
          ts: '2026-05-01T00:06:00.000Z',
          type: 'tool.executed',
          tool: 'capability:browser_qa',
          args: {
            capability: 'browser_qa',
            frameId: 'frame-capability-2',
          },
          status: 'granted',
        },
        {
          id: 'event-7',
          ts: '2026-05-01T00:07:00.000Z',
          type: 'tool.executed',
          tool: 'capability:browser_qa',
          args: {
            capability: 'browser_qa',
            frameId: 'frame-capability-1',
          },
          status: 'denied',
        },
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
      frames: [
        { nodeId: 'frame-node-1', frame_id: 'frame-1', type: 'tool_call', disposition: 'applied', seq: 1 },
        {
          nodeId: 'frame-node-2',
          frame_id: 'frame-2',
          type: 'request_capability',
          disposition: 'capability_denied',
          payload: { frameType: 'request_capability' },
          seq: 2,
        },
        {
          nodeId: 'frame-node-3',
          frame_id: 'frame-3',
          type: 'request_capability',
          disposition: 'capability_granted',
          payload: { frameType: 'request_capability' },
          seq: 3,
        },
      ],
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
        mailbox: { pending: 1, leased: 0, completed: 0, failed: 0, oldestPendingAgeMs: 42000 },
        budget: { profile: 'standard' },
      }],
      totals: { actors: 1, running: 1, blocked: 0, failed: 0, mailboxPending: 1, oldestPendingAgeMs: 42000 },
    });
    mockListRunResearchEvidence.mockResolvedValue({
      evidence: [{
        artifact: { id: 'research-1', kind: 'summary', sha256: 'research-sha-1', createdAt: '2026-05-01T00:07:00.000Z' },
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
    mockListRunResearchSourceCaptures.mockResolvedValue({
      captures: [],
    });
    mockRequestRunResearchSourceCapture.mockResolvedValue({
      status: 'approval_required',
      runId: 'run-1',
      approval: {
        id: 'research-source:default',
        toolName: 'research_source_capture',
        summary: 'Capture governed source',
        args: { runId: 'run-1', sourceHost: 'example.com', sourceUrlHash: 'hash', sourcePathHash: 'path-hash' },
      },
      sourceCapture: true,
    });
    mockListRunBrowserSmoke.mockResolvedValue({
      smoke: [],
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
    mockRequestRunBrowserSmoke.mockResolvedValue({
      status: 'approval_required',
      runId: 'run-1',
      approval: {
        id: 'browser-smoke:default',
        toolName: 'browser_smoke',
        summary: 'Run local browser smoke',
        args: { runId: 'run-1', targetUrlHash: 'hash', host: 'localhost:5173', pathHash: 'path-hash', fullPage: false },
      },
      browserSmoke: true,
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
    mockRecoverStuckRunActorMessages.mockResolvedValue({
      ok: true,
      recovery: { recovered: [] },
      snapshot: {
        runId: 'run-1',
        actors: [{
          actorId: 'actor-planner',
          agentId: 'planner',
          agentName: 'Planner',
          role: 'planner',
          status: 'idle',
          currentWork: null,
          outputs: ['Recovered stale lease'],
          blockers: [],
          mailbox: { pending: 1, leased: 0, completed: 0, failed: 0, stale: 0 },
          budget: { profile: 'standard' },
        }],
        totals: { actors: 1, running: 0, blocked: 0, failed: 0, mailboxPending: 1, mailboxStale: 0 },
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
        workflowCount: 1,
        adapterCount: 1,
        privacyRuleIds: ['member-private-memory'],
        toolPermissionSummaries: [],
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

  it('sanitizes memory and session timeline text in the overview', async () => {
    mockGetMemorySnapshot.mockResolvedValueOnce({
      lines: [
        'Token ghp_secret-token lives in /Users/aleksandrgrebeshok/.ssh/id_rsa',
        'password = "hunter 2"',
        'Windows key path C:\\Users\\Alice\\My Documents\\secret.txt',
        'Linux paths /home/alice/My Documents/secret.txt and cwd=/tmp/app',
        'Fine-grained token github_pat_1234567890abcdef and file://server/share/My Documents/secret.txt',
      ],
      files: [],
      workspaceFiles: {},
      daily: [],
    });
    mockListSessions.mockResolvedValueOnce({
      sessions: [{
        id: 'session-private',
        workspaceId: '/Users/aleksandrgrebeshok/pyrfor-dev',
        title: 'Secret customer path /Users/aleksandrgrebeshok/private',
        mode: 'chat',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T01:00:00.000Z',
        messageCount: 2,
        summary: 'Remember ghp_secret-token and use /help',
      }],
    });
    mockGetSessionTimeline.mockResolvedValueOnce({
      sessionId: 'session-private',
      workspaceId: '/Users/aleksandrgrebeshok/pyrfor-dev',
      summary: 'Remember ghp_secret-token and use /help',
      events: [{
        id: 'event-private',
        sessionId: 'session-private',
        type: 'message',
        role: 'user',
        content: 'Read \\\\server\\share\\My Documents\\secret.txt and use ghp_secret-token',
        createdAt: '2026-05-01T01:00:00.000Z',
        index: 0,
      }],
    });
    mockSearchMemory.mockResolvedValueOnce({
      results: [{
        id: 'memory-secret',
        content: 'Use github_pat_abcdef123456 and cwd=/tmp/app',
        memoryType: 'semantic',
        createdAt: '2026-05-01T00:00:00.000Z',
        source: 'durable',
      }],
    });
    mockCreateProjectMemoryRollup.mockResolvedValueOnce({
      rollup: {
        workspaceId: '/Users/aleksandrgrebeshok/pyrfor-dev',
        projectId: '/Users/aleksandrgrebeshok/private-project',
        agentId: 'pyrfor-runtime',
        sessionCount: 1,
        ledgerEventCount: 2,
        runIds: ['run-1'],
        memories: [{
          category: 'risk',
          memoryType: 'semantic',
          summary: 'Secret path /home/alice/project and token=github_pat_projectsecret',
          content: 'Secret path /home/alice/project',
          memoryId: 'project-memory-secret',
        }],
      },
    });
    mockCreateMemoryCorrection.mockResolvedValueOnce({
      memory: {
        id: 'memory-correction-secret',
        content: 'Corrected cwd=/tmp/app',
        memoryType: 'semantic',
        createdAt: '2026-05-01T00:00:00.000Z',
        source: 'durable',
        summary: 'Corrected token ghp_correctionsecret and path /var/tmp/private',
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText('Token [redacted-token] lives in [redacted-path]')).toBeTruthy();
      expect(screen.getByText('password=[redacted]')).toBeTruthy();
      expect(screen.getByText('Windows key path [redacted-path]')).toBeTruthy();
      expect(screen.getByText('Linux paths [redacted-path] and cwd=[redacted-path]')).toBeTruthy();
      expect(screen.getByText('Fine-grained token [redacted-token] and [redacted-file-uri]')).toBeTruthy();
      expect(screen.getByText(/Secret customer path \[redacted-path\] · chat · 2 messages/)).toBeTruthy();
      expect(screen.getByText(/Remember \[redacted-token\] and use \/help/)).toBeTruthy();
      expect(document.body.textContent || '').not.toContain('ghp_secret-token');
      expect(document.body.textContent || '').not.toContain('id_rsa');
      expect(document.body.textContent || '').not.toContain('hunter 2');
      expect(document.body.textContent || '').not.toContain('C:\\Users\\Alice');
      expect(document.body.textContent || '').not.toContain('/home/alice');
      expect(document.body.textContent || '').not.toContain('/tmp/app');
      expect(document.body.textContent || '').not.toContain('file://server/share');
      expect(document.body.textContent || '').not.toContain('github_pat_1234567890abcdef');
    });

    fireEvent.click(screen.getByRole('button', { name: /Timeline/i }));

    await waitFor(() => {
      expect(screen.getByText(/#1 · user · .* · Read \[redacted-path\] and use \[redacted-token\]/)).toBeTruthy();
      expect(document.body.textContent || '').not.toContain('/Users/aleksandrgrebeshok');
      expect(document.body.textContent || '').not.toContain('\\\\server\\share');
    });

    fireEvent.change(screen.getByPlaceholderText(/Search durable memory/i), {
      target: { value: 'secret memory' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search memory/i }));

    await waitFor(() => {
      expect(screen.getByText(/\[durable\] Use \[redacted-token\] and cwd=\[redacted-path\]/)).toBeTruthy();
      expect(document.body.textContent || '').not.toContain('github_pat_abcdef123456');
      expect(document.body.textContent || '').not.toContain('/tmp/app');
    });

    fireEvent.change(screen.getByPlaceholderText('Project ID'), {
      target: { value: 'project-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create project rollup/i }));

    await waitFor(() => {
      expect(screen.getByText(/\[redacted-path\]: 1 sessions, 2 events, 1 runs/)).toBeTruthy();
      expect(screen.getByText(/risk · Secret path \[redacted-path\] and token=\[redacted\] · project-memory-secret/)).toBeTruthy();
      expect(document.body.textContent || '').not.toContain('github_pat_projectsecret');
      expect(document.body.textContent || '').not.toContain('/home/alice/project');
    });

    fireEvent.change(screen.getByPlaceholderText(/Correction summary/i), {
      target: { value: 'safe correction' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Corrected durable memory fact/i), {
      target: { value: 'safe correction content' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save correction/i }));

    await waitFor(() => {
      expect(screen.getByText(/Saved: Corrected token \[redacted-token\] and path \[redacted-path\]/)).toBeTruthy();
      expect(document.body.textContent || '').not.toContain('ghp_correctionsecret');
      expect(document.body.textContent || '').not.toContain('/var/tmp/private');
    });
  });

  it('renders local-only connector doctor inventory', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetConnectorInventory).toHaveBeenCalled();
      expect(screen.getByText('Connector doctor')).toBeTruthy();
      expect(screen.getByText('1/2 configured')).toBeTruthy();
      expect(screen.getByText((_, element) => (
        element?.className === 'orchestration-summary-card'
        && element.textContent === 'Live probes skipped2'
      ))).toBeTruthy();
      expect(screen.getByText('local-config')).toBeTruthy();
      const githubDrilldown = screen.getByTestId('connector-drilldown-github');
      expect(githubDrilldown.textContent || '').toContain('GitHub integration');
      expect(githubDrilldown.textContent || '').toContain('Operations: Create draft PR');
      expect(githubDrilldown.textContent || '').toContain('Credential env names: GITHUB_TOKEN (required)');
      expect(githubDrilldown.textContent || '').toContain('API surface: POST');
      const telegramDrilldown = screen.getByTestId('connector-drilldown-telegram');
      expect(telegramDrilldown.textContent || '').toContain('Telegram');
      expect(telegramDrilldown.textContent || '').toContain('pending');
      expect(telegramDrilldown.textContent || '').toContain('Readiness: Missing required env: TELEGRAM_BOT_TOKEN');
      expect(telegramDrilldown.textContent || '').toContain('Next step: Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor');
      expect(githubDrilldown.textContent || '').toContain('Probe preview: descriptor-status · approval required');
      expect(githubDrilldown.textContent || '').toContain('Probe note: Live status comes from the connector adapter and is not executed by inventory');
      expect(screen.getAllByText(/live probes skipped/).length).toBeGreaterThan(0);
    });
  });

  it('sanitizes connector doctor preview text before rendering', async () => {
    mockGetConnectorInventory.mockResolvedValueOnce({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      summary: { total: 1, configured: 0, pending: 1, stubs: 0, liveProbeSkipped: 1 },
      connectors: [{
        id: 'github',
        name: 'GitHub',
        description: 'GitHub integration',
        direction: 'outbound',
        sourceSystem: 'GitHub API',
        operations: ['Create draft PR'],
        credentials: [{ envVar: 'GITHUB_TOKEN', description: 'GitHub token' }],
        apiSurface: [{ method: 'POST', path: '/api/github', description: 'GitHub actions' }],
        stub: false,
        configured: false,
        missingSecrets: ['GITHUB_TOKEN'],
        hasProbe: true,
        readiness: {
          state: 'pending',
          reasons: ['Config file /Users/alice/private/config.json contains token=github_pat_connectorsecret'],
          nextStep: 'Open /Users/alice/private and set password="do not show"',
        },
        probePreview: {
          mode: 'manifest-http',
          method: 'GET',
          path: '/v1/check?token=super-secret',
          baseUrlEnvVar: 'GITHUB_API_BASE_URL',
          authEnvVar: 'GITHUB_TOKEN',
          authHeaderName: 'Authorization',
          expectedStatus: 200,
          expectation: 'json-object',
          requiresApproval: true,
          requiredEnvVars: ['GITHUB_TOKEN'],
          headerNames: ['Authorization'],
          bodyConfigured: false,
          note: 'Open /Users/alice/private/config.env with token=github_pat_connectorsecret',
        },
        liveProbeSkipped: true,
        statusSource: 'local-config',
      }],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => {
      const githubDrilldown = screen.getByTestId('connector-drilldown-github');
      expect(githubDrilldown.textContent || '').toContain('Readiness: Config file [redacted-path] contains token=[redacted]');
      expect(githubDrilldown.textContent || '').toContain('Next step: Open [redacted-path] and set password=[redacted]');
      expect(githubDrilldown.textContent || '').toContain('Probe preview: manifest-http · approval required · GET [redacted-path]');
      expect(githubDrilldown.textContent || '').toContain('base URL env GITHUB_API_BASE_URL');
      expect(githubDrilldown.textContent || '').toContain('auth env GITHUB_TOKEN');
      expect(githubDrilldown.textContent || '').toContain('auth header Authorization');
      expect(githubDrilldown.textContent || '').toContain('expects 200');
      expect(githubDrilldown.textContent || '').toContain('expectation json-object');
      expect(githubDrilldown.textContent || '').toContain('Probe note: Open [redacted-path] with token=[redacted]');
      expect(document.body.textContent || '').not.toContain('github_pat_connectorsecret');
      expect(document.body.textContent || '').not.toContain('/Users/alice/private');
      expect(document.body.textContent || '').not.toContain('super-secret');
    });
  });

  it('renders read-only skill inspector and recommends skills on request', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetSkills).toHaveBeenCalled();
      expect(mockGetSlashCommands).toHaveBeenCalled();
      expect(screen.getByText('Skill inspector')).toBeTruthy();
      expect(screen.getByText('hash-only')).toBeTruthy();
      expect(screen.getByText('Slash commands')).toBeTruthy();
      expect(screen.getByText(/\/skills · auto_allow · List or recommend governed skills/)).toBeTruthy();
      expect(screen.getByText(/args: task/)).toBeTruthy();
      expect(screen.getByText('Debug')).toBeTruthy();
      expect(screen.getByText(/prompt hash: aaaaaaaaaaaa/)).toBeTruthy();
    });
    expect(mockRecommendSkills).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Run \/skills/i }));

    await waitFor(() => {
      expect(mockInvokeSlashCommand).toHaveBeenCalledWith({
        command: '/skills "Fix a TypeScript error" --limit=5',
      });
      expect(screen.getByText('/skills output')).toBeTruthy();
      expect(screen.getByText(/Recommended skills for "Fix a TypeScript error": debug/)).toBeTruthy();
    });

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

  it('renders live runtime subagent inventory from the engine', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetAgents).toHaveBeenCalled();
      expect(screen.getByText('Runtime subagents')).toBeTruthy();
      expect(screen.getByText('Live subagents')).toBeTruthy();
      expect(screen.getByText(/Research OpenClaw migration · running · started/)).toBeTruthy();
      expect(screen.getByText(/Review connector manifests · completed · started/)).toBeTruthy();
    });
  });

  it('shows slash command invoke errors in the skill inspector', async () => {
    mockInvokeSlashCommand.mockResolvedValueOnce({
      ok: false,
      error: 'slash_command_not_exposed',
    });
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText('Skill inspector')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Run \/skills/i }));

    await waitFor(() => {
      expect(screen.getByText(/Slash command failed: slash_command_not_exposed/)).toBeTruthy();
    });
  });

  it('disables /skills invocation when the slash command is not exposed', async () => {
    mockGetSlashCommands.mockResolvedValueOnce({ commands: [] });
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText('No auto-allow slash commands exposed.')).toBeTruthy();
      expect(screen.getByText('/skills is not currently exposed by the governed slash command registry.')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Run \/skills/i })).toHaveProperty('disabled', true);
    });

    fireEvent.click(screen.getByRole('button', { name: /Run \/skills/i }));
    expect(mockInvokeSlashCommand).not.toHaveBeenCalled();
  });

  it('does not label /skills as unexposed when slash command registry loading fails', async () => {
    mockGetSlashCommands.mockRejectedValueOnce(new Error('registry offline'));
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Slash commands unavailable: Error: registry offline/)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Run \/skills/i })).toHaveProperty('disabled', true);
    });

    expect(screen.queryByText('No auto-allow slash commands exposed.')).toBeNull();
    expect(screen.queryByText('/skills is not currently exposed by the governed slash command registry.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Run \/skills/i }));
    expect(mockInvokeSlashCommand).not.toHaveBeenCalled();
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
    let onEvent: ((event: { type: 'snapshot'; approvals?: Array<{ id: string }> }) => void) | undefined;
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });
    mockProbeConnector
      .mockResolvedValueOnce({
        status: 'approval_required',
        connectorId: 'github',
        approval: {
          id: 'connector-live-probe:github',
          toolName: 'connector_live_probe',
          summary: 'Run live connector probe for GitHub',
          args: { connectorId: 'github', connectorName: 'GitHub', sourceSystem: 'GitHub API' },
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
      expect(screen.getByText('Connector: GitHub')).toBeTruthy();
      expect(screen.getByText('Source: GitHub API')).toBeTruthy();
      expect(screen.getByText('Action: live connector probe requires explicit approval.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);

    onEvent?.({ type: 'snapshot', approvals: [{ id: 'connector-live-probe:github' }] });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);
    });

    onEvent?.({ type: 'snapshot', approvals: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: /Run approved probe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Run approved probe/i }));

    await waitFor(() => {
      expect(mockProbeConnector).toHaveBeenCalledWith('github', { approvalId: 'connector-live-probe:github' });
      const githubProbeRow = screen.getByTestId('connector-drilldown-github');
      expect(githubProbeRow.textContent || '').toContain('Live status: ok');
      expect(githubProbeRow.textContent || '').toContain('GitHub probe succeeded.');
      expect(githubProbeRow.textContent).not.toContain('live probes skipped');
    });
  });

  it('rehydrates pending connector probe approval from Trust state on refresh', async () => {
    mockListPendingApprovals.mockResolvedValueOnce({
      approvals: [{
        id: 'connector-live-probe:github',
        toolName: 'connector_live_probe',
        summary: 'Run live connector probe for GitHub',
        args: { connectorId: 'github', connectorName: 'GitHub', sourceSystem: 'GitHub API' },
      }],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Approval pending: connector-live-probe:github/)).toBeTruthy();
      expect(screen.getByText('Connector: GitHub')).toBeTruthy();
      expect(screen.getByText('Source: GitHub API')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);
    });
    expect(mockProbeConnector).not.toHaveBeenCalled();
  });

  it('creates project memory rollups from memory continuity', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Memory continuity')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Project ID'), { target: { value: 'project-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Create project rollup/i }));

    await waitFor(() => {
      expect(mockCreateProjectMemoryRollup).toHaveBeenCalledWith({ projectId: 'project-1', sessionLimit: 200 });
      expect(screen.getByText(/project-1: 2 sessions, 3 events, 1 runs/)).toBeTruthy();
      expect(screen.getByText(/decision · Decisions for project project-1/)).toBeTruthy();
      expect(screen.getByText(/risk · Risks for project project-1/)).toBeTruthy();
    });
  });

  it('renders read-only memory continuity doctor status on load', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetMemoryContinuity).toHaveBeenCalledWith({});
      expect(screen.getByText('Continuity doctor')).toBeTruthy();
      expect(screen.getByText(/Workspace memory files: 1\/2 · missing SOUL\.md/)).toBeTruthy();
      expect(screen.getByText(/Daily rollup: ok · 2026-05-01 · daily-rollup-1/)).toBeTruthy();
      expect(screen.getByText('Daily rollup artifact: daily-rollup-1')).toBeTruthy();
      expect(screen.getByText('Daily rollup SHA-256: daily-sha')).toBeTruthy();
      expect(screen.getByText(/Project rollup: not configured/)).toBeTruthy();
      expect(screen.getByText(/OpenClaw report: ok · openclaw-report-1 · 1 importable/)).toBeTruthy();
      expect(screen.getByText('OpenClaw report artifact: openclaw-report-1')).toBeTruthy();
      expect(screen.getByText('OpenClaw report SHA-256: openclaw-sha')).toBeTruthy();
      expect(screen.getAllByText(/created:/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/Warnings: memory_files_missing, no_project_id/)).toBeTruthy();
    });
  });

  it('shows latest OpenClaw migration report without starting a new scan', async () => {
    mockGetOpenClawImportReport.mockResolvedValueOnce({
      artifact: {
        id: 'openclaw-report-latest',
        kind: 'summary',
        uri: 'memory://openclaw-report-latest',
        sha256: 'latest-sha',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      report: {
        schemaVersion: 'openclaw_migration_report.v1',
        generatedAt: '2026-05-01T00:00:00.000Z',
        workspaceId: 'workspace-1',
        sourceRoot: '/Users/aleksandrgrebeshok/openclaw-workspace',
        counts: { importable: 4, skipped: 1, personality: 1, memories: 2, skills: 1, redactions: 3 },
        entries: [],
        skipped: [{ sourceRelPath: '/home/alice/config/secrets.env', reason: 'sensitive config skipped' }],
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetOpenClawImportReport).toHaveBeenCalledTimes(1);
      expect(mockCreateOpenClawImportReport).not.toHaveBeenCalled();
      expect(screen.getByText('Latest reviewed report')).toBeTruthy();
      expect(screen.getByText('Artifact: openclaw-report-latest')).toBeTruthy();
      expect(screen.getByText('SHA-256: latest-sha')).toBeTruthy();
      expect(screen.getByText('Project scope: workspace')).toBeTruthy();
      expect(screen.getByText('Source: [redacted-path]')).toBeTruthy();
      expect(screen.getByText('Counts: 4 importable, 1 skipped, 3 redactions')).toBeTruthy();
      expect(screen.getByText('Skipped: [redacted-path] · sensitive config skipped')).toBeTruthy();
      expect(document.body.textContent || '').not.toContain('/Users/aleksandrgrebeshok/openclaw-workspace');
      expect(document.body.textContent || '').not.toContain('/home/alice/config');
    });

    fireEvent.click(screen.getByRole('button', { name: /Import approved report/i }));

    await waitFor(() => {
      expect(mockCreateOpenClawImportReport).not.toHaveBeenCalled();
      expect(mockImportOpenClawMemory).toHaveBeenCalledWith({
        reportArtifactId: 'openclaw-report-latest',
        expectedReportSha256: 'latest-sha',
      });
      expect(screen.getByText(/Imported 0 memory entries; skipped 0/)).toBeTruthy();
    });
  });

  it('shows an empty latest OpenClaw migration report state on 404', async () => {
    mockGetMemoryContinuity.mockResolvedValueOnce({
      workspaceId: '/workspace',
      generatedAt: '2026-05-01T00:00:00.000Z',
      workspaceFiles: {
        present: 1,
        total: 2,
        missing: ['SOUL.md'],
        files: {
          'MEMORY.md': { present: true, lineCount: 1 },
          'SOUL.md': { present: false, lineCount: 0 },
        },
      },
      latestDailyRollup: { status: 'ok', date: '2026-05-01', artifact: { id: 'daily-rollup-1', kind: 'summary', sha256: 'daily-sha', createdAt: '2026-05-01T00:00:00.000Z' } },
      latestProjectRollup: { status: 'not_configured' },
      latestOpenClawReport: { status: 'missing' },
      warnings: ['memory_files_missing', 'no_project_id'],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetOpenClawImportReport).toHaveBeenCalledTimes(1);
      expect(screen.getByText('No reviewed OpenClaw import report yet.')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Import approved report/i })).toHaveProperty('disabled', true);
    });
  });

  it('imports OpenClaw report from continuity doctor when latest report details are unavailable', async () => {
    mockGetMemoryContinuity.mockResolvedValue({
      workspaceId: '/workspace',
      projectId: 'project-1',
      generatedAt: '2026-05-01T00:00:00.000Z',
      workspaceFiles: {
        present: 1,
        total: 2,
        missing: ['SOUL.md'],
        files: {
          'MEMORY.md': { present: true, lineCount: 1 },
          'SOUL.md': { present: false, lineCount: 0 },
        },
      },
      latestDailyRollup: { status: 'ok', date: '2026-05-01', artifact: { id: 'daily-rollup-1', kind: 'summary', sha256: 'daily-sha', createdAt: '2026-05-01T00:00:00.000Z' } },
      latestProjectRollup: { status: 'not_configured' },
      latestOpenClawReport: {
        status: 'ok',
        artifact: { id: 'continuity-openclaw-report', kind: 'summary', sha256: 'continuity-sha', createdAt: '2026-05-01T00:00:00.000Z' },
        createdAt: '2026-05-01T00:00:00.000Z',
        projectId: 'project-1',
        counts: { importable: 3, skipped: 1, personality: 1, memories: 1, skills: 1, redactions: 2 },
      },
      warnings: [],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(mockGetOpenClawImportReport).toHaveBeenCalledWith({}));
    fireEvent.change(screen.getByPlaceholderText('Project ID'), { target: { value: 'project-1' } });

    await waitFor(() => {
      expect(screen.getByText('Continuity doctor reviewed report')).toBeTruthy();
      expect(screen.getByText('Artifact: continuity-openclaw-report')).toBeTruthy();
      expect(screen.getByText('SHA-256: continuity-sha')).toBeTruthy();
      expect(screen.getByText('Project scope: project-1')).toBeTruthy();
      expect(screen.getByText('Counts: 3 importable, 1 skipped, 2 redactions')).toBeTruthy();
      expect(screen.getByText('Details unavailable; using continuity doctor artifact.')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Import approved report/i })).toHaveProperty('disabled', false);
    });

    fireEvent.click(screen.getByRole('button', { name: /Import approved report/i }));

    await waitFor(() => {
      expect(mockImportOpenClawMemory).toHaveBeenCalledWith({
        reportArtifactId: 'continuity-openclaw-report',
        expectedReportSha256: 'continuity-sha',
        projectId: 'project-1',
      });
    });
  });

  it('uses project scope for OpenClaw latest report, preview, and import', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(mockGetOpenClawImportReport).toHaveBeenCalledWith({}));
    mockGetOpenClawImportReport.mockClear();
    mockCreateOpenClawImportReport.mockClear();
    mockImportOpenClawMemory.mockClear();

    fireEvent.change(screen.getByPlaceholderText('Project ID'), { target: { value: 'project-1' } });
    await waitFor(() => expect(mockGetOpenClawImportReport).toHaveBeenCalledWith({ projectId: 'project-1' }));

    fireEvent.click(screen.getByRole('button', { name: /Preview OpenClaw import/i }));
    await waitFor(() => {
      expect(mockCreateOpenClawImportReport).toHaveBeenCalledWith({
        includePersonality: true,
        includeMemories: true,
        projectId: 'project-1',
      });
      expect(screen.getAllByText('Project scope: project-1').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /Import approved report/i }));
    await waitFor(() => {
      expect(mockImportOpenClawMemory).toHaveBeenCalledWith({
        reportArtifactId: 'openclaw-report-1',
        expectedReportSha256: 'sha',
        projectId: 'project-1',
      });
    });
  });

  it('blocks OpenClaw import when the current project differs from the previewed report', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(mockGetOpenClawImportReport).toHaveBeenCalledWith({}));
    mockCreateOpenClawImportReport.mockClear();
    mockImportOpenClawMemory.mockClear();

    fireEvent.change(screen.getByPlaceholderText('Project ID'), { target: { value: 'project-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview OpenClaw import/i }));
    await waitFor(() => expect(mockCreateOpenClawImportReport).toHaveBeenCalledWith({
      includePersonality: true,
      includeMemories: true,
      projectId: 'project-1',
    }));

    fireEvent.change(screen.getByPlaceholderText('Project ID'), { target: { value: 'project-2' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import approved report/i })).toHaveProperty('disabled', true);
      expect(screen.getByText(/Preview scope differs from the current project/i)).toBeTruthy();
    });
    expect(mockImportOpenClawMemory).not.toHaveBeenCalled();
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
      expect(mockGetRunProductFactoryPlan).toHaveBeenCalledWith('run-1');
      expect(mockListRunEvents).toHaveBeenCalledWith('run-1');
      expect(mockListRunDag).toHaveBeenCalledWith('run-1');
      expect(mockListRunFrames).toHaveBeenCalledWith('run-1');
      expect(mockListRunActors).toHaveBeenCalledWith('run-1', { staleAfterMs: 60000 });
      expect(mockListRunResearchEvidence).toHaveBeenCalledWith('run-1');
      expect(mockListRunBrowserSmoke).toHaveBeenCalledWith('run-1');
      expect(mockGetRunDeliveryEvidence).toHaveBeenCalledWith('run-1');
      expect(mockGetRunGithubDeliveryPlan).toHaveBeenCalledWith('run-1');
      expect(mockGetRunVerifierStatus).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('run.created')).toBeTruthy();
      expect(screen.getByText('workflow.step')).toBeTruthy();
      expect(screen.getByText('Persisted Product Factory plan')).toBeTruthy();
      expect(screen.getByText('plan artifact: product-plan-1')).toBeTruthy();
      expect(screen.getByText('tool_call')).toBeTruthy();
      expect(screen.getAllByText('browser_qa').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('reason: Run screenshot QA')).toBeTruthy();
      expect(screen.getByText('reason: Retry screenshot QA')).toBeTruthy();
      expect(screen.getByText('scope: {"origin":"local"}')).toBeTruthy();
      expect(screen.getByText('scope: {"origin":"local","attempt":2,"token":"[redacted]","nested":{"password":"[redacted]"}}')).toBeTruthy();
      expect(screen.queryByText(/github_pat_secret|super-secret/)).toBeNull();
      expect(screen.getByText('reason: Run screenshot QA').closest('article')?.textContent).toContain('denied');
      expect(screen.getByText('reason: Retry screenshot QA').closest('article')?.textContent).toContain('granted');
      expect(screen.getByText('Planner')).toBeTruthy();
      expect(screen.getByText('Totals: 1 actors · 1 running · 0 blocked · 0 failed · 1 mailbox pending · oldest pending 42s')).toBeTruthy();
      expect(screen.getByText(/mailbox: 1 pending · 0 leased · oldest pending 42s/)).toBeTruthy();
      expect(screen.getByText('output: Actor proof recorded')).toBeTruthy();
      expect(screen.getByText('OpenClaw memory reliability')).toBeTruthy();
      expect(screen.getByText('Research source')).toBeTruthy();
      expect(screen.getByText('Evidence artifact: research-1')).toBeTruthy();
      expect(screen.getByText('Evidence SHA-256: research-sha-1')).toBeTruthy();
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

  it('clears delivery and verifier state immediately when switching runs', async () => {
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
        {
          run_id: 'run-2',
          task_id: 'Review second run',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'running',
          artifact_refs: [],
          created_at: '2026-05-01T00:10:00.000Z',
          updated_at: '2026-05-01T00:15:00.000Z',
        },
      ],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Apply GitHub delivery')).toBeTruthy());

    let resolveRun2: ((value: unknown) => void) | undefined;
    mockGetRun.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRun2 = resolve;
    }));
    mockGetRunGithubDeliveryPlan.mockResolvedValueOnce({ artifact: null, plan: null });
    mockGetRunGithubDeliveryApply.mockResolvedValueOnce({ artifact: null, result: null });
    mockGetRunVerifierStatus.mockResolvedValueOnce({ decision: null });

    fireEvent.click(screen.getByRole('button', { name: /Review second run/i }));

    await waitFor(() => {
      expect(screen.getByText('Select a run to inspect events and DAG nodes.')).toBeTruthy();
      expect(screen.queryByText('Apply GitHub delivery')).toBeNull();
      expect(screen.queryByText('Verifier passed — delivery actions are available.')).toBeNull();
    });
    resolveRun2?.({
      run: {
        run_id: 'run-2',
        task_id: 'Review second run',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'running',
        artifact_refs: [],
        created_at: '2026-05-01T00:10:00.000Z',
        updated_at: '2026-05-01T00:15:00.000Z',
      },
    });
    await Promise.resolve();
  });

  it('ignores in-flight delivery plan results after switching runs', async () => {
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
        {
          run_id: 'run-2',
          task_id: 'Review second run',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'running',
          artifact_refs: [],
          created_at: '2026-05-01T00:10:00.000Z',
          updated_at: '2026-05-01T00:15:00.000Z',
        },
      ],
    });
    let resolvePlan: ((value: unknown) => void) | undefined;
    mockCreateRunGithubDeliveryPlan.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePlan = resolve;
    }));
    mockGetRunGithubDeliveryPlan.mockResolvedValueOnce({ artifact: null, plan: null });
    mockGetRunGithubDeliveryApply.mockResolvedValueOnce({ artifact: null, result: null });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Plan GitHub delivery/i })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: /Plan GitHub delivery/i }));
    await waitFor(() => expect(mockCreateRunGithubDeliveryPlan).toHaveBeenCalledWith('run-1', {}));

    mockGetRun.mockResolvedValueOnce({
      run: {
        run_id: 'run-2',
        task_id: 'Review second run',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'running',
        artifact_refs: [],
        created_at: '2026-05-01T00:10:00.000Z',
        updated_at: '2026-05-01T00:15:00.000Z',
      },
    });
    mockGetRunGithubDeliveryPlan.mockResolvedValueOnce({ artifact: null, plan: null });
    fireEvent.click(screen.getByRole('button', { name: /Review second run/i }));
    resolvePlan?.({
      artifact: { id: 'stale-plan', kind: 'delivery_plan', createdAt: '2026-05-01T00:20:00.000Z', sha256: 'stale-sha' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:20:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: true,
        approvalRequired: true,
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: '1234567890abcdef',
        proposedBranch: 'stale/old-run',
        pullRequest: { title: 'Stale delivery plan', body: 'No writes', draft: true },
        ci: { observeWorkflowRuns: [] },
        blockers: [],
        evidenceArtifactId: 'artifact-evidence',
      },
    });

    await waitFor(() => expect(screen.getByText('run-2')).toBeTruthy());
    expect(screen.queryByText('stale/old-run')).toBeNull();
    expect(screen.queryByText('Stale delivery plan')).toBeNull();
  });

  it('requests and runs approval-gated governed research search for the selected run', async () => {
    let onEvent: ((event: { type: 'snapshot'; approvals?: Array<{ id: string }> }) => void) | undefined;
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });
    mockRequestRunResearchSearch
      .mockResolvedValueOnce({
        status: 'approval_required',
        runId: 'run-1',
        approval: {
          id: 'research-search:abc',
          toolName: 'research_live_search',
          summary: 'Run governed web search for run-1',
          args: { runId: 'run-1', queryHash: 'query-hash-1', provider: 'duckduckgo', maxResults: 5 },
        },
        liveSearch: true,
      })
      .mockResolvedValueOnce({
        status: 'captured',
        artifact: { id: 'research-2', kind: 'summary', sha256: 'research-sha-2', createdAt: '2026-05-01T00:08:00.000Z' },
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
    fireEvent.change(screen.getByLabelText(/Search provider/i), {
      target: { value: 'duckduckgo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request live search/i }));

    await waitFor(() => {
      expect(mockRequestRunResearchSearch).toHaveBeenCalledWith('run-1', {
        query: 'Pyrfor memory reliability',
        maxResults: 5,
        provider: 'duckduckgo',
      });
      expect(screen.getByText(/Approval pending: research-search:abc/)).toBeTruthy();
      expect(screen.getByText('Run: run-1')).toBeTruthy();
      expect(screen.getByText('Query hash: query-hash-1')).toBeTruthy();
      expect(screen.getByText('Provider: duckduckgo')).toBeTruthy();
      expect(screen.getByText('Max results: 5')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);

    onEvent?.({ type: 'snapshot', approvals: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: /Run approved search/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Run approved search/i }));

    await waitFor(() => {
      expect(mockRequestRunResearchSearch).toHaveBeenCalledWith('run-1', {
        query: 'Pyrfor memory reliability',
        maxResults: 5,
        provider: 'duckduckgo',
        approvalId: 'research-search:abc',
      });
      expect(screen.getByText('Search result')).toBeTruthy();
      expect(screen.getByText('effect: web_search/brave')).toBeTruthy();
      expect(screen.getByText('Evidence artifact: research-2')).toBeTruthy();
      expect(screen.getByText('Evidence SHA-256: research-sha-2')).toBeTruthy();
      expect(screen.getByText('Evidence approvals: research-search:abc')).toBeTruthy();
      expect(mockRefreshRunContextPack).toHaveBeenCalledWith('run-1');
    });
  });

  it('rehydrates pending governed research approval for the selected run', async () => {
    mockListPendingApprovals.mockResolvedValueOnce({
      approvals: [{
        id: 'research-search:abc',
        toolName: 'research_live_search',
        summary: 'Run governed web search for run-1',
        args: { runId: 'run-1', queryHash: 'query-hash-1', provider: 'brave', maxResults: 5 },
      }],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText(/Approval pending: research-search:abc/)).toBeTruthy();
      expect(screen.getByText('Run: run-1')).toBeTruthy();
      expect(screen.getByText('Query hash: query-hash-1')).toBeTruthy();
      expect(screen.getByText('Provider: brave')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);
    });

    fireEvent.change(screen.getByLabelText(/Search provider/i), {
      target: { value: 'duckduckgo' },
    });

    await waitFor(() => {
      expect(screen.queryByText(/Approval pending: research-search:abc/)).toBeNull();
      expect(screen.getByRole('button', { name: /Request live search/i })).toBeTruthy();
    });
    expect(mockRequestRunResearchSearch).not.toHaveBeenCalled();
  });

  it('shows local-only governed research readiness before requesting search approval', async () => {
    mockGetResearchReadiness.mockResolvedValueOnce({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'unavailable',
      defaultProvider: null,
      configuredProvider: null,
      allowedProviders: ['brave', 'duckduckgo'],
      reasons: ['ResearchSearch: BRAVE_API_KEY is required for governed search, or set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo'],
      nextStep: 'Set BRAVE_API_KEY or PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo before requesting governed search.',
      providers: [
        {
          provider: 'brave',
          configured: false,
          missingEnv: ['BRAVE_API_KEY'],
          readiness: {
            state: 'pending',
            reasons: ['Missing required env: BRAVE_API_KEY'],
            nextStep: 'Set BRAVE_API_KEY or choose DuckDuckGo as the governed search provider.',
          },
        },
        {
          provider: 'duckduckgo',
          configured: true,
          missingEnv: [],
          readiness: {
            state: 'configured',
            reasons: ['DuckDuckGo governed search requires no local credential env vars.'],
            nextStep: 'Set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo or select DuckDuckGo for an individual search.',
          },
        },
      ],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(mockGetResearchReadiness).toHaveBeenCalled();
      expect(screen.getByText('Governed search readiness is local-config only. No web/search request runs until Trust approval is resolved.')).toBeTruthy();
      expect(screen.getByText('ResearchSearch: BRAVE_API_KEY is required for governed search, or set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo')).toBeTruthy();
      expect(screen.getByText('missing env: BRAVE_API_KEY')).toBeTruthy();
      expect(screen.getByText('DuckDuckGo governed search requires no local credential env vars.')).toBeTruthy();
    });
    expect(mockRequestRunResearchSearch).not.toHaveBeenCalled();
  });

  it('shows local-only Browser QA readiness without launching browser actions', async () => {
    mockGetBrowserReadiness.mockResolvedValueOnce({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'unavailable',
      browserTool: { name: 'browser', available: true, actions: ['screenshot', 'extract'] },
      playwright: {
        packageName: 'playwright',
        installed: false,
        chromiumInstalled: false,
        installHint: 'Install Playwright and Chromium with: pnpm add -w playwright @playwright/browsers && pnpm exec playwright install chromium',
      },
      permission: { toolName: 'browser_navigate', permissionClass: 'ask_once', sideEffect: 'network' },
      reasons: ['Playwright package is not installed for Browser QA.'],
      nextStep: 'Install missing local Browser QA prerequisites before requesting browser smoke approval.',
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(mockGetBrowserReadiness).toHaveBeenCalled();
      expect(screen.getByText('Browser QA readiness is local-config only. No browser launch, navigation, screenshot or network probe runs from this snapshot.')).toBeTruthy();
      expect(screen.getByText('Playwright package is not installed for Browser QA.')).toBeTruthy();
      expect(screen.getByText(/Install: Install Playwright and Chromium/)).toBeTruthy();
      expect(screen.getByText('permission tool: browser_navigate (network)')).toBeTruthy();
    });
    expect(mockRequestRunResearchSearch).not.toHaveBeenCalled();
    expect(mockCreateRunGithubDeliveryPlan).not.toHaveBeenCalled();
  });

  it('shows local-only release readiness without running release side effects', async () => {
    mockGetReleaseReadiness.mockResolvedValueOnce({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'unavailable',
      secrets: [
        { name: 'APPLE_SIGNING_IDENTITY', configured: false },
        { name: 'TAURI_SIGNING_PRIVATE_KEY', configured: true },
      ],
      artifacts: [
        { name: 'pyrfor-daemon-aarch64-apple-darwin', present: false },
      ],
      contracts: [
        { id: 'tauri-updater-active', passed: true, description: 'Tauri updater is active' },
        { id: 'sidecar-launcher-daemon', passed: false, description: 'sidecar launcher defaults to daemon without host dylib fallbacks' },
      ],
      reasons: ['Release secret env is missing: APPLE_SIGNING_IDENTITY.'],
      nextStep: 'Set missing release secrets, build sidecar artifacts, and refresh Release readiness before tagging.',
    });

    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(mockGetReleaseReadiness).toHaveBeenCalled();
      expect(screen.getByText('Release readiness is local-config only. No release check, build, signing, notarization, network call or live probe runs from this snapshot.')).toBeTruthy();
      expect(screen.getAllByText('1/2 configured').length).toBeGreaterThan(0);
      expect(screen.getAllByText('0/1 present').length).toBeGreaterThan(0);
      expect(screen.getByText('failed contracts: sidecar-launcher-daemon')).toBeTruthy();
      expect(screen.getByText('Release secret env is missing: APPLE_SIGNING_IDENTITY.')).toBeTruthy();
      expect(screen.getByText('Next step: Set missing release secrets, build sidecar artifacts, and refresh Release readiness before tagging.')).toBeTruthy();
    });
    expect(mockCreateProductFactoryRun).not.toHaveBeenCalled();
    expect(mockCreateRunGithubDeliveryPlan).not.toHaveBeenCalled();
  });

  it('shows local-only GitHub delivery readiness before plan or apply actions', async () => {
    mockGetGithubDeliveryReadiness.mockResolvedValueOnce({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'unavailable',
      tokenConfigured: false,
      tokenEnvVar: null,
      git: { available: true, branch: 'main', headSha: 'abcdef1234567890', dirtyFileCount: 2 },
      github: { repository: 'acme/pyrfor', remoteConfigured: true },
      reasons: ['GitHub token env is missing: set PYRFOR_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN.', 'Workspace has 2 dirty file(s).'],
      nextStep: 'Set the missing local Git/GitHub prerequisites before planning or applying delivery.',
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(mockGetGithubDeliveryReadiness).toHaveBeenCalled();
      expect(screen.getByText('GitHub delivery readiness is local-config only. No GitHub API call, push or PR write runs from this snapshot.')).toBeTruthy();
      expect(screen.getByText('GitHub token env is missing: set PYRFOR_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN.')).toBeTruthy();
      expect(screen.getByText('Workspace has 2 dirty file(s).')).toBeTruthy();
      expect(screen.getByText('dirty files: 2')).toBeTruthy();
    });
    const readinessCard = screen.getByText('GitHub delivery readiness is local-config only. No GitHub API call, push or PR write runs from this snapshot.');
    const planButton = screen.getByRole('button', { name: /Plan GitHub delivery/i });
    expect(readinessCard.compareDocumentPosition(planButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mockCreateRunGithubDeliveryPlan).not.toHaveBeenCalled();
    expect(mockRequestRunGithubDeliveryApply).not.toHaveBeenCalled();
  });

  it('rehydrates CEOClaw approval context and finalizes only after Trust resolution', async () => {
    let onEvent: ((event: { type: string; approvals?: unknown[]; request?: unknown; decision?: string }) => void) | undefined;
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });
    const ceoclawApproval = {
      id: 'ceoclaw-business-brief:run-1',
      toolName: 'ceoclaw_business_brief_approval',
      summary: 'Approve CEOClaw brief for ceoclaw',
      run_id: 'run-1',
      args: {
        runId: 'run-1',
        projectId: 'ceoclaw',
        decision: 'Approve Q2 pricing brief',
        evidenceRefs: ['memory://private-ref-token-1', 'https://secret.example.com/evidence?token=hidden'],
        evidenceArtifactId: 'ceoclaw-evidence-1',
        deadline: '2026-05-05T12:00:00.000Z',
      },
    };
    mockListPendingApprovals.mockResolvedValueOnce({ approvals: [ceoclawApproval] });
    mockListRunEvents.mockResolvedValue({
      events: [
        {
          id: 'event-ceoclaw-request',
          seq: 10,
          ts: '2026-05-01T00:04:00.000Z',
          type: 'approval.requested',
          tool: 'ceoclaw_business_brief_approval',
          approval_id: 'ceoclaw-business-brief:run-1',
          reason: 'CEOClaw approval required',
          args: ceoclawApproval.args,
        },
      ],
    });
    mockListAuditEvents.mockResolvedValue({
      events: [
        {
          id: 'ceoclaw-business-brief:run-1:approval.approved:1',
          ts: '2026-05-01T00:05:00.000Z',
          type: 'approval.approved',
          requestId: 'ceoclaw-business-brief:run-1',
          toolName: 'ceoclaw_business_brief_approval',
          summary: ceoclawApproval.summary,
          args: ceoclawApproval.args,
        },
      ],
    });
    mockGetRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'blocked',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    });
    mockControlRun.mockResolvedValueOnce({ ok: true, action: 'execute', run: { run_id: 'run-1', status: 'running' } });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText(/CEOClaw approval pending: ceoclaw-business-brief:run-1/)).toBeTruthy();
      expect(screen.getByText('Project: ceoclaw')).toBeTruthy();
      expect(screen.getByText('Decision: Approve Q2 pricing brief')).toBeTruthy();
      expect(screen.getByText('Evidence refs: 2')).toBeTruthy();
      expect(screen.getByText('Evidence artifact: ceoclaw-evidence-1')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);
      expect(screen.queryByText(/private-ref-token-1|secret\.example|token=hidden/)).toBeNull();
    });

    onEvent?.({ type: 'approval-resolved', request: ceoclawApproval, decision: 'approve' });

    await waitFor(() => {
      expect(screen.getByText(/CEOClaw approval resolved: ceoclaw-business-brief:run-1/)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Finalize CEOClaw approval/i })).toHaveProperty('disabled', false);
    });
    fireEvent.click(screen.getByRole('button', { name: /Finalize CEOClaw approval/i }));

    await waitFor(() => {
      expect(mockControlRun).toHaveBeenCalledWith('run-1', 'execute', { approvalId: 'ceoclaw-business-brief:run-1' });
    });
  });

  it('clears cached CEOClaw approval context after Trust denial', async () => {
    let onEvent: ((event: { type: string; approvals?: unknown[]; request?: unknown; decision?: string }) => void) | undefined;
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });
    const ceoclawApproval = {
      id: 'ceoclaw-business-brief:run-1',
      toolName: 'ceoclaw_business_brief_approval',
      summary: 'Approve CEOClaw brief for ceoclaw',
      run_id: 'run-1',
      args: {
        runId: 'run-1',
        projectId: 'ceoclaw',
        decision: 'Reject unsafe brief',
        evidenceRefs: ['memory://private-ref-token-denied'],
      },
    };
    mockListPendingApprovals.mockResolvedValueOnce({ approvals: [ceoclawApproval] });
    mockGetRun
      .mockResolvedValueOnce({
        run: {
          run_id: 'run-1',
          task_id: 'Build product',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'blocked',
          artifact_refs: [],
          created_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-01T00:05:00.000Z',
        },
      })
      .mockResolvedValue({
        run: {
          run_id: 'run-1',
          task_id: 'Build product',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'cancelled',
          artifact_refs: [],
          created_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-01T00:06:00.000Z',
        },
      });
    mockListRunEvents.mockResolvedValue({
      events: [
        {
          id: 'event-ceoclaw-request',
          seq: 10,
          ts: '2026-05-01T00:04:00.000Z',
          type: 'approval.requested',
          tool: 'ceoclaw_business_brief_approval',
          approval_id: 'ceoclaw-business-brief:run-1',
          reason: 'CEOClaw approval required',
          args: ceoclawApproval.args,
        },
      ],
    });
    mockListAuditEvents.mockResolvedValue({
      events: [
        {
          id: 'ceoclaw-business-brief:run-1:approval.denied:1',
          ts: '2026-05-01T00:05:00.000Z',
          type: 'approval.denied',
          requestId: 'ceoclaw-business-brief:run-1',
          toolName: 'ceoclaw_business_brief_approval',
          summary: ceoclawApproval.summary,
          args: ceoclawApproval.args,
        },
      ],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText(/CEOClaw approval pending: ceoclaw-business-brief:run-1/)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);
    });

    onEvent?.({ type: 'approval-resolved', request: ceoclawApproval, decision: 'deny' });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Finalize CEOClaw approval/i })).toBeNull();
      expect(screen.queryByText(/CEOClaw approval resolved: ceoclaw-business-brief:run-1/)).toBeNull();
    });
    expect(mockControlRun).not.toHaveBeenCalled();
  });

  it('surfaces pending CEOClaw approval from run events when pending approvals are unavailable', async () => {
    mockStreamOperatorEvents.mockImplementation(() => new Promise<void>(() => {}));
    mockListPendingApprovals.mockRejectedValue(new Error('approval api down'));
    mockGetRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'blocked',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        {
          id: 'event-ceoclaw-request',
          seq: 10,
          ts: '2026-05-01T00:04:00.000Z',
          type: 'approval.requested',
          tool: 'ceoclaw_business_brief_approval',
          approval_id: 'ceoclaw-business-brief:run-1',
          reason: 'CEOClaw approval required',
          args: {
            runId: 'run-1',
            projectId: 'ceoclaw',
            decision: 'Approve pending fallback brief',
            evidenceRefs: ['memory://private-ref-token-pending'],
          },
        },
      ],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText(/CEOClaw approval pending: ceoclaw-business-brief:run-1/)).toBeTruthy();
      expect(screen.getByText('Decision: Approve pending fallback brief')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);
      expect(screen.queryByText(/private-ref-token-pending/)).toBeNull();
    });
    expect(mockControlRun).not.toHaveBeenCalled();
  });

  it('keeps approved CEOClaw approvals finalizable when pending approvals are unavailable', async () => {
    mockStreamOperatorEvents.mockImplementation(() => new Promise<void>(() => {}));
    mockListPendingApprovals.mockRejectedValue(new Error('approval api down'));
    mockGetRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'blocked',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        {
          id: 'event-ceoclaw-request',
          seq: 10,
          ts: '2026-05-01T00:04:00.000Z',
          type: 'approval.requested',
          tool: 'ceoclaw_business_brief_approval',
          approval_id: 'ceoclaw-business-brief:run-1',
          reason: 'CEOClaw approval required',
          args: {
            runId: 'run-1',
            projectId: 'ceoclaw',
            decision: 'Approve resolved fallback brief',
            evidenceRefs: ['memory://private-ref-token-approved'],
          },
        },
      ],
    });
    mockListAuditEvents.mockResolvedValue({
      events: [
        {
          id: 'ceoclaw-business-brief:run-1:approval.approved:1',
          ts: '2026-05-01T00:05:00.000Z',
          type: 'approval.approved',
          requestId: 'ceoclaw-business-brief:run-1',
          toolName: 'ceoclaw_business_brief_approval',
          summary: 'Approve CEOClaw brief for ceoclaw',
          args: {
            runId: 'run-1',
            projectId: 'ceoclaw',
            decision: 'Approve resolved fallback brief',
            evidenceRefs: ['memory://private-ref-token-approved'],
          },
        },
      ],
    });
    mockControlRun.mockResolvedValueOnce({ ok: true, action: 'execute', run: { run_id: 'run-1', status: 'running' } });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText(/CEOClaw approval resolved: ceoclaw-business-brief:run-1/)).toBeTruthy();
      expect(screen.getByText('Decision: Approve resolved fallback brief')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Finalize CEOClaw approval/i })).toHaveProperty('disabled', false);
      expect(screen.queryByText(/private-ref-token-approved/)).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /Finalize CEOClaw approval/i }));

    await waitFor(() => {
      expect(mockControlRun).toHaveBeenCalledWith('run-1', 'execute', { approvalId: 'ceoclaw-business-brief:run-1' });
    });
  });

  it('rehydrates resolved CEOClaw approval context for blocked runs after reload', async () => {
    mockListPendingApprovals.mockResolvedValueOnce({ approvals: [] });
    mockGetRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'blocked',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        {
          id: 'event-ceoclaw-request',
          seq: 10,
          ts: '2026-05-01T00:04:00.000Z',
          type: 'approval.requested',
          tool: 'ceoclaw_business_brief_approval',
          approval_id: 'ceoclaw-business-brief:run-1',
          reason: 'CEOClaw approval required',
          args: {
            runId: 'run-1',
            projectId: 'ceoclaw',
            decision: 'Approve reload-safe brief',
            evidenceRefs: ['memory://private-ref-token-2'],
          },
        },
      ],
    });
    mockListAuditEvents.mockResolvedValue({
      events: [
        {
          id: 'ceoclaw-business-brief:run-1:approval.approved:1',
          ts: '2026-05-01T00:05:00.000Z',
          type: 'approval.approved',
          requestId: 'ceoclaw-business-brief:run-1',
          toolName: 'ceoclaw_business_brief_approval',
          summary: 'Approve CEOClaw brief for ceoclaw',
          args: {
            runId: 'run-1',
            projectId: 'ceoclaw',
            decision: 'Approve reload-safe brief',
            evidenceRefs: ['memory://private-ref-token-2'],
          },
        },
      ],
    });
    mockControlRun.mockResolvedValueOnce({ ok: true, action: 'execute', run: { run_id: 'run-1', status: 'running' } });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText(/CEOClaw approval resolved: ceoclaw-business-brief:run-1/)).toBeTruthy();
      expect(screen.getByText('Decision: Approve reload-safe brief')).toBeTruthy();
      expect(screen.getByText('Evidence refs: 1')).toBeTruthy();
      expect(screen.queryByText(/private-ref-token-2/)).toBeNull();
      expect(screen.getByRole('button', { name: /Finalize CEOClaw approval/i })).toHaveProperty('disabled', false);
    });
    fireEvent.click(screen.getByRole('button', { name: /Finalize CEOClaw approval/i }));

    await waitFor(() => {
      expect(mockControlRun).toHaveBeenCalledWith('run-1', 'execute', { approvalId: 'ceoclaw-business-brief:run-1' });
    });
  });

  it('does not rehydrate denied CEOClaw approvals as finalizable after reload', async () => {
    mockListPendingApprovals.mockResolvedValueOnce({ approvals: [] });
    mockGetRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'blocked',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        {
          id: 'event-ceoclaw-request',
          seq: 10,
          ts: '2026-05-01T00:04:00.000Z',
          type: 'approval.requested',
          tool: 'ceoclaw_business_brief_approval',
          approval_id: 'ceoclaw-business-brief:run-1',
          reason: 'CEOClaw approval required',
        },
      ],
    });
    mockListAuditEvents.mockResolvedValue({
      events: [
        {
          id: 'ceoclaw-business-brief:run-1:approval.denied:1',
          ts: '2026-05-01T00:05:00.000Z',
          type: 'approval.denied',
          requestId: 'ceoclaw-business-brief:run-1',
          toolName: 'ceoclaw_business_brief_approval',
          summary: 'Approve CEOClaw brief for ceoclaw',
          args: { runId: 'run-1', projectId: 'ceoclaw', decision: 'Reject unsafe brief' },
        },
      ],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Finalize CEOClaw approval/i })).toBeNull();
      expect(screen.queryByText(/CEOClaw approval resolved/)).toBeNull();
    });
    expect(mockControlRun).not.toHaveBeenCalled();
  });

  it('creates operator-supplied research evidence for the selected run', async () => {
    mockCreateRunResearchEvidence.mockResolvedValueOnce({
      artifact: { id: 'research-operator-1', kind: 'summary', sha256: 'operator-sha-1', createdAt: '2026-05-01T00:12:00.000Z' },
      snapshot: {
        schemaVersion: 'pyrfor.research_evidence.v1',
        createdAt: '2026-05-01T00:12:00.000Z',
        runId: 'run-1',
        query: 'Manual OpenClaw migration source',
        queryHash: 'manual-query-hash',
        sourceMode: 'operator_supplied',
        effectsExecuted: [],
        sources: [{ url: 'https://example.com/manual', title: 'Manual migration source' }],
        summary: 'Manual evidence summary.',
        notes: [],
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByLabelText(/Operator evidence query/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Operator evidence query/i), {
      target: { value: 'Manual OpenClaw migration source' },
    });
    fireEvent.change(screen.getByLabelText(/Operator source URL/i), {
      target: { value: 'https://example.com/manual?author=alice&design=dark&assignment=123&X-Amz-Credential=AKIASECRET&accessToken=secret&clientSecret=hidden&ok=1#private' },
    });
    fireEvent.change(screen.getByLabelText(/Operator source title/i), {
      target: { value: 'Manual migration source' },
    });
    fireEvent.change(screen.getByLabelText(/Operator evidence summary/i), {
      target: { value: 'Manual evidence summary.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save operator evidence/i }));

    await waitFor(() => {
      expect(mockCreateRunResearchEvidence).toHaveBeenCalledWith('run-1', {
        query: 'Manual OpenClaw migration source',
        sources: [{ url: 'https://example.com/manual?author=alice&design=dark&assignment=123&X-Amz-Credential=redacted&accessToken=redacted&clientSecret=redacted&ok=1', title: 'Manual migration source' }],
        summary: 'Manual evidence summary.',
      });
      expect(screen.getByText('Manual OpenClaw migration source')).toBeTruthy();
      expect(screen.getByText('Manual evidence summary.')).toBeTruthy();
      expect(screen.getByText('Evidence artifact: research-operator-1')).toBeTruthy();
      expect(screen.getByText('Evidence SHA-256: operator-sha-1')).toBeTruthy();
      expect(mockRefreshRunContextPack).toHaveBeenCalledWith('run-1');
    });
    expect(mockRequestRunResearchSearch).not.toHaveBeenCalled();
  });

  it('rejects credential-bearing operator research evidence URLs before persistence', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByLabelText(/Operator evidence query/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Operator evidence query/i), {
      target: { value: 'Credential URL source' },
    });
    fireEvent.change(screen.getByLabelText(/Operator source URL/i), {
      target: { value: 'https://user:pass@example.com/private' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save operator evidence/i }));

    await waitFor(() => {
      expect(screen.getByText(/Operator evidence unavailable: Source URL must not contain embedded credentials/)).toBeTruthy();
    });
    expect(mockCreateRunResearchEvidence).not.toHaveBeenCalled();
  });

  it('shows operator research evidence creation errors without appending evidence', async () => {
    mockCreateRunResearchEvidence.mockRejectedValueOnce(new Error('cannot persist operator evidence'));

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByLabelText(/Operator evidence query/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Operator evidence query/i), {
      target: { value: 'Rejected manual source' },
    });
    fireEvent.change(screen.getByLabelText(/Operator source URL/i), {
      target: { value: 'https://example.com/rejected' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save operator evidence/i }));

    await waitFor(() => {
      expect(screen.getByText(/Operator evidence unavailable: Error: cannot persist operator evidence/)).toBeTruthy();
      expect(screen.queryByText('Rejected manual source')).toBeNull();
    });
  });

  it('sanitizes research evidence previews before rendering', async () => {
    mockListRunResearchEvidence.mockResolvedValue({
      evidence: [{
        artifact: { id: 'research-sensitive', kind: 'summary', sha256: 'research-sensitive-sha', createdAt: '2026-05-01T00:09:00.000Z' },
        snapshot: {
          schemaVersion: 'pyrfor.research_evidence.v1',
          createdAt: '2026-05-01T00:09:00.000Z',
          runId: 'run-1',
          query: 'Check /Users/alice/private with token=github_pat_researchquery',
          queryHash: 'hash-sensitive',
          sourceMode: 'operator_supplied',
          effectsExecuted: [],
          sources: [{
            url: 'https://secret-token@example.com/search?api_key=hidden&ok=1#fragment',
            title: 'Result mentions ghp_researchtitle and /home/alice/project',
            citation: 'Citation https://example.com/source?accessToken=hidden',
            snippet: 'Snippet includes Bearer secret-token-value and /Volumes/private/file',
            observedAt: 'Bearer observed-secret-token /Users/alice/observed',
          }],
          summary: 'Evidence at https://user:pass@example.com/path?token=hidden and cwd=/tmp/private',
          notes: [],
        },
      }],
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      const text = document.body.textContent || '';
      expect(text).toContain('Check [redacted-path] with token=[redacted]');
      expect(text).toContain('Evidence at https://redacted:redacted@example.com/path?token=[redacted]');
      expect(text).toContain('Result mentions [redacted-token] and [redacted-path]');
      expect(text).toContain('Citation: Citation https://example.com/source?accessToken=[redacted]');
      expect(text).toContain('Snippet: Snippet includes Bearer [redacted-token] and [redacted-path]');
      expect(text).toContain('Observed: Bearer [redacted-token] [redacted-path]');
      expect(text).not.toContain('github_pat_researchquery');
      expect(text).not.toContain('ghp_researchtitle');
      expect(text).not.toContain('/Users/alice/private');
      expect(text).not.toContain('/home/alice/project');
      expect(text).not.toContain('/tmp/private');
      expect(text).not.toContain('/Volumes/private/file');
      expect(text).not.toContain('/Users/alice/observed');
      expect(text).not.toContain('observed-secret-token');
      expect(text).not.toContain('hidden');
    });
    const link = screen.getByRole('link', { name: /Result mentions/ });
    expect(link).toHaveProperty('href', 'https://redacted@example.com/search?api_key=redacted&ok=1');
  });

  it('sanitizes delivery and verifier previews before rendering', async () => {
    mockGetRunDeliveryEvidence.mockResolvedValue({
      artifact: { id: 'artifact-delivery-sensitive', kind: 'delivery_evidence', createdAt: '2026-05-01T00:10:00.000Z' },
      snapshot: {
        schemaVersion: 'pyrfor.delivery_evidence.v1',
        capturedAt: 'accessToken=secret123 /Users/alice/captured',
        runId: 'run-1',
        verifierStatus: 'warning',
        verifier: {
          status: 'waived',
          rawStatus: 'blocked',
          waivedFrom: 'blocked /Users/alice/waivedFrom',
          waiverArtifactId: 'waiver-/tmp/artifact-ghp_waiversecret',
          reason: 'Delivery verifier reason at /var/tmp/verifier with clientSecret=verifier-secret',
        },
        deliveryChecklist: ['release notes at /Users/alice/private', 'token=github_pat_deliverycheck'],
        git: {
          available: true,
          branch: 'feature//Users/alice/private',
          headSha: 'abcdef1234567890',
          ahead: 2,
          behind: 1,
          dirtyFiles: [
            { path: '/Users/alice/private/src/github_pat_dirtysecret.ts', x: 'M', y: ' ' },
            { path: 'docs/token=github_pat_dirtydoc.md', x: '?', y: '?' },
          ],
          latestCommits: [{
            sha: 'abcdef1234567890',
            author: 'Alice /Users/alice/author clientSecret=hidden123',
            dateUnix: 1770000000,
            subject: 'Fix /home/alice/commit with apiKey=xyz and awsAccessKeyId=AKIA123',
          }],
          remote: { name: 'origin', url: 'https://github.com/acme/pyrfor.git', repository: 'acme/pyrfor' },
          error: 'git status failed for /Users/alice/private with token=github_pat_giterror',
        },
        github: {
          provider: 'github',
          available: true,
          repository: 'acme/pyrfor',
          branch: {
            name: 'feature/private',
            protected: false,
            commitSha: 'abcdef1234567890',
            url: 'https://github-token@github.com/acme/pyrfor/tree/feature/private?access_token=hidden#branch-fragment',
          },
          issue: {
            number: 8,
            title: 'Issue mentions ghp_issue_secret and /home/alice/issue',
            state: 'open',
            url: 'https://github-token@github.com/acme/pyrfor/issues/8?token=hidden#fragment',
          },
          pullRequests: [{
            number: 77,
            title: 'PR from /tmp/pr with github_pat_prsecret',
            state: 'open',
            url: 'https://github-token@github.com/acme/pyrfor/pull/77?api_key=hidden#fragment',
          }],
          workflowRuns: [{
            id: 9,
            name: 'CI at /var/tmp/private',
            status: 'completed',
            conclusion: 'success',
            url: 'https://github-token@github.com/acme/pyrfor/actions/runs/9?secret=hidden#fragment',
          }],
          errors: [{
            scope: 'branch//Users/alice/private',
            status: 401,
            message: 'GitHub error used Bearer github_pat_githuberror at /tmp/github-error',
          }],
        },
      },
    });
    mockGetRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan-sensitive', kind: 'delivery_plan', createdAt: '2026-05-01T00:11:00.000Z', sha256: 'plan-sensitive-sha' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:11:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: false,
        approvalRequired: true,
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: 'abcdef1234567890',
        proposedBranch: 'pyrfor//Users/alice/private',
        pullRequest: { title: 'Plan title token=github_pat_plansecret and /tmp/plan', body: 'No writes', draft: true },
        issue: { number: 8, commentBody: 'Dry-run plan' },
        ci: { observeWorkflowRuns: [] },
        blockers: ['Blocked by /home/alice/blocker and password=hunter2'],
        evidenceArtifactId: 'artifact-delivery-sensitive',
      },
    });
    mockGetRunGithubDeliveryApply.mockResolvedValue({
      artifact: { id: 'artifact-apply-sensitive', kind: 'delivery_apply', createdAt: '2026-05-01T00:12:00.000Z', sha256: 'apply-sensitive-sha' },
      result: {
        schemaVersion: 'pyrfor.github_delivery_apply.v1',
        appliedAt: '2026-05-01T00:12:00.000Z',
        runId: 'run-1',
        planArtifactId: 'artifact-plan-sensitive',
        planSha256: 'plan-sensitive-sha',
        approvalId: 'approval-apply',
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        branch: 'pyrfor//Users/alice/private',
        commitSha: 'abcdef1234567890',
        draftPullRequest: {
          number: 88,
          title: 'Draft title ghp_applysecret and /Users/alice/apply',
          state: 'open',
          draft: true,
          url: 'https://github-token@github.com/acme/pyrfor/pull/88?signature=hidden#fragment',
        },
      },
    });
    mockGetRunVerifierStatus.mockResolvedValue({
      decision: {
        status: 'waived',
        rawStatus: 'blocked',
        reason: 'Verifier saw /Users/alice/private and token=github_pat_verify',
        waiverEligible: false,
        waiver: {
          reason: 'Waived for /tmp/waiver with password=hunter2',
          operator: { id: 'operator:/Users/alice/private', name: 'Alice /Users/alice/private' },
        },
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      const text = document.body.textContent || '';
      expect(text).toContain('branch: feature/[redacted-path]');
      expect(text).toContain('ahead/behind: 2/1');
      expect(text).toContain('branch protection: unprotected');
      expect(text).toContain('captured: accessToken=[redacted] [redacted-path]');
      expect(text).toContain('git error: git status failed for [redacted-path] with token=[redacted]');
      expect(text).toContain('Verifier provenance');
      expect(text).toContain('raw: blocked');
      expect(text).toContain('waived from: blocked [redacted-path]');
      expect(text).toContain('waiver artifact: waiver-[redacted-path]');
      expect(text).toContain('reason: Delivery verifier reason at [redacted-path] with clientSecret=[redacted]');
      expect(text).toContain('2 dirty');
      expect(text).toContain('M [redacted-path]');
      expect(text).toContain('?? docs/token=[redacted]');
      expect(text).toContain('GitHub readiness errors');
      expect(text).toContain('branch/[redacted-path] 401: GitHub error used Bearer [redacted-token] at [redacted-path]');
      expect(text).toContain('Latest local commits');
      expect(text).toContain('abcdef123456');
      expect(text).toContain('Fix [redacted-path] with apiKey=[redacted]');
      expect(text).toContain('awsAccessKeyId=[redacted]');
      expect(text).toContain('Alice [redacted-path] clientSecret=[redacted]');
      expect(text).toContain('Issue mentions [redacted-token] and [redacted-path]');
      expect(text).toContain('PR from [redacted-path] with [redacted-token]');
      expect(text).toContain('CI at [redacted-path]');
      expect(text).toContain('release notes at [redacted-path], token=[redacted]');
      expect(text).toContain('pyrfor/[redacted-path]');
      expect(text).toContain('Plan title token=[redacted]');
      expect(text).toContain('Blocked by [redacted-path] and password=[redacted]');
      expect(text).toContain('Draft title [redacted-token] and [redacted-path]');
      expect(text).toContain('Verifier saw [redacted-path] and token=[redacted]');
      expect(text).toContain('waived by Alice [redacted-path]: Waived for [redacted-path] with password=[redacted]');
      expect(document.body.innerHTML).toContain('https://redacted@github.com/acme/pyrfor/issues/8?token=redacted');
      expect(document.body.innerHTML).toContain('https://redacted@github.com/acme/pyrfor/tree/feature/private?access_token=redacted');
      expect(document.body.innerHTML).toContain('https://redacted@github.com/acme/pyrfor/pull/77?api_key=redacted');
      expect(document.body.innerHTML).toContain('https://redacted@github.com/acme/pyrfor/pull/88?signature=redacted');
      expect(text).not.toContain('github_pat_deliverycheck');
      expect(text).not.toContain('github_pat_plansecret');
      expect(text).not.toContain('github_pat_verify');
      expect(text).not.toContain('ghp_issue_secret');
      expect(text).not.toContain('github_pat_prsecret');
      expect(text).not.toContain('ghp_applysecret');
      expect(text).not.toContain('github_pat_dirtysecret');
      expect(text).not.toContain('github_pat_dirtydoc');
      expect(text).not.toContain('github_pat_giterror');
      expect(text).not.toContain('github_pat_githuberror');
      expect(text).not.toContain('github_pat_authorsecret');
      expect(text).not.toContain('github_pat_commitsecret');
      expect(text).not.toContain('secret123');
      expect(text).not.toContain('hidden123');
      expect(text).not.toContain('apiKey=xyz');
      expect(text).not.toContain('AKIA123');
      expect(text).not.toContain('ghp_waiversecret');
      expect(text).not.toContain('verifier-secret');
      expect(text).not.toContain('/Users/alice/private');
      expect(text).not.toContain('/home/alice/issue');
      expect(text).not.toContain('/tmp/pr');
      expect(text).not.toContain('/var/tmp/private');
      expect(text).not.toContain('/tmp/waiver');
      expect(text).not.toContain('/tmp/github-error');
      expect(text).not.toContain('/Users/alice/author');
      expect(text).not.toContain('/home/alice/commit');
      expect(text).not.toContain('/Users/alice/captured');
      expect(text).not.toContain('/Users/alice/waivedFrom');
      expect(text).not.toContain('/var/tmp/verifier');
      expect(document.body.innerHTML).not.toContain('github-token');
      expect(document.body.innerHTML).not.toContain('hidden');
    });
  });

  it('sanitizes context pack identifiers and section content before rendering', async () => {
    mockGetRunContextPack.mockResolvedValue({
      artifact: { id: 'context-pack-sensitive', kind: 'context_pack', createdAt: '2026-05-01T00:13:00.000Z', sha256: 'sha-context-sensitive' },
      pack: {
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-sensitive',
        hash: 'abcdef1234567890',
        compiledAt: '2026-05-01T00:13:00.000Z',
        runId: 'run-1',
        workspaceId: '/Users/alice/private-workspace',
        projectId: '/home/alice/private-project',
        task: { id: 'task-sensitive', title: 'Build product' },
        sections: [
          {
            id: 'workspace_files',
            kind: 'workspace',
            title: 'Workspace file /Users/alice/private-workspace/MEMORY.md',
            priority: 30,
            content: [{
              path: '/Users/alice/private-workspace/MEMORY.md',
              content: 'Use github_pat_contextsecret and file:///tmp/private/context.txt',
            }],
            sources: [{ kind: 'workspace_file', ref: 'MEMORY.md', role: 'input' }],
          },
          {
            id: 'project_memory',
            kind: 'memory',
            title: 'Project memory',
            priority: 20,
            content: [{ id: 'memory-1', summary: 'Remember ghp_contextsummary and cwd=/var/tmp/context' }],
            sources: [{ kind: 'memory', ref: 'memory-1', role: 'memory' }],
          },
          {
            id: 'run_evidence',
            kind: 'evidence',
            title: 'Run evidence https://token@github.com/acme/private?access_token=secret',
            priority: 58,
            content: [{
              artifactId: 'research-1',
              summary: 'Evidence at https://github.com/acme/private/path?access_token=secret from C:\\Users\\Alice\\secret and \\\\server\\share\\secret with apiKey=xyz',
            }],
            sources: [{ kind: 'artifact', ref: 'research-1', role: 'evidence' }],
          },
        ],
        sourceRefs: [
          { kind: 'workspace_file', ref: 'MEMORY.md', role: 'input' },
          { kind: 'memory', ref: 'memory-1', role: 'memory' },
          { kind: 'artifact', ref: 'research-1', role: 'evidence' },
        ],
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      const text = document.body.textContent || '';
      expect(text).toContain('workspace: [redacted-path]');
      expect(text).toContain('project: [redacted-path]');
      expect(text).toContain('Workspace file [redacted-path]');
      expect(text).toContain('[redacted-token]');
      expect(text).toContain('[redacted-file-uri]');
      expect(text).toContain('cwd=[redacted-path]');
      expect(text).toContain('Run evidence');
      expect(text).toContain('https://redacted@github.com/acme/private?access_token=[redacted]');
      expect(text).toContain('https://github.com/acme/private/path?access_token=[redacted]');
      expect(text).toContain('apiKey=[redacted]');
      expect(text).not.toContain('/Users/alice/private-workspace');
      expect(text).not.toContain('/home/alice/private-project');
      expect(text).not.toContain('github_pat_contextsecret');
      expect(text).not.toContain('ghp_contextsummary');
      expect(text).not.toContain('file:///tmp/private');
      expect(text).not.toContain('/var/tmp/context');
      expect(text).not.toContain('access_token=secret');
      expect(text).not.toContain('C:\\Users\\Alice\\secret');
      expect(text).not.toContain('\\\\server\\share\\secret');
      expect(text).not.toContain('apiKey=xyz');
    });
  });

  it('refreshes the selected run context pack and renders evidence preview', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Refresh context pack/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Refresh context pack/i }));

    await waitFor(() => {
      expect(mockRefreshRunContextPack).toHaveBeenCalledWith('run-1');
      const text = document.body.textContent || '';
      expect(text).toContain('refreshed123');
      expect(text).toContain('Run evidence');
      expect(text).toContain('Reviewed governed evidence.');
    });
  });

  it('does not keep context pack refresh disabled or accept stale results after switching runs mid-refresh', async () => {
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
        {
          run_id: 'run-2',
          task_id: 'Review evidence',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'running',
          artifact_refs: [],
          created_at: '2026-05-01T00:01:00.000Z',
          updated_at: '2026-05-01T00:06:00.000Z',
        },
      ],
    });
    mockGetRun.mockImplementation((runId: string) => Promise.resolve({
      run: {
        run_id: runId,
        task_id: runId === 'run-2' ? 'Review evidence' : 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'running',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    }));
    let resolveFirstRefresh: (value: unknown) => void = () => undefined;
    let resolveSecondRefresh: (value: unknown) => void = () => undefined;
    mockRefreshRunContextPack
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstRefresh = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondRefresh = resolve; }));

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Refresh context pack/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Refresh context pack/i }));
    expect((screen.getByRole('button', { name: /Refreshing context pack/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Review evidence/i }));

    await waitFor(() => {
      const refreshButton = screen.getByRole('button', { name: /Refresh context pack/i });
      expect((refreshButton as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Refresh context pack/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Refresh context pack/i }));

    await act(async () => {
      resolveSecondRefresh({
        artifact: { id: 'context-pack-fresh', kind: 'context_pack', createdAt: '2026-05-01T00:09:00.000Z' },
        previousArtifact: { id: 'context-pack-1', kind: 'context_pack', createdAt: '2026-05-01T00:06:00.000Z' },
        pack: {
          schemaVersion: 'context_pack.v1',
          packId: 'ctx-run-1',
          hash: 'fresh1234567890',
          compiledAt: '2026-05-01T00:09:00.000Z',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          task: { title: 'Build product' },
          sections: [{
            id: 'run_evidence',
            kind: 'evidence',
            title: 'Run evidence',
            priority: 58,
            content: [{ summary: 'Fresh evidence wins.' }],
            sources: [{ kind: 'artifact', ref: 'fresh-research', role: 'evidence' }],
          }],
          sourceRefs: [{ kind: 'artifact', ref: 'fresh-research', role: 'evidence' }],
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(document.body.textContent || '').toContain('Fresh evidence wins.'));

    await act(async () => {
      resolveFirstRefresh({
        artifact: { id: 'context-pack-stale', kind: 'context_pack', createdAt: '2026-05-01T00:08:00.000Z' },
        previousArtifact: { id: 'context-pack-1', kind: 'context_pack', createdAt: '2026-05-01T00:06:00.000Z' },
        pack: {
          schemaVersion: 'context_pack.v1',
          packId: 'ctx-run-1',
          hash: 'stale1234567890',
          compiledAt: '2026-05-01T00:08:00.000Z',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          task: { title: 'Build product' },
          sections: [{
            id: 'run_evidence',
            kind: 'evidence',
            title: 'Run evidence',
            priority: 58,
            content: [{ summary: 'Stale evidence should not render.' }],
            sources: [{ kind: 'artifact', ref: 'stale-research', role: 'evidence' }],
          }],
          sourceRefs: [{ kind: 'artifact', ref: 'stale-research', role: 'evidence' }],
        },
      });
      await Promise.resolve();
    });

    const text = document.body.textContent || '';
    expect(text).toContain('Fresh evidence wins.');
    expect(text).not.toContain('Stale evidence should not render.');
  });

  it('dispatches the next pending actor mailbox task from the actor card', async () => {
    mockDispatchNextRunActorMessage.mockResolvedValueOnce({
      ok: true,
      dispatch: {
        response: 'Actor dispatch done',
        completion: {
          node: { id: 'actor-node-1', kind: 'actor.mailbox.task', status: 'succeeded', payload: {}, provenance: [] },
          proofArtifact: { id: 'actor-proof-1', kind: 'summary', createdAt: '2026-05-01T00:08:00.000Z' },
        },
      },
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
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Dispatch next/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Dispatch next/i }));

    await waitFor(() => {
      expect(mockDispatchNextRunActorMessage).toHaveBeenCalledWith('run-1', { actorId: 'actor-planner' });
      expect(mockRefreshRunContextPack).toHaveBeenCalledWith('run-1');
    });
  });

  it('recovers stale leased actor mailbox tasks from the actor card', async () => {
    mockListRunActors.mockResolvedValue({
      runId: 'run-1',
      actors: [{
        actorId: 'actor-planner',
        agentId: 'planner',
        agentName: 'Planner',
        role: 'planner',
        status: 'running',
        currentWork: 'Waiting on stale lease',
        outputs: [],
        blockers: [],
        mailbox: { pending: 0, leased: 1, completed: 0, failed: 0, stale: 1, oldestLeasedAgeMs: 125000 },
        budget: { profile: 'standard' },
      }],
      totals: { actors: 1, running: 1, blocked: 0, failed: 0, mailboxPending: 0, mailboxStale: 1, oldestLeasedAgeMs: 125000 },
    });
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText('Totals: 1 actors · 1 running · 0 blocked · 0 failed · 0 mailbox pending · 1 stale · oldest lease 125s')).toBeTruthy();
      expect(screen.getByText(/mailbox: 0 pending · 1 leased · 1 stale · oldest lease 125s/)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Recover stale/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Recover stale/i }));

    await waitFor(() => {
      expect(mockRecoverStuckRunActorMessages).toHaveBeenCalledWith('run-1', {
        actorId: 'actor-planner',
        olderThanMs: 60000,
        reason: 'operator_recover_stuck_actor',
      });
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
    expect(screen.getByRole('button', { name: /Plan GitHub delivery/i })).toHaveProperty('disabled', true);
    expect(screen.getAllByText('Verifier blocked — create a matching waiver before delivery planning.').length).toBeGreaterThan(0);
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
      expect(mockRefreshRunContextPack).toHaveBeenCalledWith('run-1');
    });
  });

  it('keeps captured delivery evidence visible when context pack refresh fails', async () => {
    mockRefreshRunContextPack.mockRejectedValueOnce(new Error('context refresh unavailable'));
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Capture evidence')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Capture evidence/i }));

    await waitFor(() => {
      expect(mockCaptureRunDeliveryEvidence).toHaveBeenCalledWith('run-1', {});
      expect(screen.getByText(/feature\/evidence/)).toBeTruthy();
      expect(mockRefreshRunContextPack).toHaveBeenCalledWith('run-1');
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
    let onEvent: ((event: { type: 'snapshot'; approvals?: Array<{ id: string }> }) => void) | undefined;
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });
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
    mockRequestRunGithubDeliveryApply
      .mockResolvedValueOnce({
        status: 'awaiting_approval',
        approval: { id: 'approval-1', toolName: 'github_delivery_apply', summary: 'Create draft PR', args: {} },
        planArtifactId: 'artifact-plan',
        expectedPlanSha256: 'plan-sha',
      })
      .mockResolvedValueOnce({
        status: 'applied',
        artifact: { id: 'artifact-apply', kind: 'delivery_apply', createdAt: '2026-05-01T00:10:00.000Z', sha256: 'apply-sha' },
        result: {
          schemaVersion: 'pyrfor.github_delivery_apply.v1',
          appliedAt: '2026-05-01T00:10:00.000Z',
          mode: 'draft_pr',
          runId: 'run-1',
          repository: 'acme/pyrfor',
          baseBranch: 'main',
          branch: 'pyrfor/build-product-12345678',
          headSha: 'abcdef1234567890',
          planArtifactId: 'artifact-plan',
          planSha256: 'plan-sha',
          evidenceArtifactId: 'artifact-evidence',
          approvalId: 'approval-1',
          idempotencyKey: 'apply-key',
          draftPullRequest: {
            number: 77,
            url: 'https://github.com/acme/pyrfor/pull/77',
            title: 'Pyrfor delivery: Build product',
            state: 'open',
            draft: true,
            headRef: 'pyrfor/build-product-12345678',
            baseRef: 'main',
          },
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
    expect(screen.getByRole('button', { name: /Approve in Trust first/i })).toHaveProperty('disabled', true);

    onEvent?.({ type: 'snapshot', approvals: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply approved delivery/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Apply approved delivery/i }));

    await waitFor(() => {
      expect(mockRequestRunGithubDeliveryApply).toHaveBeenCalledWith('run-1', {
        planArtifactId: 'artifact-plan',
        expectedPlanSha256: 'plan-sha',
        approvalId: 'approval-1',
      });
      expect(screen.getByText('Draft PR #77')).toBeTruthy();
    });
  });

  it('keeps GitHub delivery apply disabled until verifier passes or is waived', async () => {
    mockGetRunVerifierStatus.mockResolvedValue({
      decision: {
        status: 'warning',
        rawStatus: 'warning',
        reason: 'tests warning',
        waiverEligible: true,
        waiverPath: '/api/runs/run-1/verifier-waiver',
      },
    });
    mockGetRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', createdAt: '2026-05-01T00:08:00.000Z', sha256: 'plan-sha' },
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

    await waitFor(() => {
      expect(screen.getAllByText('Verifier warning — delivery apply requires a pass or matching waiver.').length).toBeGreaterThan(0);
      expect(screen.getByPlaceholderText('APPLY pyrfor/build-product-12345678')).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: /Request apply approval/i })).toHaveProperty('disabled', true);
    });
    expect(mockRequestRunGithubDeliveryApply).not.toHaveBeenCalled();
  });

  it('allows apply approval request when current scoped verifier waiver clears stale plan blockers', async () => {
    mockGetRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', createdAt: '2026-05-01T00:08:00.000Z', sha256: 'plan-sha' },
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
        ci: { observeWorkflowRuns: [] },
        blockers: [
          'verifier status is warning',
          'verifier must be passed or waived before apply (warning)',
        ],
        evidenceArtifactId: 'artifact-evidence',
      },
    });
    mockGetRunVerifierStatus.mockResolvedValue({
      decision: {
        status: 'waived',
        rawStatus: 'warning',
        waiverEligible: true,
        waiverPath: '/api/runs/run-1/verifier-waiver',
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(screen.getByText('none after current verifier decision')).toBeTruthy();
      expect(screen.getByPlaceholderText('APPLY pyrfor/build-product-12345678')).toHaveProperty('disabled', false);
    });
    fireEvent.change(screen.getByPlaceholderText('APPLY pyrfor/build-product-12345678'), {
      target: { value: 'APPLY pyrfor/build-product-12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request apply approval/i }));

    await waitFor(() => {
      expect(mockRequestRunGithubDeliveryApply).toHaveBeenCalledWith('run-1', {
        planArtifactId: 'artifact-plan',
        expectedPlanSha256: 'plan-sha',
      });
    });
  });

  it('allows delivery planning with a delivery_plan waiver without unlocking apply', async () => {
    mockGetRunVerifierStatus
      .mockResolvedValueOnce({
        decision: {
          status: 'warning',
          rawStatus: 'warning',
          waiverEligible: true,
          waiverPath: '/api/runs/run-1/verifier-waiver',
        },
      })
      .mockResolvedValueOnce({
        decision: {
          status: 'waived',
          rawStatus: 'warning',
          waiverEligible: true,
          waiverPath: '/api/runs/run-1/verifier-waiver',
          waiver: {
            schemaVersion: 'pyrfor.verifier_waiver.v1',
            runId: 'run-1',
            rawStatus: 'warning',
            operator: { id: 'operator' },
            reason: 'Plan-only waiver',
            scope: 'delivery_plan',
            waivedAt: '2026-05-03T00:00:00.000Z',
          },
        },
      })
      .mockResolvedValueOnce({
        decision: {
          status: 'warning',
          rawStatus: 'warning',
          waiverEligible: true,
          waiverPath: '/api/runs/run-1/verifier-waiver',
        },
      });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(mockGetRunVerifierStatus).toHaveBeenCalledWith('run-1');
      expect(mockGetRunVerifierStatus).toHaveBeenCalledWith('run-1', 'delivery_plan');
      expect(mockGetRunVerifierStatus).toHaveBeenCalledWith('run-1', 'delivery_apply');
      expect(screen.getByRole('button', { name: /Plan GitHub delivery/i })).toHaveProperty('disabled', false);
      expect(screen.getAllByText('Verifier warning — delivery apply requires a pass or matching waiver.').length).toBeGreaterThan(0);
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
      expect(screen.queryByText(/family-reminder/)).toBeNull();
      expect(screen.queryByText(/workflowTemplates/)).toBeNull();
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
      expect(screen.getByText('Actor workflow · recommended model gpt-5.4')).toBeTruthy();
      expect(screen.getByText(/Product Planner · planner · 1 mailbox task/)).toBeTruthy();
      expect(screen.getByText(/Product Reviewer · reviewer · 1 mailbox task · after product-implementer/)).toBeTruthy();
    });
  });

  it('renders Product Factory quality gate readiness from plan preview', async () => {
    mockPreviewProductFactoryPlan.mockResolvedValueOnce({
      preview: {
        intent: { id: 'pf-ui', templateId: 'ui_scaffold', title: 'Build settings panel', goal: 'Build settings panel', domainIds: [] },
        template: { id: 'ui_scaffold', title: 'UI scaffold' },
        missingClarifications: [],
        scopedPlan: { objective: 'Build settings panel', scope: [], assumptions: [], risks: [], qualityGates: ['browser_smoke'] },
        qualityGateReadiness: [{
          gate: 'browser_smoke',
          status: 'setup_required',
          statusSource: 'local-config',
          liveProbeSkipped: true,
          approvalRequired: true,
          reasons: ['Playwright Chromium runtime is not installed for Browser QA.'],
          nextStep: 'Install missing local Browser QA prerequisites before requesting browser smoke approval.',
        }],
        actorWorkflow: { enabled: false, recommendedModel: 'gpt-5.4', actors: [], nextStep: 'This template does not seed Product Factory actor mailbox work.' },
        dagPreview: { nodes: [{ id: 'pf-ui/verify', kind: 'product_factory.verify' }] },
        deliveryChecklist: ['visual_qa_notes'],
      },
    });

    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('UI scaffold')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'ui_scaffold' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview plan/i }));

    await waitFor(() => {
      expect(mockPreviewProductFactoryPlan).toHaveBeenCalledWith({
        templateId: 'ui_scaffold',
        prompt: 'Describe the product idea or task to plan',
        answers: {},
      });
      expect(screen.getByText('Quality gate: browser_smoke')).toBeTruthy();
      expect(screen.getByText('setup_required')).toBeTruthy();
      expect(screen.getByText('Playwright Chromium runtime is not installed for Browser QA.')).toBeTruthy();
      expect(screen.getByText('Next step: Install missing local Browser QA prerequisites before requesting browser smoke approval.')).toBeTruthy();
    });
    expect(mockGetBrowserReadiness).toHaveBeenCalledTimes(1);
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
