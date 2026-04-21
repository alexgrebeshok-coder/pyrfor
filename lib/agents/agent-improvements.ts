/**
 * Agent Improvements - Error handling, retry, progress, fallback
 *
 * @deprecated `ImprovedAgentExecutor` is kept for backward compatibility
 * with the remaining legacy callers (`lib/orchestration/heartbeat-executor.ts`
 * and `app/api/orchestration/ask-project/route.ts`). New code MUST call
 * `runAgentExecution` (`lib/ai/agent-executor.ts`) directly — see
 * `app/api/agents/execute/route.ts` for the migration pattern.
 *
 * `SmartAgentSelector` and `AgentRateLimiter` remain first-class utilities
 * and are still safe to import.
 */

import { AIRouter, getRouter } from '../ai/providers';
import type { AgentContext } from './base-agent';
import { memoryManager } from '../memory/memory-manager';
import { runAgentExecution } from '../ai/agent-executor';
import { logger } from '../logger';

// ============================================
// Types
// ============================================

export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface ProgressCallback {
  (progress: {
    stage: 'starting' | 'executing' | 'retrying' | 'completed' | 'failed';
    message: string;
    attempt?: number;
    maxAttempts?: number;
    error?: string;
  }): void;
}

export interface FallbackConfig {
  enabled: boolean;
  providers: string[]; // ["zai", "openrouter", "mock"]
  fallbackOnError: boolean;
}

export interface AgentExecutionOptions {
  retry?: Partial<RetryConfig>;
  fallback?: Partial<FallbackConfig>;
  timeout?: number;
  onProgress?: ProgressCallback;
  saveToMemory?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  content: string;
  data?: unknown;
  tokens: number;
  cost: number;
  duration: number;
  attempts: number;
  provider: string;
  model: string;
  error?: string;
}

// ============================================
// Default Configs
// ============================================

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'socket hang up',
    'rate_limit',
    'rate limit',
    'overloaded',
    'timeout',
    '429',
    '502',
    '503',
    '504',
  ],
};

const DEFAULT_FALLBACK: FallbackConfig = {
  enabled: true,
  providers: ['openrouter', 'zai', 'mock'],
  fallbackOnError: true,
};

// ============================================
// Agent Executor with Improvements
// ============================================

export class ImprovedAgentExecutor {
  private router: AIRouter;

  constructor(injectedRouter?: AIRouter) {
    // Prefer the singleton to benefit from shared provider state and circuit
    // breaker counters across the process.
    this.router = injectedRouter ?? getRouter();
  }

  /**
   * Execute with retry + fallback + progress
   */
  async execute(
    agentId: string,
    task: string,
    context: AgentContext,
    options: AgentExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const retryConfig = { ...DEFAULT_RETRY, ...options.retry };
    const fallbackConfig = { ...DEFAULT_FALLBACK, ...options.fallback };
    const onProgress = options.onProgress;

    let lastError: string | undefined;
    let attempts = 0;

    // Try each provider in fallback chain
    for (const provider of fallbackConfig.providers) {
      attempts++;

      // Retry loop for current provider
      for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
        try {
          // Progress: starting
          onProgress?.({
            stage: 'starting',
            message: `Starting ${agentId} with ${provider}...`,
            attempt,
            maxAttempts: retryConfig.maxRetries,
          });

          // Execute with timeout
          const result = await this.executeWithTimeout(
            agentId,
            task,
            context,
            provider,
            options.timeout || 60000
          );

          // Progress: completed
          onProgress?.({
            stage: 'completed',
            message: `Completed successfully`,
            attempt,
          });

          // Save to memory if requested
          if (options.saveToMemory) {
            memoryManager.add({
              type: 'episodic',
              category: 'agent',
              key: `agent-${agentId}-${Date.now()}`,
              value: {
                agentId,
                task,
                result: result.content,
                success: result.success,
                provider,
                duration: Date.now() - startTime,
              },
              validFrom: new Date().toISOString(),
              validUntil: null,
              confidence: result.success ? 95 : 50,
              source: 'system',
              tags: ['agent', agentId, provider],
            });
          }

          return {
            ...result,
            duration: Date.now() - startTime,
            attempts,
            provider,
            model: this.getModelForProvider(provider),
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);

          // Check if error is retryable
          const isRetryable = retryConfig.retryableErrors.some((err) =>
            lastError!.toLowerCase().includes(err.toLowerCase())
          );

          if (!isRetryable) {
            // Non-retryable error, try next provider
            console.warn(
              `[AgentExecutor] Non-retryable error: ${lastError}, trying next provider`
            );
            break;
          }

          // Progress: retrying
          onProgress?.({
            stage: 'retrying',
            message: `Retry ${attempt}/${retryConfig.maxRetries}: ${lastError}`,
            attempt,
            maxAttempts: retryConfig.maxRetries,
            error: lastError,
          });

          // Exponential backoff
          if (attempt < retryConfig.maxRetries) {
            const delay =
              retryConfig.backoffMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
            await this.sleep(delay);
          }
        }
      }

      // If fallback disabled, stop after first provider
      if (!fallbackConfig.fallbackOnError) {
        break;
      }
    }

