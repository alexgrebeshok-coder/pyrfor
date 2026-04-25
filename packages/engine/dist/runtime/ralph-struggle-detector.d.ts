export interface StruggleDetectorOptions {
    flatWindow?: number;
    flatTolerance?: number;
    regressionTolerance?: number;
    minIterations?: number;
}
export type StruggleSignal = {
    kind: 'progressing';
    lastScore: number;
} | {
    kind: 'flat';
    iterations: number;
    lastScore: number;
} | {
    kind: 'regression';
    from: number;
    to: number;
} | {
    kind: 'oscillation';
    window: number;
};
export interface StruggleDetector {
    observe(score: number): StruggleSignal;
    reset(): void;
    history(): readonly number[];
}
export declare function createStruggleDetector(opts?: StruggleDetectorOptions): StruggleDetector;
export declare function detectStruggle(scores: number[], opts?: StruggleDetectorOptions): StruggleSignal;
//# sourceMappingURL=ralph-struggle-detector.d.ts.map