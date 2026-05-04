import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fsList,
  fsRead,
  chat,
  exec,
  detectLanguage,
  listPendingApprovals,
  listPendingEffects,
  decideApproval,
  listAuditEvents,
  getAgents,
  getConnectorInventory,
  probeConnector,
  getSkills,
  getSlashCommands,
  invokeSlashCommand,
  recommendSkills,
  listRuns,
  getRun,
  getRunContextPack,
  listRunEvents,
  listRunDag,
  listRunFrames,
  listRunActors,
  enqueueRunActorMessage,
  recoverStuckRunActorMessages,
  leaseRunActorMessage,
  dispatchNextRunActorMessage,
  completeRunActorMessage,
  failRunActorMessage,
  getRunDeliveryEvidence,
  captureRunDeliveryEvidence,
  createRunResearchEvidence,
  listRunResearchEvidence,
  requestRunResearchSearch,
  getRunGithubDeliveryPlan,
  createRunGithubDeliveryPlan,
  getRunGithubDeliveryApply,
  requestRunGithubDeliveryApply,
  getRunVerifierStatus,
  createRunVerifierWaiver,
  controlRun,
  listProductFactoryTemplates,
  previewProductFactoryPlan,
  createProductFactoryRun,
  previewOchagReminder,
  createOchagReminderRun,
  getOchagPrivacy,
  createProjectMemoryRollup,
  previewCeoclawBrief,
  createCeoclawBriefRun,
  listOverlays,
  getOverlay,
  getOpenClawImportReport,
  getMemoryContinuity,
  streamOperatorEvents,
} from './api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('detectLanguage', () => {
  it('detects typescript', () => expect(detectLanguage('foo.ts')).toBe('typescript'));
  it('detects tsx', () => expect(detectLanguage('App.tsx')).toBe('typescript'));
  it('detects javascript', () => expect(detectLanguage('app.js')).toBe('javascript'));
  it('detects python', () => expect(detectLanguage('main.py')).toBe('python'));
  it('detects json', () => expect(detectLanguage('package.json')).toBe('json'));
  it('defaults to plaintext', () => expect(detectLanguage('Makefile')).toBe('plaintext'));
});

