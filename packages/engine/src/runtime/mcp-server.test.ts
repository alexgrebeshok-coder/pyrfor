// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks must be declared before the module under test is imported ──────────

vi.mock('./tools', () => ({
  runtimeToolDefinitions: [
    {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
        },
        required: ['path'],
      },
    },
    {
      name: 'exec',
      description: 'Run a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run' },
        },
        required: ['command'],
      },
    },
  ],
  executeRuntimeTool: vi.fn(),
}));

vi.mock('../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { createMcpServer } from './mcp-server';
import { executeRuntimeTool } from './tools';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate what the SDK does when a handler is invoked. */
async function invokeHandler(
  server: ReturnType<typeof createMcpServer>,
  schema: typeof ListToolsRequestSchema | typeof CallToolRequestSchema,
  params: Record<string, unknown> = {},
) {
  // Access internal handler map via the SDK's public API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = (server as any)._requestHandlers as Map<string, (req: unknown, extra: unknown) => unknown>;
  const method = schema.shape.method.value as string;
  const handler = handlers?.get(method);
  if (!handler) throw new Error(`No handler registered for ${method}`);
  return handler({ method, params }, {});
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a Server instance', () => {
    const server = createMcpServer();
    // The SDK Server class exposes connect() method
    expect(typeof server.connect).toBe('function');
  });

  it('ListTools returns translated tool definitions', async () => {
    const server = createMcpServer();
    const result = await invokeHandler(server, ListToolsRequestSchema) as { tools: unknown[] };

    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toMatchObject({
      name: 'read_file',
      description: 'Read the contents of a file',
      inputSchema: {
        type: 'object',
        properties: { path: expect.any(Object) },
        required: ['path'],
      },
    });
    expect(result.tools[1]).toMatchObject({ name: 'exec' });
  });

  it('ListTools does not include required when parameters.required is absent', async () => {
    // Temporarily override the mock to have a definition without required
    const { runtimeToolDefinitions } = await import('./tools');
    const original = [...runtimeToolDefinitions];
    (runtimeToolDefinitions as unknown[]).splice(0, runtimeToolDefinitions.length, {
      name: 'web_fetch',
      description: 'Fetch a URL',
      parameters: { type: 'object', properties: { url: { type: 'string' } } },
    });

    const server = createMcpServer();
    const result = await invokeHandler(server, ListToolsRequestSchema) as { tools: Array<{ inputSchema: Record<string, unknown> }> };

    expect(result.tools[0].inputSchema).not.toHaveProperty('required');

    // Restore
    (runtimeToolDefinitions as unknown[]).splice(0, runtimeToolDefinitions.length, ...original);
  });

  it('CallTool invokes executeRuntimeTool with correct args and returns text content', async () => {
    vi.mocked(executeRuntimeTool).mockResolvedValue({
      success: true,
      data: 'hello world',
    });

    const ctx = { workspaceId: '/my/workspace' };
    const server = createMcpServer({ ctxFactory: () => ctx });

    const result = await invokeHandler(server, CallToolRequestSchema, {
      name: 'read_file',
      arguments: { path: '/foo/bar.txt' },
    }) as { content: Array<{ type: string; text: string }> };

    expect(executeRuntimeTool).toHaveBeenCalledWith('read_file', { path: '/foo/bar.txt' }, ctx);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'hello world' });
  });

  it('CallTool returns isError content when tool reports failure', async () => {
    vi.mocked(executeRuntimeTool).mockResolvedValue({
      success: false,
      data: {},
      error: 'File not found',
    });

    const server = createMcpServer();
    const result = await invokeHandler(server, CallToolRequestSchema, {
      name: 'read_file',
      arguments: { path: '/nonexistent' },
    }) as { isError: boolean; content: Array<{ type: string; text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('File not found');
  });

  it('CallTool catches thrown errors and returns isError content', async () => {
    vi.mocked(executeRuntimeTool).mockRejectedValue(new Error('BOOM'));

    const server = createMcpServer();
    const result = await invokeHandler(server, CallToolRequestSchema, {
      name: 'exec',
      arguments: { command: 'bad' },
    }) as { isError: boolean; content: Array<{ type: string; text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('BOOM');
  });

  it('CallTool JSON-stringifies non-string data', async () => {
    vi.mocked(executeRuntimeTool).mockResolvedValue({
      success: true,
      data: { stdout: 'ok', exitCode: 0 },
    });

    const server = createMcpServer();
    const result = await invokeHandler(server, CallToolRequestSchema, {
      name: 'exec',
      arguments: { command: 'echo ok' },
    }) as { content: Array<{ type: string; text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({ stdout: 'ok', exitCode: 0 });
  });
});
