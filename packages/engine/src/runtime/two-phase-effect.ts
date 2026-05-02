/**
 * two-phase-effect.ts — proposal → policy verdict → engine-owned apply.
 *
 * Workers may propose effects, but only this host-side runner may evaluate
 * policy and call an executor. It is intentionally independent from concrete
 * tools so it can cover file, shell, git, Telegram, network, and memory effects.
 */

import { randomUUID } from 'node:crypto';
import { EventLedger } from './event-ledger';
import { PermissionEngine, type PermissionContext } from './permission-engine';

export type EffectKind =
  | 'file_edit'
  | 'shell_command'
  | 'git_operation'
  | 'network_request'
  | 'telegram_send'
  | 'memory_write'
  | 'artifact_write'
  | 'release_operation'
  | 'tool_call';

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
  error?: { code?: string; message: string };
  rollback_handle?: string;
  durationMs: number;
}

export type EffectExecutor = (
  proposal: EffectProposal,
  ctx: { signal: AbortSignal },
) => Promise<{ output?: unknown; rollback_handle?: string }> | { output?: unknown; rollback_handle?: string };

export interface TwoPhaseEffectRunnerOptions {
  ledger: EventLedger;
  permissionEngine: PermissionEngine;
  permissionContext: Omit<PermissionContext, 'runId'>;
  toolNameForKind?: Partial<Record<EffectKind, string>>;
  clock?: () => number;
}

const DEFAULT_TOOL_FOR_KIND: Record<EffectKind, string> = {
  file_edit: 'apply_patch',
  shell_command: 'shell_exec',
  git_operation: 'shell_exec',
  network_request: 'network_write',
  telegram_send: 'send_message',
  memory_write: 'write_file',
  artifact_write: 'write_file',
  release_operation: 'deploy',
  tool_call: 'shell_exec',
};

function cloneProposal(effect: EffectProposal): EffectProposal {
  return {
    ...effect,
    payload: { ...effect.payload },
  };
}

function normalizePolicyDecision(decision: { allow: boolean; promptUser: boolean }): PolicyDecision {
  if (decision.allow) return 'allow';
  if (decision.promptUser) return 'ask';
  return 'deny';
}

export class TwoPhaseEffectRunner {
  private readonly ledger: EventLedger;
  private readonly permissionEngine: PermissionEngine;
  private readonly permissionContext: Omit<PermissionContext, 'runId'>;
  private readonly toolNameForKind: Record<EffectKind, string>;
  private readonly clock: () => number;
  private readonly effects = new Map<string, EffectProposal>();

  constructor(options: TwoPhaseEffectRunnerOptions) {
    this.ledger = options.ledger;
    this.permissionEngine = options.permissionEngine;
    this.permissionContext = options.permissionContext;
    this.toolNameForKind = { ...DEFAULT_TOOL_FOR_KIND, ...(options.toolNameForKind ?? {}) };
    this.clock = options.clock ?? Date.now;
  }

  async propose(input: EffectProposalInput): Promise<EffectProposal> {
    const now = new Date().toISOString();
    const effect: EffectProposal = {
      ...input,
      effect_id: randomUUID(),
      status: 'proposed',
      created_at: now,
      updated_at: now,
    };
    this.effects.set(effect.effect_id, effect);

    await this.ledger.append({
      type: 'effect.proposed',
      run_id: effect.run_id,
      effect_id: effect.effect_id,
      effect_kind: effect.kind,
      tool: this.resolveToolName(effect),
      preview: effect.preview,
      idempotency_key: effect.idempotency_key,
    });

    return cloneProposal(effect);
  }

  get(effectId: string): EffectProposal | undefined {
    const effect = this.effects.get(effectId);
    return effect ? cloneProposal(effect) : undefined;
  }

