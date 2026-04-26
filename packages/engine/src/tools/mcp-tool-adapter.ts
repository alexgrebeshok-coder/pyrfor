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

import { logger } from '../observability/logger';
import {
  ToolRegistry,
  PermissionEngine,
  type ToolSpec,
  type PermissionClass,
  type SideEffectClass,
} from '../runtime/permission-engine';
import { EventLedger, type LedgerEvent } from '../runtime/event-ledger';

/** Workaround: Omit<DiscriminatedUnion, keys> doesn't distribute — use this alias for append calls. */
type AppendPayload = Omit<LedgerEvent, 'id' | 'ts' | 'seq'>;

// ====== McpClientLike — structural match to McpClient public API =============
//
// Matches the ACTUAL public methods exposed by packages/engine/src/runtime/mcp-client.ts:
//   listTools(serverName?)  → McpToolDescriptor[]  (synchronous registry query)
//   call(serverName, toolName, args) → Promise<McpCallResult>

export interface McpClientLike {
  listTools(serverName?: string): Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
    serverName?: string;
  }>;
  call(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    content?: unknown;
    error?: string;
    durationMs: number;
  }>;
}

// ====== RegisteredMcpTool ====================================================

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

// ====== McpToolAdapterOptions ================================================

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

// ====== InvokeContext ========================================================

export interface InvokeContext {
  workspaceId: string;
  sessionId: string;
  runId?: string;
}

// ====== InvokeResult =========================================================

export interface InvokeResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  ms: number;
  permissionPrompted?: boolean;
}

// ====== Pure helpers =========================================================

/** Classify a tool by its name to derive sideEffect + default permission class. */
export function classifyTool(name: string): { side: SideEffectClass; perm: PermissionClass } {
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
export function namespacedName(ns: string, name: string): string {
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
  // ── Private state ──────────────────────────────────────────────────────────
  private readonly _client: McpClientLike;
  private readonly _registry: ToolRegistry;
  private readonly _permissions: PermissionEngine | undefined;
  private readonly _ledger: EventLedger | undefined;
  private readonly _namespace: string;
  /** Cache of tools registered by the last refresh() call. */
  private _tools: RegisteredMcpTool[] = [];

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(opts: McpToolAdapterOptions) {
    this._client = opts.mcpClient;
    this._registry = opts.registry ?? new ToolRegistry();
    this._permissions = opts.permissions;
    this._ledger = opts.ledger;
    this._namespace = opts.namespace ?? 'mcp';
  }

  // ── refresh ────────────────────────────────────────────────────────────────

  /**
   * Discover tools from MCP server(s), map them to ToolSpecs, register into
   * the ToolRegistry, and return the list of registered entries.
   *
   * Duplicate names (e.g. when refresh is called more than once) are skipped
   * with a warning rather than throwing.
   */
  async refresh(): Promise<RegisteredMcpTool[]> {
    const rawTools = this._client.listTools();
    const registered: RegisteredMcpTool[] = [];

    for (const raw of rawTools) {
      const { side, perm } = classifyTool(raw.name);
      const nsName = namespacedName(this._namespace, raw.name);

      const spec: ToolSpec = {
        name: nsName,
        description: raw.description ?? raw.name.replace(/_/g, ' '),
        inputSchema: raw.inputSchema ?? {},
        outputSchema: {},
        sideEffect: side,
        defaultPermission: perm,
        timeoutMs: 30_000,
        idempotent: side === 'read',
        requiresApproval: perm === 'ask_every_time',
      };

      try {
        this._registry.register(spec);
      } catch {
        logger.warn(`[McpToolAdapter] Skipping duplicate registration for "${nsName}"`);
        continue;
      }

      const entry: RegisteredMcpTool = {
        name: nsName,
        spec,
        underlying: raw.name,
        serverName: raw.serverName,
      };
      registered.push(entry);
    }

    this._tools = registered;
    return registered;
  }

  // ── listTools ─────────────────────────────────────────────────────────────

  /** Return the last set of tools registered by refresh(). */
  listTools(): RegisteredMcpTool[] {
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
  async invoke(name: string, args: unknown, ctx: InvokeContext): Promise<InvokeResult> {
    const tool = this._tools.find((t) => t.name === name);
    if (!tool) {
      logger.warn(`[McpToolAdapter] invoke called for unknown tool "${name}"`);
      return { ok: false, error: `Unknown tool: ${name}`, ms: 0 };
    }

    const start = Date.now();

    // ── Permission check ───────────────────────────────────────────────────
    if (this._permissions) {
      const decision = await this._permissions.check(name, ctx, args);
      if (decision.promptUser) {
        return { ok: false, permissionPrompted: true, ms: Date.now() - start };
      }
      if (!decision.allow) {
        return { ok: false, error: decision.reason, ms: Date.now() - start };
      }
    }

    const runId = ctx.runId ?? ctx.sessionId;

    // ── Call MCP client ────────────────────────────────────────────────────
    const safeArgs = (typeof args === 'object' && args !== null && !Array.isArray(args)
      ? args
      : {}) as Record<string, unknown>;

    // ── Emit tool.requested ────────────────────────────────────────────────
    if (this._ledger) {
      await this._ledger.append({
        type: 'tool.requested',
        run_id: runId,
        tool: name,
        args: safeArgs,
      } as unknown as AppendPayload);
    }

    let ok: boolean;
    let result: unknown;
    let error: string | undefined;

    try {
      const mcpResult = await this._client.call(
        tool.serverName ?? '',
        tool.underlying,
        safeArgs,
      );
      ok = mcpResult.ok;
      result = mcpResult.content;
      error = mcpResult.error;
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }

    const ms = Date.now() - start;

    // ── Emit tool.executed ─────────────────────────────────────────────────
    if (this._ledger) {
      await this._ledger.append({
        type: 'tool.executed',
        run_id: runId,
        tool: name,
        ms,
        status: ok ? 'success' : 'error',
        ...(error !== undefined ? { error } : {}),
      } as unknown as AppendPayload);
    }

    return { ok, result, error, ms };
  }

  // ── approveOnce ───────────────────────────────────────────────────────────

  /**
   * Record a one-time approval for an ask_once tool so the next invoke()
   * proceeds without prompting. Proxies to PermissionEngine.recordApproval.
   */
  approveOnce(toolName: string, ctx: InvokeContext): void {
    this._permissions?.recordApproval(ctx.workspaceId, toolName);
  }
}
