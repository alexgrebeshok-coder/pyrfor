/**
 * webhook-receiver.ts — Generic transport-agnostic webhook router for the Pyrfor engine.
 *
 * Features:
 * - HMAC-SHA256 signature verification (hex, base64, github, stripe schemes)
 * - Replay protection via timestamp header
 * - Per-source routing with wildcard handler support
 * - Timing-safe signature comparison
 * - Injected clock for deterministic testing
 */

import * as crypto from 'node:crypto';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WebhookSource {
  name: string;
  secret: string;
  signatureHeader: string;
  signatureScheme?: 'hex' | 'base64' | 'github' | 'stripe';
  timestampHeader?: string;
  toleranceMs?: number;
  parser?: (body: string) => unknown;
}

export interface WebhookEvent {
  source: string;
  event: string;
  payload: unknown;
  headers: Record<string, string>;
  receivedAt: number;
}

export type WebhookHandler = (event: WebhookEvent) => Promise<void> | void;

export type WebhookResult =
  | { ok: true; status: 200 }
  | { ok: false; status: 400 | 401 | 409 | 500; reason: string };

// ─── Internal types ───────────────────────────────────────────────────────────

interface SourceStats {
  ok: number;
  failed: number;
}

interface HandlerEntry {
  sourceName: string;
  eventName: string;
  handler: WebhookHandler;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  // Pad to same length to avoid length-based timing leaks, but still return
  // false for length mismatches after the safe comparison.
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison of same-length buffers to avoid early exit
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function computeHmacHex(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function computeHmacBase64(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function verifySignature(
  scheme: 'hex' | 'base64' | 'github' | 'stripe',
  body: string,
  secret: string,
  headerValue: string,
  stripeTs?: string,
): boolean {
  switch (scheme) {
    case 'hex':
      return timingSafeEqual(computeHmacHex(body, secret), headerValue);

    case 'base64':
      return timingSafeEqual(computeHmacBase64(body, secret), headerValue);

    case 'github':
      return timingSafeEqual('sha256=' + computeHmacHex(body, secret), headerValue);

    case 'stripe': {
      // header format: t=<timestamp>,v1=<sig>
      const parts = headerValue.split(',');
      const tPart = parts.find(p => p.startsWith('t='));
      const v1Part = parts.find(p => p.startsWith('v1='));
      if (!tPart || !v1Part) return false;
      const ts = tPart.slice(2);
      const sig = v1Part.slice(3);
      const signedPayload = `${ts}.${body}`;
      return timingSafeEqual(computeHmacHex(signedPayload, secret), sig);
    }
  }
}

function extractStripeTimestamp(headerValue: string): number | null {
  const parts = headerValue.split(',');
  const tPart = parts.find(p => p.startsWith('t='));
  if (!tPart) return null;
  const ts = parseInt(tPart.slice(2), 10);
  return isNaN(ts) ? null : ts * 1000; // stripe uses seconds, convert to ms
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createWebhookReceiver(opts?: {
  clock?: () => number;
  eventField?: string;
}) {
  const clock = opts?.clock ?? Date.now;
  const eventField = opts?.eventField ?? 'type';

  const sources = new Map<string, WebhookSource>();
  const handlers: HandlerEntry[] = [];
  const stats = {
    total: 0,
    ok: 0,
    failed: 0,
    perSource: {} as Record<string, SourceStats>,
  };

  function ensureSourceStats(name: string) {
    if (!stats.perSource[name]) {
      stats.perSource[name] = { ok: 0, failed: 0 };
    }
  }

  function recordResult(sourceName: string, success: boolean) {
    stats.total++;
    ensureSourceStats(sourceName);
    if (success) {
      stats.ok++;
      stats.perSource[sourceName].ok++;
    } else {
      stats.failed++;
      stats.perSource[sourceName].failed++;
    }
  }

  function addSource(source: WebhookSource): void {
    sources.set(source.name, source);
    ensureSourceStats(source.name);
  }

  function removeSource(name: string): boolean {
    if (!sources.has(name)) return false;
    sources.delete(name);
    // Remove all handlers for this source
    const toRemove = handlers.filter(h => h.sourceName === name);
    for (const entry of toRemove) {
      const idx = handlers.indexOf(entry);
      if (idx !== -1) handlers.splice(idx, 1);
    }
    return true;
  }

  function on(
    sourceName: string,
    eventName: string | '*',
    handler: WebhookHandler,
  ): () => void {
    const entry: HandlerEntry = { sourceName, eventName, handler };
    handlers.push(entry);
    return () => {
      const idx = handlers.indexOf(entry);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }

  async function handle(input: {
    sourceName: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<WebhookResult> {
    const { sourceName, headers, body } = input;

    // 1. Look up source
    const source = sources.get(sourceName);
    if (!source) {
      return { ok: false, status: 400, reason: 'unknown_source' };
    }

    const scheme = source.signatureScheme ?? 'hex';
    const sigHeader = (headers[source.signatureHeader.toLowerCase()] ??
      headers[source.signatureHeader]) as string | undefined;

    if (!sigHeader) {
      recordResult(sourceName, false);
      return { ok: false, status: 401, reason: 'bad_signature' };
    }

    // 2. Verify signature
    const sigValid = verifySignature(scheme, body, source.secret, sigHeader);
    if (!sigValid) {
      recordResult(sourceName, false);
      return { ok: false, status: 401, reason: 'bad_signature' };
    }

    const now = clock();
    const toleranceMs = source.toleranceMs ?? 300_000;

    // 3. Stripe timestamp enforcement (always, regardless of timestampHeader)
    if (scheme === 'stripe') {
      const stripeTs = extractStripeTimestamp(sigHeader);
      if (stripeTs === null || Math.abs(now - stripeTs) > toleranceMs) {
        recordResult(sourceName, false);
        return { ok: false, status: 409, reason: 'stale_timestamp' };
      }
    }

    // 3b. Generic timestamp header replay protection
    if (source.timestampHeader) {
      const tsRaw = headers[source.timestampHeader.toLowerCase()] ??
        headers[source.timestampHeader];
      if (tsRaw !== undefined) {
        const ts = parseInt(tsRaw, 10);
        if (isNaN(ts) || Math.abs(now - ts) > toleranceMs) {
          recordResult(sourceName, false);
          return { ok: false, status: 409, reason: 'stale_timestamp' };
        }
      }
    }

    // 4. Parse body
    const parser = source.parser ?? JSON.parse;
    let payload: unknown;
    try {
      payload = parser(body);
    } catch {
      recordResult(sourceName, false);
      return { ok: false, status: 500, reason: 'parse_error' };
    }

    // 5. Determine event name
    const eventName =
      (payload !== null &&
        typeof payload === 'object' &&
        eventField in (payload as Record<string, unknown>)
        ? String((payload as Record<string, unknown>)[eventField])
        : '*');

    // 6. Dispatch handlers
    const receivedAt = now;
    const webhookEvent: WebhookEvent = {
      source: sourceName,
      event: eventName,
      payload,
      headers,
      receivedAt,
    };

    const matchingHandlers = handlers.filter(
      h =>
        h.sourceName === sourceName &&
        (h.eventName === '*' || h.eventName === eventName),
    );

    const errors: unknown[] = [];
    for (const entry of matchingHandlers) {
      try {
        await entry.handler(webhookEvent);
      } catch (err) {
        errors.push(err);
      }
    }

    // 7. Result
    if (errors.length > 0) {
      recordResult(sourceName, false);
      return { ok: false, status: 500, reason: 'handler_error' };
    }

    recordResult(sourceName, true);
    return { ok: true, status: 200 };
  }

  function getStats() {
    return {
      total: stats.total,
      ok: stats.ok,
      failed: stats.failed,
      perSource: { ...stats.perSource },
    };
  }

  return { addSource, removeSource, on, handle, getStats };
}
