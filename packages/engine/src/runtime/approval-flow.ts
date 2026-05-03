/**
 * Approval Flow — safety gate between LLM tool calls and execution.
 *
 * Categories:
 *   auto  — execute immediately (read/write/web tools, etc.)
 *   ask   — prompt user via Telegram inline keyboard
 *   block — deny immediately (dangerous destructive commands)
 *
 * Persistent settings: ~/.pyrfor/approval-settings.json
 *   whitelist           — always auto-approve (substring match on "tool: cmd")
 *   blacklist           — always deny
 *   autoApprovePatterns — additional regex auto-approves
 *   defaultAction       — 'approve' | 'ask' | 'deny' for unmatched ask-category tools
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../observability/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalDecision = 'approve' | 'deny' | 'timeout';
export type ApprovalCategory = 'auto' | 'ask' | 'block';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
  run_id?: string;
  effect_id?: string;
  effect_kind?: string;
  policy_id?: string;
  reason?: string;
  approval_required?: boolean;
}

export interface ApprovalAuditEvent {
  id: string;
  ts: string;
  type:
    | 'approval.requested'
    | 'approval.approved'
    | 'approval.denied'
    | 'approval.timeout'
    | 'tool.executed'
    | 'tool.denied';
  requestId: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
  decision?: ApprovalDecision;
  sessionId?: string;
  toolCallId?: string;
  resultSummary?: string;
  error?: string;
  undo?: { supported: boolean; kind?: string };
  run_id?: string;
  effect_id?: string;
  effect_kind?: string;
  policy_id?: string;
  reason?: string;
  approval_required?: boolean;
}

export interface ResolvedApproval {
  request: ApprovalRequest;
  decision: ApprovalDecision;
}

interface PendingItem {
  resolve: (decision: ApprovalDecision) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  summary: string;
  toolName: string;
  args: Record<string, unknown>;
  run_id?: string;
  effect_id?: string;
  effect_kind?: string;
  policy_id?: string;
  reason?: string;
  approval_required?: boolean;
}

export type ApprovalFlowEvent =
  | { type: 'approval-requested'; request: ApprovalRequest }
  | { type: 'approval-resolved'; request: ApprovalRequest; decision: ApprovalDecision }
  | { type: 'approval-audit'; event: ApprovalAuditEvent };

export interface ApprovalSettings {
  whitelist?: string[];
  blacklist?: string[];
  defaultAction?: 'approve' | 'ask' | 'deny';
  autoApprovePatterns?: string[];
}

// ---------------------------------------------------------------------------
// Default category lists
// ---------------------------------------------------------------------------

const DEFAULT_AUTO_APPROVE_TOOLS = new Set([
  'read',
  'write',
  'edit_file',
  'web_search',
  'web_fetch',
  'process_list',
  'process_poll',
  'send_message',
]);

const DEFAULT_ASK_TOOLS = new Set(['exec', 'process_spawn', 'process_kill', 'browser']);

/** Commands that are immediately denied — no user prompt. */
const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//,
  /sudo\s/,
  /\bdrop\s+(table|database)\b/i,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /:\(\)\{:|:&\};:/,
];

/** Commands in exec/process_spawn that need user confirmation. */
const DEFAULT_ASK_PATTERNS: RegExp[] = [
  /npm\s+install/,
  /npm\s+run/,
  /git\s+push/,
  /git\s+commit/,
  /\bcurl\b/,
  /pip\s+install/,
];

// ---------------------------------------------------------------------------
// ApprovalFlow class
// ---------------------------------------------------------------------------

export class ApprovalFlow {
  readonly events = new EventEmitter();

  private readonly pending = new Map<string, PendingItem>();
  private readonly resolved = new Map<string, ApprovalDecision>();
  private readonly resolvedApprovals = new Map<string, ResolvedApproval>();
  private settings: ApprovalSettings = {};
  private readonly auditEvents: ApprovalAuditEvent[] = [];
  private settingsLoaded = false;
  private readonly settingsPath: string;
  private readonly ttlMs: number;

