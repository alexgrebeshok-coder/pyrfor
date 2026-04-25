/**
 * Prometheus-format metrics for the Pyrfor runtime.
 *
 * No external libraries — hand-written text exposition format per
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 */
// ─── Label escaping ────────────────────────────────────────────────────────
/**
 * Escape a Prometheus label value per the text exposition spec:
 *   \\ → \\\\   " → \"   \n → \n (literal two chars)
 */
export function escapeLabel(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
}
// ─── Collector ─────────────────────────────────────────────────────────────
export function collectMetrics(deps) {
    var _a;
    const { runtime, health, cron } = deps;
    // Uptime and start timestamp derived from process.uptime()
    const uptimeSeconds = process.uptime();
    const startedAtTs = new Date(Date.now() - uptimeSeconds * 1000).toISOString();
    // Health checks
    const healthMetrics = [];
    const snapshot = health === null || health === void 0 ? void 0 : health.getLastSnapshot();
    if (snapshot === null || snapshot === void 0 ? void 0 : snapshot.checks) {
        for (const [name, check] of Object.entries(snapshot.checks)) {
            healthMetrics.push({
                name,
                ok: check.healthy,
                consecutiveFailures: check.consecutiveFailures,
            });
        }
    }
    // Cron jobs
    const cronMetrics = [];
    const cronStatus = (_a = cron === null || cron === void 0 ? void 0 : cron.getStatus()) !== null && _a !== void 0 ? _a : [];
    for (const job of cronStatus) {
        cronMetrics.push({
            name: job.name,
            runsTotal: job.successCount + job.failureCount,
            failuresTotal: job.failureCount,
        });
    }
    // Active sessions — runtime.sessions is a public SessionManager with .count
    let sessionsActive = null;
    try {
        if ((runtime === null || runtime === void 0 ? void 0 : runtime.sessions) != null) {
            sessionsActive = runtime.sessions.count;
        }
    }
    catch (_b) {
        // Gracefully omit
    }
    return {
        uptimeSeconds,
        startedAtTs,
        health: healthMetrics,
        cronJobs: cronMetrics,
        cronJobsRegistered: cronStatus.length,
        sessionsActive,
        messagesHandledTotal: null, // not currently tracked in RuntimeStats
    };
}
// ─── Formatter ─────────────────────────────────────────────────────────────
/** Emit a single HELP + TYPE header block followed by sample lines. */
function block(name, type, help, lines) {
    if (lines.length === 0)
        return '';
    return [
        `# HELP ${name} ${help}`,
        `# TYPE ${name} ${type}`,
        ...lines,
        '',
    ].join('\n');
}
/**
 * Serialize a MetricsSnapshot to Prometheus text exposition format.
 * Output follows the 0.0.4 spec (https://prometheus.io/docs/instrumenting/exposition_formats/).
 */
export function formatMetrics(snapshot) {
    const parts = [];
    // pyrfor_runtime_uptime_seconds
    parts.push(block('pyrfor_runtime_uptime_seconds', 'gauge', 'Number of seconds since the process started', [`pyrfor_runtime_uptime_seconds ${snapshot.uptimeSeconds}`]));
    // pyrfor_runtime_started{ts="..."}
    parts.push(block('pyrfor_runtime_started', 'gauge', 'Unix start timestamp label; value is always 1', [`pyrfor_runtime_started{ts="${escapeLabel(snapshot.startedAtTs)}"} 1`]));
    // pyrfor_health_check_status{check="..."}
    if (snapshot.health.length > 0) {
        parts.push(block('pyrfor_health_check_status', 'gauge', 'Health check result: 1 = ok, 0 = failing', snapshot.health.map((h) => `pyrfor_health_check_status{check="${escapeLabel(h.name)}"} ${h.ok ? 1 : 0}`)));
        parts.push(block('pyrfor_health_check_consecutive_failures', 'gauge', 'Number of consecutive failures for each health check', snapshot.health.map((h) => `pyrfor_health_check_consecutive_failures{check="${escapeLabel(h.name)}"} ${h.consecutiveFailures}`)));
    }
    // pyrfor_cron_job_runs_total / pyrfor_cron_job_failures_total
    if (snapshot.cronJobs.length > 0) {
        parts.push(block('pyrfor_cron_job_runs_total', 'counter', 'Total number of cron job executions (successful + failed)', snapshot.cronJobs.map((j) => `pyrfor_cron_job_runs_total{job="${escapeLabel(j.name)}"} ${j.runsTotal}`)));
        parts.push(block('pyrfor_cron_job_failures_total', 'counter', 'Total number of failed cron job executions', snapshot.cronJobs.map((j) => `pyrfor_cron_job_failures_total{job="${escapeLabel(j.name)}"} ${j.failuresTotal}`)));
    }
    // pyrfor_cron_jobs_registered
    parts.push(block('pyrfor_cron_jobs_registered', 'gauge', 'Number of cron jobs currently registered', [`pyrfor_cron_jobs_registered ${snapshot.cronJobsRegistered}`]));
    // pyrfor_sessions_active
    if (snapshot.sessionsActive !== null) {
        parts.push(block('pyrfor_sessions_active', 'gauge', 'Number of currently active sessions', [`pyrfor_sessions_active ${snapshot.sessionsActive}`]));
    }
    // pyrfor_messages_handled_total — omit when null
    if (snapshot.messagesHandledTotal !== null) {
        parts.push(block('pyrfor_messages_handled_total', 'counter', 'Total number of messages handled by the runtime', [`pyrfor_messages_handled_total ${snapshot.messagesHandledTotal}`]));
    }
    // Join non-empty blocks; append trailing newline required by spec
    return parts.filter(Boolean).join('\n') + '\n';
}
