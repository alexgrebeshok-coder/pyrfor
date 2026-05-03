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
    type: 'approval.requested' | 'approval.approved' | 'approval.denied' | 'approval.timeout' | 'tool.executed' | 'tool.denied';
    requestId: string;
    toolName: string;
    summary: string;
    args: Record<string, unknown>;
    decision?: ApprovalDecision;
    sessionId?: string;
    toolCallId?: string;
    resultSummary?: string;
    error?: string;
    undo?: {
        supported: boolean;
        kind?: string;
    };
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
export type ApprovalFlowEvent = {
    type: 'approval-requested';
    request: ApprovalRequest;
} | {
    type: 'approval-resolved';
    request: ApprovalRequest;
    decision: ApprovalDecision;
} | {
    type: 'approval-audit';
    event: ApprovalAuditEvent;
};
export interface ApprovalSettings {
    whitelist?: string[];
    blacklist?: string[];
    defaultAction?: 'approve' | 'ask' | 'deny';
    autoApprovePatterns?: string[];
}
export declare class ApprovalFlow {
    readonly events: EventEmitter<[never]>;
    private readonly pending;
    private readonly resolved;
    private readonly resolvedApprovals;
    private settings;
    private readonly auditEvents;
    private settingsLoaded;
    private readonly settingsPath;
    private readonly ttlMs;
    constructor(opts?: {
        settingsPath?: string;
        ttlMs?: number;
    });
    loadSettings(): Promise<void>;
    saveSettings(): Promise<void>;
    private ensureLoaded;
    /**
     * Categorize a tool call — pure (synchronous) once settings are loaded.
     * Call loadSettings() / ensureLoaded() before using this.
     */
    categorize(toolName: string, args: Record<string, unknown>): ApprovalCategory;
    requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
    enqueueApproval(req: Omit<ApprovalRequest, 'id'> & {
        id?: string;
    }): Promise<ApprovalRequest>;
    /**
     * Called by the Telegram callback handler when the user clicks
     * Approve/Deny on the inline keyboard.
     */
    resolveDecision(id: string, decision: 'approve' | 'deny'): boolean;
    getResolvedDecision(id: string): ApprovalDecision | undefined;
    getResolvedApproval(id: string): ResolvedApproval | undefined;
    consumeResolvedApproval(id: string): ResolvedApproval | undefined;
    consumeResolvedDecision(id: string): ApprovalDecision | undefined;
    getPending(): ApprovalRequest[];
    listAudit(limit?: number): ApprovalAuditEvent[];
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
        undo?: {
            supported: boolean;
            kind?: string;
        };
    }): void;
    private recordAudit;
    subscribe(listener: (event: ApprovalFlowEvent) => void): () => void;
    private emitApprovalEvent;
    addToWhitelist(s: string): Promise<void>;
    addToBlacklist(s: string): Promise<void>;
    setDefault(action: 'approve' | 'ask' | 'deny'): Promise<void>;
}
export declare const approvalFlow: ApprovalFlow;
//# sourceMappingURL=approval-flow.d.ts.map