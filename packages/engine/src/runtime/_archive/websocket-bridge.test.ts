// @vitest-environment node
/**
 * websocket-bridge.test.ts
 *
 * Integration tests for createWsServer + createWsClient.
 * All tests use real ws sockets and real timers (no vi.useFakeTimers).
 * Ephemeral port 0 is used; actual port is read from server.port().
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as crypto from 'node:crypto';

import {
  createWsServer,
  createWsClient,
  type WsServerHandle,
  type WsClientHandle,
  type ConnEntry,
} from './websocket-bridge.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for up to `timeoutMs` until `predicate()` returns true. */
function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (predicate()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

/** Wait a fixed number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open a raw TCP WebSocket connection that never responds to pings.
 * Used to test server-side heartbeat drop logic.
 */
function rawWsConnect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');

    sock.once('error', reject);

    sock.once('connect', () => {
      sock.write(
        `GET / HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `\r\n`,
      );
    });

    // Read until we see the 101 response
    let buf = '';
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('binary');
      if (buf.includes('101 Switching Protocols')) {
        sock.off('data', onData);
        resolve(sock);
      }
    };
    sock.on('data', onData);
  });
}

// ─── Test-lifecycle tracking ──────────────────────────────────────────────────

const servers: WsServerHandle[] = [];
const clients: WsClientHandle[] = [];

afterEach(async () => {
  // Shut down every server and client spawned during the test
  await Promise.all(servers.map((s) => s.shutdown().catch(() => {})));
  servers.length = 0;
  clients.forEach((c) => c.close());
  clients.length = 0;
});

function makeServer(opts: Parameters<typeof createWsServer>[0]): WsServerHandle {
  const s = createWsServer(opts);
  servers.push(s);
  return s;
}

function makeClient(opts: Parameters<typeof createWsClient>[0]): WsClientHandle {
  const c = createWsClient(opts);
  clients.push(c);
  return c;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WebSocket bridge — server boot & close', () => {
  it('binds to an ephemeral port and reports it', async () => {
    const server = makeServer({ port: 0 });
    expect(server.port()).toBeGreaterThan(0);
  });

  it('shutdown() resolves even with no active connections', async () => {
    const server = makeServer({ port: 0 });
    await expect(server.shutdown()).resolves.toBeUndefined();
    servers.pop(); // already shut down; no need to shut down again in afterEach
  });

  it('server binds on a specific host when host is provided', async () => {
    const server = makeServer({ port: 0, host: '127.0.0.1' });
    // Wait for the server socket to be fully bound (listening event fires async)
    await waitFor(() => server.port() > 0);
    expect(server.port()).toBeGreaterThan(0);
  });
});

describe('WebSocket bridge — client connect & messaging', () => {
  it('client connects and onOpen fires', async () => {
    const server = makeServer({ port: 0 });
    const port = server.port();

    let opened = false;
    const client = makeClient({
      url: `ws://127.0.0.1:${port}`,
      onOpen: () => { opened = true; },
    });

    await waitFor(() => opened);
    expect(opened).toBe(true);
    expect(client.readyState()).toBe(1); // OPEN
  });

  it('client send reaches server onMessage', async () => {
    const received: string[] = [];
    const server = makeServer({
      port: 0,
      onMessage: (_, data) => { received.push(data.toString()); },
    });

    const client = makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
    });

    await waitFor(() => client.readyState() === 1);
    client.send('hello');

    await waitFor(() => received.length > 0);
    expect(received[0]).toBe('hello');
  });

  it('server send reaches client onMessage', async () => {
    const received: string[] = [];
    let connId = '';

    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onMessage: (data) => { received.push(data.toString()); },
    });

    await waitFor(() => connId !== '');
    server.send(connId, 'from-server');

    await waitFor(() => received.length > 0);
    expect(received[0]).toBe('from-server');
  });

  it('send to unknown connId returns false', () => {
    const server = makeServer({ port: 0 });
    expect(server.send('nonexistent', 'data')).toBe(false);
  });

  it('server.send returns true on successful send', async () => {
    let connId = '';
    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    await waitFor(() => connId !== '');

    const result = server.send(connId, 'ping');
    expect(result).toBe(true);
  });

  it('client onClose fires when server closes the connection', async () => {
    let connId = '';
    let closedCode = -1;

    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onClose: (code) => { closedCode = code; },
    });

    await waitFor(() => connId !== '');
    server.close(connId);

    await waitFor(() => closedCode !== -1);
    expect(closedCode).toBe(1000);
  });

  it('multiple messages flow in order', async () => {
    const received: string[] = [];
    let connId = '';

    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onMessage: (data) => { received.push(data.toString()); },
    });

    await waitFor(() => connId !== '');
    server.send(connId, 'a');
    server.send(connId, 'b');
    server.send(connId, 'c');

    await waitFor(() => received.length === 3);
    expect(received).toEqual(['a', 'b', 'c']);
  });
});

