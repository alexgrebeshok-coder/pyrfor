/**
 * AI Run Cost Tracker
 *
 * Estimates and records LLM API call costs.
 * Uses approximate token pricing per provider/model.
 * Records are written asynchronously to avoid blocking.
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
import "server-only";
import { logger } from '../observability/logger.js';
import { agentBus } from './messaging/agent-bus.js';
const PRICE_TABLE = {
    openai: {
        "gpt-5.2": { input: 0.002, output: 0.008 },
        "gpt-5.1": { input: 0.002, output: 0.008 },
        "gpt-4o": { input: 0.0025, output: 0.01 },
        "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    },
    openrouter: {
        "openai/gpt-4o-mini": { input: 0.00015, output: 0.0006 },
        "google/gemma-3-27b-it:free": { input: 0, output: 0 },
        "google/gemma-3-12b-it:free": { input: 0, output: 0 },
        "google/gemma-3-4b-it:free": { input: 0, output: 0 },
    },
    gigachat: {
        "GigaChat": { input: 0.00025, output: 0.00025 },
        "GigaChat-Plus": { input: 0.0005, output: 0.0005 },
        "GigaChat-Pro": { input: 0.001, output: 0.001 },
    },
    yandexgpt: {
        "yandexgpt-lite": { input: 0.0002, output: 0.0002 },
        "yandexgpt": { input: 0.0006, output: 0.0006 },
        "yandexgpt-32k": { input: 0.0006, output: 0.0006 },
    },
    aijora: { default: { input: 0.001, output: 0.003 } },
    polza: { default: { input: 0.001, output: 0.003 } },
    bothub: { default: { input: 0.001, output: 0.003 } },
    zai: { default: { input: 0.0005, output: 0.001 } },
};
let _tokenEncoder;
/** Prefer js-tiktoken when available, otherwise fall back to a rough char-based estimate. */
export function estimateTokens(text) {
    const encoder = getTokenEncoder();
    if (encoder) {
        return encoder.encode(text).length;
    }
    return Math.ceil(text.length / 4);
}
export function estimateMessagesTokens(messages) {
    return messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
}
const USD_TO_RUB = 90;
export function calculateCost(provider, model, inputTokens, outputTokens) {
    const providerPrices = PRICE_TABLE[provider] || {};
    const price = providerPrices[model] ||
        providerPrices["default"] ||
        { input: 0.001, output: 0.003 }; // conservative fallback
    const costUsd = (inputTokens / 1000) * price.input +
        (outputTokens / 1000) * price.output;
    return {
        provider,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        costRub: costUsd * USD_TO_RUB,
    };
}
/**
 * Log a cost record to the database. Non-blocking — errors are logged, not thrown.
 *
 * Side-effect: after the row is persisted we refresh the workspace's daily
 * posture and, if a budget threshold was just crossed (80% warning or 100%
 * breach), publish a `budget.alert` event on the agent bus exactly once per
 * workspace/day/threshold. Consumers (UI banner, ops dashboard, Slack
 * webhook in a later wave) subscribe to this event.
 */
export function trackCost(record) {
    return __awaiter(this, void 0, void 0, function* () {
        yield trackCostWithRetry(record);
        if (record.workspaceId) {
            // Fire-and-forget: breach detection must never block the caller.
            void maybePublishBudgetAlert(record);
        }
    });
}
// ============================================
// Budget breach detection
// ============================================
/**
 * Thresholds (fraction of daily limit) at which we publish a `budget.alert`
 * event. Once a workspace crosses a threshold on a given UTC day we stop
 * re-emitting it for that day — the alert is meant to be actionable, not a
 * firehose.
 */
const BUDGET_ALERT_THRESHOLDS = [0.8, 1.0];
const publishedAlerts = new Set();
function alertKey(workspaceId, threshold, day) {
    return `${workspaceId}|${day}|${threshold}`;
}
function severityFor(threshold) {
    return threshold >= 1 ? "breach" : "warning";
}
/**
 * Drop cached alert markers once per 24h so the set cannot grow unbounded
 * in long-running processes.
 */
