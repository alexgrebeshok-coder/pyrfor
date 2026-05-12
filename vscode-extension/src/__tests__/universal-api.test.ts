import { describe, expect, it, vi } from 'vitest';
import { gatewayHttpBaseFromDaemonUrl, SseParser, UniversalApiClient, type FetchLike } from '../universal-api';

describe('gatewayHttpBaseFromDaemonUrl', () => {
  it('converts websocket daemon URLs to HTTP gateway base URLs', () => {
    expect(gatewayHttpBaseFromDaemonUrl('ws://127.0.0.1:18790/ws')).toBe('http://127.0.0.1:18790');
    expect(gatewayHttpBaseFromDaemonUrl('wss://example.test/daemon')).toBe('https://example.test');
  });

  it('falls back to local gateway when daemon URL is invalid', () => {
    expect(gatewayHttpBaseFromDaemonUrl('localhost:18790')).toBe('http://127.0.0.1:18790');
    expect(gatewayHttpBaseFromDaemonUrl('not a url')).toBe('http://127.0.0.1:18790');
  });
});

describe('SseParser', () => {
  it('parses snapshot and ledger events across chunks', () => {
    const parser = new SseParser();

    const first = parser.push('event: snapshot\ndata: {"concept":');
    const second = parser.push('{"conceptId":"c1"}}\n\nevent: ledger\ndata: {"event":{"type":"concept.completed"}}\n\n');

    expect(first).toEqual([]);
    expect(second).toEqual([
      { event: 'snapshot', data: '{"concept":{"conceptId":"c1"}}' },
      { event: 'ledger', data: '{"event":{"type":"concept.completed"}}' },
    ]);
  });
});

describe('UniversalApiClient', () => {
  it('sends bearer-authenticated concept start requests', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ conceptId: 'concept-1', runId: 'run-1', status: 'queued' }),
    })) as FetchLike;
    const client = new UniversalApiClient('http://127.0.0.1:18790', 'token-1', fetchImpl);

    await expect(client.startConcept({ goal: 'build thing', workspaceId: '/tmp/ws' })).resolves.toEqual({
      conceptId: 'concept-1',
      runId: 'run-1',
      status: 'queued',
    });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:18790/api/concepts', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token-1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ goal: 'build thing', workspaceId: '/tmp/ws' }),
    });
  });
});
