/**
 * pyrfor-trajectory-recorder.ts
 *
 * JSONL trajectory recorder for FreeClaude (FC) sessions in Pyrfor.
 * Each session gets one append-only JSONL file at <dir>/<sessionId>.jsonl.
 */
import type { FCEvent, FCEnvelope } from './pyrfor-fc-adapter.js';
import type { FcEvent } from './pyrfor-event-reader.js';
export type TrajectoryRecord = {
    kind: 'session_open';
    sessionId: string;
    taskId?: string;
    cwd?: string;
    model?: string;
    startedAt: number;
    meta?: Record<string, unknown>;
} | {
    kind: 'raw';
    sessionId: string;
    ts: number;
    event: FCEvent;
} | {
    kind: 'typed';
    sessionId: string;
    ts: number;
    event: FcEvent;
} | {
    kind: 'note';
    sessionId: string;
    ts: number;
    level: 'info' | 'warn' | 'error';
    text: string;
    meta?: Record<string, unknown>;
} | {
    kind: 'envelope';
    sessionId: string;
    ts: number;
    envelope: FCEnvelope;
} | {
    kind: 'session_close';
    sessionId: string;
    ts: number;
    status: 'success' | 'error' | 'aborted';
    reason?: string;
};
export interface TrajectoryFs {
    mkdir: (p: string, opts: {
        recursive: boolean;
    }) => Promise<void>;
    appendFile: (p: string, data: string) => Promise<void>;
    readFile: (p: string, enc: 'utf8') => Promise<string>;
    rename: (a: string, b: string) => Promise<void>;
    stat: (p: string) => Promise<{
        size: number;
        mtimeMs: number;
    }>;
    readdir: (p: string) => Promise<string[]>;
}
export interface TrajectoryRecorderOptions {
    /** Directory for trajectories. Default: ~/.pyrfor/trajectories. */
    dir?: string;
    /** Filesystem (for tests). Default: node:fs/promises. */
    fs?: TrajectoryFs;
    /** Clock. */
    now?: () => number;
    /** If true (default), open a stream per session lazily on first record. If false, must call openSession() explicitly. */
    autoOpen?: boolean;
    /** If true, also gzip on close. Default false. */
    gzipOnClose?: boolean;
}
export interface TrajectoryRecorder {
    openSession(sessionId: string, meta?: {
        taskId?: string;
        cwd?: string;
        model?: string;
        meta?: Record<string, unknown>;
    }): Promise<void>;
    recordRaw(sessionId: string, event: FCEvent): Promise<void>;
    recordTyped(sessionId: string, event: FcEvent): Promise<void>;
    note(sessionId: string, level: 'info' | 'warn' | 'error', text: string, meta?: Record<string, unknown>): Promise<void>;
    recordEnvelope(sessionId: string, envelope: FCEnvelope): Promise<void>;
    closeSession(sessionId: string, status: 'success' | 'error' | 'aborted', reason?: string): Promise<void>;
    /** Path of a session's file (whether open or closed). */
    pathFor(sessionId: string): string;
    /** List session ids by scanning dir. */
    listSessions(): Promise<string[]>;
    /** Read full session file as parsed records. */
    readSession(sessionId: string): Promise<TrajectoryRecord[]>;
}
export declare function createTrajectoryRecorder(opts?: TrajectoryRecorderOptions): TrajectoryRecorder;
//# sourceMappingURL=pyrfor-trajectory-recorder.d.ts.map