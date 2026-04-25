/**
 * mcp-client.ts — Pyrfor MCP (Model Context Protocol) client wrapper.
 *
 * Thin façade over @modelcontextprotocol/sdk that:
 *   - Connects to MCP servers via stdio or SSE transports.
 *   - Discovers tools and maintains a per-server tool cache.
 *   - Exposes a unified call() API + a registry other Pyrfor modules can query.
 *   - Emits lifecycle events ('connect', 'disconnect', 'tool').
 *
 * SDK is lazy-imported so callers that never connect to real servers avoid
 * the import cost; tests inject a fake via CreateMcpClientOptions.sdkFactory.
 */
export type McpTransportKind = 'stdio' | 'sse';
export interface McpServerConfig {
    name: string;
    transport: McpTransportKind;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    startupTimeoutMs?: number;
    callTimeoutMs?: number;
}
export interface McpToolDescriptor {
    serverName: string;
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}
export interface McpCallResult {
    ok: boolean;
    content?: any;
    raw?: unknown;
    error?: string;
    durationMs: number;
}
export interface McpClient {
    connect(cfg: McpServerConfig): Promise<void>;
    disconnect(name: string): Promise<void>;
    shutdown(): Promise<void>;
    listServers(): string[];
    listTools(serverName?: string): McpToolDescriptor[];
    call(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult>;
    isConnected(name: string): boolean;
    on(event: 'connect' | 'disconnect' | 'tool', cb: (payload: any) => void): () => void;
}
export interface McpServerHandle {
    name: string;
    listTools(): Promise<Array<{
        name: string;
        description?: string;
        inputSchema: any;
    }>>;
    callTool(name: string, args: Record<string, unknown>): Promise<{
        content?: any;
        raw?: unknown;
    }>;
    close(): Promise<void>;
}
export interface CreateMcpClientOptions {
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
    timeoutMs?: number;
    /** SDK injection for tests — lets us pass a fake instead of importing the real one. */
    sdkFactory?: (cfg: McpServerConfig) => Promise<McpServerHandle>;
}
/**
 * Create a new MCP client.
 *
 * Inject `sdkFactory` in tests to avoid spawning real child processes.
 * The returned client implements McpClient but also stores per-server call
 * timeouts so connect() → call() timeout chains work correctly.
 */
export declare function createMcpClient(opts?: CreateMcpClientOptions): McpClient;
//# sourceMappingURL=mcp-client.d.ts.map