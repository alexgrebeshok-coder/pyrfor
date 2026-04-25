/**
 * cost-tracker.ts — Per-model token usage and dollar cost tracker for the Pyrfor engine.
 *
 * Features:
 * - Per-model pricing configuration
 * - Time-windowed spend queries (hour/day/month/total)
 * - Budget alerts with deduplication per window epoch
 * - Atomic file persistence (tmp + rename)
 * - Injectable clock for deterministic testing
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
const WINDOW_MS = {
    hour: 3600000,
    day: 86400000,
    month: 30 * 86400000,
    total: Infinity,
};
function windowEpoch(window, now) {
    const ms = WINDOW_MS[window];
    if (!isFinite(ms))
        return 0;
    return Math.floor(now / ms);
}
export function createCostTracker(opts = {}) {
    var _a, _b;
    const clock = (_a = opts.clock) !== null && _a !== void 0 ? _a : (() => Date.now());
    const onAlert = opts.onAlert;
    const persistPath = opts.persistPath;
    let records = [];
    let pricing = Object.assign({}, ((_b = opts.pricing) !== null && _b !== void 0 ? _b : {}));
    let alerts = [];
    // Tracks last epoch at which each alert was triggered: alertId → epoch
    const triggeredEpoch = new Map();
    // ── helpers ──────────────────────────────────────────────────────────────
    function computeCost(model, prompt, completion) {
        const p = pricing[model];
        if (!p)
            return 0;
        return (prompt / 1000) * p.promptPer1k + (completion / 1000) * p.completionPer1k;
    }
    function recordsInWindow(window, now, model) {
        const ms = WINDOW_MS[window];
        const cutoff = isFinite(ms) ? now - ms : -Infinity;
        return records.filter((r) => r.ts >= cutoff && (model === undefined || r.model === model));
    }
    function evaluateAlerts(now) {
        if (!onAlert)
            return;
        for (const alert of alerts) {
            const spend = tracker.getSpend(alert.window);
            if (spend >= alert.threshold) {
                const epoch = windowEpoch(alert.window, now);
                if (triggeredEpoch.get(alert.id) !== epoch) {
                    triggeredEpoch.set(alert.id, epoch);
                    onAlert(alert, spend);
                }
            }
        }
    }
    // ── public API ────────────────────────────────────────────────────────────
    const tracker = {
        record(model, prompt, completion, meta) {
            const ts = clock();
            const cost = computeCost(model, prompt, completion);
            const rec = Object.assign({ ts,
                model, promptTokens: prompt, completionTokens: completion, cost }, (meta !== undefined ? { meta } : {}));
            records.push(rec);
            evaluateAlerts(ts);
            return rec;
        },
        setPricing(model, p) {
            pricing[model] = p;
        },
        addAlert(alert) {
            alerts.push(alert);
        },
        removeAlert(id) {
            const before = alerts.length;
            alerts = alerts.filter((a) => a.id !== id);
            triggeredEpoch.delete(id);
            return alerts.length < before;
        },
        getSpend(window, model) {
            const now = clock();
            return recordsInWindow(window, now, model).reduce((s, r) => s + r.cost, 0);
        },
        getTokens(window, model) {
            const now = clock();
            const recs = recordsInWindow(window, now, model);
            const prompt = recs.reduce((s, r) => s + r.promptTokens, 0);
            const completion = recs.reduce((s, r) => s + r.completionTokens, 0);
            return { prompt, completion, total: prompt + completion };
        },
        getStats() {
            const perModel = {};
            for (const r of records) {
                if (!perModel[r.model]) {
                    perModel[r.model] = { cost: 0, prompt: 0, completion: 0, calls: 0 };
                }
                const m = perModel[r.model];
                m.cost += r.cost;
                m.prompt += r.promptTokens;
                m.completion += r.completionTokens;
                m.calls += 1;
            }
            const totalCost = records.reduce((s, r) => s + r.cost, 0);
            const totalTokens = records.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0);
            return { totalCost, totalTokens, perModel };
        },
        getRecent(limit = records.length) {
            return [...records].reverse().slice(0, limit);
        },
        clear() {
            records = [];
            triggeredEpoch.clear();
        },
        save() {
            if (!persistPath)
                return;
            const payload = { version: 1, records, pricing, alerts };
            const json = JSON.stringify(payload, null, 2);
            const dir = path.dirname(persistPath);
            const tmp = path.join(dir, `.cost-tracker-${process.pid}.tmp`);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(tmp, json, 'utf8');
            fs.renameSync(tmp, persistPath);
        },
        load() {
            var _a, _b, _c;
            if (!persistPath)
                return;
            if (!fs.existsSync(persistPath))
                return;
            const raw = fs.readFileSync(persistPath, 'utf8');
            const payload = JSON.parse(raw);
            if (payload.version !== 1)
                throw new Error('Unsupported version');
            records = (_a = payload.records) !== null && _a !== void 0 ? _a : [];
            pricing = (_b = payload.pricing) !== null && _b !== void 0 ? _b : {};
            alerts = (_c = payload.alerts) !== null && _c !== void 0 ? _c : [];
        },
    };
    return tracker;
}
