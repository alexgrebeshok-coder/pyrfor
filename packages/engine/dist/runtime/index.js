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
import { SessionManager } from './session';
import { SessionStore, reviveSession } from './session-store';
import { ProviderRouter } from './provider-router';
import { AutoCompact } from './compact';
import { SubagentSpawner } from './subagents';
import { PrivacyManager } from './privacy';
import { WorkspaceLoader } from './workspace-loader';
import { executeRuntimeTool, setTelegramBot, setWorkspaceRoot, runtimeToolDefinitions } from './tools';
import { runToolLoop } from './tool-loop';
import { logger } from '../observability/logger';
// ============================================
// Main Runtime Class
// ============================================
export class PyrforRuntime {
    constructor(options = {}) {
        var _a, _b, _c, _d;
        this.workspace = null;
        this.store = null;
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
    /**
     * Start all services
     */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.started) {
                logger.warn('Runtime already started');
                return;
            }
            // Load workspace
            const workspaceOptions = {
                workspacePath: this.options.workspacePath,
                memoryPath: this.options.memoryPath,
            };
            this.workspace = new WorkspaceLoader(workspaceOptions);
            yield this.workspace.load();
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
            this.started = true;
            logger.info('PyrforRuntime started');
        });
    }
    /**
     * Graceful shutdown
     */
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.started)
                return;
            // Dispose workspace watcher
            (_a = this.workspace) === null || _a === void 0 ? void 0 : _a.dispose();
            // Flush pending session writes before exit. Do NOT cleanup(0) — that would
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
                this.store.close();
            }
            this.subagents.cleanup(0);
            this.started = false;
            logger.info('PyrforRuntime stopped');
        });
    }
    /**
     * Main entry point: handle incoming message
     */
    handleMessage(channel, userId, chatId, text, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.started) {
                return { success: false, response: '', error: 'Runtime not started' };
            }
            try {
                // Find or create session
                let session = this.sessions.findByContext(userId, channel, chatId);
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
                // Add user message
                const userMsg = { role: 'user', content: text };
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
                    const compactResult = yield this.compact.maybeCompact(session);
                    if (compactResult === null || compactResult === void 0 ? void 0 : compactResult.success) {
                        logger.debug('Session auto-compacted', { sessionId: session.id });
                    }
                }
                // Get AI response (with tool calling loop)
                const messages = session.messages;
                const loopResult = yield runToolLoop(messages, runtimeToolDefinitions, (msgs, runOpts) => __awaiter(this, void 0, void 0, function* () {
                    return this.providers.chat(msgs, {
                        provider: runOpts === null || runOpts === void 0 ? void 0 : runOpts.provider,
                        model: runOpts === null || runOpts === void 0 ? void 0 : runOpts.model,
                        sessionId: runOpts === null || runOpts === void 0 ? void 0 : runOpts.sessionId,
                    });
                }), executeRuntimeTool, {
                    sessionId: session.id,
                    userId,
                }, {
                    provider: options === null || options === void 0 ? void 0 : options.provider,
                    model: options === null || options === void 0 ? void 0 : options.model,
                    sessionId: session.id,
                }, { maxIterations: 5 });
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
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                logger.error('handleMessage failed', { channel, userId, error: msg });
                return {
                    success: false,
                    response: '',
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
export { SessionManager } from './session';
export { ProviderRouter } from './provider-router';
export { AutoCompact } from './compact';
export { SubagentSpawner } from './subagents';
export { PrivacyManager, PUBLIC_ZONE, PERSONAL_ZONE, VAULT_ZONE } from './privacy';
export { WorkspaceLoader } from './workspace-loader';
export * from './tools';
