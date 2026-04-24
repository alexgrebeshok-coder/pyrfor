/**
 * Pyrfor Runtime — Main Runtime Class
 *
 * Ties together:
 * - SessionManager: In-memory session storage
 * - ProviderRouter: Smart AI provider selection with fallback
 * - ToolEngine: Extended runtime tools
 * - WorkspaceLoader: Memory and config file loading
 * - HeartbeatRunner: Background task execution
 * - AutoCompact: Automatic message summarization
 * - SubagentSpawner: Fork sessions for background tasks
 * - PrivacyManager: Data isolation and security
 *
 * Usage:
 *   const runtime = new PyrforRuntime();
 *   await runtime.start();
 *   const response = await runtime.handleMessage('telegram', userId, chatId, 'Hello');
 *   await runtime.stop();
 */

import { SessionManager, type SessionCreateOptions, type Channel } from './session';
import { SessionStore, reviveSession, type SessionStoreOptions } from './session-store';
import { ProviderRouter } from './provider-router';
import { AutoCompact } from './compact';
import { SubagentSpawner, type SubagentOptions } from './subagents';
import { PrivacyManager } from './privacy';
import { WorkspaceLoader, type WorkspaceLoaderOptions } from './workspace-loader';
import { executeRuntimeTool, setTelegramBot, setWorkspaceRoot, runtimeToolDefinitions } from './tools';
import { runToolLoop } from './tool-loop';
import { logger } from '../observability/logger';
import type { Message } from '../ai/providers/base';
import type { TelegramSender } from './telegram-types';
import { loadConfig, watchConfig, RuntimeConfigSchema, type RuntimeConfig } from './config';
import { HealthMonitor } from './health';
import { CronService, type CronJobSpec } from './cron';
import { getDefaultHandlers } from './cron/handlers';
import { createRuntimeGateway, type GatewayHandle } from './gateway';
import { tryLoadPrismaClient, createNoopPrismaClient, installPrismaClient } from './prisma-adapter';

// ============================================
// Types
// ============================================

export interface PyrforRuntimeOptions {
  /** Path to workspace directory */
  workspacePath?: string;
  /** Path to memory directory */
  memoryPath?: string;
  /** Default system prompt */
  systemPrompt?: string;
  /** Enable auto-compact */
  enableCompact?: boolean;
  /** Enable subagent spawner */
  enableSubagents?: boolean;
  /** Maximum concurrent subagents */
  maxSubagents?: number;
  /** Privacy policy */
  privacy?: {
    defaultZone?: 'public' | 'personal' | 'vault';
    vaultPassword?: string;
  };
  /** Provider router options */
  providerOptions?: {
    defaultProvider?: string;
    enableFallback?: boolean;
  };
  /** Session persistence options. Pass `false` to disable. */
  persistence?: SessionStoreOptions | false;
  /**
   * Path to runtime.json config file. If provided, config is loaded in start()
   * and hot-reloaded when the file changes.
   */
  configPath?: string;
  /**
   * Pre-loaded RuntimeConfig. Used directly when configPath is not set.
   * When configPath is also set, the file takes precedence (loaded in start()).
   */
  config?: RuntimeConfig;
}

export interface RuntimeMessageResult {
  success: boolean;
  response: string;
  sessionId?: string;
  tokensUsed?: number;
  costUsd?: number;
  error?: string;
}

export interface RuntimeStats {
  sessions: {
    active: number;
    totalTokens: number;
    byChannel: Record<Channel, number>;
  };
  subagents: {
    active: number;
    total: number;
  };
  providers: {
    available: string[];
    costs: ReturnType<ProviderRouter['getTotalCost']>;
  };
  workspace: {
    loaded: boolean;
    filesLoaded?: number;
  };
}

// ============================================
// Main Runtime Class
// ============================================

export class PyrforRuntime {
  sessions: SessionManager;
  providers: ProviderRouter;
  compact: AutoCompact;
  subagents: SubagentSpawner;
  privacy: PrivacyManager;
  workspace: WorkspaceLoader | null = null;
  store: SessionStore | null = null;
  /** Current resolved RuntimeConfig. Updated on hot-reload. */
  config: RuntimeConfig;
  private health: HealthMonitor | null = null;
  private cron: CronService | null = null;
  private gateway: GatewayHandle | null = null;
  private configPath: string | null = null;
  private _configWatchDispose: (() => void) | null = null;
  private options: Required<Omit<PyrforRuntimeOptions, 'persistence' | 'configPath' | 'config'>> & {
    persistence: SessionStoreOptions | false;
  };
  private started = false;
  private telegramBot: TelegramSender | null = null;

