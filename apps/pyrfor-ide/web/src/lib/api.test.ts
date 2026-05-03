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
  listRuns,
  getRun,
  listRunEvents,
  listRunDag,
  listRunFrames,
  listRunActors,
  getRunDeliveryEvidence,
  captureRunDeliveryEvidence,
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
  previewCeoclawBrief,
  createCeoclawBriefRun,
  listOverlays,
  getOverlay,
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [] }) });

    await listPendingApprovals();
    await listPendingEffects();
    await decideApproval('req-1', 'approve');
    await listAuditEvents(25);

    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/approvals/pending'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/effects/pending'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/approvals/req-1/decision'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(4, expect.stringContaining('/api/audit/events?limit=25'), expect.any(Object));
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overlay: { domainId: 'ochag', adapterRegistrations: [{}] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overlay: { domainId: 'ceoclaw', adapterRegistrations: [{}] } }) });

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
    expect(mockFetch).toHaveBeenNthCalledWith(17, expect.stringContaining('/api/overlays'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(18, expect.stringContaining('/api/overlays/ochag'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(19, expect.stringContaining('/api/overlays/ceoclaw'), expect.any(Object));
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
