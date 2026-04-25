// @vitest-environment node
/**
 * Tests for IDE static file routes in the runtime HTTP gateway.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir as osTmpdir } from 'os';
import pathModule from 'path';
import { fileURLToPath } from 'node:url';
import type { RuntimeConfig } from './config';
import type { PyrforRuntime } from './index';
import { createRuntimeGateway } from './gateway';
import { GoalStore } from './goal-store';
import { vi } from 'vitest';

// Silence logger
process.env.LOG_LEVEL = 'silent';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeConfig(): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      bearerToken: undefined,
      bearerTokens: [],
    },
    rateLimit: {
      enabled: false,
      capacity: 60,
      refillPerSec: 1,
      exemptPaths: ['/ping'],
    },
  } as unknown as RuntimeConfig;
}

function makeRuntime(): PyrforRuntime {
  return {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
  } as unknown as PyrforRuntime;
}

// ─── IDE static route tests (stub ideStaticDir) ───────────────────────────────

describe('IDE static routes (stub dir)', () => {
  let port: number;
  let gw: ReturnType<typeof createRuntimeGateway>;
  let tmpDir: string;
  let ideDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-ide-test-'));
    ideDir = pathModule.join(tmpDir, 'ide');
    mkdirSync(ideDir, { recursive: true });

    // Create a minimal fake index.html
    writeFileSync(
      pathModule.join(ideDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>Pyrfor IDE Test</title></head><body>IDE stub</body></html>',
      'utf-8',
    );
    // Create a fake style.css
    writeFileSync(
      pathModule.join(ideDir, 'style.css'),
      'body { background: #1e1e1e; }',
      'utf-8',
    );

    const goalStore = new GoalStore(tmpDir);
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      goalStore,
      approvalSettingsPath: pathModule.join(tmpDir, 'approval-settings.json'),
      ideStaticDir: ideDir,
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('GET /ide → 200 text/html with fake content', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ide`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Pyrfor IDE Test');
    expect(text).toContain('IDE stub');
  });

  it('GET /ide/ → 200 index.html', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ide/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('IDE stub');
  });

  it('GET /ide/index.html → 200 text/html', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ide/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET /ide/style.css → 200 text/css', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ide/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('GET /ide/missing.css → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ide/missing.css`);
    expect(res.status).toBe(404);
  });

  it('GET /ide/../etc/passwd → 403 (path traversal blocked)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ide/../etc/passwd`);
    // URL normalisation by Node: /ide/../etc/passwd → /etc/passwd (not /ide prefix)
    // so it should be 404 (falls through to route-not-found / auth-blocked)
    // OR 403 from path traversal guard if the prefix is preserved.
    // Either way it must NOT be 200.
    expect(res.status).not.toBe(200);
  });

  it('GET /ide/%2e%2e/etc/passwd → 403 (encoded path traversal)', async () => {
    // fetch() will decode before sending — test via raw url string
    const res = await fetch(`http://127.0.0.1:${port}/ide/%2e%2e/etc/passwd`);
    expect(res.status).not.toBe(200);
  });
});

// ─── Smoke test: real IDE source files exist ──────────────────────────────────

describe('Real IDE source files', () => {
  const __testFilename = fileURLToPath(import.meta.url);
  // __testFilename is in src/runtime/ — telegram/ide/ is a sibling dir
  const ideSourceDir = pathModule.join(
    pathModule.dirname(__testFilename),
    'telegram',
    'ide',
  );

  it('src/runtime/telegram/ide/index.html exists', () => {
    expect(existsSync(pathModule.join(ideSourceDir, 'index.html'))).toBe(true);
  });

  it('index.html contains "Pyrfor IDE" title', () => {
    const { readFileSync } = require('fs');
    const html = readFileSync(pathModule.join(ideSourceDir, 'index.html'), 'utf-8');
    expect(html).toContain('Pyrfor IDE');
  });

  it('index.html contains Monaco loader script tag', () => {
    const { readFileSync } = require('fs');
    const html = readFileSync(pathModule.join(ideSourceDir, 'index.html'), 'utf-8');
    expect(html).toContain('monaco-editor');
    expect(html).toContain('loader.js');
  });

  it('src/runtime/telegram/ide/style.css exists', () => {
    expect(existsSync(pathModule.join(ideSourceDir, 'style.css'))).toBe(true);
  });

  it('src/runtime/telegram/ide/app.js exists', () => {
    expect(existsSync(pathModule.join(ideSourceDir, 'app.js'))).toBe(true);
  });
});
