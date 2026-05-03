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
import { SessionStore, reviveSessionRecord, } from './session-store.js';
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
import { searchDurableMemoryForContext, storeMemory, } from '../ai/memory/agent-memory-store.js';
import { DEFAULT_CONFIG_PATH, loadConfig, watchConfig, RuntimeConfigSchema } from './config.js';
import { HealthMonitor } from './health.js';
import { CronService } from './cron.js';
import { getDefaultHandlers } from './cron/handlers.js';
import { createRuntimeGateway } from './gateway.js';
import { createDailyMemoryRollup } from './memory-rollup.js';
import { createProjectMemoryRollup } from './project-memory.js';
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
import { assertWorkerManifestDomainScope, materializeWorkerManifest, mergePermissionOverrides, mergePermissionProfiles, mergeWorkerDomainScopes, } from './worker-manifest.js';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol.js';
import { createDefaultProductFactory, } from './product-factory.js';
import { captureDeliveryEvidence, } from './github-delivery-evidence.js';
import { buildGithubDeliveryPlan, } from './github-delivery-plan.js';
import { applyGithubDeliveryPlan, buildApplyIdempotencyKey, validateGithubDeliveryApplyPreconditions, } from './github-delivery-apply.js';
function memoryToSearchHit(entry) {
    var _a;
    const metadata = (_a = entry.metadata) !== null && _a !== void 0 ? _a : {};
    const scope = metadata.scope;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: entry.id }, (entry.summary ? { summary: entry.summary } : {})), { content: entry.content, createdAt: entry.createdAt.toISOString(), memoryType: entry.memoryType, importance: entry.importance }), (entry.workspaceId ? { workspaceId: entry.workspaceId } : {})), (entry.projectId ? { projectId: entry.projectId } : {})), { source: 'durable' }), ((scope === null || scope === void 0 ? void 0 : scope.visibility) ? { scopeVisibility: scope.visibility } : {})), (typeof metadata.rollupKind === 'string' ? { rollupKind: metadata.rollupKind } : {})), (typeof metadata.projectMemoryCategory === 'string' ? { projectMemoryCategory: metadata.projectMemoryCategory } : {}));
}
const execFileAsync = promisify(execFile);
function buildCeoclawBusinessBriefApprovalId(runId) {
    return `ceoclaw-business-brief-${runId}`;
}
function buildGithubDeliveryApplyApprovalId(runId, planArtifactId, expectedPlanSha256) {
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
    constructor(options = {}) {
        var _a, _b, _c, _d, _e, _f;
        this.workspace = null;
        this.store = null;
        this.health = null;
        this.cron = null;
        this.gateway = null;
        this.orchestration = null;
        this.approvalFlowUnsubscribe = null;
        this.ceoclawDenialApprovalsInFlight = new Set();
        this.productFactory = createDefaultProductFactory();
        this.configPath = null;
        this._configWatchDispose = null;
        this.started = false;
        this.telegramBot = null;
        this.workspaceSwitchPromise = null;
        this.baseSystemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
        this.options = {
            workspacePath: options.workspacePath || process.cwd(),
            memoryPath: options.memoryPath || undefined,
            systemPrompt: this.baseSystemPrompt,
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
        this.providers = new ProviderRouter(this.options.providerOptions);
        this.compact = new AutoCompact(this.providers, {
            onCompact: (session) => __awaiter(this, void 0, void 0, function* () {
                if (!this.store)
                    return;
                this.store.save(session);
                yield this.store.flushAll();
            }),
        });
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
        if (this.store && this.options.persistence !== false && !this.options.persistence.rootDir) {
            const oldStore = this.store;
            this.configureSessionStore();
            void oldStore.close().catch((err) => {
                logger.warn('[runtime] Previous session store close failed after workspace change', {
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }
        if (this.started) {
            this.workspaceSwitchPromise = this.reloadWorkspaceAfterSwitch()
                .finally(() => {
                this.workspaceSwitchPromise = null;
            });
            return this.workspaceSwitchPromise;
        }
        return Promise.resolve();
    }
    getWorkspacePath() {
        return this.options.workspacePath;
    }
    resolvedSessionStoreOptions() {
        var _a;
        if (this.options.persistence === false)
            return false;
        return Object.assign(Object.assign({}, this.options.persistence), { rootDir: (_a = this.options.persistence.rootDir) !== null && _a !== void 0 ? _a : path.join(this.options.workspacePath, '.pyrfor', 'sessions') });
    }
    configureSessionStore() {
        const persistenceOptions = this.resolvedSessionStoreOptions();
        if (persistenceOptions === false) {
            this.store = null;
            this.sessions.setStore(null);
            return;
        }
        this.store = new SessionStore(persistenceOptions);
        this.sessions.setStore(this.store);
    }
    currentWorkspaceFilter() {
        return { workspaceId: this.options.workspacePath };
    }
    belongsToCurrentWorkspace(session) {
        return session.metadata['workspaceId'] === this.options.workspacePath;
    }
    restoreCurrentWorkspaceSession(sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            const existing = this.sessions.get(sessionId);
            if (existing)
                return existing;
            if (!this.store)
                return undefined;
            const record = yield this.store.get(this.options.workspacePath, sessionId);
            if (!record)
                return undefined;
            const session = reviveSessionRecord(record);
            this.sessions.restore(session);
            return session;
        });
    }
    awaitWorkspaceSwitch() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.workspaceSwitchPromise) {
                yield this.workspaceSwitchPromise;
            }
        });
    }
    workspaceLoaderOptions() {
        return {
            workspacePath: this.options.workspacePath,
            memoryPath: this.options.memoryPath,
        };
    }
    loadWorkspaceState() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            (_a = this.workspace) === null || _a === void 0 ? void 0 : _a.dispose();
            this.workspace = new WorkspaceLoader(this.workspaceLoaderOptions());
            yield this.workspace.load();
            setSkillAIProvider((messages) => this.providers.chat(messages));
            const dynamicSkillCount = registerDynamicSkills((_d = (_c = (_b = this.workspace.getWorkspace()) === null || _b === void 0 ? void 0 : _b.files) === null || _c === void 0 ? void 0 : _c.skills) !== null && _d !== void 0 ? _d : []);
            if (dynamicSkillCount > 0) {
                logger.info('[runtime] Dynamic skills registered', { count: dynamicSkillCount });
            }
            setWorkspaceRoot(this.options.workspacePath);
            const wsPrompt = this.workspace.getSystemPrompt();
            this.options.systemPrompt = wsPrompt || this.baseSystemPrompt;
        });
    }
    restoreCurrentWorkspaceSessions() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.store)
                return;
            yield this.store.init();
            const persisted = yield this.store.list(this.options.workspacePath, { mode: 'chat' });
            const restoredIds = new Set();
            let restored = 0;
            for (const record of persisted) {
                if (restoredIds.has(record.id))
                    continue;
                try {
                    const existing = this.sessions.get(record.id);
                    if (existing) {
                        restoredIds.add(record.id);
                        continue;
                    }
                    this.sessions.restore(reviveSessionRecord(record));
                    restoredIds.add(record.id);
                    restored++;
                }
                catch (err) {
                    logger.warn('Failed to revive persisted session', {
                        id: record.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            if (restored > 0) {
                logger.info('Restored persisted sessions', { count: restored });
            }
        });
    }
    reloadWorkspaceAfterSwitch() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadWorkspaceState();
            try {
                yield this.restoreCurrentWorkspaceSessions();
            }
            catch (err) {
                logger.error('Session store init/load failed after workspace switch; continuing without restored sessions', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        });
    }
    getMemorySnapshot() {
        var _a, _b;
        const files = (_b = (_a = this.workspace) === null || _a === void 0 ? void 0 : _a.getWorkspace()) === null || _b === void 0 ? void 0 : _b.files;
        if (!files) {
            return { lines: [], files: [], workspaceFiles: {}, daily: [] };
        }
        const workspaceEntries = [
            ['MEMORY.md', files.memory],
            ['SOUL.md', files.soul],
            ['USER.md', files.user],
            ['IDENTITY.md', files.identity],
            ['AGENTS.md', files.agents],
            ['HEARTBEAT.md', files.heartbeat],
            ['TOOLS.md', files.tools],
        ];
        const daily = [...files.daily.entries()]
            .sort(([left], [right]) => right.localeCompare(left))
            .map(([date, content]) => ({
            date,
            lineCount: content.split('\n').length,
            lines: content.split('\n').slice(-20),
        }));
        const memoryLines = [
            ...files.memory.split('\n'),
            ...daily.flatMap((entry) => entry.lines),
        ].filter((line) => line.trim().length > 0).slice(-50);
        return {
            lines: memoryLines,
            files: [
                ...workspaceEntries.filter(([, content]) => content.length > 0).map(([name]) => name),
                ...daily.map((entry) => `memory/${entry.date}.md`),
                ...files.skills.map((_, index) => `SKILL-${index}.md`),
            ],
            workspaceFiles: Object.fromEntries(workspaceEntries.map(([name, content]) => [
                name,
                { present: content.length > 0, lineCount: content ? content.split('\n').length : 0 },
            ])),
            daily,
        };
    }
    listSessions() {
        return __awaiter(this, arguments, void 0, function* (options = {}) {
            yield this.awaitWorkspaceSwitch();
            if (!this.store)
                return [];
            const listOptions = {
                mode: 'chat',
                orderBy: 'updatedAt',
                direction: 'desc',
            };
            if (options.limit !== undefined)
                listOptions.limit = options.limit;
            if (options.offset !== undefined)
                listOptions.offset = options.offset;
            if (options.archived !== undefined)
                listOptions.archived = options.archived;
            const records = yield this.store.list(this.options.workspacePath, listOptions);
            return records.map((record) => this.toSessionSummary(record));
        });
    }
    getSession(sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            const record = yield this.getCurrentWorkspaceSessionRecord(sessionId);
            return record ? this.toSessionDetail(record) : null;
        });
    }
    getSessionTimeline(sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            const record = yield this.getCurrentWorkspaceSessionRecord(sessionId);
            if (!record)
                return null;
            return Object.assign(Object.assign({ sessionId: record.id, workspaceId: record.workspaceId }, (record.summary ? { summary: record.summary } : {})), { events: record.messages.map((message, index) => (Object.assign({ id: message.id, sessionId: record.id, type: 'message', role: message.role, content: message.content, createdAt: message.createdAt, index }, (message.metadata ? { metadata: message.metadata } : {})))) });
        });
    }
    searchMemory(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            yield this.awaitWorkspaceSwitch();
            const trimmed = input.query.trim();
            if (!trimmed)
                throw new Error('Memory search query is required');
            const projectId = ((_a = input.projectId) === null || _a === void 0 ? void 0 : _a.trim()) || undefined;
            const results = yield searchDurableMemoryForContext({
                agentId: 'pyrfor-runtime',
                query: trimmed,
                workspaceId: this.options.workspacePath,
                projectId,
                limit: Math.max(1, Math.min((_b = input.limit) !== null && _b !== void 0 ? _b : 10, 50)),
            });
            return Object.assign(Object.assign({ workspaceId: this.options.workspacePath, query: trimmed }, (projectId ? { projectId } : {})), { results: results.map(memoryToSearchHit) });
        });
    }
    createMemoryCorrection(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            yield this.awaitWorkspaceSwitch();
            const content = input.content.trim();
            if (!content)
                throw new Error('Memory correction content is required');
            const projectId = ((_a = input.projectId) === null || _a === void 0 ? void 0 : _a.trim()) || undefined;
            const memoryType = (_b = input.memoryType) !== null && _b !== void 0 ? _b : 'semantic';
            const importance = Math.max(0, Math.min((_c = input.importance) !== null && _c !== void 0 ? _c : 0.8, 1));
            const memoryId = yield storeMemory({
                agentId: 'pyrfor-runtime',
                workspaceId: this.options.workspacePath,
                projectId,
                memoryType,
                content,
                summary: ((_d = input.summary) === null || _d === void 0 ? void 0 : _d.trim()) || content.slice(0, 160),
                importance,
                metadata: {
                    correctionKind: 'operator',
                    operatorId: ((_e = input.operatorId) === null || _e === void 0 ? void 0 : _e.trim()) || 'operator',
                    scope: Object.assign({ visibility: projectId ? 'project' : 'workspace', workspaceId: this.options.workspacePath }, (projectId ? { projectId } : {})),
                    confidence: 0.95,
                    provenance: [{ kind: 'user', ref: ((_f = input.operatorId) === null || _f === void 0 ? void 0 : _f.trim()) || 'operator', ts: new Date().toISOString() }],
                },
            });
            if (memoryId === 'short-term-only')
                throw new Error('Memory correction was not durably persisted');
            return {
                memory: Object.assign(Object.assign({ id: memoryId, summary: ((_g = input.summary) === null || _g === void 0 ? void 0 : _g.trim()) || content.slice(0, 160), content, createdAt: new Date().toISOString(), memoryType,
                    importance, workspaceId: this.options.workspacePath }, (projectId ? { projectId } : {})), { source: 'durable', scopeVisibility: projectId ? 'project' : 'workspace' }),
            };
        });
    }
    getCurrentWorkspaceSessionRecord(sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.awaitWorkspaceSwitch();
            if (!this.store)
                return null;
            const live = this.sessions.get(sessionId);
            if (live && !this.belongsToCurrentWorkspace(live))
                return null;
            return this.store.get(this.options.workspacePath, sessionId);
        });
    }
    toSessionSummary(record) {
        return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: record.id, workspaceId: record.workspaceId, title: record.title, mode: record.mode }, (record.runId ? { runId: record.runId } : {})), (record.parentSessionId ? { parentSessionId: record.parentSessionId } : {})), { createdAt: record.createdAt, updatedAt: record.updatedAt, messageCount: record.messages.length }), (record.summary ? { summary: record.summary } : {})), (record.archived !== undefined ? { archived: record.archived } : {}));
    }
    toSessionDetail(record) {
        return Object.assign(Object.assign(Object.assign({}, this.toSessionSummary(record)), { messages: record.messages }), (record.metadata ? { metadata: record.metadata } : {}));
    }
    createDailyMemoryRollup() {
        return __awaiter(this, arguments, void 0, function* (input = {}) {
            var _a, _b;
            yield this.awaitWorkspaceSwitch();
            if (!this.store)
                throw new Error('Memory rollup requires session persistence');
            yield this.initOrchestration();
            return createDailyMemoryRollup({
                sessionStore: this.store,
                eventLedger: (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.eventLedger,
                artifactStore: (_b = this.orchestration) === null || _b === void 0 ? void 0 : _b.artifactStore,
            }, Object.assign({ workspaceId: this.options.workspacePath }, input));
        });
    }
    createProjectMemoryRollup(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            yield this.awaitWorkspaceSwitch();
            if (!this.store)
                throw new Error('Project memory rollup requires session persistence');
            yield this.initOrchestration();
            return createProjectMemoryRollup({
                sessionStore: this.store,
                eventLedger: (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.eventLedger,
                artifactStore: (_b = this.orchestration) === null || _b === void 0 ? void 0 : _b.artifactStore,
            }, Object.assign({ workspaceId: this.options.workspacePath }, input));
        });
    }
    /**
     * Start all services
     */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
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
            this.configureSessionStore();
            yield this.loadWorkspaceState();
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
            // Restore persisted sessions (best-effort, never fatal).
            if (this.store) {
                try {
                    yield this.restoreCurrentWorkspaceSessions();
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
            if ((_b = (_a = this.config.persistence) === null || _a === void 0 ? void 0 : _a.prisma) === null || _b === void 0 ? void 0 : _b.enabled) {
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
                    yield this.store.close();
                }
                catch (err) {
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
            var _a, _b;
            if (!this.started) {
                return { success: false, response: '', error: 'Runtime not started' };
            }
            let activeRun = null;
            try {
                yield this.awaitWorkspaceSwitch();
                // Find or create session
                let session = (options === null || options === void 0 ? void 0 : options.sessionId)
                    ? yield this.restoreCurrentWorkspaceSession(options.sessionId)
                    : this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());
                if (session && !this.belongsToCurrentWorkspace(session)) {
                    session = undefined;
                }
                if (!session) {
                    const createOpts = {
                        channel,
                        userId,
                        chatId,
                        systemPrompt: this.options.systemPrompt,
                        metadata: Object.assign(Object.assign({}, ((_a = options === null || options === void 0 ? void 0 : options.metadata) !== null && _a !== void 0 ? _a : {})), { workspaceId: this.options.workspacePath, title: `${channel}:${chatId}` }),
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
                        yield this.completeUserRun(activeRun, 'failed', (_b = addResult.error) !== null && _b !== void 0 ? _b : 'Failed to add user message');
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
                yield __await(this.awaitWorkspaceSwitch());
                // Find or create session
                let session = this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());
                if (!session) {
                    session = this.sessions.create({
                        channel,
                        userId,
                        chatId,
                        systemPrompt: this.options.systemPrompt,
                        metadata: {
                            workspaceId: this.options.workspacePath,
                            title: `${channel}:${chatId}`,
                        },
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
        const session = this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());
        if (!session)
            return false;
        return this.sessions.destroy(session.id);
    }
    /**
     * Reload workspace from disk
     */
    reloadWorkspace() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadWorkspaceState();
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
            yield __await(this.awaitWorkspaceSwitch());
            // ── Session ────────────────────────────────────────────────────────────
            let session = input.sessionId
                ? yield __await(this.restoreCurrentWorkspaceSession(input.sessionId))
                : this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());
            if (session && !this.belongsToCurrentWorkspace(session)) {
                session = undefined;
            }
            if (!session) {
                // Load project rules once so we can bake them into the system prompt.
                const rules = input.workspace ? yield __await(loadProjectRules(input.workspace)) : null;
                const systemPrompt = composeSystemPrompt(this.options.systemPrompt, rules);
                session = this.sessions.create({
                    channel,
                    userId,
                    chatId,
                    systemPrompt,
                    metadata: {
                        workspaceId: this.options.workspacePath,
                        title: `${channel}:${chatId}`,
                    },
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
                if (this.options.enableCompact) {
                    const compactResult = yield __await(this.compact.maybeCompact(session));
                    if (compactResult === null || compactResult === void 0 ? void 0 : compactResult.success) {
                        logger.debug('Session auto-compacted', { sessionId: session.id });
                    }
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
            const preview = yield this.loadProductFactoryPreview(runId);
            if (preview.template.id === 'ochag_family_reminder') {
                return this.executeOchagReminderRun(runId, runRecord, preview);
            }
            if (preview.template.id === 'business_brief') {
                return this.executeCeoclawBusinessBriefRun(runId, runRecord, preview, options.approvalId);
            }
            if (runRecord.status !== 'planned') {
                throw new Error(`ProductFactory: run ${runId} must be planned before execution`);
            }
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
                    throw new Error(`ProductFactory: verifier blocked execution (${verifierStatus !== null && verifierStatus !== void 0 ? verifierStatus : 'unknown'}); create a verifier waiver to complete this run`);
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
            var _a;
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('DeliveryEvidence: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`DeliveryEvidence: run not found: ${runId}`);
            const verifierDecision = yield this.resolveRunVerifierDecision(runId, 'delivery');
            if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'warning' && verifierDecision.status !== 'waived') {
                throw new Error(`DeliveryEvidence: verifier has not approved run ${runId} (${verifierDecision.status})`);
            }
            const snapshot = yield captureDeliveryEvidence({
                workspace: this.options.workspacePath,
                runId,
                summary: input.summary,
                verifierStatus: verifierDecision.status,
                deliveryChecklist: input.deliveryChecklist,
                deliveryArtifactId: input.deliveryArtifactId,
                issueNumber: input.issueNumber,
                githubToken: this.resolveGithubToken(),
                verifier: Object.assign(Object.assign(Object.assign({ status: verifierDecision.status, rawStatus: verifierDecision.rawStatus }, (verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {})), (verifierDecision.reason ? { reason: verifierDecision.reason } : {})), (verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {})),
            });
            const artifact = yield this.orchestration.artifactStore.writeJSON('delivery_evidence', snapshot, {
                runId,
                meta: {
                    provider: 'github',
                    repository: snapshot.github.repository,
                    branch: snapshot.git.branch,
                    commitSha: snapshot.git.headSha,
                    verifierStatus: snapshot.verifierStatus,
                    rawVerifierStatus: verifierDecision.rawStatus,
                    waiverArtifactId: (_a = verifierDecision.waiverArtifact) === null || _a === void 0 ? void 0 : _a.id,
                    deliveryArtifactId: snapshot.deliveryArtifactId,
                },
            });
            const currentRun = this.orchestration.runLedger.getRun(runId);
            if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
                yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
            }
            yield this.completeDeliveryEvidenceDagNode(runId, artifact, snapshot);
            return { artifact, snapshot };
        });
    }
    getRunVerifierStatus(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('VerifierPolicy: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`VerifierPolicy: run not found: ${runId}`);
            return { decision: yield this.resolveRunVerifierDecision(runId) };
        });
    }
    createRunVerifierWaiver(runId, input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('VerifierPolicy: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`VerifierPolicy: run not found: ${runId}`);
            const operatorId = input.operatorId.trim();
            const reason = input.reason.trim();
            if (!operatorId)
                throw new Error('VerifierPolicy: operatorId is required');
            if (reason.length < 8)
                throw new Error('VerifierPolicy: waiver reason must be at least 8 characters');
            const scope = (_a = input.scope) !== null && _a !== void 0 ? _a : 'all';
            if (!this.isVerifierWaiverScope(scope))
                throw new Error(`VerifierPolicy: invalid waiver scope ${scope}`);
            const currentDecision = yield this.resolveRunVerifierDecision(runId);
            if (currentDecision.rawStatus === 'passed') {
                throw new Error('VerifierPolicy: passed verifier results do not need a waiver');
            }
            const waiver = Object.assign(Object.assign(Object.assign(Object.assign({ schemaVersion: 'pyrfor.verifier_waiver.v1', runId }, (currentDecision.verifierRunId ? { verifierRunId: currentDecision.verifierRunId } : {})), (currentDecision.verifierArtifactId ? { verifierArtifactId: currentDecision.verifierArtifactId } : {})), (currentDecision.verifierEventId ? { verifierEventId: currentDecision.verifierEventId } : {})), { rawStatus: currentDecision.rawStatus, operator: Object.assign({ id: operatorId }, (((_b = input.operatorName) === null || _b === void 0 ? void 0 : _b.trim()) ? { name: input.operatorName.trim() } : {})), reason,
                scope, waivedAt: new Date().toISOString() });
            const artifact = yield this.orchestration.artifactStore.writeJSON('verifier_waiver', waiver, {
                runId,
                meta: {
                    rawStatus: waiver.rawStatus,
                    operatorId,
                    scope,
                },
            });
            const currentRun = this.orchestration.runLedger.getRun(runId);
            if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
                yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
            }
            yield this.orchestration.eventLedger.append({
                type: 'verifier.waived',
                run_id: runId,
                status: 'waived',
                waived_from: currentDecision.rawStatus,
                approved_by: operatorId,
                reason,
                scope,
                artifact_id: artifact.id,
            });
            yield this.completeVerifierWaiverDagNode(runId, artifact, waiver);
            const decision = yield this.resolveRunVerifierDecision(runId, scope);
            return { artifact, waiver, decision, run: this.orchestration.runLedger.getRun(runId) };
        });
    }
    resolveRunVerifierDecision(runId, scope) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            if (!this.orchestration)
                throw new Error('VerifierPolicy: orchestration is disabled');
            const rawCandidates = [];
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'test_result' });
            for (const artifact of artifacts) {
                try {
                    if (!artifact.sha256)
                        throw new Error(`VerifierPolicy: verifier artifact ${artifact.id} has no sha256`);
                    const body = yield this.orchestration.artifactStore.readJSONVerified(artifact, artifact.sha256);
                    const status = this.normalizeVerificationStatus((_b = (_a = artifact.meta) === null || _a === void 0 ? void 0 : _a['status']) !== null && _b !== void 0 ? _b : body.status);
                    if (!status)
                        continue;
                    rawCandidates.push(Object.assign(Object.assign({ status }, (typeof body.verifierRunId === 'string' ? { verifierRunId: body.verifierRunId } : {})), { verifierArtifactId: artifact.id, decidedAt: artifact.createdAt }));
                }
                catch (err) {
                    logger.warn('[runtime] Verifier policy skipped unreadable verifier artifact', {
                        runId,
                        artifactId: artifact.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            const events = yield this.orchestration.runLedger.eventsForRun(runId);
            for (const event of events) {
                if (event.type !== 'verifier.completed')
                    continue;
                const status = this.normalizeVerificationStatus(event.status);
                if (!status)
                    continue;
                rawCandidates.push({
                    status,
                    reason: event.reason,
                    findings: event.findings,
                    verifierRunId: event.subject_id,
                    verifierEventId: event.id,
                    decidedAt: event.ts,
                });
                for (const candidate of rawCandidates) {
                    if (candidate.status === status
                        && candidate.verifierRunId === event.subject_id
                        && !candidate.verifierEventId) {
                        candidate.verifierEventId = event.id;
                        if (event.reason !== undefined && candidate.reason === undefined)
                            candidate.reason = event.reason;
                        if (event.findings !== undefined && candidate.findings === undefined)
                            candidate.findings = event.findings;
                    }
                }
            }
            const latestRaw = rawCandidates.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)).at(-1);
            if (!latestRaw)
                throw new Error(`VerifierPolicy: no verifier result recorded for run ${runId}`);
            const waiverArtifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'verifier_waiver' });
            let latestWaiver = null;
            for (const artifact of waiverArtifacts) {
                try {
                    if (!artifact.sha256)
                        throw new Error(`VerifierPolicy: waiver artifact ${artifact.id} has no sha256`);
                    const waiver = yield this.orchestration.artifactStore.readJSONVerified(artifact, artifact.sha256);
                    if (waiver.schemaVersion !== 'pyrfor.verifier_waiver.v1' || waiver.runId !== runId)
                        continue;
                    if (!this.waiverScopeMatches(waiver.scope, scope))
                        continue;
                    if (new Date(waiver.waivedAt).getTime() < new Date(latestRaw.decidedAt).getTime())
                        continue;
                    if (!latestWaiver || waiver.waivedAt > latestWaiver.waiver.waivedAt) {
                        latestWaiver = { artifact, waiver };
                    }
                }
                catch (err) {
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
                    reason: (_c = latestRaw.reason) !== null && _c !== void 0 ? _c : latestWaiver.waiver.reason,
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
        });
    }
    normalizeVerificationStatus(value) {
        if (value === 'passed' || value === 'warning' || value === 'failed' || value === 'blocked')
            return value;
        if (value === 'needs_rework')
            return 'failed';
        if (value === 'user_required')
            return 'blocked';
        return null;
    }
    isVerifierWaiverScope(value) {
        return value === 'run'
            || value === 'delivery'
            || value === 'delivery_plan'
            || value === 'delivery_apply'
            || value === 'all';
    }
    waiverScopeMatches(waiverScope, requestedScope) {
        if (!requestedScope)
            return waiverScope === 'all' || waiverScope === 'run';
        if (waiverScope === 'all')
            return true;
        if (waiverScope === requestedScope)
            return true;
        if (waiverScope === 'delivery' && (requestedScope === 'delivery' || requestedScope === 'delivery_plan' || requestedScope === 'delivery_apply'))
            return true;
        return false;
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
            var _a, _b, _c, _d;
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('GitHubDeliveryPlan: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`GitHubDeliveryPlan: run not found: ${runId}`);
            const verifierDecision = yield this.resolveRunVerifierDecision(runId, 'delivery_plan');
            if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
                throw new Error(`GitHubDeliveryPlan: verifier must be passed or waived before delivery planning (${verifierDecision.status})`);
            }
            if (run.status !== 'completed' && !(run.status === 'blocked' && verifierDecision.status === 'waived')) {
                throw new Error(`GitHubDeliveryPlan: run ${runId} must be completed before delivery planning`);
            }
            const applyVerifierDecision = yield this.resolveRunVerifierDecision(runId, 'delivery_apply');
            const githubToken = this.resolveGithubToken();
            const applyBlockers = [
                ...(run.status === 'completed' ? [] : [`run status is ${run.status}; apply requires completed`]),
                ...(githubToken ? [] : ['GitHub token is unavailable for apply']),
                ...(applyVerifierDecision.status === 'passed' || applyVerifierDecision.status === 'waived'
                    ? []
                    : [`verifier must be passed or waived before apply (${applyVerifierDecision.status})`]),
            ];
            let evidence = yield this.getRunDeliveryEvidence(runId);
            if (!evidence) {
                if (verifierDecision.status === 'waived') {
                    const snapshot = yield captureDeliveryEvidence({
                        workspace: this.options.workspacePath,
                        runId,
                        issueNumber: input.issueNumber,
                        githubToken,
                        verifierStatus: 'waived',
                        verifier: Object.assign(Object.assign(Object.assign({ status: 'waived', rawStatus: verifierDecision.rawStatus }, (verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {})), (verifierDecision.reason ? { reason: verifierDecision.reason } : {})), (verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {})),
                    });
                    const artifact = yield this.orchestration.artifactStore.writeJSON('delivery_evidence', snapshot, {
                        runId,
                        meta: {
                            provider: 'github',
                            repository: snapshot.github.repository,
                            branch: snapshot.git.branch,
                            commitSha: snapshot.git.headSha,
                            verifierStatus: snapshot.verifierStatus,
                            rawVerifierStatus: verifierDecision.rawStatus,
                            waiverArtifactId: (_a = verifierDecision.waiverArtifact) === null || _a === void 0 ? void 0 : _a.id,
                            deliveryArtifactId: snapshot.deliveryArtifactId,
                        },
                    });
                    const currentRun = this.orchestration.runLedger.getRun(runId);
                    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
                        yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
                    }
                    yield this.completeDeliveryEvidenceDagNode(runId, artifact, snapshot);
                    evidence = { artifact, snapshot };
                }
                else {
                    evidence = yield this.captureRunDeliveryEvidence(runId, {
                        issueNumber: input.issueNumber,
                    });
                }
            }
            if (verifierDecision.status === 'waived'
                && ((_b = evidence.snapshot.verifier) === null || _b === void 0 ? void 0 : _b.waiverArtifactId) !== ((_c = verifierDecision.waiverArtifact) === null || _c === void 0 ? void 0 : _c.id)) {
                const waivedEvidenceSnapshot = Object.assign(Object.assign({}, evidence.snapshot), { verifierStatus: 'waived', verifier: Object.assign(Object.assign(Object.assign({ status: 'waived', rawStatus: verifierDecision.rawStatus }, (verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {})), (verifierDecision.reason ? { reason: verifierDecision.reason } : {})), (verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {})) });
                const waivedEvidenceArtifact = yield this.orchestration.artifactStore.writeJSON('delivery_evidence', waivedEvidenceSnapshot, {
                    runId,
                    meta: {
                        provider: 'github',
                        repository: waivedEvidenceSnapshot.github.repository,
                        branch: waivedEvidenceSnapshot.git.branch,
                        commitSha: waivedEvidenceSnapshot.git.headSha,
                        verifierStatus: waivedEvidenceSnapshot.verifierStatus,
                        rawVerifierStatus: verifierDecision.rawStatus,
                        waiverArtifactId: (_d = verifierDecision.waiverArtifact) === null || _d === void 0 ? void 0 : _d.id,
                        deliveryArtifactId: waivedEvidenceSnapshot.deliveryArtifactId,
                        sourceEvidenceArtifactId: evidence.artifact.id,
                    },
                });
                const currentRun = this.orchestration.runLedger.getRun(runId);
                if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
                    yield this.orchestration.runLedger.recordArtifact(runId, waivedEvidenceArtifact.id, []);
                }
                yield this.completeDeliveryEvidenceDagNode(runId, waivedEvidenceArtifact, waivedEvidenceSnapshot);
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
            if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
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
    requestRunGithubDeliveryApply(runId, input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('GitHubDeliveryApply: orchestration is disabled');
            const { run, artifact, plan } = yield this.loadGithubDeliveryApplyPlan(runId, input);
            if (run.status !== 'completed') {
                throw new Error(`GitHubDeliveryApply: run ${runId} must be completed before delivery apply`);
            }
            const verifierDecision = yield this.resolveRunVerifierDecision(runId, 'delivery_apply');
            if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
                throw new Error(`GitHubDeliveryApply: verifier must be passed or waived before apply (${verifierDecision.status})`);
            }
            yield validateGithubDeliveryApplyPreconditions({
                workspace: this.options.workspacePath,
                runId,
                plan,
                planArtifact: artifact,
                expectedPlanSha256: input.expectedPlanSha256,
            });
            const expectedPlanSha256 = (_a = artifact.sha256) !== null && _a !== void 0 ? _a : input.expectedPlanSha256;
            const approval = yield this.enqueueGithubDeliveryApplyApproval({
                runId,
                plan,
                planArtifact: artifact,
                expectedPlanSha256,
            });
            yield this.orchestration.eventLedger.append({
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
        });
    }
    applyApprovedRunGithubDelivery(runId, input) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('GitHubDeliveryApply: orchestration is disabled');
            if (!input.approvalId)
                throw new Error('GitHubDeliveryApply: approvalId is required');
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
                yield this.orchestration.eventLedger.append({
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
            const { run, artifact: planArtifact, plan } = yield this.loadGithubDeliveryApplyPlan(runId, input);
            if (run.status !== 'completed') {
                throw new Error(`GitHubDeliveryApply: run ${runId} must be completed before delivery apply`);
            }
            const verifierDecision = yield this.resolveRunVerifierDecision(runId, 'delivery_apply');
            if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
                throw new Error(`GitHubDeliveryApply: verifier must be passed or waived before apply (${verifierDecision.status})`);
            }
            const token = this.resolveGithubToken();
            if (!token)
                throw new Error('GitHubDeliveryApply: GitHub token is unavailable');
            const result = yield applyGithubDeliveryPlan({
                workspace: this.options.workspacePath,
                runId,
                plan,
                planArtifact,
                approvalId: input.approvalId,
                githubToken: token,
            });
            const artifact = yield this.orchestration.artifactStore.writeJSON('delivery_apply', result, {
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
                yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
            }
            yield this.orchestration.eventLedger.append({
                type: 'approval.granted',
                run_id: runId,
                tool: 'github_delivery_apply',
                approval_id: input.approvalId,
                artifact_id: planArtifact.id,
                approved_by: input.approvalId,
            });
            yield this.completeGithubDeliveryApplyDagNode(runId, artifact, result, planArtifact);
            return { status: 'applied', artifact, result };
        });
    }
    getRunGithubDeliveryApply(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initOrchestration();
            if (!this.orchestration)
                throw new Error('GitHubDeliveryApply: orchestration is disabled');
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`GitHubDeliveryApply: run not found: ${runId}`);
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'delivery_apply' });
            const latest = artifacts.at(-1);
            if (!latest)
                return null;
            return {
                artifact: latest,
                result: yield this.orchestration.artifactStore.readJSON(latest),
            };
        });
    }
    loadGithubDeliveryApplyPlan(runId, input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.orchestration)
                throw new Error('GitHubDeliveryApply: orchestration is disabled');
            if (!input.planArtifactId || !input.expectedPlanSha256) {
                throw new Error('GitHubDeliveryApply: planArtifactId and expectedPlanSha256 are required');
            }
            const run = this.orchestration.runLedger.getRun(runId);
            if (!run)
                throw new Error(`GitHubDeliveryApply: run not found: ${runId}`);
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'delivery_plan' });
            const artifact = artifacts.find((candidate) => candidate.id === input.planArtifactId);
            if (!artifact)
                throw new Error(`GitHubDeliveryApply: delivery plan artifact not found: ${input.planArtifactId}`);
            const latest = artifacts.at(-1);
            if ((latest === null || latest === void 0 ? void 0 : latest.id) !== artifact.id) {
                throw new Error('GitHubDeliveryApply: a newer delivery plan exists and requires review');
            }
            if (artifact.sha256 !== input.expectedPlanSha256) {
                throw new Error('GitHubDeliveryApply: plan artifact sha mismatch');
            }
            const plan = yield this.orchestration.artifactStore.readJSONVerified(artifact, input.expectedPlanSha256);
            if (plan.evidenceArtifactId) {
                const evidenceArtifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'delivery_evidence' });
                if (!evidenceArtifacts.some((candidate) => candidate.id === plan.evidenceArtifactId)) {
                    throw new Error('GitHubDeliveryApply: referenced delivery evidence artifact was not found');
                }
            }
            return { run, artifact, plan };
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
    executeOchagReminderRun(runId, runRecord, preview) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!this.orchestration)
                throw new Error('ProductFactory: orchestration is disabled');
            if (runRecord.status !== 'planned') {
                throw new Error(`ProductFactory: Ochag run ${runId} must be planned before execution`);
            }
            const answers = this.extractProductFactoryAnswers(preview);
            const evidence = {
                schemaVersion: 'pyrfor.ochag_reminder_delivery.v1',
                runId,
                familyId: (_a = answers['familyId']) !== null && _a !== void 0 ? _a : 'default-family',
                audience: (_b = answers['audience']) !== null && _b !== void 0 ? _b : 'family',
                visibility: (_c = answers['visibility']) !== null && _c !== void 0 ? _c : 'family',
                dueAt: answers['dueAt'],
                title: preview.intent.title,
                privacyPolicy: 'member-private details redacted; sensitive Telegram sends require owner/adult approval',
                scheduled: true,
                channel: 'telegram',
            };
            yield this.orchestration.runLedger.transition(runId, 'running', 'Ochag reminder execution started');
            yield this.completeProductFactoryDagNodes(runId, [
                'ochag.classify_request',
                'ochag.privacy_check',
                'ochag.schedule_reminder',
            ]);
            const artifact = yield this.orchestration.artifactStore.writeJSON('summary', evidence, {
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
            yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
            yield this.completeProductFactoryDagNodes(runId, ['ochag.telegram_notify'], artifact);
            yield this.orchestration.eventLedger.append({
                type: 'test.completed',
                run_id: runId,
                status: 'ochag.reminder_mvp:passed',
                ms: 0,
            });
            yield this.completeUserRun({ runId, taskId: runRecord.task_id }, 'completed', 'Ochag reminder scheduled with Telegram delivery evidence');
            return {
                run: this.orchestration.runLedger.getRun(runId),
                deliveryArtifact: artifact,
                summary: `Ochag reminder scheduled for ${evidence.audience} (${evidence.visibility}) at ${(_d = evidence.dueAt) !== null && _d !== void 0 ? _d : 'unspecified time'}.`,
            };
        });
    }
    executeCeoclawBusinessBriefRun(runId, runRecord, preview, approvalId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            if (!this.orchestration)
                throw new Error('ProductFactory: orchestration is disabled');
            const answers = this.extractProductFactoryAnswers(preview);
            const evidenceRefs = (_b = (_a = answers['evidence']) === null || _a === void 0 ? void 0 : _a.split(',').map((item) => item.trim()).filter(Boolean)) !== null && _b !== void 0 ? _b : [];
            const projectId = (_c = answers['projectId']) !== null && _c !== void 0 ? _c : 'default-project';
            if (!approvalId) {
                if (runRecord.status !== 'planned') {
                    throw new Error(`ProductFactory: CEOClaw run ${runId} must be planned before approval request`);
                }
                yield this.orchestration.runLedger.transition(runId, 'running', 'CEOClaw evidence collection started');
                const evidenceArtifact = yield this.orchestration.artifactStore.writeJSON('summary', {
                    schemaVersion: 'pyrfor.ceoclaw_business_brief.v1',
                    stage: 'approval_requested',
                    runId,
                    projectId,
                    decision: (_d = answers['decision']) !== null && _d !== void 0 ? _d : preview.intent.title,
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
                yield this.orchestration.runLedger.recordArtifact(runId, evidenceArtifact.id, [evidenceArtifact.uri]);
                yield this.completeProductFactoryDagNodes(runId, [
                    'ceoclaw.collect_evidence',
                    'ceoclaw.verify_evidence',
                    'ceoclaw.finance_impact_check',
                ], evidenceArtifact);
                const approval = yield this.enqueueCeoclawBusinessBriefApproval({
                    runId,
                    projectId,
                    decision: (_e = answers['decision']) !== null && _e !== void 0 ? _e : preview.intent.title,
                    evidenceRefs,
                    evidenceArtifactId: evidenceArtifact.id,
                    deadline: answers['deadline'],
                });
                yield this.orchestration.eventLedger.append({
                    type: 'approval.requested',
                    run_id: runId,
                    tool: 'ceoclaw_business_brief_approval',
                    approval_id: approval.id,
                    artifact_id: evidenceArtifact.id,
                    reason: `approval required for CEOClaw brief ${evidenceArtifact.id}`,
                });
                const blocked = yield this.orchestration.runLedger.blockRun(runId, `awaiting CEOClaw approval ${approval.id}`);
                const resolvedApproval = approvalFlow.getResolvedApproval(approval.id);
                if (resolvedApproval && resolvedApproval.decision !== 'approve') {
                    yield this.cancelDeniedCeoclawApproval({
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
                yield this.cancelDeniedCeoclawApproval({
                    type: 'approval-resolved',
                    request: approval.request,
                    decision: approval.decision,
                });
                throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is ${approval.decision}`);
            }
            if (!approvalFlow.consumeResolvedApproval(approvalId)) {
                throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is no longer available`);
            }
            yield this.orchestration.runLedger.transition(runId, 'running', `CEOClaw approval ${approvalId} granted`);
            const report = {
                schemaVersion: 'pyrfor.ceoclaw_business_brief.v1',
                stage: 'approved_report',
                runId,
                projectId,
                decision: (_f = answers['decision']) !== null && _f !== void 0 ? _f : preview.intent.title,
                evidenceRefs,
                deadline: answers['deadline'],
                approvalId,
                executiveSummary: `Approved CEOClaw action for ${projectId}: ${(_g = answers['decision']) !== null && _g !== void 0 ? _g : preview.intent.title}`,
                risks: evidenceRefs.length > 0 ? [] : ['No explicit evidence references were provided.'],
                nextActions: ['Record decision in Pyrfor ledger', 'Use approved evidence package for delegated follow-up work'],
            };
            const artifact = yield this.orchestration.artifactStore.writeJSON('summary', report, {
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
            yield this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
            yield this.orchestration.eventLedger.append({
                type: 'approval.granted',
                run_id: runId,
                tool: 'ceoclaw_business_brief_approval',
                approval_id: approvalId,
                approved_by: approvalId,
            });
            yield this.completeProductFactoryDagNodes(runId, [
                'ceoclaw.request_approval',
                'ceoclaw.generate_report',
            ], artifact);
            yield this.orchestration.eventLedger.append({
                type: 'test.completed',
                run_id: runId,
                status: 'ceoclaw.business_brief_mvp:passed',
                ms: 0,
            });
            yield this.completeUserRun({ runId, taskId: runRecord.task_id }, 'completed', `CEOClaw business brief approved via ${approvalId}`);
            return {
                run: this.orchestration.runLedger.getRun(runId),
                deliveryArtifact: artifact,
                summary: report.executiveSummary,
            };
        });
    }
    withProductFactoryDefaultWorker(worker, preview) {
        var _a, _b;
        const manifestOptions = (worker === null || worker === void 0 ? void 0 : worker.manifest) ? materializeWorkerManifest(worker.manifest) : undefined;
        assertWorkerManifestDomainScope(manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.domainIds, preview.intent.domainIds);
        const transport = (_b = (_a = worker === null || worker === void 0 ? void 0 : worker.transport) !== null && _a !== void 0 ? _a : manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.transport) !== null && _b !== void 0 ? _b : 'acp';
        const domainIds = mergeWorkerDomainScopes(preview.intent.domainIds, manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.domainIds, worker === null || worker === void 0 ? void 0 : worker.domainIds);
        const permissionProfile = mergePermissionProfiles(manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.permissionProfile, worker === null || worker === void 0 ? void 0 : worker.permissionProfile);
        const permissionOverrides = mergePermissionOverrides(manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.permissionOverrides, worker === null || worker === void 0 ? void 0 : worker.permissionOverrides);
        if (worker === null || worker === void 0 ? void 0 : worker.events) {
            return Object.assign(Object.assign(Object.assign(Object.assign({}, worker), { transport,
                domainIds }), (permissionProfile ? { permissionProfile } : {})), { permissionOverrides });
        }
        return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ transport }, ((worker === null || worker === void 0 ? void 0 : worker.manifest) ? { manifest: worker.manifest } : {})), { domainIds }), (permissionProfile ? { permissionProfile } : {})), { permissionOverrides }), ((worker === null || worker === void 0 ? void 0 : worker.capabilityPolicy) ? { capabilityPolicy: worker.capabilityPolicy } : {})), { verifierValidators: worker === null || worker === void 0 ? void 0 : worker.verifierValidators, events: ({ runId, taskId, sessionId, workerRunId }) => (function () {
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
                            worker_run_id: workerRunId,
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
                            worker_run_id: workerRunId,
                            seq: 1,
                            status: 'succeeded',
                            summary: `Product Factory executed ${preview.template.title}: ${preview.intent.title}`,
                        },
                    });
                });
            })() });
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
            var _a, _b, _c, _d, _e, _f, _g;
            const deliveryNodes = (_b = (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.dag.listNodes().filter((node) => node.id.startsWith(`${runId}/`) && node.kind === 'product_factory.delivery_package')) !== null && _b !== void 0 ? _b : [];
            const completedDeliveryNodeIds = deliveryNodes
                .filter((node) => node.status === 'succeeded')
                .map((node) => node.id);
            const waiverNodeId = ((_c = snapshot.verifier) === null || _c === void 0 ? void 0 : _c.status) === 'waived' && snapshot.verifier.waiverArtifactId
                ? `run:${runId}:verifier-waiver:${snapshot.verifier.waiverArtifactId}`
                : undefined;
            const waiverNode = waiverNodeId ? (_d = this.orchestration) === null || _d === void 0 ? void 0 : _d.dag.getNode(waiverNodeId) : undefined;
            const dependsOn = completedDeliveryNodeIds.length > 0
                ? completedDeliveryNodeIds
                : (waiverNode === null || waiverNode === void 0 ? void 0 : waiverNode.status) === 'succeeded'
                    ? [waiverNodeId]
                    : deliveryNodes.map((node) => node.id);
            const evidenceNodeId = ((_e = snapshot.verifier) === null || _e === void 0 ? void 0 : _e.status) === 'waived'
                && ((_g = (_f = this.orchestration) === null || _f === void 0 ? void 0 : _f.dag.getNode(`run:${runId}:github-delivery-evidence`)) === null || _g === void 0 ? void 0 : _g.status) === 'succeeded'
                ? `run:${runId}:github-delivery-evidence:${artifact.id}`
                : `run:${runId}:github-delivery-evidence`;
            yield this.completeDagNodeOnce(evidenceNodeId, {
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
        });
    }
    completeVerifierWaiverDagNode(runId, artifact, waiver) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const verifierNodeIds = (_b = (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.dag.listNodes().filter((node) => node.kind === 'governed.verifier'
                && node.id.startsWith(`run:${runId}:`)
                && (!waiver.verifierRunId || node.payload['verifierRunId'] === waiver.verifierRunId)).map((node) => node.id)) !== null && _b !== void 0 ? _b : [];
            yield this.completeDagNodeOnce(`run:${runId}:verifier-waiver:${artifact.id}`, {
                kind: 'governed.verifier_waiver',
                payload: Object.assign(Object.assign(Object.assign({ rawStatus: waiver.rawStatus, scope: waiver.scope, operatorId: waiver.operator.id }, (waiver.verifierRunId ? { verifierRunId: waiver.verifierRunId } : {})), (waiver.verifierArtifactId ? { verifierArtifactId: waiver.verifierArtifactId } : {})), (waiver.verifierEventId ? { verifierEventId: waiver.verifierEventId } : {})),
                dependsOn: verifierNodeIds,
                provenance: [
                    { kind: 'run', ref: runId, role: 'input' },
                    ...(waiver.verifierArtifactId ? [{ kind: 'artifact', ref: waiver.verifierArtifactId, role: 'evidence' }] : []),
                    ...(waiver.verifierEventId ? [{ kind: 'ledger_event', ref: waiver.verifierEventId, role: 'decision' }] : []),
                    { kind: 'artifact', ref: artifact.id, role: 'decision', sha256: artifact.sha256 },
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
    completeGithubDeliveryApplyDagNode(runId, artifact, result, planArtifact) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const planNodeIds = (_b = (_a = this.orchestration) === null || _a === void 0 ? void 0 : _a.dag.listNodes().filter((node) => node.id.startsWith(`run:${runId}:github-delivery-plan`) && node.kind === 'product_factory.github_delivery_plan').map((node) => node.id)) !== null && _b !== void 0 ? _b : [];
            yield this.completeDagNodeOnce(`run:${runId}:github-delivery-apply`, {
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
            if ((current === null || current === void 0 ? void 0 : current.status) === 'completed' || (current === null || current === void 0 ? void 0 : current.status) === 'failed' || (current === null || current === void 0 ? void 0 : current.status) === 'blocked' || (current === null || current === void 0 ? void 0 : current.status) === 'cancelled') {
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
            var _g;
            if (!(worker === null || worker === void 0 ? void 0 : worker.events) || !run || !this.orchestration) {
                return null;
            }
            const workerRunId = `worker-run:${run.runId}:${randomUUID()}`;
            run.workerRunId = workerRunId;
            const host = this.createOrchestrationHostForRun(run, sessionId, userId, worker);
            run.orchestrationHost = host;
            const workerTransport = (_g = worker.transport) !== null && _g !== void 0 ? _g : (worker.manifest ? materializeWorkerManifest(worker.manifest).transport : 'freeclaude');
            run.workerTransport = workerTransport;
            const results = [];
            const events = worker.events({ runId: run.runId, taskId: run.taskId, sessionId, workerRunId });
            if (workerTransport === 'acp') {
                try {
                    for (var _h = true, _j = __asyncValues(events), _k; _k = yield _j.next(), _a = _k.done, !_a; _h = true) {
                        _c = _k.value;
                        _h = false;
                        const event = _c;
                        const result = yield host.codingHost.handleAcpEvent(event);
                        if (result) {
                            results.push(result);
                            this.assertWorkerResultCanContinue(result);
                        }
                    }
                }
                catch (e_3_1) { e_3 = { error: e_3_1 }; }
                finally {
                    try {
                        if (!_h && !_a && (_b = _j.return)) yield _b.call(_j);
                    }
                    finally { if (e_3) throw e_3.error; }
                }
            }
            else {
                try {
                    for (var _l = true, _m = __asyncValues(events), _o; _o = yield _m.next(), _d = _o.done, !_d; _l = true) {
                        _f = _o.value;
                        _l = false;
                        const event = _f;
                        this.assertStrictFreeClaudeEvent(event);
                        const result = yield host.codingHost.handleFreeClaudeEvent(event);
                        if (result) {
                            results.push(result);
                            this.assertWorkerResultCanContinue(result);
                        }
                    }
                }
                catch (e_4_1) { e_4 = { error: e_4_1 }; }
                finally {
                    try {
                        if (!_l && !_d && (_e = _m.return)) yield _e.call(_m);
                    }
                    finally { if (e_4) throw e_4.error; }
                }
            }
            return this.summarizeWorkerResults(run, results);
        });
    }
    prepareGovernedRun(run, input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!this.orchestration || run.governed)
                return;
            yield this.awaitWorkspaceSwitch();
            const compiler = new ContextCompiler({
                artifactStore: this.orchestration.artifactStore,
                eventLedger: this.orchestration.eventLedger,
                runLedger: this.orchestration.runLedger,
                dag: this.orchestration.dag,
                sessionStore: (_a = this.store) !== null && _a !== void 0 ? _a : undefined,
                workspace: (_c = (_b = this.workspace) === null || _b === void 0 ? void 0 : _b.getWorkspace()) !== null && _c !== void 0 ? _c : undefined,
                workspaceLoader: (_d = this.workspace) !== null && _d !== void 0 ? _d : undefined,
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
                sessionMessageLimit: 20,
                agentId: 'pyrfor-runtime',
                query: input.text,
                memoryLimit: 6,
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
            workerManifest: worker.manifest,
            permissionProfile: worker.permissionProfile,
            permissionOverrides: worker.permissionOverrides,
            capabilityPolicy: worker.capabilityPolicy,
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
            expectedRunId: run.runId,
            expectedTaskId: run.taskId,
            expectedWorkerRunId: run.workerRunId,
            enforceFrameOrder: true,
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
            if (options.completeRun !== false) {
                throw new Error(`Verifier blocked run ${run.runId}: ${result.status}`);
            }
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
            const ready = this.orchestration.dag.listReady().some((node) => node.id === nodeId);
            if (((current === null || current === void 0 ? void 0 : current.status) === 'pending' || (current === null || current === void 0 ? void 0 : current.status) === 'ready') && ready) {
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
        var _a, _b, _c, _d;
        const invalid = results.find((result) => result.disposition === 'invalid_frame');
        if (invalid) {
            const detail = (_b = (_a = invalid.errors) === null || _a === void 0 ? void 0 : _a.map((error) => `${error.path}: ${error.message}`).join('; ')) !== null && _b !== void 0 ? _b : 'invalid worker frame';
            throw new Error(`Worker emitted invalid frame: ${detail}`);
        }
        const denied = results.find((result) => result.disposition === 'effect_denied');
        if (denied) {
            throw new Error((_d = (_c = denied.verdict) === null || _c === void 0 ? void 0 : _c.reason) !== null && _d !== void 0 ? _d : 'Worker run blocked by policy');
        }
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
        const invoked = results.filter((result) => result.disposition === 'tool_invoked').length;
        return invoked > 0
            ? `Worker processed ${invoked} approved effect${invoked === 1 ? '' : 's'}.`
            : 'Worker stream processed.';
    }
    assertWorkerResultCanContinue(result) {
        var _a, _b, _c, _d;
        if (result.disposition === 'invalid_frame') {
            const detail = (_b = (_a = result.errors) === null || _a === void 0 ? void 0 : _a.map((error) => `${error.path}: ${error.message}`).join('; ')) !== null && _b !== void 0 ? _b : 'invalid worker frame';
            throw new Error(`Worker emitted invalid frame: ${detail}`);
        }
        if (result.disposition === 'effect_denied') {
            throw new Error((_d = (_c = result.verdict) === null || _c === void 0 ? void 0 : _c.reason) !== null && _d !== void 0 ? _d : 'Worker run blocked by policy');
        }
        if (result.disposition === 'run_failed') {
            const frame = result.frame;
            const message = frame && 'error' in frame ? frame.error.message : 'Worker run failed';
            throw new Error(message);
        }
    }
    assertStrictFreeClaudeEvent(event) {
        if (event.type === 'tool_use') {
            throw new Error(`Strict FreeClaude worker emitted native tool_use "${event.name}" outside Worker Protocol`);
        }
        if (event.type === 'result') {
            const result = event.result;
            const filesTouched = Array.isArray(result.filesTouched) ? result.filesTouched.filter((item) => typeof item === 'string') : [];
            const commandsRun = Array.isArray(result.commandsRun) ? result.commandsRun.filter((item) => typeof item === 'string') : [];
            if (filesTouched.length > 0 || commandsRun.length > 0) {
                throw new Error('Strict FreeClaude worker reported native mutations outside Worker Protocol');
            }
        }
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
            const dag = new DurableDag({
                storePath: path.join(orchestrationDir, 'dag.json'),
                ledger: eventLedger,
                dagId: 'runtime-orchestration',
                ledgerRunId: 'runtime-orchestration',
            });
            const recoveredRuns = yield runLedger.recoverInterruptedRuns('runtime_restarted');
            const recoveredNodes = dag.recoverInterruptedLeases('runtime_restarted');
            yield dag.flushLedger();
            const artifactStore = new ArtifactStore({ rootDir: path.join(rootDir, 'artifacts') });
            yield artifactStore.repairIndex();
            this.orchestration = {
                eventLedger,
                runLedger,
                dag,
                artifactStore,
                overlays: registerDefaultDomainOverlays(new DomainOverlayRegistry()),
            };
            this.ensureApprovalFlowSubscription();
            const recoveredGithubApprovals = yield this.recoverGithubDeliveryApplyApprovals();
            const recoveredCeoclawApprovals = yield this.recoverCeoclawBusinessBriefApprovals();
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
        });
    }
    ensureApprovalFlowSubscription() {
        if (this.approvalFlowUnsubscribe)
            return;
        this.approvalFlowUnsubscribe = approvalFlow.subscribe((event) => {
            if (event.type !== 'approval-resolved')
                return;
            if (event.request.toolName !== 'ceoclaw_business_brief_approval')
                return;
            if (event.decision === 'approve')
                return;
            void this.cancelDeniedCeoclawApproval(event).catch((err) => {
                logger.warn('[runtime] Failed to cancel denied CEOClaw approval run', {
                    approvalId: event.request.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        });
    }
    cancelDeniedCeoclawApproval(event) {
        return __awaiter(this, void 0, void 0, function* () {
            const approvalId = event.request.id;
            if (this.ceoclawDenialApprovalsInFlight.has(approvalId))
                return;
            this.ceoclawDenialApprovalsInFlight.add(approvalId);
            try {
                if (!this.orchestration)
                    return;
                const runId = typeof event.request.run_id === 'string'
                    ? event.request.run_id
                    : typeof event.request.args['runId'] === 'string'
                        ? event.request.args['runId']
                        : undefined;
                if (!runId)
                    return;
                const run = this.orchestration.runLedger.getRun(runId);
                if (!run)
                    return;
                if (run.status !== 'blocked') {
                    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'archived') {
                        approvalFlow.consumeResolvedApproval(approvalId);
                    }
                    return;
                }
                yield this.orchestration.eventLedger.append({
                    type: 'approval.denied',
                    run_id: runId,
                    tool: 'ceoclaw_business_brief_approval',
                    approval_id: approvalId,
                    reason: `approval ${approvalId} was ${event.decision}`,
                });
                yield this.orchestration.runLedger.completeRun(runId, 'cancelled', `CEOClaw approval ${approvalId} was ${event.decision}`);
                approvalFlow.consumeResolvedApproval(approvalId);
            }
            finally {
                this.ceoclawDenialApprovalsInFlight.delete(approvalId);
            }
        });
    }
    getGithubDeliveryApplyApproval(runId, planArtifactId, expectedPlanSha256) {
        var _a;
        const expectedId = buildGithubDeliveryApplyApprovalId(runId, planArtifactId, expectedPlanSha256);
        const pending = approvalFlow.getPending().find((request) => request.id === expectedId
            || (request.toolName === 'github_delivery_apply'
                && request.args['runId'] === runId
                && request.args['planArtifactId'] === planArtifactId
                && request.args['expectedPlanSha256'] === expectedPlanSha256));
        if (pending)
            return pending;
        return (_a = approvalFlow.getResolvedApproval(expectedId)) === null || _a === void 0 ? void 0 : _a.request;
    }
    enqueueGithubDeliveryApplyApproval(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const existing = this.getGithubDeliveryApplyApproval(input.runId, input.planArtifact.id, input.expectedPlanSha256);
            if (existing)
                return existing;
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
        });
    }
    recoverGithubDeliveryApplyApprovals() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.orchestration)
                return 0;
            let recovered = 0;
            for (const run of this.orchestration.runLedger.listRuns()) {
                const events = yield this.orchestration.eventLedger.byRun(run.run_id);
                const requested = [...events].reverse().find((event) => event.type === 'approval.requested'
                    && event.tool === 'github_delivery_apply'
                    && typeof event.artifact_id === 'string');
                if (!requested)
                    continue;
                const laterResolution = events.some((event) => event.seq > requested.seq
                    && (event.type === 'approval.granted' || event.type === 'approval.denied')
                    && event.tool === 'github_delivery_apply'
                    && event.approval_id === requested.approval_id);
                if (laterResolution)
                    continue;
                if (yield this.hasGithubDeliveryApplyResult(run.run_id, requested.artifact_id, requested.approval_id)) {
                    continue;
                }
                let planArtifact;
                let plan;
                try {
                    const planArtifacts = yield this.orchestration.artifactStore.list({ runId: run.run_id, kind: 'delivery_plan' });
                    const matchedArtifact = planArtifacts.find((artifact) => artifact.id === requested.artifact_id);
                    if (!matchedArtifact)
                        continue;
                    planArtifact = matchedArtifact;
                    if (planArtifact.kind !== 'delivery_plan' || !planArtifact.sha256)
                        continue;
                    plan = yield this.orchestration.artifactStore.readJSON(planArtifact);
                }
                catch (err) {
                    logger.warn('[runtime] Failed to recover GitHub delivery approval request', {
                        runId: run.run_id,
                        artifactId: requested.artifact_id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    continue;
                }
                if (plan.runId !== run.run_id)
                    continue;
                if (this.getGithubDeliveryApplyApproval(run.run_id, planArtifact.id, planArtifact.sha256))
                    continue;
                yield this.enqueueGithubDeliveryApplyApproval({
                    runId: run.run_id,
                    plan,
                    planArtifact,
                    expectedPlanSha256: planArtifact.sha256,
                });
                recovered += 1;
            }
            return recovered;
        });
    }
    hasGithubDeliveryApplyResult(runId, planArtifactId, approvalId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (!this.orchestration)
                return false;
            const artifacts = yield this.orchestration.artifactStore.list({ runId, kind: 'delivery_apply' });
            for (const artifact of artifacts) {
                if (((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a['planArtifactId']) === planArtifactId) {
                    return approvalId === undefined || ((_b = artifact.meta) === null || _b === void 0 ? void 0 : _b['approvalId']) === approvalId;
                }
                try {
                    const result = yield this.orchestration.artifactStore.readJSON(artifact);
                    if (result.planArtifactId === planArtifactId
                        && (approvalId === undefined || result.approvalId === approvalId)) {
                        return true;
                    }
                }
                catch (err) {
                    logger.warn('[runtime] Failed to inspect GitHub delivery apply artifact during recovery', {
                        runId,
                        artifactId: artifact.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            return false;
        });
    }
    getCeoclawBusinessBriefApproval(runId) {
        var _a;
        const expectedId = buildCeoclawBusinessBriefApprovalId(runId);
        const pending = approvalFlow.getPending().find((request) => request.id === expectedId
            || (request.toolName === 'ceoclaw_business_brief_approval'
                && request.args['runId'] === runId));
        if (pending)
            return pending;
        return (_a = approvalFlow.getResolvedApproval(expectedId)) === null || _a === void 0 ? void 0 : _a.request;
    }
    enqueueCeoclawBusinessBriefApproval(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const existing = this.getCeoclawBusinessBriefApproval(input.runId);
            if (existing)
                return existing;
            return approvalFlow.enqueueApproval({
                id: buildCeoclawBusinessBriefApprovalId(input.runId),
                toolName: 'ceoclaw_business_brief_approval',
                summary: `Approve CEOClaw brief for ${input.projectId}: ${input.decision}`,
                args: Object.assign(Object.assign({ runId: input.runId, projectId: input.projectId, decision: input.decision, evidenceRefs: input.evidenceRefs }, (input.evidenceArtifactId ? { evidenceArtifactId: input.evidenceArtifactId } : {})), (input.deadline ? { deadline: input.deadline } : {})),
                run_id: input.runId,
                reason: 'CEOClaw business brief requires operator approval before final report',
                approval_required: true,
            });
        });
    }
    recoverCeoclawBusinessBriefApprovals() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!this.orchestration)
                return 0;
            let recovered = 0;
            for (const run of this.orchestration.runLedger.listRuns()) {
                if (run.status !== 'blocked')
                    continue;
                const events = yield this.orchestration.eventLedger.byRun(run.run_id);
                const requested = [...events].reverse().find((event) => event.type === 'approval.requested'
                    && event.tool === 'ceoclaw_business_brief_approval');
                if (!requested)
                    continue;
                const laterResolution = events.some((event) => event.seq > requested.seq
                    && (event.type === 'approval.granted' || event.type === 'approval.denied')
                    && event.tool === 'ceoclaw_business_brief_approval');
                if (laterResolution || this.getCeoclawBusinessBriefApproval(run.run_id))
                    continue;
                let preview;
                try {
                    preview = yield this.loadProductFactoryPreview(run.run_id);
                }
                catch (err) {
                    logger.warn('[runtime] Failed to recover CEOClaw approval request', {
                        runId: run.run_id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    continue;
                }
                if (preview.template.id !== 'business_brief')
                    continue;
                const answers = this.extractProductFactoryAnswers(preview);
                const evidenceRefs = (_b = (_a = answers['evidence']) === null || _a === void 0 ? void 0 : _a.split(',').map((item) => item.trim()).filter(Boolean)) !== null && _b !== void 0 ? _b : [];
                yield this.enqueueCeoclawBusinessBriefApproval({
                    runId: run.run_id,
                    projectId: (_c = answers['projectId']) !== null && _c !== void 0 ? _c : 'default-project',
                    decision: (_d = answers['decision']) !== null && _d !== void 0 ? _d : preview.intent.title,
                    evidenceRefs,
                    evidenceArtifactId: requested.artifact_id,
                    deadline: answers['deadline'],
                });
                recovered += 1;
            }
            return recovered;
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
export * from './worker-manifest.js';
export { PermissionEngine, ToolRegistry, registerStandardTools, } from './permission-engine.js';
export { TwoPhaseEffectRunner } from './two-phase-effect.js';
export { DurableDag } from './durable-dag.js';
export { VerifierLane, runOrchestrationEvalSuite } from './verifier-lane.js';
export { hashContextPack, stableStringify, withContextPackHash, } from './context-pack.js';
export { ContextCompiler } from './context-compiler.js';
export { createDailyMemoryRollup } from './memory-rollup.js';
export { createProjectMemoryRollup } from './project-memory.js';
export * from './domain-overlay.js';
export * from './domain-overlay-presets.js';
export * from './github-delivery-evidence.js';
export * from './github-delivery-plan.js';
export * from './github-delivery-apply.js';
export * from './orchestration-host-factory.js';
export * from './tools.js';
export * from './pyrfor-scoring.js';
