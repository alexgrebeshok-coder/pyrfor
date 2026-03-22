import * as Sentry from "@sentry/nextjs";

import { getServerSentryOptions } from "./lib/sentry/config";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(getServerSentryOptions());
  }
}

export const onRequestError = Sentry.captureRequestError;
