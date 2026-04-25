/**
 * pyrfor-ceoclaw-mcp-fc.ts — Wire CEOClaw PM MCP into FC's --mcp-config.
 *
 * CEOClaw does not expose a discoverable MCP server at the package boundary
 * (no pm-mcp endpoint was found in the repo). This module provides:
 *   1. A typed `CeoclawMcpClient` interface that callers implement (or mock).
 *   2. `buildCeoclawMcpFc()` — builds PyrforMcpTool[] delegates + config entry.
 *
 * Design: same transport-agnostic, in-process pattern as pyrfor-mcp-server-fc.
 * To bridge over real MCP stdio, wrap the client in a bridge process.
 */

import type { PyrforMcpTool } from './pyrfor-mcp-server-fc';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface CeoclawMcpClient {
  getTask: (taskId: string) => Promise<{
    taskId: string;
    title: string;
    status: string;
    spec?: string;
  }>;
  listTasks: (filter?: { status?: string }) => Promise<
    Array<{ taskId: string; title: string; status: string }>
  >;
  updateStatus: (taskId: string, status: string) => Promise<void>;
}

export interface CeoclawMcpFcOptions {
  client: CeoclawMcpClient;
}

// ── Validation helper ─────────────────────────────────────────────────────────

function validateRequired(
  toolName: string,
  input: Record<string, unknown>,
  required: string[],
): void {
  for (const field of required) {
    if (input[field] === undefined || input[field] === null) {
      throw new Error(
        `[pyrfor-ceoclaw-mcp-fc] Tool "${toolName}": missing required field "${field}"`,
      );
    }
  }
}

// ── buildCeoclawMcpFc ─────────────────────────────────────────────────────────

/**
 * Builds 3 CEOClaw PM tools wired to the provided client, plus a sentinel
 * FC MCP config entry. Same in-process sentinel pattern as PyrforMcpServer —
 * replace `command: "__in_process__"` with a real stdio bridge in production.
 */
export function buildCeoclawMcpFc(opts: CeoclawMcpFcOptions): {
  tools: PyrforMcpTool[];
  toFcMcpConfigEntry(): { name: string; config: any };
} {
  const { client } = opts;

  const tools: PyrforMcpTool[] = [
    {
      name: 'ceoclaw_get_task',
      description: 'Retrieve full details of a CEOClaw PM task by its ID.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Unique task identifier' },
        },
        required: ['taskId'],
      },
      handler: async (input: any) => {
        validateRequired('ceoclaw_get_task', input, ['taskId']);
        return client.getTask(input.taskId);
      },
    },
    {
      name: 'ceoclaw_list_tasks',
      description: 'List CEOClaw PM tasks, optionally filtered by status.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Optional status filter (e.g. "open", "done")',
          },
        },
        required: [],
      },
      handler: async (input: any) => {
        const filter = input?.status !== undefined ? { status: input.status } : undefined;
        return client.listTasks(filter);
      },
    },
    {
      name: 'ceoclaw_update_status',
      description: 'Update the status of a CEOClaw PM task.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Unique task identifier' },
          status: { type: 'string', description: 'New status value' },
        },
        required: ['taskId', 'status'],
      },
      handler: async (input: any) => {
        validateRequired('ceoclaw_update_status', input, ['taskId', 'status']);
        await client.updateStatus(input.taskId, input.status);
      },
    },
  ];

  return {
    tools,
    /** Returns the FC --mcp-config entry for CEOClaw PM MCP. */
    toFcMcpConfigEntry() {
      return {
        name: 'pyrfor-ceoclaw-mcp-fc',
        config: {
          command: '__in_process__',
          args: [],
          env: {},
        },
      };
    },
  };
}
