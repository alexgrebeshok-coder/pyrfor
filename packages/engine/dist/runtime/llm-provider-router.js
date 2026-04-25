/**
 * llm-provider-router.ts — Pyrfor intelligent LLM provider router.
 *
 * Smart multi-provider LLM router featuring:
 *   - Rolling-window health tracking (success rate + avg latency per provider)
 *   - Circuit breaker: N consecutive failures → open for cooldownMs
 *   - Half-open probing: one trial after cooldown; success closes, failure re-opens
 *   - Capability-based provider filtering (chat/tools/vision/audio/embedding)
 *   - Cost-aware sorting: preferCheapFor='simple' selects cheapest provider first
 *   - Concurrency caps: maxConcurrent skips saturated providers
 *   - AbortSignal propagation; abort errors are not counted as health failures
 *   - Event system: callStart / callEnd / callError / circuitOpen / circuitClose
 *   - External health recording for out-of-band calls
 *
 * Pure TS, ESM-only, no external dependencies.
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
// ── Factory ───────────────────────────────────────────────────────────────────
export function createProviderRouter(opts) {
    var _a, _b, _c, _d;
    const healthWindow = (_a = opts === null || opts === void 0 ? void 0 : opts.healthWindow) !== null && _a !== void 0 ? _a : 50;
    const circuitFailuresThreshold = (_b = opts === null || opts === void 0 ? void 0 : opts.circuitFailures) !== null && _b !== void 0 ? _b : 5;
    const circuitCooldownMs = (_c = opts === null || opts === void 0 ? void 0 : opts.circuitCooldownMs) !== null && _c !== void 0 ? _c : 30000;
    const clock = (_d = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _d !== void 0 ? _d : (() => Date.now());
    const logger = opts === null || opts === void 0 ? void 0 : opts.logger;
    const providers = new Map();
    const listeners = new Map();
    // ── Event helpers ──────────────────────────────────────────────────────────
    function emit(event, meta) {
        var _a;
        (_a = listeners.get(event)) === null || _a === void 0 ? void 0 : _a.forEach(cb => {
            try {
                cb(meta);
            }
            catch ( /* swallow listener errors to protect the router */_a) { /* swallow listener errors to protect the router */ }
        });
    }
    // ── Health computation ─────────────────────────────────────────────────────
    function computeSuccessRate(entry) {
        if (entry.windowOutcomes.length === 0)
            return 1; // optimistic default
        return entry.windowOutcomes.filter(Boolean).length / entry.windowOutcomes.length;
    }
    function computeAvgLatency(entry) {
        if (entry.windowLatencies.length === 0)
            return 0;
        return entry.windowLatencies.reduce((a, b) => a + b, 0) / entry.windowLatencies.length;
    }
    function healthScore(entry) {
        var _a;
        const rate = computeSuccessRate(entry);
        const latencyS = computeAvgLatency(entry) / 1000;
        const weight = (_a = entry.cfg.weight) !== null && _a !== void 0 ? _a : 1;
        // Higher success rate and lower latency → higher score; weight shifts preference.
        return (rate * weight) / (1 + latencyS);
    }
    // ── Circuit breaker helpers ────────────────────────────────────────────────
    function isCircuitOpen(entry, now) {
        return entry.circuitOpenUntil > 0 && now < entry.circuitOpenUntil;
    }
    function isHalfOpenEligible(entry, now) {
        // Cooldown has expired but circuit was opened → allow one probe.
        return entry.circuitOpenUntil > 0 && now >= entry.circuitOpenUntil;
    }
    // ── Outcome recording ──────────────────────────────────────────────────────
    function recordOutcome(entry, ok, latencyMs, isHalfOpenTrial) {
        // Maintain rolling window for both outcomes and latencies.
        entry.windowOutcomes.push(ok);
        entry.windowLatencies.push(latencyMs);
        if (entry.windowOutcomes.length > healthWindow) {
            entry.windowOutcomes.shift();
            entry.windowLatencies.shift();
        }
        if (ok) {
            entry.consecutiveFailures = 0;
            if (isHalfOpenTrial) {
                entry.circuitOpenUntil = 0;
                entry.halfOpen = false;
                emit('circuitClose', { providerId: entry.cfg.id });
                logger === null || logger === void 0 ? void 0 : logger('circuit closed', { providerId: entry.cfg.id });
            }
        }
        else {
            entry.consecutiveFailures++;
            if (isHalfOpenTrial) {
                // Half-open trial failed → re-open for another full cooldown.
                entry.halfOpen = false;
                entry.circuitOpenUntil = clock() + circuitCooldownMs;
                emit('circuitOpen', { providerId: entry.cfg.id, until: entry.circuitOpenUntil });
                logger === null || logger === void 0 ? void 0 : logger('circuit re-opened (half-open failure)', { providerId: entry.cfg.id });
            }
            else if (entry.consecutiveFailures >= circuitFailuresThreshold &&
                entry.circuitOpenUntil === 0) {
                entry.circuitOpenUntil = clock() + circuitCooldownMs;
                emit('circuitOpen', { providerId: entry.cfg.id, until: entry.circuitOpenUntil });
                logger === null || logger === void 0 ? void 0 : logger('circuit opened', { providerId: entry.cfg.id });
            }
        }
    }
    function resetEntry(entry) {
        entry.windowOutcomes = [];
        entry.windowLatencies = [];
        entry.consecutiveFailures = 0;
        entry.circuitOpenUntil = 0;
        entry.halfOpen = false;
    }
    // ── Candidate sorting ──────────────────────────────────────────────────────
    function sortCandidates(entries, preferCheapFor, now) {
        return [...entries].sort((a, b) => {
            var _a, _b;
            // Open-circuit providers sort last (half-open-eligible are treated as available).
            const aSkip = isCircuitOpen(a, now);
            const bSkip = isCircuitOpen(b, now);
            if (aSkip !== bSkip)
                return aSkip ? 1 : -1;
            // Cost-aware: cheapest first for simple tasks.
            if (preferCheapFor === 'simple') {
                const aCost = (_a = a.cfg.costPerKToken) !== null && _a !== void 0 ? _a : Infinity;
                const bCost = (_b = b.cfg.costPerKToken) !== null && _b !== void 0 ? _b : Infinity;
                if (aCost !== bCost)
                    return aCost - bCost;
            }
            // Health-based tiebreaker: highest composite score first.
            return healthScore(b) - healthScore(a);
        });
    }
    // ── AbortError helpers ─────────────────────────────────────────────────────
    function createAbortError(msg) {
        if (typeof DOMException !== 'undefined') {
            return new DOMException(msg, 'AbortError');
        }
        const e = new Error(msg);
        e.name = 'AbortError';
        return e;
    }
    function isAbortError(err) {
        return err instanceof Error && err.name === 'AbortError';
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        register(cfg) {
            if (providers.has(cfg.id)) {
                throw new Error(`Provider '${cfg.id}' is already registered`);
            }
            providers.set(cfg.id, {
                cfg,
                windowOutcomes: [],
                windowLatencies: [],
                consecutiveFailures: 0,
                circuitOpenUntil: 0,
                halfOpen: false,
                activeCalls: 0,
            });
            logger === null || logger === void 0 ? void 0 : logger('provider registered', { id: cfg.id });
        },
        unregister(id) {
            providers.delete(id);
            logger === null || logger === void 0 ? void 0 : logger('provider unregistered', { id });
        },
        listProviders() {
            const now = clock();
            return [...providers.values()].map(entry => {
                const status = {
                    id: entry.cfg.id,
                    healthy: !isCircuitOpen(entry, now),
                    successRate: computeSuccessRate(entry),
                    avgLatencyMs: computeAvgLatency(entry),
                    activeCalls: entry.activeCalls,
                };
                if (entry.circuitOpenUntil > 0) {
                    status.circuitOpenUntil = entry.circuitOpenUntil;
                }
                return status;
            });
        },
        call(req, opts) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d;
                if ((_a = req.signal) === null || _a === void 0 ? void 0 : _a.aborted)
                    throw createAbortError('Aborted before call');
                // Build candidate list (order-based or full registry).
                let candidates;
                if (opts === null || opts === void 0 ? void 0 : opts.order) {
                    candidates = opts.order
                        .map(id => providers.get(id))
                        .filter((e) => e !== undefined);
                }
                else {
                    candidates = [...providers.values()];
                }
                // Capability filter: must satisfy every requested modality.
                if (req.needs && req.needs.length > 0) {
                    candidates = candidates.filter(entry => {
                        const caps = entry.cfg.capabilities;
                        if (!caps || caps.length === 0)
                            return false;
                        return req.needs.every(need => caps.includes(need));
                    });
                }
                // Sort only when the caller hasn't prescribed an order.
                if (!(opts === null || opts === void 0 ? void 0 : opts.order)) {
                    candidates = sortCandidates(candidates, req.preferCheapFor, clock());
                }
                const maxAttempts = (_b = opts === null || opts === void 0 ? void 0 : opts.maxAttempts) !== null && _b !== void 0 ? _b : candidates.length;
                let lastError;
                let attempts = 0;
                for (const entry of candidates) {
                    if (attempts >= maxAttempts)
                        break;
                    if ((_c = req.signal) === null || _c === void 0 ? void 0 : _c.aborted)
                        throw createAbortError('Aborted');
                    const now = clock();
                    // Hard-skip providers whose circuit is still open.
                    if (isCircuitOpen(entry, now))
                        continue;
                    // Half-open: allow exactly one in-flight trial after cooldown expiry.
                    let isHalfOpenTrial = false;
                    if (isHalfOpenEligible(entry, now)) {
                        if (entry.halfOpen)
                            continue; // a trial is already in-flight
                        isHalfOpenTrial = true;
                        entry.halfOpen = true;
                    }
                    // Concurrency cap: skip saturated providers.
                    if (entry.cfg.maxConcurrent !== undefined && entry.activeCalls >= entry.cfg.maxConcurrent) {
                        if (isHalfOpenTrial)
                            entry.halfOpen = false; // undo trial reservation
                        continue;
                    }
                    attempts++;
                    entry.activeCalls++;
                    const callStart = clock();
                    emit('callStart', { providerId: entry.cfg.id });
                    try {
                        const resp = yield entry.cfg.call(req);
                        const latencyMs = clock() - callStart;
                        entry.activeCalls--;
                        recordOutcome(entry, true, latencyMs, isHalfOpenTrial);
                        emit('callEnd', { providerId: entry.cfg.id, latencyMs, response: resp });
                        return {
                            provider: entry.cfg.id,
                            text: resp.text,
                            toolCalls: resp.toolCalls,
                            usage: resp.usage,
                            latencyMs,
                        };
                    }
                    catch (err) {
                        const latencyMs = clock() - callStart;
                        entry.activeCalls--;
                        // Abort errors are not health failures; propagate immediately.
                        if (isAbortError(err)) {
                            if (isHalfOpenTrial)
                                entry.halfOpen = false;
                            throw err;
                        }
                        recordOutcome(entry, false, latencyMs, isHalfOpenTrial);
                        emit('callError', { providerId: entry.cfg.id, error: err, latencyMs });
                        lastError = err instanceof Error ? err : new Error(String(err));
                    }
                }
                if ((_d = req.signal) === null || _d === void 0 ? void 0 : _d.aborted)
                    throw createAbortError('Aborted');
                if (lastError)
                    throw lastError;
                throw new Error('No available providers for the given request');
            });
        },
        recordExternal(providerId, ok, latencyMs) {
            const entry = providers.get(providerId);
            if (!entry)
                return;
            recordOutcome(entry, ok, latencyMs, false);
        },
        resetHealth(providerId) {
            if (providerId !== undefined) {
                const entry = providers.get(providerId);
                if (entry)
                    resetEntry(entry);
            }
            else {
                for (const entry of providers.values())
                    resetEntry(entry);
            }
        },
        on(event, cb) {
            if (!listeners.has(event))
                listeners.set(event, new Set());
            listeners.get(event).add(cb);
            return () => { var _a; (_a = listeners.get(event)) === null || _a === void 0 ? void 0 : _a.delete(cb); };
        },
    };
}
