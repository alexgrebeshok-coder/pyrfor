"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecentBudgetMirrorDeliveries = getRecentBudgetMirrorDeliveries;
exports.isBudgetMirrorConfigured = isBudgetMirrorConfigured;
exports.parseSentryDsn = parseSentryDsn;
exports.forwardBudgetAlertToMirrors = forwardBudgetAlertToMirrors;
exports.initBudgetAlertMirror = initBudgetAlertMirror;
exports.__resetBudgetMirrorForTest = __resetBudgetMirrorForTest;
require("server-only");
const logger_1 = require("../../observability/logger");
const agent_bus_1 = require("./agent-bus");
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
function getRecentBudgetMirrorDeliveries(limit = 20) {
    return deliveryLog.slice(-limit).reverse();
}
function isBudgetMirrorConfigured() {
    return {
        sentry: Boolean(process.env.BUDGET_ALERT_SENTRY_DSN),
        datadog: Boolean(process.env.BUDGET_ALERT_DATADOG_API_KEY),
    };
}
function parseSentryDsn(dsn) {
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
    catch {
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
async function deliverSentry(alert) {
    const dsn = process.env.BUDGET_ALERT_SENTRY_DSN;
    if (!dsn) {
        return notConfigured("sentry", alert);
    }
    const parsed = parseSentryDsn(dsn);
    if (!parsed) {
        logger_1.logger.warn("budget-mirror: malformed Sentry DSN", { dsn: maskDsn(dsn) });
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
    return await deliverWithRetry("sentry", alert, async () => {
        const res = await fetchWithTimeout(parsed.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Sentry-Auth": sentryAuth,
            },
            body: JSON.stringify(payload),
        });
        return res;
    });
}
function maskDsn(dsn) {
    return dsn.replace(/:\/\/([^@]+)@/, "://***@");
}
// ============================================================
// Datadog
// ============================================================
function buildDatadogPayload(alert) {
    const service = process.env.BUDGET_ALERT_DATADOG_SERVICE ?? "ceoclaw-ai";
    return {
        ddsource: "ceoclaw",
        ddtags: `service:${service},env:${process.env.NODE_ENV ?? "unknown"},workspace:${alert.workspaceId},severity:${alert.severity}`,
        service,
        hostname: process.env.HOSTNAME ?? "ceoclaw",
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
async function deliverDatadog(alert) {
    const apiKey = process.env.BUDGET_ALERT_DATADOG_API_KEY;
    if (!apiKey) {
        return notConfigured("datadog", alert);
    }
    const site = process.env.BUDGET_ALERT_DATADOG_SITE ?? "datadoghq.com";
    const endpoint = `https://http-intake.logs.${site}/api/v2/logs`;
    const payload = [buildDatadogPayload(alert)];
    return await deliverWithRetry("datadog", alert, async () => {
        const res = await fetchWithTimeout(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "DD-API-KEY": apiKey,
            },
            body: JSON.stringify(payload),
        });
        return res;
    });
}
// ============================================================
// Shared delivery helpers
// ============================================================
async function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function deliverWithRetry(target, alert, run) {
    let attempts = 0;
    let status = 0;
    let error;
    let ok = false;
    while (attempts < MIRROR_MAX_ATTEMPTS) {
        attempts += 1;
        try {
            const res = await run();
            status = res.status;
            if (res.ok) {
                ok = true;
                break;
            }
            const body = await safeBodyText(res);
            error = `HTTP ${res.status}: ${body.slice(0, 200)}`;
            if (res.status >= 400 && res.status < 500)
                break;
        }
        catch (err) {
            error = err instanceof Error ? err.message : String(err);
        }
        if (attempts < MIRROR_MAX_ATTEMPTS) {
            await sleep(200 * attempts);
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
        logger_1.logger.warn("budget-mirror: delivery failed", {
            target,
            status,
            error,
            workspaceId: alert.workspaceId,
            severity: alert.severity,
        });
    }
    recordDelivery(delivery);
    return delivery;
}
async function safeBodyText(res) {
    try {
        return await res.text();
    }
    catch {
        return "";
    }
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
async function forwardBudgetAlertToMirrors(alert) {
    const configured = isBudgetMirrorConfigured();
    if (!configured.sentry && !configured.datadog)
        return [];
    const results = [];
    if (configured.sentry) {
        results.push(await deliverSentry(alert));
    }
    if (configured.datadog) {
        results.push(await deliverDatadog(alert));
    }
    return results;
}
/**
 * Subscribe to `budget.alert` events on the agent bus. Idempotent —
 * calling twice is a no-op. Returns an unsubscribe handle for tests.
 */
function initBudgetAlertMirror() {
    if (initialized) {
        return unsubscribe ?? (() => { });
    }
    const configured = isBudgetMirrorConfigured();
    if (!configured.sentry && !configured.datadog) {
        // Nothing to do — leave initialized false so opting in at runtime
        // (via dynamic env) still works on the next boot.
        return () => { };
    }
    initialized = true;
    const subscription = agent_bus_1.agentBus.subscribe("budget.alert", async (message) => {
        try {
            await forwardBudgetAlertToMirrors(message.payload);
        }
        catch (err) {
            logger_1.logger.warn("budget-mirror: forward threw", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    });
    unsubscribe = () => subscription.unsubscribe();
    logger_1.logger.info("budget-mirror: initialized", configured);
    return unsubscribe;
}
/** Testing helper: forget the one-shot flag and delivery log. */
function __resetBudgetMirrorForTest() {
    initialized = false;
    unsubscribe?.();
    unsubscribe = null;
    deliveryLog.length = 0;
}
