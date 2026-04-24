/**
 * Subagent Spawner — Fork sessions for background tasks
 *
 * Features:
 * - Fork a session (copy context, system prompt)
 * - Execute task in background
 * - Announce result back to parent session
 * - Track active subagents, limit to 5 concurrent
 */
import type { Session } from './session';
import type { Message } from '../ai/providers/base';
export interface SubagentTask {
    /** Unique task ID */
    id: string;
    /** Task description/prompt */
    task: string;
    /** Parent session ID */
    parentSessionId: string;
    /** Copied context from parent */
    context: {
        systemPrompt: string;
        recentMessages: Message[];
        metadata: Record<string, unknown>;
    };
    /** Status */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    /** Result */
    result?: string;
    /** Error message */
    error?: string;
    /** Creation time */
    createdAt: Date;
    /** Start time */
    startedAt?: Date;
    /** Completion time */
    completedAt?: Date;
    /** Provider preference */
    provider?: string;
    /** Max tokens for response */
    maxTokens?: number;
}
export interface SubagentOptions {
    /** Task description */
    task: string;
    /** Parent session */
    parentSession: Session;
    /** Provider to use */
    provider?: string;
    /** Max tokens for response */
    maxTokens?: number;
    /** Whether to include full message history (default: last 5 messages) */
    fullHistory?: boolean;
}
export interface SubagentResult {
    success: boolean;
    taskId: string;
    result?: string;
    error?: string;
    durationMs?: number;
}
type SubagentExecutor = (task: SubagentTask) => Promise<string>;
export declare class SubagentSpawner {
    private tasks;
    private activeExecutions;
    private readonly maxConcurrent;
    private executor;
    constructor(maxConcurrent?: number);
    /**
     * Set the executor function (called by runtime during init)
     */
    setExecutor(executor: SubagentExecutor): void;
    /**
     * Get count of active (running) subagents
     */
    get activeCount(): number;
    /**
     * Get total task count
     */
    get totalCount(): number;
    /**
     * Spawn a new subagent task
     */
    spawn(options: SubagentOptions): {
        success: boolean;
        taskId?: string;
        queued?: boolean;
        error?: string;
    };
    /**
     * Execute a task
     */
    private executeTask;
    /**
     * Get task status and result
     */
    getTask(taskId: string): SubagentTask | undefined;
    /**
     * Get all tasks for a parent session
     */
    getTasksByParent(parentSessionId: string): SubagentTask[];
    /**
     * Wait for a task to complete
     */
    waitForTask(taskId: string, timeoutMs?: number): Promise<SubagentResult>;
    /**
     * Cancel a pending or running task
     */
    cancel(taskId: string): boolean;
    /**
     * Clean up old completed tasks
     */
    cleanup(maxAgeMs?: number): number;
    /**
     * Get stats
     */
    getStats(): {
        total: number;
        active: number;
        pending: number;
        completed: number;
        failed: number;
        cancelled: number;
    };
    /**
     * Generate unique task ID
     */
    private generateTaskId;
}
export declare const subagentSpawner: SubagentSpawner;
export {};
//# sourceMappingURL=subagents.d.ts.map