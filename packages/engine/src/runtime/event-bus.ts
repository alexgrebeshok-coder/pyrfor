/**
 * Pyrfor — centralised pub-sub event bus
 *
 * Features
 * --------
 * - Strongly-typed EventMap generics
 * - Wildcard patterns:  auth.*  *.completed  **
 * - Async handlers with full await + error isolation
 * - emitSync fire-and-forget variant
 * - waitFor promise with optional timeout + predicate
 * - History ring buffer (default 200 events)
 * - listenerCount / removeAll helpers
 */

import { randomUUID } from 'node:crypto';

// ── Public types ────────────────────────────────────────────────────────────

export type EventRecord<T = any> = {
  type: string;
  payload: T;
  ts: number;
  id: string;
};

export type EventHandler<T = any> = (event: EventRecord<T>) => void | Promise<void>;

export interface EventBusOptions {
  historySize?: number;
  clock?: () => number;
  logger?: (msg: string, meta?: any) => void;
}

export interface EventBus<EventMap extends Record<string, any> = Record<string, any>> {
  on<K extends keyof EventMap & string>(type: K, handler: EventHandler<EventMap[K]>): () => void;
  onAny(handler: EventHandler<any>): () => void;
  onPattern(glob: string, handler: EventHandler<any>): () => void;
  off(handler: EventHandler<any>): boolean;
  emit<K extends keyof EventMap & string>(type: K, payload: EventMap[K]): Promise<void>;
  emitSync<K extends keyof EventMap & string>(type: K, payload: EventMap[K]): void;
  waitFor<K extends keyof EventMap & string>(
    type: K,
    opts?: { timeoutMs?: number; predicate?: (p: EventMap[K]) => boolean },
  ): Promise<EventMap[K]>;
  history(filter?: { type?: string; sinceTs?: number; limit?: number }): EventRecord[];
  clearHistory(): void;
  listenerCount(type?: string): number;
  removeAll(type?: string): void;
}

// ── Internal structures ──────────────────────────────────────────────────────

type HandlerEntry = {
  handler: EventHandler<any>;
  /** undefined = exact-type, null = any, RegExp = pattern */
  matcher: string | null | RegExp;
};

// ── Glob → RegExp ────────────────────────────────────────────────────────────

