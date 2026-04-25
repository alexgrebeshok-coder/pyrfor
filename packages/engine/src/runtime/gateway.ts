/**
 * Runtime HTTP Gateway
 *
 * Thin HTTP server that exposes health/status/chat endpoints for the runtime.
 * Uses Node's built-in `http` module — no framework dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { PtyManager } from './pty/manager.js';
import { readFileSync, existsSync, readdirSync, writeFileSync as writeFileSyncNode, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { logger } from '../observability/logger';
import type { RuntimeConfig } from './config';
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';
import { collectMetrics, formatMetrics } from './metrics';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { createTokenValidator, type TokenValidator } from './auth-tokens';
import { GoalStore } from './goal-store';
import type { ApprovalSettings } from './approval-flow';
import {
  listDir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  searchFiles,
  FsApiError,
  type FsApiConfig,
} from './ide/fs-api.js';
import {
  gitStatus,
  gitDiff,
  gitFileContent,
  gitStage,
  gitUnstage,
  gitCommit,
  gitLog,
  gitBlame,
} from './git/api.js';

// ─── Public API ────────────────────────────────────────────────────────────

export interface GatewayDeps {
  config: RuntimeConfig;
  runtime: PyrforRuntime;
  health?: HealthMonitor;
  cron?: CronService;
  /** Optional GoalStore — defaults to ~/.pyrfor */
  goalStore?: GoalStore;
  /** Optional path to approval-settings.json — defaults to ~/.pyrfor/approval-settings.json */
  approvalSettingsPath?: string;
  /** Optional directory for static Mini App files — defaults to telegram/app/ relative to this module */
  staticDir?: string;
  /** Optional directory for IDE static files — defaults to telegram/ide/ relative to this module */
  ideStaticDir?: string;
  /**
   * Override exec timeout for testing. Defaults to DEFAULT_EXEC_TIMEOUT_MS (30 s).
   * Set to a small value (e.g., 2000) in tests that verify the timeout path.
   */
  execTimeoutMs?: number;
  /**
   * Override the bind port, taking precedence over `config.gateway.port`.
   * Pass `0` to let the OS assign a random available port.
   * When omitted, the value of the `PYRFOR_PORT` environment variable is checked
   * next (also supports `0`); if absent, `config.gateway.port` is used (default 18790).
   */
  portOverride?: number;
}

export interface GatewayHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
}

// ─── Static file helpers ───────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveDefaultStaticDir(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return path.join(path.dirname(__filename), 'telegram', 'app');
  } catch {
    // Fallback for environments where import.meta.url is unavailable
    return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'app');
  }
}

function resolveDefaultIdeStaticDir(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return path.join(path.dirname(__filename), 'telegram', 'ide');
  } catch {
    return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'ide');
  }
}

