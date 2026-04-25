/**
 * Budget-alert mirror — opt-in forwarder that duplicates
 * `budget.alert` events into external observability backends so
 * operators don't rely on a single webhook (or the local ring buffer)
 * when a cost breach fires.
 *
 * Two targets are supported:
 *
 *  - **Sentry** via the [ingest API](https://develop.sentry.dev/sdk/store/).
 *    Set `BUDGET_ALERT_SENTRY_DSN` to a full DSN. The mirror captures
 *    each alert as a single event with `level: warning|error` (based on
 *    severity) and a compact set of tags.
 *  - **Datadog Logs** via the [HTTP intake API](https://docs.datadoghq.com/api/latest/logs/).
 *    Set `BUDGET_ALERT_DATADOG_API_KEY` (and optionally
 *    `BUDGET_ALERT_DATADOG_SITE`, default `datadoghq.com`) to push
 *    structured log entries. A `BUDGET_ALERT_DATADOG_SERVICE` env var
 *    controls the `service` tag (default `ceoclaw-ai`).
 *
 * Each target keeps its own ring buffer of recent attempts so the ops
 * dashboard can surface health independently from the primary webhook.
 *
 * Like `budget-webhook.ts`, this subscriber is initialised from
 * `instrumentation.ts#register` and is process-wide. Multiple
 * `initBudgetAlertMirror()` calls are idempotent.
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
import { logger } from '../../observability/logger.js';
import { agentBus } from './agent-bus.js';
const MIRROR_TIMEOUT_MS = 5000;
const MIRROR_MAX_ATTEMPTS = 2;
const MAX_DELIVERY_LOG = 50;
const deliveryLog = [];
let initialized = false;
let unsubscribe = null;
function recordDelivery(delivery) {
    deliveryLog.push(delivery);
    if (deliveryLog.length > MAX_DELIVERY_LOG) {
        deliveryLog.shift();
    }
}
export function getRecentBudgetMirrorDeliveries(limit = 20) {
    return deliveryLog.slice(-limit).reverse();
}
export function isBudgetMirrorConfigured() {
    return {
        sentry: Boolean(process.env.BUDGET_ALERT_SENTRY_DSN),
        datadog: Boolean(process.env.BUDGET_ALERT_DATADOG_API_KEY),
    };
}
export function parseSentryDsn(dsn) {
    try {
        const url = new URL(dsn);
        const publicKey = url.username;
        // Sentry DSN: <scheme>://<publicKey>@<host>/<projectId>
        const projectId = url.pathname.replace(/^\//, "").replace(/\/$/, "");
        if (!publicKey || !projectId)
            return null;
        const endpoint = `${url.protocol}//${url.host}/api/${projectId}/store/`;
        return { endpoint, publicKey, projectId };
    }
    catch (_a) {
        return null;
    }
}
function sentryLevelFor(severity) {
    return severity === "breach" ? "error" : "warning";
}
function buildSentryPayload(alert) {
    const tsSeconds = new Date(alert.at).getTime() / 1000;
    return {
        event_id: generateHex32(),
        timestamp: tsSeconds,
        platform: "node",
        logger: "ceoclaw.budget",
        level: sentryLevelFor(alert.severity),
        message: {
            formatted: `AI budget ${alert.severity} for ${alert.workspaceId}`,
        },
        tags: {
            workspace: alert.workspaceId,
            severity: alert.severity,
            threshold: alert.threshold,
        },
        extra: {
            totalUsdToday: alert.totalUsdToday,
            dailyLimitUsd: alert.dailyLimitUsd,
            utilization: alert.utilization,
            at: alert.at,
            triggeredBy: alert.triggeredBy,
        },
    };
}
function generateHex32() {
    let out = "";
    for (let i = 0; i < 32; i++) {
        out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
}
function deliverSentry(alert) {
    return __awaiter(this, void 0, void 0, function* () {
        const dsn = process.env.BUDGET_ALERT_SENTRY_DSN;
        if (!dsn) {
            return notConfigured("sentry", alert);
        }
        const parsed = parseSentryDsn(dsn);
        if (!parsed) {
            logger.warn("budget-mirror: malformed Sentry DSN", { dsn: maskDsn(dsn) });
            return {
                target: "sentry",
                ok: false,
                status: 0,
                attempts: 0,
                error: "malformed DSN",
                workspaceId: alert.workspaceId,
                severity: alert.severity,
            };
        }
        const payload = buildSentryPayload(alert);
        const sentryAuth = `Sentry sentry_version=7, sentry_client=ceoclaw/1.0, ` +
            `sentry_key=${parsed.publicKey}`;
        return yield deliverWithRetry("sentry", alert, () => __awaiter(this, void 0, void 0, function* () {
            const res = yield fetchWithTimeout(parsed.endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Sentry-Auth": sentryAuth,
                },
                body: JSON.stringify(payload),
            });
            return res;
        }));
    });
}
function maskDsn(dsn) {
    return dsn.replace(/:\/\/([^@]+)@/, "://***@");
}
// ============================================================
// Datadog
// ============================================================
function buildDatadogPayload(alert) {
    var _a, _b, _c;
    const service = (_a = process.env.BUDGET_ALERT_DATADOG_SERVICE) !== null && _a !== void 0 ? _a : "ceoclaw-ai";
    return {
        ddsource: "ceoclaw",
        ddtags: `service:${service},env:${(_b = process.env.NODE_ENV) !== null && _b !== void 0 ? _b : "unknown"},workspace:${alert.workspaceId},severity:${alert.severity}`,
        service,
        hostname: (_c = process.env.HOSTNAME) !== null && _c !== void 0 ? _c : "ceoclaw",
        message: `AI budget ${alert.severity} for ${alert.workspaceId} — spent $${alert.totalUsdToday.toFixed(2)} of $${alert.dailyLimitUsd.toFixed(2)}`,
        status: alert.severity === "breach" ? "error" : "warn",
        timestamp: alert.at,
        "budget.workspace": alert.workspaceId,
        "budget.severity": alert.severity,
        "budget.threshold": alert.threshold,
        "budget.total_usd_today": alert.totalUsdToday,
        "budget.daily_limit_usd": alert.dailyLimitUsd,
        "budget.utilization": alert.utilization,
    };
}
function deliverDatadog(alert) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const apiKey = process.env.BUDGET_ALERT_DATADOG_API_KEY;
        if (!apiKey) {
            return notConfigured("datadog", alert);
        }
        const site = (_a = process.env.BUDGET_ALERT_DATADOG_SITE) !== null && _a !== void 0 ? _a : "datadoghq.com";
        const endpoint = `https://http-intake.logs.${site}/api/v2/logs`;
        const payload = [buildDatadogPayload(alert)];
        return yield deliverWithRetry("datadog", alert, () => __awaiter(this, void 0, void 0, function* () {
            const res = yield fetchWithTimeout(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "DD-API-KEY": apiKey,
                },
                body: JSON.stringify(payload),
            });
            return res;
        }));
    });
}
// ============================================================
// Shared delivery helpers
// ============================================================
function fetchWithTimeout(url, init) {
    return __awaiter(this, void 0, void 0, function* () {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
        try {
            return yield fetch(url, Object.assign(Object.assign({}, init), { signal: controller.signal }));
        }
        finally {
            clearTimeout(timer);
        }
    });
}
function deliverWithRetry(target, alert, run) {
    return __awaiter(this, void 0, void 0, function* () {
        let attempts = 0;
        let status = 0;
        let error;
        let ok = false;
        while (attempts < MIRROR_MAX_ATTEMPTS) {
            attempts += 1;
            try {
                const res = yield run();
                status = res.status;
                if (res.ok) {
                    ok = true;
                    break;
                }
                const body = yield safeBodyText(res);
                error = `HTTP ${res.status}: ${body.slice(0, 200)}`;
                if (res.status >= 400 && res.status < 500)
                    break;
            }
            catch (err) {
                error = err instanceof Error ? err.message : String(err);
            }
            if (attempts < MIRROR_MAX_ATTEMPTS) {
                yield sleep(200 * attempts);
            }
        }
        const delivery = {
            target,
            ok,
            status,
            attempts,
            error,
            workspaceId: alert.workspaceId,
            severity: alert.severity,
        };
        if (!ok) {
            logger.warn("budget-mirror: delivery failed", {
                target,
                status,
                error,
                workspaceId: alert.workspaceId,
                severity: alert.severity,
            });
        }
        recordDelivery(delivery);
        return delivery;
    });
}
function safeBodyText(res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield res.text();
        }
        catch (_a) {
            return "";
        }
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function notConfigured(target, alert) {
    return {
        target,
        ok: false,
        status: 0,
        attempts: 0,
        error: "not configured",
        workspaceId: alert.workspaceId,
        severity: alert.severity,
    };
}
// ============================================================
// Public surface
// ============================================================
/**
 * Forward a single `budget.alert` payload to every configured mirror
 * target. Exposed separately so tests (and future programmatic
 * callers) can invoke the mirror without going through the bus.
 */
