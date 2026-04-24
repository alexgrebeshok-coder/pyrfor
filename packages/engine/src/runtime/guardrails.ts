/**
 * Pyrfor Guardrails — tool-call permission engine + append-only audit log
 * + sandbox classification.
 *
 * Sub-agents and tools register with a permission tier; before each tool
 * invocation the guardrail decides allow/deny/ask, recording every decision.
 *
 * ESM only, pure TS, no native deps.
 */

import { appendFileSync } from 'node:fs';

// ── Public types ──────────────────────────────────────────────────────────────

export type PermissionTier = 'safe' | 'review' | 'restricted' | 'forbidden';
export type DecisionKind = 'allow' | 'deny' | 'ask' | 'allow-once' | 'deny-once';

export interface ToolPolicy {
  toolName: string;
  tier: PermissionTier;
  /** Optional arg pattern for sub-classification — must match JSON.stringify(args). */
  pattern?: RegExp;
  rationale?: string;
}

export interface GuardrailContext {
  agentId: string;
  agentRole?: string;
  toolName: string;
  args: Record<string, unknown>;
  userId?: string;
  chatId?: string;
  /** true for ralph/cron/autonomous loop */
  isAutonomous?: boolean;
}

export interface GuardrailDecision {
  allowed: boolean;
  kind: DecisionKind;
  tier: PermissionTier;
  reason: string;
  policyMatched?: string;
  needsApproval?: boolean;
  ts: string;
  decisionId: string;
}

export interface ApprovalCallback {
  (ctx: GuardrailContext, decision: GuardrailDecision): Promise<DecisionKind>;
}

export interface AuditEntry {
  id: string;
  ts: string;
  agentId: string;
  agentRole?: string;
  toolName: string;
  args: Record<string, unknown>;
  decision: GuardrailDecision;
  outcome?: 'invoked' | 'skipped';
}

export interface CreateGuardrailsOptions {
  policies?: ToolPolicy[];
  /** default 'review' */
  defaultTier?: PermissionTier;
  /** ralph/cron auto-allow up to this tier; default 'safe' */
  autonomousMaxTier?: PermissionTier;
  approvalCallback?: ApprovalCallback;
  /** append-only JSONL file */
  auditPath?: string;
  clock?: () => number;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  perAgentOverrides?: Record<
    string,
    { maxTier?: PermissionTier; allowList?: string[]; denyList?: string[] }
  >;
}

export interface Guardrails {
  evaluate(ctx: GuardrailContext): Promise<GuardrailDecision>;
  recordOutcome(decisionId: string, outcome: 'invoked' | 'skipped'): void;
  setPolicy(p: ToolPolicy): void;
  removePolicy(toolName: string): boolean;
  getPolicies(): ToolPolicy[];
  audit(query?: {
    sinceMs?: number;
    agentId?: string;
    toolName?: string;
    limit?: number;
  }): Promise<AuditEntry[]>;
  /** Session-scoped allow-once token */
  approveOnce(toolName: string, agentId?: string): void;
  denyOnce(toolName: string, agentId?: string): void;
  flush(): Promise<void>;
}

// ── Internal constants ────────────────────────────────────────────────────────

const TIER_RANK: Record<PermissionTier, number> = {
  safe: 0,
  review: 1,
  restricted: 2,
  forbidden: 3,
};

const VALID_CALLBACK_KINDS = new Set<DecisionKind>([
  'allow',
  'deny',
  'allow-once',
  'deny-once',
]);

const AUDIT_RING_CAP = 10_000;

// ── Internal types ────────────────────────────────────────────────────────────

