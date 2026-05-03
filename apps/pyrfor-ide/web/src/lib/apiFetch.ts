import { getBearerToken } from './authStorage';

// ─── Port discovery (shared, no circular dep) ────────────────────────────────

const DEFAULT_PORT = 18790;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let cachedPort: number | null = null;

export function resetDaemonPortCache(): void {
  cachedPort = null;
}

export async function getDaemonPort(): Promise<number> {
  if (cachedPort !== null) return cachedPort;

  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const port = await invoke<number>('get_daemon_port');
      cachedPort = port;
      return port;
    } catch (error) {
      throw new Error(`Pyrfor bundled sidecar port unavailable: ${String(error)}`);
    }
  }

  const envPort = (import.meta as any).env?.VITE_PYRFOR_PORT;
  cachedPort = envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
  return cachedPort;
}

export function getApiBase(): string {
  if (cachedPort === null) {
    if (isTauri()) {
      throw new Error('Pyrfor bundled sidecar port is not available yet');
    }
    const envPort = (import.meta as any).env?.VITE_PYRFOR_PORT;
    cachedPort = envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
  }
  return `http://localhost:${cachedPort}`;
}

// ─── Retry-capable fetch ──────────────────────────────────────────────────────

export interface RetryOpts {
  /** Max retry attempts after the first failure (default: 3). */
  retries?: number;
  /** Base delay in ms before exponential backoff (default: 300). */
  baseDelayMs?: number;
  /** Upper bound on delay (default: 3000). */
  maxDelayMs?: number;
  /** Override which errors trigger a retry. */
  retryOn?: (err: unknown, attempt: number) => boolean;
}

/** Shared event bus for retry/recovery notifications. */
export const apiEvents = new EventTarget();

const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number, base: number, max: number): number {
  return Math.min(max, base * Math.pow(2, attempt));
}

/**
 * Fetch with exponential-backoff retry on transient/network errors.
 *
 * - Network errors (TypeError) and HTTP 502/503/504/408 are retried.
 * - 429 is retried respecting `Retry-After` if present.
 * - 4xx other than 408/429 are NOT retried (returned as-is).
 * - Emits 'retry' CustomEvent on every failure, 'recovered' on success after
 *   a failure — so consumers (useDaemonHealth) get immediate feedback.
 */
export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit,
  opts?: RetryOpts
): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  const maxDelayMs = opts?.maxDelayMs ?? 3000;
  const customRetryOn = opts?.retryOn;

  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : (input as Request).url;

  let hadFailure = false;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);

      if (RETRYABLE_STATUS.has(res.status)) {
        hadFailure = true;
        const err = new Error(`HTTP ${res.status}`);
        // Always emit – lets useDaemonHealth react even when retries=0
        apiEvents.dispatchEvent(
          new CustomEvent('retry', { detail: { url, attempt, error: err } })
        );

        if (attempt < retries) {
          let waitMs: number;
          if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After');
            waitMs = retryAfter
              ? parseFloat(retryAfter) * 1000
              : backoff(attempt, baseDelayMs, maxDelayMs);
          } else {
            waitMs = backoff(attempt, baseDelayMs, maxDelayMs);
          }
          lastError = err;
          await sleep(waitMs);
          continue;
        }

        // Retries exhausted — return the bad response so callers can inspect it
        return res;
      }

      // Successful (non-retryable) response
      if (hadFailure) {
        apiEvents.dispatchEvent(new CustomEvent('recovered', { detail: { url } }));
      }
      return res;
    } catch (err) {
      lastError = err;
      hadFailure = true;

      const isRetryable = customRetryOn
        ? customRetryOn(err, attempt)
        : err instanceof TypeError;

      // Emit on every failure so downstream can react immediately
      apiEvents.dispatchEvent(
        new CustomEvent('retry', { detail: { url, attempt, error: err } })
      );

      if (!isRetryable || attempt >= retries) {
        throw err;
      }

      await sleep(backoff(attempt, baseDelayMs, maxDelayMs));
    }
  }

  throw lastError;
}

export async function getStoredBearerToken(): Promise<string> {
  return getBearerToken();
}

/**
 * Like `apiFetch` but prepends `http://localhost:{daemonPort}` and injects the
 * stored `pyrfor-token` as a Bearer header.
 */
export async function daemonFetch(
  path: string,
  init?: RequestInit,
  opts?: RetryOpts
): Promise<Response> {
  const port = await getDaemonPort();
  const url = `http://localhost:${port}${path}`;

  const token = await getStoredBearerToken();

  const passedHeaders = ((init?.headers ?? {}) as Record<string, string>);
  const headers: Record<string, string> = { ...passedHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    return await apiFetch(url, { ...init, headers }, opts);
  } catch (err) {
    if (err instanceof TypeError) resetDaemonPortCache();
    throw err;
  }
}
