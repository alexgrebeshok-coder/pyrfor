import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { DaemonClient } from '../daemon-client';

function getPort(): number {
  return 19700 + Math.floor(Math.random() * 200);
}

describe('DaemonClient', () => {
  let wss: WebSocketServer;
  let port: number;
  let url: string;

  beforeEach(async () => {
    port = getPort();
    url = `ws://127.0.0.1:${port}/`;
    await new Promise<void>((resolve) => {
      wss = new WebSocketServer({ port }, resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('connects and reaches "open" state', async () => {
    const client = new DaemonClient(url, { maxRetries: 0 });
    await client.connect();
    expect(client.state).toBe('open');
    client.disconnect();
  });

  it('emits "open" event on successful connect', async () => {
    const client = new DaemonClient(url, { maxRetries: 0 });
    let opened = false;
    client.on('open', () => { opened = true; });
    await client.connect();
    expect(opened).toBe(true);
    client.disconnect();
  });

  it('send() transmits a JSON message to the server', async () => {
    const client = new DaemonClient(url, { maxRetries: 0 });
    const received: string[] = [];
    wss.on('connection', (ws) => {
      ws.on('message', (data) => received.push(data.toString()));
    });
    await client.connect();
    client.send({ hello: 'world' });
    // give the server a moment to receive
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0])).toEqual({ hello: 'world' });
    client.disconnect();
  });

  it('emits "message" event when server sends data', async () => {
    const client = new DaemonClient(url, { maxRetries: 0 });
    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));

    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'ping' });
    client.disconnect();
  });

  it('auto-reconnects after server closes connection', async () => {
    const client = new DaemonClient(url, { reconnectMs: 100, maxRetries: 3 });
    let openCount = 0;
    client.on('open', () => { openCount++; });

    await client.connect();
    expect(openCount).toBe(1);

    // Close all current server-side connections to trigger client reconnect
    wss.clients.forEach((ws) => ws.close());

    // Wait enough for reconnect
    await new Promise((r) => setTimeout(r, 500));
    expect(openCount).toBeGreaterThanOrEqual(2);
    client.disconnect();
  });

  it('reaches "error" state and rejects on connection refused', async () => {
    const badUrl = 'ws://127.0.0.1:19999/';
    const client = new DaemonClient(badUrl, { maxRetries: 0 });
    await expect(client.connect()).rejects.toThrow();
    expect(client.state).toBe('error');
  });

  it('send() throws when not connected', () => {
    const client = new DaemonClient(url, { maxRetries: 0 });
    expect(() => client.send({ test: true })).toThrow();
  });
});
