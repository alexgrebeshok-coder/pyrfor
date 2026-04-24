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
import "server-only";
import type { BudgetAlertPayload } from '../cost-tracker';
export type BudgetMirrorTarget = "sentry" | "datadog";
export interface BudgetMirrorDelivery {
    target: BudgetMirrorTarget;
    ok: boolean;
    status: number;
    attempts: number;
    error?: string;
    workspaceId: string;
    severity: BudgetAlertPayload["severity"];
}
export declare function getRecentBudgetMirrorDeliveries(limit?: number): BudgetMirrorDelivery[];
export declare function isBudgetMirrorConfigured(): {
    sentry: boolean;
    datadog: boolean;
};
interface ParsedDsn {
    endpoint: string;
    publicKey: string;
    projectId: string;
}
export declare function parseSentryDsn(dsn: string): ParsedDsn | null;
/**
 * Forward a single `budget.alert` payload to every configured mirror
 * target. Exposed separately so tests (and future programmatic
 * callers) can invoke the mirror without going through the bus.
 */
export declare function forwardBudgetAlertToMirrors(alert: BudgetAlertPayload): Promise<BudgetMirrorDelivery[]>;
/**
 * Subscribe to `budget.alert` events on the agent bus. Idempotent —
 * calling twice is a no-op. Returns an unsubscribe handle for tests.
 */
export declare function initBudgetAlertMirror(): () => void;
/** Testing helper: forget the one-shot flag and delivery log. */
export declare function __resetBudgetMirrorForTest(): void;
export {};
//# sourceMappingURL=budget-mirror.d.ts.map