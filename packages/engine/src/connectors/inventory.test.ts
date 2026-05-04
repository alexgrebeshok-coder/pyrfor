import { describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry } from './registry';
import { buildConnectorInventorySnapshot } from './inventory';
import { createManifestConnector } from './manifests';
import type { ConnectorAdapter } from './types';

describe('connector inventory', () => {
  it('builds local-only inventory without calling live connector probes', () => {
    const getStatus = vi.fn(async () => {
      throw new Error('live probe must not run');
    });
    const connector: ConnectorAdapter = {
      id: 'telegram',
      name: 'Telegram',
      description: 'Telegram bridge',
      direction: 'bidirectional',
      sourceSystem: 'Telegram Bot API',
      operations: ['Receive commands'],
      credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
      apiSurface: [{ method: 'WEBHOOK', path: '/api/telegram/webhook', description: 'Webhook' }],
      stub: false,
      getStatus,
    };
    const registry = new ConnectorRegistry().register(connector);

    const snapshot = buildConnectorInventorySnapshot(registry, {}, () => new Date('2026-05-04T00:00:00.000Z'));

    expect(getStatus).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      checkedAt: '2026-05-04T00:00:00.000Z',
      statusSource: 'local-config',
      summary: { total: 1, configured: 0, pending: 1, liveProbeSkipped: 1 },
      connectors: [expect.objectContaining({
        id: 'telegram',
        configured: false,
        missingSecrets: ['TELEGRAM_BOT_TOKEN'],
        readiness: expect.objectContaining({
          state: 'pending',
          reasons: ['Missing required env: TELEGRAM_BOT_TOKEN'],
          nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
        }),
        probePreview: expect.objectContaining({
          mode: 'descriptor-status',
          requiresApproval: true,
          requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
        }),
        liveProbeSkipped: true,
      })],
    });
  });

  it('adds sanitized manifest probe previews without leaking env values or executing fetch', () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('manifest probe must not run');
    });
    const connector = createManifestConnector({
      id: 'search',
      name: 'Search',
      description: 'Search connector',
      direction: 'outbound',
      sourceSystem: 'Search API',
      operations: ['Search'],
      credentials: [{ envVar: 'SEARCH_TOKEN', description: 'Search token' }],
      apiSurface: [{ method: 'GET', path: '/search', description: 'Search endpoint' }],
      stub: false,
      probe: {
        baseUrlEnvVar: 'SEARCH_BASE_URL',
        path: 'https://example.invalid/health?token=secret-value',
        authEnvVar: 'SEARCH_TOKEN',
        authHeaderName: 'Authorization',
        authScheme: 'Bearer',
        expectedStatus: 200,
        expectation: 'json-object',
        headers: { 'X-Connector': 'Search' },
      },
    }, {
      SEARCH_BASE_URL: 'https://search.example.test/private',
      SEARCH_TOKEN: 'super-secret-token',
    }, fetchImpl as unknown as typeof fetch);
    const registry = new ConnectorRegistry().register(connector);

    const snapshot = buildConnectorInventorySnapshot(registry, {
      SEARCH_BASE_URL: 'https://search.example.test/private',
      SEARCH_TOKEN: 'super-secret-token',
    }, () => new Date('2026-05-04T00:00:00.000Z'));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-token');
    expect(JSON.stringify(snapshot)).not.toContain('search.example.test');
    expect(snapshot.connectors[0]).toMatchObject({
      configured: true,
      readiness: expect.objectContaining({
        state: 'configured',
        nextStep: 'Request live probe approval to verify remote health.',
      }),
      probePreview: expect.objectContaining({
        mode: 'manifest-probe',
        method: 'GET',
        path: '/health',
        baseUrlEnvVar: 'SEARCH_BASE_URL',
        authEnvVar: 'SEARCH_TOKEN',
        authHeaderName: 'Authorization',
        expectedStatus: 200,
        expectation: 'json-object',
        requiredEnvVars: ['SEARCH_BASE_URL', 'SEARCH_TOKEN'],
        headerNames: ['X-Connector'],
      }),
    });
  });

  it('treats missing probe env vars as pending and suppresses local filesystem probe paths', () => {
    const connector = createManifestConnector({
      id: 'unsafe-local',
      name: 'Unsafe local',
      description: 'Unsafe local connector',
      direction: 'outbound',
      sourceSystem: 'Local API',
      operations: ['Probe'],
      credentials: [{ envVar: 'LOCAL_TOKEN', description: 'Local token' }],
      apiSurface: [{ method: 'GET', path: '/local', description: 'Local endpoint' }],
      stub: false,
      probe: {
        baseUrlEnvVar: 'LOCAL_BASE_URL',
        path: 'file:///Users/aleksandrgrebeshok/.ssh/id_rsa?token=secret',
        authEnvVar: 'LOCAL_TOKEN',
      },
    }, {
      LOCAL_TOKEN: 'secret-local-token',
    }, vi.fn() as unknown as typeof fetch);
    const registry = new ConnectorRegistry().register(connector);

    const snapshot = buildConnectorInventorySnapshot(registry, {
      LOCAL_TOKEN: 'secret-local-token',
    }, () => new Date('2026-05-04T00:00:00.000Z'));

    expect(JSON.stringify(snapshot)).not.toContain('secret-local-token');
    expect(JSON.stringify(snapshot)).not.toContain('/Users/aleksandrgrebeshok');
    expect(snapshot.connectors[0]).toMatchObject({
      configured: false,
      missingSecrets: ['LOCAL_BASE_URL'],
      readiness: expect.objectContaining({
        state: 'pending',
        nextStep: 'Set LOCAL_BASE_URL and refresh Connector Doctor.',
      }),
      probePreview: expect.objectContaining({
        mode: 'manifest-probe',
        baseUrlEnvVar: 'LOCAL_BASE_URL',
        authEnvVar: 'LOCAL_TOKEN',
        requiredEnvVars: ['LOCAL_BASE_URL', 'LOCAL_TOKEN'],
      }),
    });
    expect(snapshot.connectors[0]?.probePreview?.path).toBeUndefined();
  });
});