    // All providers failed
    onProgress?.({
      stage: 'failed',
      message: `All providers failed`,
      error: lastError,
    });

    return {
      success: false,
      content: '',
      tokens: 0,
      cost: 0,
      duration: Date.now() - startTime,
      attempts,
      provider: 'none',
      model: 'none',
      error: lastError,
    };
  }

  /**
   * Execute with timeout wrapper — delegates to the canonical
   * `runAgentExecution` kernel so legacy callers automatically benefit from
   * native tool calls, circuit breakers, cost tracking, and workspace
   * attribution. Outer retry/fallback loops in `execute()` are still honoured.
   */
  private async executeWithTimeout(
    agentId: string,
    task: string,
    context: AgentContext,
    provider: string,
    timeoutMs: number
  ): Promise<{ success: boolean; content: string; tokens: number; cost: number }> {
    const systemPrompt = this.buildSystemPrompt(agentId, context);
    const runId = `legacy-${agentId}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const workspaceId =
      typeof (context as Record<string, unknown>)?.workspaceId === 'string'
        ? ((context as Record<string, unknown>).workspaceId as string)
        : undefined;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const work = runAgentExecution(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ],
      {
        router: this.router,
        provider,
        agentId,
        runId,
        workspaceId,
        enableTools: false,
        signal: controller.signal,
      }
    ).then((result) => {
      if (result.aborted) {
        throw new Error(`Execution aborted (duration=${result.durationMs}ms)`);
      }
      const content = result.finalContent;
      return {
        success: true,
        content,
        tokens: this.estimateTokens(systemPrompt + task + content),
        cost: this.estimateCost(provider, content.length),
      };
    });

    try {
      return await Promise.race([work, timeout]);
    } catch (err) {
      logger.warn('[ImprovedAgentExecutor] executeWithTimeout failed', {
        agentId,
        provider,
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Build system prompt for agent
   */
  private buildSystemPrompt(agentId: string, context: AgentContext): string {
    const agentPrompts: Record<string, string> = {
      main: 'Ты CEOClaw Main — оркестратор. Координируешь работу, общаешься с пользователем.',
      'quick-research': 'Ты Research Agent — ищешь информацию в интернете и анализируешь данные.',
      'quick-coder': 'Ты Coder Agent — пишешь код, исправляешь баги, рефакторишь.',
      writer: 'Ты Writer Agent — пишешь тексты, документацию, отчёты.',
      planner: 'Ты Planner Agent — планируешь задачи, оцениваешь сроки, распределяешь ресурсы.',
      'main-reviewer': 'Ты Reviewer Agent — проверяешь качество, находишь ошибки, даёшь фидбек.',
      'main-worker': 'Ты Worker Agent — выполняешь задачи, работаешь с файлами, запускаешь скрипты.',
    };

    const basePrompt = agentPrompts[agentId] || agentPrompts['main'];

    return `${basePrompt}

Контекст:
${JSON.stringify(context, null, 2)}

Отвечай кратко, по делу. Используй данные из контекста.`;
  }

  /**
   * Get model for provider
   */
  private getModelForProvider(provider: string): string {
    const models: Record<string, string> = {
      openrouter: 'google/gemini-3.1-flash-lite-preview',
      zai: 'glm-5',
      openai: 'gpt-5.2',
      mock: 'mock',
    };
    return models[provider] || 'unknown';
  }

  /**
   * Estimate tokens (rough: 4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate cost (rough estimates)
   */
  private estimateCost(provider: string, responseLength: number): number {
    const costPerChar: Record<string, number> = {
      openrouter: 0.000001,
      zai: 0.000002,
      openai: 0.000003,
      mock: 0,
    };
    return responseLength * (costPerChar[provider] || 0);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================
// Smart Agent Selector
// ============================================

export class SmartAgentSelector {
  /**
   * Select best agent for task based on keywords
   */
  selectAgent(task: string): string {
    const taskLower = task.toLowerCase();

    // Research keywords
    if (
      /найди|поиск|research|google|информация|что такое|кто такой/.test(taskLower)
    ) {
      return 'quick-research';
    }

    // Code keywords
    if (
      /код|программ|bug|исправь|рефактор|функция|скрипт|код/.test(taskLower)
    ) {
      return 'quick-coder';
    }

    // Writing keywords
    if (
      /напиши|текст|документ|отчёт|статья|письмо/.test(taskLower)
    ) {
      return 'writer';
    }

    // Planning keywords
    if (
      /план|расписание|срок|задача|roadmap|приоритет/.test(taskLower)
    ) {
      return 'planner';
    }

    // Review keywords
    if (
      /проверь|review|оценка|критика|качество|error/.test(taskLower)
    ) {
      return 'main-reviewer';
    }

    // Default to main
    return 'main';
  }

  /**
   * Get agent capabilities
   */
  getAgentCapabilities(agentId: string): string[] {
    const capabilities: Record<string, string[]> = {
      main: ['orchestration', 'communication', 'delegation'],
      'quick-research': ['web-search', 'analysis', 'summarization'],
      'quick-coder': ['code-generation', 'debugging', 'refactoring'],
      writer: ['content-creation', 'documentation', 'translation'],
      planner: ['task-planning', 'estimation', 'resource-allocation'],
      'main-reviewer': ['quality-check', 'error-detection', 'feedback'],
      'main-worker': ['execution', 'file-operations', 'script-running'],
    };

    return capabilities[agentId] || capabilities['main'];
  }
}

// ============================================
// Rate Limiter
// ============================================

export class AgentRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private limits: Map<string, { maxRequests: number; windowMs: number }> = new Map();

  constructor() {
    // Default limits per provider
    this.limits.set('openrouter', { maxRequests: 60, windowMs: 60000 }); // 60/min
    this.limits.set('zai', { maxRequests: 30, windowMs: 60000 }); // 30/min
    this.limits.set('openai', { maxRequests: 100, windowMs: 60000 }); // 100/min
  }

  /**
   * Check if request allowed
   */
  canRequest(provider: string): boolean {
    const limit = this.limits.get(provider);
    if (!limit) return true;

    const now = Date.now();
    const requests = this.requests.get(provider) || [];

    // Filter old requests
    const recentRequests = requests.filter((time) => now - time < limit.windowMs);

    if (recentRequests.length >= limit.maxRequests) {
      return false;
    }

    // Record new request
    recentRequests.push(now);
    this.requests.set(provider, recentRequests);

    return true;
  }

  /**
   * Get wait time if rate limited
   */
  getWaitTime(provider: string): number {
    const limit = this.limits.get(provider);
    if (!limit) return 0;

    const requests = this.requests.get(provider) || [];
    if (requests.length === 0) return 0;

    const oldestRequest = Math.min(...requests);
    const waitTime = limit.windowMs - (Date.now() - oldestRequest);

    return Math.max(0, waitTime);
  }
}

// ============================================
// Export singleton instances
// ============================================

export const improvedExecutor = new ImprovedAgentExecutor();
export const smartSelector = new SmartAgentSelector();
export const rateLimiter = new AgentRateLimiter();
