import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fsList,
  fsRead,
  chat,
  exec,
  detectLanguage,
  listPendingApprovals,
  decideApproval,
  listAuditEvents,
  listRuns,
  getRun,
  listRunEvents,
  listRunDag,
  listRunFrames,
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, decision: 'approve' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [] }) });

    await listPendingApprovals();
    await decideApproval('req-1', 'approve');
    await listAuditEvents(25);

    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/approvals/pending'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/approvals/req-1/decision'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/audit/events?limit=25'), expect.any(Object));
  });

  it('orchestration wrappers call run and overlay endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { run_id: 'run-1' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ nodes: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ frames: [{ frame_id: 'frame-1', type: 'tool_call' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, action: 'replay', run: { run_id: 'run-1' } }) })
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
    await controlRun('run-1', 'replay');
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
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/runs'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/runs/run-1'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/runs/run-1/events'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(4, expect.stringContaining('/api/runs/run-1/dag'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(5, expect.stringContaining('/api/runs/run-1/frames'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(6, expect.stringContaining('/api/runs/run-1/control'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(7, expect.stringContaining('/api/product-factory/templates'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(8, expect.stringContaining('/api/product-factory/plan'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(9, expect.stringContaining('/api/runs'), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[9]?.[1]?.body as string)).toEqual({
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00',
      visibility: 'family',
    });
    expect(JSON.parse(mockFetch.mock.calls[10]?.[1]?.body as string)).toEqual({
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00',
      visibility: 'family',
    });
    expect(mockFetch).toHaveBeenNthCalledWith(10, expect.stringContaining('/api/ochag/reminders/preview'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(11, expect.stringContaining('/api/ochag/reminders'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(12, expect.stringContaining('/api/ochag/privacy'), expect.any(Object));
    expect(JSON.parse(mockFetch.mock.calls[12]?.[1]?.body as string)).toEqual({
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf'],
      deadline: 'Friday',
    });
    expect(JSON.parse(mockFetch.mock.calls[13]?.[1]?.body as string)).toEqual({
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf'],
      deadline: 'Friday',
    });
    expect(mockFetch).toHaveBeenNthCalledWith(13, expect.stringContaining('/api/ceoclaw/briefs/preview'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(14, expect.stringContaining('/api/ceoclaw/briefs'), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(15, expect.stringContaining('/api/overlays'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(16, expect.stringContaining('/api/overlays/ochag'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(17, expect.stringContaining('/api/overlays/ceoclaw'), expect.any(Object));
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
