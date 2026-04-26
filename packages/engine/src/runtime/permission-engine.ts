/**
 * permission-engine.ts — Tool permission management for Pyrfor.
 *
 * Implements a permission ladder (auto_allow → ask_once → ask_every_time → deny)
 * with profile-based overrides (strict / standard / autonomous), per-workspace
 * approval memory, and a standard catalog of built-in tool specs.
 *
 * All state is in-memory. No I/O. No external dependencies.
 */

import { logger } from '../observability/logger';

// ====== Public types =========================================================

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

// ====== ToolRegistry =========================================================

/**
 * In-memory registry of tool specs. Throws on duplicate registration.
 */
export class ToolRegistry {
  // ── Private state ──────────────────────────────────────────────────────────
  private readonly _specs = new Map<string, ToolSpec>();

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Register a tool spec. Throws if a spec with the same name already exists. */
  register(spec: ToolSpec): void {
    if (this._specs.has(spec.name)) {
      throw new Error(`ToolRegistry: duplicate tool name "${spec.name}"`);
    }
    this._specs.set(spec.name, spec);
  }

  /** Retrieve a spec by name, or undefined if not found. */
  get(name: string): ToolSpec | undefined {
    return this._specs.get(name);
  }

  /** List all registered specs. */
  list(): ToolSpec[] {
    return Array.from(this._specs.values());
  }
}

// ====== Standard tool catalog ================================================

/**
 * Register the 14 standard built-in tools into the provided registry.
 * Safe to call once per ToolRegistry instance.
 */
export function registerStandardTools(registry: ToolRegistry): void {
  const tools: Array<Partial<ToolSpec> & Pick<ToolSpec, 'name' | 'sideEffect' | 'defaultPermission'>> = [
    // ── Read tools (auto_allow) ───────────────────────────────────────────────
    { name: 'read_file',        sideEffect: 'read',        defaultPermission: 'auto_allow',    idempotent: true },
    { name: 'list_dir',         sideEffect: 'read',        defaultPermission: 'auto_allow',    idempotent: true },
    { name: 'search',           sideEffect: 'read',        defaultPermission: 'auto_allow',    idempotent: true },

    // ── Write / exec tools (ask_once) ─────────────────────────────────────────
    { name: 'write_file',       sideEffect: 'write',       defaultPermission: 'ask_once' },
    { name: 'apply_patch',      sideEffect: 'write',       defaultPermission: 'ask_once' },
    { name: 'run_test',         sideEffect: 'execute',     defaultPermission: 'ask_once' },
    { name: 'create_branch',    sideEffect: 'write',       defaultPermission: 'ask_once' },
    { name: 'browser_navigate', sideEffect: 'network',     defaultPermission: 'ask_once' },

    // ── High-risk tools (ask_every_time) ─────────────────────────────────────
    { name: 'shell_exec',       sideEffect: 'execute',     defaultPermission: 'ask_every_time', requiresApproval: true },
    { name: 'git_push',         sideEffect: 'network',     defaultPermission: 'ask_every_time' },
    { name: 'deploy',           sideEffect: 'execute',     defaultPermission: 'ask_every_time' },
    { name: 'secrets_access',   sideEffect: 'read',        defaultPermission: 'ask_every_time', auditRedact: ['value'] },
    { name: 'network_write',    sideEffect: 'network',     defaultPermission: 'ask_every_time' },
    { name: 'delete_file',      sideEffect: 'destructive', defaultPermission: 'ask_every_time' },
  ];

  for (const partial of tools) {
    registry.register({
      name: partial.name,
      description: partial.name.replace(/_/g, ' '),
      inputSchema: {},
      outputSchema: {},
      sideEffect: partial.sideEffect,
      defaultPermission: partial.defaultPermission,
      timeoutMs: 30_000,
      idempotent: partial.idempotent ?? false,
      requiresApproval: partial.requiresApproval ?? false,
      ...(partial.auditRedact ? { auditRedact: partial.auditRedact } : {}),
    });
  }
}

