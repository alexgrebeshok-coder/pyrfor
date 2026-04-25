// @vitest-environment node
/**
 * Gateway integration tests for /api/git/* endpoints.
 *
 * Starts the gateway on port 0, creates a temp git repo, and hits each endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createRuntimeGateway } from '../gateway.js';
import type { RuntimeConfig } from '../config.js';
import type { PyrforRuntime } from '../index.js';

process.env.LOG_LEVEL = 'silent';

const execFileAsync = promisify(execFile);

// ─── Repo helpers ──────────────────────────────────────────────────────────

async function initRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'gw-test@pyrfor.test'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'GW Test'], { cwd: dir });
}

async function stageAndCommit(dir: string, fileName: string, content: string, msg: string) {
  await writeFile(path.join(dir, fileName), content);
  await execFileAsync('git', ['add', '--', fileName], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', msg], { cwd: dir });
}

// ─── Gateway helpers ───────────────────────────────────────────────────────

function makeConfig(): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      bearerToken: undefined,
      bearerTokens: [],
    },
    rateLimit: { enabled: false, capacity: 60, refillPerSec: 1, exemptPaths: [] },
  } as unknown as RuntimeConfig;
}

function makeRuntime(): PyrforRuntime {
  return { handleMessage: async () => ({ success: true, response: '' }) } as unknown as PyrforRuntime;
}

async function get(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function post(port: number, path: string, payload: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ─── Setup / teardown ──────────────────────────────────────────────────────

let tmpDir = '';
let gw: ReturnType<typeof createRuntimeGateway>;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'pyrfor-gw-git-test-'));
  await initRepo(tmpDir);
  gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), portOverride: 0 });
  await gw.start();
});

afterEach(async () => {
  await gw.stop();
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/git/status', () => {
  it('returns 400 without workspace param', async () => {
    const { status } = await get(gw.port, '/api/git/status');
    expect(status).toBe(400);
  });

  it('returns status for clean repo', async () => {
    const { status, body } = await get(gw.port, `/api/git/status?workspace=${encodeURIComponent(tmpDir)}`);
    expect(status).toBe(200);
    expect(body).toHaveProperty('branch');
    expect(body).toHaveProperty('files');
    expect(Array.isArray((body as any).files)).toBe(true);
  });

  it('detects untracked file', async () => {
    await writeFile(path.join(tmpDir, 'hello.txt'), 'hello');
    const { body } = await get(gw.port, `/api/git/status?workspace=${encodeURIComponent(tmpDir)}`);
    const files = (body as any).files as Array<{ path: string; x: string; y: string }>;
    expect(files.some((f) => f.path === 'hello.txt' && f.x === '?')).toBe(true);
  });
});

describe('GET /api/git/diff', () => {
  it('returns diff for modified file', async () => {
    await stageAndCommit(tmpDir, 'code.ts', 'const x = 1;', 'init');
    await writeFile(path.join(tmpDir, 'code.ts'), 'const x = 2;');
    const { status, body } = await get(
      gw.port,
      `/api/git/diff?workspace=${encodeURIComponent(tmpDir)}&path=code.ts`,
    );
    expect(status).toBe(200);
    expect((body as any).diff).toContain('-const x = 1;');
    expect((body as any).diff).toContain('+const x = 2;');
  });

  it('returns 400 without required params', async () => {
    const { status } = await get(gw.port, '/api/git/diff?workspace=' + encodeURIComponent(tmpDir));
    expect(status).toBe(400);
  });
});

describe('GET /api/git/file', () => {
  it('returns HEAD content for committed file', async () => {
    await stageAndCommit(tmpDir, 'readme.md', '# Hello', 'add readme');
    const { status, body } = await get(
      gw.port,
      `/api/git/file?workspace=${encodeURIComponent(tmpDir)}&path=readme.md`,
    );
    expect(status).toBe(200);
    expect((body as any).content).toBe('# Hello');
  });

  it('returns empty content for new file not in HEAD', async () => {
    await writeFile(path.join(tmpDir, 'new.ts'), 'new');
    const { status, body } = await get(
      gw.port,
      `/api/git/file?workspace=${encodeURIComponent(tmpDir)}&path=new.ts`,
    );
    expect(status).toBe(200);
    expect((body as any).content).toBe('');
  });
});

describe('POST /api/git/stage', () => {
  it('stages a file', async () => {
    await writeFile(path.join(tmpDir, 'stage.txt'), 'stage me');
    const { status, body } = await post(gw.port, '/api/git/stage', {
      workspace: tmpDir,
      paths: ['stage.txt'],
    });
    expect(status).toBe(200);
    expect((body as any).ok).toBe(true);
  });

  it('returns 400 without workspace', async () => {
    const { status } = await post(gw.port, '/api/git/stage', { paths: ['f.txt'] });
    expect(status).toBe(400);
  });
});

describe('POST /api/git/unstage', () => {
  it('unstages a staged file', async () => {
    await writeFile(path.join(tmpDir, 'unstage.txt'), 'unstage me');
    await execFileAsync('git', ['add', '--', 'unstage.txt'], { cwd: tmpDir });
    const { status, body } = await post(gw.port, '/api/git/unstage', {
      workspace: tmpDir,
      paths: ['unstage.txt'],
    });
    expect(status).toBe(200);
    expect((body as any).ok).toBe(true);
  });
});

describe('POST /api/git/commit', () => {
  it('creates a commit and returns sha', async () => {
    await stageAndCommit(tmpDir, 'base.txt', 'base', 'base commit');
    await writeFile(path.join(tmpDir, 'new.txt'), 'new content');
    await execFileAsync('git', ['add', '--', 'new.txt'], { cwd: tmpDir });
    const { status, body } = await post(gw.port, '/api/git/commit', {
      workspace: tmpDir,
      message: 'add new.txt',
    });
    expect(status).toBe(200);
    expect((body as any).sha).toMatch(/^[0-9a-f]+$/);
  });

  it('returns 400 for empty message', async () => {
    const { status } = await post(gw.port, '/api/git/commit', {
      workspace: tmpDir,
      message: '',
    });
    expect(status).toBe(400);
  });
});

describe('GET /api/git/log', () => {
  it('returns log entries', async () => {
    await stageAndCommit(tmpDir, 'a.txt', 'a', 'first');
    await stageAndCommit(tmpDir, 'b.txt', 'b', 'second');
    const { status, body } = await get(
      gw.port,
      `/api/git/log?workspace=${encodeURIComponent(tmpDir)}&limit=10`,
    );
    expect(status).toBe(200);
    const entries = (body as any).entries as any[];
    expect(entries.length).toBe(2);
    expect(entries[0].subject).toBe('second');
  });
});

describe('GET /api/git/blame', () => {
  it('returns blame entries', async () => {
    await stageAndCommit(tmpDir, 'blame.ts', 'line one\nline two\n', 'add blame.ts');
    const { status, body } = await get(
      gw.port,
      `/api/git/blame?workspace=${encodeURIComponent(tmpDir)}&path=blame.ts`,
    );
    expect(status).toBe(200);
    const entries = (body as any).entries as any[];
    expect(entries.length).toBe(2);
    expect(entries[0].content).toBe('line one');
    expect(entries[0].author).toBe('GW Test');
  });
});
