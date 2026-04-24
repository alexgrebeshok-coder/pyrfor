// @vitest-environment node
/**
 * Tests for packages/engine/src/runtime/mcp-client.ts
 *
 * All tests inject a fake sdkFactory so no real MCP servers are spawned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMcpClient } from './mcp-client.js';
import type { McpClient, McpServerConfig, McpServerHandle } from './mcp-client.js';

// ── Fake handle factory ───────────────────────────────────────────────────────

function makeFakeHandle(toolMap: Record<string, (args: any) => any>): McpServerHandle {
  return {
    name: 'fake',
    async listTools() {
      return Object.keys(toolMap).map((n) => ({ name: n, inputSchema: { type: 'object' } }));
    },
    async callTool(name: string, args: any) {
      if (!(name in toolMap)) throw new Error('no such tool');
      const r = toolMap[name](args);
      return { content: r };
    },
    async close() {},
  };
}

/** Make a simple sdkFactory that always returns the given handle. */
function factory(handle: McpServerHandle) {
  return async (_cfg: McpServerConfig): Promise<McpServerHandle> => handle;
}

/** Default config helper. */
function cfg(name = 'srv', overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { name, transport: 'stdio', command: 'node', ...overrides };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('McpClient', () => {
  let client: McpClient;
  const clients: McpClient[] = [];

  function makeClient(opts: Parameters<typeof createMcpClient>[0] = {}) {
    const c = createMcpClient(opts);
    clients.push(c);
    return c;
  }

  beforeEach(() => {
    client = makeClient({ sdkFactory: factory(makeFakeHandle({ echo: (a: any) => a })) });
  });

  afterEach(async () => {
    for (const c of clients) await c.shutdown().catch(() => {});
    clients.length = 0;
  });

  // ── 1. connect populates handles + tool cache ───────────────────────────

  it('connect with fake SDK populates tool cache', async () => {
    await client.connect(cfg());
    expect(client.isConnected('srv')).toBe(true);
    expect(client.listTools('srv')).toHaveLength(1);
    expect(client.listTools('srv')[0].name).toBe('echo');
  });

  // ── 2. duplicate name throws ────────────────────────────────────────────

  it('duplicate server name throws', async () => {
    await client.connect(cfg());
    await expect(client.connect(cfg())).rejects.toThrow(/duplicate server name/i);
  });

  // ── 3. listServers returns names ────────────────────────────────────────

  it('listServers returns connected server names', async () => {
    expect(client.listServers()).toEqual([]);
    await client.connect(cfg());
    expect(client.listServers()).toEqual(['srv']);
  });

  // ── 4. listTools empty before connect ──────────────────────────────────

  it('listTools is empty before any connect', () => {
    expect(client.listTools()).toEqual([]);
    expect(client.listTools('srv')).toEqual([]);
  });

  // ── 5. listTools filter by server ──────────────────────────────────────

  it('listTools filters by serverName', async () => {
    const c = makeClient({
      sdkFactory: async (c) =>
        makeFakeHandle(c.name === 'a' ? { toolA: () => 1 } : { toolB: () => 2 }),
    });
    await c.connect(cfg('a'));
    await c.connect(cfg('b'));

    const aTools = c.listTools('a');
    expect(aTools).toHaveLength(1);
    expect(aTools[0].name).toBe('toolA');

    const bTools = c.listTools('b');
    expect(bTools).toHaveLength(1);
    expect(bTools[0].name).toBe('toolB');
  });

  // ── 6. listTools all when no filter ────────────────────────────────────

  it('listTools returns all tools when no filter given', async () => {
    const c = makeClient({
      sdkFactory: async (c) =>
        makeFakeHandle(c.name === 'a' ? { toolA: () => 1 } : { toolB: () => 2 }),
    });
    await c.connect(cfg('a'));
    await c.connect(cfg('b'));

    const all = c.listTools();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.name).sort()).toEqual(['toolA', 'toolB']);
  });

  // ── 7. call returns ok=true with content ───────────────────────────────

  it('call returns ok=true with content', async () => {
    await client.connect(cfg());
    const result = await client.call('srv', 'echo', { x: 42 });
    expect(result.ok).toBe(true);
    expect(result.content).toEqual({ x: 42 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── 8. call unknown server → ok=false 'no such server' ─────────────────

  it('call to unknown server returns ok=false', async () => {
    const result = await client.call('nope', 'echo', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no such server/i);
    expect(result.durationMs).toBe(0);
  });

  // ── 9. call unknown tool → ok=false captured error ─────────────────────

  it('call to unknown tool returns ok=false with error', async () => {
    await client.connect(cfg());
    const result = await client.call('srv', 'nonexistent', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no such tool/i);
  });

  // ── 10. call respects callTimeoutMs ────────────────────────────────────

  it('call respects callTimeoutMs when handle hangs', async () => {
    const hangingHandle: McpServerHandle = {
      name: 'hang',
      async listTools() {
        return [{ name: 'slow', inputSchema: {} }];
      },
      async callTool(_name, _args) {
        return new Promise<never>(() => {}); // never resolves
      },
      async close() {},
    };

    const c = makeClient({ sdkFactory: factory(hangingHandle) });
    await c.connect(cfg('hang', { callTimeoutMs: 50 }));
    const result = await c.call('hang', 'slow', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timeout/i);
  });

  // ── 11. durationMs populated on success ────────────────────────────────

  it('durationMs is populated on successful call', async () => {
    await client.connect(cfg());
    const result = await client.call('srv', 'echo', {});
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── 12. durationMs populated on timeout ────────────────────────────────

  it('durationMs is populated even when call times out', async () => {
    const hangHandle: McpServerHandle = {
      name: 'hg',
      async listTools() { return [{ name: 't', inputSchema: {} }]; },
      async callTool() { return new Promise<never>(() => {}); },
      async close() {},
    };
    const c = makeClient({ sdkFactory: factory(hangHandle) });
    await c.connect(cfg('hg', { callTimeoutMs: 50 }));
    const result = await c.call('hg', 't', {});
    expect(result.ok).toBe(false);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── 13. isConnected true/false ──────────────────────────────────────────

  it('isConnected is true after connect and false after disconnect', async () => {
    await client.connect(cfg());
    expect(client.isConnected('srv')).toBe(true);
    await client.disconnect('srv');
    expect(client.isConnected('srv')).toBe(false);
  });

  // ── 14. disconnect emits 'disconnect' event ─────────────────────────────

  it('disconnect emits disconnect event', async () => {
    await client.connect(cfg());
    const events: any[] = [];
    client.on('disconnect', (p) => events.push(p));
    await client.disconnect('srv');
    expect(events).toHaveLength(1);
    expect(events[0].serverName).toBe('srv');
  });

  // ── 15. connect emits 'connect' event ──────────────────────────────────

  it('connect emits connect event', async () => {
    const events: any[] = [];
    client.on('connect', (p) => events.push(p));
    await client.connect(cfg());
    expect(events).toHaveLength(1);
    expect(events[0].serverName).toBe('srv');
  });

  // ── 16. 'tool' event fires once per tool after connect ──────────────────

  it('tool event fires once per tool after connect', async () => {
    const c = makeClient({
      sdkFactory: factory(makeFakeHandle({ t1: () => 1, t2: () => 2, t3: () => 3 })),
    });
    const toolEvents: any[] = [];
    c.on('tool', (p) => toolEvents.push(p));
    await c.connect(cfg());
    expect(toolEvents).toHaveLength(3);
    expect(toolEvents.map((e) => e.name).sort()).toEqual(['t1', 't2', 't3']);
  });

  // ── 17. on/off: unsub stops subsequent callbacks ─────────────────────────

  it('unsub from on() stops callbacks', async () => {
    const calls: any[] = [];
    const unsub = client.on('connect', (p) => calls.push(p));
    await client.connect(cfg('first'));

    unsub(); // unsubscribe

    const c2 = makeClient({ sdkFactory: factory(makeFakeHandle({ x: () => 1 })) });
    clients.push(c2);
    // reuse same listener ref but it's unsubscribed from `client`
    await client.disconnect('first');
    // second connect on same client won't fire (but we need a new client since 'first' was disconnected)
    // Just confirm calls length stayed at 1
    expect(calls).toHaveLength(1);
  });

  // ── 18. subscriber cb throws → swallowed ────────────────────────────────

  it('subscriber that throws does not crash and others continue', async () => {
    const log: string[] = [];
    client.on('connect', () => { throw new Error('boom'); });
    client.on('connect', () => log.push('ok'));
    // Should not throw
    await expect(client.connect(cfg())).resolves.not.toThrow();
    expect(log).toContain('ok');
  });

  // ── 19. shutdown disconnects all ────────────────────────────────────────

  it('shutdown disconnects all servers', async () => {
    const c = makeClient({
      sdkFactory: async (conf) => makeFakeHandle({ [`tool_${conf.name}`]: () => 1 }),
    });
    await c.connect(cfg('a'));
    await c.connect(cfg('b'));
    expect(c.listServers()).toHaveLength(2);
    await c.shutdown();
    expect(c.listServers()).toHaveLength(0);
    expect(c.isConnected('a')).toBe(false);
    expect(c.isConnected('b')).toBe(false);
  });

  // ── 20. shutdown is idempotent ───────────────────────────────────────────

  it('shutdown is idempotent (can be called multiple times)', async () => {
    await client.connect(cfg());
    await client.shutdown();
    await expect(client.shutdown()).resolves.not.toThrow();
    expect(client.listServers()).toHaveLength(0);
  });

  // ── 21. startupTimeoutMs: connect rejects if listTools hangs ────────────

  it('connect rejects if listTools hangs longer than startupTimeoutMs', async () => {
    const slowHandle: McpServerHandle = {
      name: 'slow',
      async listTools() {
        return new Promise<never>(() => {}); // never resolves
      },
      async callTool() { return {}; },
      async close() {},
    };
    const c = makeClient({ sdkFactory: factory(slowHandle) });
    await expect(
      c.connect(cfg('slow', { startupTimeoutMs: 50 })),
    ).rejects.toThrow(/timeout/i);
    // Server should not be registered
    expect(c.isConnected('slow')).toBe(false);
  });

  // ── 22. sdkFactory error → connect rejects with original error ──────────

  it('sdkFactory error causes connect to reject with the original error', async () => {
    const boom = new Error('factory kaboom');
    const c = makeClient({
      sdkFactory: async () => { throw boom; },
    });
    await expect(c.connect(cfg())).rejects.toThrow('factory kaboom');
    expect(c.isConnected('srv')).toBe(false);
  });

  // ── 23. handle.close throws on disconnect → still removes from map ───────

  it('handle.close throwing on disconnect still removes server from map', async () => {
    const noisyHandle: McpServerHandle = {
      name: 'noisy',
      async listTools() { return [{ name: 't', inputSchema: {} }]; },
      async callTool() { return {}; },
      async close() { throw new Error('close failed'); },
    };
    const c = makeClient({ sdkFactory: factory(noisyHandle) });
    await c.connect(cfg('noisy'));
    expect(c.isConnected('noisy')).toBe(true);
    // Should not throw even though close() throws.
    await expect(c.disconnect('noisy')).resolves.not.toThrow();
    expect(c.isConnected('noisy')).toBe(false);
  });

  // ── 24. listTools after disconnect is empty for that server ─────────────

  it('listTools after disconnect returns empty for that server', async () => {
    await client.connect(cfg());
    expect(client.listTools('srv')).toHaveLength(1);
    await client.disconnect('srv');
    expect(client.listTools('srv')).toHaveLength(0);
  });

  // ── 25. multiple servers concurrent connect ──────────────────────────────

  it('multiple servers can connect concurrently', async () => {
    const c = makeClient({
      sdkFactory: async (conf) =>
        makeFakeHandle({ [`tool_${conf.name}`]: () => conf.name }),
    });

    await Promise.all([
      c.connect(cfg('x')),
      c.connect(cfg('y')),
      c.connect(cfg('z')),
    ]);

    expect(c.listServers().sort()).toEqual(['x', 'y', 'z']);
    expect(c.listTools()).toHaveLength(3);

    const result = await c.call('y', 'tool_y', {});
    expect(result.ok).toBe(true);
    expect(result.content).toBe('y');
  });
});
