import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TraceTimeline from '../TraceTimeline';

const mockGetTelemetrySpans = vi.fn();

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
  getTelemetrySpans: (...args: unknown[]) => mockGetTelemetrySpans(...args),
}));

describe('TraceTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTelemetrySpans.mockResolvedValue({
      limit: 100,
      spans: [
        {
          id: 's1',
          traceId: 'trace-full-id',
          name: 'lifecycle.plan',
          startMs: 0,
          endMs: 10,
          durationMs: 10,
          attrs: {},
          events: [],
          status: 'ok' as const,
        },
      ],
    });
  });

  it('loads and renders span rows', async () => {
    render(<TraceTimeline />);
    await waitFor(() => {
      expect(mockGetTelemetrySpans).toHaveBeenCalled();
    });
    expect(await screen.findByText('lifecycle.plan')).toBeTruthy();
  });

  it('shows error when API fails', async () => {
    const { ApiError } = await import('../../lib/api');
    mockGetTelemetrySpans.mockRejectedValueOnce(new ApiError('nope', 'err', 500));
    render(<TraceTimeline />);
    const err = await screen.findByTestId('trace-error');
    expect(err.textContent).toContain('nope');
  });
});
