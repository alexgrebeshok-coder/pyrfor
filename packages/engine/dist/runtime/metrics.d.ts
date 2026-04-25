/**
 * Prometheus-format metrics for the Pyrfor runtime.
 *
 * No external libraries — hand-written text exposition format per
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 */
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';
export interface HealthCheckMetrics {
    name: string;
    /** true = healthy, false = failing */
    ok: boolean;
    consecutiveFailures: number;
}
export interface CronJobMetrics {
    name: string;
    /** successCount + failureCount */
    runsTotal: number;
    failuresTotal: number;
}
export interface MetricsSnapshot {
    uptimeSeconds: number;
    /** ISO timestamp representing when the process approximately started */
    startedAtTs: string;
    health: HealthCheckMetrics[];
    cronJobs: CronJobMetrics[];
    cronJobsRegistered: number;
    /** null when runtime.sessions is not accessible */
    sessionsActive: number | null;
    /** null when not tracked */
    messagesHandledTotal: number | null;
}
export interface CollectMetricsDeps {
    runtime?: PyrforRuntime;
    health?: HealthMonitor;
    cron?: CronService;
}
/**
 * Escape a Prometheus label value per the text exposition spec:
 *   \\ → \\\\   " → \"   \n → \n (literal two chars)
 */
export declare function escapeLabel(value: string): string;
export declare function collectMetrics(deps: CollectMetricsDeps): MetricsSnapshot;
/**
 * Serialize a MetricsSnapshot to Prometheus text exposition format.
 * Output follows the 0.0.4 spec (https://prometheus.io/docs/instrumenting/exposition_formats/).
 */
export declare function formatMetrics(snapshot: MetricsSnapshot): string;
//# sourceMappingURL=metrics.d.ts.map