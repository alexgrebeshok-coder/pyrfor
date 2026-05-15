import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import McpServersPanel from '../McpServersPanel';

const mockGetMcpStatus = vi.fn();

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
}));

describe('McpServersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMcpStatus.mockResolvedValue({
      servers: [{ name: 'alpha', connected: true, toolCount: 3 }],
    });
  });

  it('renders MCP server rows', async () => {
    render(<McpServersPanel />);
    await waitFor(() => {
      expect(mockGetMcpStatus).toHaveBeenCalled();
    });
    expect(screen.getByTestId('mcp-servers-panel')).toBeTruthy();
    expect(await screen.findByText('alpha')).toBeTruthy();
  });
});