describe('apiFetch wrappers', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockReset();
  });

  it('fsList calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ path: '/test', entries: [] }),
    });
    const result = await fsList('/test');
    expect(result.entries).toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/fs/list?path=%2Ftest'),
      expect.any(Object)
    );
  });

  it('chat posts to /api/chat', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: 'Hello!', sessionId: 'sess-1', runId: 'run-1', taskId: 'task-1' }),
    });
    const result = await chat('Hi');
    expect(result.reply).toBe('Hello!');
    expect(result.runId).toBe('run-1');
    expect(result.taskId).toBe('task-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/chat'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('exec posts to /api/exec', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stdout: 'ok', stderr: '', exitCode: 0, durationMs: 50 }),
    });
    const result = await exec('ls');
    expect(result.exitCode).toBe(0);
  });

  it('trust wrappers call approval and audit endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ effects: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, decision: 'approve' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [] }) });

    await listPendingApprovals();
    await listPendingEffects();
    await decideApproval('req-1', 'approve');
    await listAuditEvents(25);
    await listAuditEvents(25, { requestId: 'req-1' });

    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/approvals/pending'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/effects/pending'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/approvals/req-1/decision'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(4, expect.stringContaining('/api/audit/events?limit=25'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(5, expect.stringContaining('/api/audit/events?limit=25&requestId=req-1'), expect.any(Object));
  });

  it('streams operator SSE frames through the fetch-based helper', async () => {
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: snapshot\ndata: {"runs":[],"approvals":[],"effects":[]}\n\n'));
          controller.enqueue(encoder.encode('event: ledger\ndata: {"event":{"type":"run.blocked","run_id":"run-1"}}\n\n'));
          controller.close();
        },
      }),
    });
    const seen: unknown[] = [];

    await expect(streamOperatorEvents({ onEvent: (event) => seen.push(event) })).rejects.toThrow('operator stream ended');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/events/stream'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(seen).toEqual([
      expect.objectContaining({ type: 'snapshot', runs: [] }),
      expect.objectContaining({ type: 'ledger', event: expect.objectContaining({ type: 'run.blocked' }) }),
    ]);
  });

  it('rejects operator streams on server error frames', async () => {
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: error\ndata: {"message":"stream failed"}\n\n'));
        },
      }),
    });
    const onError = vi.fn();

    await expect(streamOperatorEvents({ onEvent: vi.fn(), onError })).rejects.toThrow('stream failed');
    expect(onError).toHaveBeenCalledWith('stream failed');
  });

  it('orchestration wrappers call run and overlay endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { run_id: 'run-1' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ nodes: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ frames: [{ frame_id: 'frame-1', type: 'tool_call' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runId: 'run-1', actors: [], totals: { actors: 0, running: 0, blocked: 0, failed: 0, mailboxPending: 0 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, action: 'replay', run: { run_id: 'run-1' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, action: 'execute', run: { run_id: 'run-1' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: [{ id: 'feature', title: 'Feature delivery' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: { intent: { id: 'pf-1' } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { run_id: 'run-2' }, preview: {}, artifact: { id: 'artifact-1' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: { intent: { domainIds: ['ochag'] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { run_id: 'run-ochag' }, preview: {}, artifact: { id: 'artifact-ochag' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ domainId: 'ochag', privacyRules: [], toolPermissionOverrides: {}, adapterRegistrations: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: { intent: { domainIds: ['ceoclaw'] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { run_id: 'run-ceoclaw' }, preview: {}, artifact: { id: 'artifact-ceoclaw' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overlays: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          overlay: {
            schemaVersion: 'domain_overlay.v1',
            domainId: 'ochag',
            version: '1.0.0',
            title: 'Ochag',
            workflowCount: 0,
            adapterCount: 1,
            privacyRuleIds: [],
            toolPermissionSummaries: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          overlay: {
            schemaVersion: 'domain_overlay.v1',
            domainId: 'ceoclaw',
            version: '1.0.0',
            title: 'CEOClaw',
            workflowCount: 0,
            adapterCount: 1,
            privacyRuleIds: ['finance-write-approval'],
            toolPermissionSummaries: ['network_write:deny'],
          },
        }),
      });

    await listRuns();
    await getRun('run-1');
    await listRunEvents('run-1');
    await listRunDag('run-1');
    const frames = await listRunFrames('run-1');
    const actors = await listRunActors('run-1');
    await controlRun('run-1', 'replay');
    await controlRun('run-1', 'execute');
    await listProductFactoryTemplates();
    await previewProductFactoryPlan({ templateId: 'feature', prompt: 'Build delivery package' });
    await createProductFactoryRun({ templateId: 'feature', prompt: 'Build delivery package' });
    await previewOchagReminder({ title: 'Send dinner reminder', familyId: 'fam-1', dueAt: '18:00', visibility: 'family' });
    await createOchagReminderRun({ title: 'Send dinner reminder', familyId: 'fam-1', dueAt: '18:00', visibility: 'family' });
    await getOchagPrivacy();
    await previewCeoclawBrief({ decision: 'Approve supplier contract', evidence: ['contract.pdf'], deadline: 'Friday' });
    await createCeoclawBriefRun({ decision: 'Approve supplier contract', evidence: ['contract.pdf'], deadline: 'Friday' });
    await listOverlays();
    await getOverlay('ochag');
    await getOverlay('ceoclaw');

    expect(frames.frames[0].type).toBe('tool_call');
    expect(actors.actors).toEqual([]);
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/runs'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/runs/run-1'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/runs/run-1/events'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(4, expect.stringContaining('/api/runs/run-1/dag'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(5, expect.stringContaining('/api/runs/run-1/frames'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(6, expect.stringContaining('/api/runs/run-1/actors'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(7, expect.stringContaining('/api/runs/run-1/control'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(8, expect.stringContaining('/api/runs/run-1/control'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[7]?.[1]?.body as string)).toEqual({ action: 'execute' });
    expect(mockFetch).toHaveBeenNthCalledWith(9, expect.stringContaining('/api/product-factory/templates'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(10, expect.stringContaining('/api/product-factory/plan'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(11, expect.stringContaining('/api/runs'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[11]?.[1]?.body as string)).toEqual({
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00',
      visibility: 'family',
    });
    expect(JSON.parse(mockFetch.mock.calls[12]?.[1]?.body as string)).toEqual({
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00',
      visibility: 'family',
    });
    expect(mockFetch).toHaveBeenNthCalledWith(12, expect.stringContaining('/api/ochag/reminders/preview'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(13, expect.stringContaining('/api/ochag/reminders'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(14, expect.stringContaining('/api/ochag/privacy'), expect.any(Object));
    expect(JSON.parse(mockFetch.mock.calls[14]?.[1]?.body as string)).toEqual({
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf'],
      deadline: 'Friday',
    });
    expect(JSON.parse(mockFetch.mock.calls[15]?.[1]?.body as string)).toEqual({
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf'],
      deadline: 'Friday',
    });
    expect(mockFetch).toHaveBeenNthCalledWith(15, expect.stringContaining('/api/ceoclaw/briefs/preview'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(16, expect.stringContaining('/api/ceoclaw/briefs'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(17, expect.stringContaining('/api/overlay-summaries'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(18, expect.stringContaining('/api/overlay-summaries/ochag'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(19, expect.stringContaining('/api/overlay-summaries/ceoclaw'), expect.any(Object));
  });

  it('connector inventory wrapper calls local-only connector inventory endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        checkedAt: '2026-05-04T00:00:00.000Z',
        statusSource: 'local-config',
        connectors: [{
          id: 'telegram',
          name: 'Telegram',
          missingSecrets: ['TELEGRAM_BOT_TOKEN'],
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
    });

    const inventory = await getConnectorInventory();

    expect(inventory.connectors[0]?.liveProbeSkipped).toBe(true);
    expect(inventory.connectors[0]?.readiness.state).toBe('pending');
    expect(inventory.connectors[0]?.probePreview?.requiredEnvVars).toEqual(['TELEGRAM_BOT_TOKEN']);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/connectors/inventory'),
      expect.any(Object),
    );
  });

  it('connector probe wrapper posts approval context to live probe endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'approval_required',
        connectorId: 'telegram',
        approval: { id: 'connector-live-probe:telegram', toolName: 'connector_live_probe', summary: 'Probe Telegram', args: {} },
        liveProbe: true,
      }),
    });

    const response = await probeConnector('telegram', { approvalId: 'connector-live-probe:telegram' });

    expect(response.status).toBe('approval_required');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/connectors/telegram/probe'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      approvalId: 'connector-live-probe:telegram',
    });
  });

  it('skill inspector wrappers fetch metadata-only catalog, slash commands, and recommendation previews', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 1,
          skills: [{
            id: 'debug',
            name: 'Debug',
            description: 'Diagnose failures.',
            whenToUse: ['debugging'],
            tags: ['debugging'],
            stepsCount: 4,
            examplesCount: 1,
            estimatedTokens: 100,
            systemPromptHash: 'a'.repeat(64),
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          commands: [{
            name: 'skills',
            description: 'List skills',
            aliases: [],
            permissionClass: 'auto_allow',
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          output: 'Available governed skills',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          taskPreview: 'Fix a TypeScript error',
          limit: 5,
          recommendations: [],
        }),
      });

    const catalog = await getSkills();
    const slashCommands = await getSlashCommands();
    const slashResult = await invokeSlashCommand({ command: '/skills --limit=3' });
    const recommendation = await recommendSkills({ task: 'Fix a TypeScript error', limit: 5 });

    expect(catalog.skills[0]?.systemPromptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(slashCommands.commands[0]?.name).toBe('skills');
    expect(slashResult.ok).toBe(true);
    expect(recommendation.taskPreview).toBe('Fix a TypeScript error');
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/skills'), expect.objectContaining({ method: 'GET' }));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/slash-commands'), expect.objectContaining({ method: 'GET' }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/slash-commands/invoke'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(4, expect.stringContaining('/api/skills/recommend'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[2]?.[1]?.body as string)).toEqual({
      command: '/skills --limit=3',
    });
    expect(JSON.parse(mockFetch.mock.calls[3]?.[1]?.body as string)).toEqual({
      task: 'Fix a TypeScript error',
      limit: 5,
    });
  });

  it('agent inventory wrapper fetches live subagent summaries', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([{
        id: 'sub-1',
        name: 'Research OpenClaw migration',
        status: 'running',
        startedAt: '2026-05-04T00:00:00.000Z',
      }]),
    });

    const agents = await getAgents();

    expect(agents[0]?.name).toBe('Research OpenClaw migration');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/agents'), expect.objectContaining({ method: 'GET' }));
  });

  it('research search wrapper posts approval context to governed search endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'approval_required',
        runId: 'run-1',
        approval: { id: 'research-search:abc', toolName: 'research_live_search', summary: 'Search', args: {} },
        liveSearch: true,
      }),
    });

    const response = await requestRunResearchSearch('run-1', {
      query: 'OpenClaw memory migration',
      maxResults: 5,
      provider: 'duckduckgo',
      approvalId: 'research-search:abc',
    });

    expect(response.status).toBe('approval_required');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/run-1/research-search'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      query: 'OpenClaw memory migration',
      maxResults: 5,
      provider: 'duckduckgo',
      approvalId: 'research-search:abc',
    });
  });

  it('OpenClaw import report wrapper fetches latest report with project scope', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        artifact: { id: 'openclaw-report-1', kind: 'summary', sha256: 'sha' },
        report: {
          schemaVersion: 'openclaw_migration_report.v1',
          generatedAt: '2026-05-01T00:00:00.000Z',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          sourceRoot: '~/openclaw-workspace',
          counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 },
          entries: [],
          skipped: [],
        },
      }),
    });

    const response = await getOpenClawImportReport({ projectId: 'project-1' });

    expect(response.report.projectId).toBe('project-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/memory/openclaw-import-report?projectId=project-1'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('memory continuity wrapper fetches read-only doctor status with project scope', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspaceId: '/workspace',
        projectId: 'project-1',
        generatedAt: '2026-05-01T00:00:00.000Z',
        workspaceFiles: { present: 1, total: 2, missing: ['SOUL.md'], files: {} },
        latestDailyRollup: { status: 'ok', date: '2026-05-01' },
        latestProjectRollup: { status: 'missing', projectId: 'project-1' },
        latestOpenClawReport: { status: 'missing', projectId: 'project-1' },
        warnings: ['memory_files_missing'],
      }),
    });

    const response = await getMemoryContinuity({ projectId: 'project-1' });

    expect(response.latestProjectRollup.status).toBe('missing');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/memory/continuity?projectId=project-1'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('project memory rollup wrapper posts scoped project request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rollup: {
          workspaceId: '/workspace',
          projectId: 'project-1',
          agentId: 'pyrfor-runtime',
          sessionCount: 1,
          ledgerEventCount: 2,
          runIds: ['run-1'],
          memories: [],
        },
      }),
    });

    const response = await createProjectMemoryRollup({ projectId: 'project-1', sessionLimit: 200 });

    expect(response.rollup.projectId).toBe('project-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/memory/project-rollup'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      projectId: 'project-1',
      sessionLimit: 200,
    });
  });

  it('context pack wrapper fetches selected run context pack', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        artifact: { id: 'context-pack-1', kind: 'context_pack', createdAt: '2026-05-01T00:00:00.000Z' },
        pack: {
          schemaVersion: 'context_pack.v1',
          packId: 'ctx-1',
          hash: 'hash',
          compiledAt: '2026-05-01T00:00:00.000Z',
          workspaceId: 'workspace-1',
          task: { title: 'Task' },
          sections: [],
          sourceRefs: [],
        },
      }),
    });

    const response = await getRunContextPack('run-1');

    expect(response.pack.packId).toBe('ctx-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/run-1/context-pack'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends approvalId when executing a run control action with approval context', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, action: 'execute' }) });

    await controlRun('run-1', 'execute', { approvalId: 'approval-1' });

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/runs/run-1/control'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      action: 'execute',
      approvalId: 'approval-1',
    });
  });

  it('actor mailbox wrappers call actor message endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: { id: 'node-1' }, snapshot: { runId: 'run-1', actors: [], totals: { actors: 0, running: 0, blocked: 0, failed: 0, mailboxPending: 0 } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, recovery: { recovered: [{ id: 'node-1', status: 'pending' }] }, snapshot: { runId: 'run-1', actors: [], totals: { actors: 0, running: 0, blocked: 0, failed: 0, mailboxPending: 1, mailboxStale: 0 } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, lease: { node: { id: 'node-1' } }, snapshot: { runId: 'run-1', actors: [], totals: { actors: 0, running: 0, blocked: 0, failed: 0, mailboxPending: 0 } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, dispatch: { response: 'done' }, snapshot: { runId: 'run-1', actors: [], totals: { actors: 0, running: 0, blocked: 0, failed: 0, mailboxPending: 0 } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, completion: { node: { id: 'node-1' }, proofArtifact: { id: 'proof-1', kind: 'summary' } }, snapshot: { runId: 'run-1', actors: [], totals: { actors: 0, running: 0, blocked: 0, failed: 0, mailboxPending: 0 } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, failure: { id: 'node-2', status: 'pending' }, snapshot: { runId: 'run-1', actors: [], totals: { actors: 0, running: 0, blocked: 0, failed: 0, mailboxPending: 1 } } }) });

    await enqueueRunActorMessage('run-1', { actorId: 'actor-1', task: 'Plan' });
    await recoverStuckRunActorMessages('run-1', { actorId: 'actor-1', olderThanMs: 1000 });
    await leaseRunActorMessage('run-1', { actorId: 'actor-1' });
    await dispatchNextRunActorMessage('run-1', { actorId: 'actor-1' });
    await completeRunActorMessage('run-1', 'node-1', { output: 'done' });
    await failRunActorMessage('run-1', 'node-2', { reason: 'retry', retryable: true });

    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/runs/run-1/actors/messages'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/runs/run-1/actors/recover-stuck'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/runs/run-1/actors/messages/lease'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(4, expect.stringContaining('/api/runs/run-1/actors/messages/dispatch-next'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(5, expect.stringContaining('/api/runs/run-1/actors/messages/node-1/complete'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(6, expect.stringContaining('/api/runs/run-1/actors/messages/node-2/fail'), expect.objectContaining({ method: 'POST' }));
  });

  it('delivery evidence wrappers call run delivery evidence endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifact: null, snapshot: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artifact: { id: 'artifact-evidence', kind: 'delivery_evidence' },
          snapshot: {
            schemaVersion: 'pyrfor.delivery_evidence.v1',
            runId: 'run-1',
            github: { issue: { number: 42 } },
          },
        }),
      });

    await getRunDeliveryEvidence('run-1');
    const captured = await captureRunDeliveryEvidence('run-1', { issueNumber: 42 });

    expect(captured.artifact?.kind).toBe('delivery_evidence');
    expect(captured.snapshot?.github.issue?.number).toBe(42);
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/runs/run-1/delivery-evidence'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/runs/run-1/delivery-evidence'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[1]?.[1]?.body as string)).toEqual({ issueNumber: 42 });
  });

  it('research evidence wrapper calls run research evidence endpoint', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          evidence: [{
            artifact: { id: 'research-1', kind: 'summary' },
            snapshot: {
              schemaVersion: 'pyrfor.research_evidence.v1',
              runId: 'run-1',
              query: 'Pyrfor research',
              sources: [{ url: 'https://example.com/' }],
              effectsExecuted: [],
              notes: [],
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artifact: { id: 'research-1', kind: 'summary' },
          snapshot: {
            schemaVersion: 'pyrfor.research_evidence.v1',
            runId: 'run-1',
            query: 'Pyrfor research',
            sources: [{ url: 'https://example.com/' }],
            effectsExecuted: [],
            notes: [],
          },
        }),
      });

    const listed = await listRunResearchEvidence('run-1');
    await createRunResearchEvidence('run-1', {
      query: 'Pyrfor research',
      sources: [{ url: 'https://example.com/', title: 'Example' }],
    });

    expect(listed.evidence[0]?.snapshot.query).toBe('Pyrfor research');
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/runs/run-1/research-evidence'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/runs/run-1/research-evidence'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('GitHub delivery plan wrappers call dry-run delivery plan endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifact: null, plan: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artifact: { id: 'artifact-plan', kind: 'delivery_plan' },
          plan: { schemaVersion: 'pyrfor.github_delivery_plan.v1', mode: 'dry_run', applySupported: false },
        }),
      });

    await getRunGithubDeliveryPlan('run-1');
    const planned = await createRunGithubDeliveryPlan('run-1', { issueNumber: 42 });

    expect(planned.plan?.applySupported).toBe(false);
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/runs/run-1/github-delivery-plan'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/runs/run-1/github-delivery-plan'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[1]?.[1]?.body as string)).toEqual({ issueNumber: 42 });
  });

  it('GitHub delivery apply wrappers call approval-gated apply endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifact: null, result: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'awaiting_approval',
          approval: { id: 'approval-1', toolName: 'github_delivery_apply', summary: 'Create draft PR', args: {} },
          planArtifactId: 'artifact-plan',
          expectedPlanSha256: 'plan-sha',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'applied',
          artifact: { id: 'artifact-apply', kind: 'delivery_apply' },
          result: {
            schemaVersion: 'pyrfor.github_delivery_apply.v1',
            draftPullRequest: { number: 12, url: 'https://github.com/acme/pyrfor/pull/12', title: 'Ship feature' },
          },
        }),
      });

    await getRunGithubDeliveryApply('run-1');
    const pending = await requestRunGithubDeliveryApply('run-1', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    });
    const applied = await requestRunGithubDeliveryApply('run-1', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    });

    expect(pending.status).toBe('awaiting_approval');
    expect(applied.status).toBe('applied');
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/runs/run-1/github-delivery-apply'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/runs/run-1/github-delivery-apply'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/runs/run-1/github-delivery-apply'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[1]?.[1]?.body as string)).toEqual({
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    });
    expect(JSON.parse(mockFetch.mock.calls[2]?.[1]?.body as string)).toEqual({
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    });
  });

  it('verifier waiver wrappers call verifier policy endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          decision: {
            status: 'blocked',
            rawStatus: 'blocked',
            waiverEligible: true,
            waiverPath: '/api/runs/run-1/verifier-waiver',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
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
          decision: { status: 'waived', rawStatus: 'blocked', waiverEligible: true },
          run: { run_id: 'run-1', status: 'completed' },
        }),
      });

    const status = await getRunVerifierStatus('run-1');
    const waiver = await createRunVerifierWaiver('run-1', {
      operatorId: 'operator',
      reason: 'Accepted known risk',
      scope: 'all',
    });

    expect(status.decision.status).toBe('blocked');
    expect(waiver.waiver.schemaVersion).toBe('pyrfor.verifier_waiver.v1');
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/runs/run-1/verifier-status'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/runs/run-1/verifier-waiver'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[1]?.[1]?.body as string)).toEqual({
      operatorId: 'operator',
      reason: 'Accepted known risk',
      scope: 'all',
    });
  });

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found', code: 'ENOENT' }),
    });
    await expect(fsRead('/missing')).rejects.toThrow('Not found');
  });
});
