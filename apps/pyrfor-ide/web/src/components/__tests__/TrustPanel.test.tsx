import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockListPendingApprovals = vi.fn();
const mockDecideApproval = vi.fn();
const mockListAuditEvents = vi.fn();
const mockStreamOperatorEvents = vi.fn();

vi.mock('../../lib/api', () => ({
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  decideApproval: (...args: unknown[]) => mockDecideApproval(...args),
  listAuditEvents: (...args: unknown[]) => mockListAuditEvents(...args),
  streamOperatorEvents: (...args: unknown[]) => mockStreamOperatorEvents(...args),
}));

import TrustPanel from '../TrustPanel';

describe('TrustPanel', () => {
  beforeEach(() => {
    mockListPendingApprovals.mockReset();
    mockDecideApproval.mockReset();
    mockListAuditEvents.mockReset();
    mockStreamOperatorEvents.mockReset();
    mockListPendingApprovals.mockResolvedValue({
      approvals: [
        { id: 'req-1', toolName: 'exec', summary: 'exec: npm install', args: { command: 'npm install' } },
      ],
    });
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

  it('sends approve decision and refreshes', async () => {
    render(<TrustPanel />);

    await waitFor(() => expect(screen.getByText('exec: npm install')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));

    await waitFor(() => {
      expect(mockDecideApproval).toHaveBeenCalledWith('req-1', 'approve');
      expect(mockListPendingApprovals).toHaveBeenCalledTimes(2);
    });
  });

  it('updates pending approvals from operator stream snapshots', async () => {
    let onEvent: ((event: { type: string; approvals?: unknown[] }) => void) | undefined;
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
    });

    await waitFor(() => {
      expect(screen.getByText('shell_exec: git push')).toBeTruthy();
    });
  });
});