function serveStaticFile(res: ServerResponse, staticDir: string, filePath: string): void {
  const full = path.resolve(staticDir, filePath);
  // Prevent path traversal — resolved path must stay inside staticDir
  if (!full.startsWith(path.resolve(staticDir) + path.sep) && full !== path.resolve(staticDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  if (!existsSync(full)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';
  const body = readFileSync(full);
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
  res.end(body);
}

// ─── Approval-settings helpers ─────────────────────────────────────────────

function readApprovalSettings(settingsPath: string): ApprovalSettings {
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(raw) as ApprovalSettings;
  } catch {
    return {};
  }
}

function saveApprovalSettings(settingsPath: string, settings: ApprovalSettings): void {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSyncNode(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// ─── Gateway Helpers ───────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Safe JSON parse — returns the parsed value or null on syntax error. */
function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw || '{}') };
  } catch {
    return { ok: false };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildValidator(config: RuntimeConfig): TokenValidator {
  return createTokenValidator({
    bearerToken: config.gateway.bearerToken,
    bearerTokens: config.gateway.bearerTokens,
  });
}

// ─── IDE helpers ────────────────────────────────────────────────────────────

/** Map FsApiError.code to HTTP status. */
function fsErrStatus(code: FsApiError['code']): number {
  switch (code) {
    case 'ENOENT': return 404;
    case 'E2BIG': return 413;
    case 'EACCES':
    case 'EISDIR':
    case 'ENOTDIR':
    case 'EINVAL':
    default: return 400;
  }
}

function sendFsError(res: ServerResponse, err: FsApiError): void {
  sendJson(res, fsErrStatus(err.code), { error: err.message, code: err.code });
}

/**
 * Exec timeout in milliseconds. Exported so tests can override it via
 * the `execTimeoutMs` field in GatewayDeps.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

/** Max bytes captured per stream (stdout / stderr). */
const EXEC_MAX_OUTPUT = 100_000;

/**
 * Run an external command with a timeout. Does NOT use shell:true unless the
 * command string starts with "bash -c " or "sh -c ", in which case the shell
 * is invoked with a single argument (the rest of the string).
 *
 * Returns stdout, stderr, exitCode, and durationMs.
 * On timeout: kills the process, sets exitCode = -1, stderr = 'TIMEOUT'.
 */
function runExec(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();

    let file: string;
    let args: string[];
    let useShell = false;

    // Allow explicit shell invocation via "bash -c <script>" or "sh -c <script>"
    const shellMatch = command.match(/^(bash|sh)\s+-c\s+([\s\S]+)$/);
    if (shellMatch) {
      file = shellMatch[1]!;
      args = ['-c', shellMatch[2]!];
      useShell = false; // We're calling bash/sh directly — still no shell:true
    } else {
      // Simple whitespace tokenizer — handles quoted strings naively
      const tokens = tokenize(command);
      file = tokens[0] ?? '';
      args = tokens.slice(1);
    }

    const child = spawn(file, args, {
      cwd,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > EXEC_MAX_OUTPUT) {
        stdout = stdout.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > EXEC_MAX_OUTPUT) {
        stderr = stderr.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      if (timedOut) {
        resolve({ stdout, stderr: 'TIMEOUT', exitCode: -1, durationMs });
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0, durationMs });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      resolve({ stdout, stderr: err.message, exitCode: -1, durationMs });
    });
  });
}

