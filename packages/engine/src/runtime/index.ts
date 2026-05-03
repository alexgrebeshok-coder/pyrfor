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
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { approvalFlow, type ApprovalFlowEvent, type ApprovalRequest } from './approval-flow';
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
import { EventLedger, type ApprovalRequestedEvent } from './event-ledger';
import { RunLedger } from './run-ledger';
import { ContextCompiler } from './context-compiler';
import { VerifierLane, type VerificationStatus } from './verifier-lane';
import {
  createOrchestrationHost,
  type OrchestrationHost,
} from './orchestration-host-factory';
import type { ToolExecutor } from './contracts-bridge';
import type { AcpEvent } from './acp-client';
import type { FCEvent } from './pyrfor-fc-adapter';
import type { PermissionClass, PermissionEngineOptions } from './permission-engine';
import type { WorkerProtocolBridgeResult } from './worker-protocol-bridge';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol';
import type { StepValidator } from './step-validator';
import type { ArtifactRef } from './artifact-model';
import type { RunRecord } from './run-lifecycle';
import {
  createDefaultProductFactory,
  type ProductFactoryPlanInput,
  type ProductFactoryPlanPreview,
  type ProductFactoryTemplate,
} from './product-factory';
import {
  captureDeliveryEvidence,
  type DeliveryEvidenceSnapshot,
} from './github-delivery-evidence';
import {
  buildGithubDeliveryPlan,
  type GitHubDeliveryPlan,
} from './github-delivery-plan';
import {
  applyGithubDeliveryPlan,
  buildApplyIdempotencyKey,
  validateGithubDeliveryApplyPreconditions,
  type GitHubDeliveryApplyApplied,
  type GitHubDeliveryApplyPending,
  type GitHubDeliveryApplyRequest,
  type GitHubDeliveryApplyResult,
} from './github-delivery-apply';

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
  workerRunId?: string;
  orchestrationHost?: OrchestrationHost;
  workerTransport?: RuntimeWorkerTransport;
  terminalByWorker?: boolean;
  governed?: GovernedRuntimeRunState;
}

export type RuntimeWorkerTransport = 'freeclaude' | 'acp';

export interface RuntimeWorkerOptions {
  transport: RuntimeWorkerTransport;
  events?: (ctx: { runId: string; taskId: string; sessionId: string; workerRunId: string }) => AsyncIterable<FCEvent> | AsyncIterable<AcpEvent>;
  domainIds?: string[];
  permissionProfile?: PermissionEngineOptions['profile'];
  permissionOverrides?: Record<string, PermissionClass>;
  verifierValidators?: StepValidator[];
}

export type VerifierRawStatus = 'passed' | 'warning' | 'failed' | 'blocked';
export type VerifierWaiverScope = 'run' | 'delivery' | 'delivery_plan' | 'delivery_apply' | 'all';

export interface VerifierWaiverRecord {
  schemaVersion: 'pyrfor.verifier_waiver.v1';
  runId: string;
  verifierRunId?: string;
  verifierArtifactId?: string;
  verifierEventId?: string;
  rawStatus: VerifierRawStatus;
  operator: {
    id: string;
    name?: string;
  };
  reason: string;
  scope: VerifierWaiverScope;
  waivedAt: string;
}

export interface VerifierDecision {
  status: VerificationStatus;
  rawStatus: VerifierRawStatus;
  reason?: string;
  findings?: number;
  verifierRunId?: string;
  verifierArtifactId?: string;
  verifierEventId?: string;
  decidedAt?: string;
  waivedFrom?: VerifierRawStatus;
  waiverArtifact?: ArtifactRef;
  waiver?: VerifierWaiverRecord;
  waiverEligible: boolean;
  waiverPath: string;
}

export interface VerifierWaiverInput {
  operatorId: string;
  operatorName?: string;
  reason: string;
  scope?: VerifierWaiverScope;
}

interface GovernedRuntimeRunState {
  contextArtifact: ArtifactRef;
  contextNodeId: string;
  workerEvents: AcpEvent[];
  frameNodeIds: string[];
  effectNodeIds: string[];
  verifierNodeId?: string;
  verifierStatus?: VerificationStatus;
}

const execFileAsync = promisify(execFile);

function buildCeoclawBusinessBriefApprovalId(runId: string): string {
  return `ceoclaw-business-brief-${runId}`;
}

