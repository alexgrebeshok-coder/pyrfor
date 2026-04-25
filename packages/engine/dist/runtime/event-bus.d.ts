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
    waitFor<K extends keyof EventMap & string>(type: K, opts?: {
        timeoutMs?: number;
        predicate?: (p: EventMap[K]) => boolean;
    }): Promise<EventMap[K]>;
    history(filter?: {
        type?: string;
        sinceTs?: number;
        limit?: number;
    }): EventRecord[];
    clearHistory(): void;
    listenerCount(type?: string): number;
    removeAll(type?: string): void;
}
export declare function createEventBus<EventMap extends Record<string, any> = Record<string, any>>(opts?: EventBusOptions): EventBus<EventMap>;
//# sourceMappingURL=event-bus.d.ts.map