/**
 * Minimal command tokenizer. Splits on whitespace, respects single- and
 * double-quoted substrings (no escape sequences — sufficient for test commands).
 */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createRuntimeGateway(deps: GatewayDeps): GatewayHandle {
  const { config, runtime, health, cron } = deps;

  // Mini App dependencies
  const goalStore = deps.goalStore ?? new GoalStore();
  const approvalSettingsPath = deps.approvalSettingsPath
    ?? path.join(homedir(), '.pyrfor', 'approval-settings.json');
  const STATIC_DIR = deps.staticDir ?? resolveDefaultStaticDir();
  const IDE_STATIC_DIR = deps.ideStaticDir ?? resolveDefaultIdeStaticDir();

  // ─── IDE filesystem config ─────────────────────────────────────────────
  const fsConfig: FsApiConfig = {
    workspaceRoot: config.workspaceRoot
      ?? path.join(homedir(), '.openclaw', 'workspace'),
  };

  const execTimeout = deps.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const ptyManager = new PtyManager();

  // Build token validator from config. Rebuilt on each request is fine for v1
  // (config is passed in at construction time). For hot-reload, callers should
  // reconstruct the gateway or we'd need an onConfigChange hook — deferred to v2.
  const tokenValidator: TokenValidator = buildValidator(config);

  const requireAuth =
    !!(config.gateway.bearerToken) ||
    (config.gateway.bearerTokens?.length ?? 0) > 0;

  // ─── Rate limiter ──────────────────────────────────────────────────────

  const rlCfg = config.rateLimit;
  let rateLimiter: RateLimiter | null = null;
  if (rlCfg?.enabled) {
    rateLimiter = createRateLimiter({
      capacity: rlCfg.capacity,
      refillPerSec: rlCfg.refillPerSec,
    });
    logger.info('[gateway-rate-limit] Rate limiter enabled', {
      capacity: rlCfg.capacity,
      refillPerSec: rlCfg.refillPerSec,
      exemptPaths: rlCfg.exemptPaths,
    });
  }

  // ─── Auth ──────────────────────────────────────────────────────────────

  function checkAuth(req: IncomingMessage): { ok: boolean; reason?: 'unknown' | 'expired' } {
    if (!requireAuth) return { ok: true };
    const authHeader = req.headers['authorization'];
    if (!authHeader) return { ok: false, reason: 'unknown' };
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const result = tokenValidator.validate(token);
    if (!result.ok) {
      const last4 = token.length >= 4 ? token.slice(-4) : token.padStart(4, '*').slice(-4);
      logger.warn(`[auth] Denied request (token…last4=${last4})`, {
        reason: result.reason,
        label: result.label,
      });
    }
    return result;
  }

  // ─── Server ────────────────────────────────────────────────────────────

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const parsed = parseUrl(req.url ?? '/', true);
    const method = req.method ?? 'GET';
    const pathname = parsed.pathname ?? '/';
    const query = parsed.query;

    // CORS preflight — always respond 204 with permissive headers
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data',
      });
      res.end();
      return;
    }

    // Rate limiting — applied to all non-exempt paths
    if (rateLimiter) {
      const exemptPaths = rlCfg?.exemptPaths ?? ['/ping', '/health', '/metrics'];
      if (!exemptPaths.includes(pathname)) {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
        const ip = req.socket.remoteAddress ?? 'unknown';
        const rlKey = token ?? ip;
        const { allowed, retryAfterMs } = rateLimiter.tryConsume(rlKey);
        if (!allowed) {
          const retryAfterSec = Math.ceil(retryAfterMs / 1000);
          logger.warn('[gateway-rate-limit] Request denied', { key: rlKey, pathname, retryAfterMs });
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfterSec),
          });
          res.end(JSON.stringify({ error: 'rate_limited', retryAfterMs }));
          return;
        }
      }
    }

    // Public routes — no auth required
    if (method === 'GET' && pathname === '/ping') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && pathname === '/health') {
      if (!health) {
        sendJson(res, 200, { status: 'unknown' });
        return;
      }
      const snapshot = health.getLastSnapshot();
      const status =
        snapshot == null || snapshot.status === 'healthy' || snapshot.status === 'degraded'
          ? 200
          : 503;
      sendJson(res, status, snapshot ?? { status: 'unknown' });
      return;
    }

    // GET /metrics — Prometheus text exposition format (public, no auth).
    // NOTE: In production, protect this endpoint at the network level (firewall /
    // reverse-proxy allow-list) to prevent leaking operational data.
    if (method === 'GET' && pathname === '/metrics') {
      const metricsSnapshot = collectMetrics({ runtime, health, cron });
      const body = formatMetrics(metricsSnapshot);
      sendText(res, 200, body, 'text/plain; version=0.0.4; charset=utf-8');
      return;
    }

    // ─── Root redirect → /app (Telegram Mini App) ───────────────────────
    if (method === 'GET' && (pathname === '/' || pathname === '')) {
      res.writeHead(302, { Location: '/app' });
      res.end();
      return;
    }

    // ─── Telegram Mini App static files (public) ────────────────────────

    if (method === 'GET' && (pathname === '/app' || pathname === '/app/')) {
      serveStaticFile(res, STATIC_DIR, 'index.html');
      return;
    }

    if (method === 'GET' && pathname.startsWith('/app/')) {
      const relative = pathname.slice('/app/'.length); // e.g. "style.css"
      serveStaticFile(res, STATIC_DIR, relative);
      return;
    }

    // ─── IDE static files (public) ──────────────────────────────────────

    if (method === 'GET' && (pathname === '/ide' || pathname === '/ide/')) {
      serveStaticFile(res, IDE_STATIC_DIR, 'index.html');
      return;
    }

    if (method === 'GET' && pathname.startsWith('/ide/')) {
      const relative = pathname.slice('/ide/'.length);
      serveStaticFile(res, IDE_STATIC_DIR, relative);
      return;
    }

    // ─── Telegram Mini App API routes (public — auth via X-Telegram-Init-Data, deferred) ──

    if (pathname === '/api/dashboard' && method === 'GET') {
      try {
        let sessionsCount = 0;
        // TODO: wire LLM cost accumulator (#dashboard-cost)
        let costToday: number | null = null;
        try {
          const rStats = (runtime as unknown as { getStats?: () => { sessions?: { active?: number } } }).getStats?.();
          sessionsCount = rStats?.sessions?.active ?? 0;
        } catch { /* not critical */ }

        const activeGoals = goalStore.list('active').slice(0, 3);
        const recentActivity = goalStore.list().slice(-10).reverse();
        const model = config.providers?.defaultProvider ?? 'unknown';
        sendJson(res, 200, {
          status: 'running',
          model,
          costToday,
          sessionsCount,
          activeGoals,
          recentActivity,
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Internal server error' });
      }
      return;
    }

    if (pathname === '/api/goals' && method === 'GET') {
      sendJson(res, 200, goalStore.list());
      return;
    }

    if (pathname === '/api/goals' && method === 'POST') {
      const raw = await readBody(req);
      const parsed2 = tryParseJson(raw);
      if (!parsed2.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const body2 = parsed2.value as { title?: string; description?: string };
      const desc = body2.title || body2.description;
      if (!desc) { sendJson(res, 400, { error: 'title required' }); return; }
      const goal = goalStore.create(desc);
      sendJson(res, 200, goal);
      return;
    }

    // POST /api/goals/:id/done
    const goalDoneMatch = pathname.match(/^\/api\/goals\/([^/]+)\/done$/);
    if (goalDoneMatch && method === 'POST') {
      const id = goalDoneMatch[1]!;
      const updated = goalStore.markDone(id);
      if (!updated) { sendJson(res, 404, { error: 'Goal not found' }); return; }
      sendJson(res, 200, updated);
      return;
    }

    // DELETE /api/goals/:id
    const goalDeleteMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
    if (goalDeleteMatch && method === 'DELETE') {
      const id = goalDeleteMatch[1]!;
      const updated = goalStore.cancel(id);
      if (!updated) { sendJson(res, 404, { error: 'Goal not found' }); return; }
      sendJson(res, 200, updated);
      return;
    }

    if (pathname === '/api/agents' && method === 'GET') {
      // TODO: expose subagents API from PyrforRuntime (currently returns empty array)
      sendJson(res, 200, [] as { id: string; name: string; status: string; startedAt: string }[]);
      return;
    }

    if (pathname === '/api/memory' && method === 'GET') {
      const memoryPath = path.join(homedir(), '.openclaw', 'workspace', 'MEMORY.md');
      let lines: string[] = [];
      try {
        const content = readFileSync(memoryPath, 'utf-8');
        const allLines = content.split('\n');
        lines = allLines.slice(-50);
      } catch { /* file may not exist */ }

      let files: string[] = [];
      try {
        const wsDir = path.join(homedir(), '.openclaw', 'workspace');
        files = readdirSync(wsDir).filter(f => !f.startsWith('.'));
      } catch { /* dir may not exist */ }

      sendJson(res, 200, { lines, files });
      return;
    }

    if (pathname === '/api/settings' && method === 'GET') {
      const settings = readApprovalSettings(approvalSettingsPath);
      sendJson(res, 200, {
        defaultAction: settings.defaultAction ?? 'ask',
        whitelist: settings.whitelist ?? [],
        blacklist: settings.blacklist ?? [],
        autoApprovePatterns: settings.autoApprovePatterns ?? [],
        provider: config.providers?.defaultProvider ?? null,
      });
      return;
    }

    if (pathname === '/api/settings' && method === 'POST') {
      const raw = await readBody(req);
      const parsedS = tryParseJson(raw);
      if (!parsedS.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const updates = parsedS.value as {
        defaultAction?: 'approve' | 'ask' | 'deny';
        whitelist?: string[];
        blacklist?: string[];
      };
      const current = readApprovalSettings(approvalSettingsPath);
      if (updates.defaultAction !== undefined) {
        const valid = ['approve', 'ask', 'deny'] as const;
        if (!valid.includes(updates.defaultAction)) {
          sendJson(res, 400, { error: 'invalid defaultAction' }); return;
        }
        current.defaultAction = updates.defaultAction;
      }
      if (Array.isArray(updates.whitelist)) current.whitelist = updates.whitelist;
      if (Array.isArray(updates.blacklist)) current.blacklist = updates.blacklist;
      try {
        saveApprovalSettings(approvalSettingsPath, current);
        sendJson(res, 200, { ok: true, settings: current });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to save settings' });
      }
      return;
    }

    if (pathname === '/api/stats' && method === 'GET') {
      let sessionsCount = 0;
      try {
        const rStats = (runtime as unknown as { getStats?: () => { sessions?: { active?: number } } }).getStats?.();
        sessionsCount = rStats?.sessions?.active ?? 0;
      } catch { /* not critical */ }
      // TODO: wire LLM cost accumulator (#dashboard-cost)
      sendJson(res, 200, {
        costToday: null,
        sessionsCount,
        uptime: process.uptime(),
      });
      return;
    }

    // POST /api/runtime/credentials — inject provider keys into process.env for this session.
    // Called by the Tauri frontend on startup after loading keys from Keychain.
    if (pathname === '/api/runtime/credentials' && method === 'POST') {
      const raw = await readBody(req);
      const parsedCreds = tryParseJson(raw);
      if (!parsedCreds.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const creds = parsedCreds.value as Record<string, unknown>;
      for (const [k, v] of Object.entries(creds)) {
        if (typeof v === 'string') {
          // "provider:anthropic" → "PYRFOR_PROVIDER_ANTHROPIC"
          const envKey =
            'PYRFOR_PROVIDER_' +
            k.replace(/^provider:/, '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
          process.env[envKey] = v;
        }
      }
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    // All other routes require auth
    const authResult = checkAuth(req);
    if (!authResult.ok) {
      sendJson(res, 401, { error: 'unauthorized', reason: authResult.reason ?? 'unknown' });
      return;
    }

    try {
      // GET /status
      if (method === 'GET' && pathname === '/status') {
        const snapshot = health?.getLastSnapshot() ?? null;
        const cronStatus = cron?.getStatus() ?? null;
        sendJson(res, 200, {
          uptime: process.uptime(),
          config: {
            gateway: { port: config.gateway.port, host: config.gateway.host },
          },
          cron: cronStatus,
          health: snapshot,
        });
        return;
      }

      // GET /cron/jobs
      if (method === 'GET' && pathname === '/cron/jobs') {
        if (!cron) {
          sendJson(res, 200, { jobs: [] });
          return;
        }
        sendJson(res, 200, { jobs: cron.getStatus() });
        return;
      }

      // POST /cron/trigger
      if (method === 'POST' && pathname === '/cron/trigger') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { error: 'invalid_json' });
          return;
        }
        const payload = parsed.value as { name?: string };
        if (!payload.name) {
          sendJson(res, 400, { error: 'name required' });
          return;
        }
        if (!cron) {
          sendJson(res, 503, { error: 'CronService not available' });
          return;
        }
        try {
          await cron.triggerJob(payload.name);
          sendJson(res, 200, { ok: true, name: payload.name });
        } catch (err) {
          sendJson(res, 404, {
            error: err instanceof Error ? err.message : 'Job not found',
          });
        }
        return;
      }

      // POST /v1/chat/completions  (OpenAI-compatible)
      if (method === 'POST' && pathname === '/v1/chat/completions') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { error: 'invalid_json' });
          return;
        }
        const payload = parsed.value as {
          messages?: Array<{ role: string; content: string }>;
          channel?: string;
          userId?: string;
          chatId?: string;
        };

        const messages = payload.messages ?? [];
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage?.content) {
          sendJson(res, 400, { error: 'messages must contain at least one entry with content' });
          return;
        }

        const channel = (payload.channel ?? 'api') as Parameters<typeof runtime.handleMessage>[0];
        const userId = payload.userId ?? 'gateway-user';
        const chatId = payload.chatId ?? 'gateway-chat';

        const result = await runtime.handleMessage(channel, userId, chatId, lastMessage.content);

        sendJson(res, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: result.response },
              finish_reason: 'stop',
            },
          ],
        });
        return;
      }

      // ─── IDE Filesystem routes ────────────────────────────────────────────

      // GET /api/fs/list?path=<relPath>
      if (method === 'GET' && pathname === '/api/fs/list') {
        const relPath = (query['path'] as string | undefined) ?? '';
        try {
          const result = await listDir(fsConfig, relPath);
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // GET /api/fs/read?path=<relPath>
      if (method === 'GET' && pathname === '/api/fs/read') {
        const relPath = (query['path'] as string | undefined) ?? '';
        if (!relPath) { sendJson(res, 400, { error: 'path query param required', code: 'EINVAL' }); return; }
        try {
          const result = await fsReadFile(fsConfig, relPath);
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // PUT /api/fs/write  body: {path, content}
      if (method === 'PUT' && pathname === '/api/fs/write') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { path?: string; content?: string };
        if (!body.path) { sendJson(res, 400, { error: 'path required', code: 'EINVAL' }); return; }
        if (body.content === undefined) { sendJson(res, 400, { error: 'content required', code: 'EINVAL' }); return; }
        try {
          const result = await fsWriteFile(fsConfig, body.path, body.content);
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // POST /api/fs/search  body: {query, maxHits?, path?}
      if (method === 'POST' && pathname === '/api/fs/search') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { query?: string; maxHits?: number; path?: string };
        if (!body.query) { sendJson(res, 400, { error: 'query required', code: 'EINVAL' }); return; }
        try {
          const result = await searchFiles(fsConfig, body.query, {
            maxHits: body.maxHits,
            relPath: body.path,
          });
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // POST /api/chat  body: {userId?, chatId?, text}
      if (method === 'POST' && pathname === '/api/chat') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { userId?: string; chatId?: string; text?: string };
        if (!body.text) { sendJson(res, 400, { error: 'text required' }); return; }
        const userId = body.userId ?? 'ide-user';
        const chatId = body.chatId ?? 'ide-chat';
        try {
          const result = await runtime.handleMessage(
            'http' as Parameters<typeof runtime.handleMessage>[0],
            userId, chatId, body.text,
          );
          sendJson(res, 200, { reply: result.response });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
        }
        return;
      }

      // POST /api/chat/stream  body: {text, openFiles?, workspace?, sessionId?}
      if (method === 'POST' && pathname === '/api/chat/stream') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_json' }));
          return;
        }
        const body = parsed.value as {
          text?: string;
          openFiles?: Array<{ path: string; content: string; language?: string }>;
          workspace?: string;
          sessionId?: string;
        };
        if (!body.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'text required' }));
          return;
        }

        // Always 200 for SSE; errors are sent inline.
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const writeSSE = (eventName: string | null, data: unknown): void => {
          if (eventName) res.write(`event: ${eventName}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        try {
          for await (const event of runtime.streamChatRequest({
            text: body.text,
            openFiles: body.openFiles,
            workspace: body.workspace,
            sessionId: body.sessionId,
          })) {
            writeSSE(null, event);
          }
          writeSSE('done', {});
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Internal error';
          writeSSE('error', { message });
        } finally {
          res.end();
        }
        return;
      }

      // POST /api/exec  body: {command, cwd?}
      if (method === 'POST' && pathname === '/api/exec') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { command?: string; cwd?: string };
        if (!body.command) { sendJson(res, 400, { error: 'command required' }); return; }

        // Resolve cwd: must be inside workspaceRoot
        let execCwd: string;
        if (body.cwd) {
          // Reuse the same path-safety logic as the FS module
          const root = path.resolve(fsConfig.workspaceRoot);
          const candidate = body.cwd.startsWith('/')
            ? body.cwd
            : path.resolve(root, body.cwd);
          if (candidate !== root && !candidate.startsWith(root + path.sep)) {
            sendJson(res, 400, { error: `cwd is outside workspace: ${body.cwd}` });
            return;
          }
          execCwd = candidate;
        } else {
          execCwd = path.resolve(fsConfig.workspaceRoot);
        }

        const result = await runExec(body.command, execCwd, execTimeout);
        sendJson(res, 200, result);
        return;
      }

      // ─── Git routes ───────────────────────────────────────────────────────

      // GET /api/git/status?workspace=...
      if (method === 'GET' && pathname === '/api/git/status') {
        const workspace = query['workspace'] as string | undefined;
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        try {
          const result = await gitStatus(workspace);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/diff?workspace=...&path=...&staged=0|1
      if (method === 'GET' && pathname === '/api/git/diff') {
        const workspace = query['workspace'] as string | undefined;
        const filePath = query['path'] as string | undefined;
        const staged = (query['staged'] as string | undefined) === '1';
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        if (!filePath) { sendJson(res, 400, { error: 'path query param required' }); return; }
        try {
          const diff = await gitDiff(workspace, filePath, staged);
          sendJson(res, 200, { diff });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/file?workspace=...&path=...&ref=HEAD
      if (method === 'GET' && pathname === '/api/git/file') {
        const workspace = query['workspace'] as string | undefined;
        const filePath = query['path'] as string | undefined;
        const ref = (query['ref'] as string | undefined) ?? 'HEAD';
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        if (!filePath) { sendJson(res, 400, { error: 'path query param required' }); return; }
        try {
          const content = await gitFileContent(workspace, filePath, ref);
          sendJson(res, 200, { content });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/git/stage  body: {workspace, paths}
      if (method === 'POST' && pathname === '/api/git/stage') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { workspace?: string; paths?: string[] };
        if (!body.workspace) { sendJson(res, 400, { error: 'workspace required' }); return; }
        if (!Array.isArray(body.paths) || body.paths.length === 0) {
          sendJson(res, 400, { error: 'paths must be a non-empty array' }); return;
        }
        try {
          await gitStage(body.workspace, body.paths);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/git/unstage  body: {workspace, paths}
      if (method === 'POST' && pathname === '/api/git/unstage') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { workspace?: string; paths?: string[] };
        if (!body.workspace) { sendJson(res, 400, { error: 'workspace required' }); return; }
        if (!Array.isArray(body.paths) || body.paths.length === 0) {
          sendJson(res, 400, { error: 'paths must be a non-empty array' }); return;
        }
        try {
          await gitUnstage(body.workspace, body.paths);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/git/commit  body: {workspace, message}
      if (method === 'POST' && pathname === '/api/git/commit') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { workspace?: string; message?: string };
        if (!body.workspace) { sendJson(res, 400, { error: 'workspace required' }); return; }
        if (!body.message || !body.message.trim()) {
          sendJson(res, 400, { error: 'message must not be empty' }); return;
        }
        try {
          const result = await gitCommit(body.workspace, body.message);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/log?workspace=...&limit=50
      if (method === 'GET' && pathname === '/api/git/log') {
        const workspace = query['workspace'] as string | undefined;
        const limit = parseInt((query['limit'] as string | undefined) ?? '50', 10);
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        try {
          const entries = await gitLog(workspace, isNaN(limit) ? 50 : limit);
          sendJson(res, 200, { entries });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/blame?workspace=...&path=...
      if (method === 'GET' && pathname === '/api/git/blame') {
        const workspace = query['workspace'] as string | undefined;
        const filePath = query['path'] as string | undefined;
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        if (!filePath) { sendJson(res, 400, { error: 'path query param required' }); return; }
        try {
          const entries = await gitBlame(workspace, filePath);
          sendJson(res, 200, { entries });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/pty/spawn  body: {cwd, shell?, cols?, rows?}
      if (method === 'POST' && pathname === '/api/pty/spawn') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { cwd?: string; shell?: string; cols?: number; rows?: number };
        if (!body.cwd) { sendJson(res, 400, { error: 'cwd required' }); return; }
        const id = ptyManager.spawn({
          cwd: body.cwd,
          shell: body.shell,
          cols: body.cols,
          rows: body.rows,
        });
        sendJson(res, 200, { id });
        return;
      }

      // GET /api/pty/list
      if (method === 'GET' && pathname === '/api/pty/list') {
        sendJson(res, 200, ptyManager.list());
        return;
      }

      // POST /api/pty/:id/resize  body: {cols, rows}
      const ptyResizeMatch = pathname.match(/^\/api\/pty\/([^/]+)\/resize$/);
      if (ptyResizeMatch && method === 'POST') {
        const ptyId = ptyResizeMatch[1]!;
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { cols?: number; rows?: number };
        if (!body.cols || !body.rows) { sendJson(res, 400, { error: 'cols and rows required' }); return; }
        try {
          ptyManager.resize(ptyId, body.cols, body.rows);
          res.writeHead(204); res.end();
        } catch {
          sendJson(res, 404, { error: 'PTY not found' });
        }
        return;
      }

      // DELETE /api/pty/:id
      const ptyDeleteMatch = pathname.match(/^\/api\/pty\/([^/]+)$/);
      if (ptyDeleteMatch && method === 'DELETE') {
        const ptyId = ptyDeleteMatch[1]!;
        ptyManager.kill(ptyId);
        res.writeHead(204); res.end();
        return;
      }

      // 404 fallback
      sendJson(res, 404, { error: 'Not found', path: pathname });
    } catch (err) {
      logger.error(`[gateway] Route error ${method} ${pathname}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  // ─── WebSocket server (PTY streams) ────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WsWebSocket, ptyId: string) => {
    const onData = (id: string, data: string) => {
      if (id !== ptyId) return;
      try { ws.send(data); } catch { /* closed */ }
    };
    ptyManager.on('data', onData);

    const onExit = (id: string) => {
      if (id !== ptyId) return;
      ptyManager.off('data', onData);
      ptyManager.off('exit', onExit);
      try { ws.close(); } catch { /* already closed */ }
    };
    ptyManager.on('exit', onExit);

    ws.on('message', (msg: Buffer | string) => {
      try { ptyManager.write(ptyId, msg.toString()); } catch { /* pty gone */ }
    });

    ws.on('close', () => {
      ptyManager.off('data', onData);
      ptyManager.off('exit', onExit);
      try { ptyManager.kill(ptyId); } catch { /* already gone */ }
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const parsed2 = parseUrl(request.url ?? '/');
    const wsMatch = (parsed2.pathname ?? '').match(/^\/ws\/pty\/([^/]+)$/);
    if (!wsMatch) {
      socket.destroy();
      return;
    }
    const ptyId = wsMatch[1]!;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, ptyId);
    });
  });

  const cleanup = () => { ptyManager.killAll(); };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // ─── Controls ──────────────────────────────────────────────────────────

  /**
   * Resolve the bind port from (in priority order):
   *   1. `deps.portOverride` if provided (supports 0 for OS-assigned random port)
   *   2. `PYRFOR_PORT` environment variable (also supports 0)
   *   3. `config.gateway.port` (default 18790)
   */
  function resolveBindPort(): number {
    if (deps.portOverride !== undefined) return deps.portOverride;
    const envVal = process.env['PYRFOR_PORT'];
    if (envVal !== undefined && envVal !== '') {
      const p = parseInt(envVal, 10);
      if (!isNaN(p) && p >= 0) return p;
    }
    return config.gateway.port;
  }

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        const host = config.gateway.host ?? '127.0.0.1';
        const bindPort = resolveBindPort();

        server.once('error', reject);

        server.listen(bindPort, host, () => {
          const addr = server.address();
          const actualPort = addr && typeof addr === 'object' ? addr.port : bindPort;
          logger.info(`[gateway] Listening on ${host}:${actualPort}`, {
            auth: requireAuth ? 'bearer' : 'none',
          });
          // Signal the actual port to stdout so the sidecar manager (Rust / shell)
          // can discover the port without polling. One line, no trailing newline needed.
          process.stdout.write(`LISTENING_ON=${actualPort}\n`);
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        ptyManager.killAll();
        wss.close();
        process.off('SIGTERM', cleanup);
        process.off('SIGINT', cleanup);
        server.close(() => {
          logger.info('[gateway] Server stopped');
          resolve();
        });
      });
    },

    get port(): number {
      const addr = server.address();
      if (addr && typeof addr === 'object') return addr.port;
      return resolveBindPort();
    },
  };
}
