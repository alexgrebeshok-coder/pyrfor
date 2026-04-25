/**
 * pyrfor-a2a-fc.ts — Agent-to-Agent coordination hub for parallel FC instances.
 *
 * In-memory pub/sub + shared key-value scratchpad with lease semantics.
 * No external dependencies. Uses an injectable clock (`opts.now`) for
 * deterministic TTL testing.
 */
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
type Handler = (m: A2aMessage) => void | Promise<void>;
export declare class A2aHub {
    private readonly _now;
    private _agents;
    private _subscriptions;
    private _leases;
    private _kv;
    private _history;
    constructor(opts?: {
        now?: () => number;
    });
    register(agentId: string): void;
    unregister(agentId: string): void;
    publish(msg: Omit<A2aMessage, 'id' | 'ts'>): A2aMessage;
    /**
     * Subscribe `agentId` to `topic` (exact name or `'*'` for all topics).
     * Returns an unsubscribe function.
     */
    subscribe(agentId: string, topic: string, handler: Handler): () => void;
    /**
     * Attempt to acquire an exclusive lease on `key` for `ttlMs` milliseconds.
     * Returns `{ ok: true, leaseId }` on success or `{ ok: false, heldBy }` when
     * another agent holds an active lease.
     */
    acquire(key: string, agentId: string, ttlMs: number): {
        ok: boolean;
        leaseId?: string;
        heldBy?: string;
    };
    /**
     * Release a lease. Returns true if the leaseId matched and was removed.
     */
    release(key: string, leaseId: string): boolean;
    /**
     * Write a value to the shared KV scratchpad. Requires an active, matching
     * lease on `key`. Returns false if no active lease or leaseId mismatch.
     */
    set(key: string, value: any, leaseId: string): boolean;
    /** Read a value from the shared KV scratchpad (no lease required). */
    get(key: string): any;
    /** Returns an immutable snapshot of all published messages. */
    history(): A2aMessage[];
    /** Resets all state: messages, subscriptions, leases, KV. */
    clear(): void;
}
export {};
//# sourceMappingURL=pyrfor-a2a-fc.d.ts.map