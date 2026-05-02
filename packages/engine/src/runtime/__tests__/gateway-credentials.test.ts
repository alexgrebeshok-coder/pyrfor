// @vitest-environment node
/**
 * Tests for POST /api/runtime/credentials
 *
 * Phase E1: Settings UI — credentials injection endpoint.
 * Starts gateway on port 0, posts credentials, asserts process.env updated and 204 returned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import { createRuntimeGateway } from '../gateway';

process.env['LOG_LEVEL'] = 'silent';

function makeConfig(gatewayOverrides: Partial<RuntimeConfig['gateway']> = {}): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      bearerToken: undefined,
      bearerTokens: [],
      ...gatewayOverrides,
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

describe('POST /api/runtime/credentials', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot env keys we're about to set so we can restore them
    for (const key of [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GROQ_API_KEY',
      'OPENROUTER_API_KEY',
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    if (gw) {
      await gw.stop().catch(() => {});
      gw = null;
    }
    // Restore env
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('responds 204 when credentials are posted', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'provider:anthropic': 'sk-ant-test' }),
    });

    expect(res.status).toBe(204);
  });

  it('injects provider:anthropic as ANTHROPIC_API_KEY into process.env', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();

    await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'provider:anthropic': 'sk-ant-test' }),
    });

    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-test');
  });

  it('injects multiple providers in a single POST', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();

    await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'provider:anthropic': 'sk-ant-multi',
        'provider:openai': 'sk-oai-multi',
        'provider:groq': 'sk-groq-multi',
      }),
    });

    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-multi');
    expect(process.env['OPENAI_API_KEY']).toBe('sk-oai-multi');
    expect(process.env['GROQ_API_KEY']).toBe('sk-groq-multi');
  });

  it('returns 400 on invalid JSON body', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });

    expect(res.status).toBe(400);
  });

  it('accepts empty object and returns 204', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(204);
  });

  it('skips non-string values without error', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'provider:anthropic': 42, 'provider:openai': null }),
    });

    expect(res.status).toBe(204);
    // Non-string values should be skipped — env should not be set
    expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('unsets mapped provider env when credential value is null', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-existing';
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'provider:openai': null }),
    });

    expect(res.status).toBe(204);
    expect(process.env['OPENAI_API_KEY']).toBeUndefined();
  });

  it('returns 401 without bearer token when auth is configured', async () => {
    gw = createRuntimeGateway({
      config: makeConfig({ bearerToken: 'credential-secret-token' }),
      runtime: makeRuntime(),
    });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'provider:openai': 'sk-test' }),
    });

    expect(res.status).toBe(401);
    expect(process.env['OPENAI_API_KEY']).toBeUndefined();
  });

  it('accepts credentials with bearer token when auth is configured', async () => {
    const token = 'credential-secret-token';
    gw = createRuntimeGateway({
      config: makeConfig({ bearerToken: token }),
      runtime: makeRuntime(),
    });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ 'provider:openai': 'sk-test' }),
    });

    expect(res.status).toBe(204);
    expect(process.env['OPENAI_API_KEY']).toBe('sk-test');
  });

  it('refreshes provider router after credentials injection', async () => {
    const providerRouter = {
      listAllModels: vi.fn(),
      setActiveModel: vi.fn(),
      getActiveModel: vi.fn(),
      setLocalMode: vi.fn(),
      getLocalMode: vi.fn(),
      refreshFromEnvironment: vi.fn(),
    };
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), providerRouter });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/runtime/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'provider:openrouter': 'sk-or-test' }),
    });

    expect(res.status).toBe(204);
    expect(process.env['OPENROUTER_API_KEY']).toBe('sk-or-test');
    expect(providerRouter.refreshFromEnvironment).toHaveBeenCalledTimes(1);
  });
});
