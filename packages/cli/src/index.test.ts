import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RELEASE_SECRET_ENV_VARS, RELEASE_SIDECAR_ARTIFACTS } from '@pyrfor/engine/runtime/release-readiness';
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

function createReleaseFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pyrfor-cli-release-'));
  writeFixtureFile(root, 'apps/pyrfor-ide/src-tauri/tauri.conf.json', JSON.stringify({
    bundle: {
      externalBin: ['binaries/pyrfor-daemon'],
      resources: { 'binaries/_runtime': '_runtime', 'binaries/_app': '_app' },
    },
    plugins: { updater: { active: true } },
  }));
  writeFixtureFile(root, 'apps/pyrfor-ide/src-tauri/src/sidecar.rs', 'PYRFOR_ALLOW_STANDALONE_ENGINE cfg!(debug_assertions)');
  writeFixtureFile(root, 'apps/pyrfor-ide/web/src/lib/apiFetch.ts', 'Pyrfor bundled sidecar port unavailable');
  writeFixtureFile(root, 'apps/pyrfor-ide/web/src/lib/api.ts', 'getProviderRoutingPreview /api/settings/provider-routing-preview');
  writeFixtureFile(root, 'packages/engine/src/runtime/gateway.ts', '/api/product-factory/templates /api/product-factory/plan /api/runs');
  writeFixtureFile(root, 'packages/engine/dist/runtime/gateway.js', '/api/product-factory/templates /api/product-factory/plan /api/runs');
  writeFixtureFile(root, 'apps/pyrfor-ide/src-tauri/binaries/pyrfor-daemon-aarch64-apple-darwin', '#!/bin/sh\nexec pyrfor --daemon\n');
  for (const artifact of RELEASE_SIDECAR_ARTIFACTS) {
    if (artifact === 'pyrfor-daemon-aarch64-apple-darwin') continue;
    writeFixtureFile(root, `apps/pyrfor-ide/src-tauri/binaries/${artifact}`, 'artifact');
  }
  return root;
}

function createBlockFixture(overrides: Record<string, unknown> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pyrfor-cli-block-'));
  writeFixtureFile(root, 'package.json', JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2));
  writeFixtureFile(root, 'block.json', JSON.stringify({
    pyrfor_manifest_version: '1',
    id: 'com.example.translate-block',
    name: 'Translate Block',
    version: '0.1.0',
    description: 'Local LLM translation demo.',
    author: 'Example',
    license: 'MIT',
    runtime: {
      mode: 'local-worker',
      engine_version_range: '>=1.2.0 <2.0.0',
      sandbox: 'process-isolated',
    },
    entrypoints: { main: 'dist/index.js' },
    scripts: { test: 'vitest run' },
    capabilities: [{ token: 'local-llm:invoke', reason: 'Translate text locally' }],
    contracts: {
      consumes: [],
      produces: [{ ref: 'ApprovalEvidence@1' }],
    },
    optimizer_policy: {
      editable: true,
      editable_fields: ['prompts'],
      never_editable: ['id', 'version', 'capabilities', 'security', 'signing'],
      requires_human_approval: ['runtime', 'entrypoints', 'scripts'],
    },
    security: {
      sandbox: 'process-isolated',
      allow_fs_read: [],
      allow_fs_write: [],
      allow_network: false,
      allow_child_process: false,
      secrets_access: [],
      max_memory_mb: 256,
      max_cpu_pct: 30,
    },
    certification: { state: 'dev' },
    ...overrides,
  }, null, 2));
  return root;
}

function writeFixtureFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
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
    expect(parseCliArgs(['skills', 'test', 'skill:deploy-helper', '--json'], {})).toEqual({
      kind: 'skillsTest',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        skillRef: 'skill:deploy-helper',
      },
    });
    expect(parseCliArgs(['skills', 'approve', 'tool-1'], {})).toEqual({
      kind: 'skillsApprove',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        skillRef: 'tool-1',
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
    expect(parseCliArgs(['memory', 'search', 'delivery', 'rules', '--project', 'project-1', '--limit', '5'], {})).toEqual({
      kind: 'memorySearch',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        query: 'delivery rules',
        projectId: 'project-1',
        limit: 5,
      },
    });
    expect(parseCliArgs(['memory', 'continuity', '--project=project-1'], {})).toEqual({
      kind: 'memoryContinuity',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        projectId: 'project-1',
      },
    });
    expect(parseCliArgs(['memory', 'review', 'approve', 'memory-1', '--reason', 'validated'], {})).toEqual({
      kind: 'memoryReview',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        decision: 'approve',
        memoryId: 'memory-1',
        reason: 'validated',
      },
    });
    expect(parseCliArgs(['run', 'timeline', 'run-1', '--json'], {})).toEqual({
      kind: 'runTimeline',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        runId: 'run-1',
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
      '--auto-approve-skills',
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
        autoTestSkills: true,
        autoApproveSkills: true,
        includeMemories: false,
      },
    });
  });

  it('parses local release readiness options', () => {
    expect(parseCliArgs(['release', 'readiness', '--root', '/tmp/pyrfor-release', '--json'], {})).toEqual({
      kind: 'releaseReadiness',
      options: {
        json: true,
        root: '/tmp/pyrfor-release',
      },
    });
  });

  it('parses block validate command', () => {
    expect(parseCliArgs(['block', 'validate', './my-block', '--json'], {})).toEqual({
      kind: 'blockValidate',
      options: {
        sourcePath: './my-block',
        json: true,
      },
    });
  });

  it('parses block administration commands', () => {
    expect(parseCliArgs(['block', 'list', '--json'], {})).toEqual({
      kind: 'blockList',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
      },
    });
    expect(parseCliArgs(['block', 'load', './my-block', '--gateway-url', 'http://127.0.0.1:19000'], {})).toEqual({
      kind: 'blockLoad',
      options: {
        gatewayUrl: 'http://127.0.0.1:19000',
        json: false,
        sourcePath: './my-block',
      },
    });
    expect(parseCliArgs(['block', 'activate', 'com.example.translate-block'], {})).toEqual({
      kind: 'blockActivate',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        blockId: 'com.example.translate-block',
      },
    });
    expect(parseCliArgs(['block', 'deactivate', 'com.example.translate-block', '--json'], {})).toEqual({
      kind: 'blockDeactivate',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
        blockId: 'com.example.translate-block',
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
    expect(parseCliArgs(['approvals', 'list', '--json'], {})).toEqual({
      kind: 'approvalsList',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: true,
      },
    });
    expect(parseCliArgs(['approvals', 'approve', 'approval-1'], {})).toEqual({
      kind: 'approvalsApprove',
      options: {
        gatewayUrl: 'http://127.0.0.1:18790',
        json: false,
        approvalId: 'approval-1',
        decision: 'approve',
      },
    });
    expect(parseCliArgs(['approvals', 'deny', 'approval-2', '--gateway-url', 'http://127.0.0.1:19000'], {})).toEqual({
      kind: 'approvalsDeny',
      options: {
        gatewayUrl: 'http://127.0.0.1:19000',
        json: false,
        approvalId: 'approval-2',
        decision: 'deny',
      },
    });
  });

  it('rejects approvals commands without an approvalId', () => {
    expect(() => parseCliArgs(['approvals', 'approve'], {})).toThrow('Expected exactly one approvalId for approvals approve');
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

  it('tests and approves imported skills through governed gateway routes', async () => {
    const io = makeIo();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: 'pyrfor.skill_test.v1',
        passed: true,
        failureScore: 0,
        checks: [{ id: 'skill-kind', description: 'Registry entry kind remains skill', passed: true }],
        testResultArtifactId: 'skill-test-1.json',
        entry: { id: 'tool-1', name: 'skill:deploy-helper', status: 'pending_validation' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: 'pyrfor.skill_approval.v1',
        approved: true,
        alreadyApproved: false,
        promotedFrom: 'pending_validation',
        promotedTo: 'vetted',
        entry: { id: 'tool-1', name: 'skill:deploy-helper', status: 'vetted' },
      }));

    const testCode = await runCli({
      argv: ['skills', 'test', 'tool-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const approveCode = await runCli({
      argv: ['skills', 'approve', 'tool-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(testCode).toBe(0);
    expect(approveCode).toBe(0);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:18790/api/skills/tool-1/test', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:18790/api/skills/tool-1/approve', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(io.stdout.write).toHaveBeenNthCalledWith(1, 'Skill skill:deploy-helper test: passed (1/1 checks, failureScore=0)\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(2, 'Skill skill:deploy-helper approval: approved (pending_validation -> vetted)\n');
  });

  it('returns non-zero when a skill test reports failed validation', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      schemaVersion: 'pyrfor.skill_test.v1',
      passed: false,
      failureScore: 0.25,
      checks: [
        { id: 'skill-kind', description: 'Registry entry kind remains skill', passed: true },
        { id: 'skill-sandbox-tier', description: 'Imported skills stay within wasm sandbox tier', passed: false },
      ],
      testResultArtifactId: 'skill-test-1.json',
      entry: { id: 'tool-1', name: 'skill:deploy-helper', status: 'pending_validation' },
    }));

    const code = await runCli({
      argv: ['skills', 'test', 'tool-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(1);
    expect(io.stdout.write).toHaveBeenNthCalledWith(1, 'Skill skill:deploy-helper test: failed (1/2 checks, failureScore=0.25)\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(2, 'Failed checks: skill-sandbox-tier\n');
  });

  it('reads memory search hits with governance metadata', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      results: [{
        summary: 'delivery rule',
        memoryType: 'semantic',
        importState: 'imported_quarantined',
        approvalState: 'pending_approval',
        plannerEligible: false,
        provenanceKinds: ['external'],
        importedFrom: 'openclaw',
      }],
    }));

    const code = await runCli({
      argv: ['memory', 'search', 'delivery', '--project', 'project-1', '--limit', '5'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/search?q=delivery&projectId=project-1&limit=5', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Memory search: 1 hits\n');
    expect(io.stdout.write).toHaveBeenCalledWith('- delivery rule [semantic] import=imported_quarantined approval=pending_approval planner=false provenance=external from=openclaw\n');
  });

  it('reads memory continuity warnings', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      warnings: ['memory_files_missing', 'no_project_rollup'],
    }));

    const code = await runCli({
      argv: ['memory', 'continuity', '--project', 'project-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/continuity?projectId=project-1', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Memory continuity: 2 warnings\n');
    expect(io.stdout.write).toHaveBeenCalledWith('Warnings: memory_files_missing, no_project_rollup\n');
  });

  it('reviews pending memory through the governed gateway endpoint', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      decision: 'approve',
      memory: {
        id: 'memory-1',
        importState: 'approved',
        approvalState: 'approved',
        plannerEligible: true,
      },
    }));

    const code = await runCli({
      argv: ['memory', 'review', 'approve', 'memory-1', '--reason', 'validated'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/memory/memory-1/review', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', reason: 'validated' }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('Memory memory-1 review: approve -> import=approved approval=approved planner=true\n');
  });

  it('reads run timeline aggregates', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      run: { run_id: 'run-1', status: 'completed' },
      summary: {
        eventCount: 2,
        hasContextPack: true,
        hasDeliveryEvidence: true,
      },
      replay: { available: true },
    }));

    const code = await runCli({
      argv: ['run', 'timeline', 'run-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/runs/run-1/timeline', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenCalledWith('Run run-1 timeline: completed status, 2 events, context=true, delivery=true, replay=true\n');
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
        result: {
          migrationId: 'openclaw-migration-1',
          imported: 2,
          skipped: 0,
          memoryIds: ['mem-1', 'mem-2'],
          skillFinalizationSummary: { autoTestSkills: true, autoApproveSkills: false, tested: 1, passed: 1, approved: 0, testFailed: 0, approvalFailed: 0 },
        },
      }));

    const code = await runCli({
      argv: ['migrate', 'openclaw', '--import', '--project=project-1', '--no-personality', '--auto-test-skills'],
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
        autoTestSkills: true,
      }),
    }));
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration import: 2 importable, 0 skipped, 0 redactions\nMigration ID: openclaw-migration-1\nImported memories: 2; skipped during import: 0\nGoverned skill finalization: 1 tested, 1 passed, 0 approved, 0 test failures, 0 approval failures\n');
  });

  it('prints governed skill registry summary for OpenClaw imports when present', async () => {
    const io = makeIo();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        artifact: { id: 'report-1', sha256: 'abc123', kind: 'summary', createdAt: '2026-01-01T00:00:00.000Z' },
        report: {
          counts: { importable: 1, skipped: 0, personality: 0, memories: 0, skills: 1, redactions: 0 },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'imported',
        result: {
          migrationId: 'openclaw-migration-2',
          imported: 1,
          skipped: 0,
          memoryIds: ['mem-1'],
          importedToolEntries: [{ toolId: 'tool-1', toolName: 'skill:research-helper', status: 'pending_validation', duplicate: false }],
          skippedToolEntries: [{ sourceRelPath: 'skills/research.md', reason: 'invalid_skill_md' }],
          skillFinalizationSummary: { autoTestSkills: true, autoApproveSkills: true, tested: 1, passed: 1, approved: 1, testFailed: 0, approvalFailed: 0 },
        },
      }));

    const code = await runCli({
      argv: ['migrate', 'openclaw', '--import', '--auto-approve-skills'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith('OpenClaw migration import: 1 importable, 0 skipped, 0 redactions\nMigration ID: openclaw-migration-2\nImported memories: 1; skipped during import: 0\nImported governed skills: 1; skipped skill registry imports: 1\nGoverned skill finalization: 1 tested, 1 passed, 1 approved, 0 test failures, 0 approval failures\n');
  });

  it('returns non-zero when migrated skill auto-testing reports failures', async () => {
    const io = makeIo();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        artifact: { id: 'report-1', sha256: 'abc123', kind: 'summary', createdAt: '2026-01-01T00:00:00.000Z' },
        report: {
          counts: { importable: 1, skipped: 0, personality: 0, memories: 0, skills: 1, redactions: 0 },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'imported',
        result: {
          migrationId: 'openclaw-migration-3',
          imported: 1,
          skipped: 0,
          memoryIds: ['mem-1'],
          importedToolEntries: [{ toolId: 'tool-1', toolName: 'skill:broken-helper', status: 'pending_validation', duplicate: false }],
          skippedToolEntries: [],
          skillFinalizationSummary: { autoTestSkills: true, autoApproveSkills: false, tested: 1, passed: 0, approved: 0, testFailed: 1, approvalFailed: 0 },
        },
      }));

    const code = await runCli({
      argv: ['migrate', 'openclaw', '--import', '--auto-test-skills'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(1);
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

  it('lists pending approvals', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      approvals: [
        { id: 'approval-1', toolName: 'exec', summary: 'Run npm publish' },
        { id: 'approval-2', toolName: 'browser', summary: 'Open staging app' },
      ],
    }));

    const code = await runCli({
      argv: ['approvals', 'list'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/approvals/pending', expect.objectContaining({
      method: 'GET',
    }));
    expect(io.stdout.write).toHaveBeenNthCalledWith(1, 'Pending approvals: 2\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(2, '[approval-1] exec: Run npm publish\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(3, '[approval-2] browser: Open staging app\n');
  });

  it('records approval decisions through the CLI', async () => {
    const io = makeIo();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, decision: 'approve' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, decision: 'deny' }));

    const approveCode = await runCli({
      argv: ['approvals', 'approve', 'approval-1'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const denyCode = await runCli({
      argv: ['approvals', 'deny', 'approval-2'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(approveCode).toBe(0);
    expect(denyCode).toBe(0);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:18790/api/approvals/approval-1/decision', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:18790/api/approvals/approval-2/decision', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ decision: 'deny' }),
    }));
    expect(io.stdout.write).toHaveBeenNthCalledWith(1, 'Approval approval-1: approve recorded\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(2, 'Approval approval-2: deny recorded\n');
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

  it('returns non-zero and does not call the gateway when release readiness is unavailable', async () => {
    const io = makeIo();
    const fetchMock = vi.fn();
    const root = mkdtempSync(path.join(tmpdir(), 'pyrfor-cli-release-missing-'));

    try {
      const code = await runCli({
        argv: ['release', 'readiness', '--root', root],
        env: { APPLE_ID: 'person@example.test' },
        io,
        fetch: fetchMock as unknown as typeof fetch,
      });

      expect(code).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Release readiness: unavailable'));
      expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Missing secrets:'));
      expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Next step:'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns zero for ready local release readiness checks', async () => {
    const io = makeIo();
    const fetchMock = vi.fn();
    const root = createReleaseFixture();
    const env = Object.fromEntries(RELEASE_SECRET_ENV_VARS.map((name) => [name, `${name}-value`]));

    try {
      const code = await runCli({
        argv: ['release', 'readiness', '--root', root],
        env,
        io,
        fetch: fetchMock as unknown as typeof fetch,
      });

      expect(code).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(io.stdout.write).toHaveBeenCalledWith('Release readiness: ready (secrets 7/7, artifacts 6/6, contracts 9/9)\n');
      expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Next step: Run the release check'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates a local block package without calling the gateway', async () => {
    const root = createBlockFixture();
    const io = makeIo();
    const fetchMock = vi.fn();
    try {
      const code = await runCli({
        argv: ['block', 'validate', root],
        env: {},
        io,
        fetch: fetchMock as unknown as typeof fetch,
      });

      expect(code).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(io.stdout.write).toHaveBeenCalledWith('Block com.example.translate-block@0.1.0: valid\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists blocks from the gateway with human-readable output', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      blocks: [{
        blockId: 'com.example.translate-block',
        version: '0.1.0',
        status: 'inactive',
        metadata: {
          name: 'Translate Block',
          capabilities: ['local-llm:invoke'],
        },
      }],
    }));

    const code = await runCli({
      argv: ['block', 'list'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/blocks', expect.objectContaining({ method: 'GET' }));
    expect(io.stdout.write).toHaveBeenNthCalledWith(1, 'Blocks: 1\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(2, '- com.example.translate-block [inactive] Translate Block@0.1.0 caps=1\n');
  });

  it('loads and toggles blocks through gateway routes', async () => {
    const io = makeIo();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        blockId: 'com.example.translate-block',
        status: 'inactive',
        block: {
          blockId: 'com.example.translate-block',
          version: '0.1.0',
          metadata: { name: 'Translate Block' },
        },
        warnings: ['project_shared memory scope requires projectId'],
        registeredCapabilityTools: ['block:com.example.translate-block:local-llm:invoke'],
        registeredContractRefs: ['ApprovalEvidence@1'],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        blockId: 'com.example.translate-block',
        status: 'active',
        block: {
          blockId: 'com.example.translate-block',
          version: '0.1.0',
          metadata: { name: 'Translate Block' },
        },
        warnings: [],
        registeredCapabilityTools: [],
        registeredContractRefs: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        blockId: 'com.example.translate-block',
        status: 'inactive',
        block: {
          blockId: 'com.example.translate-block',
          version: '0.1.0',
          metadata: { name: 'Translate Block' },
        },
        warnings: [],
        registeredCapabilityTools: [],
        registeredContractRefs: [],
      }));

    const loadCode = await runCli({
      argv: ['block', 'load', './demo-block'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const activateCode = await runCli({
      argv: ['block', 'activate', 'com.example.translate-block'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const deactivateCode = await runCli({
      argv: ['block', 'deactivate', 'com.example.translate-block'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(loadCode).toBe(0);
    expect(activateCode).toBe(0);
    expect(deactivateCode).toBe(0);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:18790/api/blocks/load', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: path.resolve('./demo-block') }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:18790/api/blocks/com.example.translate-block/activate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:18790/api/blocks/com.example.translate-block/deactivate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(io.stdout.write).toHaveBeenNthCalledWith(1, 'Block com.example.translate-block: inactive (Translate Block@0.1.0)\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(2, 'Warnings: project_shared memory scope requires projectId\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(3, 'Registered tools: block:com.example.translate-block:local-llm:invoke\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(4, 'Registered contracts: ApprovalEvidence@1\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(5, 'Block com.example.translate-block: active (Translate Block@0.1.0)\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(6, 'Block com.example.translate-block: inactive (Translate Block@0.1.0)\n');
  });

  it('returns non-zero and renders structured validation errors for gateway-backed block load failures', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ok: false,
      blockId: 'com.example.translate-block',
      status: 'error',
      warnings: [],
      registeredCapabilityTools: [],
      registeredContractRefs: [],
      validation: {
        status: 'invalid',
        summary: {
          id: 'com.example.translate-block',
          version: '0.1.0',
          capabilityCount: 1,
          consumedContractCount: 0,
          producedContractCount: 1,
          panelCount: 0,
        },
        errors: [{
          path: 'capabilities[0].token',
          code: 'capability_wildcard',
          message: 'Capability tokens must not contain wildcard segments.',
        }],
        warnings: [],
      },
    }, {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    }));

    const code = await runCli({
      argv: ['block', 'load', './broken-block'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(1);
    expect(io.stdout.write).toHaveBeenNthCalledWith(1, 'Block com.example.translate-block: error (unnamed@unknown)\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(2, 'Validation errors (1):\n');
    expect(io.stdout.write).toHaveBeenNthCalledWith(3, '- capabilities[0].token: capability_wildcard — Capability tokens must not contain wildcard segments.\n');
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it('returns non-zero when gateway rejects activation for a revoked block', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: 'block_revoked',
      blockId: 'com.example.translate-block',
      status: 'revoked',
    }, {
      ok: false,
      status: 409,
      statusText: 'Conflict',
    }));

    const code = await runCli({
      argv: ['block', 'activate', 'com.example.translate-block'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith('Gateway request failed (409): block_revoked\n');
  });

  it('returns non-zero when gateway rejects deactivation for a revoked block', async () => {
    const io = makeIo();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: 'block_revoked',
      blockId: 'com.example.translate-block',
      status: 'revoked',
    }, {
      ok: false,
      status: 409,
      statusText: 'Conflict',
    }));

    const code = await runCli({
      argv: ['block', 'deactivate', 'com.example.translate-block'],
      env: {},
      io,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(code).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith('Gateway request failed (409): block_revoked\n');
  });

  it('returns non-zero for invalid block packages', async () => {
    const root = createBlockFixture({
      capabilities: [{ token: 'fs:*', reason: 'too broad' }],
    });
    const io = makeIo();
    try {
      const code = await runCli({
        argv: ['block', 'validate', root],
        env: {},
        io,
        fetch: vi.fn() as unknown as typeof fetch,
      });

      expect(code).toBe(1);
      expect(io.stdout.write).toHaveBeenCalledWith('Block com.example.translate-block@0.1.0: invalid\n');
      expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('capability_wildcard'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