interface OneShotToken {
  toolName: string;
  agentId?: string;
  kind: 'allow-once' | 'deny-once';
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGuardrails(opts: CreateGuardrailsOptions = {}): Guardrails {
  const clock = opts.clock ?? (() => Date.now());
  const log = opts.logger ?? (() => {});
  const defaultTier: PermissionTier = opts.defaultTier ?? 'review';
  const globalAutonomousMaxTier: PermissionTier = opts.autonomousMaxTier ?? 'safe';

  // Policies map
  const policiesMap = new Map<string, ToolPolicy>();
  for (const p of opts.policies ?? []) {
    policiesMap.set(p.toolName, p);
  }

  // Audit ring + index for O(1) recordOutcome
  const auditRing: AuditEntry[] = [];
  const auditIndex = new Map<string, AuditEntry>();

  // One-shot tokens
  const oneShotTokens: OneShotToken[] = [];

  // Per-instance ID sequence for uniqueness
  let _seq = 0;

  // ── Private helpers ───────────────────────────────────────────────────────

  function nowIso(): string {
    return new Date(clock()).toISOString();
  }

  function makeDecisionId(): string {
    const ts = clock();
    const rnd = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    const seq = (++_seq).toString(36).padStart(4, '0');
    return `grd_${ts.toString(36)}_${rnd}${seq}`;
  }

  function appendToFile(line: string): void {
    if (!opts.auditPath) return;
    try {
      appendFileSync(opts.auditPath, line + '\n', 'utf8');
    } catch (err) {
      log('error', '[guardrails] failed to write audit log', { err });
    }
  }

  function pushAudit(entry: AuditEntry): void {
    if (auditRing.length >= AUDIT_RING_CAP) {
      const evicted = auditRing.shift();
      if (evicted) auditIndex.delete(evicted.id);
    }
    auditRing.push(entry);
    auditIndex.set(entry.id, entry);
    appendToFile(JSON.stringify(entry));
  }

  /**
   * Resolve base tier from policies + default.
   * If a policy has a pattern, it must match JSON.stringify(args); otherwise
   * the policy is skipped and defaultTier is returned.
   */
  function resolveBaseTier(
    toolName: string,
    args: Record<string, unknown>,
  ): { tier: PermissionTier; policyMatched: string | undefined } {
    const policy = policiesMap.get(toolName);
    if (policy) {
      if (policy.pattern) {
        const argsStr = JSON.stringify(args);
        if (!policy.pattern.test(argsStr)) {
          return { tier: defaultTier, policyMatched: undefined };
        }
      }
      return { tier: policy.tier, policyMatched: policy.toolName };
    }
    return { tier: defaultTier, policyMatched: undefined };
  }

  /**
   * Invoke approvalCallback safely; returns the kind or throws if the callback
   * throws or returns an invalid kind.
   */
  async function invokeCallback(
    ctx: GuardrailContext,
    provisional: GuardrailDecision,
  ): Promise<{ kind: DecisionKind; threw: boolean; invalid: boolean }> {
    let cbKind: DecisionKind;
    try {
      cbKind = await opts.approvalCallback!(ctx, provisional);
    } catch (err) {
      log('warn', '[guardrails] approvalCallback threw', { err });
      return { kind: 'deny', threw: true, invalid: false };
    }
    if (!VALID_CALLBACK_KINDS.has(cbKind)) {
      return { kind: 'deny', threw: false, invalid: true };
    }
    return { kind: cbKind, threw: false, invalid: false };
  }

  // ── evaluate ──────────────────────────────────────────────────────────────

  async function evaluate(ctx: GuardrailContext): Promise<GuardrailDecision> {
    const ts = nowIso();
    const decisionId = makeDecisionId();

    const agentOverride = opts.perAgentOverrides?.[ctx.agentId];
    const autonomousMaxTier: PermissionTier =
      agentOverride?.maxTier ?? globalAutonomousMaxTier;

    // ── 1. perAgentOverrides denyList ─────────────────────────────────────
    if (agentOverride?.denyList?.includes(ctx.toolName)) {
      const decision: GuardrailDecision = {
        allowed: false,
        kind: 'deny',
        tier: 'forbidden',
        reason: 'agent denyList override',
        ts,
        decisionId,
      };
      pushAudit(makeEntry(decisionId, ts, ctx, decision));
      return decision;
    }

    // ── 2. perAgentOverrides allowList ────────────────────────────────────
    if (agentOverride?.allowList?.includes(ctx.toolName)) {
      const decision: GuardrailDecision = {
        allowed: true,
        kind: 'allow',
        tier: 'safe',
        reason: 'agent allowList override',
        ts,
        decisionId,
      };
      pushAudit(makeEntry(decisionId, ts, ctx, decision));
      return decision;
    }

    // ── 4+5. Base tier from policies / default ────────────────────────────
    const { tier, policyMatched } = resolveBaseTier(ctx.toolName, ctx.args);

    // ── 3. One-shot tokens (peek-then-confirm) ────────────────────────────
    const tokenIdx = oneShotTokens.findIndex(
      (t) =>
        t.toolName === ctx.toolName &&
        (t.agentId === undefined || t.agentId === ctx.agentId),
    );

    if (tokenIdx >= 0) {
      const token = oneShotTokens[tokenIdx];
      // Token "dictates the path" if it changes the final allowed outcome
      // vs what the base tier would produce unconditionally.
      // allow-once: only dictates if base is not already 'safe'
      // deny-once: only dictates if base is not already 'forbidden'
      const tokenDictates =
        (token.kind === 'allow-once' && tier !== 'safe') ||
        (token.kind === 'deny-once' && tier !== 'forbidden');

      if (tokenDictates) {
        oneShotTokens.splice(tokenIdx, 1); // consume
        const allowed = token.kind === 'allow-once';
        const decision: GuardrailDecision = {
          allowed,
          kind: token.kind,
          tier,
          reason: `one-shot ${token.kind} token`,
          policyMatched,
          ts,
          decisionId,
        };
        pushAudit(makeEntry(decisionId, ts, ctx, decision));
        return decision;
      }
      // token doesn't dictate → don't consume, fall through to tier eval
    }

    // ── Evaluate effective tier ───────────────────────────────────────────
    let decision: GuardrailDecision;

    if (tier === 'forbidden') {
      decision = {
        allowed: false,
        kind: 'deny',
        tier,
        reason: 'tier forbidden',
        policyMatched,
        ts,
        decisionId,
      };
    } else if (tier === 'safe') {
      decision = {
        allowed: true,
        kind: 'allow',
        tier,
        reason: 'tier safe',
        policyMatched,
        ts,
        decisionId,
      };
    } else if (tier === 'review') {
      if (ctx.isAutonomous && TIER_RANK[autonomousMaxTier] >= TIER_RANK['review']) {
        // autonomous agent is permitted up to review tier
        decision = {
          allowed: true,
          kind: 'allow',
          tier,
          reason: 'autonomous agent within autonomousMaxTier',
          policyMatched,
          ts,
          decisionId,
        };
      } else if (opts.approvalCallback) {
        decision = await resolveViaCallback(ctx, tier, policyMatched, ts, decisionId);
      } else {
        decision = {
          allowed: false,
          kind: 'deny',
          tier,
          reason: 'no approval available',
          policyMatched,
          ts,
          decisionId,
        };
      }
    } else {
      // tier === 'restricted'
      if (ctx.isAutonomous) {
        decision = {
          allowed: false,
          kind: 'deny',
          tier,
          reason: 'restricted in autonomous mode',
          policyMatched,
          ts,
          decisionId,
        };
      } else if (opts.approvalCallback) {
        decision = await resolveViaCallback(ctx, tier, policyMatched, ts, decisionId);
      } else {
        decision = {
          allowed: false,
          kind: 'deny',
          tier,
          reason: 'no approval available',
          policyMatched,
          ts,
          decisionId,
        };
      }
    }

    pushAudit(makeEntry(decisionId, ts, ctx, decision));
    return decision;
  }

  /**
   * Shared callback-resolution path for review and restricted tiers.
   * Does NOT call pushAudit — callers do that after return.
   */
  async function resolveViaCallback(
    ctx: GuardrailContext,
    tier: PermissionTier,
    policyMatched: string | undefined,
    ts: string,
    decisionId: string,
  ): Promise<GuardrailDecision> {
    const provisional: GuardrailDecision = {
      allowed: false,
      kind: 'ask',
      tier,
      reason: 'requires approval',
      policyMatched,
      needsApproval: true,
      ts,
      decisionId,
    };

    const { kind, threw, invalid } = await invokeCallback(ctx, provisional);

    if (threw) {
      return {
        allowed: false,
        kind: 'deny',
        tier,
        reason: 'approvalCallback threw',
        policyMatched,
        ts,
        decisionId,
      };
    }

    if (invalid) {
      return {
        allowed: false,
        kind: 'deny',
        tier,
        reason: 'approvalCallback returned invalid kind',
        policyMatched,
        ts,
        decisionId,
      };
    }

    const allowed = kind === 'allow' || kind === 'allow-once';
    return {
      allowed,
      kind,
      tier,
      reason: `approved by callback: ${kind}`,
      policyMatched,
      ts,
      decisionId,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function makeEntry(
    id: string,
    ts: string,
    ctx: GuardrailContext,
    decision: GuardrailDecision,
  ): AuditEntry {
    return {
      id,
      ts,
      agentId: ctx.agentId,
      agentRole: ctx.agentRole,
      toolName: ctx.toolName,
      args: ctx.args,
      decision,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    evaluate,

    recordOutcome(decisionId: string, outcome: 'invoked' | 'skipped'): void {
      const entry = auditIndex.get(decisionId);
      if (entry) {
        entry.outcome = outcome;
      }
      if (opts.auditPath) {
        appendToFile(JSON.stringify({ outcomeUpdate: decisionId, outcome }));
      }
    },

    setPolicy(p: ToolPolicy): void {
      policiesMap.set(p.toolName, p);
    },

    removePolicy(toolName: string): boolean {
      return policiesMap.delete(toolName);
    },

    getPolicies(): ToolPolicy[] {
      return Array.from(policiesMap.values());
    },

    async audit(query?: {
      sinceMs?: number;
      agentId?: string;
      toolName?: string;
      limit?: number;
    }): Promise<AuditEntry[]> {
      if (query?.limit === 0) return [];

      let result = auditRing.slice();

      if (query?.sinceMs !== undefined) {
        const since = query.sinceMs;
        result = result.filter((e) => new Date(e.ts).getTime() >= since);
      }
      if (query?.agentId !== undefined) {
        const aid = query.agentId;
        result = result.filter((e) => e.agentId === aid);
      }
      if (query?.toolName !== undefined) {
        const tn = query.toolName;
        result = result.filter((e) => e.toolName === tn);
      }
      if (query?.limit !== undefined && query.limit > 0) {
        result = result.slice(-query.limit);
      }

      return result;
    },

    approveOnce(toolName: string, agentId?: string): void {
      oneShotTokens.push({ toolName, agentId, kind: 'allow-once' });
    },

    denyOnce(toolName: string, agentId?: string): void {
      oneShotTokens.push({ toolName, agentId, kind: 'deny-once' });
    },

    async flush(): Promise<void> {
      // appendFileSync is synchronous — all writes are already complete.
    },
  };
}
