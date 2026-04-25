/**
 * Pyrfor Coding Supervisor — Quality Gate
 *
 * Consumes ValidatorResults, decides whether to continue, inject a correction
 * prompt, block, or hand off to the user. Tracks per-event and session-wide
 * attempt budgets.
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
import { createHash } from 'node:crypto';
// ── Helpers ──────────────────────────────────────────────────────────────────
const VERDICT_RANK = {
    pass: 0,
    warn: 1,
    correct: 2,
    block: 3,
};
/** Returns the most severe verdict from a list. */
export function strongestVerdict(verdicts) {
    if (verdicts.length === 0)
        return 'pass';
    return verdicts.reduce((best, v) => VERDICT_RANK[v] > VERDICT_RANK[best] ? v : best, 'pass');
}
function stableEventId(event) {
    const raw = String(event.type) +
        String(event.ts) +
        JSON.stringify(event.data).slice(0, 200);
    return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}
const HISTORY_CAP = 100;
/** Default correction-prompt template. */
export function defaultInjectionTemplate(input) {
    const lines = [];
    lines.push(`[PYRFOR QUALITY GATE — attempt ${input.attempt}]`);
    if (input.ceoContext) {
        lines.push('');
        lines.push('Context:');
        lines.push(input.ceoContext);
    }
    lines.push('');
    lines.push('Validators flagged the following issue(s):');
    for (const r of input.results) {
        if (r.verdict === 'correct' || r.verdict === 'block') {
            lines.push(`- [${r.validator}] ${r.message}`);
            if (r.remediation) {
                lines.push(`  ${r.remediation}`);
            }
        }
    }
    lines.push('');
    lines.push('Please fix these issues and continue.');
    return lines.join('\n');
}
// ── Factory ──────────────────────────────────────────────────────────────────
export function createQualityGate(opts) {
    var _a, _b, _c, _d, _e, _f;
    const maxPerEvent = (_a = opts.maxCorrectAttemptsPerEvent) !== null && _a !== void 0 ? _a : 3;
    const maxPerSession = (_b = opts.maxCorrectAttemptsPerSession) !== null && _b !== void 0 ? _b : 10;
    const budgetTokens = (_c = opts.budgetTokens) !== null && _c !== void 0 ? _c : 100000;
    const warnIsCorrection = (_d = opts.warnIsCorrection) !== null && _d !== void 0 ? _d : false;
    const template = (_e = opts.injectionTemplate) !== null && _e !== void 0 ? _e : defaultInjectionTemplate;
    const log = (_f = opts.logger) !== null && _f !== void 0 ? _f : (() => { });
    // Mutable state
    let state = makeEmptyState(opts.sessionId);
    function makeEmptyState(sessionId) {
        return {
            sessionId,
            totalCorrections: 0,
            perEventAttempts: new Map(),
            tokensUsed: 0,
            blocked: false,
            history: [],
        };
    }
    function pushHistory(d) {
        state.history.push(d);
        if (state.history.length > HISTORY_CAP) {
            state.history.shift();
        }
    }
    function evaluate(event, results, evalOpts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            // Accumulate external token usage if provided
            if ((evalOpts === null || evalOpts === void 0 ? void 0 : evalOpts.tokensUsed) != null) {
                state.tokensUsed += evalOpts.tokensUsed;
            }
            // 1. Hard block already set
            if (state.blocked) {
                const d = {
                    action: 'block',
                    reason: 'session is blocked',
                    results,
                    attempt: 0,
                    remainingPerEvent: 0,
                    remainingPerSession: maxPerSession - state.totalCorrections,
                };
                pushHistory(d);
                return d;
            }
            // 2. Empty results
            if (results.length === 0) {
                const d = {
                    action: 'continue',
                    reason: 'no validators applied',
                    results,
                    attempt: 0,
                    remainingPerEvent: maxPerEvent,
                    remainingPerSession: maxPerSession - state.totalCorrections,
                };
                pushHistory(d);
                return d;
            }
            // 3. Strongest verdict
            const verdicts = results.map((r) => r.verdict);
            let strongest = strongestVerdict(verdicts);
            // 4. Check requireUser flag
            const requiresUser = results.some((r) => { var _a; return ((_a = r.details) === null || _a === void 0 ? void 0 : _a.requireUser) === true; });
            if (requiresUser) {
                const d = {
                    action: 'request_user',
                    reason: 'validator requires user review',
                    results,
                    attempt: 0,
                    remainingPerEvent: maxPerEvent,
                    remainingPerSession: maxPerSession - state.totalCorrections,
                };
                pushHistory(d);
                return d;
            }
            // 5. Resolve effective verdict
            if (strongest === 'warn' && warnIsCorrection) {
                strongest = 'correct';
            }
            const eventId = (_a = evalOpts === null || evalOpts === void 0 ? void 0 : evalOpts.eventId) !== null && _a !== void 0 ? _a : stableEventId(event);
            // 6. Handle 'pass' / 'warn' (not treated as correction)
            if (strongest === 'pass' || strongest === 'warn') {
                const d = {
                    action: 'continue',
                    reason: `strongest verdict: ${strongest}`,
                    results,
                    attempt: 0,
                    remainingPerEvent: maxPerEvent - ((_b = state.perEventAttempts.get(eventId)) !== null && _b !== void 0 ? _b : 0),
                    remainingPerSession: maxPerSession - state.totalCorrections,
                };
                pushHistory(d);
                return d;
            }
            // 7. Handle 'block' from validators
            if (strongest === 'block') {
                state.blocked = true;
                const d = {
                    action: 'block',
                    reason: 'validator issued block verdict',
                    results,
                    attempt: (_c = state.perEventAttempts.get(eventId)) !== null && _c !== void 0 ? _c : 0,
                    remainingPerEvent: 0,
                    remainingPerSession: 0,
                };
                pushHistory(d);
                log('warn', '[quality-gate] blocked by validator', { eventId });
                return d;
            }
            // 8. Handle 'correct'
            const prevAttempts = (_d = state.perEventAttempts.get(eventId)) !== null && _d !== void 0 ? _d : 0;
            const attempt = prevAttempts + 1;
            const overPerEvent = prevAttempts >= maxPerEvent;
            const overSession = state.totalCorrections >= maxPerSession;
            const overBudget = state.tokensUsed >= budgetTokens;
            if (overPerEvent || overSession || overBudget) {
                state.blocked = true;
                const reason = overPerEvent
                    ? `exceeded per-event auto-fix budget (${maxPerEvent})`
                    : overBudget
                        ? `exceeded token budget (${budgetTokens})`
                        : `exceeded session auto-fix budget (${maxPerSession})`;
                const d = {
                    action: 'block',
                    reason: 'exceeded auto-fix budget',
                    results,
                    attempt: prevAttempts,
                    remainingPerEvent: 0,
                    remainingPerSession: Math.max(0, maxPerSession - state.totalCorrections),
                };
                pushHistory(d);
                log('warn', `[quality-gate] ${reason}`, { eventId });
                return d;
            }
            // Build injection prompt
            let ceoContext;
            if (opts.ceoClawContext) {
                try {
                    ceoContext = yield opts.ceoClawContext();
                }
                catch (_e) {
                    // silently ignore
                }
            }
            const ctx = { event, results, attempt, ceoContext };
            // Try to enrich via llmFn only when at least one result lacks remediation
            const needsLlm = results.some((r) => (r.verdict === 'correct' || r.verdict === 'block') && !r.remediation);
            let injection = template(ctx);
            if (opts.llmFn && needsLlm) {
                try {
                    const enriched = yield opts.llmFn(injection);
                    injection = enriched;
                }
                catch (err) {
                    log('warn', '[quality-gate] llmFn failed, falling back to template', { err });
                    // keep template-only injection
                }
            }
            // Commit state changes
            state.perEventAttempts.set(eventId, attempt);
            state.totalCorrections += 1;
            const d = {
                action: 'inject_correction',
                injection,
                reason: `auto-fix attempt ${attempt}`,
                results,
                attempt,
                remainingPerEvent: maxPerEvent - attempt,
                remainingPerSession: maxPerSession - state.totalCorrections,
            };
            pushHistory(d);
            log('info', `[quality-gate] injecting correction attempt=${attempt}`, { eventId });
            return d;
        });
    }
    return {
        evaluate,
        state() {
            return Object.assign(Object.assign({}, state), { perEventAttempts: new Map(state.perEventAttempts), history: [...state.history] });
        },
        reset() {
            state = makeEmptyState(opts.sessionId);
        },
        override(action, payload) {
            if (action === 'unblock') {
                state.blocked = false;
                log('info', '[quality-gate] manually unblocked');
            }
            else if (action === 'reset_event_attempts') {
                const eid = payload === null || payload === void 0 ? void 0 : payload.eventId;
                if (eid) {
                    state.perEventAttempts.delete(eid);
                    log('info', '[quality-gate] reset per-event attempts', { eventId: eid });
                }
            }
        },
    };
}
