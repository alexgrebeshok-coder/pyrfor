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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../observability/logger.js';
import { ToolRegistry, } from '../runtime/permission-engine.js';
// ====== Pure helpers =========================================================
/** Classify a tool by its name to derive sideEffect + default permission class. */
export function classifyTool(name) {
    const lower = name.toLowerCase();
    // Destructive operations — highest priority
    if (/(delete|drop|wipe|destroy)/.test(lower)) {
        return { side: 'destructive', perm: 'ask_every_time' };
    }
    // Execute operations
    if (/(exec|run|push|deploy)/.test(lower)) {
        return { side: 'execute', perm: 'ask_once' };
    }
    // Write / create operations
    if (/(write|create)/.test(lower)) {
        return { side: 'write', perm: 'ask_once' };
    }
    // Network / browser operations
    if (/(browse|navigate|fetch|http|url|network)/.test(lower)) {
        return { side: 'network', perm: 'ask_once' };
    }
    // Default: read-only
    return { side: 'read', perm: 'auto_allow' };
}
/** Build the namespaced tool name: `${ns}.${name}`. */
export function namespacedName(ns, name) {
    return `${ns}.${name}`;
}
// ====== McpToolAdapter =======================================================
/**
 * Adapts an MCP client's tool surface into the Pyrfor Tool Engine.
 *
 * Usage:
 *   const adapter = new McpToolAdapter({ mcpClient, registry, permissions, ledger });
 *   const tools = await adapter.refresh();
 *   const result = await adapter.invoke('mcp.read_file', { path: '...' }, ctx);
 */
export class McpToolAdapter {
    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(opts) {
        var _a, _b;
        /** Cache of tools registered by the last refresh() call. */
        this._tools = [];
        this._client = opts.mcpClient;
        this._registry = (_a = opts.registry) !== null && _a !== void 0 ? _a : new ToolRegistry();
        this._permissions = opts.permissions;
        this._ledger = opts.ledger;
        this._namespace = (_b = opts.namespace) !== null && _b !== void 0 ? _b : 'mcp';
    }
    // ── refresh ────────────────────────────────────────────────────────────────
    /**
     * Discover tools from MCP server(s), map them to ToolSpecs, register into
     * the ToolRegistry, and return the list of registered entries.
     *
     * Duplicate names (e.g. when refresh is called more than once) are skipped
     * with a warning rather than throwing.
     */
    refresh() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const rawTools = this._client.listTools();
            const registered = [];
            for (const raw of rawTools) {
                const { side, perm } = classifyTool(raw.name);
                const nsName = namespacedName(this._namespace, raw.name);
                const spec = {
                    name: nsName,
                    description: (_a = raw.description) !== null && _a !== void 0 ? _a : raw.name.replace(/_/g, ' '),
                    inputSchema: (_b = raw.inputSchema) !== null && _b !== void 0 ? _b : {},
                    outputSchema: {},
                    sideEffect: side,
                    defaultPermission: perm,
                    timeoutMs: 30000,
                    idempotent: side === 'read',
                    requiresApproval: perm === 'ask_every_time',
                };
                try {
                    this._registry.register(spec);
                }
                catch (_c) {
                    logger.warn(`[McpToolAdapter] Skipping duplicate registration for "${nsName}"`);
                    continue;
                }
                const entry = {
                    name: nsName,
                    spec,
                    underlying: raw.name,
                    serverName: raw.serverName,
                };
                registered.push(entry);
            }
            this._tools = registered;
            return registered;
        });
    }
    // ── listTools ─────────────────────────────────────────────────────────────
    /** Return the last set of tools registered by refresh(). */
    listTools() {
        return this._tools;
    }
    // ── invoke ────────────────────────────────────────────────────────────────
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
    invoke(name, args, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const tool = this._tools.find((t) => t.name === name);
            if (!tool) {
                logger.warn(`[McpToolAdapter] invoke called for unknown tool "${name}"`);
                return { ok: false, error: `Unknown tool: ${name}`, ms: 0 };
            }
            const start = Date.now();
            // ── Permission check ───────────────────────────────────────────────────
            if (this._permissions) {
                const decision = yield this._permissions.check(name, ctx, args);
                if (decision.promptUser) {
                    return { ok: false, permissionPrompted: true, ms: Date.now() - start };
                }
                if (!decision.allow) {
                    return { ok: false, error: decision.reason, ms: Date.now() - start };
                }
            }
            const runId = (_a = ctx.runId) !== null && _a !== void 0 ? _a : ctx.sessionId;
            // ── Call MCP client ────────────────────────────────────────────────────
            const safeArgs = (typeof args === 'object' && args !== null && !Array.isArray(args)
                ? args
                : {});
            // ── Emit tool.requested ────────────────────────────────────────────────
            if (this._ledger) {
                yield this._ledger.append({
                    type: 'tool.requested',
                    run_id: runId,
                    tool: name,
                    args: safeArgs,
                });
            }
            let ok;
            let result;
            let error;
            try {
                const mcpResult = yield this._client.call((_b = tool.serverName) !== null && _b !== void 0 ? _b : '', tool.underlying, safeArgs);
                ok = mcpResult.ok;
                result = mcpResult.content;
                error = mcpResult.error;
            }
            catch (e) {
                ok = false;
                error = e instanceof Error ? e.message : String(e);
            }
            const ms = Date.now() - start;
            // ── Emit tool.executed ─────────────────────────────────────────────────
            if (this._ledger) {
                yield this._ledger.append(Object.assign({ type: 'tool.executed', run_id: runId, tool: name, ms, status: ok ? 'success' : 'error' }, (error !== undefined ? { error } : {})));
            }
            return { ok, result, error, ms };
        });
    }
    // ── approveOnce ───────────────────────────────────────────────────────────
    /**
     * Record a one-time approval for an ask_once tool so the next invoke()
     * proceeds without prompting. Proxies to PermissionEngine.recordApproval.
     */
    approveOnce(toolName, ctx) {
        var _a;
        (_a = this._permissions) === null || _a === void 0 ? void 0 : _a.recordApproval(ctx.workspaceId, toolName);
    }
}