function globToRegExp(glob: string): RegExp {
  // Escape all regex metacharacters except * which we handle explicitly.
  // We handle `**` first, then `*` so they don't conflict.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (not *)
    .replace(/\*\*/g, '\x00')              // placeholder for **
    .replace(/\*/g, '[^.]+')               // * → one segment (no dot)
    .replace(/\x00/g, '.+');               // ** → one or more chars (any)

  return new RegExp(`^${escaped}$`);
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createEventBus<
  EventMap extends Record<string, any> = Record<string, any>,
>(opts: EventBusOptions = {}): EventBus<EventMap> {
  const historySize = opts.historySize ?? 200;
  const clock       = opts.clock ?? (() => Date.now());
  const log         = opts.logger ?? (() => undefined);

  // All subscriptions stored in one flat array for simplicity.
  // matcher === string  → exact type match
  // matcher === null    → onAny
  // matcher instanceof RegExp → pattern
  const entries: HandlerEntry[] = [];

  // Ring buffer for history
  const ring: EventRecord[] = [];

  // ── helpers ────────────────────────────────────────────────────────────────

  function pushHistory(rec: EventRecord): void {
    ring.push(rec);
    if (ring.length > historySize) ring.splice(0, ring.length - historySize);
  }

  function matchingHandlers(type: string): EventHandler<any>[] {
    const out: EventHandler<any>[] = [];
    for (const e of entries) {
      if (e.matcher === null) {
        out.push(e.handler);
      } else if (e.matcher instanceof RegExp) {
        if (e.matcher.test(type)) out.push(e.handler);
      } else {
        if (e.matcher === type) out.push(e.handler);
      }
    }
    return out;
  }

  async function dispatchRecord(rec: EventRecord): Promise<void> {
    const handlers = matchingHandlers(rec.type);
    await Promise.all(
      handlers.map(async (h) => {
        try {
          await h(rec);
        } catch (err) {
          log('event-bus: handler error', { type: rec.type, id: rec.id, err });
        }
      }),
    );
  }

  function buildRecord<K extends keyof EventMap & string>(type: K, payload: EventMap[K]): EventRecord<EventMap[K]> {
    return { type, payload, ts: clock(), id: randomUUID() };
  }

  // ── API ────────────────────────────────────────────────────────────────────

  function on<K extends keyof EventMap & string>(
    type: K,
    handler: EventHandler<EventMap[K]>,
  ): () => void {
    const entry: HandlerEntry = { handler, matcher: type };
    entries.push(entry);
    return () => { const i = entries.indexOf(entry); if (i !== -1) entries.splice(i, 1); };
  }

  function onAny(handler: EventHandler<any>): () => void {
    const entry: HandlerEntry = { handler, matcher: null };
    entries.push(entry);
    return () => { const i = entries.indexOf(entry); if (i !== -1) entries.splice(i, 1); };
  }

  function onPattern(glob: string, handler: EventHandler<any>): () => void {
    const re = globToRegExp(glob);
    const entry: HandlerEntry = { handler, matcher: re };
    entries.push(entry);
    return () => { const i = entries.indexOf(entry); if (i !== -1) entries.splice(i, 1); };
  }

  function off(handler: EventHandler<any>): boolean {
    let removed = false;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.handler === handler) {
        entries.splice(i, 1);
        removed = true;
      }
    }
    return removed;
  }

  async function emit<K extends keyof EventMap & string>(
    type: K,
    payload: EventMap[K],
  ): Promise<void> {
    const rec = buildRecord(type, payload);
    pushHistory(rec);
    await dispatchRecord(rec);
  }

  function emitSync<K extends keyof EventMap & string>(
    type: K,
    payload: EventMap[K],
  ): void {
    const rec = buildRecord(type, payload);
    pushHistory(rec);
    const handlers = matchingHandlers(rec.type);
    for (const h of handlers) {
      try {
        // intentionally ignoring any returned promise
        void h(rec);
      } catch (err) {
        log('event-bus: sync handler error', { type: rec.type, id: rec.id, err });
      }
    }
  }

  function waitFor<K extends keyof EventMap & string>(
    type: K,
    opts: { timeoutMs?: number; predicate?: (p: EventMap[K]) => boolean } = {},
  ): Promise<EventMap[K]> {
    return new Promise<EventMap[K]>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const unsub = on(type, (rec) => {
        if (opts.predicate && !opts.predicate(rec.payload)) return;
        if (timer !== undefined) clearTimeout(timer);
        unsub();
        resolve(rec.payload);
      });

      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          unsub();
          reject(new Error(`waitFor('${type}') timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs);
      }
    });
  }

  function history(filter: { type?: string; sinceTs?: number; limit?: number } = {}): EventRecord[] {
    let result = ring.slice();
    if (filter.type !== undefined)    result = result.filter((r) => r.type === filter.type);
    if (filter.sinceTs !== undefined) result = result.filter((r) => r.ts >= filter.sinceTs!);
    if (filter.limit !== undefined)   result = result.slice(-filter.limit);
    return result;
  }

  function clearHistory(): void {
    ring.splice(0, ring.length);
  }

  function listenerCount(type?: string): number {
    if (type === undefined) return entries.length;
    return entries.filter((e) => {
      if (e.matcher === null) return false;          // onAny — not counted per type
      if (e.matcher instanceof RegExp) return e.matcher.test(type);
      return e.matcher === type;
    }).length;
  }

  function removeAll(type?: string): void {
    if (type === undefined) {
      entries.splice(0, entries.length);
      return;
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const m = entries[i]!.matcher;
      if (m === null) continue; // onAny stays
      if (m instanceof RegExp ? m.test(type) : m === type) {
        entries.splice(i, 1);
      }
    }
  }

  return { on, onAny, onPattern, off, emit, emitSync, waitFor, history, clearHistory, listenerCount, removeAll };
}
