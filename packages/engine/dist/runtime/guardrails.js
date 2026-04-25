/**
 * Pyrfor Guardrails — tool-call permission engine + append-only audit log
 * + sandbox classification.
 *
 * Sub-agents and tools register with a permission tier; before each tool
 * invocation the guardrail decides allow/deny/ask, recording every decision.
 *
 * ESM only, pure TS, no native deps.
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
import { appendFileSync } from 'node:fs';
// ── Internal constants ────────────────────────────────────────────────────────
const TIER_RANK = {
    safe: 0,
    review: 1,
    restricted: 2,
    forbidden: 3,
};
const VALID_CALLBACK_KINDS = new Set([
    'allow',
    'deny',
    'allow-once',
    'deny-once',
]);
const AUDIT_RING_CAP = 10000;
// ── Factory ───────────────────────────────────────────────────────────────────
export function createGuardrails(opts = {}) {
    var _a, _b, _c, _d, _e;
    const clock = (_a = opts.clock) !== null && _a !== void 0 ? _a : (() => Date.now());
    const log = (_b = opts.logger) !== null && _b !== void 0 ? _b : (() => { });
    const defaultTier = (_c = opts.defaultTier) !== null && _c !== void 0 ? _c : 'review';
    const globalAutonomousMaxTier = (_d = opts.autonomousMaxTier) !== null && _d !== void 0 ? _d : 'safe';
    // Policies map
    const policiesMap = new Map();
    for (const p of (_e = opts.policies) !== null && _e !== void 0 ? _e : []) {
        policiesMap.set(p.toolName, p);
    }
    // Audit ring + index for O(1) recordOutcome
    const auditRing = [];
    const auditIndex = new Map();
    // One-shot tokens
    const oneShotTokens = [];
    // Per-instance ID sequence for uniqueness
    let _seq = 0;
    // ── Private helpers ───────────────────────────────────────────────────────
    function nowIso() {
        return new Date(clock()).toISOString();
    }
    function makeDecisionId() {
        const ts = clock();
        const rnd = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
        const seq = (++_seq).toString(36).padStart(4, '0');
        return `grd_${ts.toString(36)}_${rnd}${seq}`;
    }
    function appendToFile(line) {
        if (!opts.auditPath)
            return;
        try {
            appendFileSync(opts.auditPath, line + '\n', 'utf8');
        }
        catch (err) {
            log('error', '[guardrails] failed to write audit log', { err });
        }
    }
    function pushAudit(entry) {
        if (auditRing.length >= AUDIT_RING_CAP) {
            const evicted = auditRing.shift();
            if (evicted)
                auditIndex.delete(evicted.id);
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
    function resolveBaseTier(toolName, args) {
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
    function invokeCallback(ctx, provisional) {
        return __awaiter(this, void 0, void 0, function* () {
            let cbKind;
            try {
                cbKind = yield opts.approvalCallback(ctx, provisional);
            }
            catch (err) {
                log('warn', '[guardrails] approvalCallback threw', { err });
                return { kind: 'deny', threw: true, invalid: false };
            }
            if (!VALID_CALLBACK_KINDS.has(cbKind)) {
                return { kind: 'deny', threw: false, invalid: true };
            }
            return { kind: cbKind, threw: false, invalid: false };
        });
    }
    // ── evaluate ──────────────────────────────────────────────────────────────
    function evaluate(ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const ts = nowIso();
            const decisionId = makeDecisionId();
            const agentOverride = (_a = opts.perAgentOverrides) === null || _a === void 0 ? void 0 : _a[ctx.agentId];
            const autonomousMaxTier = (_b = agentOverride === null || agentOverride === void 0 ? void 0 : agentOverride.maxTier) !== null && _b !== void 0 ? _b : globalAutonomousMaxTier;
            // ── 1. perAgentOverrides denyList ─────────────────────────────────────
            if ((_c = agentOverride === null || agentOverride === void 0 ? void 0 : agentOverride.denyList) === null || _c === void 0 ? void 0 : _c.includes(ctx.toolName)) {
                const decision = {
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
            if ((_d = agentOverride === null || agentOverride === void 0 ? void 0 : agentOverride.allowList) === null || _d === void 0 ? void 0 : _d.includes(ctx.toolName)) {
                const decision = {
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
            const tokenIdx = oneShotTokens.findIndex((t) => t.toolName === ctx.toolName &&
                (t.agentId === undefined || t.agentId === ctx.agentId));
            if (tokenIdx >= 0) {
                const token = oneShotTokens[tokenIdx];
                // Token "dictates the path" if it changes the final allowed outcome
                // vs what the base tier would produce unconditionally.
                // allow-once: only dictates if base is not already 'safe'
                // deny-once: only dictates if base is not already 'forbidden'
                const tokenDictates = (token.kind === 'allow-once' && tier !== 'safe') ||
                    (token.kind === 'deny-once' && tier !== 'forbidden');
                if (tokenDictates) {
                    oneShotTokens.splice(tokenIdx, 1); // consume
                    const allowed = token.kind === 'allow-once';
                    const decision = {
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
            let decision;
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
            }
            else if (tier === 'safe') {
                decision = {
                    allowed: true,
                    kind: 'allow',
                    tier,
                    reason: 'tier safe',
                    policyMatched,
                    ts,
                    decisionId,
                };
            }
            else if (tier === 'review') {
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
                }
                else if (opts.approvalCallback) {
                    decision = yield resolveViaCallback(ctx, tier, policyMatched, ts, decisionId);
                }
                else {
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
            else {
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
                }
                else if (opts.approvalCallback) {
                    decision = yield resolveViaCallback(ctx, tier, policyMatched, ts, decisionId);
                }
                else {
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
        });
    }
    /**
     * Shared callback-resolution path for review and restricted tiers.
     * Does NOT call pushAudit — callers do that after return.
     */
    function resolveViaCallback(ctx, tier, policyMatched, ts, decisionId) {
        return __awaiter(this, void 0, void 0, function* () {
            const provisional = {
                allowed: false,
                kind: 'ask',
                tier,
                reason: 'requires approval',
                policyMatched,
                needsApproval: true,
                ts,
                decisionId,
            };
            const { kind, threw, invalid } = yield invokeCallback(ctx, provisional);
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
        });
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    function makeEntry(id, ts, ctx, decision) {
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
        recordOutcome(decisionId, outcome) {
            const entry = auditIndex.get(decisionId);
            if (entry) {
                entry.outcome = outcome;
            }
            if (opts.auditPath) {
                appendToFile(JSON.stringify({ outcomeUpdate: decisionId, outcome }));
            }
        },
        setPolicy(p) {
            policiesMap.set(p.toolName, p);
        },
        removePolicy(toolName) {
            return policiesMap.delete(toolName);
        },
        getPolicies() {
            return Array.from(policiesMap.values());
        },
        audit(query) {
            return __awaiter(this, void 0, void 0, function* () {
                if ((query === null || query === void 0 ? void 0 : query.limit) === 0)
                    return [];
                let result = auditRing.slice();
                if ((query === null || query === void 0 ? void 0 : query.sinceMs) !== undefined) {
                    const since = query.sinceMs;
                    result = result.filter((e) => new Date(e.ts).getTime() >= since);
                }
                if ((query === null || query === void 0 ? void 0 : query.agentId) !== undefined) {
                    const aid = query.agentId;
                    result = result.filter((e) => e.agentId === aid);
                }
                if ((query === null || query === void 0 ? void 0 : query.toolName) !== undefined) {
                    const tn = query.toolName;
                    result = result.filter((e) => e.toolName === tn);
                }
                if ((query === null || query === void 0 ? void 0 : query.limit) !== undefined && query.limit > 0) {
                    result = result.slice(-query.limit);
                }
                return result;
            });
        },
        approveOnce(toolName, agentId) {
            oneShotTokens.push({ toolName, agentId, kind: 'allow-once' });
        },
        denyOnce(toolName, agentId) {
            oneShotTokens.push({ toolName, agentId, kind: 'deny-once' });
        },
        flush() {
            return __awaiter(this, void 0, void 0, function* () {
                // appendFileSync is synchronous — all writes are already complete.
            });
        },
    };
}
