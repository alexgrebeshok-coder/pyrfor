/**
 * session-replay.ts — Pyrfor session replay recorder & replayer.
 *
 * Records every agent event (prompts, tool calls, outputs, timings) as
 * append-only JSONL lines.  Replays expose iterators for visualizers /
 * test runners.
 *
 * Design decisions:
 * - Append-only JSONL: one JSON object per line, atomic via appendFile.
 * - In-memory buffer drained by flushEveryNEvents threshold or debounce timer.
 * - writeChain serialises concurrent writes so lines never interleave.
 * - Replayer uses synchronous readFileSync / readdirSync so callers do not
 *   need to await simple queries.
 * - iterate() yields events with wall-clock-proportional delays (speed=1.0)
 *   or as-fast-as-possible (speed=0); honours AbortSignal for cancellation.
 */
export type ReplayEvent = {
    ts: number;
    sessionId: string;
    kind: 'sessionStart' | 'sessionEnd' | 'userMessage' | 'assistantMessage' | 'toolCallStart' | 'toolCallEnd' | 'systemPromptInjected' | 'error' | 'meta';
    payload: Record<string, any>;
};
export type SessionRecorderOpts = {
    storeDir: string;
    sessionId: string;
    /** Monotonic clock in ms. Defaults to Date.now(). */
    clock?: () => number;
    /** Flush to disk after this many buffered events. Default: 50. */
    flushEveryNEvents?: number;
    /** Flush to disk after this many ms of inactivity. Default: 200. */
    flushDebounceMs?: number;
    logger?: (msg: string, meta?: any) => void;
};
export declare function createSessionRecorder(opts: SessionRecorderOpts): {
    record: (kind: ReplayEvent["kind"], payload: any) => void;
    meta(payload: any): void;
    sessionStart(payload?: any): void;
    sessionEnd(payload?: any): void;
    flush: () => Promise<void>;
    close: () => Promise<void>;
    count(): number;
};
export declare function createSessionReplayer(opts: {
    storeDir: string;
}): {
    listSessions: () => {
        sessionId: string;
        eventCount: number;
        firstTs: number;
        lastTs: number;
    }[];
    loadSession: (sessionId: string) => ReplayEvent[];
    iterate: (sessionId: string, iterOpts?: {
        speed?: number;
        clock?: () => number;
        signal?: AbortSignal;
    }) => AsyncGenerator<ReplayEvent>;
    filter: (events: ReplayEvent[], pred: (e: ReplayEvent) => boolean) => ReplayEvent[];
    tail: (sessionId: string, n: number) => ReplayEvent[];
    exportJson: (sessionId: string) => string;
};
//# sourceMappingURL=session-replay.d.ts.map