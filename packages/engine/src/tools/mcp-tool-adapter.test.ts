// @vitest-environment node
/**
 * mcp-tool-adapter.test.ts — Unit tests for McpToolAdapter.
 *
 * Uses a fake McpClientLike (in-memory), real ToolRegistry / PermissionEngine,
 * and a real EventLedger backed by a temp file on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  McpToolAdapter,
  classifyTool,
  namespacedName,
  type McpClientLike,
  type InvokeContext,
} from './mcp-tool-adapter';
import {
  ToolRegistry,
  PermissionEngine,
} from '../runtime/permission-engine';
import { EventLedger } from '../runtime/event-ledger';

// ====== Helpers ==============================================================

const CTX: InvokeContext = {
  workspaceId: 'ws-test',
  sessionId: 'sess-test',
  runId: 'run-test',
};

function makeCtx(overrides: Partial<InvokeContext> = {}): InvokeContext {
  return { ...CTX, ...overrides };
}

/** Minimal fake MCP client. */
function makeFakeClient(
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
    serverName?: string;
  }> = [],
  callResult: { ok: boolean; content?: unknown; error?: string; durationMs: number } = {
    ok: true,
    content: { value: 42 },
    durationMs: 5,
  },
  callImpl?: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<typeof callResult>,
): McpClientLike {
  return {
    listTools: () => tools,
    call: callImpl ?? (() => Promise.resolve(callResult)),
  };
}

