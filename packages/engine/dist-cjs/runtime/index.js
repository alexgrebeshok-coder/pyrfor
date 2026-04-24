"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceLoader = exports.VAULT_ZONE = exports.PERSONAL_ZONE = exports.PUBLIC_ZONE = exports.PrivacyManager = exports.SubagentSpawner = exports.AutoCompact = exports.ProviderRouter = exports.SessionManager = exports.runtimeToolDefinitions = exports.PyrforRuntime = void 0;
const session_1 = require("./session");
const provider_router_1 = require("./provider-router");
const compact_1 = require("./compact");
const subagents_1 = require("./subagents");
const privacy_1 = require("./privacy");
const workspace_loader_1 = require("./workspace-loader");
const tools_1 = require("./tools");
Object.defineProperty(exports, "runtimeToolDefinitions", { enumerable: true, get: function () { return tools_1.runtimeToolDefinitions; } });
const logger_1 = require("../observability/logger");
// ============================================
// Main Runtime Class
// ============================================
class PyrforRuntime {
    constructor(options = {}) {
        this.workspace = null;
        this.started = false;
        this.telegramBot = null;
        this.options = {
            workspacePath: options.workspacePath || process.cwd(),
            memoryPath: options.memoryPath || undefined,
            systemPrompt: options.systemPrompt || this.getDefaultSystemPrompt(),
            enableCompact: options.enableCompact ?? true,
            enableSubagents: options.enableSubagents ?? true,
            maxSubagents: options.maxSubagents ?? 5,
            privacy: options.privacy || {},
            providerOptions: options.providerOptions || {},
        };
        // Initialize components
        this.sessions = new session_1.SessionManager();
        this.providers = new provider_router_1.ProviderRouter(this.options.providerOptions);
        this.compact = new compact_1.AutoCompact(this.providers);
        this.subagents = new subagents_1.SubagentSpawner(this.options.maxSubagents);
        this.privacy = new privacy_1.PrivacyManager({
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
        (0, tools_1.setTelegramBot)(null);
        logger_1.logger.info('PyrforRuntime initialized');
    }
    /**
     * Start all services
     */
    async start() {
        if (this.started) {
            logger_1.logger.warn('Runtime already started');
            return;
        }
        // Load workspace
        const workspaceOptions = {
            workspacePath: this.options.workspacePath,
            memoryPath: this.options.memoryPath,
        };
        this.workspace = new workspace_loader_1.WorkspaceLoader(workspaceOptions);
        await this.workspace.load();
        // Set workspace root for file tool security
        (0, tools_1.setWorkspaceRoot)(this.options.workspacePath);
        // Update system prompt from workspace if available
        const wsPrompt = this.workspace.getSystemPrompt();
        if (wsPrompt) {
            this.options.systemPrompt = wsPrompt;
        }
        this.started = true;
        logger_1.logger.info('PyrforRuntime started');
    }
    /**
     * Graceful shutdown
     */
    async stop() {
        if (!this.started)
            return;
        // Dispose workspace watcher
        this.workspace?.dispose();
        // Cleanup
        this.sessions.cleanup(0); // Remove all
        this.subagents.cleanup(0);
        this.started = false;
        logger_1.logger.info('PyrforRuntime stopped');
    }
    /**
     * Main entry point: handle incoming message
     */
    async handleMessage(channel, userId, chatId, text, options) {
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
                const compactResult = await this.compact.maybeCompact(session);
                if (compactResult?.success) {
                    logger_1.logger.debug('Session auto-compacted', { sessionId: session.id });
                }
            }
            // Get AI response
            const messages = session.messages;
            const response = await this.providers.chat(messages, {
                provider: options?.provider,
                model: options?.model,
                sessionId: session.id,
            });
            // Add assistant message
            const assistantMsg = { role: 'assistant', content: response };
            this.sessions.addMessage(session.id, assistantMsg);
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
            logger_1.logger.error('handleMessage failed', { channel, userId, error: msg });
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
    async *streamMessage(channel, userId, chatId, text, options) {
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
            }
            catch (streamError) {
                const msg = streamError instanceof Error ? streamError.message : String(streamError);
                yield { type: 'error', error: msg };
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            yield { type: 'error', error: msg };
        }
    }
    /**
     * Execute a tool directly
     */
    async executeTool(toolName, args, context) {
        // Privacy check
        const privacyCheck = this.privacy.check(toolName);
        if (!privacyCheck.allowed) {
            return {
                success: false,
                data: {},
                error: `Privacy restriction: ${privacyCheck.reason}`,
            };
        }
        return (0, tools_1.executeRuntimeTool)(toolName, args, {
            sessionId: context?.sessionId,
            userId: context?.userId,
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
    async waitForSubagent(taskId, timeoutMs) {
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
    getStats() {
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
        (0, tools_1.setTelegramBot)(bot);
    }
    /**
     * Reload workspace from disk
     */
    async reloadWorkspace() {
        if (!this.workspace)
            return;
        await this.workspace.reload();
        // Update system prompt
        const wsPrompt = this.workspace.getSystemPrompt();
        if (wsPrompt) {
            this.options.systemPrompt = wsPrompt;
        }
        logger_1.logger.info('Workspace reloaded');
    }
    // ============================================
    // Private Helpers
    // ============================================
    async executeSubagentTask(task, systemPrompt) {
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: task },
        ];
        const response = await this.providers.chat(messages, {
            maxTokens: 2000, // Subagents get shorter responses
        });
        return response;
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
exports.PyrforRuntime = PyrforRuntime;
// Re-export components for advanced usage
var session_2 = require("./session");
Object.defineProperty(exports, "SessionManager", { enumerable: true, get: function () { return session_2.SessionManager; } });
var provider_router_2 = require("./provider-router");
Object.defineProperty(exports, "ProviderRouter", { enumerable: true, get: function () { return provider_router_2.ProviderRouter; } });
var compact_2 = require("./compact");
Object.defineProperty(exports, "AutoCompact", { enumerable: true, get: function () { return compact_2.AutoCompact; } });
var subagents_2 = require("./subagents");
Object.defineProperty(exports, "SubagentSpawner", { enumerable: true, get: function () { return subagents_2.SubagentSpawner; } });
var privacy_2 = require("./privacy");
Object.defineProperty(exports, "PrivacyManager", { enumerable: true, get: function () { return privacy_2.PrivacyManager; } });
Object.defineProperty(exports, "PUBLIC_ZONE", { enumerable: true, get: function () { return privacy_2.PUBLIC_ZONE; } });
Object.defineProperty(exports, "PERSONAL_ZONE", { enumerable: true, get: function () { return privacy_2.PERSONAL_ZONE; } });
Object.defineProperty(exports, "VAULT_ZONE", { enumerable: true, get: function () { return privacy_2.VAULT_ZONE; } });
var workspace_loader_2 = require("./workspace-loader");
Object.defineProperty(exports, "WorkspaceLoader", { enumerable: true, get: function () { return workspace_loader_2.WorkspaceLoader; } });
__exportStar(require("./tools"), exports);
