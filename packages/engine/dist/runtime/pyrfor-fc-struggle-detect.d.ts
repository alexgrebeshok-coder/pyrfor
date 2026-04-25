import type { IterationResult } from './pyrfor-fc-ralph.js';
export interface StruggleDetectorOptions {
    plateauWindow?: number;
    plateauDelta?: number;
    sameErrorN?: number;
    costSpikeMultiplier?: number;
}
export interface StruggleDetector {
    detect(history: IterationResult[]): {
        stuck: boolean;
        reason?: string;
    };
}
export declare class DefaultStruggleDetector implements StruggleDetector {
    private readonly plateauWindow;
    private readonly plateauDelta;
    private readonly sameErrorN;
    private readonly costSpikeMultiplier;
    constructor(opts?: StruggleDetectorOptions);
    detect(history: IterationResult[]): {
        stuck: boolean;
        reason?: string;
    };
}
//# sourceMappingURL=pyrfor-fc-struggle-detect.d.ts.map