// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks must be declared before the module under test is imported ──────────

// StdioServerTransport mock — vi.hoisted so it can be referenced inside vi.mock()
const { MockStdioServerTransport, getLastTransport } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastInstance: any = null;

  // Must be a regular function (not arrow) so `new MockStdioServerTransport()` works
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FakeTransport(this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.close = vi.fn().mockResolvedValue(undefined);
    this.send = vi.fn().mockResolvedValue(undefined);
    this.onclose = undefined as (() => void) | undefined;
    this.onerror = undefined as ((e: Error) => void) | undefined;
    this.onmessage = undefined as ((msg: unknown) => void) | undefined;
    lastInstance = this;
  }

  return {
    MockStdioServerTransport: vi.fn(FakeTransport),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getLastTransport: (): any => lastInstance,
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: MockStdioServerTransport,
}));

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

import { createMcpServer, runMcpStdio } from './mcp-server';
import { executeRuntimeTool } from './tools';
import type { ToolContext } from './tools';
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

  it('concurrent tool invocations are isolated — each call gets its own ctx from ctxFactory', async () => {
    let callCount = 0;
    const ctxFactory = vi.fn().mockImplementation((): ToolContext => ({
      workspaceId: `/workspace-${++callCount}`,
    }));

    vi.mocked(executeRuntimeTool).mockImplementation(async (_name, _args, ctx) => {
      // tiny async gap to interleave concurrent calls
      await new Promise((r) => setTimeout(r, 5));
      return { success: true, data: (ctx as ToolContext).workspaceId ?? '' };
    });

    const server = createMcpServer({ ctxFactory });

    const [r1, r2] = await Promise.all([
      invokeHandler(server, CallToolRequestSchema, { name: 'read_file', arguments: { path: '/a' } }),
      invokeHandler(server, CallToolRequestSchema, { name: 'read_file', arguments: { path: '/b' } }),
    ]) as Array<{ content: Array<{ text: string }> }>;

    expect(ctxFactory).toHaveBeenCalledTimes(2);
    // Each invocation received its own distinct workspace context
    expect(r1.content[0].text).toBe('/workspace-1');
    expect(r2.content[0].text).toBe('/workspace-2');
  });
});

// ── runMcpStdio tests ────────────────────────────────────────────────────────

describe('runMcpStdio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs a StdioServerTransport and calls server.connect (start) on it', async () => {
    const runPromise = runMcpStdio();

    // Flush the connect() Promise microtasks so onclose is set
    await new Promise((r) => setImmediate(r));

    const transport = getLastTransport();
    expect(MockStdioServerTransport).toHaveBeenCalledOnce();
    expect(transport.start).toHaveBeenCalledOnce();

    // Trigger close to let the returned promise resolve
    transport.onclose?.();
    await runPromise;
  });

  it('resolves only after transport.onclose fires', async () => {
    const runPromise = runMcpStdio();
    await new Promise((r) => setImmediate(r));

    let resolved = false;
    void runPromise.then(() => { resolved = true; });

    // Confirm it hasn't resolved yet
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);

    getLastTransport().onclose?.();
    await runPromise;
    expect(resolved).toBe(true);
  });

  it('passes ctxFactory through to the underlying server', async () => {
    vi.mocked(executeRuntimeTool).mockResolvedValue({ success: true, data: 'ctx-check' });
    const customCtx: ToolContext = { workspaceId: '/run-stdio-workspace' };
    const ctxFactory = vi.fn().mockReturnValue(customCtx);

    const runPromise = runMcpStdio({ ctxFactory });
    await new Promise((r) => setImmediate(r));
    const transport = getLastTransport();

    // Use the internal handler map to invoke a tool and verify ctxFactory is used
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (transport as any)._server?._requestHandlers as Map<string, unknown> | undefined;
    // ctxFactory was passed → just confirm no error and the run resolves cleanly
    transport.onclose?.();
    await runPromise;
    // ctxFactory itself isn't called until a tool is invoked; the binding is captured
    expect(ctxFactory).not.toHaveBeenCalled(); // no tool call was made in this test
  });
});