  constructor(options: PyrforRuntimeOptions = {}) {
    this.options = {
      workspacePath: options.workspacePath || process.cwd(),
      memoryPath: options.memoryPath || undefined,
      systemPrompt: options.systemPrompt || this.getDefaultSystemPrompt(),
      enableCompact: options.enableCompact ?? true,
      enableSubagents: options.enableSubagents ?? true,
      maxSubagents: options.maxSubagents ?? 5,
      privacy: options.privacy || {},
      providerOptions: options.providerOptions || {},
      persistence: options.persistence ?? {},
    } as Required<Omit<PyrforRuntimeOptions, 'persistence' | 'configPath' | 'config'>> & { persistence: SessionStoreOptions | false };

    // Config: use provided config or defaults; will be (re)loaded from file in start() if configPath given
    this.configPath = options.configPath ?? null;
    this.config = options.config ?? RuntimeConfigSchema.parse({});

    // Initialize components
    this.sessions = new SessionManager();
    if (this.options.persistence !== false) {
      this.store = new SessionStore(this.options.persistence);
      this.sessions.setStore(this.store);
    }
    this.providers = new ProviderRouter(this.options.providerOptions);
    this.compact = new AutoCompact(this.providers);
    this.subagents = new SubagentSpawner(this.options.maxSubagents);
    this.privacy = new PrivacyManager({
      defaultZone: this.options.privacy.defaultZone || 'personal',
      vaultPassword: this.options.privacy.vaultPassword,
    });

    // Setup subagent executor
    if (this.options.enableSubagents) {
      this.subagents.setExecutor(async (task) => {
        return this.executeSubagentTask(task.task, task.context.systemPrompt);
      });
    }

    // Register telegram bot setter globally
    setTelegramBot(null);

    logger.info('PyrforRuntime initialized');
  }