function ledgerPath(): string {
  return path.join(os.tmpdir(), `mcp-adapter-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

// ====== classifyTool ==========================================================

describe('classifyTool', () => {
  it('read_* → read / auto_allow', () => {
    const r = classifyTool('read_file');
    expect(r.side).toBe('read');
    expect(r.perm).toBe('auto_allow');
  });

  it('list_* → read / auto_allow', () => {
    const r = classifyTool('list_items');
    expect(r.side).toBe('read');
    expect(r.perm).toBe('auto_allow');
  });

  it('write_* → write / ask_once', () => {
    const r = classifyTool('write_file');
    expect(r.side).toBe('write');
    expect(r.perm).toBe('ask_once');
  });

  it('run_* → execute / ask_once', () => {
    const r = classifyTool('run_tests');
    expect(r.side).toBe('execute');
    expect(r.perm).toBe('ask_once');
  });

  it('delete_* → destructive / ask_every_time', () => {
    const r = classifyTool('delete_row');
    expect(r.side).toBe('destructive');
    expect(r.perm).toBe('ask_every_time');
  });

  it('deploy → execute / ask_once', () => {
    const r = classifyTool('deploy');
    expect(r.side).toBe('execute');
    expect(r.perm).toBe('ask_once');
  });

  it('git_push → execute / ask_once', () => {
    const r = classifyTool('git_push');
    expect(r.side).toBe('execute');
    expect(r.perm).toBe('ask_once');
  });

  it('browser_navigate → network / ask_once', () => {
    const r = classifyTool('browser_navigate');
    expect(r.side).toBe('network');
    expect(r.perm).toBe('ask_once');
  });
});

// ====== namespacedName ========================================================

describe('namespacedName', () => {
  it('joins namespace and name with dot', () => {
    expect(namespacedName('mcp', 'read_file')).toBe('mcp.read_file');
    expect(namespacedName('custom', 'my_tool')).toBe('custom.my_tool');
  });
});

// ====== refresh ===============================================================

describe('McpToolAdapter.refresh', () => {
  it('registers all returned tools with correct namespace', async () => {
    const client = makeFakeClient([
      { name: 'read_file', serverName: 'fs-server' },
      { name: 'write_file', serverName: 'fs-server' },
      { name: 'delete_row', serverName: 'db-server' },
    ]);
    const registry = new ToolRegistry();
    const adapter = new McpToolAdapter({ mcpClient: client, registry, namespace: 'mcp' });

    const tools = await adapter.refresh();

    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      'mcp.read_file',
      'mcp.write_file',
      'mcp.delete_row',
    ]);

    // Check ToolRegistry has the spec
    expect(registry.get('mcp.read_file')).toBeDefined();
    expect(registry.get('mcp.write_file')?.sideEffect).toBe('write');
    expect(registry.get('mcp.delete_row')?.sideEffect).toBe('destructive');
  });

  it('applies custom namespace', async () => {
    const client = makeFakeClient([{ name: 'tool_a' }]);
    const adapter = new McpToolAdapter({ mcpClient: client, namespace: 'ext' });
    const tools = await adapter.refresh();
    expect(tools[0].name).toBe('ext.tool_a');
  });

  it('defaults namespace to "mcp"', async () => {
    const client = makeFakeClient([{ name: 'tool_b' }]);
    const adapter = new McpToolAdapter({ mcpClient: client });
    const tools = await adapter.refresh();
    expect(tools[0].name).toBe('mcp.tool_b');
  });

  it('skips duplicate registrations on second refresh call', async () => {
    const client = makeFakeClient([{ name: 'read_file' }]);
    const registry = new ToolRegistry();
    const adapter = new McpToolAdapter({ mcpClient: client, registry });
    await adapter.refresh();
    // Second refresh: duplicate; should not throw
    const tools2 = await adapter.refresh();
    expect(tools2).toHaveLength(0); // skipped
    expect(registry.list()).toHaveLength(1);
  });

  it('stores serverName on the registered entry', async () => {
    const client = makeFakeClient([{ name: 'read_file', serverName: 'my-server' }]);
    const adapter = new McpToolAdapter({ mcpClient: client });
    const tools = await adapter.refresh();
    expect(tools[0].serverName).toBe('my-server');
    expect(tools[0].underlying).toBe('read_file');
  });
});

// ====== invoke — auto_allow ==================================================

describe('McpToolAdapter.invoke — auto_allow', () => {
  let lPath: string;

  afterEach(async () => {
    try { await fs.unlink(lPath); } catch { /* ignore */ }
  });

  it('succeeds and emits ledger events', async () => {
    lPath = ledgerPath();
    const client = makeFakeClient([{ name: 'read_file', serverName: 'srv' }]);
    const registry = new ToolRegistry();
    const permissions = new PermissionEngine(registry);
    const ledger = new EventLedger(lPath);
    const adapter = new McpToolAdapter({ mcpClient: client, registry, permissions, ledger });
    await adapter.refresh();

    const ctx = makeCtx();
    const result = await adapter.invoke('mcp.read_file', { path: '/a/b' }, ctx);

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ value: 42 });
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(result.permissionPrompted).toBeUndefined();

    // Check ledger events
    const events = await ledger.readAll();
    expect(events.length).toBe(2);
    const [requested, executed] = events;
    expect(requested.type).toBe('tool.requested');
    expect((requested as any).tool).toBe('mcp.read_file');
    expect(executed.type).toBe('tool.executed');
    expect((executed as any).tool).toBe('mcp.read_file');
    expect((executed as any).status).toBe('success');
    expect((executed as any).ms).toBeGreaterThanOrEqual(0);
  });
});

// ====== invoke — ask_once =====================================================

describe('McpToolAdapter.invoke — ask_once', () => {
  it('prompts on first invocation', async () => {
    const client = makeFakeClient([{ name: 'write_file', serverName: 'srv' }]);
    const registry = new ToolRegistry();
    const permissions = new PermissionEngine(registry);
    const adapter = new McpToolAdapter({ mcpClient: client, registry, permissions });
    await adapter.refresh();

    const result = await adapter.invoke('mcp.write_file', {}, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.permissionPrompted).toBe(true);
  });

  it('succeeds after approveOnce', async () => {
    const client = makeFakeClient([{ name: 'write_file', serverName: 'srv' }]);
    const registry = new ToolRegistry();
    const permissions = new PermissionEngine(registry);
    const adapter = new McpToolAdapter({ mcpClient: client, registry, permissions });
    await adapter.refresh();

    const ctx = makeCtx();
    adapter.approveOnce('mcp.write_file', ctx);

    const result = await adapter.invoke('mcp.write_file', {}, ctx);
    expect(result.ok).toBe(true);
    expect(result.permissionPrompted).toBeUndefined();
  });
});

// ====== invoke — ask_every_time ==============================================

describe('McpToolAdapter.invoke — ask_every_time', () => {
  it('always returns permissionPrompted:true', async () => {
    const client = makeFakeClient([{ name: 'delete_row', serverName: 'srv' }]);
    const registry = new ToolRegistry();
    const permissions = new PermissionEngine(registry);
    const adapter = new McpToolAdapter({ mcpClient: client, registry, permissions });
    await adapter.refresh();

    const r1 = await adapter.invoke('mcp.delete_row', {}, makeCtx());
    expect(r1.ok).toBe(false);
    expect(r1.permissionPrompted).toBe(true);

    // Even after approveOnce (which records ask_once approval) — ask_every_time
    // bypasses stored approvals by always prompting
    adapter.approveOnce('mcp.delete_row', makeCtx());
    const r2 = await adapter.invoke('mcp.delete_row', {}, makeCtx());
    expect(r2.permissionPrompted).toBe(true);
  });
});

// ====== invoke — unknown tool ================================================

describe('McpToolAdapter.invoke — unknown tool', () => {
  it('returns ok:false with error message', async () => {
    const client = makeFakeClient([]);
    const adapter = new McpToolAdapter({ mcpClient: client });
    const result = await adapter.invoke('mcp.nonexistent', {}, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown tool/i);
    expect(result.ms).toBe(0);
  });
});

// ====== invoke — mcpClient error =============================================

describe('McpToolAdapter.invoke — mcpClient errors', () => {
  it('catches thrown errors and returns ok:false with error string', async () => {
    const client = makeFakeClient(
      [{ name: 'read_file', serverName: 'srv' }],
      { ok: true, content: null, durationMs: 0 },
      async () => { throw new Error('connection refused'); },
    );
    const registry = new ToolRegistry();
    const adapter = new McpToolAdapter({ mcpClient: client, registry });
    await adapter.refresh();

    const result = await adapter.invoke('mcp.read_file', {}, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/connection refused/);
  });

  it('returns ok:false when mcpClient.call resolves with ok:false', async () => {
    const client = makeFakeClient(
      [{ name: 'read_file', serverName: 'srv' }],
      { ok: false, error: 'not found', durationMs: 3 },
    );
    const registry = new ToolRegistry();
    const adapter = new McpToolAdapter({ mcpClient: client, registry });
    await adapter.refresh();

    const result = await adapter.invoke('mcp.read_file', {}, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not found');
  });
});

// ====== ledger round-trip ====================================================

describe('Ledger round-trip', () => {
  let lPath: string;

  afterEach(async () => {
    try { await fs.unlink(lPath); } catch { /* ignore */ }
  });

  it('events include tool name, status, ms; readAll works', async () => {
    lPath = ledgerPath();
    const client = makeFakeClient([{ name: 'read_file', serverName: 'srv' }]);
    const ledger = new EventLedger(lPath);
    const adapter = new McpToolAdapter({ mcpClient: client, ledger });
    await adapter.refresh();

    await adapter.invoke('mcp.read_file', { path: '/x' }, makeCtx());

    const events = await ledger.readAll();
    expect(events.length).toBe(2);

    const toolRequested = events.find((e) => e.type === 'tool.requested');
    const toolExecuted = events.find((e) => e.type === 'tool.executed');

    expect(toolRequested).toBeDefined();
    expect((toolRequested as any).tool).toBe('mcp.read_file');

    expect(toolExecuted).toBeDefined();
    expect((toolExecuted as any).tool).toBe('mcp.read_file');
    expect((toolExecuted as any).status).toBe('success');
    expect(typeof (toolExecuted as any).ms).toBe('number');
  });

  it('emits error status on failure', async () => {
    lPath = ledgerPath();
    const client = makeFakeClient(
      [{ name: 'read_file', serverName: 'srv' }],
      { ok: false, error: 'boom', durationMs: 1 },
    );
    const ledger = new EventLedger(lPath);
    const adapter = new McpToolAdapter({ mcpClient: client, ledger });
    await adapter.refresh();

    await adapter.invoke('mcp.read_file', {}, makeCtx());

    const events = await ledger.readAll();
    const executed = events.find((e) => e.type === 'tool.executed');
    expect((executed as any).status).toBe('error');
    expect((executed as any).error).toBe('boom');
  });
});

// ====== listTools ============================================================

describe('McpToolAdapter.listTools', () => {
  it('returns empty array before refresh', () => {
    const client = makeFakeClient([{ name: 'tool_x' }]);
    const adapter = new McpToolAdapter({ mcpClient: client });
    expect(adapter.listTools()).toEqual([]);
  });

  it('returns registered tools after refresh', async () => {
    const client = makeFakeClient([{ name: 'tool_x' }, { name: 'tool_y' }]);
    const adapter = new McpToolAdapter({ mcpClient: client });
    await adapter.refresh();
    const tools = adapter.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('mcp.tool_x');
    expect(tools[1].name).toBe('mcp.tool_y');
  });
});
