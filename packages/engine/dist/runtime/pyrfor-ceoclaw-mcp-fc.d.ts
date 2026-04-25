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
export interface CeoclawMcpClient {
    getTask: (taskId: string) => Promise<{
        taskId: string;
        title: string;
        status: string;
        spec?: string;
    }>;
    listTasks: (filter?: {
        status?: string;
    }) => Promise<Array<{
        taskId: string;
        title: string;
        status: string;
    }>>;
    updateStatus: (taskId: string, status: string) => Promise<void>;
}
export interface CeoclawMcpFcOptions {
    client: CeoclawMcpClient;
}
/**
 * Builds 3 CEOClaw PM tools wired to the provided client, plus a sentinel
 * FC MCP config entry. Same in-process sentinel pattern as PyrforMcpServer —
 * replace `command: "__in_process__"` with a real stdio bridge in production.
 */
export declare function buildCeoclawMcpFc(opts: CeoclawMcpFcOptions): {
    tools: PyrforMcpTool[];
    toFcMcpConfigEntry(): {
        name: string;
        config: any;
    };
};
//# sourceMappingURL=pyrfor-ceoclaw-mcp-fc.d.ts.map