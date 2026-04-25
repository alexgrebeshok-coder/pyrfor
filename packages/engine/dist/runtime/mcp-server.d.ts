/**
 * MCP (Model Context Protocol) Server adapter for the Pyrfor runtime.
 *
 * Exposes runtimeToolDefinitions over the MCP stdio transport so that
 * Claude Desktop, Copilot CLI, Cursor, and other MCP clients can invoke
 * Pyrfor tools as if they were local MCP tool providers.
 *
 * Usage:
 *   import { runMcpStdio } from './mcp-server';
 *   await runMcpStdio();
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { type ToolContext } from './tools';
export interface McpServerOptions {
    /**
     * Factory called once per tool request to produce the ToolContext.
     * Defaults to a context with workspace=process.cwd().
     */
    ctxFactory?: () => ToolContext;
}
/**
 * Build and configure a `Server` instance from @modelcontextprotocol/sdk.
 * Does NOT connect the transport — call `server.connect(transport)` yourself
 * or use `runMcpStdio()` to do it all in one shot.
 */
export declare function createMcpServer(opts?: McpServerOptions): Server;
/**
 * Create the MCP server, wire it to a StdioServerTransport, and start it.
 * Returns a promise that resolves when the transport closes (i.e. the client
 * disconnects or the process receives EOF on stdin).
 */
export declare function runMcpStdio(opts?: McpServerOptions): Promise<void>;
//# sourceMappingURL=mcp-server.d.ts.map