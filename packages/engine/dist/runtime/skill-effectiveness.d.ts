/**
 * skill-effectiveness.ts — Pyrfor SkillEffectivenessTracker (G+4).
 *
 * Tracks per-skill usage, success/failure/partial outcomes, mean latency, and
 * last-used timestamp.  Persists to a JSON file atomically (tmp + renameSync).
 * Exposes pickBest() for epsilon-greedy skill selection based on proven track
 * records.
 */
export interface SkillEffectivenessRecord {
    skillId: string;
    skillName: string;
    uses: number;
    successes: number;
    failures: number;
    partials: number;
    totalLatencyMs: number;
    meanLatencyMs: number;
    lastUsedAt?: string;
    lastOutcome?: 'success' | 'failure' | 'partial';
    tags?: string[];
    /** Exponential moving average of success rate (0..1), alpha=0.3. Initial=0.5. */
    ema: number;
}
export interface RecordOutcomeInput {
    skillId: string;
    skillName: string;
    outcome: 'success' | 'failure' | 'partial';
    latencyMs: number;
    tags?: string[];
    timestamp?: string;
}
export interface PickBestOptions {
    /** Only candidates with uses >= minUses are eligible.  Default: 0. */
    minUses?: number;
    /** Epsilon-greedy exploration rate.  Default: 0.1.  Clamped to [0, 1]. */
    explorationRate?: number;
    /** Filter out records whose score < minScore.  Default: 0. */
    minScore?: number;
    /** Custom scoring function.  Default: ema*0.7 + recency*0.2 + latency*0.1. */
    scoreFn?: (r: SkillEffectivenessRecord) => number;
    /** RNG override (for testing).  Default: Math.random. */
    rng?: () => number;
    /** Clock override (ms since epoch).  Default: Date.now. */
    clock?: () => number;
}
export interface SkillEffectivenessTracker {
    recordOutcome(input: RecordOutcomeInput): SkillEffectivenessRecord;
    get(skillId: string): SkillEffectivenessRecord | undefined;
    list(): SkillEffectivenessRecord[];
    pickBest<T extends {
        id: string;
        name?: string;
    }>(candidates: T[], opts?: PickBestOptions): T | undefined;
    rank(opts?: PickBestOptions): SkillEffectivenessRecord[];
    reset(skillId?: string): void;
    flush(): Promise<void>;
}
export interface CreateSkillEffectivenessTrackerOptions {
    /** JSON file path.  If omitted the tracker is in-memory only. */
    storePath?: string;
    /** EMA smoothing factor.  Default: 0.3. */
    alpha?: number;
    /** Clock override (ms since epoch).  Default: Date.now. */
    clock?: () => number;
    /** Debounce delay for background flushes.  Default: 200 ms. */
    flushDebounceMs?: number;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}
export declare function createSkillEffectivenessTracker(opts?: CreateSkillEffectivenessTrackerOptions): SkillEffectivenessTracker;
//# sourceMappingURL=skill-effectiveness.d.ts.map