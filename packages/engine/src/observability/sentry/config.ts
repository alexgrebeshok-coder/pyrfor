import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

const DEFAULT_SAMPLE_RATE = 0.05;

function parseSampleRate(value?: string): number {
  if (!value) return DEFAULT_SAMPLE_RATE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

const release =
  process.env.SENTRY_RELEASE ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA;

const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

const commonOptions = {
  release,
  environment,
  tracesSampleRate:
    parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE ?? process.env.SENTRY_TRACE_RATE),
} satisfies BrowserOptions & NodeOptions;

export function getClientSentryOptions(): BrowserOptions {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    ...commonOptions,
    dsn,
    enabled: Boolean(dsn),
  };
}

export function getServerSentryOptions(): NodeOptions {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    ...commonOptions,
    dsn,
    enabled: Boolean(dsn),
  };
}