  constructor(
    opts: {
      settingsPath?: string;
      ttlMs?: number;
    } = {},
  ) {
    this.settingsPath =
      opts.settingsPath ?? path.join(os.homedir(), '.pyrfor', 'approval-settings.json');
    this.ttlMs = opts.ttlMs ?? 600_000;
  }

  // ── Settings I/O ──────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    try {
      const raw = await fsp.readFile(this.settingsPath, 'utf-8');
      this.settings = JSON.parse(raw) as ApprovalSettings;
    } catch {
      this.settings = {};
    }
    this.settingsLoaded = true;
  }

  async saveSettings(): Promise<void> {
    await fsp.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fsp.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.settingsLoaded) {
      await this.loadSettings();
    }
  }

  // ── Categorization ────────────────────────────────────────────────────────

  /**
   * Categorize a tool call — pure (synchronous) once settings are loaded.
   * Call loadSettings() / ensureLoaded() before using this.
   */
  categorize(toolName: string, args: Record<string, unknown>): ApprovalCategory {
    const normalizedToolName = normalizeApprovalToolName(toolName);
    const cmd =
      normalizedToolName === 'exec' || normalizedToolName === 'process_spawn'
        ? typeof args.command === 'string'
          ? args.command
          : ''
        : '';
    const summary = `${normalizedToolName}: ${cmd || JSON.stringify(args).slice(0, 200)}`;

    // Blacklist (user-configured) → block
    for (const bl of this.settings.blacklist ?? []) {
      if (summary.includes(bl)) return 'block';
    }

    // Hardcoded dangerous patterns → block
    if (normalizedToolName === 'exec' || normalizedToolName === 'process_spawn') {
      for (const re of DEFAULT_BLOCKED_PATTERNS) {
        if (re.test(cmd)) return 'block';
      }
    }

    // Whitelist (user-configured) → auto
    for (const wl of this.settings.whitelist ?? []) {
      if (summary.includes(wl)) return 'auto';
    }

    // User-configured regex auto-approves
    for (const pat of this.settings.autoApprovePatterns ?? []) {
      try {
        if (new RegExp(pat).test(summary)) return 'auto';
      } catch {
        // ignore invalid regex in settings
      }
    }

    // Default auto-approve tools
    if (DEFAULT_AUTO_APPROVE_TOOLS.has(normalizedToolName)) return 'auto';

    // Default ask tools
    if (DEFAULT_ASK_TOOLS.has(normalizedToolName)) return 'ask';

    // exec with ask patterns → ask
    if (normalizedToolName === 'exec') {
      for (const re of DEFAULT_ASK_PATTERNS) {
        if (re.test(cmd)) return 'ask';
      }
    }

    // Unknown tool: respect defaultAction
    const def = this.settings.defaultAction ?? 'ask';
    if (def === 'approve') return 'auto';
    if (def === 'deny') return 'block';
    return 'ask';
  }

  // ── Approval gate ─────────────────────────────────────────────────────────

  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    await this.ensureLoaded();
    const category = this.categorize(req.toolName, req.args);

    if (category === 'auto') return 'approve';

    if (category === 'block') {
      logger.warn('Tool blocked by approval flow', {
        toolName: req.toolName,
        summary: req.summary,
      });
      return 'deny';
    }

    // category === 'ask' — emit event and wait for resolveDecision or TTL
    return new Promise<ApprovalDecision>((resolve) => {
      this.recordAudit('approval.requested', req);
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(req.id);
        this.resolved.set(req.id, 'timeout');
        this.resolvedApprovals.set(req.id, { request: req, decision: 'timeout' });
        this.recordAudit('approval.timeout', req);
        this.emitApprovalEvent({ type: 'approval-resolved', request: req, decision: 'timeout' });
        logger.warn('Approval request timed out', { id: req.id, toolName: req.toolName });
        resolve('timeout');
      }, this.ttlMs);

      this.pending.set(req.id, {
        resolve,
        timeoutHandle,
        summary: req.summary,
        toolName: req.toolName,
        args: req.args,
        ...approvalMetadata(req),
      });

      this.events.emit('approval-requested', req);
      this.emitApprovalEvent({ type: 'approval-requested', request: req });
    });
  }

  async enqueueApproval(req: Omit<ApprovalRequest, 'id'> & { id?: string }): Promise<ApprovalRequest> {
    await this.ensureLoaded();
    const approval: ApprovalRequest = {
      id: req.id ?? randomUUID(),
      toolName: req.toolName,
      summary: req.summary,
      args: req.args,
      ...approvalMetadata(req),
    };
    this.recordAudit('approval.requested', approval);
    const timeoutHandle = setTimeout(() => {
      this.pending.delete(approval.id);
      this.resolved.set(approval.id, 'timeout');
      this.resolvedApprovals.set(approval.id, { request: approval, decision: 'timeout' });
      this.recordAudit('approval.timeout', approval);
      this.emitApprovalEvent({ type: 'approval-resolved', request: approval, decision: 'timeout' });
      logger.warn('Approval request timed out', { id: approval.id, toolName: approval.toolName });
    }, this.ttlMs);
    this.pending.set(approval.id, {
      resolve: (decision) => {
        this.resolved.set(approval.id, decision);
      },
      timeoutHandle,
      summary: approval.summary,
      toolName: approval.toolName,
      args: approval.args,
      ...approvalMetadata(approval),
    });
    this.events.emit('approval-requested', approval);
    this.emitApprovalEvent({ type: 'approval-requested', request: approval });
    return approval;
  }

  /**
   * Called by the Telegram callback handler when the user clicks
   * Approve/Deny on the inline keyboard.
   */
  resolveDecision(id: string, decision: 'approve' | 'deny'): boolean {
    const item = this.pending.get(id);
    if (!item) {
      logger.debug('resolveDecision: no pending item found', { id });
      return false;
    }
    clearTimeout(item.timeoutHandle);
    this.pending.delete(id);
    this.resolved.set(id, decision);
    const request: ApprovalRequest = {
      id,
      toolName: item.toolName,
      summary: item.summary,
      args: item.args,
      ...approvalMetadata(item),
    };
    this.resolvedApprovals.set(id, { request, decision });
    this.recordAudit(decision === 'approve' ? 'approval.approved' : 'approval.denied', {
      id,
      toolName: item.toolName,
      summary: item.summary,
      args: item.args,
      ...approvalMetadata(item),
    });
    item.resolve(decision);
    this.emitApprovalEvent({ type: 'approval-resolved', request, decision });
    return true;
  }

  getResolvedDecision(id: string): ApprovalDecision | undefined {
    return this.resolved.get(id);
  }

  getResolvedApproval(id: string): ResolvedApproval | undefined {
    return this.resolvedApprovals.get(id);
  }

  consumeResolvedApproval(id: string): ResolvedApproval | undefined {
    const approval = this.resolvedApprovals.get(id);
    if (!approval) return undefined;
    this.resolved.delete(id);
    this.resolvedApprovals.delete(id);
    return approval;
  }

  consumeResolvedDecision(id: string): ApprovalDecision | undefined {
    const decision = this.resolved.get(id);
    if (decision !== undefined) this.resolved.delete(id);
    this.resolvedApprovals.delete(id);
    return decision;
  }

  getPending(): ApprovalRequest[] {
    return Array.from(this.pending.entries()).map(([id, item]) => ({
      id,
      toolName: item.toolName,
      summary: item.summary,
      args: item.args,
      ...approvalMetadata(item),
    }));
  }

  listAudit(limit = 100): ApprovalAuditEvent[] {
    return this.auditEvents.slice(-limit).reverse();
  }

  recordToolOutcome(outcome: {
    requestId: string;
    toolName: string;
    summary: string;
    args: Record<string, unknown>;
    decision?: ApprovalDecision;
    sessionId?: string;
    toolCallId?: string;
    resultSummary?: string;
    error?: string;
    undo?: { supported: boolean; kind?: string };
  }): void {
    const event: ApprovalAuditEvent = {
      id: `${outcome.requestId}:tool:${Date.now()}`,
      ts: new Date().toISOString(),
      type: outcome.error ? 'tool.denied' : 'tool.executed',
      requestId: outcome.requestId,
      toolName: outcome.toolName,
      summary: outcome.summary,
      args: outcome.args,
      decision: outcome.decision,
      sessionId: outcome.sessionId,
      toolCallId: outcome.toolCallId,
      resultSummary: outcome.resultSummary,
      error: outcome.error,
      undo: outcome.undo ?? { supported: false },
    };
    this.auditEvents.push(event);
    if (this.auditEvents.length > 1000) {
      this.auditEvents.splice(0, this.auditEvents.length - 1000);
    }
    this.emitApprovalEvent({ type: 'approval-audit', event });
  }

  private recordAudit(type: ApprovalAuditEvent['type'], req: ApprovalRequest): void {
    const event: ApprovalAuditEvent = {
      id: `${req.id}:${type}:${Date.now()}`,
      ts: new Date().toISOString(),
      type,
      requestId: req.id,
      toolName: req.toolName,
      summary: req.summary,
      args: req.args,
      ...approvalMetadata(req),
    };
    this.auditEvents.push(event);
    if (this.auditEvents.length > 1000) {
      this.auditEvents.splice(0, this.auditEvents.length - 1000);
    }
    this.emitApprovalEvent({ type: 'approval-audit', event });
  }

  subscribe(listener: (event: ApprovalFlowEvent) => void): () => void {
    this.events.on('operator-event', listener);
    return () => {
      this.events.off('operator-event', listener);
    };
  }

  private emitApprovalEvent(event: ApprovalFlowEvent): void {
    this.events.emit('operator-event', event);
  }

  // ── Settings mutations ────────────────────────────────────────────────────

  async addToWhitelist(s: string): Promise<void> {
    await this.ensureLoaded();
    this.settings.whitelist = [...(this.settings.whitelist ?? []), s];
    await this.saveSettings();
  }

  async addToBlacklist(s: string): Promise<void> {
    await this.ensureLoaded();
    this.settings.blacklist = [...(this.settings.blacklist ?? []), s];
    await this.saveSettings();
  }

  async setDefault(action: 'approve' | 'ask' | 'deny'): Promise<void> {
    await this.ensureLoaded();
    this.settings.defaultAction = action;
    await this.saveSettings();
  }
}

function approvalMetadata(source: {
  run_id?: string;
  effect_id?: string;
  effect_kind?: string;
  policy_id?: string;
  reason?: string;
  approval_required?: boolean;
}): Pick<ApprovalRequest, 'run_id' | 'effect_id' | 'effect_kind' | 'policy_id' | 'reason' | 'approval_required'> {
  return {
    ...(source.run_id !== undefined ? { run_id: source.run_id } : {}),
    ...(source.effect_id !== undefined ? { effect_id: source.effect_id } : {}),
    ...(source.effect_kind !== undefined ? { effect_kind: source.effect_kind } : {}),
    ...(source.policy_id !== undefined ? { policy_id: source.policy_id } : {}),
    ...(source.reason !== undefined ? { reason: source.reason } : {}),
    ...(source.approval_required !== undefined ? { approval_required: source.approval_required } : {}),
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const approvalFlow = new ApprovalFlow({
  settingsPath: path.join(os.homedir(), '.pyrfor', 'approval-settings.json'),
});

function normalizeApprovalToolName(toolName: string): string {
  if (toolName === 'shell_exec') return 'exec';
  if (toolName === 'apply_patch') return 'edit_file';
  return toolName;
}
