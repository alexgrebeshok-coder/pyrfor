import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockListPendingApprovals = vi.fn();
const mockListPendingEffects = vi.fn();
const mockDecideApproval = vi.fn();
const mockListAuditEvents = vi.fn();
const mockStreamOperatorEvents = vi.fn();

vi.mock('../../lib/api', () => ({
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  listPendingEffects: (...args: unknown[]) => mockListPendingEffects(...args),
  decideApproval: (...args: unknown[]) => mockDecideApproval(...args),
  listAuditEvents: (...args: unknown[]) => mockListAuditEvents(...args),
  streamOperatorEvents: (...args: unknown[]) => mockStreamOperatorEvents(...args),
}));

import TrustPanel from '../TrustPanel';

describe('TrustPanel', () => {
  beforeEach(() => {
    mockListPendingApprovals.mockReset();
    mockListPendingEffects.mockReset();
    mockDecideApproval.mockReset();
    mockListAuditEvents.mockReset();
    mockStreamOperatorEvents.mockReset();
    mockListPendingApprovals.mockResolvedValue({
      approvals: [
        { id: 'req-1', toolName: 'exec', summary: 'exec: npm install', args: { command: 'npm install' } },
      ],
    });
    mockListPendingEffects.mockResolvedValue({ effects: [] });
    mockListAuditEvents.mockResolvedValue({
      events: [
        {
          id: 'event-1',
          ts: '2026-05-01T00:00:00.000Z',
          type: 'tool.executed',
          summary: 'exec: npm test',
          decision: 'approve',
          resultSummary: '{"ok":true}',
        },
      ],
    });
    mockDecideApproval.mockResolvedValue({ ok: true, decision: 'approve' });
    mockStreamOperatorEvents.mockImplementation(() => new Promise<void>(() => {}));
  });

  it('renders pending approvals and audit timeline', async () => {
    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getByText('exec: npm install')).toBeTruthy();
      expect(screen.getByText(/Result: \{"ok":true\}/)).toBeTruthy();
    });
    expect(mockListAuditEvents).toHaveBeenCalledWith(50, {});
  });

  it('filters and clears the audit timeline by approval request id', async () => {
    mockListPendingApprovals.mockResolvedValue({
      approvals: [
        { id: 'req-filter-1', toolName: 'exec', summary: 'exec: npm run build', args: { command: 'npm run build' } },
      ],
    });
    mockListAuditEvents
      .mockResolvedValueOnce({
        events: [{
          id: 'event-unfiltered',
          ts: '2026-05-01T00:00:00.000Z',
          type: 'approval.requested',
          requestId: 'req-filter-1',
          summary: 'unfiltered event',
        }],
      })
      .mockResolvedValueOnce({ events: [] })
      .mockResolvedValueOnce({
        events: [{
          id: 'event-unfiltered-again',
          ts: '2026-05-01T00:00:00.000Z',
          type: 'approval.requested',
          requestId: 'req-filter-1',
          summary: 'unfiltered event again',
        }],
      });

    render(<TrustPanel />);

    await waitFor(() => expect(screen.getByText('exec: npm run build')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: /Filter timeline/i })[0]!);

    await waitFor(() => {
      expect(mockListAuditEvents).toHaveBeenCalledWith(50, { requestId: 'req-filter-1' });
      expect(screen.getByText('Filtered request: req-filter-1')).toBeTruthy();
      expect(screen.getByText('No audit events for this request.')).toBeTruthy();
      expect(screen.queryByText('unfiltered event')).toBeNull();
    });
    expect(mockListPendingApprovals).toHaveBeenCalledTimes(1);
    expect(mockListPendingEffects).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Clear filter/i }));

    await waitFor(() => {
      expect(mockListAuditEvents).toHaveBeenLastCalledWith(50, {});
      expect(screen.queryByText('Filtered request: req-filter-1')).toBeNull();
      expect(screen.getByText('unfiltered event again')).toBeTruthy();
    });
    expect(mockListPendingApprovals).toHaveBeenCalledTimes(1);
    expect(mockListPendingEffects).toHaveBeenCalledTimes(1);
    expect(mockStreamOperatorEvents).toHaveBeenCalledTimes(1);
  });

  it('ignores stale audit refresh responses after the filter changes', async () => {
    let resolveFiltered: (value: unknown) => void = () => {};
    const filteredAudit = new Promise((resolve) => { resolveFiltered = resolve; });
    let unfilteredCalls = 0;
    mockListPendingApprovals.mockResolvedValue({
      approvals: [
        { id: 'req-race-1', toolName: 'exec', summary: 'exec: npm test', args: { command: 'npm test' } },
      ],
    });
    mockListAuditEvents.mockImplementation((_limit: number, opts?: { requestId?: string }) => {
      if (opts?.requestId === 'req-race-1') return filteredAudit;
      unfilteredCalls += 1;
      return Promise.resolve({
        events: [{
          id: `event-unfiltered-${unfilteredCalls}`,
          ts: '2026-05-01T00:00:00.000Z',
          type: 'approval.requested',
          requestId: 'req-race-1',
          summary: unfilteredCalls === 1 ? 'initial unfiltered event' : 'clear unfiltered event',
        }],
      });
    });

    render(<TrustPanel />);

    await waitFor(() => expect(screen.getByText('initial unfiltered event')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: /Filter timeline/i })[0]!);
    await waitFor(() => expect(screen.getByText('Filtered request: req-race-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Clear filter/i }));
    await waitFor(() => expect(screen.getByText('clear unfiltered event')).toBeTruthy());

    resolveFiltered({
      events: [{
        id: 'event-stale-filtered',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'req-race-1',
        summary: 'stale filtered event',
      }],
    });

    await waitFor(() => {
      expect(screen.queryByText('stale filtered event')).toBeNull();
      expect(screen.getByText('clear unfiltered event')).toBeTruthy();
    });
  });

  it('keeps audit drill-down usable when pending approvals are unavailable', async () => {
    const onToast = vi.fn();
    mockListPendingApprovals.mockRejectedValue(new Error('approvals down'));
    mockListAuditEvents
      .mockResolvedValueOnce({
        events: [{
          id: 'audit-filter-source',
          ts: '2026-05-01T00:00:00.000Z',
          type: 'approval.requested',
          requestId: 'req-audit-only',
          summary: 'audit source event',
        }],
      })
      .mockResolvedValueOnce({
        events: [{
          id: 'audit-filtered',
          ts: '2026-05-01T00:00:00.000Z',
          type: 'approval.resolved',
          requestId: 'req-audit-only',
          summary: 'filtered audit event',
        }],
      });

    render(<TrustPanel onToast={onToast} />);

    await waitFor(() => expect(screen.getByText('audit source event')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Filter timeline/i }));

    await waitFor(() => {
      expect(mockListAuditEvents).toHaveBeenCalledWith(50, { requestId: 'req-audit-only' });
      expect(screen.getByText('filtered audit event')).toBeTruthy();
      expect(onToast).toHaveBeenCalledWith(expect.stringContaining('Pending approvals unavailable'), 'error');
    });
  });

  it('does not overwrite a newer live approval snapshot with an older HTTP refresh', async () => {
    let onEvent: ((event: { type: 'snapshot'; approvals?: unknown[]; effects?: unknown[] }) => void) | undefined;
    let resolvePending: (value: unknown) => void = () => {};
    const pendingRefresh = new Promise((resolve) => { resolvePending = resolve; });
    mockListPendingApprovals.mockImplementationOnce(() => pendingRefresh);
    mockListPendingEffects.mockResolvedValue({ effects: [] });
    mockListAuditEvents.mockResolvedValue({ events: [] });
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });

    render(<TrustPanel />);

    await waitFor(() => expect(onEvent).toBeTruthy());
    onEvent?.({
      type: 'snapshot',
      approvals: [{
        id: 'req-live-new',
        toolName: 'exec',
        summary: 'live approval snapshot',
        args: { command: 'npm test' },
      }],
      effects: [],
    });
    await waitFor(() => expect(screen.getByText('live approval snapshot')).toBeTruthy());

    resolvePending({
      approvals: [{
        id: 'req-http-old',
        toolName: 'exec',
        summary: 'old HTTP approval',
        args: { command: 'npm install' },
      }],
    });

    await waitFor(() => {
      expect(screen.getByText('live approval snapshot')).toBeTruthy();
      expect(screen.queryByText('old HTTP approval')).toBeNull();
    });
  });

  it('does not let audit-only filter refresh cancel an in-flight full refresh', async () => {
    let resolveFullPending: (value: unknown) => void = () => {};
    const fullPending = new Promise((resolve) => { resolveFullPending = resolve; });
    mockListPendingApprovals
      .mockResolvedValueOnce({
        approvals: [{
          id: 'req-initial',
          toolName: 'exec',
          summary: 'initial approval',
          args: { command: 'npm install' },
        }],
      })
      .mockImplementationOnce(() => fullPending);
    mockListPendingEffects.mockResolvedValue({ effects: [] });
    mockListAuditEvents.mockImplementation((_limit: number, opts?: { requestId?: string }) => Promise.resolve({
      events: [{
        id: opts?.requestId ? 'event-filtered' : 'event-unfiltered',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'req-initial',
        summary: opts?.requestId ? 'filtered event during full refresh' : 'unfiltered event',
      }],
    }));

    render(<TrustPanel />);

    await waitFor(() => expect(screen.getByText('initial approval')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Filter timeline/i })[0]!);
    await waitFor(() => expect(screen.getByText('filtered event during full refresh')).toBeTruthy());

    resolveFullPending({
      approvals: [{
        id: 'req-full-new',
        toolName: 'exec',
        summary: 'full refresh approval',
        args: { command: 'npm test' },
      }],
    });

    await waitFor(() => {
      expect(screen.getByText('full refresh approval')).toBeTruthy();
      expect(screen.queryByText('initial approval')).toBeNull();
      expect(screen.getByText('filtered event during full refresh')).toBeTruthy();
      expect(screen.queryByText('unfiltered event')).toBeNull();
    });
  });

  it('renders safe trace metadata for pending approvals and audit events', async () => {
    mockListPendingApprovals.mockResolvedValueOnce({
      approvals: [{
        id: 'effect-approval-1',
        toolName: 'exec',
        summary: 'Run guarded command',
        args: { command: 'npm test' },
        run_id: 'run-1',
        effect_id: 'effect-1',
        effect_kind: 'shell_command',
        policy_id: 'workspace-write',
        reason: 'Command requires approval',
      }],
    });
    mockListAuditEvents.mockResolvedValueOnce({
      events: [{
        id: 'audit-effect-1',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'tool.requested',
        summary: 'Capability requested',
        run_id: 'run-1',
        seq: 22,
        effect_id: 'effect-1',
        artifact_id: 'artifact-1',
        status: 'pending',
        capability: 'browser_qa',
        frameId: 'frame-1',
        approval_id: 'approval-1',
      }],
    });

    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getAllByText('Run: run-1')).toHaveLength(2);
      expect(screen.getAllByText('Effect: effect-1')).toHaveLength(2);
      expect(screen.getByText('Effect kind: shell_command')).toBeTruthy();
      expect(screen.getByText('Policy: workspace-write')).toBeTruthy();
      expect(screen.getByText('Reason: Command requires approval')).toBeTruthy();
      expect(screen.getByText('Seq: 22')).toBeTruthy();
      expect(screen.getByText('Artifact: artifact-1')).toBeTruthy();
      expect(screen.getByText('Status: pending')).toBeTruthy();
      expect(screen.getByText('Capability: browser_qa')).toBeTruthy();
      expect(screen.getByText('Frame: frame-1')).toBeTruthy();
      expect(screen.getByText('Approval: approval-1')).toBeTruthy();
    });
  });

  it('renders pending effects without internal idempotency keys', async () => {
    mockListPendingEffects.mockResolvedValueOnce({
      effects: [{
        id: 'pending-effect-1',
        effect_id: 'effect-1',
        run_id: 'run-1',
        effect_kind: 'shell_command',
        tool: 'exec',
        preview: 'Run npm test with token=[redacted]',
        idempotency_key: 'internal-effect-key-1',
        proposed_seq: 12,
        decision: 'pending',
        policy_id: 'workspace-write',
        reason: 'Effect requires operator approval',
        ts: '2026-05-01T00:00:00.000Z',
        approval_required: true,
      }],
    });

    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getByText('Pending effects')).toBeTruthy();
      expect(screen.getByText('shell_command')).toBeTruthy();
      expect(screen.getByText('Run npm test with token=[redacted]')).toBeTruthy();
      expect(screen.getByText('Run: run-1')).toBeTruthy();
      expect(screen.getByText('Effect: effect-1')).toBeTruthy();
      expect(screen.getByText('Tool: exec')).toBeTruthy();
      expect(screen.getByText('Policy: workspace-write')).toBeTruthy();
      expect(screen.getByText('Reason: Effect requires operator approval')).toBeTruthy();
      expect(screen.getByText('Timestamp: 2026-05-01T00:00:00.000Z')).toBeTruthy();
      expect(screen.getByText('Approval required: true')).toBeTruthy();
      expect(screen.getByText('Proposed seq: 12')).toBeTruthy();
      expect(screen.queryByText(/internal-effect-key-1/)).toBeNull();
    });
  });

  it('keeps approvals, audit and previous effects visible when pending effects are unavailable', async () => {
    const onToast = vi.fn();
    mockListPendingEffects
      .mockResolvedValueOnce({
        effects: [{
          id: 'pending-effect-preserved',
          effect_id: 'effect-preserved',
          effect_kind: 'shell_command',
          tool: 'exec',
          preview: 'Preserved effect preview',
        }],
      })
      .mockRejectedValueOnce(new Error('effects down'));

    render(<TrustPanel onToast={onToast} />);

    await waitFor(() => {
      expect(screen.getByText('exec: npm install')).toBeTruthy();
      expect(screen.getByText(/Result: \{"ok":true\}/)).toBeTruthy();
      expect(screen.getByText('Preserved effect preview')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));

    await waitFor(() => {
      expect(screen.getByText('exec: npm install')).toBeTruthy();
      expect(screen.getByText(/Result: \{"ok":true\}/)).toBeTruthy();
      expect(screen.getByText('Preserved effect preview')).toBeTruthy();
      expect(onToast).toHaveBeenCalledWith(expect.stringContaining('Pending effects unavailable'), 'error');
    });
  });

  it('renders safe structured metadata for connector and research approvals', async () => {
    mockListPendingApprovals.mockResolvedValueOnce({
      approvals: [{
        id: 'connector-live-probe:telegram',
        toolName: 'connector_live_probe',
        summary: 'Run live connector probe for Telegram',
        args: {
          connectorId: 'telegram',
          connectorName: 'Telegram',
          sourceSystem: 'Telegram Bot API',
          liveProbe: true,
        },
      }],
    });
    mockListAuditEvents.mockResolvedValueOnce({
      events: [{
        id: 'audit-search',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'research-search:hash',
        toolName: 'research_live_search',
        summary: 'Run governed web search for run-1',
        args: {
          runId: 'run-1',
          queryHash: 'abc123',
          provider: 'brave',
          maxResults: 5,
        },
      }],
    });

    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getByText('Connector: Telegram')).toBeTruthy();
      expect(screen.getByText('Source: Telegram Bot API')).toBeTruthy();
      expect(screen.getByText('Action: live connector probe requires explicit approval.')).toBeTruthy();
      expect(screen.getByText('Run: run-1')).toBeTruthy();
      expect(screen.getByText('Query hash: abc123')).toBeTruthy();
      expect(screen.queryByText(/\{"connectorId"/)).toBeNull();
    });
  });

  it('renders safe structured metadata for GitHub delivery apply approvals', async () => {
    const githubArgs = {
      runId: 'run-1',
      planArtifactId: 'delivery-plan-1.json',
      expectedPlanSha256: 'sha256-plan',
      repository: 'owner/repo',
      baseBranch: 'main',
      proposedBranch: 'pyrfor/run-1',
      headSha: 'abc1234',
      idempotencyKey: 'apply-key-1',
    };
    mockListPendingApprovals.mockResolvedValueOnce({
      approvals: [{
        id: 'github-delivery-apply:run-1',
        toolName: 'github_delivery_apply',
        summary: 'Create draft GitHub PR for owner/repo:pyrfor/run-1',
        args: githubArgs,
      }],
    });
    mockListAuditEvents.mockResolvedValueOnce({
      events: [{
        id: 'audit-github-apply',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'github-delivery-apply:run-1',
        toolName: 'github_delivery_apply',
        summary: 'Create draft GitHub PR for owner/repo:pyrfor/run-1',
        args: githubArgs,
      }],
    });

    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getAllByText('Repository: owner/repo')).toHaveLength(2);
      expect(screen.getAllByText('Base branch: main')).toHaveLength(2);
      expect(screen.getAllByText('Proposed branch: pyrfor/run-1')).toHaveLength(2);
      expect(screen.getAllByText('Head SHA: abc1234')).toHaveLength(2);
      expect(screen.getAllByText('Plan artifact: delivery-plan-1.json')).toHaveLength(2);
      expect(screen.queryByText(/Idempotency key:/)).toBeNull();
      expect(screen.queryByText(/apply-key-1/)).toBeNull();
      expect(screen.queryByText(/\{"runId"/)).toBeNull();
    });
  });

  it('renders safe structured metadata for CEOClaw business brief approvals', async () => {
    const ceoclawArgs = {
      runId: 'run-business-1',
      projectId: 'ceoclaw',
      decision: 'Approve Q2 pricing brief',
      evidenceRefs: ['memory://private-ref-token-1', 'https://secret.example.com/evidence?token=hidden'],
      evidenceArtifactId: 'ceoclaw-evidence-1',
      deadline: '2026-05-05T12:00:00.000Z',
    };
    mockListPendingApprovals.mockResolvedValueOnce({
      approvals: [{
        id: 'ceoclaw-business-brief:run-business-1',
        toolName: 'ceoclaw_business_brief_approval',
        summary: 'Approve CEOClaw brief for ceoclaw',
        args: ceoclawArgs,
      }],
    });
    mockListAuditEvents.mockResolvedValueOnce({
      events: [{
        id: 'audit-ceoclaw',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'ceoclaw-business-brief:run-business-1',
        toolName: 'ceoclaw_business_brief_approval',
        summary: 'Approve CEOClaw brief for ceoclaw',
        args: ceoclawArgs,
      }],
    });

    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getAllByText('Run: run-business-1')).toHaveLength(2);
      expect(screen.getAllByText('Project: ceoclaw')).toHaveLength(2);
      expect(screen.getAllByText('Decision: Approve Q2 pricing brief')).toHaveLength(2);
      expect(screen.getAllByText('Evidence refs: 2')).toHaveLength(2);
      expect(screen.getAllByText('Evidence artifact: ceoclaw-evidence-1')).toHaveLength(2);
      expect(screen.getAllByText('Deadline: 2026-05-05T12:00:00.000Z')).toHaveLength(2);
      expect(screen.queryByText(/private-ref-token-1|secret\.example|token=hidden/)).toBeNull();
      expect(screen.queryByText(/\{"runId"/)).toBeNull();
    });
  });

  it('does not render raw args for unknown approval types', async () => {
    mockListPendingApprovals.mockResolvedValueOnce({
      approvals: [{
        id: 'unknown-approval',
        toolName: 'future_tool',
        summary: 'Future approval needs review',
        args: {
          command: 'cat /Users/aleksandrgrebeshok/.ssh/id_rsa',
          token: 'ghp_secret-token',
          idempotencyKey: 'future-key-1',
          approvalContext: {
            localPath: '/tmp/pyrfor-private-workspace',
          },
        },
      }],
    });
    mockListAuditEvents.mockResolvedValueOnce({
      events: [{
        id: 'unknown-audit',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'unknown-approval',
        toolName: 'future_tool',
        summary: 'Future approval needs review',
        args: {
          authorization: 'Bearer secret',
          fileUri: 'file:///tmp/private-artifact.json',
          workspaceId: '/Users/aleksandrgrebeshok/pyrfor-dev',
        },
      }],
    });

    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getAllByText('Additional metadata hidden until this approval type has a safe renderer.')).toHaveLength(2);
      expect(screen.queryByText(/ghp_secret-token/)).toBeNull();
      expect(screen.queryByText(/future-key-1/)).toBeNull();
      expect(screen.queryByText(/id_rsa/)).toBeNull();
      expect(screen.queryByText(/file:\/\/\/tmp\/private-artifact/)).toBeNull();
      expect(screen.queryByText(/pyrfor-private-workspace/)).toBeNull();
      expect(screen.queryByText(/\{"command"/)).toBeNull();
      expect(screen.queryByText(/\{"authorization"/)).toBeNull();
    });
  });

  it('sends approve decision and refreshes', async () => {
    render(<TrustPanel />);

    await waitFor(() => expect(screen.getByText('exec: npm install')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));

    await waitFor(() => {
      expect(mockDecideApproval).toHaveBeenCalledWith('req-1', 'approve');
      expect(mockListPendingApprovals).toHaveBeenCalledTimes(2);
    });
  });

  it('updates pending approvals and effects from operator stream snapshots', async () => {
    let onEvent: ((event: { type: string; approvals?: unknown[]; effects?: unknown[] }) => void) | undefined;
    mockStreamOperatorEvents.mockImplementation((params: { onEvent: typeof onEvent }) => {
      onEvent = params.onEvent;
      return new Promise<void>(() => {});
    });

    render(<TrustPanel />);
    await waitFor(() => expect(screen.getByText('exec: npm install')).toBeTruthy());

    onEvent?.({
      type: 'snapshot',
      approvals: [
        { id: 'req-2', toolName: 'shell_exec', summary: 'shell_exec: git push', args: { command: 'git push' } },
      ],
      effects: [
        {
          id: 'pending-effect-2',
          effect_id: 'effect-2',
          effect_kind: 'file_patch',
          tool: 'apply_patch',
          preview: 'Patch src/app.ts',
          idempotency_key: 'snapshot-effect-key-1',
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('shell_exec: git push')).toBeTruthy();
      expect(screen.getByText('Patch src/app.ts')).toBeTruthy();
      expect(screen.queryByText(/snapshot-effect-key-1/)).toBeNull();
    });
  });
});