  async decide(effectOrId: EffectProposal | string): Promise<EffectPolicyVerdict> {
    const effect = typeof effectOrId === 'string' ? this.requireEffect(effectOrId) : effectOrId;
    const toolName = this.resolveToolName(effect);
    const raw = await this.permissionEngine.check(
      toolName,
      {
        ...this.permissionContext,
        runId: effect.run_id,
      },
      effect.payload,
    );

    const verdict: EffectPolicyVerdict = {
      effect_id: effect.effect_id,
      decision: normalizePolicyDecision(raw),
      policy_id: `permission:${raw.permissionClass}`,
      reason: raw.reason,
      approval_required: raw.promptUser,
    };

    await this.ledger.append({
      type: 'effect.policy_decided',
      run_id: effect.run_id,
      effect_id: effect.effect_id,
      decision: verdict.decision,
      policy_id: verdict.policy_id,
      reason: verdict.reason,
      approval_required: verdict.approval_required,
    });

    return verdict;
  }

  async approve(effectOrId: EffectProposal | string, approvedBy: string): Promise<EffectPolicyVerdict> {
    const effect = typeof effectOrId === 'string' ? this.requireEffect(effectOrId) : effectOrId;
    const updated = this.updateStatus(effect, 'approved');
    const verdict: EffectPolicyVerdict = {
      effect_id: updated.effect_id,
      decision: 'allow',
      policy_id: 'human:approval',
      reason: `approved_by:${approvedBy}`,
      approval_required: false,
    };
    await this.ledger.append({
      type: 'effect.policy_decided',
      run_id: updated.run_id,
      effect_id: updated.effect_id,
      decision: verdict.decision,
      policy_id: verdict.policy_id,
      reason: verdict.reason,
      approval_required: false,
    });
    return verdict;
  }

  async apply(
    effectOrId: EffectProposal | string,
    executor: EffectExecutor,
    options: { verdict?: EffectPolicyVerdict; signal?: AbortSignal } = {},
  ): Promise<EffectApplyResult> {
    const effect = typeof effectOrId === 'string' ? this.requireEffect(effectOrId) : effectOrId;
    const verdict = options.verdict ?? await this.decide(effect);
    const start = this.clock();

    if (verdict.decision !== 'allow') {
      const denied = this.updateStatus(effect, 'denied');
      await this.ledger.append({
        type: 'effect.denied',
        run_id: denied.run_id,
        effect_id: denied.effect_id,
        reason: verdict.reason,
      });
      return {
        ok: false,
        effect: cloneProposal(denied),
        verdict,
        error: { code: 'effect_not_allowed', message: verdict.reason },
        durationMs: 0,
      };
    }

    const ac = new AbortController();
    if (options.signal?.aborted) {
      ac.abort(options.signal.reason);
    } else if (options.signal) {
      options.signal.addEventListener('abort', () => ac.abort(options.signal?.reason), { once: true });
    }

    try {
      const result = await executor(effect, { signal: ac.signal });
      const applied = this.updateStatus(effect, 'applied');
      const durationMs = this.clock() - start;
      await this.ledger.append({
        type: 'effect.applied',
        run_id: applied.run_id,
        effect_id: applied.effect_id,
        status: 'ok',
        ms: durationMs,
        rollback_handle: result.rollback_handle,
      });
      return {
        ok: true,
        effect: cloneProposal(applied),
        verdict,
        output: result.output,
        rollback_handle: result.rollback_handle,
        durationMs,
      };
    } catch (err) {
      const failed = this.updateStatus(effect, 'failed');
      const durationMs = this.clock() - start;
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      await this.ledger.append({
        type: 'effect.failed',
        run_id: failed.run_id,
        effect_id: failed.effect_id,
        error: code ? `${message} [${code}]` : message,
        ms: durationMs,
      });
      return {
        ok: false,
        effect: cloneProposal(failed),
        verdict,
        error: { ...(code !== undefined ? { code } : {}), message },
        durationMs,
      };
    }
  }

  private resolveToolName(effect: EffectProposal): string {
    return effect.toolName ?? this.toolNameForKind[effect.kind];
  }

  private requireEffect(effectId: string): EffectProposal {
    const effect = this.effects.get(effectId);
    if (!effect) throw new Error(`TwoPhaseEffectRunner: unknown effect "${effectId}"`);
    return effect;
  }

  private updateStatus(effect: EffectProposal, status: EffectStatus): EffectProposal {
    const updated = {
      ...effect,
      payload: { ...effect.payload },
      status,
      updated_at: new Date().toISOString(),
    };
    this.effects.set(updated.effect_id, updated);
    return updated;
  }
}
