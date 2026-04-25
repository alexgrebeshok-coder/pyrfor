// @vitest-environment node
/**
 * Tests for --port=0 (random port) support and LISTENING_ON stdout signal.
 *
 * Phase A3: gateway.ts / cli.ts changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import { createRuntimeGateway } from '../gateway';

// Silence logger output during tests
process.env['LOG_LEVEL'] = 'silent';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(port = 18790): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port,
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('gateway portOverride and LISTENING_ON signal', () => {
  let capturedOutput: string[] = [];
  let originalWrite: typeof process.stdout.write;
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;

  beforeEach(() => {
    capturedOutput = [];
    // Capture process.stdout.write calls
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      if (typeof chunk === 'string') capturedOutput.push(chunk);
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stdout.write;
    // Clear any PYRFOR_PORT env override that might bleed between tests
    delete process.env['PYRFOR_PORT'];
  });

  afterEach(async () => {
    process.stdout.write = originalWrite;
    delete process.env['PYRFOR_PORT'];
    if (gw) {
      await gw.stop().catch(() => {});
      gw = null;
    }
  });

  it('emits LISTENING_ON=<port> to stdout when using the default port from config', async () => {
    gw = createRuntimeGateway({
      config: makeConfig(0), // port 0 = random via config
      runtime: makeRuntime(),
    });

    await gw.start();
    const port = gw.port;
    expect(port).toBeGreaterThan(0);

    const output = capturedOutput.join('');
    expect(output).toContain(`LISTENING_ON=${port}`);
  });

  it('emits LISTENING_ON=<port> to stdout when using portOverride=0 (random)', async () => {
    gw = createRuntimeGateway({
      config: makeConfig(18790), // config says 18790, but we override to 0
      runtime: makeRuntime(),
      portOverride: 0,
    });

    await gw.start();
    const port = gw.port;
    expect(port).toBeGreaterThan(0);

    const output = capturedOutput.join('');
    expect(output).toContain(`LISTENING_ON=${port}`);
  });

  it('portOverride takes precedence over config.gateway.port', async () => {
    // Listen on two gateways: one on the config default, one with an explicit override
    // The override one should get a different (random) port.
    const gw1 = createRuntimeGateway({
      config: makeConfig(0),
      runtime: makeRuntime(),
    });
    const gw2 = createRuntimeGateway({
      config: makeConfig(18790),
      runtime: makeRuntime(),
      portOverride: 0,
    });

    await gw1.start();
    await gw2.start();

    try {
      expect(gw1.port).toBeGreaterThan(0);
      expect(gw2.port).toBeGreaterThan(0);
      // Both should have emitted LISTENING_ON
      const combined = capturedOutput.join('');
      expect(combined).toContain(`LISTENING_ON=${gw1.port}`);
      expect(combined).toContain(`LISTENING_ON=${gw2.port}`);
    } finally {
      await gw1.stop().catch(() => {});
      await gw2.stop().catch(() => {});
      gw = null; // already cleaned up
    }
  });

  it('PYRFOR_PORT env var overrides config.gateway.port (supports 0)', async () => {
    process.env['PYRFOR_PORT'] = '0';

    gw = createRuntimeGateway({
      config: makeConfig(18790), // would normally bind 18790
      runtime: makeRuntime(),
    });

    await gw.start();
    const port = gw.port;
    // OS assigned a free port, not 18790
    expect(port).toBeGreaterThan(0);

    const output = capturedOutput.join('');
    expect(output).toContain(`LISTENING_ON=${port}`);
  });

  it('portOverride takes precedence over PYRFOR_PORT env var', async () => {
    process.env['PYRFOR_PORT'] = '99999'; // invalid/unused

    gw = createRuntimeGateway({
      config: makeConfig(18790),
      runtime: makeRuntime(),
      portOverride: 0,
    });

    await gw.start();
    const port = gw.port;
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(99999);

    const output = capturedOutput.join('');
    expect(output).toContain(`LISTENING_ON=${port}`);
  });
});
