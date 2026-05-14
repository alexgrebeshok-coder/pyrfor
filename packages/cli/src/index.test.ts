import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

  it('parses concept trace and incident export commands', () => {
    expect(parseCliArgs(['concept', 'trace', 'concept-1', '--json'], {})).toEqual({
      kind: 'conceptTrace',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        conceptId: 'concept-1',
      },
    });
    expect(parseCliArgs(['concept', 'export', 'concept-1', '--incident-packet'], {})).toEqual({
      kind: 'conceptExport',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        conceptId: 'concept-1',
        kind: 'incident-packet',
      },
    });
  });

  it('rejects concept export without incident-packet mode', () => {
    expect(() => parseCliArgs(['concept', 'export', 'concept-1'], {})).toThrow('Missing --incident-packet');
  });

  it('parses skills and tools registry commands', () => {
    expect(parseCliArgs(['skills', 'import', './agent/SKILL.md', '--json'], {})).toEqual({
      kind: 'skillsImport',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        sourcePath: './agent/SKILL.md',
      },
    });
    expect(parseCliArgs(['skills', 'list', '--state', 'pending_validation'], {})).toEqual({
      kind: 'skillsList',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        state: 'pending_validation',
      },
    });
    expect(parseCliArgs(['tools', 'registry', 'list', '--status=vetted', '--tag', 'toolforge'], {})).toEqual({
      kind: 'toolsRegistryList',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        status: 'vetted',
        tag: 'toolforge',
      },
    });
  });

  it('parses OpenClaw migration options', () => {
    expect(parseCliArgs([
      'migrate',
      'openclaw',
      '--from',
      '/Users/aleksandrgrebeshok/openclaw-workspace',
      '--import',
      '--project',
      'project-1',
      '--max-files',
      '50',
      '--no-memories',
      '--json',
    ], {})).toEqual({
      kind: 'migrateOpenClaw',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        action: 'import',
        sourcePath: '/Users/aleksandrgrebeshok/openclaw-workspace',
        projectId: 'project-1',
        maxFiles: 50,
        includeMemories: false,
      },
    });
  });

  it('rejects malformed OpenClaw max-files values', () => {
    expect(() => parseCliArgs(['migrate', 'openclaw', '--max-files=50abc'], {})).toThrow('--max-files must be a positive integer');
  });

  it('parses OpenClaw rollback options', () => {
    expect(parseCliArgs([
      'migrate',
      'rollback',
      '--result-artifact-id',
      'openclaw-result-1.json',
      '--expected-result-sha256=sha-openclaw-result',
    ], {})).toEqual({
      kind: 'migrateRollback',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        resultArtifactId: 'openclaw-result-1.json',
        expectedResultSha256: 'sha-openclaw-result',
      },
    });
  });

  it('parses OpenClaw verify options', () => {
    expect(parseCliArgs([
      'migrate',
      'verify',
      '--result-artifact-id=openclaw-result-1.json',
      '--expected-sha256=sha-openclaw-result',
      '--query-limit',
      '25',
      '--json',
    ], {})).toEqual({
      kind: 'migrateVerify',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        resultArtifactId: 'openclaw-result-1.json',
        expectedResultSha256: 'sha-openclaw-result',
        queryLimit: 25,
      },
    });
  });

  it('parses OpenClaw audit and quarantine options', () => {
    expect(parseCliArgs(['migrate', 'audit', '--project=project-1', '--limit', '25'], {})).toEqual({
      kind: 'migrateAudit',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        projectId: 'project-1',
        limit: 25,
      },
    });
    expect(parseCliArgs(['migrate', 'quarantine', '--limit=10', '--json'], {})).toEqual({
      kind: 'migrateQuarantine',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        limit: 10,
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

  it('reads concept trace from the durable gateway endpoint', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      concept: { conceptId: 'concept-1', status: 'executing' },
      phases: [{ phase: 'execute', status: 'current' }],
      events: [{ type: 'concept.received' }, { type: 'concept.planned' }],
      artifactIds: ['plan-1'],
    }));

    const code = await runCli({
      argv: ['concept', 'trace', 'concept-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/concepts/concept-1/trace', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Concept concept-1 trace: executing status, 1 phases, 2 ledger events, 1 artifacts\n');
  });

  it('exports a concept incident packet', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      summary: {
        conceptId: 'concept-1',
        status: 'failed',
        eventCount: 8,
        artifactCount: 3,
      },
    }));

    const code = await runCli({
      argv: ['concept', 'export', 'concept-1', '--incident-packet'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/concepts/concept-1/export?kind=incident-packet', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Concept concept-1 incident packet: failed status, 8 events, 3 artifacts\n');
  });

  it('imports a local SKILL.md through the governed gateway endpoint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-cli-skill-'));
    const skillPath = path.join(dir, 'SKILL.md');
    writeFileSync(skillPath, [
      '---',
      'name: Deploy Helper',
      'description: Deploy safely',
      'trigger: deploy',
      '---',
      'Use safe deployment steps.',
    ].join('\n'), 'utf8');
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      entry: { id: 'tool-1', name: 'skill:deploy-helper', status: 'pending_validation' },
    }));

    try {
      const code = await runCli({
        argv: ['skills', 'import', dir],
        env: {},
        io,
        fetch: fetchMock as unknown as typeof fetch,
      });

      expect(code).toBe(0);
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/skills/import', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"sourceLabel":"SKILL.md"'),
      }));
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { content?: string };
      expect(body.content).toContain('Deploy Helper');
      expect(io.stdout.write).toHaveBeenCalledWith('Skill skill:deploy-helper imported as pending_validation (tool-1)\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists imported skills and the tool registry', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tools: [{
        name: 'skill:deploy-helper',
        status: 'pending_validation',
        kind: 'skill',
        quality: { provenance: 'imported', provenanceTrust: 'quarantined' },
      }],
    }));

    const skillsCode = await runCli({
      argv: ['skills', 'list', '--state', 'pending_validation'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const toolsCode = await runCli({
      argv: ['tools', 'registry', 'list', '--status', 'pending_validation', '--tag', 'skill-import'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(skillsCode).toBe(0);
    expect(toolsCode).toBe(0);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:18790/api/tools/registry?tag=skill-import&status=pending_validation', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:18790/api/tools/registry?status=pending_validation&tag=skill-import', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Tool registry: 1 tools\n');
    expect(io.stdout.write).toHaveBeenCalledWith('- skill:deploy-helper [pending_validation] skill provenance=imported trust=quarantined\n');
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

  it('creates an OpenClaw dry-run migration report', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      artifact: { id: 'report-1', sha256: 'abc123', kind: 'summary', createdAt: '2026-01-01T00:00:00.000Z' },
      report: {
        counts: { importable: 4, skipped: 1, personality: 2, memories: 1, skills: 1, redactions: 3 },
      },
    }));

    const code = await runCli({
      argv: ['migrate', 'openclaw', '--from', '/Users/aleksandrgrebeshok/openclaw-workspace', '--dry-run', '--max-files=25'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/openclaw-import-report', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        sourcePath: '/Users/aleksandrgrebeshok/openclaw-workspace',
        maxFiles: 25,
      }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration dry-run: 4 importable, 1 skipped, 3 redactions\nReport artifact: report-1 sha256=abc123\n');
  });

  it('imports OpenClaw memories from a hash-bound preview report', async () => {
    const io = makeIo();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        artifact: { id: 'report-1', sha256: 'abc123', kind: 'summary', createdAt: '2026-01-01T00:00:00.000Z' },
        report: {
          counts: { importable: 2, skipped: 0, personality: 1, memories: 1, skills: 0, redactions: 0 },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'imported',
        result: { migrationId: 'openclaw-migration-1', imported: 2, skipped: 0, memoryIds: ['mem-1', 'mem-2'] },
      }));

    const code = await runCli({
      argv: ['migrate', 'openclaw', '--import', '--project=project-1', '--no-personality'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:18790/api/memory/openclaw-import-report', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-1', includePersonality: false }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:18790/api/memory/openclaw-import', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        reportArtifactId: 'report-1',
        expectedReportSha256: 'abc123',
        projectId: 'project-1',
      }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration import: 2 importable, 0 skipped, 0 redactions\nMigration ID: openclaw-migration-1\nImported memories: 2; skipped during import: 0\n');
  });

  it('reads the latest OpenClaw migration report', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      artifact: { id: 'report-1', sha256: 'abc123' },
      report: { counts: { importable: 7, skipped: 2 } },
    }));

    const code = await runCli({
      argv: ['migrate', 'report', '--project', 'project-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/openclaw-import-report?projectId=project-1', expect.objectContaining({
      method: 'GET',
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('Latest OpenClaw migration report: 7 importable, 2 skipped, artifact report-1\n');
  });

  it('rolls back OpenClaw memories through a hash-bound result artifact', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: 'rolled_back',
      result: {
        migrationId: 'openclaw-migration-1',
        revoked: 2,
        skippedIds: [],
        missingIds: ['missing-1'],
      },
    }));

    const code = await runCli({
      argv: ['migrate', 'rollback', '--result-artifact-id=openclaw-result-1.json', '--expected-sha256=sha-openclaw-result'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/openclaw-rollback', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        resultArtifactId: 'openclaw-result-1.json',
        expectedResultSha256: 'sha-openclaw-result',
      }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration rollback openclaw-migration-1: 2 revoked, 0 skipped, 1 missing\n');
  });

  it('verifies OpenClaw memories through a hash-bound result artifact', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: 'verified',
      result: {
        migrationId: 'openclaw-migration-1',
        foundCount: 9,
        missCount: 1,
        searchAttemptsFailed: 2,
      },
    }));

    const code = await runCli({
      argv: ['migrate', 'verify', '--result-artifact-id=openclaw-result-1.json', '--expected-sha256=sha-openclaw-result', '--query-limit=20'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/openclaw-verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        resultArtifactId: 'openclaw-result-1.json',
        expectedResultSha256: 'sha-openclaw-result',
        queryLimit: 20,
      }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration verify openclaw-migration-1: 9 found, 1 missed, 2 search failures\n');
  });

  it('reads OpenClaw migration audit view', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      migrations: [{ migrationId: 'openclaw-migration-1', status: 'needs_review' }],
      quarantineCandidates: [{ memoryId: 'memory-1' }],
      searchFailures: [],
    }));

    const code = await runCli({
      argv: ['migrate', 'audit', '--project=project-1', '--limit=25'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/openclaw-audit?projectId=project-1&limit=25', expect.objectContaining({
      method: 'GET',
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration audit: 1 migrations, 1 quarantine candidates, 0 search failures\n');
  });

  it('reads OpenClaw migration quarantine snapshot', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      candidateCount: 2,
      searchFailureCount: 1,
      sourceMigrationCount: 3,
      candidates: [],
      searchFailures: [],
    }));

    const code = await runCli({
      argv: ['migrate', 'quarantine', '--limit=10'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/openclaw-quarantine?limit=10', expect.objectContaining({
      method: 'GET',
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration quarantine: 2 candidates, 1 search failures across 3 migrations\n');
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
