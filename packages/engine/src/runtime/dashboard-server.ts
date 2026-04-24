import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { URL } from 'node:url';

// ============================================================
// Public types
// ============================================================

export interface DashboardSourceProviders {
  skills?: () => Promise<any[]> | any[];
  autoTools?: () => Promise<any[]> | any[];
  trajectories?: (opts?: { limit?: number; sinceMs?: number }) => Promise<any[]> | any[];
  patterns?: () => Promise<any[]> | any[];
  costSummary?: () => Promise<any> | any;
  experiments?: () => Promise<any[]> | any[];
  memorySummary?: () => Promise<any> | any;
}

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  basePath?: string;
  authToken?: string;
  providers: DashboardSourceProviders;
  cacheTtlMs?: number;
  clock?: () => number;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}

export interface DashboardServer {
  start(): Promise<{ url: string; port: number }>;
  stop(): Promise<void>;
  url(): string;
  routes(): string[];
  invalidateCache(key?: string): void;
}

// ============================================================
// Internal types
// ============================================================

interface CacheEntry {
  ts: number;
  value: unknown;
}

// ============================================================
// Factory
// ============================================================

export function createDashboardServer(opts: DashboardServerOptions): DashboardServer {
  const {
    port: desiredPort = 0,
    host = '127.0.0.1',
    basePath = '/',
    authToken,
    providers,
    cacheTtlMs = 5000,
    clock = () => Date.now(),
    logger: log = () => {},
  } = opts;

  // Normalise basePath so we can prefix route matching
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;

  const cache = new Map<string, CacheEntry>();
  let httpServer: HttpServer | null = null;
  let startedUrl = '';
  let startedPort = 0;

  // --------------------------------------------------------
  // Helpers
  // --------------------------------------------------------

  function send(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(json);
  }

  function sendHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  function checkAuth(req: IncomingMessage): boolean {
    if (!authToken) return true;
    const header = Object.entries(req.headers).find(
      ([k]) => k.toLowerCase() === 'authorization',
    );
    const value = header ? (Array.isArray(header[1]) ? header[1][0] : header[1]) : '';
    return value === `Bearer ${authToken}`;
  }

  async function withCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = clock();
    const entry = cache.get(key);
    if (entry && now - entry.ts < cacheTtlMs) {
      return entry.value as T;
    }
    const value = await fn();
    cache.set(key, { ts: now, value });
    return value;
  }

  async function handleRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') {
      send(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    if (!checkAuth(req)) {
      send(res, 401, { error: 'Unauthorized' });
      return;
    }

    const rawUrl = req.url ?? '/';
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
      sendHtml(
        res,
        `<!DOCTYPE html><html><head><title>Pyrfor Dashboard</title></head><body>
<h1>Pyrfor Life Dashboard</h1>
<ul>
${listed}
</ul>
</body></html>`,
      );
      return;
    }

    // ---- /skills ----
    if (stripped === '/skills') {
      if (!providers.skills) { send(res, 503, { error: 'provider not configured' }); return; }
      try {
        const data = await withCache(cacheKey, () => Promise.resolve(providers.skills!()));
        send(res, 200, data ?? null);
      } catch (e: any) {
        log('warn', 'skills provider error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- /tools/auto ----
    if (stripped === '/tools/auto') {
      if (!providers.autoTools) { send(res, 503, { error: 'provider not configured' }); return; }
      try {
        const data = await withCache(cacheKey, () => Promise.resolve(providers.autoTools!()));
        send(res, 200, data ?? null);
      } catch (e: any) {
        log('warn', 'autoTools provider error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- /trajectories ----
    if (stripped === '/trajectories') {
      if (!providers.trajectories) { send(res, 503, { error: 'provider not configured' }); return; }
      const limitParam = parsed.searchParams.get('limit');
      const sinceParam = parsed.searchParams.get('sinceMs');
      const trajOpts: { limit?: number; sinceMs?: number } = {};
      if (limitParam !== null) trajOpts.limit = parseInt(limitParam, 10);
      if (sinceParam !== null) trajOpts.sinceMs = parseInt(sinceParam, 10);
      try {
        const data = await withCache(cacheKey, () => Promise.resolve(providers.trajectories!(trajOpts)));
        send(res, 200, data ?? null);
      } catch (e: any) {
        log('warn', 'trajectories provider error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- /patterns ----
    if (stripped === '/patterns') {
      if (!providers.patterns) { send(res, 503, { error: 'provider not configured' }); return; }
      try {
        const data = await withCache(cacheKey, () => Promise.resolve(providers.patterns!()));
        send(res, 200, data ?? null);
      } catch (e: any) {
        log('warn', 'patterns provider error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- /cost ----
    if (stripped === '/cost') {
      if (!providers.costSummary) { send(res, 503, { error: 'provider not configured' }); return; }
      try {
        const data = await withCache(cacheKey, () => Promise.resolve(providers.costSummary!()));
        send(res, 200, data ?? null);
      } catch (e: any) {
        log('warn', 'costSummary provider error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- /experiments ----
    if (stripped === '/experiments') {
      if (!providers.experiments) { send(res, 503, { error: 'provider not configured' }); return; }
      try {
        const data = await withCache(cacheKey, () => Promise.resolve(providers.experiments!()));
        send(res, 200, data ?? null);
      } catch (e: any) {
        log('warn', 'experiments provider error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- /memory ----
    if (stripped === '/memory') {
      if (!providers.memorySummary) { send(res, 503, { error: 'provider not configured' }); return; }
      try {
        const data = await withCache(cacheKey, () => Promise.resolve(providers.memorySummary!()));
        send(res, 200, data ?? null);
      } catch (e: any) {
        log('warn', 'memorySummary provider error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- /summary ----
    if (stripped === '/summary') {
      try {
        const [skills, autoTools, trajectories, experiments, cost] = await Promise.all([
          providers.skills
            ? withCache('/skills', () => Promise.resolve(providers.skills!())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
            : Promise.resolve(0),
          providers.autoTools
            ? withCache('/tools/auto', () => Promise.resolve(providers.autoTools!())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
            : Promise.resolve(0),
          providers.trajectories
            ? withCache('/trajectories', () => Promise.resolve(providers.trajectories!())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
            : Promise.resolve(0),
          providers.experiments
            ? withCache('/experiments', () => Promise.resolve(providers.experiments!())).then(d => (Array.isArray(d) ? d.length : 0)).catch(() => 0)
            : Promise.resolve(0),
          providers.costSummary
            ? withCache('/cost', () => Promise.resolve(providers.costSummary!())).catch(() => null)
            : Promise.resolve(null),
        ]);
        const costUsd =
          cost != null && typeof cost === 'object' && 'totalUsd' in cost
            ? (cost as any).totalUsd
            : cost != null && typeof cost === 'number'
              ? cost
              : null;
        send(res, 200, { skills, autoTools, trajectories, costUsd, experiments });
      } catch (e: any) {
        log('warn', 'summary error', e);
        send(res, 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    send(res, 404, { error: 'Not Found' });
  }

  // --------------------------------------------------------
  // Registered route list (for routes() and root page)
  // --------------------------------------------------------

  const registeredRoutes: string[] = [
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
    async start() {
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

      await new Promise<void>((resolve, reject) => {
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
    },

    async stop() {
      if (!httpServer) return;
      const server = httpServer;
      httpServer = null;
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    },

    url() {
      return startedUrl;
    },

    routes() {
      return registeredRoutes.map(r => `${base}${r === '/' ? '' : r}`);
    },

    invalidateCache(key?: string) {
      if (key === undefined) {
        cache.clear();
      } else {
        cache.delete(key);
      }
    },
  };
}
