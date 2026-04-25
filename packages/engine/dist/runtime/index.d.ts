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
import { SessionManager, type Channel } from './session';
import { SessionStore, type SessionStoreOptions } from './session-store';
import { ProviderRouter } from './provider-router';
import { AutoCompact } from './compact';
import { SubagentSpawner, type SubagentOptions } from './subagents';
import { PrivacyManager } from './privacy';
import { WorkspaceLoader } from './workspace-loader';
import { executeRuntimeTool, runtimeToolDefinitions } from './tools';
import type { TelegramSender } from './telegram-types';
import { type RuntimeConfig } from './config';
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
export declare class PyrforRuntime {
    sessions: SessionManager;
    providers: ProviderRouter;
    compact: AutoCompact;
    subagents: SubagentSpawner;
    privacy: PrivacyManager;
    workspace: WorkspaceLoader | null;
    store: SessionStore | null;
    /** Current resolved RuntimeConfig. Updated on hot-reload. */
    config: RuntimeConfig;
    private health;
    private cron;
    private gateway;
    private configPath;
    private _configWatchDispose;
    private options;
    private started;
    private telegramBot;
    constructor(options?: PyrforRuntimeOptions);
    /**
     * Start all services
     */
    start(): Promise<void>;
    /**
     * Graceful shutdown — each subsystem is stopped independently so one
     * failure does not block the others. Reverse of start() order.
     */
    stop(): Promise<void>;
    /**
     * Main entry point: handle incoming message
     */
    handleMessage(channel: Channel, userId: string, chatId: string, text: string, options?: {
        provider?: string;
        model?: string;
        metadata?: Record<string, unknown>;
    }): Promise<RuntimeMessageResult>;
    /**
     * Stream a response (for real-time UI)
     */
    streamMessage(channel: Channel, userId: string, chatId: string, text: string, options?: {
        provider?: string;
        model?: string;
    }): AsyncGenerator<{
        type: 'token' | 'error' | 'done';
        content?: string;
        error?: string;
    }, void, unknown>;
    /**
     * Execute a tool directly
     */
    executeTool(toolName: string, args: Record<string, unknown>, context?: {
        sessionId?: string;
        userId?: string;
    }): Promise<ReturnType<typeof executeRuntimeTool>>;
    /**
     * Spawn a subagent task
     */
    spawnSubagent(options: SubagentOptions): {
        success: boolean;
        taskId?: string;
        error?: string;
    };
    /**
     * Get subagent status
     */
    waitForSubagent(taskId: string, timeoutMs?: number): Promise<{
        success: boolean;
        result?: string;
        error?: string;
    }>;
    /**
     * Get runtime statistics
     */
    getStats(): RuntimeStats;
    /**
     * Set Telegram bot instance
     */
    setTelegramBot(bot: TelegramSender | null): void;
    /**
     * Clear session for a given (channel, userId, chatId) tuple.
     * Returns true if a session was found and destroyed.
     */
    clearSession(channel: Channel, userId: string, chatId: string): boolean;
    /**
     * Reload workspace from disk
     */
    reloadWorkspace(): Promise<void>;
    private executeSubagentTask;
    private getDefaultSystemPrompt;
}
export { runtimeToolDefinitions };
export { SessionManager } from './session';
export { ProviderRouter } from './provider-router';
export { AutoCompact } from './compact';
export { SubagentSpawner } from './subagents';
export { PrivacyManager, PUBLIC_ZONE, PERSONAL_ZONE, VAULT_ZONE } from './privacy';
export { WorkspaceLoader } from './workspace-loader';
export * from './tools';
//# sourceMappingURL=index.d.ts.map