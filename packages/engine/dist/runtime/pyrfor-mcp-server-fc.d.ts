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
export interface PyrforMcpTool {
    name: string;
    description: string;
    inputSchema: object;
    handler: (input: any) => Promise<any>;
}
export interface PyrforMcpServerOptions {
    memorySearch: (q: string, opts?: {
        topK?: number;
        scope?: string;
    }) => Promise<Array<{
        id: string;
        text: string;
        score: number;
    }>>;
    skillQuery: (q: string) => Promise<Array<{
        slug: string;
        title: string;
        tags: string[];
        body: string;
    }>>;
    pmContext: (taskId: string) => Promise<{
        taskId: string;
        spec?: string;
        status?: string;
        relatedTasks?: string[];
    }>;
}
export declare class PyrforMcpServer {
    private readonly _tools;
    constructor(opts: PyrforMcpServerOptions);
    /** Returns the 3 registered tools. */
    listTools(): PyrforMcpTool[];
    /** Dispatch a tool call by name. Throws on unknown name. */
    call(name: string, input: any): Promise<any>;
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
        servers: Record<string, {
            command?: string;
            args?: string[];
            env?: Record<string, string>;
        }>;
    };
}
//# sourceMappingURL=pyrfor-mcp-server-fc.d.ts.map