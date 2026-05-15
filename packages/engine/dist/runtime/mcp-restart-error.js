/** Expected rejection from MCP server restart (mapped to HTTP 404/409 by the gateway). */
export class McpRestartRejectedError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'McpRestartRejectedError';
    }
}
