import type { FCEvent } from './pyrfor-fc-adapter';
export type FcEvent = {
    type: 'SessionStart';
    sessionId?: string;
    model?: string;
    ts: number;
} | {
    type: 'SessionEnd';
    sessionId?: string;
    status: 'success' | 'error' | 'aborted';
    costUsd?: number;
    usage?: any;
    stopReason?: string;
    ts: number;
} | {
    type: 'Thinking';
    text: string;
    ts: number;
} | {
    type: 'ToolCallStart';
    toolName: string;
    toolUseId?: string;
    input: any;
    ts: number;
} | {
    type: 'ToolCallEnd';
    toolName: string;
    toolUseId?: string;
    output?: any;
    isError?: boolean;
    ts: number;
} | {
    type: 'FileRead';
    path: string;
    toolUseId?: string;
    ts: number;
} | {
    type: 'FileWrite';
    path: string;
    toolUseId?: string;
    ts: number;
} | {
    type: 'FileEdit';
    path: string;
    toolUseId?: string;
    ts: number;
} | {
    type: 'FileDelete';
    path: string;
    toolUseId?: string;
    ts: number;
} | {
    type: 'BashCommand';
    command: string;
    toolUseId?: string;
    ts: number;
} | {
    type: 'TestRun';
    command: string;
    passed?: number;
    total?: number;
    ts: number;
} | {
    type: 'CompilationError';
    message: string;
    toolName?: string;
    ts: number;
} | {
    type: 'RuntimeError';
    message: string;
    toolName?: string;
    ts: number;
} | {
    type: 'HookEvent';
    hookName: string;
    payload: any;
    ts: number;
} | {
    type: 'Unknown';
    raw: any;
    ts: number;
};
export interface ReaderOptions {
    now?: () => number;
    include?: Set<FcEvent['type']>;
}
export declare class FcEventReader {
    private now;
    private include?;
    private sessionStarted;
    private textAccumulators;
    private toolCalls;
    private toolResultAccumulators;
    private toolUseCounter;
    constructor(opts?: ReaderOptions);
    read(raw: FCEvent): FcEvent[];
    flush(): FcEvent[];
    private emit;
    private deriveFileEvents;
    private isTestCommand;
    private detectFileDeletes;
    private detectError;
    private detectCompilationErrors;
    private detectRuntimeErrors;
}
export declare function readAll(events: FCEvent[], opts?: ReaderOptions): FcEvent[];
//# sourceMappingURL=pyrfor-event-reader.d.ts.map