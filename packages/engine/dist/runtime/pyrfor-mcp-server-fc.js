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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ── Validation helper ─────────────────────────────────────────────────────────
function validateRequired(toolName, input, required) {
    for (const field of required) {
        if (input[field] === undefined || input[field] === null) {
            throw new Error(`[pyrfor-mcp-server-fc] Tool "${toolName}": missing required field "${field}"`);
        }
    }
}
// ── PyrforMcpServer ───────────────────────────────────────────────────────────
export class PyrforMcpServer {
    constructor(opts) {
        this._tools = [
            {
                name: 'memory_search',
                description: 'Search Pyrfor long-term memory for entries matching the query string.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        q: { type: 'string', description: 'Search query' },
                        topK: { type: 'number', description: 'Maximum results (default 10)' },
                        scope: { type: 'string', description: 'Optional memory scope filter' },
                    },
                    required: ['q'],
                },
                handler: (input) => __awaiter(this, void 0, void 0, function* () {
                    validateRequired('memory_search', input, ['q']);
                    return opts.memorySearch(input.q, {
                        topK: input.topK,
                        scope: input.scope,
                    });
                }),
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
                handler: (input) => __awaiter(this, void 0, void 0, function* () {
                    validateRequired('skill_query', input, ['q']);
                    return opts.skillQuery(input.q);
                }),
            },
            {
                name: 'pm_context',
                description: 'Retrieve project-management context for a task: spec, status, and related tasks.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        taskId: { type: 'string', description: 'Unique task identifier' },
                    },
                    required: ['taskId'],
                },
                handler: (input) => __awaiter(this, void 0, void 0, function* () {
                    validateRequired('pm_context', input, ['taskId']);
                    return opts.pmContext(input.taskId);
                }),
            },
        ];
    }
    /** Returns the 3 registered tools. */
    listTools() {
        return this._tools;
    }
    /** Dispatch a tool call by name. Throws on unknown name. */
    call(name, input) {
        return __awaiter(this, void 0, void 0, function* () {
            const tool = this._tools.find((t) => t.name === name);
            if (!tool) {
                throw new Error(`[pyrfor-mcp-server-fc] Unknown tool "${name}". Available: ${this._tools.map((t) => t.name).join(', ')}`);
            }
            return tool.handler(input);
        });
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
    toFcMcpConfig() {
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