// ====== PermissionEngine =====================================================

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
export class PermissionEngine {
  // ── Private state ──────────────────────────────────────────────────────────
  private readonly _registry: ToolRegistry;
  private readonly _profile: 'strict' | 'standard' | 'autonomous';
  private readonly _overrides: Record<string, PermissionClass>;
  /** Set of "workspaceId::toolName" keys where ask_once approval has been granted. */
  private readonly _approvals = new Set<string>();

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(registry: ToolRegistry, opts?: PermissionEngineOptions) {
    this._registry = registry;
    this._profile = opts?.profile ?? 'standard';
    this._overrides = { ...(opts?.overrides ?? {}) };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _approvalKey(workspaceId: string, toolName: string): string {
    return `${workspaceId}::${toolName}`;
  }

  /**
   * Resolve the effective permission class for a tool, applying profile rules.
   *
   * Priority: overrides > profile-modified default > spec.defaultPermission
   */
  private _resolveClass(spec: ToolSpec): PermissionClass {
    // 1. Explicit override wins
    if (this._overrides[spec.name] !== undefined) {
      return this._overrides[spec.name];
    }

    const base = spec.defaultPermission;

    // 2. Apply profile transformations
    if (this._profile === 'strict') {
      // Upgrade auto_allow to ask_every_time for non-read side-effects
      if (
        base === 'auto_allow' &&
        (spec.sideEffect === 'write' ||
          spec.sideEffect === 'execute' ||
          spec.sideEffect === 'network' ||
          spec.sideEffect === 'destructive')
      ) {
        return 'ask_every_time';
      }
    } else if (this._profile === 'autonomous') {
      // Downgrade ask_once to auto_allow for read/write — NEVER for destructive/execute
      if (
        base === 'ask_once' &&
        (spec.sideEffect === 'read' || spec.sideEffect === 'write')
      ) {
        return 'auto_allow';
      }
    }

    return base;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Evaluate whether a tool invocation is permitted.
   *
   * - auto_allow  → allow immediately, no prompt
   * - ask_once    → first call per workspace prompts; after recordApproval: allow silently
   * - ask_every_time → always prompt and deny (caller must call grant())
   * - deny        → always deny, no prompt
   */
  async check(toolName: string, ctx: PermissionContext, args?: unknown): Promise<Decision> {
    const spec = this._registry.get(toolName);

    if (!spec) {
      const decision: Decision = {
        allow: false,
        reason: 'unknown_tool',
        promptUser: false,
        permissionClass: 'deny',
      };
      logger.info('permission.check', {
        toolName,
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        runId: ctx.runId,
        ...decision,
      });
      return decision;
    }

    const effectiveClass = this._resolveClass(spec);
    let decision: Decision;

    switch (effectiveClass) {
      case 'auto_allow':
        decision = {
          allow: true,
          reason: 'auto_allow',
          promptUser: false,
          permissionClass: 'auto_allow',
        };
        break;

      case 'ask_once': {
        const key = this._approvalKey(ctx.workspaceId, toolName);
        if (this._approvals.has(key)) {
          decision = {
            allow: true,
            reason: 'previously_approved',
            promptUser: false,
            permissionClass: 'ask_once',
          };
        } else {
          decision = {
            allow: false,
            reason: 'approval_required',
            promptUser: true,
            permissionClass: 'ask_once',
          };
        }
        break;
      }

      case 'ask_every_time':
        decision = {
          allow: false,
          reason: 'requires_confirmation',
          promptUser: true,
          permissionClass: 'ask_every_time',
        };
        break;

      case 'deny':
        decision = {
          allow: false,
          reason: 'denied',
          promptUser: false,
          permissionClass: 'deny',
        };
        break;

      default: {
        // Exhaustiveness guard — should never be reached
        const _exhaustive: never = effectiveClass;
        void _exhaustive;
        decision = { allow: false, reason: 'unknown_class', promptUser: false, permissionClass: 'deny' };
      }
    }

    logger.info('permission.check', {
      toolName,
      workspaceId: ctx.workspaceId,
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      sideEffect: spec.sideEffect,
      effectiveClass,
      profile: this._profile,
      allow: decision.allow,
      promptUser: decision.promptUser,
      reason: decision.reason,
      ...(spec.auditRedact ? { auditRedact: spec.auditRedact } : {}),
      ...(args !== undefined && spec.auditRedact === undefined ? { args } : {}),
    });

    return decision;
  }

  /**
   * Record that the user has approved a tool for this workspace (ask_once semantics).
   */
  recordApproval(workspaceId: string, toolName: string): void {
    this._approvals.add(this._approvalKey(workspaceId, toolName));
  }

  /**
   * Revoke a previously recorded approval, restoring ask_once prompt behaviour.
   */
  revokeApproval(workspaceId: string, toolName: string): void {
    this._approvals.delete(this._approvalKey(workspaceId, toolName));
  }

  /**
   * Immediately grant access for a tool invocation.
   *
   * @param oneShot - If false, also persists an ask_once approval for the workspace.
   */
  grant(toolName: string, ctx: PermissionContext, oneShot = true): Decision {
    if (!oneShot) {
      this.recordApproval(ctx.workspaceId, toolName);
    }

    const spec = this._registry.get(toolName);
    const effectiveClass: PermissionClass = spec ? this._resolveClass(spec) : 'ask_every_time';

    const decision: Decision = {
      allow: true,
      reason: oneShot ? 'one_shot_grant' : 'persisted_grant',
      promptUser: false,
      permissionClass: effectiveClass,
    };

    logger.info('permission.grant', {
      toolName,
      workspaceId: ctx.workspaceId,
      sessionId: ctx.sessionId,
      oneShot,
    });

    return decision;
  }

  /**
   * Export all currently stored approvals (workspaceId + toolName pairs).
   */
  exportApprovals(): Array<{ workspaceId: string; toolName: string }> {
    return Array.from(this._approvals).map((key) => {
      const idx = key.indexOf('::');
      return { workspaceId: key.slice(0, idx), toolName: key.slice(idx + 2) };
    });
  }
}
