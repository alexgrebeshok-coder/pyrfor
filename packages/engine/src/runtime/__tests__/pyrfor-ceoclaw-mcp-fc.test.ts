// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { buildCeoclawMcpFc } from '../pyrfor-ceoclaw-mcp-fc';
import type { CeoclawMcpClient } from '../pyrfor-ceoclaw-mcp-fc';

function makeClient(): CeoclawMcpClient {
  return {
    getTask: vi.fn().mockResolvedValue({
      taskId: 'task-1',
      title: 'Build login',
      status: 'open',
      spec: 'OAuth flow',
    }),
    listTasks: vi.fn().mockResolvedValue([
      { taskId: 'task-1', title: 'Build login', status: 'open' },
      { taskId: 'task-2', title: 'Fix bug', status: 'done' },
    ]),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe('buildCeoclawMcpFc', () => {
  it('generates exactly 3 tools', () => {
    const { tools } = buildCeoclawMcpFc({ client: makeClient() });
    expect(tools).toHaveLength(3);
  });

  it('tool names are ceoclaw_get_task, ceoclaw_list_tasks, ceoclaw_update_status', () => {
    const { tools } = buildCeoclawMcpFc({ client: makeClient() });
    const names = tools.map((t) => t.name);
    expect(names).toContain('ceoclaw_get_task');
    expect(names).toContain('ceoclaw_list_tasks');
    expect(names).toContain('ceoclaw_update_status');
  });

  it('ceoclaw_get_task delegates to client.getTask with taskId', async () => {
    const client = makeClient();
    const { tools } = buildCeoclawMcpFc({ client });
    const tool = tools.find((t) => t.name === 'ceoclaw_get_task')!;
    const result = await tool.handler({ taskId: 'task-1' });
    expect(client.getTask).toHaveBeenCalledWith('task-1');
    expect(result.taskId).toBe('task-1');
    expect(result.title).toBe('Build login');
  });

  it('ceoclaw_list_tasks with no filter passes undefined to client', async () => {
    const client = makeClient();
    const { tools } = buildCeoclawMcpFc({ client });
    const tool = tools.find((t) => t.name === 'ceoclaw_list_tasks')!;
    const result = await tool.handler({});
    expect(client.listTasks).toHaveBeenCalledWith(undefined);
    expect(result).toHaveLength(2);
  });

  it('ceoclaw_list_tasks honors optional status filter', async () => {
    const client = makeClient();
    const { tools } = buildCeoclawMcpFc({ client });
    const tool = tools.find((t) => t.name === 'ceoclaw_list_tasks')!;
    await tool.handler({ status: 'open' });
    expect(client.listTasks).toHaveBeenCalledWith({ status: 'open' });
  });

  it('ceoclaw_update_status returns void (undefined) on success', async () => {
    const client = makeClient();
    const { tools } = buildCeoclawMcpFc({ client });
    const tool = tools.find((t) => t.name === 'ceoclaw_update_status')!;
    const result = await tool.handler({ taskId: 'task-1', status: 'done' });
    expect(client.updateStatus).toHaveBeenCalledWith('task-1', 'done');
    expect(result).toBeUndefined();
  });

  it('ceoclaw_get_task throws validation error on missing taskId', async () => {
    const { tools } = buildCeoclawMcpFc({ client: makeClient() });
    const tool = tools.find((t) => t.name === 'ceoclaw_get_task')!;
    await expect(tool.handler({})).rejects.toThrow('missing required field "taskId"');
  });

  it('ceoclaw_update_status throws validation error on missing status', async () => {
    const { tools } = buildCeoclawMcpFc({ client: makeClient() });
    const tool = tools.find((t) => t.name === 'ceoclaw_update_status')!;
    await expect(tool.handler({ taskId: 'task-1' })).rejects.toThrow(
      'missing required field "status"',
    );
  });

  it('toFcMcpConfigEntry returns entry with name and config', () => {
    const { toFcMcpConfigEntry } = buildCeoclawMcpFc({ client: makeClient() });
    const entry = toFcMcpConfigEntry();
    expect(entry.name).toBe('pyrfor-ceoclaw-mcp-fc');
    expect(entry.config).toBeDefined();
    expect(entry.config.command).toBe('__in_process__');
  });
});
