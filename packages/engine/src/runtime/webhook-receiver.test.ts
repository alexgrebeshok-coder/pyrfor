// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import * as crypto from 'node:crypto';
import {
  createWebhookReceiver,
  type WebhookSource,
  type WebhookEvent,
} from './webhook-receiver.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hmacHex(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function hmacBase64(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

const SECRET = 'test-secret-key';
const NOW = 1_700_000_000_000; // fixed epoch ms
const fixedClock = () => NOW;

function makeSource(overrides: Partial<WebhookSource> = {}): WebhookSource {
  return {
    name: 'github',
    secret: SECRET,
    signatureHeader: 'x-hub-signature-256',
    signatureScheme: 'hex',
    ...overrides,
  };
}

function hexHeaders(body: string, extra: Record<string, string> = {}) {
  return { 'x-hub-signature-256': hmacHex(body, SECRET), ...extra };
}

// ─── addSource / removeSource ─────────────────────────────────────────────────

describe('addSource / removeSource', () => {
  it('addSource registers a source', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const body = JSON.stringify({ type: 'push' });
    const result = await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(result.ok).toBe(true);
  });

  it('removeSource returns true and removes the source', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    expect(r.removeSource('github')).toBe(true);
    const body = '{}';
    const result = await r.handle({ sourceName: 'github', headers: {}, body });
    expect(result).toMatchObject({ ok: false, status: 400, reason: 'unknown_source' });
  });

  it('removeSource returns false for unknown name', () => {
    const r = createWebhookReceiver();
    expect(r.removeSource('nope')).toBe(false);
  });

  it('removeSource also removes all handlers for that source', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const called: boolean[] = [];
    r.on('github', '*', () => { called.push(true); });
    r.removeSource('github');
    // re-add and deliver — handler must NOT fire (was removed with source)
    r.addSource(makeSource());
    const body = JSON.stringify({ type: 'ping' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(called).toHaveLength(0);
  });
});

// ─── unknown source ───────────────────────────────────────────────────────────

describe('unknown source', () => {
  it('returns 400 unknown_source', async () => {
    const r = createWebhookReceiver();
    const result = await r.handle({ sourceName: 'missing', headers: {}, body: '{}' });
    expect(result).toMatchObject({ ok: false, status: 400, reason: 'unknown_source' });
  });
});

// ─── Signature verification ───────────────────────────────────────────────────

describe('signature verification', () => {
  it('valid hex signature → 200', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource({ signatureScheme: 'hex' }));
    const body = JSON.stringify({ type: 'deploy' });
    const result = await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it('valid base64 signature → 200', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource({ signatureScheme: 'base64', signatureHeader: 'x-sig' }));
    const body = JSON.stringify({ type: 'deploy' });
    const headers = { 'x-sig': hmacBase64(body, SECRET) };
    const result = await r.handle({ sourceName: 'github', headers, body });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it('valid github sha256= scheme → 200', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource({ signatureScheme: 'github' }));
    const body = JSON.stringify({ type: 'push' });
    const headers = { 'x-hub-signature-256': 'sha256=' + hmacHex(body, SECRET) };
    const result = await r.handle({ sourceName: 'github', headers, body });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it('bad signature → 401', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource({ signatureScheme: 'hex' }));
    const body = JSON.stringify({ type: 'push' });
    const headers = { 'x-hub-signature-256': 'deadbeef' };
    const result = await r.handle({ sourceName: 'github', headers, body });
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'bad_signature' });
  });

  it('missing signature header → 401', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const result = await r.handle({ sourceName: 'github', headers: {}, body: '{}' });
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'bad_signature' });
  });

  it('timing-safe comparison rejects mismatched lengths', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource({ signatureScheme: 'hex' }));
    const body = JSON.stringify({ type: 'x' });
    // short signature — different length
    const result = await r.handle({ sourceName: 'github', headers: { 'x-hub-signature-256': 'abc' }, body });
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'bad_signature' });
  });
});

// ─── Stripe scheme ────────────────────────────────────────────────────────────

