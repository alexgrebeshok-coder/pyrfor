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
import { createServer } from 'http';
import { parse as parseUrl } from 'url';
import { readFileSync, existsSync, readdirSync, writeFileSync as writeFileSyncNode, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { logger } from '../observability/logger.js';
import { collectMetrics, formatMetrics } from './metrics.js';
import { createRateLimiter } from './rate-limit.js';
import { createTokenValidator } from './auth-tokens.js';
import { GoalStore } from './goal-store.js';
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
// ─── Factory ───────────────────────────────────────────────────────────────
export function createRuntimeGateway(deps) {
    var _a, _b, _c, _d, _e;
    const { config, runtime, health, cron } = deps;
    // Mini App dependencies
    const goalStore = (_a = deps.goalStore) !== null && _a !== void 0 ? _a : new GoalStore();
    const approvalSettingsPath = (_b = deps.approvalSettingsPath) !== null && _b !== void 0 ? _b : path.join(homedir(), '.pyrfor', 'approval-settings.json');
    const STATIC_DIR = (_c = deps.staticDir) !== null && _c !== void 0 ? _c : resolveDefaultStaticDir();
    // Build token validator from config. Rebuilt on each request is fine for v1
    // (config is passed in at construction time). For hot-reload, callers should
    // reconstruct the gateway or we'd need an onConfigChange hook — deferred to v2.
    const tokenValidator = buildValidator(config);
    const requireAuth = !!(config.gateway.bearerToken) ||
        ((_e = (_d = config.gateway.bearerTokens) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0) > 0;
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
        const parsed = parseUrl((_a = req.url) !== null && _a !== void 0 ? _a : '/', true);
        const method = (_b = req.method) !== null && _b !== void 0 ? _b : 'GET';
        const pathname = (_c = parsed.pathname) !== null && _c !== void 0 ? _c : '/';
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
            const exemptPaths = (_d = rlCfg === null || rlCfg === void 0 ? void 0 : rlCfg.exemptPaths) !== null && _d !== void 0 ? _d : ['/ping', '/health', '/metrics'];
            if (!exemptPaths.includes(pathname)) {
                const authHeader = req.headers['authorization'];
                const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : undefined;
                const ip = (_e = req.socket.remoteAddress) !== null && _e !== void 0 ? _e : 'unknown';
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
        // ─── Telegram Mini App API routes (public — auth via X-Telegram-Init-Data, deferred) ──
        if (pathname === '/api/dashboard' && method === 'GET') {
            try {
                let sessionsCount = 0;
                let costToday = 0;
                try {
                    const rStats = (_g = (_f = runtime).getStats) === null || _g === void 0 ? void 0 : _g.call(_f);
                    sessionsCount = (_j = (_h = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _h === void 0 ? void 0 : _h.active) !== null && _j !== void 0 ? _j : 0;
                }
                catch ( /* not critical */_4) { /* not critical */ }
                const activeGoals = goalStore.list('active').slice(0, 3);
                const recentActivity = goalStore.list().slice(-10).reverse();
                const model = (_l = (_k = config.providers) === null || _k === void 0 ? void 0 : _k.defaultProvider) !== null && _l !== void 0 ? _l : 'unknown';
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
            catch ( /* file may not exist */_5) { /* file may not exist */ }
            let files = [];
            try {
                const wsDir = path.join(homedir(), '.openclaw', 'workspace');
                files = readdirSync(wsDir).filter(f => !f.startsWith('.'));
            }
            catch ( /* dir may not exist */_6) { /* dir may not exist */ }
            sendJson(res, 200, { lines, files });
            return;
        }
        if (pathname === '/api/settings' && method === 'GET') {
            const settings = readApprovalSettings(approvalSettingsPath);
            sendJson(res, 200, {
                defaultAction: (_m = settings.defaultAction) !== null && _m !== void 0 ? _m : 'ask',
                whitelist: (_o = settings.whitelist) !== null && _o !== void 0 ? _o : [],
                blacklist: (_p = settings.blacklist) !== null && _p !== void 0 ? _p : [],
                autoApprovePatterns: (_q = settings.autoApprovePatterns) !== null && _q !== void 0 ? _q : [],
                provider: (_s = (_r = config.providers) === null || _r === void 0 ? void 0 : _r.defaultProvider) !== null && _s !== void 0 ? _s : null,
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
                const rStats = (_u = (_t = runtime).getStats) === null || _u === void 0 ? void 0 : _u.call(_t);
                sessionsCount = (_w = (_v = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _v === void 0 ? void 0 : _v.active) !== null && _w !== void 0 ? _w : 0;
            }
            catch ( /* not critical */_7) { /* not critical */ }
            sendJson(res, 200, {
                costToday: 0,
                sessionsCount,
                uptime: process.uptime(),
            });
            return;
        }
        // All other routes require auth
        const authResult = checkAuth(req);
        if (!authResult.ok) {
            sendJson(res, 401, { error: 'unauthorized', reason: (_x = authResult.reason) !== null && _x !== void 0 ? _x : 'unknown' });
            return;
        }
        try {
            // GET /status
            if (method === 'GET' && pathname === '/status') {
                const snapshot = (_y = health === null || health === void 0 ? void 0 : health.getLastSnapshot()) !== null && _y !== void 0 ? _y : null;
                const cronStatus = (_z = cron === null || cron === void 0 ? void 0 : cron.getStatus()) !== null && _z !== void 0 ? _z : null;
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
                const messages = (_0 = payload.messages) !== null && _0 !== void 0 ? _0 : [];
                const lastMessage = messages[messages.length - 1];
                if (!(lastMessage === null || lastMessage === void 0 ? void 0 : lastMessage.content)) {
                    sendJson(res, 400, { error: 'messages must contain at least one entry with content' });
                    return;
                }
                const channel = ((_1 = payload.channel) !== null && _1 !== void 0 ? _1 : 'api');
                const userId = (_2 = payload.userId) !== null && _2 !== void 0 ? _2 : 'gateway-user';
                const chatId = (_3 = payload.chatId) !== null && _3 !== void 0 ? _3 : 'gateway-chat';
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
    // ─── Controls ──────────────────────────────────────────────────────────
    return {
        start() {
            return new Promise((resolve, reject) => {
                var _a;
                const host = (_a = config.gateway.host) !== null && _a !== void 0 ? _a : '127.0.0.1';
                const port = config.gateway.port;
                server.once('error', reject);
                server.listen(port, host, () => {
                    const addr = server.address();
                    const actualPort = addr && typeof addr === 'object' ? addr.port : port;
                    logger.info(`[gateway] Listening on ${host}:${actualPort}`, {
                        auth: requireAuth ? 'bearer' : 'none',
                    });
                    resolve();
                });
            });
        },
        stop() {
            return new Promise((resolve) => {
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
            return config.gateway.port;
        },
    };
}
