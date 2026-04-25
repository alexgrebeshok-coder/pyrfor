/**
 * pyrfor-fc-control.ts
 *
 * Mid-task control for FreeClaude sessions: abort, resume, and prompt injection.
 */
import type { FCRunOptions, FCEnvelope, FCHandle } from './pyrfor-fc-adapter';
export interface SessionRecord {
    sessionId: string;
    taskId?: string;
    endedAt: number;
    envelope: FCEnvelope;
    abortReason?: string;
}
export interface FcControllerOptions {
    /** Adapter spawner for testability. Default: runFreeClaude from pyrfor-fc-adapter. */
    runFn?: (opts: FCRunOptions) => FCHandle;
    /** Clock. */
    now?: () => number;
    /** Logger. */
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}
export interface InjectionPlan {
    /**
     * Correction text appended to FC's system prompt on resume.
     * Will be passed via --append-system-prompt.
     */
    correction: string;
    /**
     * Optional new model to switch to on resume.
     */
    model?: string;
    /**
     * Optional max-turns override for the resumed call.
     */
    maxTurns?: number;
    /**
     * Reason logged to controller.history.
     */
    reason: string;
}
export interface RunningSession {
    sessionId?: string;
    taskId?: string;
    baseOptions: FCRunOptions;
    handle: FCHandle;
    startedAt: number;
}
export interface FcController {
    /**
     * Start a new FC session. Captures handle internally.
     * Returns the running session token (used to abort/inject).
     */
    start(opts: FCRunOptions, taskId?: string): RunningSession;
    /**
     * Wait for the running session to complete; returns envelope. Records into history.
     */
    await(running: RunningSession): Promise<FCEnvelope>;
    /**
     * Abort the running session (SIGTERM via FCHandle.abort), record reason.
     * Returns the (error) envelope from FCHandle.complete().
     */
    abort(running: RunningSession, reason: string): Promise<FCEnvelope>;
    /**
     * Mid-task injection:
     *   1. abort() the running session, capturing its sessionId.
     *   2. resume with the same baseOptions but with correction applied.
     *   3. return the new RunningSession.
     */
    inject(running: RunningSession, plan: InjectionPlan, opts?: {
        continuationPrompt?: string;
    }): Promise<RunningSession>;
    /**
     * Resume a previously-ended session by id. Useful after error recovery.
     */
    resumeFromHistory(sessionId: string, prompt: string, overrides?: Partial<FCRunOptions>): RunningSession;
    /** All completed sessions (success/error/aborted). */
    history(): SessionRecord[];
}
export declare function createFcController(ctrlOpts?: FcControllerOptions): FcController;
//# sourceMappingURL=pyrfor-fc-control.d.ts.map