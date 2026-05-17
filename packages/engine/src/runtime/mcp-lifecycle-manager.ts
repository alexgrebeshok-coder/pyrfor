import type { McpClient, McpServerConfig } from './mcp-client.js';
import { McpRestartRejectedError } from './mcp-restart-error.js';

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
export class McpLifecycleManagerStub implements McpLifecycleManager {
  constructor(
    private readonly client: McpClient,
    private readonly configs: Map<string, McpServerConfig> = new Map(),
  ) {}

  registerConfig(config: McpServerConfig): void {
    this.configs.set(config.name, config);
  }

  async healthCheck(serverName: string): Promise<boolean> {
    return this.client.isConnected(serverName);
  }

  listToolCount(serverName: string): number {
    return this.client.listTools(serverName).length;
  }

  async restart(serverName: string): Promise<void> {
    const config = this.configs.get(serverName);
    if (!config) {
      throw new McpRestartRejectedError(
        'mcp_server_unknown',
        `[MCP] no config registered for server '${serverName}'`,
      );
    }
    await this.client.disconnect(serverName);
    await this.client.connect(config);
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }

  getRegisteredServerNames(): string[] {
    return [...this.configs.keys()];
  }
}