export function forwardBudgetAlertToMirrors(alert) {
    return __awaiter(this, void 0, void 0, function* () {
        const configured = isBudgetMirrorConfigured();
        if (!configured.sentry && !configured.datadog)
            return [];
        const results = [];
        if (configured.sentry) {
            results.push(yield deliverSentry(alert));
        }
        if (configured.datadog) {
            results.push(yield deliverDatadog(alert));
        }
        return results;
    });
}
/**
 * Subscribe to `budget.alert` events on the agent bus. Idempotent —
 * calling twice is a no-op. Returns an unsubscribe handle for tests.
 */
export function initBudgetAlertMirror() {
    if (initialized) {
        return unsubscribe !== null && unsubscribe !== void 0 ? unsubscribe : (() => { });
    }
    const configured = isBudgetMirrorConfigured();
    if (!configured.sentry && !configured.datadog) {
        // Nothing to do — leave initialized false so opting in at runtime
        // (via dynamic env) still works on the next boot.
        return () => { };
    }
    initialized = true;
    const subscription = agentBus.subscribe("budget.alert", (message) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield forwardBudgetAlertToMirrors(message.payload);
        }
        catch (err) {
            logger.warn("budget-mirror: forward threw", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }));
    unsubscribe = () => subscription.unsubscribe();
    logger.info("budget-mirror: initialized", configured);
    return unsubscribe;
}
/** Testing helper: forget the one-shot flag and delivery log. */
export function __resetBudgetMirrorForTest() {
    initialized = false;
    unsubscribe === null || unsubscribe === void 0 ? void 0 : unsubscribe();
    unsubscribe = null;
    deliveryLog.length = 0;
}
