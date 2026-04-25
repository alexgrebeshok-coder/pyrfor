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
            throw new Error(`[pyrfor-ceoclaw-mcp-fc] Tool "${toolName}": missing required field "${field}"`);
        }
    }
}
// ── buildCeoclawMcpFc ─────────────────────────────────────────────────────────
/**
 * Builds 3 CEOClaw PM tools wired to the provided client, plus a sentinel
 * FC MCP config entry. Same in-process sentinel pattern as PyrforMcpServer —
 * replace `command: "__in_process__"` with a real stdio bridge in production.
 */
export function buildCeoclawMcpFc(opts) {
    const { client } = opts;
    const tools = [
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
            handler: (input) => __awaiter(this, void 0, void 0, function* () {
                validateRequired('ceoclaw_get_task', input, ['taskId']);
                return client.getTask(input.taskId);
            }),
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
            handler: (input) => __awaiter(this, void 0, void 0, function* () {
                const filter = (input === null || input === void 0 ? void 0 : input.status) !== undefined ? { status: input.status } : undefined;
                return client.listTasks(filter);
            }),
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
            handler: (input) => __awaiter(this, void 0, void 0, function* () {
                validateRequired('ceoclaw_update_status', input, ['taskId', 'status']);
                yield client.updateStatus(input.taskId, input.status);
            }),
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
