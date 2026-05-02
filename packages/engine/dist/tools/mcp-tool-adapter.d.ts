/**
 * mcp-tool-adapter.ts — MCP → Tool Engine adapter for Pyrfor.
 *
 * Bridges the MCP client (tool discovery + invocation) with the Pyrfor Tool
 * Engine: registers discovered MCP tools into a ToolRegistry, gates invocations
 * through PermissionEngine, and emits audit events to EventLedger.
 *
 * Key design choices:
 *  - McpClientLike is a structural interface that matches the *actual* public
 *    surface of McpClient (listTools / call) — no modifications to mcp-client.ts.
 *  - Namespace prefix isolates MCP tools from native engine tools.
 *  - classifyTool is a pure helper: deterministic, side-effect-free, exportable.
 */
import { ToolRegistry, PermissionEngine, type ToolSpec, type PermissionClass, type SideEffectClass } from '../runtime/permission-engine';
import { EventLedger } from '../runtime/event-ledger';
export interface McpClientLike {
    listTools(serverName?: string): Array<{
        name: string;
        description?: string;
        inputSchema?: unknown;
        serverName?: string;
    }>;
    call(serverName: string, toolName: string, args: Record<string, unknown>): Promise<{
        ok: boolean;
        content?: unknown;
        error?: string;
        durationMs: number;
    }>;
}
export interface RegisteredMcpTool {
    /** Namespaced name exposed to the Tool Engine: `${namespace}.${underlying}` */
    name: string;
    /** ToolSpec registered into the ToolRegistry */
    spec: ToolSpec;
    /** Original tool name as returned by the MCP server */
    underlying: string;
    /** MCP server name (used when calling back into McpClientLike.call) */
    serverName?: string;
}
export interface McpToolAdapterOptions {
    mcpClient: McpClientLike;
    /** Existing registry to register into. If omitted, a private one is created. */
    registry?: ToolRegistry;
    /** Permission engine for gating invocations. If omitted, all invocations proceed. */
    permissions?: PermissionEngine;
    /** Event ledger for audit trail. If omitted, no events are emitted. */
    ledger?: EventLedger;
    /** Prefix for tool names exposed to the engine. Default: 'mcp'. */
    namespace?: string;
}
export interface InvokeContext {
    workspaceId: string;
    sessionId: string;
    runId?: string;
}
export interface InvokeResult {
    ok: boolean;
    result?: unknown;
    error?: string;
    ms: number;
    permissionPrompted?: boolean;
}
/** Classify a tool by its name to derive sideEffect + default permission class. */
export declare function classifyTool(name: string): {
    side: SideEffectClass;
    perm: PermissionClass;
};
/** Build the namespaced tool name: `${ns}.${name}`. */
export declare function namespacedName(ns: string, name: string): string;
/**
 * Adapts an MCP client's tool surface into the Pyrfor Tool Engine.
 *
 * Usage:
 *   const adapter = new McpToolAdapter({ mcpClient, registry, permissions, ledger });
 *   const tools = await adapter.refresh();
 *   const result = await adapter.invoke('mcp.read_file', { path: '...' }, ctx);
 */
export declare class McpToolAdapter {
    private readonly _client;
    private readonly _registry;
    private readonly _permissions;
    private readonly _ledger;
    private readonly _namespace;
    /** Cache of tools registered by the last refresh() call. */
    private _tools;
    constructor(opts: McpToolAdapterOptions);
    /**
     * Discover tools from MCP server(s), map them to ToolSpecs, register into
     * the ToolRegistry, and return the list of registered entries.
     *
     * Duplicate names (e.g. when refresh is called more than once) are skipped
     * with a warning rather than throwing.
     */
    refresh(): Promise<RegisteredMcpTool[]>;
    /** Return the last set of tools registered by refresh(). */
    listTools(): RegisteredMcpTool[];
    /**
     * Invoke a namespaced MCP tool.
     *
     * Lifecycle:
     *  1. Resolve tool from internal cache.
     *  2. Gate through PermissionEngine (if configured).
     *     - promptUser=true → return ok:false, permissionPrompted:true (caller shows UI)
     *     - allow=false     → return ok:false with reason as error
     *  3. Emit 'tool.requested' to ledger.
     *  4. Call underlying MCP tool (strips namespace prefix for outbound name).
     *  5. Emit 'tool.executed' to ledger.
     *  6. Return timing + result.
     */
    invoke(name: string, args: unknown, ctx: InvokeContext): Promise<InvokeResult>;
    /**
     * Record a one-time approval for an ask_once tool so the next invoke()
     * proceeds without prompting. Proxies to PermissionEngine.recordApproval.
     */
    approveOnce(toolName: string, ctx: InvokeContext): void;
}
//# sourceMappingURL=mcp-tool-adapter.d.ts.map