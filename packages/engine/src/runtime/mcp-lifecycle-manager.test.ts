// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest';
import { createMcpClient, type McpServerConfig, type McpServerHandle } from './mcp-client.js';
import { McpLifecycleManagerStub } from './mcp-lifecycle-manager.js';

function cfg(name: string): McpServerConfig {
  return { name, transport: 'stdio', command: 'node' };
}

describe('McpLifecycleManagerStub', () => {
  const clients: ReturnType<typeof createMcpClient>[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.shutdown().catch(() => {})));
    clients.length = 0;
  });

  it('healthCheck reflects client connection state', async () => {
    const handle: McpServerHandle = {
      name: 'srv',
      async listTools() { return []; },
      async callTool() { return { content: null }; },
      async close() {},
    };
    const client = createMcpClient({
      sdkFactory: async () => handle,
    });
    clients.push(client);
    const manager = new McpLifecycleManagerStub(client);
    manager.registerConfig(cfg('srv'));

    expect(await manager.healthCheck('srv')).toBe(false);
    await client.connect(cfg('srv'));
    expect(await manager.healthCheck('srv')).toBe(true);
  });
});
