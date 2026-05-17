import { getBearerToken } from './authStorage';

// ─── Port discovery (shared, no circular dep) ────────────────────────────────

export const DEFAULT_DAEMON_PORT = 18790;
const DEFAULT_PORT = DEFAULT_DAEMON_PORT;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let cachedPort: number | null = null;

export function resetDaemonPortCache(): void {
  cachedPort = null;
}

/** Seed port cache when health probe succeeds outside the Tauri sidecar registry. */
export function seedDaemonPort(port: number): void {
  cachedPort = port;
}

/** Fetch with timeout; works in older WebKit without AbortSignal.timeout. */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function portsForHealthProbe(): number[] {
  const ports: number[] = [];
  if (cachedPort !== null && !ports.includes(cachedPort)) ports.push(cachedPort);
  if (!ports.includes(DEFAULT_DAEMON_PORT)) ports.push(DEFAULT_DAEMON_PORT);
  return ports;
}

/** Best-effort Tauri port read without blocking on the 5s get_daemon_port poll. */
async function tryQuickTauriPort(): Promise<number | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const port = await Promise.race([
      invoke<number>('get_daemon_port'),
      sleep(400).then(() => Promise.reject(new Error('timeout'))),
    ]);
    return typeof port === 'number' && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export async function getDaemonPort(): Promise<number> {
  if (cachedPort !== null) return cachedPort;

  if (isTauri()) {
    const quick = await tryQuickTauriPort();
    if (quick !== null) {
      cachedPort = quick;
      return quick;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const port = await invoke<number>('get_daemon_port');
      cachedPort = port;
      return port;
    } catch (error) {
      if (await probeDaemonHealth()) {
        return cachedPort!;
      }
      throw new Error(`Pyrfor bundled sidecar port unavailable: ${String(error)}`);
    }
  }

  const envPort = (import.meta as any).env?.VITE_PYRFOR_PORT;
  cachedPort = envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
  return cachedPort;
}

/** Tauri WebView fetch to localhost often fails (status null); use native invoke only. */
async function probeDaemonHealthTauri(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ ok: boolean; port?: number | null }>('probe_daemon_health');
    if (result.ok) {
      const port =
        typeof result.port === 'number' && result.port > 0 ? result.port : DEFAULT_DAEMON_PORT;
      seedDaemonPort(port);
      return true;
    }
  } catch {
    /* invoke unavailable */
  }
  return false;
}

/** Probe daemon /health on sidecar port or default 18790. */
export async function probeDaemonHealth(): Promise<boolean> {
  if (isTauri()) {
    return probeDaemonHealthTauri();
  }

  const ports = portsForHealthProbe();
  const quick = await tryQuickTauriPort();
  if (quick !== null && !ports.includes(quick)) ports.unshift(quick);

  const hosts = ['127.0.0.1', 'localhost'] as const;
  for (const port of ports) {
    for (const host of hosts) {
      const res = await fetchWithTimeout(`http://${host}:${port}/health`, 3000);
      if (res && (res.ok || res.status < 600)) {
        seedDaemonPort(port);
        return true;
      }
    }
  }
  return false;
}

/** Wait for daemon readiness (startup can take 30–90s). */
export async function probeDaemonHealthWithRetry(
  maxWaitMs = 120_000,
  intervalMs = 750,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    const ok = isTauri()
      ? await probeDaemonHealthTauri()
      : await probeDaemonHealth();
    if (ok) return true;
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export function getApiBase(): string {
  if (cachedPort === null) {
    const envPort = (import.meta as any).env?.VITE_PYRFOR_PORT;
    cachedPort = envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
  }
  return `http://127.0.0.1:${cachedPort}`;
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

function headersFromInit(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init?.headers) return out;
  if (init.headers instanceof Headers) {
    init.headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  Object.assign(out, init.headers as Record<string, string>);
  return out;
}

/** Tauri: proxy daemon HTTP via Rust (WebView fetch to localhost is unreliable). */
async function daemonFetchViaInvoke(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const { invoke } = await import('@tauri-apps/api/core');
  let body: string | undefined;
  if (typeof init?.body === 'string') {
    body = init.body;
  } else if (init?.body != null && !(init.body instanceof FormData)) {
    body = await new Response(init.body).text();
  }
  const result = await invoke<{ status: number; body: string }>('daemon_http', {
    path,
    method: init?.method ?? 'GET',
    body,
    headers: headersFromInit(init),
  });
  return new Response(result.body, { status: result.status });
}

/**
 * Like `apiFetch` but prepends `http://127.0.0.1:{daemonPort}` and injects the
 * configured gateway token as a Bearer header.
 */
export async function daemonFetch(
  path: string,
  init?: RequestInit,
  opts?: RetryOpts
): Promise<Response> {
  const port = await getDaemonPort();
  const url = `http://127.0.0.1:${port}${path}`;

  const token = await getStoredBearerToken();

  const passedHeaders = headersFromInit(init);
  const headers: Record<string, string> = { ...passedHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  if (isTauri() && !(init?.body instanceof FormData)) {
    try {
      return await daemonFetchViaInvoke(path, { ...init, headers });
    } catch {
      /* fall through to WebView fetch */
    }
  }

  try {
    return await apiFetch(url, { ...init, headers }, opts);
  } catch (err) {
    if (err instanceof TypeError) resetDaemonPortCache();
    throw err;
  }
}
