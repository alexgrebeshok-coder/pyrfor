// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeConfigSchema } from './config';
import { PyrforRuntime } from './index';
import type { McpClient } from './mcp-client.js';

process.env['LOG_LEVEL'] = 'silent';

function tinyRuntimeConfig(overrides: { mcp: { enabled: boolean; servers: Array<{ name: string; transport: 'stdio'; command: string }> } }) {
  return RuntimeConfigSchema.parse({
    gateway: { enabled: false },
    cron: { enabled: false, timezone: 'UTC', jobs: [] },
    health: { enabled: false, intervalMs: 60_000 },
    ...overrides,
  });
}

function mockMcpClient(connectMock: ReturnType<typeof vi.fn>): McpClient {
  return {
    connect: connectMock,
    shutdown: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    listServers: vi.fn().mockReturnValue([]),
    listTools: vi.fn().mockReturnValue([]),
    call: vi.fn(),
    isConnected: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
  };
}

describe('PyrforRuntime MCP bootstrap from config', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function emptyWorkspace(): Promise<string> {
    const d = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-mcp-rt-'));
    dirs.push(d);
    return d;
  }

  it('runs connect for each MCP server via lifecycle after orchestration startup', async () => {
    const ws = await emptyWorkspace();
    const connectSpy = vi.fn().mockResolvedValue(undefined);
    const client = mockMcpClient(connectSpy);

    const config = tinyRuntimeConfig({
      mcp: {
        enabled: true,
        servers: [{ name: 'one', transport: 'stdio', command: 'noop' }],
      },
    });

    const runtime = new PyrforRuntime({
      workspacePath: ws,
      persistence: false,
      config,
      mcpClientFactory: () => client,
    });

    await runtime.start();
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'one' }));

    await runtime.stop();
    expect(client.shutdown).toHaveBeenCalled();
  });

  it('continues connecting remaining servers after one connect rejects', async () => {
    const ws = await emptyWorkspace();
    const connectSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const client = mockMcpClient(connectSpy);

    const config = tinyRuntimeConfig({
      mcp: {
        enabled: true,
        servers: [
          { name: 'bad', transport: 'stdio', command: 'x' },
          { name: 'good', transport: 'stdio', command: 'y' },
        ],
      },
    });

    const runtime = new PyrforRuntime({
      workspacePath: ws,
      persistence: false,
      config,
      mcpClientFactory: () => client,
    });

    await runtime.start();
    expect(connectSpy).toHaveBeenCalledTimes(2);

    await runtime.stop();
    expect(client.shutdown).toHaveBeenCalled();
  });
});
