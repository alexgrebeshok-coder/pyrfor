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
import { logger } from '../observability/logger';

// ============================================
// Types
// ============================================

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

// ============================================
// Subagent Manager
// ============================================

export class SubagentSpawner {
  private tasks: Map<string, SubagentTask> = new Map();
  private activeExecutions: Set<string> = new Set();
  private readonly maxConcurrent: number;
  private executor: SubagentExecutor | null = null;

  constructor(maxConcurrent: number = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Set the executor function (called by runtime during init)
   */
  setExecutor(executor: SubagentExecutor): void {
    this.executor = executor;
  }

  /**
   * Get count of active (running) subagents
   */
  get activeCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Get total task count
   */
  get totalCount(): number {
    return this.tasks.size;
  }

  /**
   * Spawn a new subagent task
   */
  spawn(options: SubagentOptions): { success: boolean; taskId?: string; queued?: boolean; error?: string } {
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

    const task: SubagentTask = {
      id: taskId,
      task: options.task,
      parentSessionId: options.parentSession.id,
      context: {
        systemPrompt: options.parentSession.systemPrompt,
        recentMessages,
        metadata: { ...options.parentSession.metadata },
      },
      status: 'pending',
      createdAt: new Date(),
      provider: options.provider,
      maxTokens: options.maxTokens,
    };

    this.tasks.set(taskId, task);

    // Execute immediately (or queue if no executor)
    if (this.executor) {
      this.executeTask(task);
    } else {
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
  private async executeTask(task: SubagentTask): Promise<void> {
    if (!this.executor) {
      task.status = 'failed';
      task.error = 'No executor configured';
      return;
    }

    this.activeExecutions.add(task.id);
    task.status = 'running';
    task.startedAt = new Date();

    const startMs = Date.now();

    try {
      const result = await this.executor(task);
      task.result = result;
      task.status = 'completed';
      task.completedAt = new Date();

      logger.info('Subagent completed', {
        taskId: task.id,
        durationMs: Date.now() - startMs,
        resultPreview: result.slice(0, 100),
      });

    } catch (error) {
      task.error = error instanceof Error ? error.message : String(error);
      task.status = 'failed';
      task.completedAt = new Date();

      logger.error('Subagent failed', {
        taskId: task.id,
        error: task.error,
      });

    } finally {
      this.activeExecutions.delete(task.id);
    }
  }

  /**
   * Get task status and result
   */
  getTask(taskId: string): SubagentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks for a parent session
   */
  getTasksByParent(parentSessionId: string): SubagentTask[] {
    return Array.from(this.tasks.values()).filter(
      t => t.parentSessionId === parentSessionId
    );
  }

  /**
   * Wait for a task to complete
   */
  async waitForTask(taskId: string, timeoutMs: number = 120000): Promise<SubagentResult> {
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
      await new Promise(resolve => setTimeout(resolve, 100));

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
  }

  /**
   * Cancel a pending or running task
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return false; // Already finished
    }

    task.status = 'cancelled';
    task.completedAt = new Date();
    this.activeExecutions.delete(taskId);

    logger.info('Subagent cancelled', { taskId });
    return true;
  }

  /**
   * Clean up old completed tasks
   */
  cleanup(maxAgeMs: number = 60 * 60 * 1000): number {
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
  getStats(): {
    total: number;
    active: number;
    pending: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
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
  private generateTaskId(): string {
    return `sub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Singleton instance
// ============================================

export const subagentSpawner = new SubagentSpawner();
