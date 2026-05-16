import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import McpServersPanel from '../McpServersPanel';

const mockGetMcpStatus = vi.fn();
const mockPostMcpServerRestart = vi.fn();

vi.mock('../../lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
  getMcpStatus: (...args: unknown[]) => mockGetMcpStatus(...args),
  postMcpServerRestart: (...args: unknown[]) => mockPostMcpServerRestart(...args),
}));

describe('McpServersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMcpStatus.mockResolvedValue({
      servers: [{ name: 'alpha', connected: true, toolCount: 3 }],
    });
    mockPostMcpServerRestart.mockResolvedValue({ ok: true });
  });

  it('invokes open settings callback from hint link', async () => {
    const onOpen = vi.fn();
    render(<McpServersPanel onOpenMcpSettings={onOpen} />);
    await waitFor(() => {
      expect(mockGetMcpStatus).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByTestId('mcp-open-settings'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders MCP server rows', async () => {
    render(<McpServersPanel />);
    await waitFor(() => {
      expect(mockGetMcpStatus).toHaveBeenCalled();
    });
    expect(screen.getByTestId('mcp-servers-panel')).toBeTruthy();
    expect(await screen.findByText('alpha')).toBeTruthy();
  });

  it('Restart calls postMcpServerRestart and refreshes status', async () => {
    render(<McpServersPanel />);
    await waitFor(() => {
      expect(mockGetMcpStatus).toHaveBeenCalled();
    });
    const btn = await screen.findByTestId('mcp-restart-alpha');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockPostMcpServerRestart).toHaveBeenCalledWith('alpha');
    });
    await waitFor(() => {
      expect(mockGetMcpStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('disables Restart buttons while a restart is in-flight', async () => {
    let resolveRestart!: (v: { ok: true }) => void;
    mockPostMcpServerRestart.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveRestart = resolve;
      }),
    );
    mockGetMcpStatus.mockResolvedValue({
      servers: [
        { name: 'alpha', connected: true, toolCount: 1 },
        { name: 'beta', connected: false, toolCount: 0 },
      ],
    });
    render(<McpServersPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-restart-alpha')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('mcp-restart-alpha'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-restart-beta').hasAttribute('disabled')).toBe(true);
    });
    resolveRestart!({ ok: true });
    await waitFor(() => {
      expect(screen.getByTestId('mcp-restart-beta').hasAttribute('disabled')).toBe(false);
    });
  });
});
