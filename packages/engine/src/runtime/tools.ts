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
 * - process_spawn — spawn a background process
 * - process_poll — poll a background process status/output
 * - process_kill — kill a background process
 * - process_list — list all tracked background processes
 */

import { logger } from '../observability/logger';
import { processManager } from './process-manager';

// ============================================
// Types
// ============================================

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

// ============================================
// Safety
// ============================================

// ============================================
// Security — Path Restriction
// ============================================

/** Allowed root paths for file operations */
const ALLOWED_ROOTS: string[] = ['/tmp'];
let _workspaceRoot: string | null = null;

/** Set workspace root for file access restriction */
export function setWorkspaceRoot(root: string): void {
  _workspaceRoot = path.resolve(root);
  if (!ALLOWED_ROOTS.includes(_workspaceRoot)) {
    ALLOWED_ROOTS.push(_workspaceRoot);
  }
}

/** Get configured workspace root */
export function getWorkspaceRoot(): string | null {
  return _workspaceRoot;
}

/**
 * Validate that a resolved path is within allowed roots.
 * Returns the resolved path if OK, throws if blocked.
 */
function validatePath(rawPath: string): string {
  const resolved = path.resolve(rawPath);

  // If no workspace root set, allow everything (dev mode)
  if (ALLOWED_ROOTS.length === 0) return resolved;

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

function isCommandBlocked(command: string): boolean {
  const normalized = command.toLowerCase().trim();
  for (const blocked of BLOCKED_COMMANDS) {
    if (normalized.includes(blocked)) return true;
  }
  return false;
}

function isCommandSensitive(command: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(command));
}

// ============================================
// File Tools
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read file contents
 */
export async function readFile(
  filePath: string,
  _ctx?: ToolContext
): Promise<ToolResult<{ content: string; path: string; size: number }>> {
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('read_file failed', { path: filePath, error: msg });
    return { success: false, data: { content: '', path: filePath, size: 0 }, error: msg };
  }
}

/**
 * Write file contents (create or overwrite)
 */
export async function writeFile(
  filePath: string,
  content: string,
  _ctx?: ToolContext
): Promise<ToolResult<{ path: string; bytesWritten: number }>> {
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('write_file failed', { path: filePath, error: msg });
    return { success: false, data: { path: filePath, bytesWritten: 0 }, error: msg };
  }
}

/**
 * Surgical file edit — replaces oldString with newString
 */
export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  _ctx?: ToolContext
): Promise<ToolResult<{ path: string; replacements: number }>> {
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('edit_file failed', { path: filePath, error: msg });
    return { success: false, data: { path: filePath, replacements: 0 }, error: msg };
  }
}

// ============================================
// Shell Execution
// ============================================

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  maxOutput?: number;
}

/**
 * Execute shell command with safety checks
 */
export async function execCommand(
  command: string,
  options: ExecOptions = {},
  _ctx?: ToolContext
): Promise<ToolResult<{
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}>> {
  // Safety checks
  if (isCommandBlocked(command)) {
    logger.error('Blocked dangerous command', { command });
    return {
      success: false,
      data: { stdout: '', stderr: '', exitCode: -1, truncated: false },
      error: 'Command blocked for safety reasons',
    };
  }

  if (isCommandSensitive(command)) {
    logger.warn('Sensitive command detected', { command });
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
  } catch (error) {
    // exec throws on non-zero exit code
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const execError = error as { stdout: string; stderr: string; code: number };
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
    logger.error('exec failed', { command, error: msg });
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
 * Search the web via Brave Search API (primary) or DuckDuckGo (fallback).
 */
export async function webSearch(
  query: string,
  _ctx?: ToolContext
): Promise<ToolResult<{ results: Array<{ title: string; url: string; snippet: string }> }>> {
  const braveKey = process.env.BRAVE_API_KEY;

  // ── Primary: Brave Search API ──
  if (braveKey) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': braveKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Brave API HTTP ${response.status}`);
      }

      const data = await response.json() as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };

      const results: Array<{ title: string; url: string; snippet: string }> = [];

      if (data?.web?.results) {
        for (const r of data.web.results) {
          results.push({
            title: r.title || '',
            url: r.url || '',
            snippet: r.description || '',
          });
        }
      }

      if (results.length > 0) {
        return { success: true, data: { results } };
      }

      // Brave returned empty, fall through to DDG
      logger.warn('Brave returned no results, falling back to DuckDuckGo', { query });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('Brave search failed, falling back to DuckDuckGo', { query, error: msg });
    }
  }

  // ── Fallback: DuckDuckGo Instant Answer API (free, no key) ──
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
      else throw new Error('Invalid JSON response');
    }

    const results: Array<{ title: string; url: string; snippet: string }> = [];

    if (data && typeof data === 'object') {
      const d = data as { AbstractText?: string; AbstractURL?: string; Heading?: string; RelatedTopics?: Array<{ FirstURL?: string; Text?: string }> };
      if (d.AbstractText) {
        results.push({ title: d.Heading || query, url: d.AbstractURL || '', snippet: d.AbstractText });
      }
      if (d.RelatedTopics) {
        for (const topic of d.RelatedTopics.slice(0, 5)) {
          if (topic.Text) {
            results.push({ title: topic.Text.split(' - ')[0] || 'Related', url: topic.FirstURL || '', snippet: topic.Text });
          }
        }
      }
    }

    return {
      success: results.length > 0,
      data: { results },
      error: results.length === 0 ? 'No results found' : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('web_search (DDG fallback) failed', { query, error: msg });
    return { success: false, data: { results: [] }, error: msg };
  }
}

