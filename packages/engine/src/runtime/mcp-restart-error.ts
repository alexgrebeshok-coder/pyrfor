/** Expected rejection from MCP server restart (mapped to HTTP 404/409 by the gateway). */
export class McpRestartRejectedError extends Error {
  constructor(
    public readonly code: 'mcp_lifecycle_unavailable' | 'mcp_server_unknown',
    message: string,
  ) {
    super(message);
    this.name = 'McpRestartRejectedError';
  }
}
