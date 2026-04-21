import * as Sentry from "@sentry/nextjs";

import { getServerSentryOptions } from "./lib/sentry/config";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(getServerSentryOptions());

    // Subscribe the Slack-compatible budget alert webhook to agent-bus
    // `budget.alert` events. No-op when BUDGET_ALERT_WEBHOOK_URL is unset.
    try {
      const { initBudgetAlertWebhook } = await import(
        "./lib/ai/messaging/budget-webhook"
      );
      initBudgetAlertWebhook();
    } catch (err) {
      // Best-effort — don't block process startup on bus wiring.
      // eslint-disable-next-line no-console
      console.warn("[instrumentation] budget webhook init failed", err);
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
