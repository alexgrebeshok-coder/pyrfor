/**
 * two-phase-effect.ts — proposal → policy verdict → engine-owned apply.
 *
 * Workers may propose effects, but only this host-side runner may evaluate
 * policy and call an executor. It is intentionally independent from concrete
 * tools so it can cover file, shell, git, Telegram, network, and memory effects.
 */
import { EventLedger } from './event-ledger';
import { PermissionEngine, type PermissionContext } from './permission-engine';
export type EffectKind = 'file_edit' | 'shell_command' | 'git_operation' | 'network_request' | 'telegram_send' | 'memory_write' | 'artifact_write' | 'release_operation' | 'tool_call';
export type EffectStatus = 'proposed' | 'approved' | 'denied' | 'applied' | 'failed';
export type PolicyDecision = 'allow' | 'ask' | 'deny';
export interface EffectProposalInput {
    run_id: string;
    kind: EffectKind;
    payload: Record<string, unknown>;
    preview: string;
    toolName?: string;
    idempotency_key?: string;
    rollback_supported?: boolean;
}
export interface EffectProposal extends EffectProposalInput {
    effect_id: string;
    status: EffectStatus;
    created_at: string;
    updated_at: string;
}
export interface EffectPolicyVerdict {
    effect_id: string;
    decision: PolicyDecision;
    policy_id: string;
    reason: string;
    approval_required: boolean;
}
export interface EffectApplyResult {
    ok: boolean;
    effect: EffectProposal;
    verdict: EffectPolicyVerdict;
    output?: unknown;
    error?: {
        code?: string;
        message: string;
    };
    rollback_handle?: string;
    durationMs: number;
}
export type EffectExecutor = (proposal: EffectProposal, ctx: {
    signal: AbortSignal;
}) => Promise<{
    output?: unknown;
    rollback_handle?: string;
}> | {
    output?: unknown;
    rollback_handle?: string;
};
export interface TwoPhaseEffectRunnerOptions {
    ledger: EventLedger;
    permissionEngine: PermissionEngine;
    permissionContext: Omit<PermissionContext, 'runId'>;
    toolNameForKind?: Partial<Record<EffectKind, string>>;
    clock?: () => number;
}
export declare class TwoPhaseEffectRunner {
    private readonly ledger;
    private readonly permissionEngine;
    private readonly permissionContext;
    private readonly toolNameForKind;
    private readonly clock;
    private readonly effects;
    constructor(options: TwoPhaseEffectRunnerOptions);
    propose(input: EffectProposalInput): Promise<EffectProposal>;
    get(effectId: string): EffectProposal | undefined;
    decide(effectOrId: EffectProposal | string): Promise<EffectPolicyVerdict>;
    approve(effectOrId: EffectProposal | string, approvedBy: string): Promise<EffectPolicyVerdict>;
    apply(effectOrId: EffectProposal | string, executor: EffectExecutor, options?: {
        verdict?: EffectPolicyVerdict;
        signal?: AbortSignal;
    }): Promise<EffectApplyResult>;
    private resolveToolName;
    private requireEffect;
    private updateStatus;
}
//# sourceMappingURL=two-phase-effect.d.ts.map