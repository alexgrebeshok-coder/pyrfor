/**
 * Token / Cost Budget Controller
 *
 * Tracks LLM token and USD consumption across task / session / global scopes,
 * enforces configurable per-window limits, emits warnings and block events, and
 * persists state atomically across restarts.
 *
 * No external dependencies — only node:fs/promises and node:path.
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
import { readFileSync, mkdirSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
export function createTokenBudgetController(opts) {
    const { storePath, clock = () => Date.now(), flushDebounceMs = 2000, logger: log, } = opts;
    // ── State ────────────────────────────────────────────────────────────────
    let rules = [];
    let consumptions = [];
    // Track which rule ids have already warned in the current window, to avoid repeat events.
    const warnedRules = new Set();
    // ── Load persisted state ─────────────────────────────────────────────────
    try {
        const raw = readFileSync(storePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.consumptions))
            consumptions = parsed.consumptions;
        if (Array.isArray(parsed.rules))
            rules = parsed.rules;
    }
    catch (err) {
        const isNotFound = err instanceof Error && err.code === 'ENOENT';
        if (!isNotFound) {
            log === null || log === void 0 ? void 0 : log('token-budget: corrupt or unreadable store, starting fresh', {
                storePath,
                err: err instanceof Error ? err.message : String(err),
            });
        }
    }
    // Merge any rules passed at construction time (construction opts take precedence by id).
    if (opts.rules) {
        const constructionIds = new Set(opts.rules.map((r) => r.id));
        rules = [...rules.filter((r) => !constructionIds.has(r.id)), ...opts.rules];
    }
    // ── Event emitter ────────────────────────────────────────────────────────
    const listeners = new Map([
        ['consume', new Set()],
        ['warn', new Set()],
        ['block', new Set()],
    ]);
    function emit(event, payload) {
        var _a;
        for (const cb of (_a = listeners.get(event)) !== null && _a !== void 0 ? _a : []) {
            try {
                cb(payload);
            }
            catch (_b) {
                // swallow listener errors
            }
        }
    }
    // ── Flush / persistence ──────────────────────────────────────────────────
    let flushTimer = null;
    let flushPending = false;
    function scheduleFlush() {
        if (flushTimer !== null)
            return;
        flushPending = true;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void doFlush();
        }, flushDebounceMs);
    }
    function doFlush() {
        return __awaiter(this, void 0, void 0, function* () {
            flushPending = false;
            const state = { rules: [...rules], consumptions: [...consumptions] };
            const content = JSON.stringify(state, null, 2);
            const tmp = `${storePath}.tmp-${clock()}`;
            try {
                mkdirSync(dirname(storePath), { recursive: true });
                yield writeFile(tmp, content, 'utf8');
                yield rename(tmp, storePath);
            }
            catch (err) {
                log === null || log === void 0 ? void 0 : log('token-budget: flush failed', { err: err instanceof Error ? err.message : String(err) });
                try {
                    yield unlink(tmp);
                }
                catch ( /* ignore */_a) { /* ignore */ }
                throw err;
            }
        });
    }
    // ── Window math ───────────────────────────────────────────────────────────
    function windowStart(window, now) {
        switch (window) {
            case 'hour':
                return now - 3600000;
            case 'day': {
                const d = new Date(now);
                return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            }
            case 'month': {
                const d = new Date(now);
                return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
            }
            case 'total':
                return 0;
        }
    }
    // ── Scope matching ────────────────────────────────────────────────────────
    function consumptionMatchesRule(c, rule) {
        if (c.scope !== rule.scope)
            return false;
        if (rule.targetId !== undefined && c.targetId !== rule.targetId)
            return false;
        return true;
    }
    function requestMatchesRule(req, rule) {
        if (req.scope !== rule.scope)
            return false;
        if (rule.targetId !== undefined && req.targetId !== rule.targetId)
            return false;
        return true;
    }
    // ── Core helpers ──────────────────────────────────────────────────────────
    function usageForRule(rule, now) {
        const start = windowStart(rule.window, now);
        const end = now;
        let tokens = 0;
        let costUsd = 0;
        for (const c of consumptions) {
            if (c.ts < start)
                continue;
            if (!consumptionMatchesRule(c, rule))
                continue;
            tokens += c.promptTokens + c.completionTokens;
            costUsd += c.costUsd;
        }
        return { tokens, costUsd, windowStart: start, windowEnd: end };
    }
    // ── Public API ────────────────────────────────────────────────────────────
    function addRule(rule) {
        rules = [...rules.filter((r) => r.id !== rule.id), rule];
        scheduleFlush();
    }
    function removeRule(id) {
        rules = rules.filter((r) => r.id !== id);
        warnedRules.delete(id);
        scheduleFlush();
    }
    function listRules() {
        return [...rules];
    }
    function canConsume(req) {
        const now = clock();
        const estTokens = req.estPromptTokens + req.estCompletionTokens;
        for (const rule of rules) {
            if (!requestMatchesRule(req, rule))
                continue;
            const usage = usageForRule(rule, now);
            const projectedTokens = usage.tokens + estTokens;
            const projectedCost = usage.costUsd + req.estCostUsd;
            if (rule.maxTokens !== undefined && projectedTokens > rule.maxTokens) {
                emit('block', { rule: rule.id, req });
                return {
                    allowed: false,
                    blockingRule: rule.id,
                    remainingTokens: Math.max(0, rule.maxTokens - usage.tokens),
                    remainingCostUsd: rule.maxCostUsd !== undefined
                        ? Math.max(0, rule.maxCostUsd - usage.costUsd)
                        : undefined,
                };
            }
            if (rule.maxCostUsd !== undefined && projectedCost > rule.maxCostUsd) {
                emit('block', { rule: rule.id, req });
                return {
                    allowed: false,
                    blockingRule: rule.id,
                    remainingTokens: rule.maxTokens !== undefined
                        ? Math.max(0, rule.maxTokens - usage.tokens)
                        : undefined,
                    remainingCostUsd: Math.max(0, rule.maxCostUsd - usage.costUsd),
                };
            }
        }
        return { allowed: true };
    }
    function recordConsumption(c) {
        consumptions.push(c);
        emit('consume', c);
        const now = clock();
        const triggered = [];
        for (const rule of rules) {
            if (!consumptionMatchesRule(c, rule))
                continue;
            const usage = usageForRule(rule, now);
            // Check hard limits — emit block if exceeded after the fact
            const overTokens = rule.maxTokens !== undefined && usage.tokens > rule.maxTokens;
            const overCost = rule.maxCostUsd !== undefined && usage.costUsd > rule.maxCostUsd;
            if (overTokens || overCost) {
                emit('block', { rule: rule.id, consumption: c, usage });
            }
            // Warning threshold
            if (rule.warnAtPercent !== undefined && !warnedRules.has(rule.id)) {
                const tokenPct = rule.maxTokens !== undefined ? (usage.tokens / rule.maxTokens) * 100 : 0;
                const costPct = rule.maxCostUsd !== undefined ? (usage.costUsd / rule.maxCostUsd) * 100 : 0;
                const pct = Math.max(tokenPct, costPct);
                if (pct >= rule.warnAtPercent) {
                    warnedRules.add(rule.id);
                    triggered.push(rule.id);
                    emit('warn', { rule: rule.id, pct, usage });
                    log === null || log === void 0 ? void 0 : log(`token-budget: warn threshold reached for rule ${rule.id}`, { pct, usage });
                }
            }
        }
        scheduleFlush();
        return { warnings: triggered };
    }
    function usageFor(rule) {
        return usageForRule(rule, clock());
    }
    function reportSnapshot() {
        const now = clock();
        let totalConsumption = 0;
        let totalCostUsd = 0;
        for (const c of consumptions) {
            totalConsumption += c.promptTokens + c.completionTokens;
            totalCostUsd += c.costUsd;
        }
        const ruleSnapshots = rules.map((rule) => {
            var _a, _b;
            const usage = usageForRule(rule, now);
            const limit = (_b = (_a = rule.maxTokens) !== null && _a !== void 0 ? _a : rule.maxCostUsd) !== null && _b !== void 0 ? _b : 1;
            const usedValue = rule.maxTokens !== undefined ? usage.tokens : usage.costUsd;
            const percentUsed = (usedValue / limit) * 100;
            return { rule, usage, percentUsed };
        });
        return { rules: ruleSnapshots, totalConsumption, totalCostUsd };
    }
    function flush() {
        return __awaiter(this, void 0, void 0, function* () {
            if (flushTimer !== null) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            yield doFlush();
        });
    }
    function reset(scope) {
        if (scope === undefined) {
            consumptions = [];
            warnedRules.clear();
        }
        else {
            consumptions = consumptions.filter((c) => c.scope !== scope);
            // Clear warned state for rules of that scope so they can warn again
            for (const rule of rules) {
                if (rule.scope === scope)
                    warnedRules.delete(rule.id);
            }
        }
        scheduleFlush();
    }
    function on(event, cb) {
        listeners.get(event).add(cb);
        return () => listeners.get(event).delete(cb);
    }
    return {
        addRule,
        removeRule,
        listRules,
        canConsume,
        recordConsumption,
        usageFor,
        reportSnapshot,
        flush,
        reset,
        on,
    };
}
