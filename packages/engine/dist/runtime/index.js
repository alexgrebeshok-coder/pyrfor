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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { SessionManager } from './session.js';
import { SessionStore, reviveSession } from './session-store.js';
import { ProviderRouter } from './provider-router.js';
import { AutoCompact } from './compact.js';
import { SubagentSpawner } from './subagents.js';
import { PrivacyManager } from './privacy.js';
import { WorkspaceLoader } from './workspace-loader.js';
import { executeRuntimeTool, setTelegramBot, setWorkspaceRoot, runtimeToolDefinitions } from './tools.js';
import { runToolLoop } from './tool-loop.js';
import { approvalFlow } from './approval-flow.js';
import { handleMessageStream, buildContextBlock } from './streaming.js';
import { loadProjectRules, composeSystemPrompt } from './project-rules.js';
import { logger } from '../observability/logger.js';
import { DEFAULT_CONFIG_PATH, loadConfig, watchConfig, RuntimeConfigSchema } from './config.js';
import { HealthMonitor } from './health.js';
import { CronService } from './cron.js';
import { getDefaultHandlers } from './cron/handlers.js';
import { createRuntimeGateway } from './gateway.js';
import { tryLoadPrismaClient, createNoopPrismaClient, installPrismaClient } from './prisma-adapter.js';
import { processManager } from './process-manager.js';
import { registerDynamicSkills, setSkillAIProvider } from '../skills/index.js';
import { ArtifactStore } from './artifact-model.js';
import { DomainOverlayRegistry } from './domain-overlay.js';
import { registerDefaultDomainOverlays } from './domain-overlay-presets.js';
import { DurableDag } from './durable-dag.js';
import { EventLedger } from './event-ledger.js';
import { RunLedger } from './run-ledger.js';
import { ContextCompiler } from './context-compiler.js';
import { VerifierLane } from './verifier-lane.js';
import { createOrchestrationHost, } from './orchestration-host-factory.js';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol.js';
import { createDefaultProductFactory, } from './product-factory.js';
import { captureDeliveryEvidence, } from './github-delivery-evidence.js';
import { buildGithubDeliveryPlan, } from './github-delivery-plan.js';
const execFileAsync = promisify(execFile);
// ============================================
// Main Runtime Class
// ============================================
export class PyrforRuntime {
    constructor(options = {}) {
        var _a, _b, _c, _d, _e, _f;
        this.workspace = null;
        this.store = null;
        this.health = null;
        this.cron = null;
        this.gateway = null;
        this.orchestration = null;
        this.productFactory = createDefaultProductFactory();
        this.configPath = null;
        this._configWatchDispose = null;
        this.started = false;
        this.telegramBot = null;
        this.options = {
            workspacePath: options.workspacePath || process.cwd(),
            memoryPath: options.memoryPath || undefined,
            systemPrompt: options.systemPrompt || this.getDefaultSystemPrompt(),
            enableCompact: (_a = options.enableCompact) !== null && _a !== void 0 ? _a : true,
            enableSubagents: (_b = options.enableSubagents) !== null && _b !== void 0 ? _b : true,
            maxSubagents: (_c = options.maxSubagents) !== null && _c !== void 0 ? _c : 5,
            privacy: options.privacy || {},
            providerOptions: options.providerOptions || {},
            persistence: (_d = options.persistence) !== null && _d !== void 0 ? _d : {},
        };
        // Config: use provided config or defaults; will be (re)loaded from file in start() if configPath given
        this.configPath = (_e = options.configPath) !== null && _e !== void 0 ? _e : null;
        this.config = (_f = options.config) !== null && _f !== void 0 ? _f : RuntimeConfigSchema.parse({});
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
            this.subagents.setExecutor((task) => __awaiter(this, void 0, void 0, function* () {
                return this.executeSubagentTask(task.task, task.context.systemPrompt);
            }));
        }
        // Register telegram bot setter globally
        setTelegramBot(null);
        logger.info('PyrforRuntime initialized');
    }
    applyRuntimeConfig() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const configuredWorkspace = (_a = this.config.workspacePath) !== null && _a !== void 0 ? _a : this.config.workspaceRoot;
        if (configuredWorkspace) {
            this.options.workspacePath = configuredWorkspace;
        }
        if (this.config.memoryPath) {
            this.options.memoryPath = this.config.memoryPath;
        }
        this.providers.setProviderOptions({
            defaultProvider: (_b = this.config.providers) === null || _b === void 0 ? void 0 : _b.defaultProvider,
            enableFallback: (_c = this.config.providers) === null || _c === void 0 ? void 0 : _c.enableFallback,
        });
        if ((_d = this.config.ai) === null || _d === void 0 ? void 0 : _d.activeModel) {
            this.providers.setActiveModel(this.config.ai.activeModel.provider, this.config.ai.activeModel.modelId);
        }
        this.providers.setLocalMode({
            localFirst: (_f = (_e = this.config.ai) === null || _e === void 0 ? void 0 : _e.localFirst) !== null && _f !== void 0 ? _f : false,
            localOnly: (_h = (_g = this.config.ai) === null || _g === void 0 ? void 0 : _g.localOnly) !== null && _h !== void 0 ? _h : false,
        });
    }
    setWorkspacePath(workspacePath) {
        this.options.workspacePath = workspacePath;
        this.config.workspacePath = workspacePath;
        this.config.workspaceRoot = workspacePath;
        setWorkspaceRoot(workspacePath);
    }
    getWorkspacePath() {
        return this.options.workspacePath;
    }
    /**
     * Start all services
     */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            if (this.started) {
                logger.warn('Runtime already started');
                return;
            }
            // Load config from file if configPath is set
            if (this.configPath) {
                try {
                    const { config } = yield loadConfig(this.configPath);
                    this.config = config;
                    this.applyRuntimeConfig();
                    logger.info('[runtime] Config loaded', { path: this.configPath });
                }
                catch (err) {
                    logger.warn('[runtime] Config load failed, using defaults', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            else {
                this.applyRuntimeConfig();
            }
            // Load workspace
            const workspaceOptions = {
                workspacePath: this.options.workspacePath,
                memoryPath: this.options.memoryPath,
            };
            this.workspace = new WorkspaceLoader(workspaceOptions);
            yield this.workspace.load();
            // Register SKILL.md files discovered by the workspace loader
            setSkillAIProvider((messages) => this.providers.chat(messages));
            const dynamicSkillCount = registerDynamicSkills((_c = (_b = (_a = this.workspace.getWorkspace()) === null || _a === void 0 ? void 0 : _a.files) === null || _b === void 0 ? void 0 : _b.skills) !== null && _c !== void 0 ? _c : []);
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
                    yield this.store.init();
                    const persisted = yield this.store.loadAll();
                    let restored = 0;
                    for (const p of persisted) {
                        try {
                            this.sessions.restore(reviveSession(p));
                            restored++;
                        }
                        catch (err) {
                            logger.warn('Failed to revive persisted session', {
                                id: p.id,
                                error: err instanceof Error ? err.message : String(err),
                            });
                        }
                    }
                    if (restored > 0) {
                        logger.info('Restored persisted sessions', { count: restored });
                    }
                }
                catch (err) {
                    logger.error('Session store init/load failed; continuing without persistence', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            yield this.initOrchestration();
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
            if ((_e = (_d = this.config.persistence) === null || _d === void 0 ? void 0 : _d.prisma) === null || _e === void 0 ? void 0 : _e.enabled) {
                const prismaClient = yield tryLoadPrismaClient();
                if (prismaClient) {
                    installPrismaClient(prismaClient);
                    logger.info('[runtime] Prisma client loaded and installed');
                }
                else {
                    logger.warn('[runtime] prisma enabled in config but @prisma/client not installed — using noop');
                    installPrismaClient(createNoopPrismaClient());
                }
            }
            else {
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
                    this.cron.start(this.config.cron.jobs);
                }
                catch (err) {
                    logger.warn('[runtime] CronService start failed; running without scheduled jobs', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            // ── Gateway ─────────────────────────────────────────────────────────────
            if (this.config.gateway.enabled) {
                yield this.ensureGatewayStarted();
            }
            // ── Config hot-reload ───────────────────────────────────────────────────
            if (this.configPath) {
                this._configWatchDispose = watchConfig(this.configPath, (newConfig) => {
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
                            if (!newNames.has(name))
                                this.cron.removeJob(name);
                        }
                        for (const job of newConfig.cron.jobs) {
                            if (!oldNames.has(job.name)) {
                                try {
                                    this.cron.addJob(job);
                                }
                                catch (err) {
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
                }, {
                    onError: (err) => {
                        logger.warn('[runtime] Config watch error; keeping stale config', {
                            error: err instanceof Error ? err.message : String(err),
                        });
                    },
                });
            }
            this.started = true;
            logger.info('PyrforRuntime started');
        });
    }
    /**
     * Start the HTTP gateway if it is not already running.
     *
     * Used both by start() (when `config.gateway.enabled` is true) and by
     * scenarios that require the gateway regardless of config — e.g., serving
     * Telegram Mini App static files in `--telegram` mode when
     * TELEGRAM_WEBAPP_URL is set. Safe to call multiple times.
     */
    ensureGatewayStarted() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            if (this.gateway)
                return this.gateway;
            const gateway = createRuntimeGateway({
                config: this.config,
                runtime: this,
                health: (_a = this.health) !== null && _a !== void 0 ? _a : undefined,
                cron: (_b = this.cron) !== null && _b !== void 0 ? _b : undefined,
                providerRouter: this.providers,
                orchestration: this.orchestrationAsGatewayDeps(),
                configPath: (_c = this.configPath) !== null && _c !== void 0 ? _c : undefined,
            });
            try {
                yield gateway.start();
                this.gateway = gateway;
                const gatewayPort = gateway.port;
                if (this.health) {
                    this.health.addCheck('gateway', () => __awaiter(this, void 0, void 0, function* () {
                        try {
                            const res = yield fetch(`http://127.0.0.1:${gatewayPort}/ping`, {
                                signal: AbortSignal.timeout(2000),
                            });
                            return { healthy: res.ok };
                        }
                        catch (err) {
                            return { healthy: false, message: err instanceof Error ? err.message : String(err) };
                        }
                    }));
                }
                return this.gateway;
            }
            catch (err) {
                logger.warn('[runtime] Gateway start failed; HTTP gateway disabled', {
                    error: err instanceof Error ? err.message : String(err),
                });
                this.gateway = null;
                return null;
            }
        });
    }
    /**
     * Reload workspace files and re-register dynamic skills from SKILL.md files.
     * Safe to call at runtime without stopping the runtime.
     */
    reloadSkills() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            if (!this.workspace) {
                logger.warn('[runtime] reloadSkills called before workspace is initialized');
                return 0;
            }
            yield this.workspace.reload();
            const count = registerDynamicSkills((_c = (_b = (_a = this.workspace.getWorkspace()) === null || _a === void 0 ? void 0 : _a.files) === null || _b === void 0 ? void 0 : _b.skills) !== null && _c !== void 0 ? _c : []);
            logger.info('[runtime] Skills reloaded', { count });
            return count;
        });
    }
    /**
     * Graceful shutdown — each subsystem is stopped independently so one
     * failure does not block the others. Reverse of start() order.
     */
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.started)
                return;
            // 1. Stop config hot-reload watcher
            if (this._configWatchDispose) {
                try {
                    this._configWatchDispose();
                }
                catch (err) {
                    logger.warn('[runtime] Config watch dispose failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                this._configWatchDispose = null;
            }
            // 2. Stop HTTP gateway
            if (this.gateway) {
                try {
                    yield this.gateway.stop();
                }
                catch (err) {
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
                }
                catch (err) {
                    logger.warn('[runtime] Cron stop failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            // 4. Stop health monitor
            if (this.health) {
                try {
                    this.health.stop();
                }
                catch (err) {
                    logger.warn('[runtime] Health monitor stop failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            // 5. Dispose workspace watcher
            try {
                (_a = this.workspace) === null || _a === void 0 ? void 0 : _a.dispose();
            }
            catch (err) {
                logger.warn('[runtime] Workspace dispose failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            // 6. Flush pending session writes before exit. Do NOT cleanup(0) — that would
            // delete all session files and defeat persistence across restarts.
            if (this.store) {
                try {
                    yield this.store.flushAll();
                }
                catch (err) {
                    logger.error('Failed to flush session store', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                try {
                    this.store.close();
                }
                catch (err) {
                    logger.warn('[runtime] Session store close failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            if (this.orchestration) {
                try {
                    yield this.orchestration.dag.flushLedger();
                    yield this.orchestration.eventLedger.close();
                }
                catch (err) {
                    logger.warn('[runtime] Orchestration persistence flush failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                this.orchestration = null;
            }
            try {
                this.subagents.cleanup(0);
            }
            catch (err) {
                logger.warn('[runtime] Subagents cleanup failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            try {
                processManager.cleanup();
            }
            catch (err) {
                logger.warn('[runtime] ProcessManager cleanup failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            this.started = false;
            logger.info('PyrforRuntime stopped');
        });
    }
    /**
     * Main entry point: handle incoming message
     */
    handleMessage(channel, userId, chatId, text, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.started) {
                return { success: false, response: '', error: 'Runtime not started' };
            }
            let activeRun = null;
            try {
                // Find or create session
                let session = (options === null || options === void 0 ? void 0 : options.sessionId)
                    ? this.sessions.get(options.sessionId)
                    : this.sessions.findByContext(userId, channel, chatId);
                if (!session) {
                    const createOpts = {
                        channel,
                        userId,
                        chatId,
                        systemPrompt: this.options.systemPrompt,
                        metadata: options === null || options === void 0 ? void 0 : options.metadata,
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
                activeRun = yield this.beginUserRun({
                    session,
                    text,
                    mode: 'chat',
                    provider: options === null || options === void 0 ? void 0 : options.provider,
                    model: options === null || options === void 0 ? void 0 : options.model,
                });
                if (activeRun) {
                    yield this.markUserRunRunning(activeRun);
                }
                // Add user message
                const userMsg = { role: 'user', content: text };
                const addResult = this.sessions.addMessage(session.id, userMsg);
                if (!addResult.success) {
                    if (activeRun) {
                        yield this.completeUserRun(activeRun, 'failed', (_a = addResult.error) !== null && _a !== void 0 ? _a : 'Failed to add user message');
                    }
                    return {
                        success: false,
                        response: '',
                        sessionId: session.id,
                        runId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.runId,
                        taskId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.taskId,
                        error: addResult.error,
                    };
                }
                // Trigger auto-compact if needed
                if (this.options.enableCompact) {
                    const compactResult = yield this.compact.maybeCompact(session);
                    if (compactResult === null || compactResult === void 0 ? void 0 : compactResult.success) {
                        logger.debug('Session auto-compacted', { sessionId: session.id });
                    }
                }
                if ((options === null || options === void 0 ? void 0 : options.worker) && activeRun) {
                    yield this.prepareGovernedRun(activeRun, {
                        sessionId: session.id,
                        text,
                        openFiles: [],
                    });
                }
                const workerResponse = yield this.runLiveWorkerStream(activeRun, session.id, userId, options === null || options === void 0 ? void 0 : options.worker);
                let response;
                if (workerResponse !== null) {
                    response = workerResponse;
                    if (activeRun) {
                        yield this.finalizeGovernedRun(activeRun, session.id, options === null || options === void 0 ? void 0 : options.worker);
                    }
                }
                else {
                    // Get AI response (with tool calling loop)
                    const messages = session.messages;
                    const loopResult = yield runToolLoop(messages, runtimeToolDefinitions, (msgs, runOpts) => __awaiter(this, void 0, void 0, function* () {
                        return this.providers.chat(msgs, {
                            provider: runOpts === null || runOpts === void 0 ? void 0 : runOpts.provider,
                            model: runOpts === null || runOpts === void 0 ? void 0 : runOpts.model,
                            sessionId: runOpts === null || runOpts === void 0 ? void 0 : runOpts.sessionId,
                        });
                    }), this.createRunAwareToolExecutor(activeRun), {
                        sessionId: session.id,
                        userId,
                        runId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.runId,
                    }, {
                        provider: options === null || options === void 0 ? void 0 : options.provider,
                        model: options === null || options === void 0 ? void 0 : options.model,
                        sessionId: session.id,
                    }, {
                        approvalGate: (req) => approvalFlow.requestApproval(req),
                        onProgress: options === null || options === void 0 ? void 0 : options.onProgress,
                        onToolAudit: (event) => approvalFlow.recordToolOutcome(event),
                    });
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
                    yield this.completeUserRun(activeRun, 'completed', response.slice(0, 500));
                }
                return {
                    success: true,
                    response,
                    sessionId: session.id,
                    runId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.runId,
                    taskId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.taskId,
                    tokensUsed: cost.calls * 1000, // Rough estimate
                    costUsd: cost.totalUsd,
                };
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                if (activeRun) {
                    yield this.completeUserRun(activeRun, 'failed', msg);
                }
                logger.error('handleMessage failed', { channel, userId, error: msg });
                return {
                    success: false,
                    response: '',
                    runId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.runId,
                    taskId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.taskId,
                    error: `Error: ${msg}`,
                };
            }
        });
    }
    /**
     * Stream a response (for real-time UI)
     */
    streamMessage(channel, userId, chatId, text, options) {
        return __asyncGenerator(this, arguments, function* streamMessage_1() {
            var _a, e_1, _b, _c;
            if (!this.started) {
                yield yield __await({ type: 'error', error: 'Runtime not started' });
                return yield __await(void 0);
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
                    try {
                        for (var _d = true, _e = __asyncValues(this.providers.chatStream(messages, {
                            provider: options === null || options === void 0 ? void 0 : options.provider,
                            model: options === null || options === void 0 ? void 0 : options.model,
                            sessionId: session.id,
                        })), _f; _f = yield __await(_e.next()), _a = _f.done, !_a; _d = true) {
                            _c = _f.value;
                            _d = false;
                            const token = _c;
                            fullResponse += token;
                            yield yield __await({ type: 'token', content: token });
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (!_d && !_a && (_b = _e.return)) yield __await(_b.call(_e));
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    // Add full message to session
                    this.sessions.addMessage(session.id, { role: 'assistant', content: fullResponse });
                    yield yield __await({ type: 'done' });
                }
                catch (streamError) {
                    const msg = streamError instanceof Error ? streamError.message : String(streamError);
                    yield yield __await({ type: 'error', error: msg });
                }
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                yield yield __await({ type: 'error', error: msg });
            }
        });
    }
    /**
     * Execute a tool directly
     */
    executeTool(toolName, args, context) {
        return __awaiter(this, void 0, void 0, function* () {
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
                sessionId: context === null || context === void 0 ? void 0 : context.sessionId,
                userId: context === null || context === void 0 ? void 0 : context.userId,
            });
        });
    }
    /**
     * Spawn a subagent task
     */
    spawnSubagent(options) {
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
    waitForSubagent(taskId, timeoutMs) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield this.subagents.waitForTask(taskId, timeoutMs);
            return {
                success: result.success,
                result: result.result,
                error: result.error,
            };
        });
    }
    /**
     * Get runtime statistics
     */
    getStats() {
        var _a, _b;
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
                loaded: !!((_a = this.workspace) === null || _a === void 0 ? void 0 : _a.getWorkspace()),
                filesLoaded: ((_b = this.workspace) === null || _b === void 0 ? void 0 : _b.getWorkspace())
                    ? 1 + this.workspace.getWorkspace().files.daily.size + this.workspace.getWorkspace().files.skills.length
                    : 0,
            },
        };
    }
    /**
     * Set Telegram bot instance
     */
    setTelegramBot(bot) {
        this.telegramBot = bot;
        setTelegramBot(bot);
    }
    /**
     * Clear session for a given (channel, userId, chatId) tuple.
     * Returns true if a session was found and destroyed.
     */
    clearSession(channel, userId, chatId) {
        const session = this.sessions.findByContext(userId, channel, chatId);
        if (!session)
            return false;
        return this.sessions.destroy(session.id);
    }
    /**
     * Reload workspace from disk
     */
    reloadWorkspace() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.workspace)
                return;
            yield this.workspace.reload();
            // Update system prompt
            const wsPrompt = this.workspace.getSystemPrompt();
            if (wsPrompt) {
                this.options.systemPrompt = wsPrompt;
            }
            logger.info('Workspace reloaded');
        });
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
    streamChatRequest(input) {
        return __asyncGenerator(this, arguments, function* streamChatRequest_1() {
            var _a, e_2, _b, _c;
            var _d, _e, _f, _g;
            if (!this.started) {
                throw new Error('Runtime not started');
            }
            const userId = (_d = input.userId) !== null && _d !== void 0 ? _d : 'ide-user';
            const chatId = (_e = input.chatId) !== null && _e !== void 0 ? _e : 'ide-chat';
            const channel = 'web';
            // ── Session ────────────────────────────────────────────────────────────
            let session = input.sessionId
                ? this.sessions.get(input.sessionId)
                : this.sessions.findByContext(userId, channel, chatId);
            if (!session) {
                // Load project rules once so we can bake them into the system prompt.
                const rules = input.workspace ? yield __await(loadProjectRules(input.workspace)) : null;
                const systemPrompt = composeSystemPrompt(this.options.systemPrompt, rules);
                session = this.sessions.create({
                    channel,
                    userId,
                    chatId,
                    systemPrompt,
                });
            }
            let activeRun = null;
            const sessionId = session.id;
            let finalText = '';
            try {
                activeRun = yield __await(this.beginUserRun({
                    session,
                    text: input.text,
                    mode: 'chat',
                    provider: input.provider,
                    model: input.model,
                }));
                if (activeRun) {
                    yield __await(this.markUserRunRunning(activeRun));
                    yield yield __await({ type: 'run', sessionId, runId: activeRun.runId, taskId: activeRun.taskId });
                }
                // ── User message (with optional context-file block) ────────────────────
                let userText = input.text;
                if (input.openFiles && input.openFiles.length > 0) {
                    const ctxBlock = buildContextBlock(input.openFiles);
                    userText = `${ctxBlock}\n\n${userText}`;
                }
                const addResult = this.sessions.addMessage(sessionId, { role: 'user', content: userText });
                if (!addResult.success) {
                    throw new Error((_f = addResult.error) !== null && _f !== void 0 ? _f : 'Failed to add user message');
                }
                // ── Build messages (includes system prompt + history) ─────────────────
                const messages = session.messages;
                if (input.worker && activeRun) {
                    yield __await(this.prepareGovernedRun(activeRun, {
                        sessionId,
                        text: input.text,
                        openFiles: (_g = input.openFiles) !== null && _g !== void 0 ? _g : [],
                    }));
                }
                const workerResponse = yield __await(this.runLiveWorkerStream(activeRun, sessionId, userId, input.worker));
                if (workerResponse !== null) {
                    finalText = workerResponse;
                    if (activeRun) {
                        yield __await(this.finalizeGovernedRun(activeRun, sessionId, input.worker));
                    }
                    yield yield __await({ type: 'final', text: finalText });
                }
                else {
                    try {
                        // ── Stream ────────────────────────────────────────────────────────────
                        for (var _h = true, _j = __asyncValues(handleMessageStream(messages, {
                            chat: (msgs, opts) => {
                                var _a, _b, _c;
                                return this.providers.chat(msgs, {
                                    provider: (_a = opts === null || opts === void 0 ? void 0 : opts.provider) !== null && _a !== void 0 ? _a : input.provider,
                                    model: (_b = opts === null || opts === void 0 ? void 0 : opts.model) !== null && _b !== void 0 ? _b : input.model,
                                    sessionId: (_c = opts === null || opts === void 0 ? void 0 : opts.sessionId) !== null && _c !== void 0 ? _c : sessionId,
                                    prefer: input.prefer,
                                    routingHints: input.routingHints,
                                });
                            },
                            exec: this.createRunAwareToolExecutor(activeRun),
                            tools: runtimeToolDefinitions,
                            toolCtx: {
                                sessionId,
                                userId,
                                runId: activeRun === null || activeRun === void 0 ? void 0 : activeRun.runId,
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
                        })), _k; _k = yield __await(_j.next()), _a = _k.done, !_a; _h = true) {
                            _c = _k.value;
                            _h = false;
                            const event = _c;
                            if (event.type === 'final') {
                                finalText = event.text;
                            }
                            yield yield __await(event);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_h && !_a && (_b = _j.return)) yield __await(_b.call(_j));
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                }
                if (activeRun && !activeRun.terminalByWorker) {
                    yield __await(this.completeUserRun(activeRun, 'completed', finalText.slice(0, 500)));
                }
            }
            catch (err) {
                if (activeRun) {
                    yield __await(this.completeUserRun(activeRun, 'failed', err instanceof Error ? err.message : String(err)));
                }
                throw err;
            }
            // Persist assistant response (same as handleMessage).
            this.sessions.addMessage(session.id, { role: 'assistant', content: finalText });
        });
    }
    executeSubagentTask(task, systemPrompt) {
        return __awaiter(this, void 0, void 0, function* () {
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task },
            ];
            const response = yield this.providers.chat(messages, {
                maxTokens: 2000, // Subagents get shorter responses
            });
            return response;
        });
    }
    beginUserRun(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const runLedger = (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.runLedger;
            if (!runLedger)
                return null;
            const taskId = `turn-${randomUUID()}`;
            const run = yield runLedger.createRun({
                task_id: taskId,
                workspace_id: this.options.workspacePath,
                repo_id: this.options.workspacePath,
                branch_or_worktree_id: '',
                mode: input.mode,
                goal: input.text.slice(0, 500),
                model_profile: (_e = (_b = input.model) !== null && _b !== void 0 ? _b : (_d = (_c = this.config.ai) === null || _c === void 0 ? void 0 : _c.activeModel) === null || _d === void 0 ? void 0 : _d.modelId) !== null && _e !== void 0 ? _e : '',
                provider_route: (_l = (_j = (_f = input.provider) !== null && _f !== void 0 ? _f : (_h = (_g = this.config.ai) === null || _g === void 0 ? void 0 : _g.activeModel) === null || _h === void 0 ? void 0 : _h.provider) !== null && _j !== void 0 ? _j : (_k = this.config.providers) === null || _k === void 0 ? void 0 : _k.defaultProvider) !== null && _l !== void 0 ? _l : '',
                context_snapshot_hash: this.hashRunInput(`${input.session.id}:${input.session.messages.length}`),
                prompt_snapshot_hash: this.hashRunInput(input.text),
                permission_profile: { profile: 'standard' },
                budget_profile: {},
            });
            yield runLedger.transition(run.run_id, 'planned', 'user turn accepted');
            this.sessions.updateMetadata(input.session.id, {
                lastRunId: run.run_id,
                lastTaskId: taskId,
            });
            return { runId: run.run_id, taskId };
        });
    }
    listProductFactoryTemplates() {
        return this.productFactory.listTemplates();
    }
    previewProductFactoryPlan(input) {
        return this.productFactory.previewPlan(input);
    }
    createProductFactoryRun(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('ProductFactory: orchestration is disabled');
            const preview = this.productFactory.previewPlan(input);
            if (preview.missingClarifications.length > 0) {
                const missing = preview.missingClarifications.map((item) => item.id).join(', ');
                throw new Error(`ProductFactory: missing required clarifications: ${missing}`);
            }
            const run = yield this.orchestration.runLedger.createRun({
                task_id: preview.intent.id,
                workspace_id: this.options.workspacePath,
                repo_id: this.options.workspacePath,
                branch_or_worktree_id: '',
                mode: 'pm',
                goal: preview.intent.goal.slice(0, 500),
                model_profile: (_c = (_b = (_a = this.config.ai) === null || _a === void 0 ? void 0 : _a.activeModel) === null || _b === void 0 ? void 0 : _b.modelId) !== null && _c !== void 0 ? _c : '',
                provider_route: (_h = (_f = (_e = (_d = this.config.ai) === null || _d === void 0 ? void 0 : _d.activeModel) === null || _e === void 0 ? void 0 : _e.provider) !== null && _f !== void 0 ? _f : (_g = this.config.providers) === null || _g === void 0 ? void 0 : _g.defaultProvider) !== null && _h !== void 0 ? _h : '',
                context_snapshot_hash: this.hashRunInput(`${preview.intent.id}:${preview.template.id}`),
                prompt_snapshot_hash: this.hashRunInput(preview.intent.goal),
                permission_profile: { profile: 'standard' },
                budget_profile: {},
            });
            yield this.orchestration.runLedger.transition(run.run_id, 'planned', 'product factory plan preview created');
            const artifact = yield this.orchestration.artifactStore.writeJSON('plan', preview, {
                runId: run.run_id,
                meta: {
                    productFactory: true,
                    templateId: preview.template.id,
                    intentId: preview.intent.id,
                },
            });
            const recorded = yield this.orchestration.runLedger.recordArtifact(run.run_id, artifact.id, []);
            this.seedProductFactoryDag(run.run_id, preview, artifact);
            return { run: recorded, preview, artifact };
        });
    }
    executeProductFactoryRun(runId_1) {
        return __awaiter(this, arguments, void 0, function* (runId, options = {}) {
            var _a, _b, _c;
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('ProductFactory: orchestration is disabled');
            const runRecord = this.orchestration.runLedger.getRun(runId);
            if (!runRecord)
                throw new Error(`ProductFactory: run not found: ${runId}`);
            if (runRecord.mode !== 'pm')
                throw new Error(`ProductFactory: run ${runId} is not a product run`);
            if (runRecord.status !== 'planned') {
                throw new Error(`ProductFactory: run ${runId} must be planned before execution`);
            }
            const preview = yield this.loadProductFactoryPreview(runId);
            const sessionId = (_a = options.sessionId) !== null && _a !== void 0 ? _a : `product-factory:${runId}`;
            const userId = (_b = options.userId) !== null && _b !== void 0 ? _b : 'product-factory';
            const activeRun = { runId, taskId: runRecord.task_id };
            const worker = this.withProductFactoryDefaultWorker(options.worker, preview);
            yield this.orchestration.runLedger.transition(runId, 'running', 'product factory execution started');
            yield this.completeProductFactoryDagNodes(runId, [
                'product_factory.clarify_scope',
                'product_factory.compile_context',
                'product_factory.scoped_plan',
            ]);
            try {
                yield this.prepareGovernedRun(activeRun, {
                    sessionId,
                    text: this.productFactoryExecutionPrompt(preview),
                    openFiles: [],
                });
                const summary = (_c = yield this.runLiveWorkerStream(activeRun, sessionId, userId, worker)) !== null && _c !== void 0 ? _c : 'Product Factory execution completed.';
                yield this.completeProductFactoryDagNodes(runId, ['product_factory.worker_execution']);
                const verifierStatus = yield this.finalizeGovernedRun(activeRun, sessionId, worker, { completeRun: false });
                if (verifierStatus !== 'passed' && verifierStatus !== 'warning') {
                    yield this.orchestration.runLedger.blockRun(runId, `verifier ${verifierStatus !== null && verifierStatus !== void 0 ? verifierStatus : 'unknown'}`);
                    throw new Error(`ProductFactory: verifier blocked execution (${verifierStatus !== null && verifierStatus !== void 0 ? verifierStatus : 'unknown'})`);
                }
                const deliveryArtifact = yield this.orchestration.artifactStore.writeJSON('summary', {
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
                yield this.orchestration.runLedger.recordArtifact(runId, deliveryArtifact.id, [deliveryArtifact.uri]);
                yield this.completeProductFactoryDagNodes(runId, [
                    'product_factory.verify',
                    'product_factory.delivery_package',
                ], deliveryArtifact);
                const deliveryEvidence = yield this.captureRunDeliveryEvidence(runId, {
                    summary,
                    verifierStatus,
                    deliveryChecklist: preview.deliveryChecklist,
                    deliveryArtifactId: deliveryArtifact.id,
                });
                yield this.completeUserRun(activeRun, 'completed', `product factory verified: ${verifierStatus}`);
                return {
                    run: this.orchestration.runLedger.getRun(runId),
                    deliveryArtifact,
                    deliveryEvidenceArtifact: deliveryEvidence.artifact,
                    deliveryEvidence: deliveryEvidence.snapshot,
                    summary,
                };
            }
            catch (err) {
                const current = this.orchestration.runLedger.getRun(runId);
                if (current && current.status !== 'failed' && current.status !== 'completed' && current.status !== 'blocked' && current.status !== 'cancelled') {
                    yield this.orchestration.runLedger.completeRun(runId, 'failed', err instanceof Error ? err.message : String(err));
                }
                throw err;
            }
        });
    }
    captureRunDeliveryEvidence(runId_1) {
        return __awaiter(this, arguments, void 0, function* (runId, input = {}) {
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('DeliveryEvidence: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`DeliveryEvidence: run not found: ${runId}`);
            const verifierStatus = yield this.resolveRunVerifierStatus(runId);
            if (verifierStatus !== 'passed' && verifierStatus !== 'warning') {
                throw new Error(`DeliveryEvidence: verifier has not approved run ${runId} (${verifierStatus})`);
            }
            const snapshot = yield captureDeliveryEvidence({
                workspace: this.options.workspacePath,
                runId,
                summary: input.summary,
                verifierStatus,
                deliveryChecklist: input.deliveryChecklist,
                deliveryArtifactId: input.deliveryArtifactId,
                issueNumber: input.issueNumber,
                githubToken: this.resolveGithubToken(),
            });
            const artifact = yield this.orchestration.artifactStore.writeJSON('delivery_evidence', snapshot, {
                runId,
                meta: {
                    provider: 'github',
                    repository: snapshot.github.repository,
                    branch: snapshot.git.branch,
                    commitSha: snapshot.git.headSha,
                    verifierStatus: snapshot.verifierStatus,
                    deliveryArtifactId: snapshot.deliveryArtifactId,
                },
            });
            const currentRun = this.orchestration.runLedger.getRun(runId);
            if (currentRun && !['completed', 'failed', 'blocked', 'cancelled'].includes(currentRun.status)) {
                yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
            }
            yield this.completeDeliveryEvidenceDagNode(runId, artifact, snapshot);
            return { artifact, snapshot };
        });
    }
    resolveRunVerifierStatus(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.orchestration)
                throw new Error('DeliveryEvidence: orchestration is disabled');
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'test_result' });
            for (const artifact of [...artifacts].reverse()) {
                const metaStatus = (_a = artifact.meta) === null || _a === void 0 ? void 0 : _a['status'];
                if (this.isVerificationStatus(metaStatus))
                    return metaStatus;
                try {
                    const body = yield this.orchestration.artifactStore.readJSON(artifact);
                    if (this.isVerificationStatus(body.status))
                        return body.status;
                }
                catch (err) {
                    logger.warn('[runtime] Delivery evidence skipped unreadable verifier artifact', {
                        runId,
                        artifactId: artifact.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            const events = yield this.orchestration.runLedger.eventsForRun(runId);
            const verifierEvent = [...events]
                .reverse()
                .find((event) => event.type === 'verifier.completed');
            const eventStatus = verifierEvent === null || verifierEvent === void 0 ? void 0 : verifierEvent.status;
            if (this.isVerificationStatus(eventStatus))
                return eventStatus;
            throw new Error(`DeliveryEvidence: no verifier result recorded for run ${runId}`);
        });
    }
    isVerificationStatus(value) {
        return value === 'passed' || value === 'warning' || value === 'needs_rework' || value === 'blocked' || value === 'user_required';
    }
    getRunDeliveryEvidence(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('DeliveryEvidence: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`DeliveryEvidence: run not found: ${runId}`);
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'delivery_evidence' });
            const latest = artifacts.at(-1);
            if (!latest)
                return null;
            return {
                artifact: latest,
                snapshot: yield this.orchestration.artifactStore.readJSON(latest),
            };
        });
    }
    createRunGithubDeliveryPlan(runId_1) {
        return __awaiter(this, arguments, void 0, function* (runId, input = {}) {
            var _a;
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('GitHubDeliveryPlan: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`GitHubDeliveryPlan: run not found: ${runId}`);
            const verifierStatus = yield this.resolveRunVerifierStatus(runId);
            if (verifierStatus !== 'passed' && verifierStatus !== 'warning') {
                throw new Error(`GitHubDeliveryPlan: verifier has not approved run ${runId} (${verifierStatus})`);
            }
            const evidence = (_a = yield this.getRunDeliveryEvidence(runId)) !== null && _a !== void 0 ? _a : yield this.captureRunDeliveryEvidence(runId, {
                issueNumber: input.issueNumber,
            });
            const plan = buildGithubDeliveryPlan({
                run,
                evidence: evidence.snapshot,
                evidenceArtifactId: evidence.artifact.id,
                issueNumber: input.issueNumber,
                title: input.title,
                body: input.body,
            });
            const artifact = yield this.orchestration.artifactStore.writeJSON('delivery_plan', plan, {
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
            if (currentRun && !['completed', 'failed', 'blocked', 'cancelled'].includes(currentRun.status)) {
                yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
            }
            yield this.completeGithubDeliveryPlanDagNode(runId, artifact, plan, evidence.artifact);
            return { artifact, plan, evidenceArtifact: evidence.artifact };
        });
    }
    getRunGithubDeliveryPlan(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('GitHubDeliveryPlan: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`GitHubDeliveryPlan: run not found: ${runId}`);
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'delivery_plan' });
            const latest = artifacts.at(-1);
            if (!latest)
                return null;
            return {
                artifact: latest,
                plan: yield this.orchestration.artifactStore.readJSON(latest),
            };
        });
    }
    loadProductFactoryPreview(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.orchestration)
                throw new Error('ProductFactory: orchestration is disabled');
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'plan' });
            const planArtifact = [...artifacts].reverse().find((artifact) => { var _a; return ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a['productFactory']) === true; });
            if (!planArtifact)
                throw new Error(`ProductFactory: plan artifact not found for run ${runId}`);
            return this.orchestration.artifactStore.readJSON(planArtifact);
        });
    }
    withProductFactoryDefaultWorker(worker, preview) {
        var _a, _b, _c;
        if (worker === null || worker === void 0 ? void 0 : worker.events) {
            return Object.assign(Object.assign({}, worker), { domainIds: (_a = worker.domainIds) !== null && _a !== void 0 ? _a : preview.intent.domainIds });
        }
        return {
            transport: (_b = worker === null || worker === void 0 ? void 0 : worker.transport) !== null && _b !== void 0 ? _b : 'acp',
            domainIds: (_c = worker === null || worker === void 0 ? void 0 : worker.domainIds) !== null && _c !== void 0 ? _c : preview.intent.domainIds,
            permissionProfile: worker === null || worker === void 0 ? void 0 : worker.permissionProfile,
            permissionOverrides: worker === null || worker === void 0 ? void 0 : worker.permissionOverrides,
            verifierValidators: worker === null || worker === void 0 ? void 0 : worker.verifierValidators,
            events: ({ runId, taskId, sessionId }) => (function () {
                return __asyncGenerator(this, arguments, function* () {
                    yield yield __await({
                        sessionId,
                        type: 'worker_frame',
                        ts: Date.now(),
                        data: {
                            protocol_version: WORKER_PROTOCOL_VERSION,
                            type: 'plan_fragment',
                            frame_id: `pf-plan-${runId}`,
                            task_id: taskId,
                            run_id: runId,
                            seq: 0,
                            content: preview.scopedPlan.objective,
                            steps: preview.dagPreview.nodes.map((node) => node.kind),
                        },
                    });
                    yield yield __await({
                        sessionId,
                        type: 'worker_frame',
                        ts: Date.now(),
                        data: {
                            protocol_version: WORKER_PROTOCOL_VERSION,
                            type: 'final_report',
                            frame_id: `pf-final-${runId}`,
                            task_id: taskId,
                            run_id: runId,
                            seq: 1,
                            status: 'succeeded',
                            summary: `Product Factory executed ${preview.template.title}: ${preview.intent.title}`,
                        },
                    });
                });
            })(),
        };
    }
    productFactoryExecutionPrompt(preview) {
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
    completeProductFactoryDagNodes(runId, kinds, artifact) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.orchestration)
                return;
            const kindSet = new Set(kinds);
            const nodes = this.orchestration.dag.listNodes()
                .filter((node) => node.id.startsWith(`${runId}/`) && kindSet.has(node.kind))
                .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
            const provenance = artifact
                ? [{ kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 }]
                : [];
            for (const node of nodes) {
                const current = this.orchestration.dag.getNode(node.id);
                if (!current || current.status === 'succeeded')
                    continue;
                if (current.status === 'pending' || current.status === 'ready') {
                    this.orchestration.dag.leaseNode(node.id, 'product-factory-executor', 60000);
                }
                const leased = this.orchestration.dag.getNode(node.id);
                if ((leased === null || leased === void 0 ? void 0 : leased.status) === 'leased') {
                    this.orchestration.dag.startNode(node.id, 'product-factory-executor');
                }
                const running = this.orchestration.dag.getNode(node.id);
                if ((running === null || running === void 0 ? void 0 : running.status) === 'leased' || (running === null || running === void 0 ? void 0 : running.status) === 'running') {
                    this.orchestration.dag.completeNode(node.id, provenance);
                }
            }
        });
    }
    completeDeliveryEvidenceDagNode(runId, artifact, snapshot) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const deliveryNodeIds = (_b = (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.dag.listNodes().filter((node) => node.id.startsWith(`${runId}/`) && node.kind === 'product_factory.delivery_package').map((node) => node.id)) !== null && _b !== void 0 ? _b : [];
            yield this.completeDagNodeOnce(`run:${runId}:github-delivery-evidence`, {
                kind: 'product_factory.github_delivery_evidence',
                payload: {
                    provider: 'github',
                    repository: snapshot.github.repository,
                    branch: snapshot.git.branch,
                    commitSha: snapshot.git.headSha,
                    available: snapshot.github.available,
                },
                dependsOn: deliveryNodeIds,
                provenance: [
                    { kind: 'run', ref: runId, role: 'input' },
                    { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
                ],
            }, [
                { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
            ]);
        });
    }
    completeGithubDeliveryPlanDagNode(runId, artifact, plan, evidenceArtifact) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const evidenceNodeIds = (_b = (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.dag.listNodes().filter((node) => node.id.startsWith(`run:${runId}:github-delivery-evidence`) && node.kind === 'product_factory.github_delivery_evidence').map((node) => node.id)) !== null && _b !== void 0 ? _b : [];
            yield this.completeDagNodeOnce(`run:${runId}:github-delivery-plan`, {
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
        });
    }
    resolveGithubToken() {
        return process.env['PYRFOR_GITHUB_TOKEN'] || process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'] || undefined;
    }
    seedProductFactoryDag(runId, preview, artifact) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        if (!this.orchestration)
            return;
        if (preview.template.id === 'ochag_family_reminder') {
            const answers = this.extractProductFactoryAnswers(preview);
            const familyPayload = {
                productFactory: true,
                runId,
                artifactId: artifact.id,
                intentId: preview.intent.id,
                title: preview.intent.title,
                familyId: (_a = answers['familyId']) !== null && _a !== void 0 ? _a : 'default-family',
                audience: answers['audience'],
                memberIds: (_c = (_b = answers['memberIds']) === null || _b === void 0 ? void 0 : _b.split(',').map((item) => item.trim()).filter(Boolean)) !== null && _c !== void 0 ? _c : [],
                visibility: (_d = answers['visibility']) !== null && _d !== void 0 ? _d : 'family',
                dueAt: answers['dueAt'],
                escalationPolicy: (_e = answers['escalationPolicy']) !== null && _e !== void 0 ? _e : 'adult',
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
                this.orchestration.dag.addNode(Object.assign(Object.assign({}, node), { id: `${runId}/${node.id}`, idempotencyKey: `${runId}:${node.id}`, dependsOn: ((_f = node.dependsOn) !== null && _f !== void 0 ? _f : []).map((dep) => `${runId}/${dep}`), payload: Object.assign(Object.assign({}, ((_g = node.payload) !== null && _g !== void 0 ? _g : {})), { runId, artifactId: artifact.id }) }));
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
                projectId: (_h = answers['projectId']) !== null && _h !== void 0 ? _h : 'default-project',
                actionType: 'approval',
                decision: answers['decision'],
                evidenceRefs: (_k = (_j = answers['evidence']) === null || _j === void 0 ? void 0 : _j.split(',').map((item) => item.trim()).filter(Boolean)) !== null && _k !== void 0 ? _k : [],
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
                this.orchestration.dag.addNode(Object.assign(Object.assign({}, node), { id: `${runId}/${node.id}`, idempotencyKey: `${runId}:${node.id}`, dependsOn: ((_l = node.dependsOn) !== null && _l !== void 0 ? _l : []).map((dep) => `${runId}/${dep}`), payload: Object.assign(Object.assign({}, ((_m = node.payload) !== null && _m !== void 0 ? _m : {})), { runId, artifactId: artifact.id }) }));
            }
            return;
        }
        const idMap = new Map();
        for (const node of preview.dagPreview.nodes) {
            if (node.id)
                idMap.set(node.id, `${runId}/${node.id}`);
        }
        for (const node of preview.dagPreview.nodes) {
            const originalId = (_o = node.id) !== null && _o !== void 0 ? _o : randomUUID();
            const persistedId = (_p = idMap.get(originalId)) !== null && _p !== void 0 ? _p : `${runId}/${originalId}`;
            this.orchestration.dag.addNode(Object.assign(Object.assign({}, node), { id: persistedId, idempotencyKey: `${runId}:${originalId}`, dependsOn: ((_q = node.dependsOn) !== null && _q !== void 0 ? _q : []).map((dep) => { var _a; return (_a = idMap.get(dep)) !== null && _a !== void 0 ? _a : `${runId}/${dep}`; }), payload: Object.assign(Object.assign({}, ((_r = node.payload) !== null && _r !== void 0 ? _r : {})), { runId, artifactId: artifact.id }), provenance: [
                    ...((_s = node.provenance) !== null && _s !== void 0 ? _s : []),
                    { kind: 'run', ref: runId, role: 'input' },
                    { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
                ] }));
        }
    }
    extractProductFactoryAnswers(preview) {
        const answers = {};
        for (const scopeLine of preview.scopedPlan.scope) {
            for (const clarification of preview.template.clarifications) {
                if (scopeLine.startsWith(clarification.question)) {
                    answers[clarification.id] = scopeLine.slice(clarification.question.length).trim();
                }
            }
        }
        return answers;
    }
    markUserRunRunning(run) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            yield ((_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.runLedger.transition(run.runId, 'running', 'user turn started'));
        });
    }
    completeUserRun(run, status, summary) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const current = (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.runLedger.getRun(run.runId);
            if ((current === null || current === void 0 ? void 0 : current.status) === 'completed' || (current === null || current === void 0 ? void 0 : current.status) === 'failed') {
                return;
            }
            yield ((_b = this.orchestration) === null || _b === void 0 ? void 0 : _b.runLedger.completeRun(run.runId, status, summary));
        });
    }
    createRunAwareToolExecutor(run) {
        return (name, args, ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            if (run) {
                yield ((_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.runLedger.recordToolRequested(run.runId, name, args));
            }
            const result = yield executeRuntimeTool(name, args, Object.assign(Object.assign({}, ctx), { runId: (_b = run === null || run === void 0 ? void 0 : run.runId) !== null && _b !== void 0 ? _b : ctx === null || ctx === void 0 ? void 0 : ctx.runId }));
            if (run) {
                yield ((_c = this.orchestration) === null || _c === void 0 ? void 0 : _c.runLedger.recordToolExecuted(run.runId, name, {
                    status: result.success ? 'ok' : 'error',
                    error: result.success ? undefined : result.error,
                }));
            }
            return result;
        });
    }
    runLiveWorkerStream(run, sessionId, userId, worker) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, e_3, _b, _c, _d, e_4, _e, _f;
            if (!(worker === null || worker === void 0 ? void 0 : worker.events) || !run || !this.orchestration) {
                return null;
            }
            const host = this.createOrchestrationHostForRun(run, sessionId, userId, worker);
            run.orchestrationHost = host;
            run.workerTransport = worker.transport;
            const results = [];
            const events = typeof worker.events === 'function'
                ? worker.events({ runId: run.runId, taskId: run.taskId, sessionId })
                : worker.events;
            if (worker.transport === 'acp') {
                try {
                    for (var _g = true, _h = __asyncValues(events), _j; _j = yield _h.next(), _a = _j.done, !_a; _g = true) {
                        _c = _j.value;
                        _g = false;
                        const event = _c;
                        const result = yield host.codingHost.handleAcpEvent(event);
                        if (result)
                            results.push(result);
                    }
                }
                catch (e_3_1) { e_3 = { error: e_3_1 }; }
                finally {
                    try {
                        if (!_g && !_a && (_b = _h.return)) yield _b.call(_h);
                    }
                    finally { if (e_3) throw e_3.error; }
                }
            }
            else {
                try {
                    for (var _k = true, _l = __asyncValues(events), _m; _m = yield _l.next(), _d = _m.done, !_d; _k = true) {
                        _f = _m.value;
                        _k = false;
                        const event = _f;
                        const result = yield host.codingHost.handleFreeClaudeEvent(event);
                        if (result)
                            results.push(result);
                    }
                }
                catch (e_4_1) { e_4 = { error: e_4_1 }; }
                finally {
                    try {
                        if (!_k && !_d && (_e = _l.return)) yield _e.call(_l);
                    }
                    finally { if (e_4) throw e_4.error; }
                }
            }
            return this.summarizeWorkerResults(run, results);
        });
    }
    prepareGovernedRun(run, input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.orchestration || run.governed)
                return;
            const compiler = new ContextCompiler({
                artifactStore: this.orchestration.artifactStore,
                eventLedger: this.orchestration.eventLedger,
                runLedger: this.orchestration.runLedger,
                dag: this.orchestration.dag,
            });
            const compiled = yield compiler.compile({
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
            const contextArtifact = yield compiler.persist(compiled, {
                artifactStore: this.orchestration.artifactStore,
                runId: run.runId,
            });
            yield this.orchestration.runLedger.recordArtifact(run.runId, contextArtifact.id, [contextArtifact.uri]);
            const contextNodeId = `run:${run.runId}:ctx`;
            yield this.completeDagNodeOnce(contextNodeId, {
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
        });
    }
    createOrchestrationHostForRun(run, sessionId, userId, worker) {
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
            toolAudit: (event) => {
                var _a;
                return approvalFlow.recordToolOutcome(Object.assign(Object.assign({}, event), { sessionId: (_a = event.sessionId) !== null && _a !== void 0 ? _a : sessionId }));
            },
            logger: (level, message, meta) => {
                logger[level](message, typeof meta === 'object' && meta !== null ? meta : { meta });
            },
            deferTerminalRunCompletion: true,
            onFrameResult: (result, source) => __awaiter(this, void 0, void 0, function* () {
                yield this.recordGovernedWorkerFrame(run, result, source);
            }),
        });
    }
    recordGovernedWorkerFrame(run, result, source) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.orchestration || !run.governed || !result.frame)
                return;
            const frame = result.frame;
            const acpEvent = {
                sessionId: `${source}:${run.runId}`,
                type: 'worker_frame',
                data: frame,
                ts: Date.now(),
            };
            run.governed.workerEvents.push(acpEvent);
            const frameNodeId = `run:${run.runId}:frame:${frame.frame_id}`;
            yield this.completeDagNodeOnce(frameNodeId, {
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
                yield this.completeDagNodeOnce(effectNodeId, {
                    kind: `worker.effect.${result.effect.kind}`,
                    payload: {
                        effectId: result.effect.effect_id,
                        status: result.effect.status,
                        verdict: (_a = result.verdict) === null || _a === void 0 ? void 0 : _a.decision,
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
        });
    }
    createWorkerToolExecutors(run, sessionId, userId) {
        const ctx = { sessionId, userId, runId: run.runId };
        return {
            shell_exec: (inv) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const result = yield executeRuntimeTool('exec', inv.args, ctx);
                if (!result.success) {
                    const err = new Error((_a = result.error) !== null && _a !== void 0 ? _a : 'shell_exec failed');
                    err.code = 'shell_exec_failed';
                    throw err;
                }
                return result.data;
            }),
            apply_patch: (inv) => __awaiter(this, void 0, void 0, function* () {
                const patch = typeof inv.args.patch === 'string' ? inv.args.patch : '';
                const files = Array.isArray(inv.args.files)
                    ? inv.args.files.filter((file) => typeof file === 'string')
                    : [];
                if (!patch.trim()) {
                    const err = new Error('Patch required');
                    err.code = 'patch_required';
                    throw err;
                }
                return this.applyWorkerPatch(patch, files, ctx);
            }),
        };
    }
    applyWorkerPatch(patch, files, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            const workspaceRoot = this.options.workspacePath;
            for (const file of files) {
                const resolved = path.resolve(workspaceRoot, file);
                if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
                    const err = new Error(`Patch path outside workspace: ${file}`);
                    err.code = 'patch_path_outside_workspace';
                    throw err;
                }
            }
            const patchFile = path.join(os.tmpdir(), `pyrfor-worker-${ctx.runId}-${randomUUID()}.patch`);
            yield fs.writeFile(patchFile, patch, 'utf-8');
            try {
                yield execFileAsync('git', ['apply', '--check', patchFile], { cwd: workspaceRoot });
                const { stdout, stderr } = yield execFileAsync('git', ['apply', patchFile], { cwd: workspaceRoot });
                return {
                    files,
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                };
            }
            finally {
                yield fs.rm(patchFile, { force: true });
            }
        });
    }
    finalizeGovernedRun(run_1, sessionId_1, worker_1) {
        return __awaiter(this, arguments, void 0, function* (run, sessionId, worker, options = {}) {
            var _a, _b, _c;
            if (!this.orchestration || !run.governed)
                return null;
            if (run.governed.verifierStatus)
                return run.governed.verifierStatus;
            const verifierNodeId = `run:${run.runId}:verify`;
            const verifier = new VerifierLane({
                ledger: this.orchestration.eventLedger,
                runLedger: this.orchestration.runLedger,
                replayStoreDir: path.join((_a = this.resolveRuntimeDataRoot()) !== null && _a !== void 0 ? _a : os.tmpdir(), 'orchestration', 'replays'),
                dagStorePath: path.join((_b = this.resolveRuntimeDataRoot()) !== null && _b !== void 0 ? _b : os.tmpdir(), 'orchestration', `verifier-${run.runId}.json`),
                workspaceId: this.options.workspacePath,
                repoId: this.options.workspacePath,
                validators: (_c = worker === null || worker === void 0 ? void 0 : worker.verifierValidators) !== null && _c !== void 0 ? _c : [],
            });
            const result = yield verifier.run({
                parentRunId: run.runId,
                verifierRunId: `${run.runId}:verifier`,
                acpEvents: run.governed.workerEvents,
                cwd: this.options.workspacePath,
                workspaceId: this.options.workspacePath,
                repoId: this.options.workspacePath,
                validators: worker === null || worker === void 0 ? void 0 : worker.verifierValidators,
            });
            run.governed.verifierStatus = result.status;
            yield this.orchestration.eventLedger.append({
                type: 'verifier.completed',
                run_id: run.runId,
                subject_id: result.verifierRunId,
                status: result.status,
                action: result.status === 'passed' || result.status === 'warning' ? 'allow' : 'block',
                reason: `verifier ${result.status}`,
                findings: result.steps.reduce((sum, step) => sum + step.results.length, 0),
            });
            const verifierArtifact = yield this.orchestration.artifactStore.writeJSON('test_result', {
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
            yield this.orchestration.runLedger.recordArtifact(run.runId, verifierArtifact.id, [verifierArtifact.uri]);
            yield this.completeDagNodeOnce(verifierNodeId, {
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
                    yield this.completeUserRun(run, 'completed', `worker verified: ${result.status}`);
                    run.terminalByWorker = true;
                }
                return result.status;
            }
            if (options.completeRun !== false) {
                yield this.orchestration.runLedger.blockRun(run.runId, `verifier ${result.status}`);
                run.terminalByWorker = true;
            }
            logger.warn('[runtime] Governed worker run blocked by verifier', {
                runId: run.runId,
                sessionId,
                status: result.status,
            });
            return result.status;
        });
    }
    completeDagNodeOnce(nodeId_1, input_1) {
        return __awaiter(this, arguments, void 0, function* (nodeId, input, completionProvenance = []) {
            if (!this.orchestration)
                return;
            const existing = this.orchestration.dag.getNode(nodeId);
            if ((existing === null || existing === void 0 ? void 0 : existing.status) === 'succeeded')
                return;
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
            if ((current === null || current === void 0 ? void 0 : current.status) === 'pending' || (current === null || current === void 0 ? void 0 : current.status) === 'ready') {
                this.orchestration.dag.leaseNode(nodeId, 'runtime-governor', 60000);
            }
            const leased = this.orchestration.dag.getNode(nodeId);
            if ((leased === null || leased === void 0 ? void 0 : leased.status) === 'leased') {
                this.orchestration.dag.startNode(nodeId, 'runtime-governor');
            }
            const running = this.orchestration.dag.getNode(nodeId);
            if ((running === null || running === void 0 ? void 0 : running.status) === 'leased' || (running === null || running === void 0 ? void 0 : running.status) === 'running') {
                this.orchestration.dag.completeNode(nodeId, completionProvenance);
            }
        });
    }
    summarizeWorkerResults(run, results) {
        var _a, _b;
        const terminal = [...results].reverse().find((result) => result.disposition === 'run_completed' || result.disposition === 'run_failed');
        if ((terminal === null || terminal === void 0 ? void 0 : terminal.disposition) === 'run_completed') {
            run.terminalByWorker = true;
            const frame = terminal.frame;
            return frame && 'summary' in frame ? String(frame.summary) : 'Worker run completed';
        }
        if ((terminal === null || terminal === void 0 ? void 0 : terminal.disposition) === 'run_failed') {
            run.terminalByWorker = true;
            const frame = terminal.frame;
            const message = frame && 'error' in frame ? frame.error.message : 'Worker run failed';
            throw new Error(message);
        }
        const denied = results.find((result) => result.disposition === 'effect_denied');
        if (denied) {
            return (_b = (_a = denied.verdict) === null || _a === void 0 ? void 0 : _a.reason) !== null && _b !== void 0 ? _b : 'Worker run blocked by policy';
        }
        const invoked = results.filter((result) => result.disposition === 'tool_invoked').length;
        return invoked > 0
            ? `Worker processed ${invoked} approved effect${invoked === 1 ? '' : 's'}.`
            : 'Worker stream processed.';
    }
    hashRunInput(value) {
        return createHash('sha256').update(value).digest('hex');
    }
    resolveRuntimeDataRoot() {
        var _a, _b, _c;
        if (this.options.persistence === false || this.config.persistence.enabled === false) {
            return null;
        }
        return (_c = (_b = (_a = this.config.persistence.rootDir) !== null && _a !== void 0 ? _a : this.options.persistence.rootDir) !== null && _b !== void 0 ? _b : path.dirname(DEFAULT_CONFIG_PATH)) !== null && _c !== void 0 ? _c : path.join(os.homedir(), '.pyrfor');
    }
    initOrchestration() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.orchestration)
                return;
            const rootDir = this.resolveRuntimeDataRoot();
            if (!rootDir) {
                logger.info('[runtime] Orchestration persistence disabled');
                return;
            }
            const orchestrationDir = path.join(rootDir, 'orchestration');
            const eventLedger = new EventLedger(path.join(orchestrationDir, 'events.jsonl'));
            const runLedger = new RunLedger({ ledger: eventLedger });
            yield this.hydrateRunLedger(runLedger, eventLedger);
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
        });
    }
    hydrateRunLedger(runLedger, eventLedger) {
        return __awaiter(this, void 0, void 0, function* () {
            const runIds = new Set();
            for (const event of yield eventLedger.readAll()) {
                if (event.type === 'run.created' && event.run_id) {
                    runIds.add(event.run_id);
                }
            }
            for (const runId of runIds) {
                try {
                    yield runLedger.replayRun(runId);
                }
                catch (err) {
                    logger.warn('[runtime] Failed to hydrate orchestration run', {
                        runId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        });
    }
    orchestrationAsGatewayDeps() {
        if (!this.orchestration)
            return undefined;
        return this.orchestration;
    }
    getDefaultSystemPrompt() {
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
export { SessionManager } from './session.js';
export { ProviderRouter } from './provider-router.js';
export { AutoCompact } from './compact.js';
export { SubagentSpawner } from './subagents.js';
export { PrivacyManager, PUBLIC_ZONE, PERSONAL_ZONE, VAULT_ZONE } from './privacy.js';
export { WorkspaceLoader } from './workspace-loader.js';
export { RunLedger } from './run-ledger.js';
export { EventLedger } from './event-ledger.js';
export { ArtifactStore } from './artifact-model.js';
export * from './worker-protocol.js';
export { WorkerProtocolBridge } from './worker-protocol-bridge.js';
export { TwoPhaseEffectRunner } from './two-phase-effect.js';
export { DurableDag } from './durable-dag.js';
export { VerifierLane, runOrchestrationEvalSuite } from './verifier-lane.js';
export { hashContextPack, stableStringify, withContextPackHash, } from './context-pack.js';
export { ContextCompiler } from './context-compiler.js';
export * from './domain-overlay.js';
export * from './domain-overlay-presets.js';
export * from './github-delivery-evidence.js';
export * from './github-delivery-plan.js';
export * from './orchestration-host-factory.js';
export * from './tools.js';
export * from './pyrfor-scoring.js';
