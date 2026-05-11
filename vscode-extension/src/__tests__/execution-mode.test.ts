import { describe, expect, it, vi } from 'vitest';
import {
  executionModeEndpointFromDaemonUrl,
  fetchExecutionMode,
  type FetchLike,
} from '../execution-mode';

describe('executionModeEndpointFromDaemonUrl', () => {
  it('maps ws daemon URL to the HTTP execution-mode endpoint', () => {
    expect(executionModeEndpointFromDaemonUrl('ws://127.0.0.1:18790/ws')).toBe(
      'http://127.0.0.1:18790/api/settings/execution-mode',
    );
  });

  it('maps wss daemon URL to the HTTPS execution-mode endpoint', () => {
    expect(executionModeEndpointFromDaemonUrl('wss://example.test/socket?token=secret')).toBe(
      'https://example.test/api/settings/execution-mode',
    );
  });

  it('keeps HTTP daemon URL as HTTP', () => {
    expect(executionModeEndpointFromDaemonUrl('http://localhost:18790/')).toBe(
      'http://localhost:18790/api/settings/execution-mode',
    );
  });
});

describe('fetchExecutionMode', () => {
  it('returns a valid execution mode from the gateway response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { executionMode: 'freeclaude' };
      },
    })) satisfies FetchLike;

    await expect(fetchExecutionMode('ws://127.0.0.1:18790/', fetchImpl)).resolves.toBe('freeclaude');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:18790/api/settings/execution-mode',
      { headers: { Accept: 'application/json' } },
    );
  });

  it('rejects invalid execution mode responses', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { executionMode: 'legacy' };
      },
    })) satisfies FetchLike;

    await expect(fetchExecutionMode('ws://127.0.0.1:18790/', fetchImpl)).rejects.toThrow(
      'Invalid execution mode response',
    );
  });
});
