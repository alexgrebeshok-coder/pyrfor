import { spawn as nodeSpawn } from 'node:child_process';
export interface FCRunOptions {
    prompt: string;
    workdir?: string;
    model?: string;
    effort?: 'low' | 'medium' | 'high' | 'max';
    maxTurns?: number;
    maxBudgetUsd?: number;
    fallbackModel?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    tools?: string[];
    systemPrompt?: string;
    appendSystemPrompt?: string;
    jsonSchema?: object | string;
    permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan';
    bare?: boolean;
    noMemory?: boolean;
    noPersist?: boolean;
    addDirs?: string[];
    resume?: string;
    resumeLast?: boolean;
    forkSession?: boolean;
    timeoutSec?: number;
    wrapperPath?: string;
    spawnFn?: typeof nodeSpawn;
    signal?: AbortSignal;
}
export type FCEvent = {
    type: 'wrapper_event';
    name: string;
    raw: any;
} | {
    type: 'stream_event';
    event: any;
    raw: any;
} | {
    type: 'assistant';
    message: any;
    raw: any;
} | {
    type: 'tool_use';
    name: string;
    input: any;
    raw: any;
} | {
    type: 'result';
    result: any;
    raw: any;
} | {
    type: 'stderr';
    line: string;
} | {
    type: 'unknown';
    raw: any;
};
export interface FCEnvelope {
    status: 'success' | 'error' | string;
    output?: string;
    error?: string | null;
    workdir?: string;
    model?: string;
    requestedModel?: string;
    durationMs?: number;
    sessionId?: string | null;
    costUsd?: number | null;
    usage?: any;
    stopReason?: string | null;
    filesTouched: string[];
    commandsRun: string[];
    exitCode: number;
    maxTurns?: number | null;
    effort?: string | null;
    maxBudgetUsd?: number | null;
    fallbackModel?: string | null;
    allowedTools?: string[];
    disallowedTools?: string[];
    tools?: string[];
    rawResult?: any;
    raw: any;
}
export interface FCRunResult {
    envelope: FCEnvelope;
    events: FCEvent[];
    exitCode: number;
}
export interface FCHandle {
    events(): AsyncIterable<FCEvent>;
    complete(): Promise<FCRunResult>;
    abort(reason?: string): void;
}
export declare function runFreeClaude(opts: FCRunOptions): FCHandle;
//# sourceMappingURL=pyrfor-fc-adapter.d.ts.map