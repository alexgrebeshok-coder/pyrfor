// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import { createRuntimeGateway, type GatewayHandle } from '../gateway';
import { nodePtySupported } from './supports-node-pty.js';

process.env['LOG_LEVEL'] = 'silent';

function makeConfig(gatewayOverrides: Partial<RuntimeConfig['gateway']> = {}): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      bearerToken: undefined,
      bearerTokens: [],
      ...gatewayOverrides,
    },
    rateLimit: {
      enabled: false,
      capacity: 60,
      refillPerSec: 1,
      exemptPaths: ['/ping'],
    },
    workspaceRoot: '/tmp',
  } as unknown as RuntimeConfig;
}

function makeRuntime(): PyrforRuntime {
  return {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
  } as unknown as PyrforRuntime;
}

const describeIfNodePtySupported = nodePtySupported ? describe : describe.skip;

describeIfNodePtySupported('Gateway PTY endpoints', () => {
  let gw: GatewayHandle | null = null;

  afterEach(async () => {
    if (gw) { await gw.stop(); gw = null; }
  });

  it('POST /api/pty/spawn returns {id}', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();
    const port = gw.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/pty/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/tmp', shell: '/bin/sh', cols: 80, rows: 24 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { id: string };
    expect(typeof json.id).toBe('string');

    await fetch(`http://127.0.0.1:${port}/api/pty/${json.id}`, { method: 'DELETE' });
  });

  it('GET /api/pty/list returns array', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();
    const port = gw.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/pty/list`);
    expect(res.status).toBe(200);
    const list = await res.json() as unknown[];
    expect(Array.isArray(list)).toBe(true);
  });

  it('WS /ws/pty/:id receives echo output', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();
    const port = gw.port;

    const spawnRes = await fetch(`http://127.0.0.1:${port}/api/pty/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/tmp', shell: '/bin/sh', cols: 80, rows: 24 }),
    });
    const { id } = await spawnRes.json() as { id: string };

    const output = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/${id}`);
      const chunks: string[] = [];
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve(chunks.join(''));
      }, 3000);

      ws.on('open', () => {
        ws.send('echo hi\n');
      });
      ws.on('message', (data: Buffer | string) => {
        const s = typeof data === 'string' ? data : data.toString();
        chunks.push(s);
        if (chunks.join('').includes('hi')) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(chunks.join(''));
        }
      });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    expect(output).toContain('hi');

    const del = await fetch(`http://127.0.0.1:${port}/api/pty/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
  });

  it('rejects WS /ws/pty/:id without bearer token when auth is configured', async () => {
    const token = 'pty-secret-token';
    gw = createRuntimeGateway({ config: makeConfig({ bearerToken: token }), runtime: makeRuntime() });
    await gw.start();
    const port = gw.port;

    const spawnRes = await fetch(`http://127.0.0.1:${port}/api/pty/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cwd: '/tmp', shell: '/bin/sh', cols: 80, rows: 24 }),
    });
    const { id } = await spawnRes.json() as { id: string };

    const statusCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/${id}`);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error('timed out waiting for unauthorized WS rejection'));
      }, 2000);

      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        resolve(res.statusCode ?? 0);
      });
      ws.on('open', () => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(new Error('unauthorized WS unexpectedly opened'));
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    expect(statusCode).toBe(401);

    await fetch(`http://127.0.0.1:${port}/api/pty/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  it('accepts WS /ws/pty/:id token query when auth is configured', async () => {
    const token = 'pty-secret-token';
    gw = createRuntimeGateway({ config: makeConfig({ bearerToken: token }), runtime: makeRuntime() });
    await gw.start();
    const port = gw.port;

    const spawnRes = await fetch(`http://127.0.0.1:${port}/api/pty/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cwd: '/tmp', shell: '/bin/sh', cols: 80, rows: 24 }),
    });
    const { id } = await spawnRes.json() as { id: string };

    const output = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/${id}?token=${encodeURIComponent(token)}`);
      const chunks: string[] = [];
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error('timed out waiting for authorized WS output'));
      }, 3000);

      ws.on('open', () => {
        ws.send('echo auth-ok\n');
      });
      ws.on('message', (data: Buffer | string) => {
        const s = typeof data === 'string' ? data : data.toString();
        chunks.push(s);
        if (chunks.join('').includes('auth-ok')) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(chunks.join(''));
        }
      });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    expect(output).toContain('auth-ok');

    const del = await fetch(`http://127.0.0.1:${port}/api/pty/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);
  });
});
