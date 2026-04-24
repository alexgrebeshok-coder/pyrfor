"use strict";
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
 * - browser — placeholder for Playwright integration
 * - send_message — send message to a channel
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeToolDefinitions = void 0;
exports.setWorkspaceRoot = setWorkspaceRoot;
exports.getWorkspaceRoot = getWorkspaceRoot;
exports.readFile = readFile;
exports.writeFile = writeFile;
exports.editFile = editFile;
exports.execCommand = execCommand;
exports.webSearch = webSearch;
exports.webFetch = webFetch;
exports.browserAction = browserAction;
exports.setTelegramBot = setTelegramBot;
exports.getTelegramBot = getTelegramBot;
exports.sendMessage = sendMessage;
exports.executeRuntimeTool = executeRuntimeTool;
const logger_1 = require("../observability/logger");
// ============================================
// Safety
// ============================================
// ============================================
// Security — Path Restriction
// ============================================
/** Allowed root paths for file operations */
const ALLOWED_ROOTS = ['/tmp'];
let _workspaceRoot = null;
/** Set workspace root for file access restriction */
function setWorkspaceRoot(root) {
    _workspaceRoot = path.resolve(root);
    if (!ALLOWED_ROOTS.includes(_workspaceRoot)) {
        ALLOWED_ROOTS.push(_workspaceRoot);
    }
}
/** Get configured workspace root */
function getWorkspaceRoot() {
    return _workspaceRoot;
}
/**
 * Validate that a resolved path is within allowed roots.
 * Returns the resolved path if OK, throws if blocked.
 */
function validatePath(rawPath) {
    const resolved = path.resolve(rawPath);
    // If no workspace root set, allow everything (dev mode)
    if (ALLOWED_ROOTS.length === 0)
        return resolved;
    for (const root of ALLOWED_ROOTS) {
        if (resolved.startsWith(root + path.sep) || resolved === root) {
            return resolved;
        }
    }
    throw new Error(`Path blocked: ${resolved} is outside allowed directories`);
}
// ============================================
// Safety — Command Blocking
// ============================================
/** Dangerous commands that are blocked */
const BLOCKED_COMMANDS = new Set([
    'rm -rf /',
    'rm -rf /*',
    'rm -rf ~',
    'dd if=/dev/zero',
    'mkfs',
    '>:',
    ':(){ :|:& };:', // fork bomb
]);
/** Commands requiring explicit confirmation */
const SENSITIVE_PATTERNS = [
    /rm\s+-rf/i,
    />\s*\/etc\/\w+/i,
    /curl.*\|.*sh/i,
    /wget.*\|.*sh/i,
];
function isCommandBlocked(command) {
    const normalized = command.toLowerCase().trim();
    for (const blocked of BLOCKED_COMMANDS) {
        if (normalized.includes(blocked))
            return true;
    }
    return false;
}
function isCommandSensitive(command) {
    return SENSITIVE_PATTERNS.some(pattern => pattern.test(command));
}
// ============================================
// File Tools
// ============================================
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
/**
 * Read file contents
 */
