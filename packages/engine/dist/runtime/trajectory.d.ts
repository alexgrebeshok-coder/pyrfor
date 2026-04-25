/**
 * trajectory.ts — Pyrfor self-improvement trajectory recorder.
 *
 * Records every pipeline run (tool calls, tokens, answer) as a JSONL line so
 * future phases (pattern miner, auto-skill synthesis, fine-tune export) can
 * learn from real usage.
 */
export interface ToolCallTrace {
    name: string;
    args: unknown;
    result: unknown;
    success: boolean;
    latencyMs: number;
    errorMessage?: string;
    timestamp: string;
}
export interface TrajectoryRecord {
    id: string;
    sessionId: string;
    channel: string;
    userId?: string;
    chatId?: string;
    userInput: string;
    toolCalls: ToolCallTrace[];
    finalAnswer: string;
    success: boolean;
    abortReason?: 'aborted' | 'timeout' | 'iter-limit' | 'error';
    iterations: number;
    tokensUsed: {
        prompt: number;
        completion: number;
        total: number;
    };
    costUsd?: number;
    provider?: string;
    model?: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    private: boolean;
    metadata?: Record<string, unknown>;
}
export interface TrajectoryRecorderOptions {
    baseDir: string;
    enabled: boolean;
    rotateBy: 'day' | 'week';
    maxFileSizeMb?: number;
    retainDays?: number;
}
export interface TrajectoryBuilder {
    recordToolCall(call: ToolCallTrace): void;
    setProvider(provider: string, model: string): void;
    addTokens(p: {
        prompt?: number;
        completion?: number;
    }): void;
    /** Mark success and finalise. Writes one JSONL line atomically. */
    finish(p: {
        finalAnswer: string;
        success?: boolean;
        abortReason?: TrajectoryRecord['abortReason'];
        costUsd?: number;
        iterations?: number;
    }): Promise<TrajectoryRecord>;
    /** Discard without writing (e.g. tests, opt-out). */
    cancel(): void;
}
export declare class TrajectoryRecorder {
    private readonly opts;
    private _activeCount;
    constructor(opts?: Partial<TrajectoryRecorderOptions>);
    /** Currently-active builders count (for tests / observability). */
    activeCount(): number;
    /** Begin recording a pipeline run. Returns a builder. */
    begin(input: {
        sessionId: string;
        channel: string;
        userId?: string;
        chatId?: string;
        userInput: string;
        private?: boolean;
        metadata?: Record<string, unknown>;
    }): TrajectoryBuilder;
    private _writeRecord;
    private _resolveRotatedPath;
    /** Read all trajectories matching predicates (date range, channel, success). */
    query(filter?: {
        since?: Date;
        until?: Date;
        channel?: string;
        successOnly?: boolean;
        limit?: number;
    }): Promise<TrajectoryRecord[]>;
    private _readFile;
    /**
     * Stream JSONL → ShareGPT-formatted JSONL for fine-tuning.
     * Excludes private:true and success:false records.
     */
    exportShareGpt(opts: {
        since?: Date;
        until?: Date;
        outPath: string;
        includePrivate?: false;
    }): Promise<{
        exported: number;
        skipped: number;
    }>;
    /** Delete trajectory files older than retainDays. */
    pruneOld(retainDays: number): Promise<{
        deleted: number;
    }>;
}
//# sourceMappingURL=trajectory.d.ts.map