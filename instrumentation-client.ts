import * as Sentry from "@sentry/nextjs";

import { getClientSentryOptions } from "./lib/sentry/config";

Sentry.init(getClientSentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
