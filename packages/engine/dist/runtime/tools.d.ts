/**
 * Extended Tool Engine — Additional runtime tools
 *
 * Beyond existing project/task/analytics tools, adds:
 * - exec — run shell commands (with safety checks)
 * - read_file — read file contents
 * - write_file — create/overwrite files
 * - edit_file — surgical edit
 * - web_search — search the web
 * - web_fetch — fetch URL content
 * - browser — Playwright-based browser automation
 * - send_message — send message to a channel
 */
export interface ToolContext {
    workspaceId?: string;
    agentId?: string;
    runId?: string;
    userId?: string;
    sessionId?: string;
}
export interface ToolResult<T = unknown> {
    success: boolean;
    data: T;
    error?: string;
}
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}
/** Set workspace root for file access restriction */
export declare function setWorkspaceRoot(root: string): void;
/** Get configured workspace root */
export declare function getWorkspaceRoot(): string | null;
/**
 * Read file contents
 */
export declare function readFile(filePath: string, _ctx?: ToolContext): Promise<ToolResult<{
    content: string;
    path: string;
    size: number;
}>>;
/**
 * Write file contents (create or overwrite)
 */
export declare function writeFile(filePath: string, content: string, _ctx?: ToolContext): Promise<ToolResult<{
    path: string;
    bytesWritten: number;
}>>;
/**
 * Surgical file edit — replaces oldString with newString
 */
export declare function editFile(filePath: string, oldString: string, newString: string, _ctx?: ToolContext): Promise<ToolResult<{
    path: string;
    replacements: number;
}>>;
export interface ExecOptions {
    cwd?: string;
    timeout?: number;
    maxOutput?: number;
}
/**
 * Execute shell command with safety checks
 */
export declare function execCommand(command: string, options?: ExecOptions, _ctx?: ToolContext): Promise<ToolResult<{
    stdout: string;
    stderr: string;
    exitCode: number;
    truncated: boolean;
}>>;
/**
 * Search the web via Brave Search API (primary) or DuckDuckGo (fallback).
 */
export declare function webSearch(query: string, _ctx?: ToolContext): Promise<ToolResult<{
    results: Array<{
        title: string;
        url: string;
        snippet: string;
    }>;
}>>;
/**
 * Fetch URL content and convert to Markdown
 */
export declare function webFetch(url: string, _ctx?: ToolContext): Promise<ToolResult<{
    url: string;
    content: string;
    title?: string;
    contentType?: string;
}>>;
export interface BrowserOptions {
    url: string;
    action?: 'screenshot' | 'extract' | 'click' | 'type';
    selector?: string;
    text?: string;
}
/**
 * Browser automation via Playwright (lazy import — no startup cost if unused).
 * Returns error shape instead of throwing on any failure.
 */
export declare function browserAction(options: BrowserOptions, _ctx?: ToolContext): Promise<ToolResult<unknown>>;
import type { TelegramSender } from './telegram-types';
export declare function setTelegramBot(bot: TelegramSender | null): void;
export declare function getTelegramBot(): TelegramSender | null;
/**
 * Send message to a channel
 */
export declare function sendMessage(channel: 'telegram' | 'cli' | 'web', targetId: string, message: string, _ctx?: ToolContext): Promise<ToolResult<{
    channel: string;
    targetId: string;
    sent: boolean;
}>>;
export declare const runtimeToolDefinitions: ToolDefinition[];
export declare function executeRuntimeTool(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult>;
//# sourceMappingURL=tools.d.ts.map