async function readFile(filePath, _ctx) {
    try {
        // Security: resolve to absolute and ensure it's within allowed paths
        const resolved = validatePath(filePath);
        const content = await fs.readFile(resolved, 'utf-8');
        const stats = await fs.stat(resolved);
        return {
            success: true,
            data: {
                content,
                path: resolved,
                size: stats.size,
            },
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('read_file failed', { path: filePath, error: msg });
        return { success: false, data: { content: '', path: filePath, size: 0 }, error: msg };
    }
}
/**
 * Write file contents (create or overwrite)
 */
async function writeFile(filePath, content, _ctx) {
    try {
        const resolved = validatePath(filePath);
        // Ensure directory exists
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, 'utf-8');
        return {
            success: true,
            data: {
                path: resolved,
                bytesWritten: Buffer.byteLength(content, 'utf-8'),
            },
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('write_file failed', { path: filePath, error: msg });
        return { success: false, data: { path: filePath, bytesWritten: 0 }, error: msg };
    }
}
/**
 * Surgical file edit — replaces oldString with newString
 */
async function editFile(filePath, oldString, newString, _ctx) {
    try {
        const resolved = validatePath(filePath);
        const content = await fs.readFile(resolved, 'utf-8');
        if (!content.includes(oldString)) {
            return {
                success: false,
                data: { path: resolved, replacements: 0 },
                error: 'Old string not found in file',
            };
        }
        // Count occurrences
        const occurrences = content.split(oldString).length - 1;
        // Replace all occurrences
        const newContent = content.split(oldString).join(newString);
        await fs.writeFile(resolved, newContent, 'utf-8');
        return {
            success: true,
            data: { path: resolved, replacements: occurrences },
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('edit_file failed', { path: filePath, error: msg });
        return { success: false, data: { path: filePath, replacements: 0 }, error: msg };
    }
}
// ============================================
// Shell Execution
// ============================================
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Execute shell command with safety checks
 */
async function execCommand(command, options = {}, _ctx) {
    // Safety checks
    if (isCommandBlocked(command)) {
        logger_1.logger.error('Blocked dangerous command', { command });
        return {
            success: false,
            data: { stdout: '', stderr: '', exitCode: -1, truncated: false },
            error: 'Command blocked for safety reasons',
        };
    }
    if (isCommandSensitive(command)) {
        logger_1.logger.warn('Sensitive command detected', { command });
        // In strict mode, we might want to require confirmation here
        // For now, we log and continue with extra caution
    }
    const { cwd, timeout = 30000, maxOutput = 10000 } = options;
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout,
            maxBuffer: maxOutput * 2,
        });
        const truncated = stdout.length > maxOutput;
        const trimmedStdout = stdout.slice(0, maxOutput);
        return {
            success: true,
            data: {
                stdout: trimmedStdout,
                stderr: stderr.slice(0, maxOutput),
                exitCode: 0,
                truncated,
            },
        };
    }
    catch (error) {
        // exec throws on non-zero exit code
        if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
            const execError = error;
            return {
                success: false,
                data: {
                    stdout: execError.stdout?.slice(0, maxOutput) || '',
                    stderr: execError.stderr?.slice(0, maxOutput) || '',
                    exitCode: execError.code || 1,
                    truncated: false,
                },
                error: `Command failed with exit code ${execError.code}`,
            };
        }
        const msg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('exec failed', { command, error: msg });
        return {
            success: false,
            data: { stdout: '', stderr: '', exitCode: -1, truncated: false },
            error: msg,
        };
    }
}
// ============================================
// Web Tools
// ============================================
/**
 * Search the web via OpenRouter or DuckDuckGo
 */
async function webSearch(query, _ctx) {
    try {
        // Use DuckDuckGo Instant Answer API (free, no API key)
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        // DuckDuckGo returns JS-like JSON, need to handle it carefully
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            // Try to extract JSON from the response
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                data = JSON.parse(match[0]);
            }
            else {
                throw new Error('Invalid JSON response');
            }
        }
        const results = [];
        // Main abstract
        if (data && typeof data === 'object') {
            const d = data;
            if (d.AbstractText) {
                results.push({
                    title: d.Heading || query,
                    url: d.AbstractURL || '',
                    snippet: d.AbstractText,
                });
            }
        }
        // Related topics
        if (data && typeof data === 'object') {
            const d = data;
            if (d.RelatedTopics) {
                for (const topic of d.RelatedTopics.slice(0, 5)) {
                    if (topic.Text) {
                        results.push({
                            title: topic.Text.split(' - ')[0] || 'Related',
                            url: topic.FirstURL || '',
                            snippet: topic.Text,
                        });
                    }
                }
            }
        }
        return {
            success: results.length > 0,
            data: { results },
            error: results.length === 0 ? 'No results found' : undefined,
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('web_search failed', { query, error: msg });
        return {
            success: false,
            data: { results: [] },
            error: msg,
        };
    }
}
/**
 * Fetch URL content
 */
async function webFetch(url, _ctx) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; PyrforBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || 'text/plain';
        const content = await response.text();
        // Extract title if HTML
        let title;
        const titleMatch = content.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (titleMatch) {
            title = titleMatch[1].trim();
        }
        // Limit content length
        const maxLength = 50000;
        const trimmed = content.length > maxLength ? content.slice(0, maxLength) + '...' : content;
        return {
            success: true,
            data: {
                url,
                content: trimmed,
                title,
                contentType,
            },
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('web_fetch failed', { url, error: msg });
        return {
            success: false,
            data: { url, content: '' },
            error: msg,
        };
    }
}
/**
 * Browser automation placeholder
 * Actual Playwright integration to be implemented
 */
async function browserAction(options, _ctx) {
    logger_1.logger.info('Browser action requested (placeholder)', { url: options.url, action: options.action });
    // Placeholder implementation
    return {
        success: true,
        data: {
            url: options.url,
            result: 'Browser automation not yet implemented. Use web_fetch for basic content retrieval.',
        },
    };
}
// Store Telegram bot instance (set by runtime)
let telegramBot = null;
function setTelegramBot(bot) {
    telegramBot = bot;
}
function getTelegramBot() {
    return telegramBot;
}
/**
 * Send message to a channel
 */
