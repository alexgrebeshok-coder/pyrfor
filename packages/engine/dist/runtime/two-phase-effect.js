/**
 * two-phase-effect.ts — proposal → policy verdict → engine-owned apply.
 *
 * Workers may propose effects, but only this host-side runner may evaluate
 * policy and call an executor. It is intentionally independent from concrete
 * tools so it can cover file, shell, git, Telegram, network, and memory effects.
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
import { randomUUID } from 'node:crypto';
const DEFAULT_TOOL_FOR_KIND = {
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
function cloneProposal(effect) {
    return Object.assign(Object.assign({}, effect), { payload: Object.assign({}, effect.payload) });
}
function normalizePolicyDecision(decision) {
    if (decision.allow)
        return 'allow';
    if (decision.promptUser)
        return 'ask';
    return 'deny';
}
export class TwoPhaseEffectRunner {
    constructor(options) {
        var _a, _b;
        this.effects = new Map();
        this.ledger = options.ledger;
        this.permissionEngine = options.permissionEngine;
        this.permissionContext = options.permissionContext;
        this.toolNameForKind = Object.assign(Object.assign({}, DEFAULT_TOOL_FOR_KIND), ((_a = options.toolNameForKind) !== null && _a !== void 0 ? _a : {}));
        this.clock = (_b = options.clock) !== null && _b !== void 0 ? _b : Date.now;
    }
    propose(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const now = new Date().toISOString();
            const effect = Object.assign(Object.assign({}, input), { effect_id: randomUUID(), status: 'proposed', created_at: now, updated_at: now });
            this.effects.set(effect.effect_id, effect);
            yield this.ledger.append({
                type: 'effect.proposed',
                run_id: effect.run_id,
                effect_id: effect.effect_id,
                effect_kind: effect.kind,
                tool: this.resolveToolName(effect),
                preview: effect.preview,
                idempotency_key: effect.idempotency_key,
            });
            return cloneProposal(effect);
        });
    }
    get(effectId) {
        const effect = this.effects.get(effectId);
        return effect ? cloneProposal(effect) : undefined;
    }
    decide(effectOrId) {
        return __awaiter(this, void 0, void 0, function* () {
            const effect = typeof effectOrId === 'string' ? this.requireEffect(effectOrId) : effectOrId;
            const toolName = this.resolveToolName(effect);
            const raw = yield this.permissionEngine.check(toolName, Object.assign(Object.assign({}, this.permissionContext), { runId: effect.run_id }), effect.payload);
            const verdict = {
                effect_id: effect.effect_id,
                decision: normalizePolicyDecision(raw),
                policy_id: `permission:${raw.permissionClass}`,
                reason: raw.reason,
                approval_required: raw.promptUser,
            };
            yield this.ledger.append({
                type: 'effect.policy_decided',
                run_id: effect.run_id,
                effect_id: effect.effect_id,
                decision: verdict.decision,
                policy_id: verdict.policy_id,
                reason: verdict.reason,
                approval_required: verdict.approval_required,
            });
            return verdict;
        });
    }
    approve(effectOrId, approvedBy) {
        return __awaiter(this, void 0, void 0, function* () {
            const effect = typeof effectOrId === 'string' ? this.requireEffect(effectOrId) : effectOrId;
            const updated = this.updateStatus(effect, 'approved');
            const verdict = {
                effect_id: updated.effect_id,
                decision: 'allow',
                policy_id: 'human:approval',
                reason: `approved_by:${approvedBy}`,
                approval_required: false,
            };
            yield this.ledger.append({
                type: 'effect.policy_decided',
                run_id: updated.run_id,
                effect_id: updated.effect_id,
                decision: verdict.decision,
                policy_id: verdict.policy_id,
                reason: verdict.reason,
                approval_required: false,
            });
            return verdict;
        });
    }
    apply(effectOrId_1, executor_1) {
        return __awaiter(this, arguments, void 0, function* (effectOrId, executor, options = {}) {
            var _a, _b;
            const effect = typeof effectOrId === 'string' ? this.requireEffect(effectOrId) : effectOrId;
            const verdict = (_a = options.verdict) !== null && _a !== void 0 ? _a : yield this.decide(effect);
            const start = this.clock();
            if (verdict.decision !== 'allow') {
                const denied = this.updateStatus(effect, 'denied');
                yield this.ledger.append({
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
            if ((_b = options.signal) === null || _b === void 0 ? void 0 : _b.aborted) {
                ac.abort(options.signal.reason);
            }
            else if (options.signal) {
                options.signal.addEventListener('abort', () => { var _a; return ac.abort((_a = options.signal) === null || _a === void 0 ? void 0 : _a.reason); }, { once: true });
            }
            try {
                const result = yield executor(effect, { signal: ac.signal });
                const applied = this.updateStatus(effect, 'applied');
                const durationMs = this.clock() - start;
                yield this.ledger.append({
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
            }
            catch (err) {
                const failed = this.updateStatus(effect, 'failed');
                const durationMs = this.clock() - start;
                const message = err instanceof Error ? err.message : String(err);
                const code = err.code;
                yield this.ledger.append({
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
                    error: Object.assign(Object.assign({}, (code !== undefined ? { code } : {})), { message }),
                    durationMs,
                };
            }
        });
    }
    resolveToolName(effect) {
        var _a;
        return (_a = effect.toolName) !== null && _a !== void 0 ? _a : this.toolNameForKind[effect.kind];
    }
    requireEffect(effectId) {
        const effect = this.effects.get(effectId);
        if (!effect)
            throw new Error(`TwoPhaseEffectRunner: unknown effect "${effectId}"`);
        return effect;
    }
    updateStatus(effect, status) {
        const updated = Object.assign(Object.assign({}, effect), { payload: Object.assign({}, effect.payload), status, updated_at: new Date().toISOString() });
        this.effects.set(updated.effect_id, updated);
        return updated;
    }
}
