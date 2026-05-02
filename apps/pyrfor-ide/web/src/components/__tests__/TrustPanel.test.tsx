import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockListPendingApprovals = vi.fn();
const mockDecideApproval = vi.fn();
const mockListAuditEvents = vi.fn();

vi.mock('../../lib/api', () => ({
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  decideApproval: (...args: unknown[]) => mockDecideApproval(...args),
  listAuditEvents: (...args: unknown[]) => mockListAuditEvents(...args),
}));

import TrustPanel from '../TrustPanel';

describe('TrustPanel', () => {
  beforeEach(() => {
    mockListPendingApprovals.mockReset();
    mockDecideApproval.mockReset();
    mockListAuditEvents.mockReset();
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
  });

  it('renders pending approvals and audit timeline', async () => {
    render(<TrustPanel />);

    await waitFor(() => {
      expect(screen.getByText('exec: npm install')).toBeTruthy();
      expect(screen.getByText(/Result: \{"ok":true\}/)).toBeTruthy();
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
});
