import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { parseCliArgs, runCli } from './index';

function makeIo() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
  } as Response;
}

describe('@pyrfor/cli', () => {
  it('parses concept command options', () => {
    expect(parseCliArgs(['concept', 'build', 'API', '--dry-run', '--workspace', 'ws-1'], {})).toEqual({
      kind: 'concept',
      goal: 'build API',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        dryRun: true,
        workspaceId: 'ws-1',
      },
    });
  });

  it('dispatches concept to the M8 gateway', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      conceptId: 'concept-1',
      runId: 'run-1',
      status: 'queued',
    }));

    const code = await runCli({
      argv: ['concept', 'add dark mode', '--gateway-url', 'http://127.0.0.1:19000', '--dry-run'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:19000/api/concepts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ goal: 'add dark mode', dryRun: true }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('Concept concept-1 queued (queued)\n');
  });

  it('uses plan as a dry-run concept alias', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ conceptId: 'plan-1', status: 'queued' }));

    const code = await runCli({
      argv: ['plan', 'design API', '--json'],
      env: { PYRFOR_GATEWAY_URL: 'http://gateway.test/' },
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://gateway.test/api/concepts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ goal: 'design API', dryRun: true }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith(`${JSON.stringify({ conceptId: 'plan-1', status: 'queued' }, null, 2)}\n`);
  });

  it('reads concept status', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ conceptId: 'concept-1', status: 'done' }));

    const code = await runCli({
      argv: ['status', 'concept-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/concepts/concept-1', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Concept concept-1: done\n');
  });

  it('requests concept abort', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ conceptId: 'concept-1', aborted: true }));

    const code = await runCli({
      argv: ['abort', 'concept-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/concepts/concept-1', expect.objectContaining({ method: 'DELETE' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Concept concept-1 abort requested\n');
  });

  it('adds bearer token from environment', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ conceptId: 'concept-1', status: 'queued' }));

    await runCli({
      argv: ['concept', 'secure task'],
      env: { PYRFOR_GATEWAY_TOKEN: 'secret-token' },
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
    }));
  });

  it('returns non-zero on gateway errors', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'universal_engine_unavailable' }, {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }));

    const code = await runCli({
      argv: ['concept', 'task'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith('Gateway request failed (503): universal_engine_unavailable\n');
  });

  it('dispatches through a local HTTP gateway endpoint', async () => {
    const requests: Array<{ url?: string; method?: string; body: unknown }> = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += String(chunk); });
      req.on('end', () => {
        requests.push({
          url: req.url,
          method: req.method,
          body: raw ? JSON.parse(raw) : undefined,
        });
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ conceptId: 'local-concept', runId: 'local-run', status: 'queued' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');

    const io = makeIo();
    try {
      const code = await runCli({
        argv: ['concept', 'local gateway task', '--gateway-url', `http://127.0.0.1:${address.port}`],
        env: {},
        io,
      });

      expect(code).toBe(0);
      expect(requests).toEqual([{
        url: '/api/concepts',
        method: 'POST',
        body: { goal: 'local gateway task' },
      }]);
      expect(io.stdout.write).toHaveBeenCalledWith('Concept local-concept queued (queued)\n');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });
});
