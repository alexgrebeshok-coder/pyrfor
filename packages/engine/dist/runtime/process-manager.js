/**
 * ProcessManager — background process management for Pyrfor runtime.
 *
 * Provides spawn/poll/kill/list/cleanup operations over child processes.
 * Children are detached from the daemon's process group so SIGINT to the
 * daemon doesn't auto-kill them; explicit cleanup() tears them all down on
 * shutdown.
 */
import { spawn as cpSpawn } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../observability/logger.js';
// ============================================
// ProcessManager
// ============================================
export class ProcessManager extends EventEmitter {
    constructor(opts = {}) {
        var _a, _b, _c;
        super();
        this.processes = new Map();
        this.defaultTimeoutMs = (_a = opts.defaultTimeoutMs) !== null && _a !== void 0 ? _a : 300000;
        this.memoryLimitMB = (_b = opts.memoryLimitMB) !== null && _b !== void 0 ? _b : 512;
        this.maxBufferLines = (_c = opts.maxBufferLines) !== null && _c !== void 0 ? _c : 1000;
    }
    /**
     * Spawn a background process. Returns its PID immediately.
     */
    spawn(opts) {
        var _a, _b, _c;
        const { command, args = [], cwd = process.cwd(), timeoutSec, memoryLimitMB = this.memoryLimitMB, env, } = opts;
        const timeoutMs = timeoutSec != null ? timeoutSec * 1000 : this.defaultTimeoutMs;
        const child = cpSpawn(command, args, {
            cwd,
            env: env ? Object.assign(Object.assign({}, process.env), env) : process.env,
            // Detach so SIGINT to the daemon doesn't propagate to children
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (child.pid == null) {
            throw new Error(`Failed to spawn process: ${command} ${args.join(' ')}`);
        }
        const pid = child.pid;
        const managed = {
            pid,
            command,
            args,
            cwd,
            startedAt: new Date(),
            status: 'running',
            stdoutBuf: [],
            stderrBuf: [],
            child,
            memoryLimitMB,
        };
        this.processes.set(pid, managed);
        // Capture stdout line-by-line with rolling buffer
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line === '')
                    continue;
                managed.stdoutBuf.push(line);
                if (managed.stdoutBuf.length > this.maxBufferLines) {
                    managed.stdoutBuf.shift();
                }
            }
        });
        // Capture stderr line-by-line with rolling buffer
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line === '')
                    continue;
                managed.stderrBuf.push(line);
                if (managed.stderrBuf.length > this.maxBufferLines) {
                    managed.stderrBuf.shift();
                }
            }
        });
        // Schedule timeout
        const timeoutHandle = setTimeout(() => {
            if (managed.status === 'running') {
                logger.warn('[process-manager] Process timed out, sending SIGTERM', { pid, command });
                managed.status = 'timeout';
                try {
                    child.kill('SIGTERM');
                }
                catch (_a) {
                    // ignore
                }
                // SIGKILL fallback after 5s
                setTimeout(() => {
                    if (managed.status === 'timeout') {
                        try {
                            child.kill('SIGKILL');
                        }
                        catch (_a) {
                            // ignore
                        }
                    }
                }, 5000);
            }
        }, timeoutMs);
        // Node.js: unref timeout so it doesn't keep the event loop alive
        (_c = timeoutHandle.unref) === null || _c === void 0 ? void 0 : _c.call(timeoutHandle);
        managed.timeoutHandle = timeoutHandle;
        child.on('exit', (code, signal) => {
            if (managed.timeoutHandle) {
                clearTimeout(managed.timeoutHandle);
                managed.timeoutHandle = undefined;
            }
            // Only update status if not already set to timeout/killed
            if (managed.status === 'running') {
                managed.status = signal ? 'killed' : 'exited';
            }
            managed.exitCode = code !== null && code !== void 0 ? code : undefined;
            logger.debug('[process-manager] Process exited', { pid, code, signal, status: managed.status });
        });
        child.on('error', (err) => {
            logger.error('[process-manager] Process error', { pid, error: err.message });
            if (managed.status === 'running') {
                managed.status = 'exited';
                managed.exitCode = -1;
            }
        });
        logger.info('[process-manager] Spawned process', { pid, command, args });
        return { pid };
    }
    /**
     * Poll a process for its current status and output tail.
     */
    poll(pid, tail = 50) {
        const managed = this.processes.get(pid);
        if (!managed) {
            throw new Error(`Unknown PID: ${pid}`);
        }
        const runtimeMs = Date.now() - managed.startedAt.getTime();
        const stdoutTail = managed.stdoutBuf.slice(-tail);
        const stderrTail = managed.stderrBuf.slice(-tail);
        return {
            pid,
            status: managed.status,
            exitCode: managed.exitCode,
            stdoutTail,
            stderrTail,
            runtimeMs,
        };
    }
    /**
     * Kill a process by PID. Schedules SIGKILL fallback after 5s for SIGTERM.
     */
    kill(pid, signal = 'SIGTERM') {
        var _a;
        const managed = this.processes.get(pid);
        if (!managed) {
            return { pid, signal, killed: false };
        }
        if (managed.status !== 'running') {
            return { pid, signal, killed: false };
        }
        let killed = false;
        try {
            managed.child.kill(signal);
            managed.status = 'killed';
            killed = true;
        }
        catch (err) {
            logger.warn('[process-manager] Failed to kill process', {
                pid,
                signal,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        // Schedule SIGKILL fallback for SIGTERM
        if (signal === 'SIGTERM' && killed) {
            const fallback = setTimeout(() => {
                if (managed.status === 'killed') {
                    try {
                        managed.child.kill('SIGKILL');
                    }
                    catch (_a) {
                        // ignore
                    }
                }
            }, 5000);
            (_a = fallback.unref) === null || _a === void 0 ? void 0 : _a.call(fallback);
        }
        return { pid, signal, killed };
    }
    /**
     * List all tracked processes.
     */
    list() {
        return Array.from(this.processes.values()).map((m) => ({
            pid: m.pid,
            command: m.command,
            status: m.status,
            runtimeMs: Date.now() - m.startedAt.getTime(),
        }));
    }
    /**
     * Kill all running children. Called on daemon shutdown.
     */
    cleanup() {
        logger.info('[process-manager] Cleanup: killing all running processes');
        for (const managed of this.processes.values()) {
            if (managed.status === 'running') {
                if (managed.timeoutHandle) {
                    clearTimeout(managed.timeoutHandle);
                    managed.timeoutHandle = undefined;
                }
                try {
                    managed.child.kill('SIGTERM');
                    managed.status = 'killed';
                }
                catch (_a) {
                    // ignore
                }
            }
        }
        this.processes.clear();
    }
}
// Singleton
export const processManager = new ProcessManager();