describe('stripe scheme', () => {
  function stripeHeader(body: string, tsMs: number) {
    const tsSec = Math.floor(tsMs / 1000);
    const signed = `${tsSec}.${body}`;
    const sig = hmacHex(signed, SECRET);
    return `t=${tsSec},v1=${sig}`;
  }

  const stripeSource: WebhookSource = {
    name: 'stripe',
    secret: SECRET,
    signatureHeader: 'stripe-signature',
    signatureScheme: 'stripe',
    toleranceMs: 300_000,
  };

  it('valid stripe signature within tolerance → 200', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(stripeSource);
    const body = JSON.stringify({ type: 'charge.created' });
    const headers = { 'stripe-signature': stripeHeader(body, NOW) };
    const result = await r.handle({ sourceName: 'stripe', headers, body });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it('stripe replay outside tolerance → stale_timestamp', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(stripeSource);
    const body = JSON.stringify({ type: 'charge.created' });
    // 10 minutes old
    const staleTs = NOW - 10 * 60 * 1000;
    const headers = { 'stripe-signature': stripeHeader(body, staleTs) };
    const result = await r.handle({ sourceName: 'stripe', headers, body });
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'stale_timestamp' });
  });

  it('stripe malformed header → bad_signature', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(stripeSource);
    const body = JSON.stringify({ type: 'x' });
    const result = await r.handle({ sourceName: 'stripe', headers: { 'stripe-signature': 'garbage' }, body });
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'bad_signature' });
  });
});

// ─── Replay protection (timestampHeader) ─────────────────────────────────────

describe('replay protection', () => {
  const tsSource: WebhookSource = {
    name: 'ts-src',
    secret: SECRET,
    signatureHeader: 'x-sig',
    signatureScheme: 'hex',
    timestampHeader: 'x-timestamp',
    toleranceMs: 60_000,
  };

  it('fresh timestamp → 200', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(tsSource);
    const body = JSON.stringify({ type: 'ev' });
    const headers = {
      'x-sig': hmacHex(body, SECRET),
      'x-timestamp': String(NOW),
    };
    const result = await r.handle({ sourceName: 'ts-src', headers, body });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it('stale timestamp → 409', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(tsSource);
    const body = JSON.stringify({ type: 'ev' });
    const stale = NOW - 120_000;
    const headers = {
      'x-sig': hmacHex(body, SECRET),
      'x-timestamp': String(stale),
    };
    const result = await r.handle({ sourceName: 'ts-src', headers, body });
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'stale_timestamp' });
  });
});

// ─── Routing & handlers ───────────────────────────────────────────────────────

