import type { IterationResult } from './pyrfor-fc-ralph.js';
export interface ContextRotateInput {
    iter: number;
    history: IterationResult[];
    basePrompt: string;
    lessonsBuilder?: () => Promise<string>;
}
export interface RotatedContext {
    appendSystemPrompt?: string;
    resumeSessionId?: string;
    prompt: string;
}
export declare function rotateContext(input: ContextRotateInput): Promise<RotatedContext>;
//# sourceMappingURL=pyrfor-fc-context-rotate.d.ts.map