/**
 * Minimal HTML → Markdown converter (no dependencies).
 * Strips tags, preserves headings, links, lists, paragraphs, code blocks.
 */
function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove script and style blocks entirely
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  md = md.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, '');

  // Code blocks: <pre><code> → ``` \n ```
  md = md.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, code: string) => {
    return '\n```\n' + decodeEntities(code.trim()) + '\n```\n';
  });
  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, code: string) => `\`${decodeEntities(code)}\``);

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');

  // Links: <a href="url">text</a> → [text](url)
  md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Images: <img src="url" alt="text"> → ![text](url)
  md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)');

  // Bold / Italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const lines = inner.trim().split('\n');
    return '\n' + lines.map((l: string) => `> ${l.trim()}`).join('\n') + '\n\n';
  });

  // Lists (unordered)
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');

  // Horizontal rule
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n\n');

  // Paragraphs and line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<p[^>]*>/gi, '');

  // Remove remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode entities
  md = decodeEntities(md);

  // Clean up whitespace
  md = md.replace(/[ \t]+/g, ' ');
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

/**
 * Fetch URL content and convert to Markdown
 */
export async function webFetch(
  url: string,
  _ctx?: ToolContext
): Promise<ToolResult<{ url: string; content: string; title?: string; contentType?: string }>> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'text/plain';
    const rawContent = await response.text();

    // Extract title
    let title: string | undefined;
    const titleMatch = rawContent.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
      title = decodeEntities(titleMatch[1].trim());
    }

    // Convert HTML to markdown, or return plain text as-is
    let content: string;
    if (contentType.includes('html')) {
      content = htmlToMarkdown(rawContent);
    } else {
      content = rawContent;
    }

    // Limit content length
    const maxLength = 50000;
    const trimmed = content.length > maxLength ? content.slice(0, maxLength) + '\n\n... [truncated]' : content;

    return {
      success: true,
      data: {
        url,
        content: trimmed,
        title,
        contentType,
      },
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('web_fetch failed', { url, error: msg });
    return {
      success: false,
      data: { url, content: '' },
      error: msg,
    };
  }
}

// ============================================
// Browser (Playwright)
// ============================================

export interface BrowserOptions {
  url: string;
  action?: 'screenshot' | 'extract' | 'click' | 'type';
  selector?: string;
  text?: string;
}

// Shared lazy browser instance — created on first use, reused across calls.
let _sharedBrowser: import('playwright').Browser | null = null;
let _exitHandlerRegistered = false;

async function getSharedBrowser(): Promise<import('playwright').Browser> {
  if (_sharedBrowser) return _sharedBrowser;

  const { chromium } = await import('playwright');
  _sharedBrowser = await chromium.launch({ headless: true });

  if (!_exitHandlerRegistered) {
    _exitHandlerRegistered = true;
    process.on('exit', () => {
      _sharedBrowser?.close().catch(() => {});
    });
  }

  return _sharedBrowser;
}

