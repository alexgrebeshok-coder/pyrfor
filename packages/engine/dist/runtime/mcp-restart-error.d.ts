/** Expected rejection from MCP server restart (mapped to HTTP 404/409 by the gateway). */
export declare class McpRestartRejectedError extends Error {
    readonly code: 'mcp_lifecycle_unavailable' | 'mcp_server_unknown';
    constructor(code: 'mcp_lifecycle_unavailable' | 'mcp_server_unknown', message: string);
}
//# sourceMappingURL=mcp-restart-error.d.ts.map