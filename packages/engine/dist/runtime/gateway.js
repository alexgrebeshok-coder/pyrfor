/**
 * Runtime HTTP Gateway
 *
 * Thin HTTP server that exposes health/status/chat endpoints for the runtime.
 * Uses Node's built-in `http` module — no framework dependencies.
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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import { createServer } from 'http';
import { parse as parseUrl } from 'url';
import { WebSocketServer } from 'ws';
import { PtyManager } from './pty/manager.js';
import { readFileSync, existsSync, readdirSync, writeFileSync as writeFileSyncNode, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { logger } from '../observability/logger.js';
import { collectMetrics, formatMetrics } from './metrics.js';
import { createRateLimiter } from './rate-limit.js';
import { createTokenValidator } from './auth-tokens.js';
import { GoalStore } from './goal-store.js';
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile, searchFiles, FsApiError, } from './ide/fs-api.js';
import { gitStatus, gitDiff, gitFileContent, gitStage, gitUnstage, gitCommit, gitLog, gitBlame, } from './git/api.js';
// ─── Static file helpers ───────────────────────────────────────────────────
const MIME_MAP = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
};
function resolveDefaultStaticDir() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        return path.join(path.dirname(__filename), 'telegram', 'app');
    }
    catch (_a) {
        // Fallback for environments where import.meta.url is unavailable
        return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'app');
    }
}
function resolveDefaultIdeStaticDir() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        return path.join(path.dirname(__filename), 'telegram', 'ide');
    }
    catch (_a) {
        return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'ide');
    }
}
function serveStaticFile(res, staticDir, filePath) {
    var _a;
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
    const contentType = (_a = MIME_MAP[ext]) !== null && _a !== void 0 ? _a : 'application/octet-stream';
    const body = readFileSync(full);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
    res.end(body);
}
// ─── Approval-settings helpers ─────────────────────────────────────────────
function readApprovalSettings(settingsPath) {
    try {
        const raw = readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (_a) {
        return {};
    }
}
function saveApprovalSettings(settingsPath, settings) {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSyncNode(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}
// ─── Gateway Helpers ───────────────────────────────────────────────────────
function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
}
function sendText(res, status, body, contentType) {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}
/** Safe JSON parse — returns the parsed value or null on syntax error. */
function tryParseJson(raw) {
    try {
        return { ok: true, value: JSON.parse(raw || '{}') };
    }
    catch (_a) {
        return { ok: false };
    }
}
// ─── Helpers ───────────────────────────────────────────────────────────────
function buildValidator(config) {
    return createTokenValidator({
        bearerToken: config.gateway.bearerToken,
        bearerTokens: config.gateway.bearerTokens,
    });
}
// ─── IDE helpers ────────────────────────────────────────────────────────────
/** Map FsApiError.code to HTTP status. */
function fsErrStatus(code) {
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
function sendFsError(res, err) {
    sendJson(res, fsErrStatus(err.code), { error: err.message, code: err.code });
}
/**
 * Exec timeout in milliseconds. Exported so tests can override it via
 * the `execTimeoutMs` field in GatewayDeps.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 30000;
/** Max bytes captured per stream (stdout / stderr). */
const EXEC_MAX_OUTPUT = 100000;
/**
 * Run an external command with a timeout. Does NOT use shell:true unless the
 * command string starts with "bash -c " or "sh -c ", in which case the shell
 * is invoked with a single argument (the rest of the string).
 *
 * Returns stdout, stderr, exitCode, and durationMs.
 * On timeout: kills the process, sets exitCode = -1, stderr = 'TIMEOUT'.
 */
function runExec(command, cwd, timeoutMs) {
    return new Promise((resolve) => {
        var _a;
        const t0 = Date.now();
        let file;
        let args;
        let useShell = false;
        // Allow explicit shell invocation via "bash -c <script>" or "sh -c <script>"
        const shellMatch = command.match(/^(bash|sh)\s+-c\s+([\s\S]+)$/);
        if (shellMatch) {
            file = shellMatch[1];
            args = ['-c', shellMatch[2]];
            useShell = false; // We're calling bash/sh directly — still no shell:true
        }
        else {
            // Simple whitespace tokenizer — handles quoted strings naively
            const tokens = tokenize(command);
            file = (_a = tokens[0]) !== null && _a !== void 0 ? _a : '';
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
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
            if (stdout.length > EXEC_MAX_OUTPUT) {
                stdout = stdout.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
            }
        });
        child.stderr.on('data', (chunk) => {
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
            }
            else {
                resolve({ stdout, stderr, exitCode: code !== null && code !== void 0 ? code : 0, durationMs });
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
function tokenize(cmd) {
    const tokens = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < cmd.length; i++) {
        const ch = cmd[i];
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === ' ' && !inSingle && !inDouble) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (current)
        tokens.push(current);
    return tokens;
}
// ─── Factory ───────────────────────────────────────────────────────────────
export function createRuntimeGateway(deps) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { config, runtime, health, cron } = deps;
    // Mini App dependencies
    const goalStore = (_a = deps.goalStore) !== null && _a !== void 0 ? _a : new GoalStore();
    const approvalSettingsPath = (_b = deps.approvalSettingsPath) !== null && _b !== void 0 ? _b : path.join(homedir(), '.pyrfor', 'approval-settings.json');
    const STATIC_DIR = (_c = deps.staticDir) !== null && _c !== void 0 ? _c : resolveDefaultStaticDir();
    const IDE_STATIC_DIR = (_d = deps.ideStaticDir) !== null && _d !== void 0 ? _d : resolveDefaultIdeStaticDir();
    // ─── IDE filesystem config ─────────────────────────────────────────────
    const fsConfig = {
        workspaceRoot: (_e = config.workspaceRoot) !== null && _e !== void 0 ? _e : path.join(homedir(), '.openclaw', 'workspace'),
    };
    const execTimeout = (_f = deps.execTimeoutMs) !== null && _f !== void 0 ? _f : DEFAULT_EXEC_TIMEOUT_MS;
    const ptyManager = new PtyManager();
    // Build token validator from config. Rebuilt on each request is fine for v1
    // (config is passed in at construction time). For hot-reload, callers should
    // reconstruct the gateway or we'd need an onConfigChange hook — deferred to v2.
    const tokenValidator = buildValidator(config);
    const requireAuth = !!(config.gateway.bearerToken) ||
        ((_h = (_g = config.gateway.bearerTokens) === null || _g === void 0 ? void 0 : _g.length) !== null && _h !== void 0 ? _h : 0) > 0;
    // ─── Rate limiter ──────────────────────────────────────────────────────
    const rlCfg = config.rateLimit;
    let rateLimiter = null;
    if (rlCfg === null || rlCfg === void 0 ? void 0 : rlCfg.enabled) {
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
    function checkAuth(req) {
        if (!requireAuth)
            return { ok: true };
        const authHeader = req.headers['authorization'];
        if (!authHeader)
            return { ok: false, reason: 'unknown' };
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
    const server = createServer((req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12;
        const parsed = parseUrl((_d = req.url) !== null && _d !== void 0 ? _d : '/', true);
        const method = (_e = req.method) !== null && _e !== void 0 ? _e : 'GET';
        const pathname = (_f = parsed.pathname) !== null && _f !== void 0 ? _f : '/';
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
            const exemptPaths = (_g = rlCfg === null || rlCfg === void 0 ? void 0 : rlCfg.exemptPaths) !== null && _g !== void 0 ? _g : ['/ping', '/health', '/metrics'];
            if (!exemptPaths.includes(pathname)) {
                const authHeader = req.headers['authorization'];
                const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : undefined;
                const ip = (_h = req.socket.remoteAddress) !== null && _h !== void 0 ? _h : 'unknown';
                const rlKey = token !== null && token !== void 0 ? token : ip;
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
            const status = snapshot == null || snapshot.status === 'healthy' || snapshot.status === 'degraded'
                ? 200
                : 503;
            sendJson(res, status, snapshot !== null && snapshot !== void 0 ? snapshot : { status: 'unknown' });
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
                let costToday = null;
                try {
                    const rStats = (_k = (_j = runtime).getStats) === null || _k === void 0 ? void 0 : _k.call(_j);
                    sessionsCount = (_m = (_l = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _l === void 0 ? void 0 : _l.active) !== null && _m !== void 0 ? _m : 0;
                }
                catch ( /* not critical */_13) { /* not critical */ }
                const activeGoals = goalStore.list('active').slice(0, 3);
                const recentActivity = goalStore.list().slice(-10).reverse();
                const model = (_p = (_o = config.providers) === null || _o === void 0 ? void 0 : _o.defaultProvider) !== null && _p !== void 0 ? _p : 'unknown';
                sendJson(res, 200, {
                    status: 'running',
                    model,
                    costToday,
                    sessionsCount,
                    activeGoals,
                    recentActivity,
                });
            }
            catch (err) {
                sendJson(res, 500, { error: 'Internal server error' });
            }
            return;
        }
        if (pathname === '/api/goals' && method === 'GET') {
            sendJson(res, 200, goalStore.list());
            return;
        }
        if (pathname === '/api/goals' && method === 'POST') {
            const raw = yield readBody(req);
            const parsed2 = tryParseJson(raw);
            if (!parsed2.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body2 = parsed2.value;
            const desc = body2.title || body2.description;
            if (!desc) {
                sendJson(res, 400, { error: 'title required' });
                return;
            }
            const goal = goalStore.create(desc);
            sendJson(res, 200, goal);
            return;
        }
        // POST /api/goals/:id/done
        const goalDoneMatch = pathname.match(/^\/api\/goals\/([^/]+)\/done$/);
        if (goalDoneMatch && method === 'POST') {
            const id = goalDoneMatch[1];
            const updated = goalStore.markDone(id);
            if (!updated) {
                sendJson(res, 404, { error: 'Goal not found' });
                return;
            }
            sendJson(res, 200, updated);
            return;
        }
        // DELETE /api/goals/:id
        const goalDeleteMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
        if (goalDeleteMatch && method === 'DELETE') {
            const id = goalDeleteMatch[1];
            const updated = goalStore.cancel(id);
            if (!updated) {
                sendJson(res, 404, { error: 'Goal not found' });
                return;
            }
            sendJson(res, 200, updated);
            return;
        }
        if (pathname === '/api/agents' && method === 'GET') {
            // TODO: expose subagents API from PyrforRuntime (currently returns empty array)
            sendJson(res, 200, []);
            return;
        }
        if (pathname === '/api/memory' && method === 'GET') {
            const memoryPath = path.join(homedir(), '.openclaw', 'workspace', 'MEMORY.md');
            let lines = [];
            try {
                const content = readFileSync(memoryPath, 'utf-8');
                const allLines = content.split('\n');
                lines = allLines.slice(-50);
            }
            catch ( /* file may not exist */_14) { /* file may not exist */ }
            let files = [];
            try {
                const wsDir = path.join(homedir(), '.openclaw', 'workspace');
                files = readdirSync(wsDir).filter(f => !f.startsWith('.'));
            }
            catch ( /* dir may not exist */_15) { /* dir may not exist */ }
            sendJson(res, 200, { lines, files });
            return;
        }
        if (pathname === '/api/settings' && method === 'GET') {
            const settings = readApprovalSettings(approvalSettingsPath);
            sendJson(res, 200, {
                defaultAction: (_q = settings.defaultAction) !== null && _q !== void 0 ? _q : 'ask',
                whitelist: (_r = settings.whitelist) !== null && _r !== void 0 ? _r : [],
                blacklist: (_s = settings.blacklist) !== null && _s !== void 0 ? _s : [],
                autoApprovePatterns: (_t = settings.autoApprovePatterns) !== null && _t !== void 0 ? _t : [],
                provider: (_v = (_u = config.providers) === null || _u === void 0 ? void 0 : _u.defaultProvider) !== null && _v !== void 0 ? _v : null,
            });
            return;
        }
        if (pathname === '/api/settings' && method === 'POST') {
            const raw = yield readBody(req);
            const parsedS = tryParseJson(raw);
            if (!parsedS.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const updates = parsedS.value;
            const current = readApprovalSettings(approvalSettingsPath);
            if (updates.defaultAction !== undefined) {
                const valid = ['approve', 'ask', 'deny'];
                if (!valid.includes(updates.defaultAction)) {
                    sendJson(res, 400, { error: 'invalid defaultAction' });
                    return;
                }
                current.defaultAction = updates.defaultAction;
            }
            if (Array.isArray(updates.whitelist))
                current.whitelist = updates.whitelist;
            if (Array.isArray(updates.blacklist))
                current.blacklist = updates.blacklist;
            try {
                saveApprovalSettings(approvalSettingsPath, current);
                sendJson(res, 200, { ok: true, settings: current });
            }
            catch (err) {
                sendJson(res, 500, { error: 'Failed to save settings' });
            }
            return;
        }
        if (pathname === '/api/stats' && method === 'GET') {
            let sessionsCount = 0;
            try {
                const rStats = (_x = (_w = runtime).getStats) === null || _x === void 0 ? void 0 : _x.call(_w);
                sessionsCount = (_z = (_y = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _y === void 0 ? void 0 : _y.active) !== null && _z !== void 0 ? _z : 0;
            }
            catch ( /* not critical */_16) { /* not critical */ }
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
            const raw = yield readBody(req);
            const parsedCreds = tryParseJson(raw);
            if (!parsedCreds.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const creds = parsedCreds.value;
            for (const [k, v] of Object.entries(creds)) {
                if (typeof v === 'string') {
                    // "provider:anthropic" → "PYRFOR_PROVIDER_ANTHROPIC"
                    const envKey = 'PYRFOR_PROVIDER_' +
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
            sendJson(res, 401, { error: 'unauthorized', reason: (_0 = authResult.reason) !== null && _0 !== void 0 ? _0 : 'unknown' });
            return;
        }
        try {
            // GET /status
            if (method === 'GET' && pathname === '/status') {
                const snapshot = (_1 = health === null || health === void 0 ? void 0 : health.getLastSnapshot()) !== null && _1 !== void 0 ? _1 : null;
                const cronStatus = (_2 = cron === null || cron === void 0 ? void 0 : cron.getStatus()) !== null && _2 !== void 0 ? _2 : null;
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
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const payload = parsed.value;
                if (!payload.name) {
                    sendJson(res, 400, { error: 'name required' });
                    return;
                }
                if (!cron) {
                    sendJson(res, 503, { error: 'CronService not available' });
                    return;
                }
                try {
                    yield cron.triggerJob(payload.name);
                    sendJson(res, 200, { ok: true, name: payload.name });
                }
                catch (err) {
                    sendJson(res, 404, {
                        error: err instanceof Error ? err.message : 'Job not found',
                    });
                }
                return;
            }
            // POST /v1/chat/completions  (OpenAI-compatible)
            if (method === 'POST' && pathname === '/v1/chat/completions') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const payload = parsed.value;
                const messages = (_3 = payload.messages) !== null && _3 !== void 0 ? _3 : [];
                const lastMessage = messages[messages.length - 1];
                if (!(lastMessage === null || lastMessage === void 0 ? void 0 : lastMessage.content)) {
                    sendJson(res, 400, { error: 'messages must contain at least one entry with content' });
                    return;
                }
                const channel = ((_4 = payload.channel) !== null && _4 !== void 0 ? _4 : 'api');
                const userId = (_5 = payload.userId) !== null && _5 !== void 0 ? _5 : 'gateway-user';
                const chatId = (_6 = payload.chatId) !== null && _6 !== void 0 ? _6 : 'gateway-chat';
                const result = yield runtime.handleMessage(channel, userId, chatId, lastMessage.content);
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
                const relPath = (_7 = query['path']) !== null && _7 !== void 0 ? _7 : '';
                try {
                    const result = yield listDir(fsConfig, relPath);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // GET /api/fs/read?path=<relPath>
            if (method === 'GET' && pathname === '/api/fs/read') {
                const relPath = (_8 = query['path']) !== null && _8 !== void 0 ? _8 : '';
                if (!relPath) {
                    sendJson(res, 400, { error: 'path query param required', code: 'EINVAL' });
                    return;
                }
                try {
                    const result = yield fsReadFile(fsConfig, relPath);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // PUT /api/fs/write  body: {path, content}
            if (method === 'PUT' && pathname === '/api/fs/write') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.path) {
                    sendJson(res, 400, { error: 'path required', code: 'EINVAL' });
                    return;
                }
                if (body.content === undefined) {
                    sendJson(res, 400, { error: 'content required', code: 'EINVAL' });
                    return;
                }
                try {
                    const result = yield fsWriteFile(fsConfig, body.path, body.content);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // POST /api/fs/search  body: {query, maxHits?, path?}
            if (method === 'POST' && pathname === '/api/fs/search') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.query) {
                    sendJson(res, 400, { error: 'query required', code: 'EINVAL' });
                    return;
                }
                try {
                    const result = yield searchFiles(fsConfig, body.query, {
                        maxHits: body.maxHits,
                        relPath: body.path,
                    });
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // POST /api/chat  body: {userId?, chatId?, text}
            if (method === 'POST' && pathname === '/api/chat') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.text) {
                    sendJson(res, 400, { error: 'text required' });
                    return;
                }
                const userId = (_9 = body.userId) !== null && _9 !== void 0 ? _9 : 'ide-user';
                const chatId = (_10 = body.chatId) !== null && _10 !== void 0 ? _10 : 'ide-chat';
                try {
                    const result = yield runtime.handleMessage('http', userId, chatId, body.text);
                    sendJson(res, 200, { reply: result.response });
                }
                catch (err) {
                    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
                }
                return;
            }
            // POST /api/chat/stream  body: {text, openFiles?, workspace?, sessionId?}
            if (method === 'POST' && pathname === '/api/chat/stream') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'invalid_json' }));
                    return;
                }
                const body = parsed.value;
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
                const writeSSE = (eventName, data) => {
                    if (eventName)
                        res.write(`event: ${eventName}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                };
                try {
                    try {
                        for (var _17 = true, _18 = __asyncValues(runtime.streamChatRequest({
                            text: body.text,
                            openFiles: body.openFiles,
                            workspace: body.workspace,
                            sessionId: body.sessionId,
                        })), _19; _19 = yield _18.next(), _a = _19.done, !_a; _17 = true) {
                            _c = _19.value;
                            _17 = false;
                            const event = _c;
                            writeSSE(null, event);
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (!_17 && !_a && (_b = _18.return)) yield _b.call(_18);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    writeSSE('done', {});
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'Internal error';
                    writeSSE('error', { message });
                }
                finally {
                    res.end();
                }
                return;
            }
            // POST /api/exec  body: {command, cwd?}
            if (method === 'POST' && pathname === '/api/exec') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.command) {
                    sendJson(res, 400, { error: 'command required' });
                    return;
                }
                // Resolve cwd: must be inside workspaceRoot
                let execCwd;
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
                }
                else {
                    execCwd = path.resolve(fsConfig.workspaceRoot);
                }
                const result = yield runExec(body.command, execCwd, execTimeout);
                sendJson(res, 200, result);
                return;
            }
            // ─── Git routes ───────────────────────────────────────────────────────
            // GET /api/git/status?workspace=...
            if (method === 'GET' && pathname === '/api/git/status') {
                const workspace = query['workspace'];
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                try {
                    const result = yield gitStatus(workspace);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/diff?workspace=...&path=...&staged=0|1
            if (method === 'GET' && pathname === '/api/git/diff') {
                const workspace = query['workspace'];
                const filePath = query['path'];
                const staged = query['staged'] === '1';
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                if (!filePath) {
                    sendJson(res, 400, { error: 'path query param required' });
                    return;
                }
                try {
                    const diff = yield gitDiff(workspace, filePath, staged);
                    sendJson(res, 200, { diff });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/file?workspace=...&path=...&ref=HEAD
            if (method === 'GET' && pathname === '/api/git/file') {
                const workspace = query['workspace'];
                const filePath = query['path'];
                const ref = (_11 = query['ref']) !== null && _11 !== void 0 ? _11 : 'HEAD';
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                if (!filePath) {
                    sendJson(res, 400, { error: 'path query param required' });
                    return;
                }
                try {
                    const content = yield gitFileContent(workspace, filePath, ref);
                    sendJson(res, 200, { content });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/git/stage  body: {workspace, paths}
            if (method === 'POST' && pathname === '/api/git/stage') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.workspace) {
                    sendJson(res, 400, { error: 'workspace required' });
                    return;
                }
                if (!Array.isArray(body.paths) || body.paths.length === 0) {
                    sendJson(res, 400, { error: 'paths must be a non-empty array' });
                    return;
                }
                try {
                    yield gitStage(body.workspace, body.paths);
                    sendJson(res, 200, { ok: true });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/git/unstage  body: {workspace, paths}
            if (method === 'POST' && pathname === '/api/git/unstage') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.workspace) {
                    sendJson(res, 400, { error: 'workspace required' });
                    return;
                }
                if (!Array.isArray(body.paths) || body.paths.length === 0) {
                    sendJson(res, 400, { error: 'paths must be a non-empty array' });
                    return;
                }
                try {
                    yield gitUnstage(body.workspace, body.paths);
                    sendJson(res, 200, { ok: true });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/git/commit  body: {workspace, message}
            if (method === 'POST' && pathname === '/api/git/commit') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.workspace) {
                    sendJson(res, 400, { error: 'workspace required' });
                    return;
                }
                if (!body.message || !body.message.trim()) {
                    sendJson(res, 400, { error: 'message must not be empty' });
                    return;
                }
                try {
                    const result = yield gitCommit(body.workspace, body.message);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/log?workspace=...&limit=50
            if (method === 'GET' && pathname === '/api/git/log') {
                const workspace = query['workspace'];
                const limit = parseInt((_12 = query['limit']) !== null && _12 !== void 0 ? _12 : '50', 10);
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                try {
                    const entries = yield gitLog(workspace, isNaN(limit) ? 50 : limit);
                    sendJson(res, 200, { entries });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/blame?workspace=...&path=...
            if (method === 'GET' && pathname === '/api/git/blame') {
                const workspace = query['workspace'];
                const filePath = query['path'];
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                if (!filePath) {
                    sendJson(res, 400, { error: 'path query param required' });
                    return;
                }
                try {
                    const entries = yield gitBlame(workspace, filePath);
                    sendJson(res, 200, { entries });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/pty/spawn  body: {cwd, shell?, cols?, rows?}
            if (method === 'POST' && pathname === '/api/pty/spawn') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.cwd) {
                    sendJson(res, 400, { error: 'cwd required' });
                    return;
                }
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
                const ptyId = ptyResizeMatch[1];
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.cols || !body.rows) {
                    sendJson(res, 400, { error: 'cols and rows required' });
                    return;
                }
                try {
                    ptyManager.resize(ptyId, body.cols, body.rows);
                    res.writeHead(204);
                    res.end();
                }
                catch (_20) {
                    sendJson(res, 404, { error: 'PTY not found' });
                }
                return;
            }
            // DELETE /api/pty/:id
            const ptyDeleteMatch = pathname.match(/^\/api\/pty\/([^/]+)$/);
            if (ptyDeleteMatch && method === 'DELETE') {
                const ptyId = ptyDeleteMatch[1];
                ptyManager.kill(ptyId);
                res.writeHead(204);
                res.end();
                return;
            }
            // 404 fallback
            sendJson(res, 404, { error: 'Not found', path: pathname });
        }
        catch (err) {
            logger.error(`[gateway] Route error ${method} ${pathname}`, {
                error: err instanceof Error ? err.message : String(err),
            });
            sendJson(res, 500, { error: 'Internal server error' });
        }
    }));
    // ─── WebSocket server (PTY streams) ────────────────────────────────────
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', (ws, ptyId) => {
        const onData = (id, data) => {
            if (id !== ptyId)
                return;
            try {
                ws.send(data);
            }
            catch ( /* closed */_a) { /* closed */ }
        };
        ptyManager.on('data', onData);
        const onExit = (id) => {
            if (id !== ptyId)
                return;
            ptyManager.off('data', onData);
            ptyManager.off('exit', onExit);
            try {
                ws.close();
            }
            catch ( /* already closed */_a) { /* already closed */ }
        };
        ptyManager.on('exit', onExit);
        ws.on('message', (msg) => {
            try {
                ptyManager.write(ptyId, msg.toString());
            }
            catch ( /* pty gone */_a) { /* pty gone */ }
        });
        ws.on('close', () => {
            ptyManager.off('data', onData);
            ptyManager.off('exit', onExit);
            try {
                ptyManager.kill(ptyId);
            }
            catch ( /* already gone */_a) { /* already gone */ }
        });
    });
    server.on('upgrade', (request, socket, head) => {
        var _a, _b;
        const parsed2 = parseUrl((_a = request.url) !== null && _a !== void 0 ? _a : '/');
        const wsMatch = ((_b = parsed2.pathname) !== null && _b !== void 0 ? _b : '').match(/^\/ws\/pty\/([^/]+)$/);
        if (!wsMatch) {
            socket.destroy();
            return;
        }
        const ptyId = wsMatch[1];
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
    function resolveBindPort() {
        if (deps.portOverride !== undefined)
            return deps.portOverride;
        const envVal = process.env['PYRFOR_PORT'];
        if (envVal !== undefined && envVal !== '') {
            const p = parseInt(envVal, 10);
            if (!isNaN(p) && p >= 0)
                return p;
        }
        return config.gateway.port;
    }
    return {
        start() {
            return new Promise((resolve, reject) => {
                var _a;
                const host = (_a = config.gateway.host) !== null && _a !== void 0 ? _a : '127.0.0.1';
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
        stop() {
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
        get port() {
            const addr = server.address();
            if (addr && typeof addr === 'object')
                return addr.port;
            return resolveBindPort();
        },
    };
}
