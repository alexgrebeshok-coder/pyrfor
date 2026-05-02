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

import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SessionManager, type SessionCreateOptions, type Channel } from './session';
import { SessionStore, reviveSession, type SessionStoreOptions } from './session-store';
import { ProviderRouter } from './provider-router';
import { AutoCompact } from './compact';
import { SubagentSpawner, type SubagentOptions } from './subagents';
import { PrivacyManager } from './privacy';
import { WorkspaceLoader, type WorkspaceLoaderOptions } from './workspace-loader';
import { executeRuntimeTool, setTelegramBot, setWorkspaceRoot, runtimeToolDefinitions } from './tools';
import { runToolLoop } from './tool-loop';
import { approvalFlow } from './approval-flow';
import { handleMessageStream, buildContextBlock, type OpenFile, type StreamEvent } from './streaming';
import { loadProjectRules, composeSystemPrompt } from './project-rules';
import { logger } from '../observability/logger';
import type { Message } from '../ai/providers/base';
import type { TelegramSender } from './telegram-types';
import { DEFAULT_CONFIG_PATH, loadConfig, watchConfig, RuntimeConfigSchema, type RuntimeConfig } from './config';
import { HealthMonitor } from './health';
import { CronService, type CronJobSpec } from './cron';
import { getDefaultHandlers } from './cron/handlers';
import { createRuntimeGateway, type GatewayDeps, type GatewayHandle } from './gateway';
import { tryLoadPrismaClient, createNoopPrismaClient, installPrismaClient } from './prisma-adapter';
import { processManager } from './process-manager';
import { registerDynamicSkills, setSkillAIProvider } from '../skills/index';
import { ArtifactStore } from './artifact-model';
import { DomainOverlayRegistry } from './domain-overlay';
import { registerDefaultDomainOverlays } from './domain-overlay-presets';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import { RunLedger } from './run-ledger';

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
  runId?: string;
  taskId?: string;
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

interface RuntimeOrchestration {
  eventLedger: EventLedger;
  runLedger: RunLedger;
  dag: DurableDag;
  artifactStore: ArtifactStore;
  overlays: DomainOverlayRegistry;
}

interface ActiveRuntimeRun {
  runId: string;
  taskId: string;
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
  private orchestration: RuntimeOrchestration | null = null;
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

  private applyRuntimeConfig(): void {
    const configuredWorkspace = this.config.workspacePath ?? this.config.workspaceRoot;
    if (configuredWorkspace) {
      this.options.workspacePath = configuredWorkspace;
    }
    if (this.config.memoryPath) {
      this.options.memoryPath = this.config.memoryPath;
    }
    this.providers.setProviderOptions({
      defaultProvider: this.config.providers?.defaultProvider,
      enableFallback: this.config.providers?.enableFallback,
    });
    if (this.config.ai?.activeModel) {
      this.providers.setActiveModel(
        this.config.ai.activeModel.provider,
        this.config.ai.activeModel.modelId,
      );
    }
    this.providers.setLocalMode({
      localFirst: this.config.ai?.localFirst ?? false,
      localOnly: this.config.ai?.localOnly ?? false,
    });
  }

  setWorkspacePath(workspacePath: string): void {
    this.options.workspacePath = workspacePath;
    this.config.workspacePath = workspacePath;
    this.config.workspaceRoot = workspacePath;
    setWorkspaceRoot(workspacePath);
  }

