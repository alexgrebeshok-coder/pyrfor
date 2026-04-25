// ─── ScoreThresholdStop ───────────────────────────────────────────────────────
export class ScoreThresholdStop {
    constructor(threshold) {
        this.threshold = threshold;
    }
    shouldStop(state) {
        if (state.current.score.total >= this.threshold) {
            return {
                stop: true,
                reason: `score ${state.current.score.total} >= threshold ${this.threshold}`,
            };
        }
        return { stop: false };
    }
}
// ─── CompositeStop (OR semantics) ─────────────────────────────────────────────
export class CompositeStop {
    constructor(predicates) {
        this.predicates = predicates;
    }
    shouldStop(state) {
        for (const p of this.predicates) {
            const result = p.shouldStop(state);
            if (result.stop)
                return result;
        }
        return { stop: false };
    }
}