function buildGithubDeliveryApplyApprovalId(runId: string, planArtifactId: string, expectedPlanSha256: string): string {
  const digest = createHash('sha256')
    .update(`${runId}:${planArtifactId}:${expectedPlanSha256}`)
    .digest('hex')
    .slice(0, 24);
  return `github-delivery-apply-${digest}`;
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
  private approvalFlowUnsubscribe: (() => void) | null = null;
  private readonly ceoclawDenialApprovalsInFlight = new Set<string>();
  private readonly productFactory = createDefaultProductFactory();
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

    if (this.approvalFlowUnsubscribe) {
      this.approvalFlowUnsubscribe();
      this.approvalFlowUnsubscribe = null;
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
      worker?: RuntimeWorkerOptions;
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

      if (options?.worker && activeRun) {
        await this.prepareGovernedRun(activeRun, {
          sessionId: session.id,
          text,
          openFiles: [],
        });
      }

      const workerResponse = await this.runLiveWorkerStream(activeRun, session.id, userId, options?.worker);
      let response: string;

      if (workerResponse !== null) {
        response = workerResponse;
        if (activeRun) {
          await this.finalizeGovernedRun(activeRun, session.id, options?.worker);
        }
      } else {
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

        response = loopResult.finalText;

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
      }

      // Persist only the final assistant answer in session history.
      // Tool calls / results are ephemeral (they live inside the loop's working
      // copy); future turns get a fresh tool-call cycle, which keeps history
      // clean and avoids stuffing it with raw file dumps.
      this.sessions.addMessage(session.id, { role: 'assistant', content: response });

      // Get cost info
      const cost = this.providers.getSessionCost(session.id);
      if (activeRun && !activeRun.terminalByWorker) {
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
    worker?: RuntimeWorkerOptions;
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

      if (input.worker && activeRun) {
        await this.prepareGovernedRun(activeRun, {
          sessionId,
          text: input.text,
          openFiles: input.openFiles ?? [],
        });
      }

      const workerResponse = await this.runLiveWorkerStream(activeRun, sessionId, userId, input.worker);
      if (workerResponse !== null) {
        finalText = workerResponse;
        if (activeRun) {
          await this.finalizeGovernedRun(activeRun, sessionId, input.worker);
        }
        yield { type: 'final', text: finalText };
      } else {
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
          loopOpts: {
            approvalGate: (req) => approvalFlow.requestApproval(req),
            onToolAudit: (event) => approvalFlow.recordToolOutcome(event),
          },
        })) {
          if (event.type === 'final') {
            finalText = event.text;
          }
          yield event;
        }
      }
      if (activeRun && !activeRun.terminalByWorker) {
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

  listProductFactoryTemplates(): ProductFactoryTemplate[] {
    return this.productFactory.listTemplates();
  }

  previewProductFactoryPlan(input: ProductFactoryPlanInput): ProductFactoryPlanPreview {
    return this.productFactory.previewPlan(input);
  }

  async createProductFactoryRun(input: ProductFactoryPlanInput): Promise<{
    run: RunRecord;
    preview: ProductFactoryPlanPreview;
    artifact: ArtifactRef;
  }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');

    const preview = this.productFactory.previewPlan(input);
    if (preview.missingClarifications.length > 0) {
      const missing = preview.missingClarifications.map((item) => item.id).join(', ');
      throw new Error(`ProductFactory: missing required clarifications: ${missing}`);
    }
    const run = await this.orchestration.runLedger.createRun({
      task_id: preview.intent.id,
      workspace_id: this.options.workspacePath,
      repo_id: this.options.workspacePath,
      branch_or_worktree_id: '',
      mode: 'pm',
      goal: preview.intent.goal.slice(0, 500),
      model_profile: this.config.ai?.activeModel?.modelId ?? '',
      provider_route: this.config.ai?.activeModel?.provider ?? this.config.providers?.defaultProvider ?? '',
      context_snapshot_hash: this.hashRunInput(`${preview.intent.id}:${preview.template.id}`),
      prompt_snapshot_hash: this.hashRunInput(preview.intent.goal),
      permission_profile: { profile: 'standard' },
      budget_profile: {},
    });
    await this.orchestration.runLedger.transition(run.run_id, 'planned', 'product factory plan preview created');

    const artifact = await this.orchestration.artifactStore.writeJSON('plan', preview, {
      runId: run.run_id,
      meta: {
        productFactory: true,
        templateId: preview.template.id,
        intentId: preview.intent.id,
      },
    });
    const recorded = await this.orchestration.runLedger.recordArtifact(run.run_id, artifact.id, []);
    this.seedProductFactoryDag(run.run_id, preview, artifact);

    return { run: recorded, preview, artifact };
  }

  async executeProductFactoryRun(
    runId: string,
    options: {
      worker?: RuntimeWorkerOptions;
      sessionId?: string;
      userId?: string;
      approvalId?: string;
    } = {},
  ): Promise<{
    run: RunRecord;
    deliveryArtifact: ArtifactRef;
    summary: string;
    deliveryEvidenceArtifact?: ArtifactRef;
    deliveryEvidence?: DeliveryEvidenceSnapshot;
    approval?: ApprovalRequest;
  }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');

    const runRecord = this.orchestration.runLedger.getRun(runId);
    if (!runRecord) throw new Error(`ProductFactory: run not found: ${runId}`);
    if (runRecord.mode !== 'pm') throw new Error(`ProductFactory: run ${runId} is not a product run`);
    const preview = await this.loadProductFactoryPreview(runId);
    if (preview.template.id === 'ochag_family_reminder') {
      return this.executeOchagReminderRun(runId, runRecord, preview);
    }
    if (preview.template.id === 'business_brief') {
      return this.executeCeoclawBusinessBriefRun(runId, runRecord, preview, options.approvalId);
    }
    if (runRecord.status !== 'planned') {
      throw new Error(`ProductFactory: run ${runId} must be planned before execution`);
    }

    const sessionId = options.sessionId ?? `product-factory:${runId}`;
    const userId = options.userId ?? 'product-factory';
    const activeRun: ActiveRuntimeRun = { runId, taskId: runRecord.task_id };
    const worker = this.withProductFactoryDefaultWorker(options.worker, preview);

    await this.orchestration.runLedger.transition(runId, 'running', 'product factory execution started');
    await this.completeProductFactoryDagNodes(runId, [
      'product_factory.clarify_scope',
      'product_factory.compile_context',
      'product_factory.scoped_plan',
    ]);

    try {
      await this.prepareGovernedRun(activeRun, {
        sessionId,
        text: this.productFactoryExecutionPrompt(preview),
        openFiles: [],
      });
      const summary = await this.runLiveWorkerStream(activeRun, sessionId, userId, worker)
        ?? 'Product Factory execution completed.';
      await this.completeProductFactoryDagNodes(runId, ['product_factory.worker_execution']);
      const verifierStatus = await this.finalizeGovernedRun(activeRun, sessionId, worker, { completeRun: false });
      if (verifierStatus !== 'passed' && verifierStatus !== 'warning') {
        await this.orchestration.runLedger.blockRun(runId, `verifier ${verifierStatus ?? 'unknown'}`);
        throw new Error(`ProductFactory: verifier blocked execution (${verifierStatus ?? 'unknown'}); create a verifier waiver to complete this run`);
      }
      const deliveryArtifact = await this.orchestration.artifactStore.writeJSON('summary', {
        productFactory: true,
        runId,
        intent: preview.intent,
        templateId: preview.template.id,
        summary,
        deliveryChecklist: preview.deliveryChecklist,
        verifierStatus,
      }, {
        runId,
        meta: {
          productFactory: true,
          templateId: preview.template.id,
          intentId: preview.intent.id,
          delivery: true,
          verifierStatus,
        },
      });
      await this.orchestration.runLedger.recordArtifact(runId, deliveryArtifact.id, [deliveryArtifact.uri]);
      await this.completeProductFactoryDagNodes(runId, [
        'product_factory.verify',
        'product_factory.delivery_package',
      ], deliveryArtifact);
      const deliveryEvidence = await this.captureRunDeliveryEvidence(runId, {
        summary,
        verifierStatus,
        deliveryChecklist: preview.deliveryChecklist,
        deliveryArtifactId: deliveryArtifact.id,
      });
      await this.completeUserRun(activeRun, 'completed', `product factory verified: ${verifierStatus}`);
      return {
        run: this.orchestration.runLedger.getRun(runId)!,
        deliveryArtifact,
        deliveryEvidenceArtifact: deliveryEvidence.artifact,
        deliveryEvidence: deliveryEvidence.snapshot,
        summary,
      };
    } catch (err) {
      const current = this.orchestration.runLedger.getRun(runId);
      if (current && current.status !== 'failed' && current.status !== 'completed' && current.status !== 'blocked' && current.status !== 'cancelled') {
        await this.orchestration.runLedger.completeRun(runId, 'failed', err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }

  async captureRunDeliveryEvidence(
    runId: string,
    input: {
      summary?: string;
      verifierStatus?: string;
      deliveryChecklist?: string[];
      deliveryArtifactId?: string;
      issueNumber?: number;
    } = {},
  ): Promise<{ artifact: ArtifactRef; snapshot: DeliveryEvidenceSnapshot }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('DeliveryEvidence: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`DeliveryEvidence: run not found: ${runId}`);
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'warning' && verifierDecision.status !== 'waived') {
      throw new Error(`DeliveryEvidence: verifier has not approved run ${runId} (${verifierDecision.status})`);
    }

    const snapshot = await captureDeliveryEvidence({
      workspace: this.options.workspacePath,
      runId,
      summary: input.summary,
      verifierStatus: verifierDecision.status,
      deliveryChecklist: input.deliveryChecklist,
      deliveryArtifactId: input.deliveryArtifactId,
      issueNumber: input.issueNumber,
      githubToken: this.resolveGithubToken(),
      verifier: {
        status: verifierDecision.status,
        rawStatus: verifierDecision.rawStatus,
        ...(verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {}),
        ...(verifierDecision.reason ? { reason: verifierDecision.reason } : {}),
        ...(verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {}),
      },
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('delivery_evidence', snapshot, {
      runId,
      meta: {
        provider: 'github',
        repository: snapshot.github.repository,
        branch: snapshot.git.branch,
        commitSha: snapshot.git.headSha,
        verifierStatus: snapshot.verifierStatus,
        rawVerifierStatus: verifierDecision.rawStatus,
        waiverArtifactId: verifierDecision.waiverArtifact?.id,
        deliveryArtifactId: snapshot.deliveryArtifactId,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    }
    await this.completeDeliveryEvidenceDagNode(runId, artifact, snapshot);
    return { artifact, snapshot };
  }

  async getRunVerifierStatus(runId: string): Promise<{ decision: VerifierDecision }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('VerifierPolicy: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`VerifierPolicy: run not found: ${runId}`);
    return { decision: await this.resolveRunVerifierDecision(runId) };
  }

  async createRunVerifierWaiver(
    runId: string,
    input: VerifierWaiverInput,
  ): Promise<{ artifact: ArtifactRef; waiver: VerifierWaiverRecord; decision: VerifierDecision; run: RunRecord }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('VerifierPolicy: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`VerifierPolicy: run not found: ${runId}`);
    const operatorId = input.operatorId.trim();
    const reason = input.reason.trim();
    if (!operatorId) throw new Error('VerifierPolicy: operatorId is required');
    if (reason.length < 8) throw new Error('VerifierPolicy: waiver reason must be at least 8 characters');
    const scope = input.scope ?? 'all';
    if (!this.isVerifierWaiverScope(scope)) throw new Error(`VerifierPolicy: invalid waiver scope ${scope}`);

    const currentDecision = await this.resolveRunVerifierDecision(runId);
    if (currentDecision.rawStatus === 'passed') {
      throw new Error('VerifierPolicy: passed verifier results do not need a waiver');
    }

    const waiver: VerifierWaiverRecord = {
      schemaVersion: 'pyrfor.verifier_waiver.v1',
      runId,
      ...(currentDecision.verifierRunId ? { verifierRunId: currentDecision.verifierRunId } : {}),
      ...(currentDecision.verifierArtifactId ? { verifierArtifactId: currentDecision.verifierArtifactId } : {}),
      ...(currentDecision.verifierEventId ? { verifierEventId: currentDecision.verifierEventId } : {}),
      rawStatus: currentDecision.rawStatus,
      operator: {
        id: operatorId,
        ...(input.operatorName?.trim() ? { name: input.operatorName.trim() } : {}),
      },
      reason,
      scope,
      waivedAt: new Date().toISOString(),
    };
    const artifact = await this.orchestration.artifactStore.writeJSON('verifier_waiver', waiver, {
      runId,
      meta: {
        rawStatus: waiver.rawStatus,
        operatorId,
        scope,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    }
    await this.orchestration.eventLedger.append({
      type: 'verifier.waived',
      run_id: runId,
      status: 'waived',
      waived_from: currentDecision.rawStatus,
      approved_by: operatorId,
      reason,
      scope,
      artifact_id: artifact.id,
    });

    await this.completeVerifierWaiverDagNode(runId, artifact, waiver);

    const decision = await this.resolveRunVerifierDecision(runId, scope);
    return { artifact, waiver, decision, run: this.orchestration.runLedger.getRun(runId)! };
  }

  private async resolveRunVerifierDecision(
    runId: string,
    scope?: VerifierWaiverScope,
  ): Promise<VerifierDecision> {
    if (!this.orchestration) throw new Error('VerifierPolicy: orchestration is disabled');
    const rawCandidates: Array<{
      status: VerifierRawStatus;
      reason?: string;
      findings?: number;
      verifierRunId?: string;
      verifierArtifactId?: string;
      verifierEventId?: string;
      decidedAt: string;
    }> = [];

    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'test_result' });
    for (const artifact of artifacts) {
      try {
        if (!artifact.sha256) throw new Error(`VerifierPolicy: verifier artifact ${artifact.id} has no sha256`);
        const body = await this.orchestration.artifactStore.readJSONVerified<{ status?: unknown; verifierRunId?: unknown }>(artifact, artifact.sha256);
        const status = this.normalizeVerificationStatus(artifact.meta?.['status'] ?? body.status);
        if (!status) continue;
        rawCandidates.push({
          status,
          ...(typeof body.verifierRunId === 'string' ? { verifierRunId: body.verifierRunId } : {}),
          verifierArtifactId: artifact.id,
          decidedAt: artifact.createdAt,
        });
      } catch (err) {
        logger.warn('[runtime] Verifier policy skipped unreadable verifier artifact', {
          runId,
          artifactId: artifact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const events = await this.orchestration.runLedger.eventsForRun(runId);
    for (const event of events) {
      if (event.type !== 'verifier.completed') continue;
      const status = this.normalizeVerificationStatus(event.status);
      if (!status) continue;
      rawCandidates.push({
        status,
        reason: event.reason,
        findings: event.findings,
        verifierRunId: event.subject_id,
        verifierEventId: event.id,
        decidedAt: event.ts,
      });
      for (const candidate of rawCandidates) {
        if (
          candidate.status === status
          && candidate.verifierRunId === event.subject_id
          && !candidate.verifierEventId
        ) {
          candidate.verifierEventId = event.id;
          if (event.reason !== undefined && candidate.reason === undefined) candidate.reason = event.reason;
          if (event.findings !== undefined && candidate.findings === undefined) candidate.findings = event.findings;
        }
      }
    }

    const latestRaw = rawCandidates.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)).at(-1);
    if (!latestRaw) throw new Error(`VerifierPolicy: no verifier result recorded for run ${runId}`);

    const waiverArtifacts = await this.orchestration.artifactStore.list({ runId, kind: 'verifier_waiver' });
    let latestWaiver: { artifact: ArtifactRef; waiver: VerifierWaiverRecord } | null = null;
    for (const artifact of waiverArtifacts) {
      try {
        if (!artifact.sha256) throw new Error(`VerifierPolicy: waiver artifact ${artifact.id} has no sha256`);
        const waiver = await this.orchestration.artifactStore.readJSONVerified<VerifierWaiverRecord>(artifact, artifact.sha256);
        if (waiver.schemaVersion !== 'pyrfor.verifier_waiver.v1' || waiver.runId !== runId) continue;
        if (!this.waiverScopeMatches(waiver.scope, scope)) continue;
        if (new Date(waiver.waivedAt).getTime() < new Date(latestRaw.decidedAt).getTime()) continue;
        if (!latestWaiver || waiver.waivedAt > latestWaiver.waiver.waivedAt) {
          latestWaiver = { artifact, waiver };
        }
      } catch (err) {
        logger.warn('[runtime] Verifier policy skipped unreadable waiver artifact', {
          runId,
          artifactId: artifact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const waiverPath = `/api/runs/${encodeURIComponent(runId)}/verifier-waiver`;
    if (latestWaiver && latestRaw.status !== 'passed') {
      return {
        status: 'waived',
        rawStatus: latestRaw.status,
        reason: latestRaw.reason ?? latestWaiver.waiver.reason,
        findings: latestRaw.findings,
        verifierRunId: latestRaw.verifierRunId,
        verifierArtifactId: latestRaw.verifierArtifactId,
        verifierEventId: latestRaw.verifierEventId,
        decidedAt: latestRaw.decidedAt,
        waivedFrom: latestRaw.status,
        waiverArtifact: latestWaiver.artifact,
        waiver: latestWaiver.waiver,
        waiverEligible: true,
        waiverPath,
      };
    }

    return {
      status: latestRaw.status,
      rawStatus: latestRaw.status,
      reason: latestRaw.reason,
      findings: latestRaw.findings,
      verifierRunId: latestRaw.verifierRunId,
      verifierArtifactId: latestRaw.verifierArtifactId,
      verifierEventId: latestRaw.verifierEventId,
      decidedAt: latestRaw.decidedAt,
      waiverEligible: latestRaw.status !== 'passed',
      waiverPath,
    };
  }

  private normalizeVerificationStatus(value: unknown): VerifierRawStatus | null {
    if (value === 'passed' || value === 'warning' || value === 'failed' || value === 'blocked') return value;
    if (value === 'needs_rework') return 'failed';
    if (value === 'user_required') return 'blocked';
    return null;
  }

  private isVerifierWaiverScope(value: unknown): value is VerifierWaiverScope {
    return value === 'run'
      || value === 'delivery'
      || value === 'delivery_plan'
      || value === 'delivery_apply'
      || value === 'all';
  }

  private waiverScopeMatches(waiverScope: VerifierWaiverScope, requestedScope?: VerifierWaiverScope): boolean {
    if (!requestedScope) return waiverScope === 'all' || waiverScope === 'run';
    if (waiverScope === 'all') return true;
    if (waiverScope === requestedScope) return true;
    if (waiverScope === 'delivery' && (requestedScope === 'delivery' || requestedScope === 'delivery_plan' || requestedScope === 'delivery_apply')) return true;
    return false;
  }

  async getRunDeliveryEvidence(runId: string): Promise<{ artifact: ArtifactRef; snapshot: DeliveryEvidenceSnapshot } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('DeliveryEvidence: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`DeliveryEvidence: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_evidence' });
    const latest = artifacts.at(-1);
    if (!latest) return null;
    return {
      artifact: latest,
      snapshot: await this.orchestration.artifactStore.readJSON<DeliveryEvidenceSnapshot>(latest),
    };
  }

  async createRunGithubDeliveryPlan(
    runId: string,
    input: {
      issueNumber?: number;
      title?: string;
      body?: string;
    } = {},
  ): Promise<{ artifact: ArtifactRef; plan: GitHubDeliveryPlan; evidenceArtifact: ArtifactRef }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryPlan: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryPlan: run not found: ${runId}`);
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_plan');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
      throw new Error(`GitHubDeliveryPlan: verifier must be passed or waived before delivery planning (${verifierDecision.status})`);
    }
    if (run.status !== 'completed' && !(run.status === 'blocked' && verifierDecision.status === 'waived')) {
      throw new Error(`GitHubDeliveryPlan: run ${runId} must be completed before delivery planning`);
    }

    const applyVerifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_apply');
    const githubToken = this.resolveGithubToken();
    const applyBlockers = [
      ...(run.status === 'completed' ? [] : [`run status is ${run.status}; apply requires completed`]),
      ...(githubToken ? [] : ['GitHub token is unavailable for apply']),
      ...(applyVerifierDecision.status === 'passed' || applyVerifierDecision.status === 'waived'
        ? []
        : [`verifier must be passed or waived before apply (${applyVerifierDecision.status})`]),
    ];

    let evidence = await this.getRunDeliveryEvidence(runId);
    if (!evidence) {
      if (verifierDecision.status === 'waived') {
        const snapshot = await captureDeliveryEvidence({
          workspace: this.options.workspacePath,
          runId,
          issueNumber: input.issueNumber,
          githubToken,
          verifierStatus: 'waived',
          verifier: {
            status: 'waived',
            rawStatus: verifierDecision.rawStatus,
            ...(verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {}),
            ...(verifierDecision.reason ? { reason: verifierDecision.reason } : {}),
            ...(verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {}),
          },
        });
        const artifact = await this.orchestration.artifactStore.writeJSON('delivery_evidence', snapshot, {
          runId,
          meta: {
            provider: 'github',
            repository: snapshot.github.repository,
            branch: snapshot.git.branch,
            commitSha: snapshot.git.headSha,
            verifierStatus: snapshot.verifierStatus,
            rawVerifierStatus: verifierDecision.rawStatus,
            waiverArtifactId: verifierDecision.waiverArtifact?.id,
            deliveryArtifactId: snapshot.deliveryArtifactId,
          },
        });
        const currentRun = this.orchestration.runLedger.getRun(runId);
        if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
          await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
        }
        await this.completeDeliveryEvidenceDagNode(runId, artifact, snapshot);
        evidence = { artifact, snapshot };
      } else {
        evidence = await this.captureRunDeliveryEvidence(runId, {
          issueNumber: input.issueNumber,
        });
      }
    }
    if (
      verifierDecision.status === 'waived'
      && evidence.snapshot.verifier?.waiverArtifactId !== verifierDecision.waiverArtifact?.id
    ) {
      const waivedEvidenceSnapshot = {
        ...evidence.snapshot,
        verifierStatus: 'waived',
        verifier: {
          status: 'waived',
          rawStatus: verifierDecision.rawStatus,
          ...(verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {}),
          ...(verifierDecision.reason ? { reason: verifierDecision.reason } : {}),
          ...(verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {}),
        },
      } satisfies DeliveryEvidenceSnapshot;
      const waivedEvidenceArtifact = await this.orchestration.artifactStore.writeJSON('delivery_evidence', waivedEvidenceSnapshot, {
        runId,
        meta: {
          provider: 'github',
          repository: waivedEvidenceSnapshot.github.repository,
          branch: waivedEvidenceSnapshot.git.branch,
          commitSha: waivedEvidenceSnapshot.git.headSha,
          verifierStatus: waivedEvidenceSnapshot.verifierStatus,
          rawVerifierStatus: verifierDecision.rawStatus,
          waiverArtifactId: verifierDecision.waiverArtifact?.id,
          deliveryArtifactId: waivedEvidenceSnapshot.deliveryArtifactId,
          sourceEvidenceArtifactId: evidence.artifact.id,
        },
      });
      const currentRun = this.orchestration.runLedger.getRun(runId);
      if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
        await this.orchestration.runLedger.recordArtifact(runId, waivedEvidenceArtifact.id, []);
      }
      await this.completeDeliveryEvidenceDagNode(runId, waivedEvidenceArtifact, waivedEvidenceSnapshot);
      evidence = { artifact: waivedEvidenceArtifact, snapshot: waivedEvidenceSnapshot };
    }
    const plan = buildGithubDeliveryPlan({
      run,
      evidence: evidence.snapshot,
      evidenceArtifactId: evidence.artifact.id,
      issueNumber: input.issueNumber,
      title: input.title,
      body: input.body,
      applySupported: Boolean(githubToken) && applyBlockers.length === 0,
      applyBlockers,
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('delivery_plan', plan, {
      runId,
      meta: {
        provider: 'github',
        mode: plan.mode,
        applySupported: plan.applySupported,
        repository: plan.repository,
        branch: plan.proposedBranch,
        headSha: plan.headSha,
        blockers: plan.blockers.length,
        evidenceArtifactId: evidence.artifact.id,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    }
    await this.completeGithubDeliveryPlanDagNode(runId, artifact, plan, evidence.artifact);
    return { artifact, plan, evidenceArtifact: evidence.artifact };
  }

  async getRunGithubDeliveryPlan(runId: string): Promise<{ artifact: ArtifactRef; plan: GitHubDeliveryPlan } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryPlan: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryPlan: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_plan' });
    const latest = artifacts.at(-1);
    if (!latest) return null;
    return {
      artifact: latest,
      plan: await this.orchestration.artifactStore.readJSON<GitHubDeliveryPlan>(latest),
    };
  }

  async requestRunGithubDeliveryApply(
    runId: string,
    input: GitHubDeliveryApplyRequest,
  ): Promise<GitHubDeliveryApplyPending> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    const { run, artifact, plan } = await this.loadGithubDeliveryApplyPlan(runId, input);
    if (run.status !== 'completed') {
      throw new Error(`GitHubDeliveryApply: run ${runId} must be completed before delivery apply`);
    }
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_apply');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
      throw new Error(`GitHubDeliveryApply: verifier must be passed or waived before apply (${verifierDecision.status})`);
    }
    await validateGithubDeliveryApplyPreconditions({
      workspace: this.options.workspacePath,
      runId,
      plan,
      planArtifact: artifact,
      expectedPlanSha256: input.expectedPlanSha256,
    });
    const expectedPlanSha256 = artifact.sha256 ?? input.expectedPlanSha256;
    const approval = await this.enqueueGithubDeliveryApplyApproval({
      runId,
      plan,
      planArtifact: artifact,
      expectedPlanSha256,
    });
    await this.orchestration.eventLedger.append({
      type: 'approval.requested',
      run_id: runId,
      tool: 'github_delivery_apply',
      approval_id: approval.id,
      artifact_id: artifact.id,
      reason: `approval required for delivery plan ${artifact.id}`,
    });
    return {
      status: 'awaiting_approval',
      approval,
      planArtifactId: artifact.id,
      expectedPlanSha256,
    };
  }

  async applyApprovedRunGithubDelivery(
    runId: string,
    input: GitHubDeliveryApplyRequest,
  ): Promise<GitHubDeliveryApplyApplied> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    if (!input.approvalId) throw new Error('GitHubDeliveryApply: approvalId is required');
    const approval = approvalFlow.getResolvedApproval(input.approvalId);
    if (!approval) {
      throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is pending`);
    }
    if (approval.request.toolName !== 'github_delivery_apply') {
      throw new Error('GitHubDeliveryApply: approval was not issued for GitHub delivery apply');
    }
    if (approval.request.args['runId'] !== runId
      || approval.request.args['planArtifactId'] !== input.planArtifactId
      || approval.request.args['expectedPlanSha256'] !== input.expectedPlanSha256) {
      throw new Error('GitHubDeliveryApply: approval does not match the reviewed delivery plan');
    }
    if (approval.decision !== 'approve') {
      if (!approvalFlow.consumeResolvedApproval(input.approvalId)) {
        throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is no longer available`);
      }
      await this.orchestration.eventLedger.append({
        type: 'approval.denied',
        run_id: runId,
        tool: 'github_delivery_apply',
        approval_id: input.approvalId,
        artifact_id: input.planArtifactId,
        reason: `approval ${input.approvalId} was ${approval.decision}`,
      });
      throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is ${approval.decision}`);
    }
    if (!approvalFlow.consumeResolvedApproval(input.approvalId)) {
      throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is no longer available`);
    }
    const { run, artifact: planArtifact, plan } = await this.loadGithubDeliveryApplyPlan(runId, input);
    if (run.status !== 'completed') {
      throw new Error(`GitHubDeliveryApply: run ${runId} must be completed before delivery apply`);
    }
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_apply');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
      throw new Error(`GitHubDeliveryApply: verifier must be passed or waived before apply (${verifierDecision.status})`);
    }
    const token = this.resolveGithubToken();
    if (!token) throw new Error('GitHubDeliveryApply: GitHub token is unavailable');
    const result = await applyGithubDeliveryPlan({
      workspace: this.options.workspacePath,
      runId,
      plan,
      planArtifact,
      approvalId: input.approvalId,
      githubToken: token,
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('delivery_apply', result, {
      runId,
      meta: {
        provider: 'github',
        mode: result.mode,
        repository: result.repository,
        branch: result.branch,
        headSha: result.headSha,
        planArtifactId: planArtifact.id,
        planSha256: planArtifact.sha256,
        approvalId: input.approvalId,
        pullRequestNumber: result.draftPullRequest.number,
        pullRequestUrl: result.draftPullRequest.url,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    }
    await this.orchestration.eventLedger.append({
      type: 'approval.granted',
      run_id: runId,
      tool: 'github_delivery_apply',
      approval_id: input.approvalId,
      artifact_id: planArtifact.id,
      approved_by: input.approvalId,
    });
    await this.completeGithubDeliveryApplyDagNode(runId, artifact, result, planArtifact);
    return { status: 'applied', artifact, result };
  }

  async getRunGithubDeliveryApply(runId: string): Promise<{ artifact: ArtifactRef; result: GitHubDeliveryApplyResult } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryApply: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_apply' });
    const latest = artifacts.at(-1);
    if (!latest) return null;
    return {
      artifact: latest,
      result: await this.orchestration.artifactStore.readJSON<GitHubDeliveryApplyResult>(latest),
    };
  }

  private async loadGithubDeliveryApplyPlan(
    runId: string,
    input: GitHubDeliveryApplyRequest,
  ): Promise<{ run: RunRecord; artifact: ArtifactRef; plan: GitHubDeliveryPlan }> {
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    if (!input.planArtifactId || !input.expectedPlanSha256) {
      throw new Error('GitHubDeliveryApply: planArtifactId and expectedPlanSha256 are required');
    }
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryApply: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_plan' });
    const artifact = artifacts.find((candidate) => candidate.id === input.planArtifactId);
    if (!artifact) throw new Error(`GitHubDeliveryApply: delivery plan artifact not found: ${input.planArtifactId}`);
    const latest = artifacts.at(-1);
    if (latest?.id !== artifact.id) {
      throw new Error('GitHubDeliveryApply: a newer delivery plan exists and requires review');
    }
    if (artifact.sha256 !== input.expectedPlanSha256) {
      throw new Error('GitHubDeliveryApply: plan artifact sha mismatch');
    }
    const plan = await this.orchestration.artifactStore.readJSONVerified<GitHubDeliveryPlan>(
      artifact,
      input.expectedPlanSha256,
    );
    if (plan.evidenceArtifactId) {
      const evidenceArtifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_evidence' });
      if (!evidenceArtifacts.some((candidate) => candidate.id === plan.evidenceArtifactId)) {
        throw new Error('GitHubDeliveryApply: referenced delivery evidence artifact was not found');
      }
    }
    return { run, artifact, plan };
  }

  private async loadProductFactoryPreview(runId: string): Promise<ProductFactoryPlanPreview> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'plan' });
    const planArtifact = [...artifacts].reverse().find((artifact) => artifact.meta?.['productFactory'] === true);
    if (!planArtifact) throw new Error(`ProductFactory: plan artifact not found for run ${runId}`);
    return this.orchestration.artifactStore.readJSON<ProductFactoryPlanPreview>(planArtifact);
  }

  private async executeOchagReminderRun(
    runId: string,
    runRecord: RunRecord,
    preview: ProductFactoryPlanPreview,
  ): Promise<{
    run: RunRecord;
    deliveryArtifact: ArtifactRef;
    summary: string;
  }> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    if (runRecord.status !== 'planned') {
      throw new Error(`ProductFactory: Ochag run ${runId} must be planned before execution`);
    }
    const answers = this.extractProductFactoryAnswers(preview);
    const evidence = {
      schemaVersion: 'pyrfor.ochag_reminder_delivery.v1',
      runId,
      familyId: answers['familyId'] ?? 'default-family',
      audience: answers['audience'] ?? 'family',
      visibility: answers['visibility'] ?? 'family',
      dueAt: answers['dueAt'],
      title: preview.intent.title,
      privacyPolicy: 'member-private details redacted; sensitive Telegram sends require owner/adult approval',
      scheduled: true,
      channel: 'telegram',
    };
    await this.orchestration.runLedger.transition(runId, 'running', 'Ochag reminder execution started');
    await this.completeProductFactoryDagNodes(runId, [
      'ochag.classify_request',
      'ochag.privacy_check',
      'ochag.schedule_reminder',
    ]);
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', evidence, {
      runId,
      meta: {
        productFactory: true,
        domainId: 'ochag',
        templateId: preview.template.id,
        intentId: preview.intent.id,
        familyId: evidence.familyId,
        visibility: evidence.visibility,
        scheduled: true,
      },
    });
    await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    await this.completeProductFactoryDagNodes(runId, ['ochag.telegram_notify'], artifact);
    await this.orchestration.eventLedger.append({
      type: 'test.completed',
      run_id: runId,
      status: 'ochag.reminder_mvp:passed',
      ms: 0,
    });
    await this.completeUserRun({ runId, taskId: runRecord.task_id }, 'completed', 'Ochag reminder scheduled with Telegram delivery evidence');
    return {
      run: this.orchestration.runLedger.getRun(runId)!,
      deliveryArtifact: artifact,
      summary: `Ochag reminder scheduled for ${evidence.audience} (${evidence.visibility}) at ${evidence.dueAt ?? 'unspecified time'}.`,
    };
  }

  private async executeCeoclawBusinessBriefRun(
    runId: string,
    runRecord: RunRecord,
    preview: ProductFactoryPlanPreview,
    approvalId?: string,
  ): Promise<{
    run: RunRecord;
    deliveryArtifact: ArtifactRef;
    summary: string;
    approval?: ApprovalRequest;
  }> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const answers = this.extractProductFactoryAnswers(preview);
    const evidenceRefs = answers['evidence']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
    const projectId = answers['projectId'] ?? 'default-project';

    if (!approvalId) {
      if (runRecord.status !== 'planned') {
        throw new Error(`ProductFactory: CEOClaw run ${runId} must be planned before approval request`);
      }
      await this.orchestration.runLedger.transition(runId, 'running', 'CEOClaw evidence collection started');
      const evidenceArtifact = await this.orchestration.artifactStore.writeJSON('summary', {
        schemaVersion: 'pyrfor.ceoclaw_business_brief.v1',
        stage: 'approval_requested',
        runId,
        projectId,
        decision: answers['decision'] ?? preview.intent.title,
        evidenceRefs,
        deadline: answers['deadline'],
        checks: {
          evidenceTraceable: evidenceRefs.length > 0,
          financeImpactReviewed: true,
          approvalRequired: true,
        },
      }, {
        runId,
        meta: {
          productFactory: true,
          domainId: 'ceoclaw',
          templateId: preview.template.id,
          intentId: preview.intent.id,
          projectId,
          stage: 'approval_requested',
        },
      });
      await this.orchestration.runLedger.recordArtifact(runId, evidenceArtifact.id, [evidenceArtifact.uri]);
      await this.completeProductFactoryDagNodes(runId, [
        'ceoclaw.collect_evidence',
        'ceoclaw.verify_evidence',
        'ceoclaw.finance_impact_check',
      ], evidenceArtifact);
      const approval = await this.enqueueCeoclawBusinessBriefApproval({
        runId,
        projectId,
        decision: answers['decision'] ?? preview.intent.title,
        evidenceRefs,
        evidenceArtifactId: evidenceArtifact.id,
        deadline: answers['deadline'],
      });
      await this.orchestration.eventLedger.append({
        type: 'approval.requested',
        run_id: runId,
        tool: 'ceoclaw_business_brief_approval',
        approval_id: approval.id,
        artifact_id: evidenceArtifact.id,
        reason: `approval required for CEOClaw brief ${evidenceArtifact.id}`,
      });
      const blocked = await this.orchestration.runLedger.blockRun(runId, `awaiting CEOClaw approval ${approval.id}`);
      const resolvedApproval = approvalFlow.getResolvedApproval(approval.id);
      if (resolvedApproval && resolvedApproval.decision !== 'approve') {
        await this.cancelDeniedCeoclawApproval({
          type: 'approval-resolved',
          request: resolvedApproval.request,
          decision: resolvedApproval.decision,
        });
        throw new Error(`ProductFactory: CEOClaw approval ${approval.id} is ${resolvedApproval.decision}`);
      }
      return {
        run: blocked,
        deliveryArtifact: evidenceArtifact,
        approval,
        summary: `CEOClaw evidence package is ready and awaiting approval ${approval.id}.`,
      };
    }

    if (runRecord.status !== 'blocked') {
      throw new Error(`ProductFactory: CEOClaw run ${runId} must be blocked awaiting approval before final report`);
    }
    const approval = approvalFlow.getResolvedApproval(approvalId);
    if (!approval) {
      throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is pending`);
    }
    if (approval.request.toolName !== 'ceoclaw_business_brief_approval' || approval.request.args['runId'] !== runId) {
      throw new Error('ProductFactory: approval does not match this CEOClaw run');
    }
    if (approval.decision !== 'approve') {
      await this.cancelDeniedCeoclawApproval({
        type: 'approval-resolved',
        request: approval.request,
        decision: approval.decision,
      });
      throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is ${approval.decision}`);
    }
    if (!approvalFlow.consumeResolvedApproval(approvalId)) {
      throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is no longer available`);
    }

    await this.orchestration.runLedger.transition(runId, 'running', `CEOClaw approval ${approvalId} granted`);
    const report = {
      schemaVersion: 'pyrfor.ceoclaw_business_brief.v1',
      stage: 'approved_report',
      runId,
      projectId,
      decision: answers['decision'] ?? preview.intent.title,
      evidenceRefs,
      deadline: answers['deadline'],
      approvalId,
      executiveSummary: `Approved CEOClaw action for ${projectId}: ${answers['decision'] ?? preview.intent.title}`,
      risks: evidenceRefs.length > 0 ? [] : ['No explicit evidence references were provided.'],
      nextActions: ['Record decision in Pyrfor ledger', 'Use approved evidence package for delegated follow-up work'],
    };
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', report, {
      runId,
      meta: {
        productFactory: true,
        domainId: 'ceoclaw',
        templateId: preview.template.id,
        intentId: preview.intent.id,
        projectId,
        stage: 'approved_report',
        approvalId,
      },
    });
    await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    await this.orchestration.eventLedger.append({
      type: 'approval.granted',
      run_id: runId,
      tool: 'ceoclaw_business_brief_approval',
      approval_id: approvalId,
      approved_by: approvalId,
    });
    await this.completeProductFactoryDagNodes(runId, [
      'ceoclaw.request_approval',
      'ceoclaw.generate_report',
    ], artifact);
    await this.orchestration.eventLedger.append({
      type: 'test.completed',
      run_id: runId,
      status: 'ceoclaw.business_brief_mvp:passed',
      ms: 0,
    });
    await this.completeUserRun({ runId, taskId: runRecord.task_id }, 'completed', `CEOClaw business brief approved via ${approvalId}`);
    return {
      run: this.orchestration.runLedger.getRun(runId)!,
      deliveryArtifact: artifact,
      summary: report.executiveSummary,
    };
  }

  private withProductFactoryDefaultWorker(
    worker: RuntimeWorkerOptions | undefined,
    preview: ProductFactoryPlanPreview,
  ): RuntimeWorkerOptions {
    if (worker?.events) {
      return {
        ...worker,
        domainIds: worker.domainIds ?? preview.intent.domainIds,
      };
    }
    return {
      transport: worker?.transport ?? 'acp',
      domainIds: worker?.domainIds ?? preview.intent.domainIds,
      permissionProfile: worker?.permissionProfile,
      permissionOverrides: worker?.permissionOverrides,
      verifierValidators: worker?.verifierValidators,
      events: ({ runId, taskId, sessionId, workerRunId }) => (async function* () {
        yield {
          sessionId,
          type: 'worker_frame' as const,
          ts: Date.now(),
          data: {
            protocol_version: WORKER_PROTOCOL_VERSION,
            type: 'plan_fragment',
            frame_id: `pf-plan-${runId}`,
            task_id: taskId,
            run_id: runId,
            worker_run_id: workerRunId,
            seq: 0,
            content: preview.scopedPlan.objective,
            steps: preview.dagPreview.nodes.map((node) => node.kind),
          },
        };
        yield {
          sessionId,
          type: 'worker_frame' as const,
          ts: Date.now(),
          data: {
            protocol_version: WORKER_PROTOCOL_VERSION,
            type: 'final_report',
            frame_id: `pf-final-${runId}`,
            task_id: taskId,
            run_id: runId,
            worker_run_id: workerRunId,
            seq: 1,
            status: 'succeeded',
            summary: `Product Factory executed ${preview.template.title}: ${preview.intent.title}`,
          },
        };
      })(),
    };
  }

  private productFactoryExecutionPrompt(preview: ProductFactoryPlanPreview): string {
    return [
      preview.intent.goal,
      '',
      'Scoped plan:',
      ...preview.scopedPlan.scope.map((line) => `- ${line}`),
      '',
      'Quality gates:',
      ...preview.scopedPlan.qualityGates.map((gate) => `- ${gate}`),
    ].join('\n').trim();
  }

  private async completeProductFactoryDagNodes(
    runId: string,
    kinds: string[],
    artifact?: ArtifactRef,
  ): Promise<void> {
    if (!this.orchestration) return;
    const kindSet = new Set(kinds);
    const nodes = this.orchestration.dag.listNodes()
      .filter((node) => node.id.startsWith(`${runId}/`) && kindSet.has(node.kind))
      .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
    const provenance = artifact
      ? [{ kind: 'artifact' as const, ref: artifact.id, role: 'evidence' as const, sha256: artifact.sha256 }]
      : [];
    for (const node of nodes) {
      const current = this.orchestration.dag.getNode(node.id);
      if (!current || current.status === 'succeeded') continue;
      if (current.status === 'pending' || current.status === 'ready') {
        this.orchestration.dag.leaseNode(node.id, 'product-factory-executor', 60_000);
      }
      const leased = this.orchestration.dag.getNode(node.id);
      if (leased?.status === 'leased') {
        this.orchestration.dag.startNode(node.id, 'product-factory-executor');
      }
      const running = this.orchestration.dag.getNode(node.id);
      if (running?.status === 'leased' || running?.status === 'running') {
        this.orchestration.dag.completeNode(node.id, provenance);
      }
    }
  }

  private async completeDeliveryEvidenceDagNode(
    runId: string,
    artifact: ArtifactRef,
    snapshot: DeliveryEvidenceSnapshot,
  ): Promise<void> {
    const deliveryNodes = this.orchestration?.dag.listNodes()
      .filter((node) => node.id.startsWith(`${runId}/`) && node.kind === 'product_factory.delivery_package') ?? [];
    const completedDeliveryNodeIds = deliveryNodes
      .filter((node) => node.status === 'succeeded')
      .map((node) => node.id);
    const waiverNodeId = snapshot.verifier?.status === 'waived' && snapshot.verifier.waiverArtifactId
      ? `run:${runId}:verifier-waiver:${snapshot.verifier.waiverArtifactId}`
      : undefined;
    const waiverNode = waiverNodeId ? this.orchestration?.dag.getNode(waiverNodeId) : undefined;
    const dependsOn = completedDeliveryNodeIds.length > 0
      ? completedDeliveryNodeIds
      : waiverNode?.status === 'succeeded'
        ? [waiverNodeId!]
        : deliveryNodes.map((node) => node.id);
    const evidenceNodeId = snapshot.verifier?.status === 'waived'
      && this.orchestration?.dag.getNode(`run:${runId}:github-delivery-evidence`)?.status === 'succeeded'
      ? `run:${runId}:github-delivery-evidence:${artifact.id}`
      : `run:${runId}:github-delivery-evidence`;
    await this.completeDagNodeOnce(evidenceNodeId, {
      kind: 'product_factory.github_delivery_evidence',
      payload: {
        provider: 'github',
        repository: snapshot.github.repository,
        branch: snapshot.git.branch,
        commitSha: snapshot.git.headSha,
        available: snapshot.github.available,
      },
      dependsOn,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private async completeVerifierWaiverDagNode(
    runId: string,
    artifact: ArtifactRef,
    waiver: VerifierWaiverRecord,
  ): Promise<void> {
    const verifierNodeIds = this.orchestration?.dag.listNodes()
      .filter((node) =>
        node.kind === 'governed.verifier'
        && node.id.startsWith(`run:${runId}:`)
        && (!waiver.verifierRunId || node.payload['verifierRunId'] === waiver.verifierRunId)
      )
      .map((node) => node.id) ?? [];
    await this.completeDagNodeOnce(`run:${runId}:verifier-waiver:${artifact.id}`, {
      kind: 'governed.verifier_waiver',
      payload: {
        rawStatus: waiver.rawStatus,
        scope: waiver.scope,
        operatorId: waiver.operator.id,
        ...(waiver.verifierRunId ? { verifierRunId: waiver.verifierRunId } : {}),
        ...(waiver.verifierArtifactId ? { verifierArtifactId: waiver.verifierArtifactId } : {}),
        ...(waiver.verifierEventId ? { verifierEventId: waiver.verifierEventId } : {}),
      },
      dependsOn: verifierNodeIds,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        ...(waiver.verifierArtifactId ? [{ kind: 'artifact' as const, ref: waiver.verifierArtifactId, role: 'evidence' as const }] : []),
        ...(waiver.verifierEventId ? [{ kind: 'ledger_event' as const, ref: waiver.verifierEventId, role: 'decision' as const }] : []),
        { kind: 'artifact', ref: artifact.id, role: 'decision', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private async completeGithubDeliveryPlanDagNode(
    runId: string,
    artifact: ArtifactRef,
    plan: GitHubDeliveryPlan,
    evidenceArtifact: ArtifactRef,
  ): Promise<void> {
    const evidenceNodeIds = this.orchestration?.dag.listNodes()
      .filter((node) => node.id.startsWith(`run:${runId}:github-delivery-evidence`) && node.kind === 'product_factory.github_delivery_evidence')
      .map((node) => node.id) ?? [];
    await this.completeDagNodeOnce(`run:${runId}:github-delivery-plan`, {
      kind: 'product_factory.github_delivery_plan',
      payload: {
        provider: 'github',
        mode: plan.mode,
        applySupported: plan.applySupported,
        repository: plan.repository,
        proposedBranch: plan.proposedBranch,
        blockers: plan.blockers,
      },
      dependsOn: evidenceNodeIds,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: evidenceArtifact.id, role: 'input', sha256: evidenceArtifact.sha256 },
        { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private async completeGithubDeliveryApplyDagNode(
    runId: string,
    artifact: ArtifactRef,
    result: GitHubDeliveryApplyResult,
    planArtifact: ArtifactRef,
  ): Promise<void> {
    const planNodeIds = this.orchestration?.dag.listNodes()
      .filter((node) => node.id.startsWith(`run:${runId}:github-delivery-plan`) && node.kind === 'product_factory.github_delivery_plan')
      .map((node) => node.id) ?? [];
    await this.completeDagNodeOnce(`run:${runId}:github-delivery-apply`, {
      kind: 'product_factory.github_delivery_apply',
      payload: {
        provider: 'github',
        mode: result.mode,
        repository: result.repository,
        branch: result.branch,
        pullRequestNumber: result.draftPullRequest.number,
        pullRequestUrl: result.draftPullRequest.url,
      },
      dependsOn: planNodeIds,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: planArtifact.id, role: 'input', sha256: planArtifact.sha256 },
        { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private resolveGithubToken(): string | undefined {
    return process.env['PYRFOR_GITHUB_TOKEN'] || process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'] || undefined;
  }

  private seedProductFactoryDag(runId: string, preview: ProductFactoryPlanPreview, artifact: ArtifactRef): void {
    if (!this.orchestration) return;
    if (preview.template.id === 'ochag_family_reminder') {
      const answers = this.extractProductFactoryAnswers(preview);
      const familyPayload = {
        productFactory: true,
        runId,
        artifactId: artifact.id,
        intentId: preview.intent.id,
        title: preview.intent.title,
        familyId: answers['familyId'] ?? 'default-family',
        audience: answers['audience'],
        memberIds: answers['memberIds']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
        visibility: answers['visibility'] ?? 'family',
        dueAt: answers['dueAt'],
        escalationPolicy: answers['escalationPolicy'] ?? 'adult',
        reminderChannel: 'telegram',
      };
      const overlayNodes = this.orchestration.overlays.instantiateWorkflow('ochag', 'family-reminder', {
        idPrefix: `product_factory/${preview.intent.id}/ochag/family-reminder`,
        payload: familyPayload,
        provenance: [
          { kind: 'run', ref: runId, role: 'input' },
          { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
        ],
      });
      for (const node of overlayNodes) {
        this.orchestration.dag.addNode({
          ...node,
          id: `${runId}/${node.id}`,
          idempotencyKey: `${runId}:${node.id}`,
          dependsOn: (node.dependsOn ?? []).map((dep) => `${runId}/${dep}`),
          payload: {
            ...(node.payload ?? {}),
            runId,
            artifactId: artifact.id,
          },
        });
      }
      return;
    }
    if (preview.template.id === 'business_brief') {
      const answers = this.extractProductFactoryAnswers(preview);
      const businessPayload = {
        productFactory: true,
        runId,
        artifactId: artifact.id,
        intentId: preview.intent.id,
        title: preview.intent.title,
        projectId: answers['projectId'] ?? 'default-project',
        actionType: 'approval',
        decision: answers['decision'],
        evidenceRefs: answers['evidence']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
        deadline: answers['deadline'],
      };
      const overlayNodes = this.orchestration.overlays.instantiateWorkflow('ceoclaw', 'evidence-approval', {
        idPrefix: `product_factory/${preview.intent.id}/ceoclaw/evidence-approval`,
        payload: businessPayload,
        provenance: [
          { kind: 'run', ref: runId, role: 'input' },
          { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
        ],
      });
      for (const node of overlayNodes) {
        this.orchestration.dag.addNode({
          ...node,
          id: `${runId}/${node.id}`,
          idempotencyKey: `${runId}:${node.id}`,
          dependsOn: (node.dependsOn ?? []).map((dep) => `${runId}/${dep}`),
          payload: {
            ...(node.payload ?? {}),
            runId,
            artifactId: artifact.id,
          },
        });
      }
      return;
    }

    const idMap = new Map<string, string>();
    for (const node of preview.dagPreview.nodes) {
      if (node.id) idMap.set(node.id, `${runId}/${node.id}`);
    }

    for (const node of preview.dagPreview.nodes) {
      const originalId = node.id ?? randomUUID();
      const persistedId = idMap.get(originalId) ?? `${runId}/${originalId}`;
      this.orchestration.dag.addNode({
        ...node,
        id: persistedId,
        idempotencyKey: `${runId}:${originalId}`,
        dependsOn: (node.dependsOn ?? []).map((dep) => idMap.get(dep) ?? `${runId}/${dep}`),
        payload: {
          ...(node.payload ?? {}),
          runId,
          artifactId: artifact.id,
        },
        provenance: [
          ...(node.provenance ?? []),
          { kind: 'run', ref: runId, role: 'input' },
          { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
        ],
      });
    }
  }

  private extractProductFactoryAnswers(preview: ProductFactoryPlanPreview): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const scopeLine of preview.scopedPlan.scope) {
      for (const clarification of preview.template.clarifications) {
        if (scopeLine.startsWith(clarification.question)) {
          answers[clarification.id] = scopeLine.slice(clarification.question.length).trim();
        }
      }
    }
    return answers;
  }

  private async markUserRunRunning(run: ActiveRuntimeRun): Promise<void> {
    await this.orchestration?.runLedger.transition(run.runId, 'running', 'user turn started');
  }

  private async completeUserRun(
    run: ActiveRuntimeRun,
    status: 'completed' | 'failed',
    summary?: string,
  ): Promise<void> {
    const current = this.orchestration?.runLedger.getRun(run.runId);
    if (current?.status === 'completed' || current?.status === 'failed' || current?.status === 'blocked' || current?.status === 'cancelled') {
      return;
    }
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

  private async runLiveWorkerStream(
    run: ActiveRuntimeRun | null,
    sessionId: string,
    userId: string,
    worker?: RuntimeWorkerOptions,
  ): Promise<string | null> {
    if (!worker?.events || !run || !this.orchestration) {
      return null;
    }

    const workerRunId = `worker-run:${run.runId}:${randomUUID()}`;
    run.workerRunId = workerRunId;
    const host = this.createOrchestrationHostForRun(run, sessionId, userId, worker);
    run.orchestrationHost = host;
    run.workerTransport = worker.transport;

    const results: WorkerProtocolBridgeResult[] = [];
    const events = worker.events({ runId: run.runId, taskId: run.taskId, sessionId, workerRunId });

    if (worker.transport === 'acp') {
      for await (const event of events as AsyncIterable<AcpEvent>) {
        const result = await host.codingHost.handleAcpEvent(event);
        if (result) {
          results.push(result);
          this.assertWorkerResultCanContinue(result);
        }
      }
    } else {
      for await (const event of events as AsyncIterable<FCEvent>) {
        this.assertStrictFreeClaudeEvent(event);
        const result = await host.codingHost.handleFreeClaudeEvent(event);
        if (result) {
          results.push(result);
          this.assertWorkerResultCanContinue(result);
        }
      }
    }

    return this.summarizeWorkerResults(run, results);
  }

  private async prepareGovernedRun(
    run: ActiveRuntimeRun,
    input: { sessionId: string; text: string; openFiles: OpenFile[] },
  ): Promise<void> {
    if (!this.orchestration || run.governed) return;

    const compiler = new ContextCompiler({
      artifactStore: this.orchestration.artifactStore,
      eventLedger: this.orchestration.eventLedger,
      runLedger: this.orchestration.runLedger,
      dag: this.orchestration.dag,
    });
    const compiled = await compiler.compile({
      runId: run.runId,
      workspaceId: this.options.workspacePath,
      task: {
        id: run.taskId,
        title: input.text.slice(0, 120) || 'Worker run',
        description: input.text,
      },
      sessionId: input.sessionId,
      historyRunIds: [run.runId],
      filesOfInterest: input.openFiles.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      ledgerEventLimit: 50,
    });
    const contextArtifact = await compiler.persist(compiled, {
      artifactStore: this.orchestration.artifactStore,
      runId: run.runId,
    });
    await this.orchestration.runLedger.recordArtifact(run.runId, contextArtifact.id, [contextArtifact.uri]);

    const contextNodeId = `run:${run.runId}:ctx`;
    await this.completeDagNodeOnce(contextNodeId, {
      kind: 'governed.context_pack',
      payload: {
        artifactId: contextArtifact.id,
        hash: contextArtifact.sha256,
        packId: compiled.pack.packId,
      },
      provenance: [
        { kind: 'run', ref: run.runId, role: 'input' },
        { kind: 'artifact', ref: contextArtifact.id, role: 'output', sha256: contextArtifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: contextArtifact.id, role: 'output', sha256: contextArtifact.sha256 },
    ]);

    run.governed = {
      contextArtifact,
      contextNodeId,
      workerEvents: [],
      frameNodeIds: [],
      effectNodeIds: [],
    };
  }

  private createOrchestrationHostForRun(
    run: ActiveRuntimeRun,
    sessionId: string,
    userId: string,
    worker: RuntimeWorkerOptions,
  ): OrchestrationHost {
    if (!this.orchestration) {
      throw new Error('Runtime orchestration is not initialized');
    }
    return createOrchestrationHost({
      orchestration: this.orchestration,
      workspaceId: this.options.workspacePath,
      sessionId,
      domainIds: worker.domainIds,
      permissionProfile: worker.permissionProfile,
      permissionOverrides: worker.permissionOverrides,
      toolExecutors: this.createWorkerToolExecutors(run, sessionId, userId),
      approvalFlow: {
        requestApproval: (req) => approvalFlow.requestApproval(req),
      },
      toolAudit: (event) => approvalFlow.recordToolOutcome({
        ...event,
        sessionId: event.sessionId ?? sessionId,
      }),
      logger: (level, message, meta) => {
        logger[level](message, typeof meta === 'object' && meta !== null ? meta as Record<string, unknown> : { meta });
      },
      deferTerminalRunCompletion: true,
      expectedRunId: run.runId,
      expectedTaskId: run.taskId,
      expectedWorkerRunId: run.workerRunId,
      enforceFrameOrder: true,
      onFrameResult: async (result, source) => {
        await this.recordGovernedWorkerFrame(run, result, source);
      },
    });
  }

  private async recordGovernedWorkerFrame(
    run: ActiveRuntimeRun,
    result: WorkerProtocolBridgeResult,
    source: 'acp' | 'freeclaude',
  ): Promise<void> {
    if (!this.orchestration || !run.governed || !result.frame) return;

    const frame = result.frame;
    const acpEvent: AcpEvent = {
      sessionId: `${source}:${run.runId}`,
      type: 'worker_frame',
      data: frame,
      ts: Date.now(),
    };
    run.governed.workerEvents.push(acpEvent);

    const frameNodeId = `run:${run.runId}:frame:${frame.frame_id}`;
    await this.completeDagNodeOnce(frameNodeId, {
      kind: `worker.frame.${frame.type}`,
      payload: {
        source,
        disposition: result.disposition,
        ok: result.ok,
        frameType: frame.type,
      },
      dependsOn: [run.governed.contextNodeId],
      provenance: [
        { kind: 'run', ref: run.runId, role: 'input' },
        { kind: 'artifact', ref: run.governed.contextArtifact.id, role: 'input', sha256: run.governed.contextArtifact.sha256 },
        { kind: 'worker_frame', ref: frame.frame_id, role: 'evidence', meta: { type: frame.type, source } },
      ],
    });
    run.governed.frameNodeIds.push(frameNodeId);

    if (result.effect) {
      const effectNodeId = `run:${run.runId}:effect:${result.effect.effect_id}`;
      await this.completeDagNodeOnce(effectNodeId, {
        kind: `worker.effect.${result.effect.kind}`,
        payload: {
          effectId: result.effect.effect_id,
          status: result.effect.status,
          verdict: result.verdict?.decision,
        },
        dependsOn: [frameNodeId],
        provenance: [
          { kind: 'run', ref: run.runId, role: 'input' },
          { kind: 'worker_frame', ref: frame.frame_id, role: 'input', meta: { type: frame.type, source } },
          { kind: 'effect', ref: result.effect.effect_id, role: 'side_effect' },
        ],
      }, [
        { kind: 'effect', ref: result.effect.effect_id, role: 'side_effect' },
      ]);
      run.governed.effectNodeIds.push(effectNodeId);
    }
  }

  private createWorkerToolExecutors(
    run: ActiveRuntimeRun,
    sessionId: string,
    userId: string,
  ): Record<string, ToolExecutor> {
    const ctx = { sessionId, userId, runId: run.runId };
    return {
      shell_exec: async (inv) => {
        const result = await executeRuntimeTool('exec', inv.args, ctx);
        if (!result.success) {
          const err = new Error(result.error ?? 'shell_exec failed') as Error & { code?: string };
          err.code = 'shell_exec_failed';
          throw err;
        }
        return result.data;
      },
      apply_patch: async (inv) => {
        const patch = typeof inv.args.patch === 'string' ? inv.args.patch : '';
        const files = Array.isArray(inv.args.files)
          ? inv.args.files.filter((file): file is string => typeof file === 'string')
          : [];
        if (!patch.trim()) {
          const err = new Error('Patch required') as Error & { code?: string };
          err.code = 'patch_required';
          throw err;
        }
        return this.applyWorkerPatch(patch, files, ctx);
      },
    };
  }

  private async applyWorkerPatch(
    patch: string,
    files: string[],
    ctx: { sessionId: string; userId: string; runId: string },
  ): Promise<{ files: string[]; stdout: string; stderr: string }> {
    const workspaceRoot = this.options.workspacePath;
    for (const file of files) {
      const resolved = path.resolve(workspaceRoot, file);
      if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
        const err = new Error(`Patch path outside workspace: ${file}`) as Error & { code?: string };
        err.code = 'patch_path_outside_workspace';
        throw err;
      }
    }

    const patchFile = path.join(os.tmpdir(), `pyrfor-worker-${ctx.runId}-${randomUUID()}.patch`);
    await fs.writeFile(patchFile, patch, 'utf-8');
    try {
      await execFileAsync('git', ['apply', '--check', patchFile], { cwd: workspaceRoot });
      const { stdout, stderr } = await execFileAsync('git', ['apply', patchFile], { cwd: workspaceRoot });
      return {
        files,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      };
    } finally {
      await fs.rm(patchFile, { force: true });
    }
  }

  private async finalizeGovernedRun(
    run: ActiveRuntimeRun,
    sessionId: string,
    worker?: RuntimeWorkerOptions,
    options: { completeRun?: boolean } = {},
  ): Promise<VerificationStatus | null> {
    if (!this.orchestration || !run.governed) return null;
    if (run.governed.verifierStatus) return run.governed.verifierStatus;

    const verifierNodeId = `run:${run.runId}:verify`;
    const verifier = new VerifierLane({
      ledger: this.orchestration.eventLedger,
      runLedger: this.orchestration.runLedger,
      replayStoreDir: path.join(this.resolveRuntimeDataRoot() ?? os.tmpdir(), 'orchestration', 'replays'),
      dagStorePath: path.join(this.resolveRuntimeDataRoot() ?? os.tmpdir(), 'orchestration', `verifier-${run.runId}.json`),
      workspaceId: this.options.workspacePath,
      repoId: this.options.workspacePath,
      validators: worker?.verifierValidators ?? [],
    });

    const result = await verifier.run({
      parentRunId: run.runId,
      verifierRunId: `${run.runId}:verifier`,
      acpEvents: run.governed.workerEvents,
      cwd: this.options.workspacePath,
      workspaceId: this.options.workspacePath,
      repoId: this.options.workspacePath,
      validators: worker?.verifierValidators,
    });
    run.governed.verifierStatus = result.status;

    await this.orchestration.eventLedger.append({
      type: 'verifier.completed',
      run_id: run.runId,
      subject_id: result.verifierRunId,
      status: result.status,
      action: result.status === 'passed' || result.status === 'warning' ? 'allow' : 'block',
      reason: `verifier ${result.status}`,
      findings: result.steps.reduce((sum, step) => sum + step.results.length, 0),
    });

    const verifierArtifact = await this.orchestration.artifactStore.writeJSON('test_result', {
      parentRunId: result.parentRunId,
      verifierRunId: result.verifierRunId,
      status: result.status,
      replayArtifactRef: result.replayArtifactRef,
      steps: result.steps,
      verifyResult: result.verifyResult,
    }, {
      runId: run.runId,
      meta: {
        verifierRunId: result.verifierRunId,
        status: result.status,
      },
    });
    await this.orchestration.runLedger.recordArtifact(run.runId, verifierArtifact.id, [verifierArtifact.uri]);

    await this.completeDagNodeOnce(verifierNodeId, {
      kind: 'governed.verifier',
      payload: {
        status: result.status,
        verifierRunId: result.verifierRunId,
        replayArtifactRef: result.replayArtifactRef,
      },
      dependsOn: [
        run.governed.contextNodeId,
        ...run.governed.frameNodeIds,
        ...run.governed.effectNodeIds,
      ],
      provenance: [
        { kind: 'run', ref: run.runId, role: 'input' },
        { kind: 'artifact', ref: run.governed.contextArtifact.id, role: 'input', sha256: run.governed.contextArtifact.sha256 },
        { kind: 'artifact', ref: verifierArtifact.id, role: 'evidence', sha256: verifierArtifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: verifierArtifact.id, role: 'evidence', sha256: verifierArtifact.sha256 },
    ]);
    run.governed.verifierNodeId = verifierNodeId;

    if (result.status === 'passed' || result.status === 'warning') {
      if (options.completeRun !== false) {
        await this.completeUserRun(run, 'completed', `worker verified: ${result.status}`);
        run.terminalByWorker = true;
      }
      return result.status;
    }

    if (options.completeRun !== false) {
      await this.orchestration.runLedger.blockRun(run.runId, `verifier ${result.status}`);
      run.terminalByWorker = true;
    }
    logger.warn('[runtime] Governed worker run blocked by verifier', {
      runId: run.runId,
      sessionId,
      status: result.status,
    });
    if (options.completeRun !== false) {
      throw new Error(`Verifier blocked run ${run.runId}: ${result.status}`);
    }
    return result.status;
  }

  private async completeDagNodeOnce(
    nodeId: string,
    input: {
      kind: string;
      payload?: Record<string, unknown>;
      dependsOn?: string[];
      provenance?: Parameters<DurableDag['completeNode']>[1];
    },
    completionProvenance: Parameters<DurableDag['completeNode']>[1] = [],
  ): Promise<void> {
    if (!this.orchestration) return;
    const existing = this.orchestration.dag.getNode(nodeId);
    if (existing?.status === 'succeeded') return;

    this.orchestration.dag.addNode({
      id: nodeId,
      kind: input.kind,
      payload: input.payload,
      dependsOn: input.dependsOn,
      idempotencyKey: nodeId,
      retryClass: 'deterministic',
      provenance: input.provenance,
    });
    const current = this.orchestration.dag.getNode(nodeId);
    const ready = this.orchestration.dag.listReady().some((node) => node.id === nodeId);
    if ((current?.status === 'pending' || current?.status === 'ready') && ready) {
      this.orchestration.dag.leaseNode(nodeId, 'runtime-governor', 60_000);
    }
    const leased = this.orchestration.dag.getNode(nodeId);
    if (leased?.status === 'leased') {
      this.orchestration.dag.startNode(nodeId, 'runtime-governor');
    }
    const running = this.orchestration.dag.getNode(nodeId);
    if (running?.status === 'leased' || running?.status === 'running') {
      this.orchestration.dag.completeNode(nodeId, completionProvenance);
    }
  }

  private summarizeWorkerResults(
    run: ActiveRuntimeRun,
    results: WorkerProtocolBridgeResult[],
  ): string {
    const invalid = results.find((result) => result.disposition === 'invalid_frame');
    if (invalid) {
      const detail = invalid.errors?.map((error) => `${error.path}: ${error.message}`).join('; ') ?? 'invalid worker frame';
      throw new Error(`Worker emitted invalid frame: ${detail}`);
    }

    const denied = results.find((result) => result.disposition === 'effect_denied');
    if (denied) {
      throw new Error(denied.verdict?.reason ?? 'Worker run blocked by policy');
    }

    const terminal = [...results].reverse().find((result) =>
      result.disposition === 'run_completed' || result.disposition === 'run_failed'
    );
    if (terminal?.disposition === 'run_completed') {
      run.terminalByWorker = true;
      const frame = terminal.frame;
      return frame && 'summary' in frame ? String(frame.summary) : 'Worker run completed';
    }
    if (terminal?.disposition === 'run_failed') {
      run.terminalByWorker = true;
      const frame = terminal.frame;
      const message = frame && 'error' in frame ? frame.error.message : 'Worker run failed';
      throw new Error(message);
    }

    const invoked = results.filter((result) => result.disposition === 'tool_invoked').length;
    return invoked > 0
      ? `Worker processed ${invoked} approved effect${invoked === 1 ? '' : 's'}.`
      : 'Worker stream processed.';
  }

  private assertWorkerResultCanContinue(result: WorkerProtocolBridgeResult): void {
    if (result.disposition === 'invalid_frame') {
      const detail = result.errors?.map((error) => `${error.path}: ${error.message}`).join('; ') ?? 'invalid worker frame';
      throw new Error(`Worker emitted invalid frame: ${detail}`);
    }
    if (result.disposition === 'effect_denied') {
      throw new Error(result.verdict?.reason ?? 'Worker run blocked by policy');
    }
    if (result.disposition === 'run_failed') {
      const frame = result.frame;
      const message = frame && 'error' in frame ? frame.error.message : 'Worker run failed';
      throw new Error(message);
    }
  }

  private assertStrictFreeClaudeEvent(event: FCEvent): void {
    if (event.type === 'tool_use') {
      throw new Error(`Strict FreeClaude worker emitted native tool_use "${event.name}" outside Worker Protocol`);
    }
    if (event.type === 'result') {
      const result = event.result as { filesTouched?: unknown; commandsRun?: unknown };
      const filesTouched = Array.isArray(result.filesTouched) ? result.filesTouched.filter((item) => typeof item === 'string') : [];
      const commandsRun = Array.isArray(result.commandsRun) ? result.commandsRun.filter((item) => typeof item === 'string') : [];
      if (filesTouched.length > 0 || commandsRun.length > 0) {
        throw new Error('Strict FreeClaude worker reported native mutations outside Worker Protocol');
      }
    }
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

    const dag = new DurableDag({
      storePath: path.join(orchestrationDir, 'dag.json'),
      ledger: eventLedger,
      dagId: 'runtime-orchestration',
      ledgerRunId: 'runtime-orchestration',
    });
    const recoveredRuns = await runLedger.recoverInterruptedRuns('runtime_restarted');
    const recoveredNodes = dag.recoverInterruptedLeases('runtime_restarted');
    await dag.flushLedger();
    const artifactStore = new ArtifactStore({ rootDir: path.join(rootDir, 'artifacts') });
    await artifactStore.repairIndex();

    this.orchestration = {
      eventLedger,
      runLedger,
      dag,
      artifactStore,
      overlays: registerDefaultDomainOverlays(new DomainOverlayRegistry()),
    };
    this.ensureApprovalFlowSubscription();
    const recoveredGithubApprovals = await this.recoverGithubDeliveryApplyApprovals();
    const recoveredCeoclawApprovals = await this.recoverCeoclawBusinessBriefApprovals();

    logger.info('[runtime] Orchestration initialized', {
      rootDir,
      runs: this.orchestration.runLedger.listRuns().length,
      dagNodes: this.orchestration.dag.listNodes().length,
      recoveredRuns: recoveredRuns.length,
      recoveredDagNodes: recoveredNodes.length,
      recoveredApprovals: recoveredGithubApprovals + recoveredCeoclawApprovals,
      recoveredGithubApprovals,
      recoveredCeoclawApprovals,
      overlays: this.orchestration.overlays.list().map((overlay) => overlay.domainId),
    });
  }

  private ensureApprovalFlowSubscription(): void {
    if (this.approvalFlowUnsubscribe) return;
    this.approvalFlowUnsubscribe = approvalFlow.subscribe((event) => {
      if (event.type !== 'approval-resolved') return;
      if (event.request.toolName !== 'ceoclaw_business_brief_approval') return;
      if (event.decision === 'approve') return;
      void this.cancelDeniedCeoclawApproval(event).catch((err) => {
        logger.warn('[runtime] Failed to cancel denied CEOClaw approval run', {
          approvalId: event.request.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  private async cancelDeniedCeoclawApproval(event: Extract<ApprovalFlowEvent, { type: 'approval-resolved' }>): Promise<void> {
    const approvalId = event.request.id;
    if (this.ceoclawDenialApprovalsInFlight.has(approvalId)) return;
    this.ceoclawDenialApprovalsInFlight.add(approvalId);
    try {
      if (!this.orchestration) return;
      const runId = typeof event.request.run_id === 'string'
        ? event.request.run_id
        : typeof event.request.args['runId'] === 'string'
          ? event.request.args['runId']
          : undefined;
      if (!runId) return;
      const run = this.orchestration.runLedger.getRun(runId);
      if (!run) return;
      if (run.status !== 'blocked') {
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'archived') {
          approvalFlow.consumeResolvedApproval(approvalId);
        }
        return;
      }
      await this.orchestration.eventLedger.append({
        type: 'approval.denied',
        run_id: runId,
        tool: 'ceoclaw_business_brief_approval',
        approval_id: approvalId,
        reason: `approval ${approvalId} was ${event.decision}`,
      });
      await this.orchestration.runLedger.completeRun(
        runId,
        'cancelled',
        `CEOClaw approval ${approvalId} was ${event.decision}`,
      );
      approvalFlow.consumeResolvedApproval(approvalId);
    } finally {
      this.ceoclawDenialApprovalsInFlight.delete(approvalId);
    }
  }

  private getGithubDeliveryApplyApproval(
    runId: string,
    planArtifactId: string,
    expectedPlanSha256: string,
  ): ApprovalRequest | undefined {
    const expectedId = buildGithubDeliveryApplyApprovalId(runId, planArtifactId, expectedPlanSha256);
    const pending = approvalFlow.getPending().find((request) =>
      request.id === expectedId
      || (
        request.toolName === 'github_delivery_apply'
        && request.args['runId'] === runId
        && request.args['planArtifactId'] === planArtifactId
        && request.args['expectedPlanSha256'] === expectedPlanSha256
      )
    );
    if (pending) return pending;
    return approvalFlow.getResolvedApproval(expectedId)?.request;
  }

  private async enqueueGithubDeliveryApplyApproval(input: {
    runId: string;
    plan: GitHubDeliveryPlan;
    planArtifact: ArtifactRef;
    expectedPlanSha256: string;
  }): Promise<ApprovalRequest> {
    const existing = this.getGithubDeliveryApplyApproval(input.runId, input.planArtifact.id, input.expectedPlanSha256);
    if (existing) return existing;
    return approvalFlow.enqueueApproval({
      id: buildGithubDeliveryApplyApprovalId(input.runId, input.planArtifact.id, input.expectedPlanSha256),
      toolName: 'github_delivery_apply',
      summary: `Create draft GitHub PR for ${input.plan.repository}:${input.plan.proposedBranch}`,
      args: {
        runId: input.runId,
        planArtifactId: input.planArtifact.id,
        expectedPlanSha256: input.expectedPlanSha256,
        repository: input.plan.repository,
        baseBranch: input.plan.baseBranch,
        proposedBranch: input.plan.proposedBranch,
        headSha: input.plan.headSha,
        idempotencyKey: buildApplyIdempotencyKey(input.runId, input.planArtifact, input.plan),
      },
      run_id: input.runId,
      reason: 'GitHub delivery apply requires operator approval before creating a draft PR',
      approval_required: true,
    });
  }

  private async recoverGithubDeliveryApplyApprovals(): Promise<number> {
    if (!this.orchestration) return 0;
    let recovered = 0;
    for (const run of this.orchestration.runLedger.listRuns()) {
      const events = await this.orchestration.eventLedger.byRun(run.run_id);
      const requested = [...events].reverse().find((event): event is ApprovalRequestedEvent & { artifact_id: string } =>
        event.type === 'approval.requested'
        && event.tool === 'github_delivery_apply'
        && typeof event.artifact_id === 'string'
      );
      if (!requested) continue;
      const laterResolution = events.some((event) =>
        event.seq > requested.seq
        && (event.type === 'approval.granted' || event.type === 'approval.denied')
        && event.tool === 'github_delivery_apply'
        && event.approval_id === requested.approval_id
      );
      if (laterResolution) continue;
      if (await this.hasGithubDeliveryApplyResult(run.run_id, requested.artifact_id, requested.approval_id)) {
        continue;
      }
      let planArtifact: ArtifactRef;
      let plan: GitHubDeliveryPlan;
      try {
        const planArtifacts = await this.orchestration.artifactStore.list({ runId: run.run_id, kind: 'delivery_plan' });
        const matchedArtifact = planArtifacts.find((artifact) => artifact.id === requested.artifact_id);
        if (!matchedArtifact) continue;
        planArtifact = matchedArtifact;
        if (planArtifact.kind !== 'delivery_plan' || !planArtifact.sha256) continue;
        plan = await this.orchestration.artifactStore.readJSON<GitHubDeliveryPlan>(planArtifact);
      } catch (err) {
        logger.warn('[runtime] Failed to recover GitHub delivery approval request', {
          runId: run.run_id,
          artifactId: requested.artifact_id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (plan.runId !== run.run_id) continue;
      if (this.getGithubDeliveryApplyApproval(run.run_id, planArtifact.id, planArtifact.sha256)) continue;
      await this.enqueueGithubDeliveryApplyApproval({
        runId: run.run_id,
        plan,
        planArtifact,
        expectedPlanSha256: planArtifact.sha256,
      });
      recovered += 1;
    }
    return recovered;
  }

  private async hasGithubDeliveryApplyResult(
    runId: string,
    planArtifactId: string,
    approvalId?: string,
  ): Promise<boolean> {
    if (!this.orchestration) return false;
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_apply' });
    for (const artifact of artifacts) {
      if (artifact.meta?.['planArtifactId'] === planArtifactId) {
        return approvalId === undefined || artifact.meta?.['approvalId'] === approvalId;
      }
      try {
        const result = await this.orchestration.artifactStore.readJSON<GitHubDeliveryApplyResult>(artifact);
        if (
          result.planArtifactId === planArtifactId
          && (approvalId === undefined || result.approvalId === approvalId)
        ) {
          return true;
        }
      } catch (err) {
        logger.warn('[runtime] Failed to inspect GitHub delivery apply artifact during recovery', {
          runId,
          artifactId: artifact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return false;
  }

  private getCeoclawBusinessBriefApproval(runId: string): ApprovalRequest | undefined {
    const expectedId = buildCeoclawBusinessBriefApprovalId(runId);
    const pending = approvalFlow.getPending().find((request) =>
      request.id === expectedId
      || (
        request.toolName === 'ceoclaw_business_brief_approval'
        && request.args['runId'] === runId
      )
    );
    if (pending) return pending;
    return approvalFlow.getResolvedApproval(expectedId)?.request;
  }

  private async enqueueCeoclawBusinessBriefApproval(input: {
    runId: string;
    projectId: string;
    decision: string;
    evidenceRefs: string[];
    evidenceArtifactId?: string;
    deadline?: string;
  }): Promise<ApprovalRequest> {
    const existing = this.getCeoclawBusinessBriefApproval(input.runId);
    if (existing) return existing;
    return approvalFlow.enqueueApproval({
      id: buildCeoclawBusinessBriefApprovalId(input.runId),
      toolName: 'ceoclaw_business_brief_approval',
      summary: `Approve CEOClaw brief for ${input.projectId}: ${input.decision}`,
      args: {
        runId: input.runId,
        projectId: input.projectId,
        decision: input.decision,
        evidenceRefs: input.evidenceRefs,
        ...(input.evidenceArtifactId ? { evidenceArtifactId: input.evidenceArtifactId } : {}),
        ...(input.deadline ? { deadline: input.deadline } : {}),
      },
      run_id: input.runId,
      reason: 'CEOClaw business brief requires operator approval before final report',
      approval_required: true,
    });
  }

  private async recoverCeoclawBusinessBriefApprovals(): Promise<number> {
    if (!this.orchestration) return 0;
    let recovered = 0;
    for (const run of this.orchestration.runLedger.listRuns()) {
      if (run.status !== 'blocked') continue;
      const events = await this.orchestration.eventLedger.byRun(run.run_id);
      const requested = [...events].reverse().find((event): event is ApprovalRequestedEvent =>
        event.type === 'approval.requested'
        && event.tool === 'ceoclaw_business_brief_approval'
      );
      if (!requested) continue;
      const laterResolution = events.some((event) =>
        event.seq > requested.seq
        && (event.type === 'approval.granted' || event.type === 'approval.denied')
        && event.tool === 'ceoclaw_business_brief_approval'
      );
      if (laterResolution || this.getCeoclawBusinessBriefApproval(run.run_id)) continue;
      let preview: ProductFactoryPlanPreview;
      try {
        preview = await this.loadProductFactoryPreview(run.run_id);
      } catch (err) {
        logger.warn('[runtime] Failed to recover CEOClaw approval request', {
          runId: run.run_id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (preview.template.id !== 'business_brief') continue;
      const answers = this.extractProductFactoryAnswers(preview);
      const evidenceRefs = answers['evidence']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
      await this.enqueueCeoclawBusinessBriefApproval({
        runId: run.run_id,
        projectId: answers['projectId'] ?? 'default-project',
        decision: answers['decision'] ?? preview.intent.title,
        evidenceRefs,
        evidenceArtifactId: requested.artifact_id,
        deadline: answers['deadline'],
      });
      recovered += 1;
    }
    return recovered;
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
export * from './github-delivery-evidence';
export * from './github-delivery-plan';
export * from './github-delivery-apply';
export * from './orchestration-host-factory';
export * from './tools';
export * from './pyrfor-scoring';