  getWorkspacePath(): string {
    return this.options.workspacePath;
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
        this.applyRuntimeConfig();
        logger.info('[runtime] Config loaded', { path: this.configPath });
      } catch (err) {
        logger.warn('[runtime] Config load failed, using defaults', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      this.applyRuntimeConfig();
    }

    // Load workspace
    const workspaceOptions: WorkspaceLoaderOptions = {
      workspacePath: this.options.workspacePath,
      memoryPath: this.options.memoryPath,
    };
    this.workspace = new WorkspaceLoader(workspaceOptions);
    await this.workspace.load();

    // Register SKILL.md files discovered by the workspace loader
    setSkillAIProvider((messages) => this.providers.chat(messages));
    const dynamicSkillCount = registerDynamicSkills(this.workspace.getWorkspace()?.files?.skills ?? []);
    if (dynamicSkillCount > 0) {
      logger.info('[runtime] Dynamic skills registered', { count: dynamicSkillCount });
    }

    // Set workspace root for file tool security
    setWorkspaceRoot(this.options.workspacePath);

    // ── Workspace → system-prompt injection ────────────────────────────────
    // WorkspaceLoader is the canonical server-side memory source.  It reads
    // MEMORY.md, memory/YYYY-MM-DD.md (today + 7 days), SOUL.md, USER.md,
    // IDENTITY.md, AGENTS.md, HEARTBEAT.md, TOOLS.md, and SKILL.md files,
    // then composes them into a single system-prompt string.
    //
    // That string is stored in this.options.systemPrompt and is passed as
    // `systemPrompt` every time a new Session is created (see handleMessage /
    // streamMessage / streamMessageAdvanced below).  SessionManager.create()
    // inserts it as the first { role: 'system', ... } message, so it is
    // present in the messages array forwarded to every AI provider call.
    //
    // Nothing else needs to wire this up — the injection is already complete.
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

    await this.initOrchestration();

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
      await this.ensureGatewayStarted();
    }

