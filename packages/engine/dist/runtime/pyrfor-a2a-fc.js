/**
 * pyrfor-a2a-fc.ts — Agent-to-Agent coordination hub for parallel FC instances.
 *
 * In-memory pub/sub + shared key-value scratchpad with lease semantics.
 * No external dependencies. Uses an injectable clock (`opts.now`) for
 * deterministic TTL testing.
 */
// ── Message ID counter ────────────────────────────────────────────────────────
let _msgCounter = 0;
function makeId(now) {
    _msgCounter = (_msgCounter + 1) % 1000000;
    return `${now}-${String(_msgCounter).padStart(6, '0')}`;
}
// ── A2aHub ───────────────────────────────────────────────────────────────────
export class A2aHub {
    constructor(opts) {
        var _a;
        this._agents = new Set();
        this._subscriptions = [];
        this._leases = new Map();
        this._kv = new Map();
        this._history = [];
        this._now = (_a = opts === null || opts === void 0 ? void 0 : opts.now) !== null && _a !== void 0 ? _a : (() => Date.now());
    }
    // ── Agent registry ────────────────────────────────────────────────────────
    register(agentId) {
        this._agents.add(agentId);
    }
    unregister(agentId) {
        this._agents.delete(agentId);
        // Remove all subscriptions for this agent
        this._subscriptions = this._subscriptions.filter((s) => s.agentId !== agentId);
    }
    // ── Pub/Sub ───────────────────────────────────────────────────────────────
    publish(msg) {
        const now = this._now();
        const enriched = Object.assign(Object.assign({}, msg), { id: makeId(now), ts: now });
        this._history.push(enriched);
        for (const sub of this._subscriptions) {
            // Topic match: exact or wildcard
            const topicMatch = sub.topic === '*' || sub.topic === enriched.topic;
            if (!topicMatch)
                continue;
            // Routing: targeted → only destination agent; broadcast → all subscribers
            if (enriched.to !== undefined && enriched.to !== sub.agentId)
                continue;
            // Fire & forget; swallow async errors to not break the publish loop
            try {
                const result = sub.handler(enriched);
                if (result instanceof Promise) {
                    result.catch(() => {
                        // intentionally swallowed
                    });
                }
            }
            catch (_a) {
                // intentionally swallowed
            }
        }
        return enriched;
    }
    /**
     * Subscribe `agentId` to `topic` (exact name or `'*'` for all topics).
     * Returns an unsubscribe function.
     */
    subscribe(agentId, topic, handler) {
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
    acquire(key, agentId, ttlMs) {
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
    release(key, leaseId) {
        const existing = this._leases.get(key);
        if (!existing || existing.leaseId !== leaseId)
            return false;
        this._leases.delete(key);
        return true;
    }
    /**
     * Write a value to the shared KV scratchpad. Requires an active, matching
     * lease on `key`. Returns false if no active lease or leaseId mismatch.
     */
    set(key, value, leaseId) {
        const now = this._now();
        const lease = this._leases.get(key);
        if (!lease || lease.leaseId !== leaseId || lease.expiresAt <= now) {
            return false;
        }
        this._kv.set(key, { value, leaseId });
        return true;
    }
    /** Read a value from the shared KV scratchpad (no lease required). */
    get(key) {
        var _a;
        return (_a = this._kv.get(key)) === null || _a === void 0 ? void 0 : _a.value;
    }
    // ── Diagnostics ───────────────────────────────────────────────────────────
    /** Returns an immutable snapshot of all published messages. */
    history() {
        return [...this._history];
    }
    /** Resets all state: messages, subscriptions, leases, KV. */
    clear() {
        this._agents.clear();
        this._subscriptions = [];
        this._leases.clear();
        this._kv.clear();
        this._history = [];
    }
}
