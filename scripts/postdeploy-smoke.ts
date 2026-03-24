#!/usr/bin/env tsx

import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

interface HealthResponse {
  status?: HealthStatus;
  checks?: {
    database?: {
      status?: string;
      message?: string;
    };
    ai?: {
      status?: string;
      message?: string;
    };
  };
}

interface SmokeLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface PostdeploySmokeOptions {
  baseUrl: string;
  attempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  logger?: SmokeLogger;
}

const DEFAULT_ATTEMPTS = 6;
const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const PUBLIC_HTML_ROUTES = ["/login", "/release"] as const;
const PROTECTED_ROUTE = "/projects";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultSchemeForHost(candidate: string): "http://" | "https://" {
  const hostname = candidate.split("/")[0]?.toLowerCase() ?? "";
  if (
    hostname.startsWith("localhost") ||
    hostname.startsWith("127.0.0.1") ||
    hostname.startsWith("0.0.0.0") ||
    hostname.startsWith("[::1]")
  ) {
    return "http://";
  }

  return "https://";
}

export function normalizeBaseUrl(candidate: string): string {
  const trimmed = candidate.trim();

  if (!trimmed) {
    throw new Error("Post-deploy smoke requires a non-empty base URL.");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith("//")
      ? `https:${trimmed}`
      : `${defaultSchemeForHost(trimmed)}${trimmed}`;

  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol for smoke target: ${url.protocol}`);
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

export function resolveBaseUrl(input?: string, env: NodeJS.ProcessEnv = process.env): string {
  const candidate =
    input ??
    env.BASE_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    env.NEXTAUTH_URL ??
    env.VERCEL_URL;

  if (!candidate) {
    throw new Error(
      "No post-deploy smoke target provided. Pass the base URL as the first argument or set BASE_URL.",
    );
  }

  return normalizeBaseUrl(candidate);
}

function summarizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 160);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function withRetries<T>(
  label: string,
  attempts: number,
  delayMs: number,
  logger: SmokeLogger,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(`Unexpected smoke error: ${String(error)}`);
      lastError = normalizedError;

      if (attempt === attempts) {
        break;
      }

      logger.warn(
        `[postdeploy-smoke] ${label} failed on attempt ${attempt}/${attempts}: ${normalizedError.message}. Retrying in ${delayMs}ms...`,
      );
      await delay(delayMs);
    }
  }

  throw lastError ?? new Error(`[postdeploy-smoke] ${label} failed for an unknown reason.`);
}

async function assertHealthyDeployment(
  baseUrl: string,
  timeoutMs: number,
): Promise<string | null> {
  const healthUrl = new URL("/api/health", baseUrl).toString();
  const response = await fetchWithTimeout(
    healthUrl,
    {
      headers: {
        accept: "application/json",
      },
      redirect: "follow",
    },
    timeoutMs,
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Health endpoint returned ${response.status}${body ? `: ${summarizeBody(body)}` : ""}`,
    );
  }

  let payload: HealthResponse;
  try {
    payload = JSON.parse(body) as HealthResponse;
  } catch {
    throw new Error(`Health endpoint returned invalid JSON: ${summarizeBody(body)}`);
  }

  if (!payload.status) {
    throw new Error("Health endpoint response is missing the overall status field.");
  }

  if (payload.status === "unhealthy") {
    throw new Error("Health endpoint reported an unhealthy deployment.");
  }

  if (payload.checks?.database?.status !== "connected") {
    const message = payload.checks?.database?.message
      ? ` (${payload.checks.database.message})`
      : "";
    throw new Error(`Database readiness check is not connected${message}.`);
  }

  if (payload.status === "degraded") {
    const detail =
      payload.checks?.ai?.message ??
      payload.checks?.ai?.status ??
      "non-critical checks reported degradation";
    return `Health endpoint is degraded: ${detail}`;
  }

  return null;
}

async function assertPublicHtmlRoute(
  baseUrl: string,
  route: string,
  timeoutMs: number,
): Promise<void> {
  const target = new URL(route, baseUrl).toString();
  const response = await fetchWithTimeout(
    target,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    },
    timeoutMs,
  );

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    throw new Error(`Expected 200 for ${route}, received ${response.status}.`);
  }

  if (!contentType.includes("text/html")) {
    throw new Error(`Expected HTML from ${route}, received ${contentType || "unknown content type"}.`);
  }

  if (!body.toLowerCase().includes("<html")) {
    throw new Error(`Expected an HTML document from ${route}.`);
  }
}

async function assertProtectedRouteRedirect(
  baseUrl: string,
  route: string,
  timeoutMs: number,
): Promise<void> {
  const target = new URL(route, baseUrl).toString();
  const response = await fetchWithTimeout(
    target,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    },
    timeoutMs,
  );

  const location = response.headers.get("location") ?? "";

  if (!REDIRECT_STATUSES.has(response.status)) {
    throw new Error(
      `Expected ${route} to redirect to login, received status ${response.status}.`,
    );
  }

  if (!location.includes("/login")) {
    throw new Error(`Expected ${route} redirect location to point at /login, received "${location}".`);
  }
}

function buildLogger(logger?: SmokeLogger): SmokeLogger {
  return (
    logger ?? {
      info: (message) => console.log(message),
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
    }
  );
}

export async function runPostdeploySmoke(options: PostdeploySmokeOptions): Promise<{ warnings: string[] }> {
  const logger = buildLogger(options.logger);
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const warnings: string[] = [];

  logger.info(`[postdeploy-smoke] Target: ${baseUrl}`);

  const healthWarning = await withRetries("health endpoint", attempts, delayMs, logger, () =>
    assertHealthyDeployment(baseUrl, timeoutMs),
  );

  if (healthWarning) {
    warnings.push(healthWarning);
    logger.warn(`[postdeploy-smoke] ${healthWarning}`);
  } else {
    logger.info("[postdeploy-smoke] Health endpoint is healthy.");
  }

  for (const route of PUBLIC_HTML_ROUTES) {
    await withRetries(`public route ${route}`, attempts, delayMs, logger, () =>
      assertPublicHtmlRoute(baseUrl, route, timeoutMs),
    );
    logger.info(`[postdeploy-smoke] Public route OK: ${route}`);
  }

  await withRetries(`protected route ${PROTECTED_ROUTE}`, attempts, delayMs, logger, () =>
    assertProtectedRouteRedirect(baseUrl, PROTECTED_ROUTE, timeoutMs),
  );
  logger.info(`[postdeploy-smoke] Protected route redirects to login: ${PROTECTED_ROUTE}`);

  logger.info("[postdeploy-smoke] Post-deploy smoke checks passed.");

  return { warnings };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const baseUrl = resolveBaseUrl(argv[0]);
  const attempts = readPositiveInteger(process.env.POSTDEPLOY_SMOKE_ATTEMPTS, DEFAULT_ATTEMPTS);
  const delayMs = readPositiveInteger(process.env.POSTDEPLOY_SMOKE_DELAY_MS, DEFAULT_DELAY_MS);
  const timeoutMs = readPositiveInteger(process.env.POSTDEPLOY_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  await runPostdeploySmoke({
    baseUrl,
    attempts,
    delayMs,
    timeoutMs,
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[postdeploy-smoke] FAILED: ${message}`);
    process.exit(1);
  });
}
