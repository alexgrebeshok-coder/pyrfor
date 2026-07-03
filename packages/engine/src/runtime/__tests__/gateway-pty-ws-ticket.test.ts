// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { createRuntimeGateway } from '../gateway.js';
import type { RuntimeConfig } from '../config.js';
import type { PyrforRuntime } from '../index.js';
import { nodePtySupported } from './supports-node-pty.js';

process.env['LOG_LEVEL'] = 'silent';

function makeRuntime(): PyrforRuntime {
  return {
    handleMessage: async () => ({ success: true, response: '' }),
  } as unknown as PyrforRuntime;
}

const describeIfNodePtySupported = nodePtySupported ? describe : describe.skip;

describeIfNodePtySupported('P1-6 PTY WebSocket ticket auth', () => {
  let workspace: string;
  let gw: ReturnType<typeof createRuntimeGateway>;
  const token = 'pty-ws-test-token';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pyrfor-pty-ws-'));
  });

  afterEach(async () => {
    if (gw) await gw.stop();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('accepts Sec-WebSocket-Protocol ticket instead of query token', async () => {
    const config = {
      workspaceRoot: workspace,
      gateway: {
        enabled: true,
        host: '127.0.0.1',
        port: 0,
        bearerToken: token,
        bearerTokens: [],
        allowUnauthenticated: false,
      },
      rateLimit: { enabled: false, capacity: 60, refillPerSec: 1, exemptPaths: [] },
    } as unknown as RuntimeConfig;

    gw = createRuntimeGateway({ config, runtime: makeRuntime() });
    await gw.start();

    const spawnRes = await fetch(`http://127.0.0.1:${gw.port}/api/pty/spawn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cwd: workspace, cols: 80, rows: 24 }),
    });
    expect(spawnRes.status).toBe(200);
    const { id } = await spawnRes.json() as { id: string };

    const ticketRes = await fetch(`http://127.0.0.1:${gw.port}/api/pty/${id}/ws-ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ticketRes.status).toBe(200);
    const ticketBody = await ticketRes.json() as { protocol: string };
    expect(ticketBody.protocol).toMatch(/^pyrfor-ticket\./);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws/pty/${id}`, [ticketBody.protocol]);
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
  });
});
