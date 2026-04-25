export interface ContextRotatorOptions {
    maxTokens?: number;
    estimateTokens?: (text: string) => number;
    summariseFn?: (text: string, opts: {
        maxTokens: number;
    }) => Promise<string> | string;
    summaryMaxTokens?: number;
}
export interface RotationDecision {
    rotate: boolean;
    reason: string;
    tokensEstimated: number;
    summary?: string;
}
export interface ContextRotator {
    shouldRotate(currentContext: string): RotationDecision;
    rotate(currentContext: string): Promise<{
        summary: string;
        tokensEstimated: number;
    }>;
    estimate(text: string): number;
}
export declare function defaultSummariser(text: string, opts: {
    maxTokens: number;
    estimate: (s: string) => number;
}): string;
export declare function createContextRotator(opts?: ContextRotatorOptions): ContextRotator;
//# sourceMappingURL=ralph-context-rotator.d.ts.map