function pruneAlertCache(currentDay) {
    for (const key of publishedAlerts) {
        if (!key.includes(`|${currentDay}|`)) {
            publishedAlerts.delete(key);
        }
    }
}
function maybePublishBudgetAlert(record) {
    return __awaiter(this, void 0, void 0, function* () {
        const workspaceId = record.workspaceId;
        if (!workspaceId)
            return;
        let posture;
        try {
            posture = yield getDailyCostPosture(workspaceId);
        }
        catch (err) {
            logger.warn("cost-tracker: breach check failed to load posture", {
                workspaceId,
                error: err instanceof Error ? err.message : String(err),
            });
            return;
        }
        const dailyLimit = posture.dailyLimitUsd;
        if (dailyLimit <= 0)
            return;
        const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        pruneAlertCache(day);
        for (const threshold of BUDGET_ALERT_THRESHOLDS) {
            if (posture.utilization < threshold)
                continue;
            const key = alertKey(workspaceId, threshold, day);
            if (publishedAlerts.has(key))
                continue;
            publishedAlerts.add(key);
            const payload = {
                workspaceId,
                severity: severityFor(threshold),
                threshold,
                totalUsdToday: posture.totalUsdToday,
                dailyLimitUsd: posture.dailyLimitUsd,
                utilization: posture.utilization,
                triggeredBy: {
                    agentId: record.agentId,
                    runId: record.runId,
                    provider: record.provider,
                    model: record.model,
                    costUsd: record.costUsd,
                },
                at: new Date().toISOString(),
            };
            try {
                yield agentBus.publish("budget.alert", payload, {
                    source: "cost-tracker",
                    workspaceId,
                    runId: record.runId,
                });
                logger.warn("cost-tracker: budget alert published", {
                    workspaceId,
                    severity: payload.severity,
                    threshold,
                    utilization: posture.utilization,
                });
            }
            catch (err) {
                logger.warn("cost-tracker: failed to publish budget alert", {
                    workspaceId,
                    severity: payload.severity,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    });
}
/**
 * Fetch recent budget alerts for a workspace from the in-process bus log.
 * Used by the AI Ops dashboard to render a "recent breaches" panel.
 */
export function getRecentBudgetAlerts(workspaceId, limit = 20) {
    const messages = agentBus.recent({
        type: "budget.alert",
        workspaceId,
        limit,
    });
    return messages
        .map((m) => m.payload)
        .filter((p) => !!p && typeof p === "object");
}
/**
 * Internal helper — exposed for tests so they can clear state between runs.
 * @internal
 */
export function __resetBudgetAlertCacheForTests() {
    publishedAlerts.clear();
}
/**
 * Convenience: estimate input tokens from messages, then track after response.
 */
export function buildCostRecorder(provider, model, inputMessages, meta) {
    const inputTokens = estimateMessagesTokens(inputMessages);
    return (responseText) => {
        const outputTokens = estimateTokens(responseText);
        const cost = calculateCost(provider, model, inputTokens, outputTokens);
        void trackCost(Object.assign(Object.assign({}, cost), meta));
        return cost;
    };
}
/**
 * Snapshot today's AI spend for a workspace against the configured daily
 * budget. Returns a best-effort posture; on database failure returns an
 * "unknown" posture (utilisation 0) so ops endpoints stay up even when the
 * cost store is misbehaving.
 */
export function getDailyCostPosture(workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const dailyLimitUsd = parseFloat((_a = process.env.AI_DAILY_COST_LIMIT) !== null && _a !== void 0 ? _a : "50");
        try {
            const { prisma } = yield import('../prisma.js');
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const today = yield prisma.aIRunCost.aggregate({
                where: { workspaceId, createdAt: { gte: startOfDay } },
                _sum: { costUsd: true },
                _count: { _all: true },
            });
            const totalUsdToday = (_b = today._sum.costUsd) !== null && _b !== void 0 ? _b : 0;
            const utilization = dailyLimitUsd > 0 ? Math.min(totalUsdToday / dailyLimitUsd, 1) : 0;
            return {
                workspaceId,
                totalUsdToday,
                dailyLimitUsd,
                utilization,
                remainingUsd: Math.max(dailyLimitUsd - totalUsdToday, 0),
                recordCount: (_c = today._count._all) !== null && _c !== void 0 ? _c : 0,
                breachedAt: totalUsdToday >= dailyLimitUsd ? new Date().toISOString() : null,
            };
        }
        catch (err) {
            logger.warn("cost-tracker: daily posture lookup failed", {
                workspaceId,
                error: err instanceof Error ? err.message : String(err),
            });
            return {
                workspaceId,
                totalUsdToday: 0,
                dailyLimitUsd,
                utilization: 0,
                remainingUsd: dailyLimitUsd,
                recordCount: 0,
                breachedAt: null,
            };
        }
    });
}
export function checkCostBudget(workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { prisma } = yield import('../prisma.js');
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const today = yield prisma.aIRunCost.aggregate({
                where: {
                    workspaceId,
                    createdAt: { gte: startOfDay },
                },
                _sum: { costUsd: true },
            });
            const dailyLimitUsd = parseFloat((_a = process.env.AI_DAILY_COST_LIMIT) !== null && _a !== void 0 ? _a : "50");
            return ((_b = today._sum.costUsd) !== null && _b !== void 0 ? _b : 0) < dailyLimitUsd;
        }
        catch (err) {
            logger.warn("cost-tracker: cost budget check failed, allowing request", {
                error: err instanceof Error ? err.message : String(err),
                workspaceId,
            });
            return true;
        }
    });
}
function trackCostWithRetry(record_1) {
    return __awaiter(this, arguments, void 0, function* (record, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt += 1) {
            try {
                const { prisma } = yield import('../prisma.js');
                yield prisma.aIRunCost.create({
                    data: {
                        provider: record.provider,
                        model: record.model,
                        inputTokens: record.inputTokens,
                        outputTokens: record.outputTokens,
                        costUsd: record.costUsd,
                        costRub: record.costRub,
                        agentId: record.agentId,
                        sessionId: record.sessionId,
                        workspaceId: record.workspaceId,
                        runId: record.runId,
                    },
                });
                return;
            }
            catch (err) {
                if (attempt < maxRetries - 1) {
                    yield sleep(100 * Math.pow(2, attempt));
                    continue;
                }
                logger.warn("cost-tracker: failed to persist cost record", {
                    error: err instanceof Error ? err.message : String(err),
                    provider: record.provider,
                    model: record.model,
                });
            }
        }
    });
}
function getTokenEncoder() {
    if (_tokenEncoder !== undefined) {
        return _tokenEncoder;
    }
    try {
        const req = Function("return require")();
        const { encodingForModel } = req("js-tiktoken");
        _tokenEncoder = encodingForModel("gpt-4o");
    }
    catch (_a) {
        _tokenEncoder = null;
    }
    return _tokenEncoder;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