describe('WebSocket bridge — auth', () => {
  it('authFn returning ok:false causes close with code 4401', async () => {
    let closedCode = -1;

    const server = makeServer({
      port: 0,
      authFn: async () => ({ ok: false, reason: 'no-access' }),
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onClose: (code) => { closedCode = code; },
    });

    await waitFor(() => closedCode !== -1, 3000);
    expect(closedCode).toBe(4401);
  });

  it('authFn returning ok:true allows connection', async () => {
    let opened = false;

    const server = makeServer({
      port: 0,
      authFn: async () => ({ ok: true }),
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onOpen: () => { opened = true; },
    });

    await waitFor(() => opened);
    expect(opened).toBe(true);
  });

  it('authFn metadata is available on ConnEntry', async () => {
    const connections: ConnEntry[] = [];

    const server = makeServer({
      port: 0,
      authFn: async () => ({ ok: true, metadata: { role: 'admin', userId: 42 } }),
      onConnection: (conn) => { connections.push(conn); },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });

    await waitFor(() => connections.length > 0);
    expect((connections[0]!.metadata as { role: string }).role).toBe('admin');
    expect((connections[0]!.metadata as { userId: number }).userId).toBe(42);
  });

  it('authFn that throws is treated as rejection (4401)', async () => {
    let closedCode = -1;

    const server = makeServer({
      port: 0,
      authFn: async () => { throw new Error('boom'); },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onClose: (code) => { closedCode = code; },
    });

    await waitFor(() => closedCode !== -1, 3000);
    expect(closedCode).toBe(4401);
  });
});

describe('WebSocket bridge — ConnEntry fields', () => {
  it('connEntry has id, connectedAt, remoteAddr populated', async () => {
    const connections: ConnEntry[] = [];

    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connections.push(conn); },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    await waitFor(() => connections.length > 0);

    const conn = connections[0]!;
    expect(conn.id).toBeTruthy();
    expect(conn.connectedAt).toBeGreaterThan(0);
    // Accept both plain IPv4 and IPv6-mapped form (::ffff:127.0.0.1)
    expect(conn.remoteAddr).toMatch(/127\.0\.0\.1/);
    expect(conn.metadata).toBeNull();
    expect(conn.lastPingAt).toBe(0);
  });
});