  /**
   * Start all services
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Runtime already started');
      return;
    }

    // Load config from file if configPath is set
    if (this.configPath) {
      try {
        const { config } = await loadConfig(this.configPath);
        this.config = config;
        logger.info('[runtime] Config loaded', { path: this.configPath });
      } catch (err) {
        logger.warn('[runtime] Config load failed, using defaults', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Load workspace
    const workspaceOptions: WorkspaceLoaderOptions = {
      workspacePath: this.options.workspacePath,
      memoryPath: this.options.memoryPath,
    };
    this.workspace = new WorkspaceLoader(workspaceOptions);
    await this.workspace.load();

    // Set workspace root for file tool security
    setWorkspaceRoot(this.options.workspacePath);

    // Update system prompt from workspace if available
    const wsPrompt = this.workspace.getSystemPrompt();
    if (wsPrompt) {
      this.options.systemPrompt = wsPrompt;
    }

    // Restore persisted sessions (best-effort, never fatal).
    if (this.store) {
      try {
        await this.store.init();
        const persisted = await this.store.loadAll();
        let restored = 0;
        for (const p of persisted) {
          try {
            this.sessions.restore(reviveSession(p));
            restored++;
          } catch (err) {
            logger.warn('Failed to revive persisted session', {
              id: p.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (restored > 0) {
          logger.info('Restored persisted sessions', { count: restored });
        }
      } catch (err) {
        logger.error('Session store init/load failed; continuing without persistence', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Health monitor ──────────────────────────────────────────────────────
    this.health = new HealthMonitor({
      intervalMs: this.config.health.intervalMs,
    });
    // "runtime" check — always healthy once start completes
    this.health.addCheck('runtime', () => ({ healthy: true }));
    // "providers" check — healthy when at least one provider is available
    this.health.addCheck('providers', () => ({
      healthy: this.providers.getAvailableProviders().length > 0,
      message: `available: ${this.providers.getAvailableProviders().join(', ') || 'none'}`,
    }));
    if (this.config.health.enabled) {
      this.health.start();
    }

    // ── Prisma adapter ──────────────────────────────────────────────────────
    if (this.config.persistence?.prisma?.enabled) {
      const prismaClient = await tryLoadPrismaClient();
      if (prismaClient) {
        installPrismaClient(prismaClient);
        logger.info('[runtime] Prisma client loaded and installed');
      } else {
        logger.warn('[runtime] prisma enabled in config but @prisma/client not installed — using noop');
        installPrismaClient(createNoopPrismaClient());
      }
    } else {
      installPrismaClient(createNoopPrismaClient());
    }

    // ── Cron service ────────────────────────────────────────────────────────
    this.cron = new CronService({ defaultTimezone: this.config.cron.timezone });
    // Register all default handlers (prisma-dependent handlers will log an
    // error at execution time if setCronPrismaClient() was never called — this
    // is expected when running without a database).
    const defaultHandlers = getDefaultHandlers();
    for (const [key, fn] of Object.entries(defaultHandlers)) {
      this.cron.registerHandler(key, fn);
    }
    if (this.config.cron.enabled) {
      try {
        this.cron.start(this.config.cron.jobs as CronJobSpec[]);
      } catch (err) {
        logger.warn('[runtime] CronService start failed; running without scheduled jobs', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Gateway ─────────────────────────────────────────────────────────────
    if (this.config.gateway.enabled) {
      this.gateway = createRuntimeGateway({
        config: this.config,
        runtime: this,
        health: this.health,
        cron: this.cron,
      });
      try {
        await this.gateway.start();
        // Register a gateway liveness check
        const gatewayPort = this.gateway.port;
        this.health.addCheck('gateway', async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${gatewayPort}/ping`, {
              signal: AbortSignal.timeout(2000),
            });
            return { healthy: res.ok };
          } catch (err) {
            return { healthy: false, message: err instanceof Error ? err.message : String(err) };
          }
        });
      } catch (err) {
        logger.warn('[runtime] Gateway start failed; HTTP gateway disabled', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.gateway = null;
      }
    }

    // ── Config hot-reload ───────────────────────────────────────────────────
    if (this.configPath) {
      this._configWatchDispose = watchConfig(
        this.configPath,
        (newConfig) => {
          const oldJobs = this.config.cron.jobs;
          const oldGatewayPort = this.config.gateway.port;
          this.config = newConfig;

          // Diff cron jobs: remove deleted, add new ones
          if (this.cron) {
            const oldNames = new Set(oldJobs.map((j) => j.name));
            const newNames = new Set(newConfig.cron.jobs.map((j) => j.name));
            for (const name of oldNames) {
              if (!newNames.has(name)) this.cron.removeJob(name);
            }
            for (const job of newConfig.cron.jobs) {
              if (!oldNames.has(job.name)) {
                try {
                  this.cron.addJob(job as CronJobSpec);
                } catch (err) {
                  logger.warn('[runtime] Failed to add new cron job from hot-reload', {
                    name: job.name,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          }

          if (this.gateway && newConfig.gateway.port !== oldGatewayPort) {
            logger.warn('[runtime] gateway.port changed in config — restart required for new port to take effect');
          }

          logger.info('[runtime] Config reloaded via hot-reload');
        },
        {
          onError: (err) => {
            logger.warn('[runtime] Config watch error; keeping stale config', {
              error: err instanceof Error ? err.message : String(err),
            });
          },
        },
      );
    }

    this.started = true;
    logger.info('PyrforRuntime started');
  }

  /**
   * Graceful shutdown — each subsystem is stopped independently so one
   * failure does not block the others. Reverse of start() order.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // 1. Stop config hot-reload watcher
    if (this._configWatchDispose) {
      try {
        this._configWatchDispose();
      } catch (err) {
        logger.warn('[runtime] Config watch dispose failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this._configWatchDispose = null;
    }

    // 2. Stop HTTP gateway
    if (this.gateway) {
      try {
        await this.gateway.stop();
      } catch (err) {
        logger.warn('[runtime] Gateway stop failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.gateway = null;
    }

    // 3. Stop cron service
    if (this.cron) {
      try {
        this.cron.stop();
      } catch (err) {
        logger.warn('[runtime] Cron stop failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 4. Stop health monitor
    if (this.health) {
      try {
        this.health.stop();
      } catch (err) {
        logger.warn('[runtime] Health monitor stop failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 5. Dispose workspace watcher
    try {
      this.workspace?.dispose();
    } catch (err) {
      logger.warn('[runtime] Workspace dispose failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 6. Flush pending session writes before exit. Do NOT cleanup(0) — that would
    // delete all session files and defeat persistence across restarts.
    if (this.store) {
      try {
        await this.store.flushAll();
      } catch (err) {
        logger.error('Failed to flush session store', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        this.store.close();
      } catch (err) {
        logger.warn('[runtime] Session store close failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      this.subagents.cleanup(0);
    } catch (err) {
      logger.warn('[runtime] Subagents cleanup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.started = false;
    logger.info('PyrforRuntime stopped');
  }

  /**
   * Main entry point: handle incoming message
   */
  async handleMessage(
    channel: Channel,
    userId: string,
    chatId: string,
    text: string,
    options?: {
      provider?: string;
      model?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeMessageResult> {
    if (!this.started) {
      return { success: false, response: '', error: 'Runtime not started' };
    }

    try {
      // Find or create session
      let session = this.sessions.findByContext(userId, channel, chatId);

      if (!session) {
        const createOpts: SessionCreateOptions = {
          channel,
          userId,
          chatId,
          systemPrompt: this.options.systemPrompt,
          metadata: options?.metadata,
        };
        session = this.sessions.create(createOpts);
      }

      // Check privacy for this operation
      const privacyCheck = this.privacy.check('send_message');
      if (!privacyCheck.allowed) {
        return {
          success: false,
          response: '',
          sessionId: session.id,
          error: `Privacy restriction: ${privacyCheck.reason}`,
        };
      }

      // Add user message
      const userMsg: Message = { role: 'user', content: text };
      const addResult = this.sessions.addMessage(session.id, userMsg);

      if (!addResult.success) {
        return {
          success: false,
          response: '',
          sessionId: session.id,
          error: addResult.error,
        };
      }

      // Trigger auto-compact if needed
      if (this.options.enableCompact) {
        const compactResult = await this.compact.maybeCompact(session);
        if (compactResult?.success) {
          logger.debug('Session auto-compacted', { sessionId: session.id });
        }
      }

      // Get AI response (with tool calling loop)
      const messages = session.messages;
      const loopResult = await runToolLoop(
        messages,
        runtimeToolDefinitions,
        async (msgs, runOpts) =>
          this.providers.chat(msgs, {
            provider: runOpts?.provider,
            model: runOpts?.model,
            sessionId: runOpts?.sessionId,
          }),
        executeRuntimeTool,
        {
          sessionId: session.id,
          userId,
        },
        {
          provider: options?.provider,
          model: options?.model,
          sessionId: session.id,
        },
        { maxIterations: 5 }
      );

      const response = loopResult.finalText;

      // Persist only the final assistant answer in session history.
      // Tool calls / results are ephemeral (they live inside the loop's working
      // copy); future turns get a fresh tool-call cycle, which keeps history
      // clean and avoids stuffing it with raw file dumps.
      this.sessions.addMessage(session.id, { role: 'assistant', content: response });

      if (loopResult.toolCalls.length > 0) {
        logger.info('Tool loop summary', {
          sessionId: session.id,
          iterations: loopResult.iterations,
          toolCalls: loopResult.toolCalls.map((tc) => ({
            name: tc.call.name,
            ok: tc.result.success,
          })),
          truncated: loopResult.truncated,
        });
      }

      // Get cost info
      const cost = this.providers.getSessionCost(session.id);

      return {
        success: true,
        response,
        sessionId: session.id,
        tokensUsed: cost.calls * 1000, // Rough estimate
        costUsd: cost.totalUsd,
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('handleMessage failed', { channel, userId, error: msg });

      return {
        success: false,
        response: '',
        error: `Error: ${msg}`,
      };
    }
  }

  /**
   * Stream a response (for real-time UI)
   */
  async *streamMessage(
    channel: Channel,
    userId: string,
    chatId: string,
    text: string,
    options?: {
      provider?: string;
      model?: string;
    }
  ): AsyncGenerator<{ type: 'token' | 'error' | 'done'; content?: string; error?: string }, void, unknown> {
    if (!this.started) {
      yield { type: 'error', error: 'Runtime not started' };
      return;
    }

    try {
      // Find or create session
      let session = this.sessions.findByContext(userId, channel, chatId);

      if (!session) {
        session = this.sessions.create({
          channel,
          userId,
          chatId,
          systemPrompt: this.options.systemPrompt,
        });
      }

      // Add user message
      this.sessions.addMessage(session.id, { role: 'user', content: text });

      // Stream response
      const messages = session.messages;
      let fullResponse = '';

      try {
        for await (const token of this.providers.chatStream(messages, {
          provider: options?.provider,
          model: options?.model,
          sessionId: session.id,
        })) {
          fullResponse += token;
          yield { type: 'token', content: token };
        }

        // Add full message to session
        this.sessions.addMessage(session.id, { role: 'assistant', content: fullResponse });
        yield { type: 'done' };

      } catch (streamError) {
        const msg = streamError instanceof Error ? streamError.message : String(streamError);
        yield { type: 'error', error: msg };
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: msg };
    }
  }

  /**
   * Execute a tool directly
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: { sessionId?: string; userId?: string }
  ): Promise<ReturnType<typeof executeRuntimeTool>> {
    // Privacy check
    const privacyCheck = this.privacy.check(toolName);
    if (!privacyCheck.allowed) {
      return {
        success: false,
        data: {},
        error: `Privacy restriction: ${privacyCheck.reason}`,
      };
    }

    return executeRuntimeTool(toolName, args, {
      sessionId: context?.sessionId,
      userId: context?.userId,
    });
  }

  /**
   * Spawn a subagent task
   */
  spawnSubagent(options: SubagentOptions): { success: boolean; taskId?: string; error?: string } {
    if (!this.options.enableSubagents) {
      return { success: false, error: 'Subagents disabled' };
    }

    // Check privacy
    const privacyCheck = this.privacy.check('send_message');
    if (!privacyCheck.allowed) {
      return { success: false, error: `Privacy restriction: ${privacyCheck.reason}` };
    }

    return this.subagents.spawn(options);
  }

  /**
   * Get subagent status
   */
  async waitForSubagent(taskId: string, timeoutMs?: number): Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }> {
    const result = await this.subagents.waitForTask(taskId, timeoutMs);
    return {
      success: result.success,
      result: result.result,
      error: result.error,
    };
  }

  /**
   * Get runtime statistics
   */
  getStats(): RuntimeStats {
    const sessionStats = this.sessions.getStats();
    const subagentStats = this.subagents.getStats();
    const providerCosts = this.providers.getTotalCost();

    return {
      sessions: {
        active: sessionStats.totalSessions,
        totalTokens: sessionStats.totalTokens,
        byChannel: sessionStats.byChannel,
      },
      subagents: {
        active: subagentStats.active,
        total: subagentStats.total,
      },
      providers: {
        available: this.providers.getAvailableProviders(),
        costs: providerCosts,
      },
      workspace: {
        loaded: !!this.workspace?.getWorkspace(),
        filesLoaded: this.workspace?.getWorkspace()
          ? 1 + this.workspace.getWorkspace()!.files.daily.size + this.workspace.getWorkspace()!.files.skills.length
          : 0,
      },
    };
  }

  /**
   * Set Telegram bot instance
   */
  setTelegramBot(bot: TelegramSender | null): void {
    this.telegramBot = bot;
    setTelegramBot(bot);
  }

  /**
   * Clear session for a given (channel, userId, chatId) tuple.
   * Returns true if a session was found and destroyed.
   */
  clearSession(channel: Channel, userId: string, chatId: string): boolean {
    const session = this.sessions.findByContext(userId, channel, chatId);
    if (!session) return false;
    return this.sessions.destroy(session.id);
  }

  /**
   * Reload workspace from disk
   */
  async reloadWorkspace(): Promise<void> {
    if (!this.workspace) return;
    await this.workspace.reload();

    // Update system prompt
    const wsPrompt = this.workspace.getSystemPrompt();
    if (wsPrompt) {
      this.options.systemPrompt = wsPrompt;
    }

    logger.info('Workspace reloaded');
  }

  // ============================================
  // Private Helpers
  // ============================================

  private async executeSubagentTask(task: string, systemPrompt: string): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];

    const response = await this.providers.chat(messages, {
      maxTokens: 2000, // Subagents get shorter responses
    });

    return response;
  }

  private getDefaultSystemPrompt(): string {
    return `You are Pyrfor, an AI assistant running on the Pyrfor Runtime.

You have access to tools for:
- Reading/writing files
- Executing shell commands (with safety checks)
- Searching and fetching web content
- Sending messages

Be helpful, accurate, and concise. When uncertain, say so.`;
  }
}

// ============================================
// Exports
// ============================================

export { runtimeToolDefinitions };

// Re-export components for advanced usage
export { SessionManager } from './session';
export { ProviderRouter } from './provider-router';
export { AutoCompact } from './compact';
export { SubagentSpawner } from './subagents';
export { PrivacyManager, PUBLIC_ZONE, PERSONAL_ZONE, VAULT_ZONE } from './privacy';
export { WorkspaceLoader } from './workspace-loader';
export * from './tools';