describe('handler routing', () => {
  it('handler invoked with correct WebhookEvent', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const captured: WebhookEvent[] = [];
    r.on('github', 'push', e => { captured.push(e); });
    const body = JSON.stringify({ type: 'push', ref: 'main' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(captured).toHaveLength(1);
    expect(captured[0].event).toBe('push');
    expect(captured[0].source).toBe('github');
    expect(captured[0].receivedAt).toBe(NOW);
    expect((captured[0].payload as { ref: string }).ref).toBe('main');
  });

  it('* handler matches all events', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const events: string[] = [];
    r.on('github', '*', e => { events.push(e.event); });
    for (const type of ['push', 'pull_request', 'release']) {
      const body = JSON.stringify({ type });
      await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    }
    expect(events).toEqual(['push', 'pull_request', 'release']);
  });

  it('specific + * handlers both invoked', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const log: string[] = [];
    r.on('github', 'push', () => { log.push('specific'); });
    r.on('github', '*', () => { log.push('wildcard'); });
    const body = JSON.stringify({ type: 'push' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(log).toContain('specific');
    expect(log).toContain('wildcard');
    expect(log).toHaveLength(2);
  });

  it('multiple handlers for same event all invoked', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const calls: number[] = [];
    r.on('github', 'push', () => { calls.push(1); });
    r.on('github', 'push', () => { calls.push(2); });
    r.on('github', 'push', () => { calls.push(3); });
    const body = JSON.stringify({ type: 'push' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(calls).toEqual([1, 2, 3]);
  });

  it('event falls back to * when no type field', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const captured: string[] = [];
    r.on('github', '*', e => { captured.push(e.event); });
    const body = JSON.stringify({ data: 'no type field' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(captured).toEqual(['*']);
  });

  it('custom eventField used', async () => {
    const r = createWebhookReceiver({ clock: fixedClock, eventField: 'action' });
    r.addSource(makeSource());
    const captured: string[] = [];
    r.on('github', 'opened', e => { captured.push(e.event); });
    const body = JSON.stringify({ action: 'opened' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(captured).toEqual(['opened']);
  });
});

// ─── Deregister ───────────────────────────────────────────────────────────────

describe('on() deregister', () => {
  it('returns a deregister function that prevents further calls', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const calls: number[] = [];
    const off = r.on('github', 'push', () => { calls.push(1); });
    const body = JSON.stringify({ type: 'push' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(calls).toHaveLength(1);
    off();
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(calls).toHaveLength(1); // not called again
  });
});

// ─── Handler errors ───────────────────────────────────────────────────────────

describe('handler errors', () => {
  it('handler error → 500 handler_error', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    r.on('github', 'push', () => { throw new Error('boom'); });
    const body = JSON.stringify({ type: 'push' });
    const result = await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(result).toMatchObject({ ok: false, status: 500, reason: 'handler_error' });
  });

  it('async handler rejection → 500', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    r.on('github', 'push', async () => { throw new Error('async boom'); });
    const body = JSON.stringify({ type: 'push' });
    const result = await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(result).toMatchObject({ ok: false, status: 500, reason: 'handler_error' });
  });
});

// ─── Parser ───────────────────────────────────────────────────────────────────

describe('parser', () => {
  it('custom parser is used', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    const customParser = vi.fn(() => ({ type: 'custom', parsed: true }));
    r.addSource(makeSource({ parser: customParser }));
    const body = 'raw-body-text';
    const headers = { 'x-hub-signature-256': hmacHex(body, SECRET) };
    const result = await r.handle({ sourceName: 'github', headers, body });
    expect(result.ok).toBe(true);
    expect(customParser).toHaveBeenCalledWith(body);
  });

  it('empty body with JSON.parse → parse_error (500)', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const body = '';
    const headers = { 'x-hub-signature-256': hmacHex(body, SECRET) };
    const result = await r.handle({ sourceName: 'github', headers, body });
    expect(result).toMatchObject({ ok: false, status: 500, reason: 'parse_error' });
  });

  it('non-JSON body with default parser → parse_error (500)', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const body = 'not-json-at-all!!!';
    const headers = { 'x-hub-signature-256': hmacHex(body, SECRET) };
    const result = await r.handle({ sourceName: 'github', headers, body });
    expect(result).toMatchObject({ ok: false, status: 500, reason: 'parse_error' });
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('starts at zero', () => {
    const r = createWebhookReceiver();
    expect(r.getStats()).toEqual({ total: 0, ok: 0, failed: 0, perSource: {} });
  });

  it('tracks ok and failed accurately', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    const body = JSON.stringify({ type: 'push' });

    // 2 ok
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    // 1 failed (bad sig)
    await r.handle({ sourceName: 'github', headers: { 'x-hub-signature-256': 'bad' }, body });

    const s = r.getStats();
    expect(s.total).toBe(3);
    expect(s.ok).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.perSource['github']).toEqual({ ok: 2, failed: 1 });
  });

  it('handler_error increments failed', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource());
    r.on('github', '*', () => { throw new Error('fail'); });
    const body = JSON.stringify({ type: 'push' });
    await r.handle({ sourceName: 'github', headers: hexHeaders(body), body });
    expect(r.getStats().failed).toBe(1);
    expect(r.getStats().ok).toBe(0);
  });

  it('perSource tracks multiple sources independently', async () => {
    const r = createWebhookReceiver({ clock: fixedClock });
    r.addSource(makeSource({ name: 'src-a', signatureHeader: 'x-sig-a' }));
    r.addSource(makeSource({ name: 'src-b', signatureHeader: 'x-sig-b' }));

    const bodyA = JSON.stringify({ type: 'ping' });
    const bodyB = JSON.stringify({ type: 'pong' });
    await r.handle({ sourceName: 'src-a', headers: { 'x-sig-a': hmacHex(bodyA, SECRET) }, body: bodyA });
    await r.handle({ sourceName: 'src-b', headers: { 'x-sig-b': hmacHex(bodyB, SECRET) }, body: bodyB });
    await r.handle({ sourceName: 'src-b', headers: { 'x-sig-b': 'bad' }, body: bodyB });

    const s = r.getStats();
    expect(s.perSource['src-a']).toEqual({ ok: 1, failed: 0 });
    expect(s.perSource['src-b']).toEqual({ ok: 1, failed: 1 });
    expect(s.total).toBe(3);
  });

  it('unknown source does not affect perSource stats', async () => {
    const r = createWebhookReceiver();
    await r.handle({ sourceName: 'ghost', headers: {}, body: '' });
    expect(r.getStats()).toMatchObject({ total: 0, ok: 0, failed: 0 });
  });
});
