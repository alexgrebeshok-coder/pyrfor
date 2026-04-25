// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { PyrforMcpServer } from '../pyrfor-mcp-server-fc';

function makeOpts() {
  const memorySearch = vi.fn().mockResolvedValue([
    { id: 'mem-1', text: 'hello world', score: 0.95 },
  ]);
  const skillQuery = vi.fn().mockResolvedValue([
    { slug: 'code-review', title: 'Code Review', tags: ['code'], body: 'Review code.' },
  ]);
  const pmContext = vi.fn().mockResolvedValue({
    taskId: 'task-42',
    spec: 'Build feature X',
    status: 'in_progress',
    relatedTasks: ['task-41'],
  });
  return { memorySearch, skillQuery, pmContext };
}

describe('PyrforMcpServer', () => {
  it('listTools returns exactly 3 tools', () => {
    const server = new PyrforMcpServer(makeOpts());
    expect(server.listTools()).toHaveLength(3);
  });

  it('listTools returns tools with correct names', () => {
    const server = new PyrforMcpServer(makeOpts());
    const names = server.listTools().map((t) => t.name);
    expect(names).toContain('memory_search');
    expect(names).toContain('skill_query');
    expect(names).toContain('pm_context');
  });

  it('each tool has a non-empty description and an inputSchema with required array', () => {
    const server = new PyrforMcpServer(makeOpts());
    for (const tool of server.listTools()) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect((tool.inputSchema as any).required).toBeDefined();
    }
  });

  it('call(memory_search) invokes opts.memorySearch and returns its result', async () => {
    const opts = makeOpts();
    const server = new PyrforMcpServer(opts);
    const result = await server.call('memory_search', { q: 'hello', topK: 5 });
    expect(opts.memorySearch).toHaveBeenCalledWith('hello', { topK: 5, scope: undefined });
    expect(result).toEqual([{ id: 'mem-1', text: 'hello world', score: 0.95 }]);
  });

  it('call on unknown tool name throws', async () => {
    const server = new PyrforMcpServer(makeOpts());
    await expect(server.call('unknown_tool', {})).rejects.toThrow('Unknown tool');
  });

  it('call(memory_search) with missing required field "q" throws validation error', async () => {
    const server = new PyrforMcpServer(makeOpts());
    await expect(server.call('memory_search', {})).rejects.toThrow(
      'missing required field "q"',
    );
  });

  it('call(skill_query) dispatches to opts.skillQuery', async () => {
    const opts = makeOpts();
    const server = new PyrforMcpServer(opts);
    const result = await server.call('skill_query', { q: 'code' });
    expect(opts.skillQuery).toHaveBeenCalledWith('code');
    expect(result[0].slug).toBe('code-review');
  });

  it('call(pm_context) dispatches to opts.pmContext', async () => {
    const opts = makeOpts();
    const server = new PyrforMcpServer(opts);
    const result = await server.call('pm_context', { taskId: 'task-42' });
    expect(opts.pmContext).toHaveBeenCalledWith('task-42');
    expect(result.taskId).toBe('task-42');
  });

  it('call(pm_context) with missing taskId throws', async () => {
    const server = new PyrforMcpServer(makeOpts());
    await expect(server.call('pm_context', {})).rejects.toThrow(
      'missing required field "taskId"',
    );
  });

  it('toFcMcpConfig returns object with "servers" key', () => {
    const server = new PyrforMcpServer(makeOpts());
    const cfg = server.toFcMcpConfig();
    expect(cfg).toHaveProperty('servers');
    expect(typeof cfg.servers).toBe('object');
  });

  it('toFcMcpConfig servers entry has pyrfor-mcp-server-fc key', () => {
    const server = new PyrforMcpServer(makeOpts());
    const cfg = server.toFcMcpConfig();
    expect(cfg.servers['pyrfor-mcp-server-fc']).toBeDefined();
  });
});
