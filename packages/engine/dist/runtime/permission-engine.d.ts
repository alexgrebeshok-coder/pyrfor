/**
 * permission-engine.ts — Tool permission management for Pyrfor.
 *
 * Implements a permission ladder (auto_allow → ask_once → ask_every_time → deny)
 * with profile-based overrides (strict / standard / autonomous), per-workspace
 * approval memory, and a standard catalog of built-in tool specs.
 *
 * All state is in-memory. No I/O. No external dependencies.
 */
export type PermissionClass = 'auto_allow' | 'ask_once' | 'ask_every_time' | 'deny';
export type SideEffectClass = 'read' | 'write' | 'execute' | 'network' | 'destructive';
export interface ToolSpec {
    name: string;
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
    sideEffect: SideEffectClass;
    defaultPermission: PermissionClass;
    timeoutMs: number;
    sandbox?: string;
    idempotent: boolean;
    requiresApproval: boolean;
    auditRedact?: string[];
}
export interface Decision {
    allow: boolean;
    reason: string;
    promptUser: boolean;
    permissionClass: PermissionClass;
}
export interface PermissionContext {
    workspaceId: string;
    sessionId: string;
    runId?: string;
}
/**
 * In-memory registry of tool specs. Throws on duplicate registration.
 */
export declare class ToolRegistry {
    private readonly _specs;
    /** Register a tool spec. Throws if a spec with the same name already exists. */
    register(spec: ToolSpec): void;
    /** Retrieve a spec by name, or undefined if not found. */
    get(name: string): ToolSpec | undefined;
    /** List all registered specs. */
    list(): ToolSpec[];
}
/**
 * Register the 14 standard built-in tools into the provided registry.
 * Safe to call once per ToolRegistry instance.
 */
export declare function registerStandardTools(registry: ToolRegistry): void;
export interface PermissionEngineOptions {
    /** Behavioural profile. Defaults to 'standard'. */
    profile?: 'strict' | 'standard' | 'autonomous';
    /** Per-tool class overrides (highest priority). */
    overrides?: Record<string, PermissionClass>;
    /** Unused — kept for API compatibility; approvals are always remembered in-memory. */
    rememberApprovals?: boolean;
}
/**
 * Evaluates tool invocation permission given a ToolRegistry and optional profile.
 */
export declare class PermissionEngine {
    private readonly _registry;
    private readonly _profile;
    private readonly _overrides;
    /** Set of "workspaceId::toolName" keys where ask_once approval has been granted. */
    private readonly _approvals;
    constructor(registry: ToolRegistry, opts?: PermissionEngineOptions);
    private _approvalKey;
    /**
     * Resolve the effective permission class for a tool, applying profile rules.
     *
     * Priority: overrides > profile-modified default > spec.defaultPermission
     */
    private _resolveClass;
    /**
     * Evaluate whether a tool invocation is permitted.
     *
     * - auto_allow  → allow immediately, no prompt
     * - ask_once    → first call per workspace prompts; after recordApproval: allow silently
     * - ask_every_time → always prompt and deny (caller must call grant())
     * - deny        → always deny, no prompt
     */
    check(toolName: string, ctx: PermissionContext, args?: unknown): Promise<Decision>;
    /**
     * Record that the user has approved a tool for this workspace (ask_once semantics).
     */
    recordApproval(workspaceId: string, toolName: string): void;
    /**
     * Revoke a previously recorded approval, restoring ask_once prompt behaviour.
     */
    revokeApproval(workspaceId: string, toolName: string): void;
    /**
     * Immediately grant access for a tool invocation.
     *
     * @param oneShot - If false, also persists an ask_once approval for the workspace.
     */
    grant(toolName: string, ctx: PermissionContext, oneShot?: boolean): Decision;
    /**
     * Export all currently stored approvals (workspaceId + toolName pairs).
     */
    exportApprovals(): Array<{
        workspaceId: string;
        toolName: string;
    }>;
}
//# sourceMappingURL=permission-engine.d.ts.map