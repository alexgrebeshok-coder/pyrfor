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
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../observability/logger';
import {
  runtimeToolDefinitions,
  executeRuntimeTool,
  type ToolContext,
} from './tools';

// ============================================
// Types
// ============================================

export interface McpServerOptions {
  /**
   * Factory called once per tool request to produce the ToolContext.
   * Defaults to a context with workspace=process.cwd().
   */
  ctxFactory?: () => ToolContext;
}

// ============================================
// Helpers
// ============================================

function defaultCtxFactory(): ToolContext {
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
export function createMcpServer(opts: McpServerOptions = {}): Server {
  const { ctxFactory = defaultCtxFactory } = opts;

  const server = new Server(
    { name: 'pyrfor-runtime', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // ── tools/list ──────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, () => {
    logger.info('[mcp-server] tools/list requested');

    const tools = runtimeToolDefinitions.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: {
        type: 'object' as const,
        properties: def.parameters.properties,
        ...(def.parameters.required ? { required: def.parameters.required } : {}),
      },
    }));

    return { tools };
  });

  // ── tools/call ──────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    logger.info('[mcp-server] tools/call', { tool: name });

    const ctx = ctxFactory();

    try {
      const result = await executeRuntimeTool(
        name,
        args as Record<string, unknown>,
        ctx,
      );

      if (!result.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: result.error ?? 'Tool execution failed' }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: typeof result.data === 'string'
              ? result.data
              : JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (err) {
      logger.error('[mcp-server] tools/call error', { tool: name, error: String(err) });
      return {
        isError: true,
        content: [{ type: 'text' as const, text: String(err) }],
      };
    }
  });

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
export async function runMcpStdio(opts: McpServerOptions = {}): Promise<void> {
  const server = createMcpServer(opts);
  const transport = new StdioServerTransport();

  logger.info('[mcp-server] starting stdio transport');
  await server.connect(transport);
  logger.info('[mcp-server] connected — waiting for client messages');

  return new Promise<void>((resolve) => {
    transport.onclose = () => {
      logger.info('[mcp-server] transport closed');
      resolve();
    };
  });
}