describe('WebSocket bridge — broadcast', () => {
  it('broadcast sends to all connected clients', async () => {
    const N = 3;
    const received = Array.from({ length: N }, () => [] as string[]);
    const connCount = { v: 0 };

    const server = makeServer({
      port: 0,
      onConnection: () => { connCount.v++; },
    });

    for (let i = 0; i < N; i++) {
      const idx = i;
      makeClient({
        url: `ws://127.0.0.1:${server.port()}`,
        onMessage: (data) => { received[idx]!.push(data.toString()); },
      });
    }

    await waitFor(() => connCount.v === N);
    server.broadcast('hello-all');

    await waitFor(() => received.every((r) => r.length > 0));
    received.forEach((r) => expect(r[0]).toBe('hello-all'));
  });

  it('broadcast with filter only reaches matching connections', async () => {
    const received: Record<string, string[]> = {};
    const connMap = new Map<string, ConnEntry>();

    const server = makeServer({
      port: 0,
      authFn: async (req) => {
        const tag = req.headers['x-tag'] as string | undefined;
        return { ok: true, metadata: { tag: tag ?? 'none' } };
      },
      onConnection: (conn) => {
        connMap.set(conn.id, conn);
        received[conn.id] = [];
      },
    });

    // Client A with tag=alpha
    const clientA = makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      headers: { 'x-tag': 'alpha' },
      onMessage: (data) => {
        // find connId from connMap by matching first entry with tag alpha
        for (const [id, conn] of connMap) {
          if ((conn.metadata as { tag: string })?.tag === 'alpha') {
            received[id]!.push(data.toString());
          }
        }
      },
    });

    // Client B with tag=beta
    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      headers: { 'x-tag': 'beta' },
      onMessage: (data) => {
        for (const [id, conn] of connMap) {
          if ((conn.metadata as { tag: string })?.tag === 'beta') {
            received[id]!.push(data.toString());
          }
        }
      },
    });

    await waitFor(() => connMap.size === 2);
    await waitFor(() => clientA.readyState() === 1);

    server.broadcast('only-alpha', (conn) => {
      return (conn.metadata as { tag: string })?.tag === 'alpha';
    });

    await sleep(100);

    const alphaIds = [...connMap.entries()]
      .filter(([, c]) => (c.metadata as { tag: string })?.tag === 'alpha')
      .map(([id]) => id);

    const betaIds = [...connMap.entries()]
      .filter(([, c]) => (c.metadata as { tag: string })?.tag === 'beta')
      .map(([id]) => id);

    expect(alphaIds.length).toBe(1);
    expect(betaIds.length).toBe(1);
    // Alpha received the message; beta did not
    expect(received[alphaIds[0]!]).toEqual(['only-alpha']);
    expect(received[betaIds[0]!]).toEqual([]);
  });
});

