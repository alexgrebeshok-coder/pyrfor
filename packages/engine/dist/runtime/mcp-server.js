/**
 * MCP (Model Context Protocol) Server adapter for the Pyrfor runtime.
 *
 * Exposes runtimeToolDefinitions over the MCP stdio transport so that
 * Claude Desktop, Copilot CLI, Cursor, and other MCP clients can invoke
 * Pyrfor tools as if they were local MCP tool providers.
 *
 * Usage:
 *   import { runMcpStdio } from './mcp-server.js';
 *   await runMcpStdio();
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
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../observability/logger.js';
import { runtimeToolDefinitions, executeRuntimeTool, } from './tools.js';
// ============================================
// Helpers
// ============================================
function defaultCtxFactory() {
    return { workspaceId: process.cwd() };
}
// ============================================
// createMcpServer
// ============================================
/**
 * Build and configure a `Server` instance from @modelcontextprotocol/sdk.
 * Does NOT connect the transport — call `server.connect(transport)` yourself
 * or use `runMcpStdio()` to do it all in one shot.
 */
export function createMcpServer(opts = {}) {
    const { ctxFactory = defaultCtxFactory } = opts;
    const server = new Server({ name: 'pyrfor-runtime', version: '0.1.0' }, { capabilities: { tools: {} } });
    // ── tools/list ──────────────────────────────────────────────────────────
    server.setRequestHandler(ListToolsRequestSchema, () => {
        logger.info('[mcp-server] tools/list requested');
        const tools = runtimeToolDefinitions.map((def) => ({
            name: def.name,
            description: def.description,
            inputSchema: Object.assign({ type: 'object', properties: def.parameters.properties }, (def.parameters.required ? { required: def.parameters.required } : {})),
        }));
        return { tools };
    });
    // ── tools/call ──────────────────────────────────────────────────────────
    server.setRequestHandler(CallToolRequestSchema, (request) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { name, arguments: args = {} } = request.params;
        logger.info('[mcp-server] tools/call', { tool: name });
        const ctx = ctxFactory();
        try {
            const result = yield executeRuntimeTool(name, args, ctx);
            if (!result.success) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: (_a = result.error) !== null && _a !== void 0 ? _a : 'Tool execution failed' }],
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result.data === 'string'
                            ? result.data
                            : JSON.stringify(result.data, null, 2),
                    },
                ],
            };
        }
        catch (err) {
            logger.error('[mcp-server] tools/call error', { tool: name, error: String(err) });
            return {
                isError: true,
                content: [{ type: 'text', text: String(err) }],
            };
        }
    }));
    return server;
}
// ============================================
// runMcpStdio
// ============================================
/**
 * Create the MCP server, wire it to a StdioServerTransport, and start it.
 * Returns a promise that resolves when the transport closes (i.e. the client
 * disconnects or the process receives EOF on stdin).
 */
export function runMcpStdio() {
    return __awaiter(this, arguments, void 0, function* (opts = {}) {
        const server = createMcpServer(opts);
        const transport = new StdioServerTransport();
        logger.info('[mcp-server] starting stdio transport');
        yield server.connect(transport);
        logger.info('[mcp-server] connected — waiting for client messages');
        return new Promise((resolve) => {
            transport.onclose = () => {
                logger.info('[mcp-server] transport closed');
                resolve();
            };
        });
    });
}
