import type { IterationResult } from './pyrfor-fc-ralph.js';
export interface EarlyStopPredicate {
    shouldStop(state: {
        history: IterationResult[];
        current: IterationResult;
    }): {
        stop: boolean;
        reason?: string;
    };
}
export declare class ScoreThresholdStop implements EarlyStopPredicate {
    private readonly threshold;
    constructor(threshold: number);
    shouldStop(state: {
        history: IterationResult[];
        current: IterationResult;
    }): {
        stop: boolean;
        reason?: string;
    };
}
export declare class CompositeStop implements EarlyStopPredicate {
    private readonly predicates;
    constructor(predicates: EarlyStopPredicate[]);
    shouldStop(state: {
        history: IterationResult[];
        current: IterationResult;
    }): {
        stop: boolean;
        reason?: string;
    };
}
//# sourceMappingURL=pyrfor-fc-early-stop.d.ts.map