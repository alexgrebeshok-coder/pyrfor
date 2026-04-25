/**
 * Pyrfor Guardrails — tool-call permission engine + append-only audit log
 * + sandbox classification.
 *
 * Sub-agents and tools register with a permission tier; before each tool
 * invocation the guardrail decides allow/deny/ask, recording every decision.
 *
 * ESM only, pure TS, no native deps.
 */
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
    perAgentOverrides?: Record<string, {
        maxTier?: PermissionTier;
        allowList?: string[];
        denyList?: string[];
    }>;
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
export declare function createGuardrails(opts?: CreateGuardrailsOptions): Guardrails;
//# sourceMappingURL=guardrails.d.ts.map