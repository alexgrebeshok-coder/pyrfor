/**
 * ProcessManager — background process management for Pyrfor runtime.
 *
 * Provides spawn/poll/kill/list/cleanup operations over child processes.
 * Children are detached from the daemon's process group so SIGINT to the
 * daemon doesn't auto-kill them; explicit cleanup() tears them all down on
 * shutdown.
 */
import { type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
export type ProcessStatus = 'running' | 'exited' | 'killed' | 'timeout';
export interface ManagedProcess {
    pid: number;
    command: string;
    args: string[];
    cwd: string;
    startedAt: Date;
    status: ProcessStatus;
    exitCode?: number;
    stdoutBuf: string[];
    stderrBuf: string[];
    child: ChildProcess;
    timeoutHandle?: ReturnType<typeof setTimeout>;
    memoryLimitMB: number;
}
export interface SpawnOptions {
    command: string;
    args?: string[];
    cwd?: string;
    /** Timeout in seconds (default: 300). */
    timeoutSec?: number;
    memoryLimitMB?: number;
    env?: Record<string, string>;
}
export interface SpawnResult {
    pid: number;
}
export interface PollResult {
    pid: number;
    status: ProcessStatus;
    exitCode?: number;
    stdoutTail: string[];
    stderrTail: string[];
    runtimeMs: number;
    memoryMB?: number;
}
export interface KillResult {
    pid: number;
    signal: string;
    killed: boolean;
}
export interface ListEntry {
    pid: number;
    command: string;
    status: ProcessStatus;
    runtimeMs: number;
}
export interface ProcessManagerOptions {
    defaultTimeoutMs?: number;
    memoryLimitMB?: number;
    maxBufferLines?: number;
}
export declare class ProcessManager extends EventEmitter {
    private readonly processes;
    private readonly defaultTimeoutMs;
    private readonly memoryLimitMB;
    private readonly maxBufferLines;
    constructor(opts?: ProcessManagerOptions);
    private pushBufferedLine;
    private appendChunk;
    private flushRemainder;
    /**
     * Spawn a background process. Returns its PID immediately.
     */
    spawn(opts: SpawnOptions): SpawnResult;
    /**
     * Poll a process for its current status and output tail.
     */
    poll(pid: number, tail?: number): PollResult;
    /**
     * Kill a process by PID. Schedules SIGKILL fallback after 5s for SIGTERM.
     */
    kill(pid: number, signal?: string): KillResult;
    /**
     * List all tracked processes.
     */
    list(): ListEntry[];
    /**
     * Kill all running children. Called on daemon shutdown.
     */
    cleanup(): void;
}
export declare const processManager: ProcessManager;
//# sourceMappingURL=process-manager.d.ts.map