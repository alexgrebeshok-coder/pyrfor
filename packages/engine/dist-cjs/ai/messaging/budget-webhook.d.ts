/**
 * Budget-alert webhook subscriber.
 *
 * Subscribes to `budget.alert` events on the agent bus and forwards them
 * to a Slack-compatible incoming webhook when `BUDGET_ALERT_WEBHOOK_URL`
 * is configured. The payload shape is compatible with Slack, Mattermost,
 * and Discord's Slack-compat endpoint (`.../slack`).
 *
 * Called once per Node process from `instrumentation.ts#register`. Safe
 * to call multiple times — the subscription is de-duplicated via a
 * module-level flag.
 */
import "server-only";
import type { BudgetAlertPayload } from '../cost-tracker';
export type WebhookFormat = "slack" | "telegram" | "teams";
export interface BudgetWebhookDelivery {
    url: string;
    format: WebhookFormat;
    status: number;
    ok: boolean;
    attempts: number;
    error?: string;
}
export declare function getRecentBudgetWebhookDeliveries(limit?: number): BudgetWebhookDelivery[];
/**
 * Infer the webhook format from the URL host. Can be forced via
 * `BUDGET_ALERT_WEBHOOK_FORMAT={slack|telegram|teams}`.
 */
export declare function detectWebhookFormat(url: string): WebhookFormat;
/**
 * Deliver a single budget alert to the configured webhook. The exact
 * payload shape depends on the target host (Slack / Telegram / Teams);
 * see `detectWebhookFormat`. Exported so tests can exercise the HTTP
 * path without going through the agent bus.
 */
export declare function deliverBudgetAlertToWebhook(payload: BudgetAlertPayload, overrideUrl?: string): Promise<BudgetWebhookDelivery>;
/**
 * Subscribe to budget.alert events and deliver each one to the configured
 * Slack-compatible webhook. Idempotent.
 */
export declare function initBudgetAlertWebhook(): void;
/**
 * Internal helper — clears subscription state so tests can re-initialise.
 * @internal
 */
export declare function __resetBudgetWebhookForTests(): void;
//# sourceMappingURL=budget-webhook.d.ts.map