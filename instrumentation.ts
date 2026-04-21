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

    // Optional Sentry / Datadog mirror for budget.alert so operators
    // aren't solely dependent on the primary webhook. No-op unless
    // BUDGET_ALERT_SENTRY_DSN or BUDGET_ALERT_DATADOG_API_KEY is set.
    try {
      const { initBudgetAlertMirror } = await import(
        "./lib/ai/messaging/budget-mirror"
      );
      initBudgetAlertMirror();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[instrumentation] budget mirror init failed", err);
    }

    // Optional shared rate-limit store (Upstash REST). When
    // UPSTASH_REDIS_REST_URL / _TOKEN are set, swap the default
    // in-process limiter for one backed by Redis so bursts are
    // enforced across all Node workers. Best-effort — limiter keeps
    // working in-process if the adapter can't be loaded.
    try {
      const [{ configureRateLimiterStore }, { createRateLimitStoreFromEnv }] =
        await Promise.all([
          import("./lib/agents/rate-limiter"),
          import("./lib/agents/rate-limit-stores"),
        ]);
      const store = createRateLimitStoreFromEnv();
      if (store) configureRateLimiterStore(store);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[instrumentation] rate limiter store init failed", err);
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
