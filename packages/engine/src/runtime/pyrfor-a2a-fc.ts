/**
 * pyrfor-a2a-fc.ts — Agent-to-Agent coordination hub for parallel FC instances.
 *
 * In-memory pub/sub + shared key-value scratchpad with lease semantics.
 * No external dependencies. Uses an injectable clock (`opts.now`) for
 * deterministic TTL testing.
 */

// ── Message ID counter ────────────────────────────────────────────────────────

let _msgCounter = 0;

function makeId(now: number): string {
  _msgCounter = (_msgCounter + 1) % 1_000_000;
  return `${now}-${String(_msgCounter).padStart(6, '0')}`;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface A2aMessage {
  /** ULID-like: `${Date.now()}-${counter}` */
  id: string;
  /** Sending agent id */
  from: string;
  /** Target agent id; broadcast to all subscribers if omitted */
  to?: string;
  topic: string;
  payload: any;
  ts: number;
}

interface LeaseRecord {
  leaseId: string;
  heldBy: string;
  expiresAt: number;
}

interface KvRecord {
  value: any;
  leaseId: string; // last writer's leaseId (informational)
}

type Handler = (m: A2aMessage) => void | Promise<void>;

interface SubscriptionRecord {
  agentId: string;
  topic: string; // exact topic or '*'
  handler: Handler;
  id: symbol;
}

// ── A2aHub ───────────────────────────────────────────────────────────────────

export class A2aHub {
  private readonly _now: () => number;
  private _agents = new Set<string>();
  private _subscriptions: SubscriptionRecord[] = [];
  private _leases = new Map<string, LeaseRecord>();
  private _kv = new Map<string, KvRecord>();
  private _history: A2aMessage[] = [];

  constructor(opts?: { now?: () => number }) {
    this._now = opts?.now ?? (() => Date.now());
  }

  // ── Agent registry ────────────────────────────────────────────────────────

  register(agentId: string): void {
    this._agents.add(agentId);
  }

  unregister(agentId: string): void {
    this._agents.delete(agentId);
    // Remove all subscriptions for this agent
    this._subscriptions = this._subscriptions.filter((s) => s.agentId !== agentId);
  }

  // ── Pub/Sub ───────────────────────────────────────────────────────────────

  publish(msg: Omit<A2aMessage, 'id' | 'ts'>): A2aMessage {
    const now = this._now();
    const enriched: A2aMessage = { ...msg, id: makeId(now), ts: now };
    this._history.push(enriched);

    for (const sub of this._subscriptions) {
      // Topic match: exact or wildcard
      const topicMatch = sub.topic === '*' || sub.topic === enriched.topic;
      if (!topicMatch) continue;

      // Routing: targeted → only destination agent; broadcast → all subscribers
      if (enriched.to !== undefined && enriched.to !== sub.agentId) continue;

      // Fire & forget; swallow async errors to not break the publish loop
      try {
        const result = sub.handler(enriched);
        if (result instanceof Promise) {
          result.catch(() => {
            // intentionally swallowed
          });
        }
      } catch {
        // intentionally swallowed
      }
    }

    return enriched;
  }

  /**
   * Subscribe `agentId` to `topic` (exact name or `'*'` for all topics).
   * Returns an unsubscribe function.
   */
  subscribe(
    agentId: string,
    topic: string,
    handler: Handler,
  ): () => void {
    const id = Symbol();
    this._subscriptions.push({ agentId, topic, handler, id });
    return () => {
      this._subscriptions = this._subscriptions.filter((s) => s.id !== id);
    };
  }

  // ── Lease / KV ────────────────────────────────────────────────────────────

  /**
   * Attempt to acquire an exclusive lease on `key` for `ttlMs` milliseconds.
   * Returns `{ ok: true, leaseId }` on success or `{ ok: false, heldBy }` when
   * another agent holds an active lease.
   */
  acquire(
    key: string,
    agentId: string,
    ttlMs: number,
  ): { ok: boolean; leaseId?: string; heldBy?: string } {
    const now = this._now();
    const existing = this._leases.get(key);

    if (existing && existing.expiresAt > now) {
      // Active lease held by someone else (or same agent re-acquiring)
      return { ok: false, heldBy: existing.heldBy };
    }

    // Expired or no lease — grant new one
    const leaseId = `lease-${makeId(now)}-${agentId}`;
    this._leases.set(key, { leaseId, heldBy: agentId, expiresAt: now + ttlMs });
    return { ok: true, leaseId };
  }

  /**
   * Release a lease. Returns true if the leaseId matched and was removed.
   */
  release(key: string, leaseId: string): boolean {
    const existing = this._leases.get(key);
    if (!existing || existing.leaseId !== leaseId) return false;
    this._leases.delete(key);
    return true;
  }

  /**
   * Write a value to the shared KV scratchpad. Requires an active, matching
   * lease on `key`. Returns false if no active lease or leaseId mismatch.
   */
  set(key: string, value: any, leaseId: string): boolean {
    const now = this._now();
    const lease = this._leases.get(key);
    if (!lease || lease.leaseId !== leaseId || lease.expiresAt <= now) {
      return false;
    }
    this._kv.set(key, { value, leaseId });
    return true;
  }

  /** Read a value from the shared KV scratchpad (no lease required). */
  get(key: string): any {
    return this._kv.get(key)?.value;
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  /** Returns an immutable snapshot of all published messages. */
  history(): A2aMessage[] {
    return [...this._history];
  }

  /** Resets all state: messages, subscriptions, leases, KV. */
  clear(): void {
    this._agents.clear();
    this._subscriptions = [];
    this._leases.clear();
    this._kv.clear();
    this._history = [];
  }
}