async function sendMessage(channel, targetId, message, _ctx) {
    try {
        switch (channel) {
            case 'telegram': {
                if (!telegramBot) {
                    return {
                        success: false,
                        data: { channel, targetId, sent: false },
                        error: 'Telegram bot not initialized',
                    };
                }
                await telegramBot.sendMessage(targetId, message, { parse_mode: 'Markdown' });
                return { success: true, data: { channel, targetId, sent: true } };
            }
            case 'cli': {
                // eslint-disable-next-line no-console
                console.log(`[Message to ${targetId}]: ${message}`);
                return { success: true, data: { channel, targetId, sent: true } };
            }
            case 'web': {
                // Web notifications would go here
                logger_1.logger.info('Web message requested', { targetId, messagePreview: message.slice(0, 100) });
                return { success: true, data: { channel, targetId, sent: false } };
            }
            default:
                return {
                    success: false,
                    data: { channel, targetId, sent: false },
                    error: `Unknown channel: ${channel}`,
                };
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('send_message failed', { channel, targetId, error: msg });
        return {
            success: false,
            data: { channel, targetId, sent: false },
            error: msg,
        };
    }
}
// ============================================
// Tool Definitions for AI Function Calling
// ============================================
exports.runtimeToolDefinitions = [
    {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Absolute or relative path to the file',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'write_file',
        description: 'Create or overwrite a file with content',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file',
                },
                content: {
                    type: 'string',
                    description: 'Content to write',
                },
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'edit_file',
        description: 'Surgically edit a file by replacing text',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file',
                },
                old_string: {
                    type: 'string',
                    description: 'Text to replace',
                },
                new_string: {
                    type: 'string',
                    description: 'Replacement text',
                },
            },
            required: ['path', 'old_string', 'new_string'],
        },
    },
    {
        name: 'exec',
        description: 'Execute a shell command',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'Shell command to execute',
                },
                cwd: {
                    type: 'string',
                    description: 'Working directory (optional)',
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default: 30000)',
                },
            },
            required: ['command'],
        },
    },
    {
        name: 'web_search',
        description: 'Search the web for information',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'web_fetch',
        description: 'Fetch content from a URL',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to fetch',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'browser',
        description: 'Browser automation (placeholder)',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                action: {
                    type: 'string',
                    enum: ['screenshot', 'extract', 'click', 'type'],
                },
                selector: { type: 'string' },
                text: { type: 'string' },
            },
            required: ['url'],
        },
    },
    {
        name: 'send_message',
        description: 'Send a message to a channel (Telegram, CLI, Web)',
        parameters: {
            type: 'object',
            properties: {
                channel: {
                    type: 'string',
                    enum: ['telegram', 'cli', 'web'],
                },
                target_id: {
                    type: 'string',
                    description: 'Chat ID, user ID, or target identifier',
                },
                message: {
                    type: 'string',
                    description: 'Message text (Markdown supported for Telegram)',
                },
            },
            required: ['channel', 'target_id', 'message'],
        },
    },
];
// ============================================
// Tool Executor
// ============================================
async function executeRuntimeTool(name, args, ctx) {
    switch (name) {
        case 'read_file': {
            const filePath = String(args.path || '');
            if (!filePath)
                return { success: false, data: {}, error: 'Path required' };
            return readFile(filePath, ctx);
        }
        case 'write_file': {
            const filePath = String(args.path || '');
            const content = String(args.content || '');
            if (!filePath)
                return { success: false, data: {}, error: 'Path required' };
            return writeFile(filePath, content, ctx);
        }
        case 'edit_file': {
            const filePath = String(args.path || '');
            const oldString = String(args.old_string || '');
            const newString = String(args.new_string || '');
            if (!filePath)
                return { success: false, data: {}, error: 'Path required' };
            return editFile(filePath, oldString, newString, ctx);
        }
        case 'exec': {
            const command = String(args.command || '');
            if (!command)
                return { success: false, data: {}, error: 'Command required' };
            return execCommand(command, {
                cwd: args.cwd ? String(args.cwd) : undefined,
                timeout: args.timeout ? Number(args.timeout) : undefined,
            }, ctx);
        }
        case 'web_search': {
            const query = String(args.query || '');
            if (!query)
                return { success: false, data: {}, error: 'Query required' };
            return webSearch(query, ctx);
        }
        case 'web_fetch': {
            const url = String(args.url || '');
            if (!url)
                return { success: false, data: {}, error: 'URL required' };
            return webFetch(url, ctx);
        }
        case 'browser': {
            return browserAction({
                url: String(args.url || ''),
                action: args.action,
                selector: args.selector ? String(args.selector) : undefined,
                text: args.text ? String(args.text) : undefined,
            }, ctx);
        }
        case 'send_message': {
            const channel = String(args.channel || '');
            const targetId = String(args.target_id || '');
            const message = String(args.message || '');
            if (!channel || !targetId || !message) {
                return { success: false, data: {}, error: 'Channel, target_id, and message required' };
            }
            return sendMessage(channel, targetId, message, ctx);
        }
        default:
            return { success: false, data: {}, error: `Unknown tool: ${name}` };
    }
}
