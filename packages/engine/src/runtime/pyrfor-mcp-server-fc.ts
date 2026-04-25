// @vitest-environment node
/**
 * pyrfor-mcp-server-fc.ts — Transport-agnostic MCP-like server exposing
 * Pyrfor tools to FreeClaude (FC).
 *
 * Design decision: in-process interface (no real MCP stdio transport).
 * `toFcMcpConfig()` returns a sentinel shape documenting how a production
 * stdio bridge would be wired; in tests / embedded use, call `listTools()`
 * and `call()` directly without any network or subprocess.
 *
 * If real stdio bridging is needed, spawn this module as a child process and
 * connect via `@modelcontextprotocol/sdk`'s StdioClientTransport with the
 * config returned by `toFcMcpConfig()`.
 */

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface PyrforMcpTool {
  name: string;
  description: string;
  inputSchema: object; // JSON Schema (object type)
  handler: (input: any) => Promise<any>;
}

export interface PyrforMcpServerOptions {
  memorySearch: (
    q: string,
    opts?: { topK?: number; scope?: string },
  ) => Promise<Array<{ id: string; text: string; score: number }>>;
  skillQuery: (
    q: string,
  ) => Promise<Array<{ slug: string; title: string; tags: string[]; body: string }>>;
  pmContext: (taskId: string) => Promise<{
    taskId: string;
    spec?: string;
    status?: string;
    relatedTasks?: string[];
  }>;
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
        `[pyrfor-mcp-server-fc] Tool "${toolName}": missing required field "${field}"`,
      );
    }
  }
}

// ── PyrforMcpServer ───────────────────────────────────────────────────────────

export class PyrforMcpServer {
  private readonly _tools: PyrforMcpTool[];

  constructor(opts: PyrforMcpServerOptions) {
    this._tools = [
      {
        name: 'memory_search',
        description:
          'Search Pyrfor long-term memory for entries matching the query string.',
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search query' },
            topK: { type: 'number', description: 'Maximum results (default 10)' },
            scope: { type: 'string', description: 'Optional memory scope filter' },
          },
          required: ['q'],
        },
        handler: async (input: any) => {
          validateRequired('memory_search', input, ['q']);
          return opts.memorySearch(input.q, {
            topK: input.topK,
            scope: input.scope,
          });
        },
      },
      {
        name: 'skill_query',
        description: 'Search the Pyrfor skills library for instruction templates.',
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Skill search query' },
          },
          required: ['q'],
        },
        handler: async (input: any) => {
          validateRequired('skill_query', input, ['q']);
          return opts.skillQuery(input.q);
        },
      },
      {
        name: 'pm_context',
        description:
          'Retrieve project-management context for a task: spec, status, and related tasks.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Unique task identifier' },
          },
          required: ['taskId'],
        },
        handler: async (input: any) => {
          validateRequired('pm_context', input, ['taskId']);
          return opts.pmContext(input.taskId);
        },
      },
    ];
  }

  /** Returns the 3 registered tools. */
  listTools(): PyrforMcpTool[] {
    return this._tools;
  }

  /** Dispatch a tool call by name. Throws on unknown name. */
  async call(name: string, input: any): Promise<any> {
    const tool = this._tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(
        `[pyrfor-mcp-server-fc] Unknown tool "${name}". Available: ${this._tools.map((t) => t.name).join(', ')}`,
      );
    }
    return tool.handler(input);
  }

  /**
   * Returns the shape FC expects in `--mcp-config`.
   *
   * In-process sentinel: the `command` is set to `"__in_process__"` to signal
   * that this server should NOT be spawned as a subprocess. In a production
   * stdio bridge, replace with e.g.:
   *   command: "node", args: ["dist/runtime/pyrfor-mcp-stdio-bridge.js"]
   *
   * @see https://docs.anthropic.com/en/docs/mcp
   */
  toFcMcpConfig(): {
    servers: Record<
      string,
      { command?: string; args?: string[]; env?: Record<string, string> }
    >;
  } {
    return {
      servers: {
        'pyrfor-mcp-server-fc': {
          command: '__in_process__',
          args: [],
          env: {},
        },
      },
    };
  }
}