    // ── Config hot-reload ───────────────────────────────────────────────────
    if (this.configPath) {
      this._configWatchDispose = watchConfig(
        this.configPath,
        (newConfig) => {
          const oldJobs = this.config.cron.jobs;
          const oldGatewayPort = this.config.gateway.port;
          this.config = newConfig;
          this.applyRuntimeConfig();
          setWorkspaceRoot(this.options.workspacePath);

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
   * Start the HTTP gateway if it is not already running.
   *
   * Used both by start() (when `config.gateway.enabled` is true) and by
   * scenarios that require the gateway regardless of config — e.g., serving
   * Telegram Mini App static files in `--telegram` mode when
   * TELEGRAM_WEBAPP_URL is set. Safe to call multiple times.
   */
  async ensureGatewayStarted(): Promise<GatewayHandle | null> {
    if (this.gateway) return this.gateway;

    const gateway = createRuntimeGateway({
      config: this.config,
      runtime: this,
      health: this.health ?? undefined,
      cron: this.cron ?? undefined,
      providerRouter: this.providers,
      orchestration: this.orchestrationAsGatewayDeps(),
      configPath: this.configPath ?? undefined,
    });

    try {
      await gateway.start();
      this.gateway = gateway;
      const gatewayPort = gateway.port;
      if (this.health) {
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
      }
      return this.gateway;
    } catch (err) {
      logger.warn('[runtime] Gateway start failed; HTTP gateway disabled', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.gateway = null;
      return null;
    }
  }

  /**
   * Reload workspace files and re-register dynamic skills from SKILL.md files.
   * Safe to call at runtime without stopping the runtime.
   */
  async reloadSkills(): Promise<number> {
    if (!this.workspace) {
      logger.warn('[runtime] reloadSkills called before workspace is initialized');
      return 0;
    }
    await this.workspace.reload();
    const count = registerDynamicSkills(this.workspace.getWorkspace()?.files?.skills ?? []);
    logger.info('[runtime] Skills reloaded', { count });
    return count;
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

    if (this.orchestration) {
      try {
        await this.orchestration.dag.flushLedger();
        await this.orchestration.eventLedger.close();
      } catch (err) {
        logger.warn('[runtime] Orchestration persistence flush failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.orchestration = null;
    }

    try {
      this.subagents.cleanup(0);
    } catch (err) {
      logger.warn('[runtime] Subagents cleanup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      processManager.cleanup();
    } catch (err) {
      logger.warn('[runtime] ProcessManager cleanup failed', {
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
      sessionId?: string;
      provider?: string;
      model?: string;
      metadata?: Record<string, unknown>;
      onProgress?: (event: import('./tool-loop').ProgressEvent) => void;
    }
  ): Promise<RuntimeMessageResult> {
    if (!this.started) {
      return { success: false, response: '', error: 'Runtime not started' };
    }

    let activeRun: ActiveRuntimeRun | null = null;
    try {
      // Find or create session
      let session = options?.sessionId
        ? this.sessions.get(options.sessionId)
        : this.sessions.findByContext(userId, channel, chatId);

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

      activeRun = await this.beginUserRun({
        session,
        text,
        mode: 'chat',
        provider: options?.provider,
        model: options?.model,
      });
      if (activeRun) {
        await this.markUserRunRunning(activeRun);
      }

      // Add user message
      const userMsg: Message = { role: 'user', content: text };
      const addResult = this.sessions.addMessage(session.id, userMsg);

      if (!addResult.success) {
        if (activeRun) {
          await this.completeUserRun(activeRun, 'failed', addResult.error ?? 'Failed to add user message');
        }
        return {
          success: false,
          response: '',
          sessionId: session.id,
          runId: activeRun?.runId,
          taskId: activeRun?.taskId,
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
        this.createRunAwareToolExecutor(activeRun),
        {
          sessionId: session.id,
          userId,
          runId: activeRun?.runId,
        },
        {
          provider: options?.provider,
          model: options?.model,
          sessionId: session.id,
        },
        {
          approvalGate: (req) => approvalFlow.requestApproval(req),
          onProgress: options?.onProgress,
          onToolAudit: (event) => approvalFlow.recordToolOutcome(event),
        }
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
      if (activeRun) {
        await this.completeUserRun(activeRun, 'completed', response.slice(0, 500));
      }

      return {
        success: true,
        response,
        sessionId: session.id,
        runId: activeRun?.runId,
        taskId: activeRun?.taskId,
        tokensUsed: cost.calls * 1000, // Rough estimate
        costUsd: cost.totalUsd,
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (activeRun) {
        await this.completeUserRun(activeRun, 'failed', msg);
      }
      logger.error('handleMessage failed', { channel, userId, error: msg });

      return {
        success: false,
        response: '',
        runId: activeRun?.runId,
        taskId: activeRun?.taskId,
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

  /**
   * Streaming version of `handleMessage` — returns an async generator that
   * emits `StreamEvent` objects.  Integrates with the existing session
   * management, project-rules injection, and multi-file context injection.
   *
   * Used by the `POST /api/chat/stream` gateway endpoint.
   */
  async *streamChatRequest(input: {
    text: string;
    openFiles?: OpenFile[];
    workspace?: string;
    sessionId?: string;
    userId?: string;
    chatId?: string;
    provider?: string;
    model?: string;
    prefer?: 'local' | 'cloud' | 'auto';
    routingHints?: { contextSizeChars?: number; sensitive?: boolean };
  }): AsyncGenerator<StreamEvent> {
    if (!this.started) {
      throw new Error('Runtime not started');
    }

    const userId = input.userId ?? 'ide-user';
    const chatId = input.chatId ?? 'ide-chat';
    const channel = 'web' as Parameters<typeof this.handleMessage>[0];

    // ── Session ────────────────────────────────────────────────────────────
    let session = input.sessionId
      ? this.sessions.get(input.sessionId)
      : this.sessions.findByContext(userId, channel, chatId);

    if (!session) {
      // Load project rules once so we can bake them into the system prompt.
      const rules = input.workspace ? await loadProjectRules(input.workspace) : null;
      const systemPrompt = composeSystemPrompt(this.options.systemPrompt, rules);

      session = this.sessions.create({
        channel,
        userId,
        chatId,
        systemPrompt,
      });
    }

    let activeRun: ActiveRuntimeRun | null = null;
    const sessionId = session.id;
    let finalText = '';

    try {
      activeRun = await this.beginUserRun({
        session,
        text: input.text,
        mode: 'chat',
        provider: input.provider,
        model: input.model,
      });
      if (activeRun) {
        await this.markUserRunRunning(activeRun);
        yield { type: 'run', sessionId, runId: activeRun.runId, taskId: activeRun.taskId };
      }

      // ── User message (with optional context-file block) ────────────────────
      let userText = input.text;
      if (input.openFiles && input.openFiles.length > 0) {
        const ctxBlock = buildContextBlock(input.openFiles);
        userText = `${ctxBlock}\n\n${userText}`;
      }
      const addResult = this.sessions.addMessage(sessionId, { role: 'user', content: userText });
      if (!addResult.success) {
        throw new Error(addResult.error ?? 'Failed to add user message');
      }

      // ── Build messages (includes system prompt + history) ─────────────────
      const messages = session.messages;

      // ── Stream ────────────────────────────────────────────────────────────
      for await (const event of handleMessageStream(messages, {
        chat: (msgs, opts) =>
          this.providers.chat(msgs, {
            provider: opts?.provider ?? input.provider,
            model: opts?.model ?? input.model,
            sessionId: opts?.sessionId ?? sessionId,
            prefer: input.prefer,
            routingHints: input.routingHints,
          }),
        exec: this.createRunAwareToolExecutor(activeRun),
        tools: runtimeToolDefinitions,
        toolCtx: {
          sessionId,
          userId,
          runId: activeRun?.runId,
        },
        runOpts: {
          provider: input.provider,
          model: input.model,
          sessionId,
        },
      })) {
        if (event.type === 'final') {
          finalText = event.text;
        }
        yield event;
      }
      if (activeRun) {
        await this.completeUserRun(activeRun, 'completed', finalText.slice(0, 500));
      }
    } catch (err) {
      if (activeRun) {
        await this.completeUserRun(activeRun, 'failed', err instanceof Error ? err.message : String(err));
      }
      throw err;
    }

    // Persist assistant response (same as handleMessage).
    this.sessions.addMessage(session.id, { role: 'assistant', content: finalText });
  }

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

  private async beginUserRun(input: {
    session: { id: string; messages: Message[] };
    text: string;
    mode: 'chat' | 'edit' | 'autonomous' | 'pm';
    provider?: string;
    model?: string;
  }): Promise<ActiveRuntimeRun | null> {
    const runLedger = this.orchestration?.runLedger;
    if (!runLedger) return null;

    const taskId = `turn-${randomUUID()}`;
    const run = await runLedger.createRun({
      task_id: taskId,
      workspace_id: this.options.workspacePath,
      repo_id: this.options.workspacePath,
      branch_or_worktree_id: '',
      mode: input.mode,
      goal: input.text.slice(0, 500),
      model_profile: input.model ?? this.config.ai?.activeModel?.modelId ?? '',
      provider_route: input.provider ?? this.config.ai?.activeModel?.provider ?? this.config.providers?.defaultProvider ?? '',
      context_snapshot_hash: this.hashRunInput(`${input.session.id}:${input.session.messages.length}`),
      prompt_snapshot_hash: this.hashRunInput(input.text),
      permission_profile: { profile: 'standard' },
      budget_profile: {},
    });
    await runLedger.transition(run.run_id, 'planned', 'user turn accepted');
    this.sessions.updateMetadata(input.session.id, {
      lastRunId: run.run_id,
      lastTaskId: taskId,
    });
    return { runId: run.run_id, taskId };
  }

  private async markUserRunRunning(run: ActiveRuntimeRun): Promise<void> {
    await this.orchestration?.runLedger.transition(run.runId, 'running', 'user turn started');
  }

  private async completeUserRun(
    run: ActiveRuntimeRun,
    status: 'completed' | 'failed',
    summary?: string,
  ): Promise<void> {
    await this.orchestration?.runLedger.completeRun(run.runId, status, summary);
  }

  private createRunAwareToolExecutor(run: ActiveRuntimeRun | null) {
    return async (
      name: string,
      args: Record<string, unknown>,
      ctx?: Parameters<typeof executeRuntimeTool>[2],
    ) => {
      if (run) {
        await this.orchestration?.runLedger.recordToolRequested(run.runId, name, args);
      }
      const result = await executeRuntimeTool(name, args, {
        ...ctx,
        runId: run?.runId ?? ctx?.runId,
      });
      if (run) {
        await this.orchestration?.runLedger.recordToolExecuted(run.runId, name, {
          status: result.success ? 'ok' : 'error',
          error: result.success ? undefined : result.error,
        });
      }
      return result;
    };
  }

  private hashRunInput(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private resolveRuntimeDataRoot(): string | null {
    if (this.options.persistence === false || this.config.persistence.enabled === false) {
      return null;
    }
    return this.config.persistence.rootDir
      ?? this.options.persistence.rootDir
      ?? path.dirname(DEFAULT_CONFIG_PATH)
      ?? path.join(os.homedir(), '.pyrfor');
  }

  private async initOrchestration(): Promise<void> {
    if (this.orchestration) return;

    const rootDir = this.resolveRuntimeDataRoot();
    if (!rootDir) {
      logger.info('[runtime] Orchestration persistence disabled');
      return;
    }

    const orchestrationDir = path.join(rootDir, 'orchestration');
    const eventLedger = new EventLedger(path.join(orchestrationDir, 'events.jsonl'));
    const runLedger = new RunLedger({ ledger: eventLedger });
    await this.hydrateRunLedger(runLedger, eventLedger);

    this.orchestration = {
      eventLedger,
      runLedger,
      dag: new DurableDag({
        storePath: path.join(orchestrationDir, 'dag.json'),
        ledger: eventLedger,
        dagId: 'runtime-orchestration',
        ledgerRunId: 'runtime-orchestration',
      }),
      artifactStore: new ArtifactStore({ rootDir: path.join(rootDir, 'artifacts') }),
      overlays: registerDefaultDomainOverlays(new DomainOverlayRegistry()),
    };

    logger.info('[runtime] Orchestration initialized', {
      rootDir,
      runs: this.orchestration.runLedger.listRuns().length,
      dagNodes: this.orchestration.dag.listNodes().length,
      overlays: this.orchestration.overlays.list().map((overlay) => overlay.domainId),
    });
  }

  private async hydrateRunLedger(runLedger: RunLedger, eventLedger: EventLedger): Promise<void> {
    const runIds = new Set<string>();
    for (const event of await eventLedger.readAll()) {
      if (event.type === 'run.created' && event.run_id) {
        runIds.add(event.run_id);
      }
    }
    for (const runId of runIds) {
      try {
        await runLedger.replayRun(runId);
      } catch (err) {
        logger.warn('[runtime] Failed to hydrate orchestration run', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private orchestrationAsGatewayDeps(): GatewayDeps['orchestration'] | undefined {
    if (!this.orchestration) return undefined;
    return this.orchestration;
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
export { RunLedger } from './run-ledger';
export type { RunLedgerCreateInput, RunLedgerOptions, RunTerminalStatus } from './run-ledger';
export { EventLedger } from './event-ledger';
export type { EventLedgerOptions, LedgerEvent } from './event-ledger';
export { ArtifactStore } from './artifact-model';
export type { ArtifactKind, ArtifactRef, ArtifactStoreOptions } from './artifact-model';
export * from './worker-protocol';
export { WorkerProtocolBridge } from './worker-protocol-bridge';
export type {
  WorkerProtocolBridgeDisposition,
  WorkerProtocolBridgeOptions,
  WorkerProtocolBridgeResult,
} from './worker-protocol-bridge';
export { TwoPhaseEffectRunner } from './two-phase-effect';
export type {
  EffectApplyResult,
  EffectExecutor,
  EffectKind,
  EffectPolicyVerdict,
  EffectProposal,
  EffectProposalInput,
  EffectStatus,
  PolicyDecision,
  TwoPhaseEffectRunnerOptions,
} from './two-phase-effect';
export { DurableDag } from './durable-dag';
export type {
  AddDagNodeInput,
  DagCompensationPolicy,
  DagLease,
  DagNode,
  DagNodeStatus,
  DagProvenanceLink,
  DagRetryClass,
  DagTimeoutClass,
  DurableDagOptions,
  HydrateDagNodeInput,
} from './durable-dag';
export { VerifierLane, runOrchestrationEvalSuite } from './verifier-lane';
export type {
  OrchestrationEvalCase,
  OrchestrationEvalResult,
  VerificationReport,
  VerificationStatus,
  VerifierLaneOptions,
  VerifierLaneResult,
  VerifierReplayInput,
  VerifierSubject,
  VerifierStepRecord,
} from './verifier-lane';
export {
  hashContextPack,
  stableStringify,
  withContextPackHash,
} from './context-pack';
export type {
  ContextMemoryEntry,
  ContextPack,
  ContextPackSchemaVersion,
  ContextPackSection,
  ContextSectionKind,
  ContextSourceRef,
  ContextTaskContract,
} from './context-pack';
export { ContextCompiler } from './context-compiler';
export type {
  CompileContextInput,
  CompileContextResult,
  ContextCompilerDeps,
  ContextFactInput,
  ContextFileInput,
} from './context-compiler';
export * from './domain-overlay';
export * from './domain-overlay-presets';
export * from './orchestration-host-factory';
export * from './tools';
export * from './pyrfor-scoring';
