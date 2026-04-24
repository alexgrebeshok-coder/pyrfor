// ============================================================
// http-client.ts — Pyrfor runtime HTTP client
// ============================================================

// ── Local types ──────────────────────────────────────────────

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  responseType?: 'json' | 'text' | 'buffer' | 'stream';
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  durationMs: number;
  attempts: number;
}

export interface HttpClientStats {
  requests: number;
  errors: number;
  retries: number;
  circuitOpen: boolean;
  perStatus: Record<number, number>;
}

export interface HttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  defaultTimeoutMs?: number;
  defaultRetries?: number;
  retryStatusCodes?: number[];
  retryBackoff?: (attempt: number) => number;
  circuit?: { failureThreshold: number; resetAfterMs: number };
  fetchFn?: typeof fetch;
  clock?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  rng?: () => number;
  onRequest?: (req: HttpRequest) => void | Promise<void>;
  onResponse?: (res: HttpResponse, req: HttpRequest) => void | Promise<void>;
  onError?: (err: Error, req: HttpRequest) => void | Promise<void>;
}

export interface HttpClient {
  request<T>(req: HttpRequest): Promise<HttpResponse<T>>;
  get<T>(url: string, opts?: Omit<HttpRequest, 'url' | 'method'>): Promise<HttpResponse<T>>;
  post<T>(url: string, body?: unknown, opts?: Omit<HttpRequest, 'url' | 'method' | 'body'>): Promise<HttpResponse<T>>;
  put<T>(url: string, body?: unknown, opts?: Omit<HttpRequest, 'url' | 'method' | 'body'>): Promise<HttpResponse<T>>;
  patch<T>(url: string, body?: unknown, opts?: Omit<HttpRequest, 'url' | 'method' | 'body'>): Promise<HttpResponse<T>>;
  delete<T>(url: string, opts?: Omit<HttpRequest, 'url' | 'method'>): Promise<HttpResponse<T>>;
  getStats(): HttpClientStats;
  resetCircuit(): void;
}

// ── Errors ───────────────────────────────────────────────────

export class HttpError extends Error {
  readonly code: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;

  constructor(
    message: string,
    status: number,
    statusText: string,
    headers: Record<string, string>,
    body: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.code = 'HTTP_ERROR';
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.body = body;
  }
}

export class HttpTimeoutError extends Error {
  readonly code = 'HTTP_TIMEOUT';
  constructor(url: string) {
    super(`Request timed out: ${url}`);
    this.name = 'HttpTimeoutError';
  }
}

export class HttpCircuitOpenError extends Error {
  readonly code = 'HTTP_CIRCUIT_OPEN';
  constructor() {
    super('Circuit breaker is open — request rejected');
    this.name = 'HttpCircuitOpenError';
  }
}

// ── Helpers ──────────────────────────────────────────────────

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => { out[k] = v; });
  return out;
}

function buildUrl(base: string | undefined, url: string, query?: Record<string, string | number | boolean | undefined>): string {
  let resolved = base && !url.startsWith('http://') && !url.startsWith('https://')
    ? base.replace(/\/$/, '') + '/' + url.replace(/^\//, '')
    : url;

  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) resolved += (resolved.includes('?') ? '&' : '?') + qs;
  }

  return resolved;
}

function parseRetryAfter(header: string, clock: () => number): number {
  // HTTP spec: Retry-After is either a decimal integer (seconds) or an HTTP-date.
  // Check numeric first to avoid Date.parse misinterpreting short strings like "2".
  if (/^\s*\d+(\.\d+)?\s*$/.test(header)) {
    return parseFloat(header) * 1000;
  }
  const asDate = Date.parse(header);
  if (!isNaN(asDate)) {
    return Math.max(0, asDate - clock());
  }
  return 0;
}

async function decodeBody(res: Response, responseType: HttpRequest['responseType']): Promise<unknown> {
  switch (responseType) {
    case 'text':   return res.text();
    case 'buffer': return Buffer.from(await res.arrayBuffer());
    case 'stream': return res.body;
    case 'json':
    default: {
      const text = await res.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch { return text; }
    }
  }
}

// ── Factory ──────────────────────────────────────────────────