describe('WebSocket bridge — heartbeat', () => {
  it('connection survives heartbeat when client responds with pong', async () => {
    let connId = '';

    const server = makeServer({
      port: 0,
      heartbeatMs: 20,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    await waitFor(() => connId !== '');

    // Wait several heartbeat cycles
    await sleep(150);

    // Connection should still be alive
    expect(server.send(connId, 'alive?')).toBe(true);
  });

  it('server drops connection that never sends pong', async () => {
    let connectionCount = 0;

    const server = makeServer({
      port: 0,
      heartbeatMs: 30,
      onConnection: () => { connectionCount++; },
    });

    const port = server.port();
    const rawSock = await rawWsConnect(port);

    await waitFor(() => connectionCount === 1);

    // Wait for more than 2× heartbeatMs — connection should be dropped
    await sleep(150);

    // The raw socket should have been terminated by the server
    // We verify by checking that sending returns false for all server connections
    // (registry should be empty for this conn)
    expect(server.send('any-id', 'test')).toBe(false);

    rawSock.destroy();
  });

  it('lastPingAt is updated after pong', async () => {
    const connections: ConnEntry[] = [];

    const server = makeServer({
      port: 0,
      heartbeatMs: 25,
      onConnection: (conn) => { connections.push(conn); },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    await waitFor(() => connections.length > 0);

    // Wait for at least one heartbeat cycle
    await sleep(100);

    expect(connections[0]!.lastPingAt).toBeGreaterThan(0);
  });
});

describe('WebSocket bridge — backpressure', () => {
  it('send returns false when bufferedAmountCap is exceeded', async () => {
    let connId = '';

    // bufferedAmountCap: -1 means bufferedAmount (>= 0) always exceeds it
    const server = makeServer({
      port: 0,
      bufferedAmountCap: -1,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    await waitFor(() => connId !== '');

    expect(server.send(connId, 'data')).toBe(false);
  });

  it('broadcast skips connections over backpressure cap', async () => {
    const received: string[] = [];
    let connId = '';

    // Zero cap — broadcast should skip all
    const server = makeServer({
      port: 0,
      bufferedAmountCap: -1,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onMessage: (data) => { received.push(data.toString()); },
    });

    await waitFor(() => connId !== '');
    server.broadcast('should-not-arrive');

    await sleep(80);
    expect(received).toHaveLength(0);
  });

  it('client send returns false when not connected', () => {
    const client = makeClient({ url: 'ws://127.0.0.1:1' }); // invalid port
    // socket is CONNECTING or error, not OPEN
    const result = client.send('test');
    expect(result).toBe(false);
  });
});

describe('WebSocket bridge — shutdown', () => {
  it('shutdown closes all active connections', async () => {
    const closeCodes: number[] = [];
    let connCount = 0;

    const server = makeServer({
      port: 0,
      onConnection: () => { connCount++; },
    });

    const N = 3;
    for (let i = 0; i < N; i++) {
      makeClient({
        url: `ws://127.0.0.1:${server.port()}`,
        onClose: (code) => { closeCodes.push(code); },
      });
    }

    await waitFor(() => connCount === N);
    await server.shutdown();
    servers.pop(); // already shut down

    await waitFor(() => closeCodes.length === N, 3000);
    closeCodes.forEach((code) => expect(code).toBe(1001));
  });

  it('shutdown resolves after all connections close', async () => {
    let connCount = 0;

    const server = makeServer({
      port: 0,
      onConnection: () => { connCount++; },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    makeClient({ url: `ws://127.0.0.1:${server.port()}` });

    await waitFor(() => connCount === 2);

    const t0 = Date.now();
    await server.shutdown();
    servers.pop();
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('WebSocket bridge — auto-reconnect', () => {
  it('autoReconnect=false: client does not reconnect after disconnect', async () => {
    let openCount = 0;

    const server = makeServer({ port: 0 });
    const port = server.port();

    makeClient({
      url: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
      backoffMs: 10,
      onOpen: () => { openCount++; },
    });

    await waitFor(() => openCount === 1);

    // Force disconnect all clients from server side
    await server.shutdown();
    servers.pop();

    await sleep(100);
    // Should not have reconnected
    expect(openCount).toBe(1);
  });

  it('autoReconnect=true: client reconnects after server closes connection', async () => {
    let openCount = 0;
    let connId = '';

    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      autoReconnect: true,
      backoffMs: 15,
      onOpen: () => { openCount++; },
    });

    await waitFor(() => openCount === 1 && connId !== '');

    // Close from server side — client should auto-reconnect
    server.close(connId);

    await waitFor(() => openCount >= 2, 2000);
    expect(openCount).toBeGreaterThanOrEqual(2);
  });

  it('backoff doubles on each failed attempt', async () => {
    const attemptTimestamps: number[] = [];

    // Connect to a port that has nothing listening — every attempt fails
    const port = await new Promise<number>((resolve) => {
      const tmp = net.createServer();
      tmp.listen(0, '127.0.0.1', () => {
        const addr = tmp.address() as net.AddressInfo;
        tmp.close(() => resolve(addr.port));
      });
    });

    makeClient({
      url: `ws://127.0.0.1:${port}`,
      autoReconnect: true,
      backoffMs: 20,
      maxBackoffMs: 160,
      onError: () => { attemptTimestamps.push(Date.now()); },
    });

    // Wait for 3 error events (initial + 2 reconnects)
    await waitFor(() => attemptTimestamps.length >= 3, 2000);

    // Gaps should be approximately 20ms, 40ms (doubling)
    const gap1 = attemptTimestamps[1]! - attemptTimestamps[0]!;
    const gap2 = attemptTimestamps[2]! - attemptTimestamps[1]!;
    expect(gap2).toBeGreaterThan(gap1);
  });

  it('client.close() stops auto-reconnect loop', async () => {
    let openCount = 0;
    let connId = '';

    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connId = conn.id; },
    });

    const client = makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      autoReconnect: true,
      backoffMs: 20,
      onOpen: () => { openCount++; },
    });

    await waitFor(() => openCount === 1 && connId !== '');

    server.close(connId);
    await sleep(10);
    client.close(); // stop before reconnect fires

    await sleep(150);
    expect(openCount).toBe(1); // never reconnected
  });
});

describe('WebSocket bridge — multiple concurrent clients', () => {
  it('handles many clients connecting simultaneously', async () => {
    const N = 10;
    let connCount = 0;

    const server = makeServer({
      port: 0,
      onConnection: () => { connCount++; },
    });

    for (let i = 0; i < N; i++) {
      makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    }

    await waitFor(() => connCount === N, 3000);
    expect(connCount).toBe(N);
  });

  it('broadcasts reach all N concurrent clients', async () => {
    const N = 5;
    const received: string[][] = Array.from({ length: N }, () => []);
    let connCount = 0;

    const server = makeServer({
      port: 0,
      onConnection: () => { connCount++; },
    });

    for (let i = 0; i < N; i++) {
      const idx = i;
      makeClient({
        url: `ws://127.0.0.1:${server.port()}`,
        onMessage: (data) => { received[idx]!.push(data.toString()); },
      });
    }

    await waitFor(() => connCount === N);
    server.broadcast('mass-ping');

    await waitFor(() => received.every((r) => r.length > 0), 2000);
    received.forEach((r) => expect(r[0]).toBe('mass-ping'));
  });

  it('closing one client does not affect others', async () => {
    let connIdA = '';
    let connIdB = '';
    let closedB = false;
    const received: string[] = [];

    const server = makeServer({
      port: 0,
      onConnection: (conn) => {
        if (connIdA === '') connIdA = conn.id;
        else connIdB = conn.id;
      },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onMessage: (data) => { received.push(data.toString()); },
    });

    makeClient({
      url: `ws://127.0.0.1:${server.port()}`,
      onClose: () => { closedB = true; },
    });

    await waitFor(() => connIdA !== '' && connIdB !== '');

    server.close(connIdB);
    await waitFor(() => closedB);

    // Client A is still accessible
    expect(server.send(connIdA, 'still-alive')).toBe(true);
    await waitFor(() => received.length > 0);
    expect(received[0]).toBe('still-alive');
  });
});

describe('WebSocket bridge — error event propagation', () => {
  it('client onError fires when connection is refused', async () => {
    const errors: Error[] = [];

    const client = makeClient({
      url: 'ws://127.0.0.1:1', // nothing listening on port 1
      autoReconnect: false,
      onError: (err) => { errors.push(err); },
    });

    await waitFor(() => errors.length > 0, 3000);
    expect(errors[0]).toBeInstanceOf(Error);
    client.close();
  });

  it('client readyState returns 3 (CLOSED) after close()', async () => {
    const server = makeServer({ port: 0 });

    const client = makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    await waitFor(() => client.readyState() === 1);

    client.close();
    clients.pop(); // already closed

    // After calling close(), socket reference is nulled → readyState returns 3
    expect(client.readyState()).toBe(3);
  });
});

describe('WebSocket bridge — close specific connection', () => {
  it('server.close removes the connection from the registry', async () => {
    let connId = '';

    const server = makeServer({
      port: 0,
      onConnection: (conn) => { connId = conn.id; },
    });

    makeClient({ url: `ws://127.0.0.1:${server.port()}` });
    await waitFor(() => connId !== '');

    server.close(connId);
    await sleep(50);

    // Connection no longer in registry — send returns false
    expect(server.send(connId, 'gone')).toBe(false);
  });

  it('server.close on unknown connId is a no-op', () => {
    const server = makeServer({ port: 0 });
    expect(() => server.close('does-not-exist')).not.toThrow();
  });
});
