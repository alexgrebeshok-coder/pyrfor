// @vitest-environment node
/**
 * Tests for GET /api/models and GET/POST /api/settings/active-model endpoints.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import { createRuntimeGateway } from '../gateway';
import type { ModelEntry } from '../provider-router';

process.env['LOG_LEVEL'] = 'silent';

vi.mock('../config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../config')>();
  return {
    ...orig,
    loadConfig: vi.fn().mockResolvedValue({ config: { ai: {} }, path: '/fake/path' }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
  };
});

function makeConfig(port = 0): RuntimeConfig {
  return {
    gateway: { enabled: true, host: '127.0.0.1', port, bearerToken: undefined, bearerTokens: [] },
    rateLimit: { enabled: false, capacity: 60, refillPerSec: 1, exemptPaths: ['/ping'] },
  } as unknown as RuntimeConfig;
}

function makeRuntime(): PyrforRuntime {
  return {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
    streamChatRequest: vi.fn().mockImplementation(async function* () {}),
  } as unknown as PyrforRuntime;
}

function makeRouter(models: ModelEntry[] = []) {
  return {
    listAllModels: vi.fn().mockResolvedValue(models),
    setActiveModel: vi.fn(),
    getActiveModel: vi.fn().mockReturnValue(undefined),
  };
}

describe('GET /api/models', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  afterEach(async () => { if (gw) { await gw.stop().catch(() => {}); gw = null; } });

  it('returns merged model list', async () => {
    const models: ModelEntry[] = [
      { provider: 'ollama', id: 'llama3', available: true },
      { provider: 'mlx', id: 'mlx-community/phi-3', available: true },
    ];
    const router = makeRouter(models);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/models`);
    expect(res.status).toBe(200);
    const body = await res.json() as { models: ModelEntry[] };
    expect(body.models).toHaveLength(2);
    expect(body.models[0]!.provider).toBe('ollama');
  });

  it('returns empty list when router returns nothing', async () => {
    const router = makeRouter([]);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/models`);
    expect(res.status).toBe(200);
    const body = await res.json() as { models: ModelEntry[] };
    expect(body.models).toEqual([]);
  });

  it('returns 500 when listAllModels throws', async () => {
    const router = {
      listAllModels: vi.fn().mockRejectedValue(new Error('network error')),
      setActiveModel: vi.fn(),
      getActiveModel: vi.fn().mockReturnValue(undefined),
    };
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/models`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/settings/active-model', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  afterEach(async () => { if (gw) { await gw.stop().catch(() => {}); gw = null; } });

  it('returns null when no active model set', async () => {
    const router = makeRouter();
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/active-model`);
    expect(res.status).toBe(200);
    const body = await res.json() as { activeModel: null };
    expect(body.activeModel).toBeNull();
  });

  it('returns active model when set', async () => {
    const router = { ...makeRouter(), getActiveModel: vi.fn().mockReturnValue({ provider: 'ollama', modelId: 'llama3' }) };
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/active-model`);
    const body = await res.json() as { activeModel: { provider: string; modelId: string } };
    expect(body.activeModel).toEqual({ provider: 'ollama', modelId: 'llama3' });
  });
});

describe('POST /api/settings/active-model', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  afterEach(async () => { if (gw) { await gw.stop().catch(() => {}); gw = null; } });

  it('sets active model and returns ok', async () => {
    const router = makeRouter();
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/active-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', modelId: 'llama3' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; activeModel: { provider: string; modelId: string } };
    expect(body.ok).toBe(true);
    expect(body.activeModel).toEqual({ provider: 'ollama', modelId: 'llama3' });
    expect(router.setActiveModel).toHaveBeenCalledWith('ollama', 'llama3');
  });

  it('returns 400 when provider or modelId missing', async () => {
    const router = makeRouter();
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/active-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/settings/local-mode', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  afterEach(async () => { if (gw) { await gw.stop().catch(() => {}); gw = null; } });

  it('returns localFirst=false and localOnly=false by default', async () => {
    const router = {
      ...makeRouter(),
      getLocalMode: vi.fn().mockReturnValue({ localFirst: false, localOnly: false }),
      setLocalMode: vi.fn(),
    };
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/local-mode`);
    expect(res.status).toBe(200);
    const body = await res.json() as { localFirst: boolean; localOnly: boolean };
    expect(body).toEqual({ localFirst: false, localOnly: false });
  });

  it('returns current mode when localFirst is enabled', async () => {
    const router = {
      ...makeRouter(),
      getLocalMode: vi.fn().mockReturnValue({ localFirst: true, localOnly: false }),
      setLocalMode: vi.fn(),
    };
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/local-mode`);
    const body = await res.json() as { localFirst: boolean; localOnly: boolean };
    expect(body.localFirst).toBe(true);
    expect(body.localOnly).toBe(false);
  });
});

describe('POST /api/settings/local-mode', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  afterEach(async () => { if (gw) { await gw.stop().catch(() => {}); gw = null; } });

  it('sets localFirst mode and returns ok', async () => {
    const router = {
      ...makeRouter(),
      getLocalMode: vi.fn().mockReturnValue({ localFirst: false, localOnly: false }),
      setLocalMode: vi.fn(),
    };
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/local-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localFirst: true, localOnly: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; localFirst: boolean; localOnly: boolean };
    expect(body.ok).toBe(true);
    expect(body.localFirst).toBe(true);
    expect(body.localOnly).toBe(false);
    expect(router.setLocalMode).toHaveBeenCalledWith({ localFirst: true, localOnly: false });
  });

  it('returns 400 for invalid JSON', async () => {
    const router = {
      ...makeRouter(),
      getLocalMode: vi.fn().mockReturnValue({ localFirst: false, localOnly: false }),
      setLocalMode: vi.fn(),
    };
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/local-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('defaults non-boolean values to false', async () => {
    const router = {
      ...makeRouter(),
      getLocalMode: vi.fn().mockReturnValue({ localFirst: false, localOnly: false }),
      setLocalMode: vi.fn(),
    };
    gw = createRuntimeGateway({ config: makeConfig(0), runtime: makeRuntime(), portOverride: 0, providerRouter: router });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/settings/local-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localFirst: 'yes', localOnly: 1 }),
    });
    expect(res.status).toBe(200);
    expect(router.setLocalMode).toHaveBeenCalledWith({ localFirst: false, localOnly: false });
  });
});
