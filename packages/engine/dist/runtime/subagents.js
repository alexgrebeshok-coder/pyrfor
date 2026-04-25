/**
 * Subagent Spawner — Fork sessions for background tasks
 *
 * Features:
 * - Fork a session (copy context, system prompt)
 * - Execute task in background
 * - Announce result back to parent session
 * - Track active subagents, limit to 5 concurrent
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../observability/logger.js';
// ============================================
// Subagent Manager
// ============================================
export class SubagentSpawner {
    constructor(maxConcurrent = 5) {
        this.tasks = new Map();
        this.activeExecutions = new Set();
        this.abortControllers = new Map();
        this.executor = null;
        this.maxConcurrent = maxConcurrent;
    }
    /**
     * Set the executor function (called by runtime during init)
     */
    setExecutor(executor) {
        this.executor = executor;
    }
    /**
     * Get count of active (running) subagents
     */
    get activeCount() {
        return this.activeExecutions.size;
    }
    /**
     * Get total task count
     */
    get totalCount() {
        return this.tasks.size;
    }
    /**
     * Spawn a new subagent task
     */
    spawn(options) {
        // Check concurrent limit
        if (this.activeExecutions.size >= this.maxConcurrent) {
            logger.warn('Subagent spawn rejected: max concurrent reached', {
                active: this.activeExecutions.size,
                max: this.maxConcurrent,
            });
            return {
                success: false,
                error: `Maximum concurrent subagents (${this.maxConcurrent}) reached. Try again later.`,
            };
        }
        const taskId = this.generateTaskId();
        // Copy relevant context from parent
        const recentMessages = options.fullHistory
            ? options.parentSession.messages.filter(m => m.role !== 'system')
            : options.parentSession.messages.filter(m => m.role !== 'system').slice(-5);
        const task = {
            id: taskId,
            task: options.task,
            parentSessionId: options.parentSession.id,
            context: {
                systemPrompt: options.parentSession.systemPrompt,
                recentMessages,
                metadata: Object.assign({}, options.parentSession.metadata),
            },
            status: 'pending',
            createdAt: new Date(),
            provider: options.provider,
            maxTokens: options.maxTokens,
            limits: options.limits,
        };
        this.tasks.set(taskId, task);
        // Execute immediately (or queue if no executor)
        if (this.executor) {
            this.executeTask(task);
        }
        else {
            logger.warn('No subagent executor set, task queued', { taskId });
        }
        logger.info('Subagent spawned', {
            taskId,
            parentSessionId: options.parentSession.id,
            taskPreview: options.task.slice(0, 100),
        });
        return { success: true, taskId };
    }
    /**
     * Execute a task
     */
    executeTask(task) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.executor) {
                task.status = 'failed';
                task.error = 'No executor configured';
                return;
            }
            const controller = new AbortController();
            this.abortControllers.set(task.id, controller);
            this.activeExecutions.add(task.id);
            task.status = 'running';
            task.startedAt = new Date();
            const startMs = Date.now();
            try {
                // Race executor against abort signal so cancel() terminates in-flight work.
                const abortPromise = new Promise((_, reject) => {
                    controller.signal.addEventListener('abort', () => reject(new DOMException('Subagent aborted', 'AbortError')), { once: true });
                });
                const result = yield Promise.race([this.executor(task), abortPromise]);
                // Guard against the case where cancel() fired but executor already resolved.
                // Cast through unknown because TS narrows task.status to 'running' after the assignment above.
                if (task.status === 'cancelled')
                    return;
                task.result = result;
                task.status = 'completed';
                task.completedAt = new Date();
                logger.info('Subagent completed', {
                    taskId: task.id,
                    durationMs: Date.now() - startMs,
                    resultPreview: result.slice(0, 100),
                });
            }
            catch (error) {
                // If cancel() already marked the task, don't overwrite its status.
                if (task.status === 'cancelled')
                    return;
                task.error = error instanceof Error ? error.message : String(error);
                task.status = 'failed';
                task.completedAt = new Date();
                logger.error('Subagent failed', {
                    taskId: task.id,
                    error: task.error,
                });
            }
            finally {
                this.abortControllers.delete(task.id);
                this.activeExecutions.delete(task.id);
            }
        });
    }
    /**
     * Get task status and result
     */
    getTask(taskId) {
        return this.tasks.get(taskId);
    }
    /**
     * Get all tasks for a parent session
     */
    getTasksByParent(parentSessionId) {
        return Array.from(this.tasks.values()).filter(t => t.parentSessionId === parentSessionId);
    }
    /**
     * Wait for a task to complete
     */
    waitForTask(taskId_1) {
        return __awaiter(this, arguments, void 0, function* (taskId, timeoutMs = 120000) {
            const task = this.tasks.get(taskId);
            if (!task) {
                return { success: false, taskId, error: 'Task not found' };
            }
            // If already done, return immediately
            if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                return {
                    success: task.status === 'completed',
                    taskId,
                    result: task.result,
                    error: task.error,
                    durationMs: task.completedAt && task.startedAt
                        ? task.completedAt.getTime() - task.startedAt.getTime()
                        : undefined,
                };
            }
            // Poll for completion
            const startMs = Date.now();
            while (Date.now() - startMs < timeoutMs) {
                yield new Promise(resolve => setTimeout(resolve, 100));
                const current = this.tasks.get(taskId);
                if (!current) {
                    return { success: false, taskId, error: 'Task disappeared' };
                }
                if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
                    return {
                        success: current.status === 'completed',
                        taskId,
                        result: current.result,
                        error: current.error,
                        durationMs: current.completedAt && current.startedAt
                            ? current.completedAt.getTime() - current.startedAt.getTime()
                            : undefined,
                    };
                }
            }
            return { success: false, taskId, error: 'Timeout waiting for subagent' };
        });
    }
    /**
     * Cancel a pending or running task. Aborts any in-flight execution.
     */
    cancel(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            return false; // Already finished
        }
        task.status = 'cancelled';
        task.completedAt = new Date();
        this.activeExecutions.delete(taskId);
        // Abort in-flight executor if one is running.
        const controller = this.abortControllers.get(taskId);
        if (controller) {
            controller.abort();
        }
        logger.info('Subagent cancelled', { taskId });
        return true;
    }
    /**
     * Cancel all non-terminal (pending or running) tasks.
     */
    cancelAll() {
        for (const task of this.tasks.values()) {
            if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
                this.cancel(task.id);
            }
        }
    }
    /**
     * Clean up old completed tasks
     */
    cleanup(maxAgeMs = 60 * 60 * 1000) {
        const now = Date.now();
        let removed = 0;
        for (const [id, task] of this.tasks) {
            if (task.completedAt && now - task.completedAt.getTime() > maxAgeMs) {
                this.tasks.delete(id);
                removed++;
            }
        }
        return removed;
    }
    /**
     * Get stats
     */
    getStats() {
        const tasks = Array.from(this.tasks.values());
        return {
            total: tasks.length,
            active: tasks.filter(t => t.status === 'running').length,
            pending: tasks.filter(t => t.status === 'pending').length,
            completed: tasks.filter(t => t.status === 'completed').length,
            failed: tasks.filter(t => t.status === 'failed').length,
            cancelled: tasks.filter(t => t.status === 'cancelled').length,
        };
    }
    /**
     * Generate unique task ID
     */
    generateTaskId() {
        return `sub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
}
// ============================================
// Singleton instance
// ============================================
export const subagentSpawner = new SubagentSpawner();