const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const EXTRACT_MAX_CHARS = 50 * 1024;           // 50 KB
const NAV_TIMEOUT_MS = 30_000;
const SELECTOR_TIMEOUT_MS = 10_000;

/**
 * Browser automation via Playwright (lazy import — no startup cost if unused).
 * Returns error shape instead of throwing on any failure.
 */
export async function browserAction(
  options: BrowserOptions,
  _ctx?: ToolContext
): Promise<ToolResult<unknown>> {
  const { url, action = 'extract', selector, text } = options;

  logger.info('Browser action requested', { url, action });

  let browser: import('playwright').Browser;
  try {
    browser = await getSharedBrowser();
  } catch {
    return {
      success: false,
      data: {},
      error:
        'playwright not installed; run pnpm add -w playwright @playwright/browsers; npx playwright install chromium',
    };
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    switch (action) {
      case 'screenshot': {
        const buf = await page.screenshot({ type: 'png', fullPage: !selector });
        const trimmed = buf.length > SCREENSHOT_MAX_BYTES ? buf.subarray(0, SCREENSHOT_MAX_BYTES) : buf;
        return {
          success: true,
          data: { url, screenshot: trimmed.toString('base64'), truncated: buf.length > SCREENSHOT_MAX_BYTES },
        };
      }

      case 'extract': {
        let content: string;
        if (selector) {
          const elements = await page.$$(selector);
          const texts = await Promise.all(elements.map((el) => el.innerText()));
          content = texts.join('\n');
        } else {
          content = await page.evaluate(() => document.body.innerText);
        }
        const truncated = content.length > EXTRACT_MAX_CHARS;
        return {
          success: true,
          data: { url, content: content.slice(0, EXTRACT_MAX_CHARS), truncated },
        };
      }

      case 'click': {
        if (!selector) {
          return { success: false, data: {}, error: 'selector required for click action' };
        }
        await page.click(selector, { timeout: SELECTOR_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
        return { success: true, data: { url, clicked: selector } };
      }

      case 'type': {
        if (!selector) {
          return { success: false, data: {}, error: 'selector required for type action' };
        }
        if (text === undefined || text === null) {
          return { success: false, data: {}, error: 'text required for type action' };
        }
        await page.fill(selector, text, { timeout: SELECTOR_TIMEOUT_MS });
        return { success: true, data: { url, typed: text.length, into: selector } };
      }

      default:
        return { success: false, data: {}, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { success: false, data: {}, error: String(err) };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

// ============================================
// Messaging
// ============================================

import type { TelegramSender } from './telegram-types';

// Store Telegram bot instance (set by runtime)
let telegramBot: TelegramSender | null = null;

export function setTelegramBot(bot: TelegramSender | null): void {
  telegramBot = bot;
}

export function getTelegramBot(): TelegramSender | null {
  return telegramBot;
}

/**
 * Send message to a channel
 */
export async function sendMessage(
  channel: 'telegram' | 'cli' | 'web',
  targetId: string,
  message: string,
  _ctx?: ToolContext
): Promise<ToolResult<{ channel: string; targetId: string; sent: boolean }>> {
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
        logger.info('Web message requested', { targetId, messagePreview: message.slice(0, 100) });
        return { success: true, data: { channel, targetId, sent: false } };
      }

      default:
        return {
          success: false,
          data: { channel, targetId, sent: false },
          error: `Unknown channel: ${channel}`,
        };
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('send_message failed', { channel, targetId, error: msg });
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

export const runtimeToolDefinitions: ToolDefinition[] = [
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
    description: 'Browser automation — screenshot, extract text, click, or type via Playwright',
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
  {
    name: 'process_spawn',
    description: 'Запустить фоновый процесс (npm run dev, watch, build и т.д.) и получить PID',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Исполняемый файл или команда',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Аргументы командной строки',
        },
        cwd: {
          type: 'string',
          description: 'Рабочая директория (опционально)',
        },
        timeout: {
          type: 'number',
          description: 'Тайм-аут в секундах (по умолчанию: 300)',
        },
        memoryLimit: {
          type: 'number',
          description: 'Лимит памяти в МБ (по умолчанию: 512)',
        },
        env: {
          type: 'object',
          description: 'Дополнительные переменные окружения',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'process_poll',
    description: 'Получить статус и вывод фонового процесса по PID',
    parameters: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'PID процесса',
        },
        tail: {
          type: 'number',
          description: 'Количество последних строк вывода (по умолчанию: 50)',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'process_kill',
    description: 'Остановить фоновый процесс по PID',
    parameters: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'PID процесса',
        },
        signal: {
          type: 'string',
          enum: ['SIGTERM', 'SIGKILL'],
          description: 'Сигнал завершения (по умолчанию: SIGTERM)',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'process_list',
    description: 'Получить список всех отслеживаемых фоновых процессов',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ============================================
// Tool Executor
// ============================================

export async function executeRuntimeTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case 'read_file': {
      const filePath = String(args.path || '');
      if (!filePath) return { success: false, data: {}, error: 'Path required' };
      return readFile(filePath, ctx);
    }

    case 'write_file': {
      const filePath = String(args.path || '');
      const content = String(args.content || '');
      if (!filePath) return { success: false, data: {}, error: 'Path required' };
      return writeFile(filePath, content, ctx);
    }

    case 'edit_file': {
      const filePath = String(args.path || '');
      const oldString = String(args.old_string || '');
      const newString = String(args.new_string || '');
      if (!filePath) return { success: false, data: {}, error: 'Path required' };
      return editFile(filePath, oldString, newString, ctx);
    }

    case 'exec': {
      const command = String(args.command || '');
      if (!command) return { success: false, data: {}, error: 'Command required' };
      return execCommand(command, {
        cwd: args.cwd ? String(args.cwd) : undefined,
        timeout: args.timeout ? Number(args.timeout) : undefined,
      }, ctx);
    }

    case 'web_search': {
      const query = String(args.query || '');
      if (!query) return { success: false, data: {}, error: 'Query required' };
      return webSearch(query, ctx);
    }

    case 'web_fetch': {
      const url = String(args.url || '');
      if (!url) return { success: false, data: {}, error: 'URL required' };
      return webFetch(url, ctx);
    }

    case 'browser': {
      return browserAction({
        url: String(args.url || ''),
        action: args.action as BrowserOptions['action'],
        selector: args.selector ? String(args.selector) : undefined,
        text: args.text ? String(args.text) : undefined,
      }, ctx);
    }

    case 'send_message': {
      const channel = String(args.channel || '') as 'telegram' | 'cli' | 'web';
      const targetId = String(args.target_id || '');
      const message = String(args.message || '');
      if (!channel || !targetId || !message) {
        return { success: false, data: {}, error: 'Channel, target_id, and message required' };
      }
      return sendMessage(channel, targetId, message, ctx);
    }

    case 'process_spawn': {
      const command = String(args.command || '');
      if (!command) return { success: false, data: {}, error: 'Command required' };
      try {
        const result = processManager.spawn({
          command,
          args: Array.isArray(args.args) ? (args.args as string[]) : [],
          cwd: args.cwd ? String(args.cwd) : undefined,
          timeoutSec: args.timeout ? Number(args.timeout) : undefined,
          memoryLimitMB: args.memoryLimit ? Number(args.memoryLimit) : undefined,
          env: args.env ? (args.env as Record<string, string>) : undefined,
        });
        return { success: true, data: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, data: {}, error: msg };
      }
    }

    case 'process_poll': {
      const pid = Number(args.pid);
      if (!pid) return { success: false, data: {}, error: 'PID required' };
      try {
        const result = processManager.poll(pid, args.tail ? Number(args.tail) : 50);
        return { success: true, data: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, data: {}, error: msg };
      }
    }

    case 'process_kill': {
      const pid = Number(args.pid);
      if (!pid) return { success: false, data: {}, error: 'PID required' };
      const signal = args.signal ? String(args.signal) : 'SIGTERM';
      const result = processManager.kill(pid, signal);
      return { success: true, data: result };
    }

    case 'process_list': {
      const result = processManager.list();
      return { success: true, data: result };
    }

    default:
      return { success: false, data: {}, error: `Unknown tool: ${name}` };
  }
}