export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const {
    baseUrl,
    defaultHeaders = {},
    defaultTimeoutMs = 30_000,
    defaultRetries = 0,
    retryStatusCodes = [408, 429, 500, 502, 503, 504],
    circuit,
    onRequest,
    onResponse,
    onError,
  } = opts;

  const fetchFn    = opts.fetchFn    ?? globalThis.fetch;
  const clock      = opts.clock      ?? (() => Date.now());
  const setTimer   = opts.setTimer   ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const rng        = opts.rng        ?? Math.random;

  const retryBackoff = opts.retryBackoff ?? ((attempt: number) => {
    const base = 100 * Math.pow(2, attempt);
    return base + rng() * base;
  });

  // stats
  const stats: HttpClientStats = {
    requests: 0,
    errors: 0,
    retries: 0,
    circuitOpen: false,
    perStatus: {},
  };

  // circuit breaker state
  let cbFailures = 0;
  let cbOpenAt: number | null = null;
  let cbTimerHandle: unknown = null;
  let cbHalfOpen = false;

  function openCircuit() {
    stats.circuitOpen = true;
    cbOpenAt = clock();
    cbHalfOpen = false;
    if (cbTimerHandle !== null) clearTimer(cbTimerHandle);
    if (circuit) {
      cbTimerHandle = setTimer(() => {
        cbHalfOpen = true;
      }, circuit.resetAfterMs);
    }
  }

  function closeCircuit() {
    stats.circuitOpen = false;
    cbFailures = 0;
    cbOpenAt = null;
    cbHalfOpen = false;
    if (cbTimerHandle !== null) { clearTimer(cbTimerHandle); cbTimerHandle = null; }
  }

  function recordCbFailure() {
    if (!circuit) return;
    cbFailures++;
    if (cbFailures >= circuit.failureThreshold) openCircuit();
  }

  function recordCbSuccess() {
    if (!circuit) return;
    closeCircuit();
  }

  async function request<T>(req: HttpRequest): Promise<HttpResponse<T>> {
    // circuit breaker check
    if (stats.circuitOpen && !cbHalfOpen) {
      throw new HttpCircuitOpenError();
    }

    const maxAttempts = (req.retries ?? defaultRetries) + 1;
    const timeoutMs   = req.timeoutMs ?? defaultTimeoutMs;
    const responseType = req.responseType ?? 'json';
    const method = (req.method ?? 'GET').toUpperCase();

    const url = buildUrl(baseUrl, req.url, req.query);

    // merge headers
    const mergedHeaders: Record<string, string> = { ...defaultHeaders, ...(req.headers ?? {}) };

    // auto-JSON body
    let rawBody: BodyInit | undefined;
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        if (!mergedHeaders['content-type'] && !mergedHeaders['Content-Type']) {
          mergedHeaders['content-type'] = 'application/json';
        }
        rawBody = JSON.stringify(req.body);
      } else {
        rawBody = req.body as BodyInit;
      }
    }

    const normalizedReq: HttpRequest = { ...req, url, method: method as HttpRequest['method'] };

    if (onRequest) await onRequest(normalizedReq);

    stats.requests++;

    let lastError: Error | null = null;
    let attempts = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        stats.retries++;
        let delay = 0;
        if (lastError instanceof HttpError && (lastError as HttpError & { retryAfterMs?: number }).retryAfterMs) {
          delay = (lastError as HttpError & { retryAfterMs?: number }).retryAfterMs!;
        } else {
          delay = retryBackoff(attempt - 1);
        }
        if (delay > 0) {
          await new Promise<void>((resolve) => setTimer(resolve, delay));
        }
      }

      attempts++;

      // timeout + user signal combo
      const ac = new AbortController();
      let timerHandle: unknown = null;
      let timedOut = false;

      const cleanup = () => {
        if (timerHandle !== null) clearTimer(timerHandle);
      };

      if (req.signal) {
        if (req.signal.aborted) {
          ac.abort(req.signal.reason);
        } else {
          req.signal.addEventListener('abort', () => ac.abort(req.signal!.reason), { once: true });
        }
      }

      timerHandle = setTimer(() => {
        timedOut = true;
        ac.abort('timeout');
      }, timeoutMs);

      // Race fetch against an abort rejector so mocked fetch (which may not
      // honour AbortSignal) is still cancelled on timeout or user abort.
      const abortRejector = new Promise<never>((_, reject) => {
        const onAbort = () => {
          if (timedOut) {
            reject(new HttpTimeoutError(url));
          } else {
            const reason = ac.signal.reason;
            reject(
              reason instanceof Error
                ? reason
                : Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
            );
          }
        };
        if (ac.signal.aborted) { onAbort(); return; }
        ac.signal.addEventListener('abort', onAbort, { once: true });
      });

      const startTime = clock();
      let rawRes: Response;
      try {
        rawRes = await Promise.race([
          fetchFn(url, {
            method,
            headers: mergedHeaders as HeadersInit,
            body: rawBody,
            signal: ac.signal,
          }),
          abortRejector,
        ]);
      } catch (err) {
        cleanup();
        const error = err as Error;

        if (error instanceof HttpTimeoutError) {
          stats.errors++;
          if (onError) await onError(error, normalizedReq);
          throw error;
        }

        // user signal aborted (not our timeout)
        if (req.signal?.aborted && !timedOut) {
          stats.errors++;
          if (onError) await onError(error, normalizedReq);
          throw error;
        }

        // network error — retryable
        lastError = error;
        if (attempt < maxAttempts - 1) continue;

        stats.errors++;
        recordCbFailure();
        if (onError) await onError(error, normalizedReq);
        throw error;
      }

      cleanup();
      const durationMs = clock() - startTime;

      // record status
      stats.perStatus[rawRes.status] = (stats.perStatus[rawRes.status] ?? 0) + 1;

      const responseHeaders = headersToRecord(rawRes.headers);

      // check retry
      const shouldRetry = attempt < maxAttempts - 1 && retryStatusCodes.includes(rawRes.status);
      if (shouldRetry) {
        let retryAfterMs: number | undefined;
        const retryAfterHeader = rawRes.headers.get('retry-after');
        if (retryAfterHeader) {
          retryAfterMs = parseRetryAfter(retryAfterHeader, clock);
        }
        lastError = Object.assign(
          new HttpError(`HTTP ${rawRes.status}`, rawRes.status, rawRes.statusText, responseHeaders, null),
          { retryAfterMs }
        ) as HttpError & { retryAfterMs?: number };
        recordCbFailure();
        continue;
      }

      // 4xx / non-retried errors
      if (rawRes.status >= 400) {
        let errBody: unknown;
        try {
          const errText = await rawRes.text();
          try { errBody = errText ? JSON.parse(errText) : errText; } catch { errBody = errText; }
        } catch { errBody = null; }

        const httpErr = new HttpError(
          `HTTP ${rawRes.status} ${rawRes.statusText}`,
          rawRes.status,
          rawRes.statusText,
          responseHeaders,
          errBody,
        );

        stats.errors++;
        recordCbFailure();
        if (onError) await onError(httpErr, normalizedReq);
        throw httpErr;
      }

      // success — decode body (if decoding fails, treat as retryable/fatal)
      let data: T;
      try {
        data = await decodeBody(rawRes, responseType) as T;
      } catch (decodeErr) {
        cleanup();
        const error = decodeErr as Error;
        lastError = error;
        if (attempt < maxAttempts - 1) continue;
        stats.errors++;
        recordCbFailure();
        if (onError) await onError(error, normalizedReq);
        throw error;
      }

      const response: HttpResponse<T> = {
        status: rawRes.status,
        statusText: rawRes.statusText,
        headers: responseHeaders,
        data,
        durationMs,
        attempts,
      };

      recordCbSuccess();
      if (onResponse) await onResponse(response, normalizedReq);
      return response;
    }

    // exhausted retries
    stats.errors++;
    recordCbFailure();
    if (onError && lastError) await onError(lastError, normalizedReq);
    throw lastError!;
  }

  return {
    request,

    get<T>(url: string, opts?: Omit<HttpRequest, 'url' | 'method'>) {
      return request<T>({ ...opts, url, method: 'GET' });
    },

    post<T>(url: string, body?: unknown, opts?: Omit<HttpRequest, 'url' | 'method' | 'body'>) {
      return request<T>({ ...opts, url, method: 'POST', body });
    },

    put<T>(url: string, body?: unknown, opts?: Omit<HttpRequest, 'url' | 'method' | 'body'>) {
      return request<T>({ ...opts, url, method: 'PUT', body });
    },

    patch<T>(url: string, body?: unknown, opts?: Omit<HttpRequest, 'url' | 'method' | 'body'>) {
      return request<T>({ ...opts, url, method: 'PATCH', body });
    },

    delete<T>(url: string, opts?: Omit<HttpRequest, 'url' | 'method'>) {
      return request<T>({ ...opts, url, method: 'DELETE' });
    },

    getStats() {
      return { ...stats, perStatus: { ...stats.perStatus } };
    },

    resetCircuit() {
      closeCircuit();
    },
  };
}
