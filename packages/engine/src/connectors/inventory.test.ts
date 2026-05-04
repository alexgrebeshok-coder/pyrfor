import { describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry } from './registry';
import { buildConnectorInventorySnapshot } from './inventory';
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
        liveProbeSkipped: true,
      })],
    });
  });
});
