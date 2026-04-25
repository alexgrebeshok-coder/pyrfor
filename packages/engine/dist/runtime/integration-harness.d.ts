/**
 * integration-harness.ts — Pyrfor integration-test composition harness.
 *
 * Wires runtime modules together with deterministic fakes (FakeLlm,
 * FakeClock) so integration tests can run without external services.
 *
 * DO NOT modify cli.ts or index.ts — this module only composes existing ones.
 */
export type FakeLlmCall = {
    prompt: string;
    response: string;
    toolCalls?: {
        name: string;
        args: any;
    }[];
};
export type FakeLlm = {
    /** Enqueue a scripted response. */
    enqueue(call: FakeLlmCall): void;
    /** Dequeue and return the next scripted response. Throws if queue empty. */
    complete(prompt: string): Promise<{
        text: string;
        toolCalls?: any[];
    }>;
    /** All calls that have been completed (in order). */
    calls: FakeLlmCall[];
    stats(): {
        totalCalls: number;
        pending: number;
    };
};
export declare function createFakeLlm(): FakeLlm;
export type FakeClock = {
    now(): number;
    advance(ms: number): void;
    setTimeout(cb: () => void, ms: number): number;
    clearTimeout(id: number): void;
};
export declare function createFakeClock(start?: number): FakeClock;
export type SupportedModule = 'memory-wiki' | 'skill-effectiveness' | 'runtime-profiler' | 'cron-persistence' | 'guardrails' | 'cost-aware-dag';
export type HarnessOpts = {
    modules?: SupportedModule[];
    tmpRoot?: string;
};
export type Harness = {
    llm: FakeLlm;
    clock: FakeClock;
    /** Dedicated temp directory for this harness instance. */
    tmpDir: string;
    /** Loaded module instances keyed by module name. */
    modules: Record<string, any>;
    /** Remove tmpDir and flush pending writes. */
    cleanup(): Promise<void>;
};
export declare function createIntegrationHarness(opts?: HarnessOpts): Promise<Harness>;
export declare function snapshotHarness(h: Harness): {
    llmStats: {
        totalCalls: number;
        pending: number;
    };
    moduleNames: string[];
    tmpDir: string;
};
//# sourceMappingURL=integration-harness.d.ts.map