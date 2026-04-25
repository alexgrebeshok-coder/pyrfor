var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createServer } from 'node:http';
import { URL } from 'node:url';
// ============================================================
// Factory
// ============================================================
export function createDashboardServer(opts) {
    const { port: desiredPort = 0, host = '127.0.0.1', basePath = '/', authToken, providers, cacheTtlMs = 5000, clock = () => Date.now(), logger: log = () => { }, } = opts;
    // Normalise basePath so we can prefix route matching
    const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    const cache = new Map();
    let httpServer = null;
    let startedUrl = '';
    let startedPort = 0;
    // --------------------------------------------------------
    // Helpers
    // --------------------------------------------------------
    function send(res, status, body) {
        const json = JSON.stringify(body);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(json);
    }
    function sendHtml(res, html) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }
    function checkAuth(req) {
        if (!authToken)
            return true;
        const header = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'authorization');
        const value = header ? (Array.isArray(header[1]) ? header[1][0] : header[1]) : '';
        return value === `Bearer ${authToken}`;
    }
    function withCache(key, fn) {
        return __awaiter(this, void 0, void 0, function* () {
            const now = clock();
            const entry = cache.get(key);
            if (entry && now - entry.ts < cacheTtlMs) {
                return entry.value;
            }
            const value = yield fn();
            cache.set(key, { ts: now, value });
            return value;
        });
    }
    function handleRoute(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            if (req.method !== 'GET') {
                send(res, 405, { error: 'Method Not Allowed' });
                return;
            }
            if (!checkAuth(req)) {
                send(res, 401, { error: 'Unauthorized' });
                return;
            }
            const rawUrl = (_a = req.url) !== null && _a !== void 0 ? _a : '/';
            const parsed = new URL(rawUrl, `http://${host}`);
            const pathname = parsed.pathname;
            // Strip basePath prefix so route matching is relative
            const stripped = base
                ? pathname.startsWith(base)
                    ? pathname.slice(base.length) || '/'
                    : null
                : pathname;
            if (stripped === null) {
                send(res, 404, { error: 'Not Found' });
                return;
            }
            const cacheKey = stripped + parsed.search;
            // ---- /health ----
            if (stripped === '/health') {
                send(res, 200, { ok: true, ts: clock() });
                return;
            }
            // ---- / (root) ----
            if (stripped === '/') {
                const listed = registeredRoutes.map(r => `<li><a href="${base}${r}">${base}${r}</a></li>`).join('\n');
                sendHtml(res, `<!DOCTYPE html><html><head><title>Pyrfor Dashboard</title></head><body>
<h1>Pyrfor Life Dashboard</h1>
<ul>
${listed}
</ul>
</body></html>`);
                return;
            }
            // ---- /skills ----
            if (stripped === '/skills') {
                if (!providers.skills) {
                    send(res, 503, { error: 'provider not configured' });
                    return;
                }
                try {
                    const data = yield withCache(cacheKey, () => Promise.resolve(providers.skills()));
                    send(res, 200, data !== null && data !== void 0 ? data : null);
                }
                catch (e) {
                    log('warn', 'skills provider error', e);
                    send(res, 500, { error: (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e) });
                }
                return;
            }
            // ---- /tools/auto ----
            if (stripped === '/tools/auto') {
                if (!providers.autoTools) {
                    send(res, 503, { error: 'provider not configured' });
                    return;
                }
                try {
                    const data = yield withCache(cacheKey, () => Promise.resolve(providers.autoTools()));
                    send(res, 200, data !== null && data !== void 0 ? data : null);
                }
                catch (e) {
                    log('warn', 'autoTools provider error', e);
                    send(res, 500, { error: (_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : String(e) });
                }
                return;
            }
            // ---- /trajectories ----
            if (stripped === '/trajectories') {
                if (!providers.trajectories) {
                    send(res, 503, { error: 'provider not configured' });
                    return;
                }
                const limitParam = parsed.searchParams.get('limit');
                const sinceParam = parsed.searchParams.get('sinceMs');
                const trajOpts = {};
                if (limitParam !== null)
                    trajOpts.limit = parseInt(limitParam, 10);
                if (sinceParam !== null)
                    trajOpts.sinceMs = parseInt(sinceParam, 10);
                try {
                    const data = yield withCache(cacheKey, () => Promise.resolve(providers.trajectories(trajOpts)));
                    send(res, 200, data !== null && data !== void 0 ? data : null);
                }
                catch (e) {
                    log('warn', 'trajectories provider error', e);
                    send(res, 500, { error: (_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : String(e) });
                }
                return;
            }
            // ---- /patterns ----
            if (stripped === '/patterns') {
                if (!providers.patterns) {
                    send(res, 503, { error: 'provider not configured' });
                    return;
                }
                try {
                    const data = yield withCache(cacheKey, () => Promise.resolve(providers.patterns()));
                    send(res, 200, data !== null && data !== void 0 ? data : null);
                }
                catch (e) {
                    log('warn', 'patterns provider error', e);
                    send(res, 500, { error: (_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : String(e) });
                }
                return;
            }
            // ---- /cost ----
            if (stripped === '/cost') {
                if (!providers.costSummary) {
                    send(res, 503, { error: 'provider not configured' });
                    return;
                }
                try {
                    const data = yield withCache(cacheKey, () => Promise.resolve(providers.costSummary()));
                    send(res, 200, data !== null && data !== void 0 ? data : null);
                }
                catch (e) {
                    log('warn', 'costSummary provider error', e);
                    send(res, 500, { error: (_f = e === null || e === void 0 ? void 0 : e.message) !== null && _f !== void 0 ? _f : String(e) });
                }
                return;
            }
            // ---- /experiments ----
            if (stripped === '/experiments') {
                if (!providers.experiments) {
                    send(res, 503, { error: 'provider not configured' });
                    return;
                }
                try {
                    const data = yield withCache(cacheKey, () => Promise.resolve(providers.experiments()));
                    send(res, 200, data !== null && data !== void 0 ? data : null);
                }
                catch (e) {
                    log('warn', 'experiments provider error', e);
                    send(res, 500, { error: (_g = e === null || e === void 0 ? void 0 : e.message) !== null && _g !== void 0 ? _g : String(e) });
                }
                return;
            }
            // ---- /memory ----
            if (stripped === '/memory') {
                if (!providers.memorySummary) {
                    send(res, 503, { error: 'provider not configured' });
                    return;
                }
                try {
                    const data = yield withCache(cacheKey, () => Promise.resolve(providers.memorySummary()));
                    send(res, 200, data !== null && data !== void 0 ? data : null);
                }
                catch (e) {
                    log('warn', 'memorySummary provider error', e);
                    send(res, 500, { error: (_h = e === null || e === void 0 ? void 0 : e.message) !== null && _h !== void 0 ? _h : String(e) });
                }
                return;
            }
            // ---- /summary ----
            if (stripped === '/summary') {
                try {
                    const [skills, autoTools, trajectories, experiments, cost] = yield Promise.all([
                        providers.skills
                            ? withCache('/skills', () => Promise.resolve(providers.skills())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
                            : Promise.resolve(0),
                        providers.autoTools
                            ? withCache('/tools/auto', () => Promise.resolve(providers.autoTools())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
                            : Promise.resolve(0),
                        providers.trajectories
                            ? withCache('/trajectories', () => Promise.resolve(providers.trajectories())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
                            : Promise.resolve(0),
                        providers.experiments
                            ? withCache('/experiments', () => Promise.resolve(providers.experiments())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
                            : Promise.resolve(0),
                        providers.costSummary
                            ? withCache('/cost', () => Promise.resolve(providers.costSummary())).catch(() => null)
                            : Promise.resolve(null),
                    ]);
                    const costUsd = cost != null && typeof cost === 'object' && 'totalUsd' in cost
                        ? cost.totalUsd
                        : cost != null && typeof cost === 'number'
                            ? cost
                            : null;
                    send(res, 200, { skills, autoTools, trajectories, costUsd, experiments });
                }
                catch (e) {
                    log('warn', 'summary error', e);
                    send(res, 500, { error: (_j = e === null || e === void 0 ? void 0 : e.message) !== null && _j !== void 0 ? _j : String(e) });
                }
                return;
            }
            send(res, 404, { error: 'Not Found' });
        });
    }
    // --------------------------------------------------------
    // Registered route list (for routes() and root page)
    // --------------------------------------------------------
    const registeredRoutes = [
        '/health',
        '/skills',
        '/tools/auto',
        '/trajectories',
        '/patterns',
        '/cost',
        '/experiments',
        '/memory',
        '/summary',
        '/',
    ];
    // --------------------------------------------------------
    // Public DashboardServer object
    // --------------------------------------------------------
    return {
        start() {
            return __awaiter(this, void 0, void 0, function* () {
                if (httpServer !== null) {
                    throw new Error('already started');
                }
                const server = createServer((req, res) => {
                    handleRoute(req, res).catch(e => {
                        log('error', 'unhandled request error', e);
                        if (!res.headersSent) {
                            send(res, 500, { error: 'Internal Server Error' });
                        }
                    });
                });
                // Mark as started immediately to guard concurrent calls
                httpServer = server;
                yield new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(desiredPort, host, () => resolve());
                });
                const addr = server.address();
                if (!addr || typeof addr === 'string') {
                    throw new Error('Could not determine server address');
                }
                startedPort = addr.port;
                startedUrl = `http://${host}:${startedPort}${base}`;
                log('info', `Dashboard server listening at ${startedUrl}`);
                return { url: startedUrl, port: startedPort };
            });
        },
        stop() {
            return __awaiter(this, void 0, void 0, function* () {
                if (!httpServer)
                    return;
                const server = httpServer;
                httpServer = null;
                yield new Promise((resolve, reject) => {
                    server.close(err => (err ? reject(err) : resolve()));
                });
            });
        },
        url() {
            return startedUrl;
        },
        routes() {
            return registeredRoutes.map(r => `${base}${r === '/' ? '' : r}`);
        },
        invalidateCache(key) {
            if (key === undefined) {
                cache.clear();
            }
            else {
                cache.delete(key);
            }
        },
    };
}
