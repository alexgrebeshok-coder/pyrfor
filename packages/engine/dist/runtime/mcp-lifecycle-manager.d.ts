import type { McpClient, McpServerConfig } from './mcp-client.js';
export interface McpLifecycleManager {
    healthCheck(serverName: string): Promise<boolean>;
    restart(serverName: string): Promise<void>;
    shutdown(): Promise<void>;
    /** Names of servers with a registered config (may include disconnected servers). */
    getRegisteredServerNames(): string[];
    listToolCount(serverName: string): number;
}
/**
 * Minimal lifecycle coordinator for MCP servers (engine-side stub).
 * Stdio sidecar restart is deferred to the IDE host.
 */
export declare class McpLifecycleManagerStub implements McpLifecycleManager {
    private readonly client;
    private readonly configs;
    constructor(client: McpClient, configs?: Map<string, McpServerConfig>);
    registerConfig(config: McpServerConfig): void;
    healthCheck(serverName: string): Promise<boolean>;
    listToolCount(serverName: string): number;
    restart(serverName: string): Promise<void>;
    shutdown(): Promise<void>;
    getRegisteredServerNames(): string[];
}
//# sourceMappingURL=mcp-lifecycle-manager.d.ts.map