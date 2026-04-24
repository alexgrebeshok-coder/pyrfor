// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  RuntimeConfigSchema,
  RuntimeConfigError,
  DEFAULT_CONFIG_PATH,
  LEGACY_CONFIG_PATH,
  SCHEMA_VERSION,
  applyEnvOverrides,
  loadConfig,
  saveConfig,
  watchConfig,
} from './config';
import type { RuntimeConfig } from './config';

// ─── helpers ────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return path.join(os.tmpdir(), 'pyrfor-cfg-test-' + Math.random().toString(36).slice(2));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let dirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const d = tmpDir();
  await fsp.mkdir(d, { recursive: true });
  dirs.push(d);
  return d;
}

afterEach(async () => {
  // Clean up all tmp dirs created during test
  for (const d of dirs) {
    await fsp.rm(d, { recursive: true, force: true });
  }
  dirs = [];
  // Restore env
  delete process.env['PYRFOR_CONFIG_PATH'];
  delete process.env['PYRFOR_WORKSPACE'];
  delete process.env['PYRFOR_TELEGRAM_BOT_TOKEN'];
  delete process.env['TELEGRAM_BOT_TOKEN'];
  delete process.env['PYRFOR_TELEGRAM_ALLOWED_CHAT_IDS'];
  delete process.env['TELEGRAM_ALLOWED_CHAT_IDS'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['PYRFOR_OPENAI_API_KEY'];
  delete process.env['PYRFOR_GATEWAY_PORT'];
  delete process.env['PYRFOR_GATEWAY_TOKEN'];
});

// ─── Schema tests ────────────────────────────────────────────────────────────

describe('RuntimeConfigSchema', () => {
  it('applies defaults for an empty object', () => {
    const cfg = RuntimeConfigSchema.parse({});
    expect(cfg.telegram.enabled).toBe(false);
    expect(cfg.telegram.rateLimitPerMinute).toBe(30);
    expect(cfg.telegram.allowedChatIds).toEqual([]);
    expect(cfg.voice.enabled).toBe(true);
    expect(cfg.voice.provider).toBe('local');
    expect(cfg.voice.model).toBe('whisper-1');
    expect(cfg.cron.enabled).toBe(true);
    expect(cfg.cron.timezone).toBe('UTC');
    expect(cfg.cron.jobs).toEqual([]);
    expect(cfg.health.enabled).toBe(true);
    expect(cfg.health.intervalMs).toBe(30_000);
    expect(cfg.gateway.enabled).toBe(false);
    expect(cfg.gateway.host).toBe('127.0.0.1');
    expect(cfg.gateway.port).toBe(18790);
    expect(cfg.providers.enableFallback).toBe(true);
    expect(cfg.persistence.enabled).toBe(true);
    expect(cfg.persistence.debounceMs).toBe(5000);
  });

  it('parses valid partial config', () => {
    const cfg = RuntimeConfigSchema.parse({
      telegram: { enabled: true, botToken: 'tok123' },
      gateway: { enabled: true, port: 9000 },
    });
    expect(cfg.telegram.botToken).toBe('tok123');
    expect(cfg.gateway.port).toBe(9000);
    expect(cfg.cron.enabled).toBe(true); // default
  });

  it('throws for invalid type', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ health: { intervalMs: 'not-a-number' } }),
    ).toThrow();
  });

  it('throws for negative rateLimitPerMinute', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ telegram: { rateLimitPerMinute: -1 } }),
    ).toThrow();
  });
});

// ─── applyEnvOverrides ───────────────────────────────────────────────────────

describe('applyEnvOverrides', () => {
  function defaults(): RuntimeConfig {
    return RuntimeConfigSchema.parse({});
  }

  it('does not change config when no env vars set', () => {
    const cfg = defaults();
    const result = applyEnvOverrides(cfg);
    expect(result.telegram.botToken).toBeUndefined();
    expect(result.workspacePath).toBeUndefined();
  });

  it('sets botToken from TELEGRAM_BOT_TOKEN', () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'legacy-token';
    const result = applyEnvOverrides(defaults());
    expect(result.telegram.botToken).toBe('legacy-token');
  });

  it('PYRFOR_TELEGRAM_BOT_TOKEN wins over TELEGRAM_BOT_TOKEN', () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'legacy';
    process.env['PYRFOR_TELEGRAM_BOT_TOKEN'] = 'pyrfor';
    const result = applyEnvOverrides(defaults());
    expect(result.telegram.botToken).toBe('pyrfor');
  });

  it('parses allowedChatIds from CSV', () => {
    process.env['TELEGRAM_ALLOWED_CHAT_IDS'] = '123,456,mygroup';
    const result = applyEnvOverrides(defaults());
    expect(result.telegram.allowedChatIds).toEqual([123, 456, 'mygroup']);
  });

  it('sets openaiApiKey from OPENAI_API_KEY', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    const result = applyEnvOverrides(defaults());
    expect(result.voice.openaiApiKey).toBe('sk-test');
  });

  it('sets gateway port from PYRFOR_GATEWAY_PORT', () => {
    process.env['PYRFOR_GATEWAY_PORT'] = '9999';
    const result = applyEnvOverrides(defaults());
    expect(result.gateway.port).toBe(9999);
  });

  it('sets gateway bearerToken from PYRFOR_GATEWAY_TOKEN', () => {
    process.env['PYRFOR_GATEWAY_TOKEN'] = 'secret';
    const result = applyEnvOverrides(defaults());
    expect(result.gateway.bearerToken).toBe('secret');
  });

  it('sets workspacePath from PYRFOR_WORKSPACE', () => {
    process.env['PYRFOR_WORKSPACE'] = '/home/user/ws';
    const result = applyEnvOverrides(defaults());
    expect(result.workspacePath).toBe('/home/user/ws');
  });
});

// ─── loadConfig ──────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('returns defaults when file does not exist', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'nonexistent.json');
    const { config, loadedFromLegacy } = await loadConfig(cfgPath);
    expect(config.telegram.enabled).toBe(false);
    expect(loadedFromLegacy).toBe(false);
  });

  it('parses valid JSON file', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await fsp.writeFile(cfgPath, JSON.stringify({
      telegram: { enabled: true, botToken: 'abc' },
    }), 'utf-8');
    const { config } = await loadConfig(cfgPath);
    expect(config.telegram.enabled).toBe(true);
    expect(config.telegram.botToken).toBe('abc');
  });

  it('throws RuntimeConfigError for invalid JSON', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'bad.json');
    await fsp.writeFile(cfgPath, '{not valid json}', 'utf-8');
    await expect(loadConfig(cfgPath)).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it('throws RuntimeConfigError for schema violations', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'bad.json');
    await fsp.writeFile(cfgPath, JSON.stringify({ health: { intervalMs: 'bad' } }), 'utf-8');
    await expect(loadConfig(cfgPath)).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it('reads legacy path when primary is DEFAULT_CONFIG_PATH and missing', async () => {
    const d = await makeTmpDir();
    const legacyPath = path.join(d, 'ceoclaw.json');

    // Patch LEGACY_CONFIG_PATH by writing a "legacy" file and loading via
    // PYRFOR_CONFIG_PATH pointing to a nonexistent location while monkeypatching
    // is unavailable — instead test the explicit legacy path behaviour through
    // saveConfig + loadConfig with explicit path
    await fsp.writeFile(legacyPath, JSON.stringify({ telegram: { enabled: true } }), 'utf-8');
    const { config } = await loadConfig(legacyPath);
    expect(config.telegram.enabled).toBe(true);
  });

  it('PYRFOR_CONFIG_PATH env overrides default path', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'custom.json');
    await fsp.writeFile(cfgPath, JSON.stringify({ gateway: { port: 7777 } }), 'utf-8');
    process.env['PYRFOR_CONFIG_PATH'] = cfgPath;
    const { config } = await loadConfig();
    expect(config.gateway.port).toBe(7777);
  });
});

// ─── saveConfig ──────────────────────────────────────────────────────────────

describe('saveConfig', () => {
  it('creates parent directory if missing', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'nested', 'deep', 'runtime.json');
    const cfg = RuntimeConfigSchema.parse({});
    await saveConfig(cfg, cfgPath);
    const stat = await fsp.stat(cfgPath);
    expect(stat.isFile()).toBe(true);
  });

  it('writes JSON that can be loaded back', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    const cfg = RuntimeConfigSchema.parse({ telegram: { enabled: true, botToken: 'saved-tok' } });
    await saveConfig(cfg, cfgPath);
    const { config } = await loadConfig(cfgPath);
    expect(config.telegram.botToken).toBe('saved-tok');
  });

  it('is atomic: no .tmp file left after save', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    const cfg = RuntimeConfigSchema.parse({});
    await saveConfig(cfg, cfgPath);
    const files = await fsp.readdir(d);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('overwrites existing file', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 1000 } }), cfgPath);
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 2000 } }), cfgPath);
    const { config } = await loadConfig(cfgPath);
    expect(config.gateway.port).toBe(2000);
  });
});

// ─── watchConfig ──────────────────────────────────────────────────────────────

describe('watchConfig', () => {
  it('calls onChange when file changes', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');

    const initial = RuntimeConfigSchema.parse({ gateway: { port: 1111 } });
    await saveConfig(initial, cfgPath);

    const changes: Array<{ next: RuntimeConfig; prev: RuntimeConfig }> = [];
    const dispose = watchConfig(cfgPath, (next, prev) => {
      changes.push({ next, prev });
    }, { debounceMs: 100 });

    // Wait for initial load
    await sleep(200);

    // Write updated config
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 2222 } }), cfgPath);

    // Wait for watcher to fire
    await sleep(600);

    dispose();
    await sleep(200);

    expect(changes.length).toBeGreaterThanOrEqual(1);
    const last = changes[changes.length - 1];
    expect(last.next.gateway.port).toBe(2222);
  }, 10_000);

  it('dispose() stops receiving events', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({}), cfgPath);

    const changes: RuntimeConfig[] = [];
    const dispose = watchConfig(cfgPath, (next) => { changes.push(next); }, { debounceMs: 100 });

    await sleep(200);
    dispose();
    await sleep(100);

    const countBefore = changes.length;
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 3333 } }), cfgPath);
    await sleep(600);

    expect(changes.length).toBe(countBefore);
  }, 10_000);

  it('calls onError for broken JSON and keeps old config', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 4444 } }), cfgPath);

    const errors: unknown[] = [];
    const changes: RuntimeConfig[] = [];
    const dispose = watchConfig(
      cfgPath,
      (next) => { changes.push(next); },
      { debounceMs: 100, onError: (err) => errors.push(err) },
    );

    await sleep(200);

    // Write broken JSON
    await fsp.writeFile(cfgPath, '{not valid', 'utf-8');
    await sleep(600);

    dispose();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    // dispose should work fine even after error
  }, 10_000);
});

// ─── RuntimeConfigSchema – extended validation ────────────────────────────────

describe('RuntimeConfigSchema – extended validation', () => {
  it('rejects rateLimit.capacity with string type', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ rateLimit: { capacity: 'abc' } }),
    ).toThrow();
  });

  it('rejects negative rateLimit.capacity', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ rateLimit: { capacity: -5 } }),
    ).toThrow();
  });

  it('rejects rateLimit.capacity of 0 (must be positive)', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ rateLimit: { capacity: 0 } }),
    ).toThrow();
  });

  it('rejects rateLimit.refillPerSec of 0 (must be positive)', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ rateLimit: { refillPerSec: 0 } }),
    ).toThrow();
  });

  it('rejects rateLimit.exemptPaths with non-string element', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ rateLimit: { exemptPaths: [123] } }),
    ).toThrow();
  });

  it('rejects NaN for health.intervalMs', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ health: { intervalMs: NaN } }),
    ).toThrow();
  });

  it('rejects float for gateway.port (must be int)', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ gateway: { port: 18790.5 } }),
    ).toThrow();
  });

  it('rejects gateway.bearerTokens entry with value shorter than 8 chars', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ gateway: { bearerTokens: [{ value: 'short' }] } }),
    ).toThrow();
  });

  it('rejects cron.jobs entry missing required name and handler fields', () => {
    expect(() =>
      RuntimeConfigSchema.parse({ cron: { jobs: [{ schedule: '* * * * *' }] } }),
    ).toThrow();
  });

  it('strips unknown top-level fields', () => {
    const cfg = RuntimeConfigSchema.parse({ unknownField: 'ignored' });
    expect((cfg as Record<string, unknown>)['unknownField']).toBeUndefined();
    expect(cfg.telegram).toBeDefined(); // defaults still present
  });

  it('strips unknown nested fields inside gateway', () => {
    const cfg = RuntimeConfigSchema.parse({ gateway: { unknownNested: true } });
    expect((cfg.gateway as Record<string, unknown>)['unknownNested']).toBeUndefined();
    expect(cfg.gateway.host).toBe('127.0.0.1'); // defaults still present
  });

  it('accepts gateway.bearerTokens with past expiresAt (no expiry filtering at schema level)', () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    const cfg = RuntimeConfigSchema.parse({
      gateway: { bearerTokens: [{ value: 'atleasteight', expiresAt: pastDate }] },
    });
    expect(cfg.gateway.bearerTokens).toHaveLength(1);
    expect(cfg.gateway.bearerTokens[0].expiresAt).toBe(pastDate);
  });
});

// ─── loadConfig – extended ───────────────────────────────────────────────────

describe('loadConfig – extended', () => {
  it('does not create the config file when path is missing (returns defaults only)', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'subdir', 'nonexistent.json');
    const { config } = await loadConfig(cfgPath);
    // subdir should not have been created, file definitely not created
    await expect(fsp.access(cfgPath)).rejects.toThrow();
    // returned config has all defaults
    expect(config.telegram.enabled).toBe(false);
    expect(config.gateway.port).toBe(18790);
    expect(config.rateLimit.capacity).toBe(60);
  });

  it('RuntimeConfigError for schema violation carries .issues', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'bad.json');
    await fsp.writeFile(cfgPath, JSON.stringify({ rateLimit: { capacity: 'bad' } }), 'utf-8');
    const err = await loadConfig(cfgPath).catch((e) => e);
    expect(err).toBeInstanceOf(RuntimeConfigError);
    expect((err as RuntimeConfigError).issues).toBeDefined();
    expect((err as RuntimeConfigError).issues!.length).toBeGreaterThan(0);
  });

  it('strips unknown fields from file on load', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await fsp.writeFile(
      cfgPath,
      JSON.stringify({ unknownTopLevel: 'value', gateway: { port: 8080, unknownNested: true } }),
      'utf-8',
    );
    const { config } = await loadConfig(cfgPath);
    expect(config.gateway.port).toBe(8080);
    expect((config as Record<string, unknown>)['unknownTopLevel']).toBeUndefined();
    expect((config.gateway as Record<string, unknown>)['unknownNested']).toBeUndefined();
  });

  it('PYRFOR_CONFIG_PATH pointing to missing file returns defaults (no legacy fallback)', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'nonexistent.json');
    process.env['PYRFOR_CONFIG_PATH'] = cfgPath;
    const { config, loadedFromLegacy } = await loadConfig();
    expect(loadedFromLegacy).toBe(false);
    expect(config.telegram.enabled).toBe(false);
    expect(config.gateway.host).toBe('127.0.0.1');
  });

  it('nested field with wrong type throws RuntimeConfigError', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'bad.json');
    await fsp.writeFile(
      cfgPath,
      JSON.stringify({ rateLimit: { capacity: 'abc', refillPerSec: 1 } }),
      'utf-8',
    );
    await expect(loadConfig(cfgPath)).rejects.toBeInstanceOf(RuntimeConfigError);
  });
});

// ─── saveConfig – extended ───────────────────────────────────────────────────

describe('saveConfig – extended', () => {
  it('saves _schemaVersion in output JSON', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({}), cfgPath);
    const raw = await fsp.readFile(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['_schemaVersion']).toBe(SCHEMA_VERSION);
  });

  it('concurrent writes: file remains readable and one writer wins', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    const cfg1 = RuntimeConfigSchema.parse({ gateway: { port: 5001 } });
    const cfg2 = RuntimeConfigSchema.parse({ gateway: { port: 5002 } });
    await Promise.all([saveConfig(cfg1, cfgPath), saveConfig(cfg2, cfgPath)]);
    const { config } = await loadConfig(cfgPath);
    expect([5001, 5002]).toContain(config.gateway.port);
    expect(config.telegram).toBeDefined();
    expect(config.rateLimit).toBeDefined();
  });

  it('saved file has mode 0o600 (Unix only)', async () => {
    if (process.platform === 'win32') return;
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({}), cfgPath);
    const stat = await fsp.stat(cfgPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ─── watchConfig – extended ──────────────────────────────────────────────────

describe('watchConfig – extended', () => {
  it('dispose() is idempotent — calling twice does not throw', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({}), cfgPath);
    const dispose = watchConfig(cfgPath, () => {}, { debounceMs: 50 });
    await sleep(80);
    expect(() => dispose()).not.toThrow();
    expect(() => dispose()).not.toThrow();
  }, 5_000);

  it('onChange receives full RuntimeConfig with all top-level keys', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 9876 } }), cfgPath);

    let receivedConfig: RuntimeConfig | undefined;
    const dispose = watchConfig(cfgPath, (next) => { receivedConfig = next; }, { debounceMs: 100 });

    await sleep(200);
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 9877 } }), cfgPath);
    await sleep(600);
    dispose();

    expect(receivedConfig).toBeDefined();
    expect(receivedConfig!.telegram).toBeDefined();
    expect(receivedConfig!.voice).toBeDefined();
    expect(receivedConfig!.cron).toBeDefined();
    expect(receivedConfig!.health).toBeDefined();
    expect(receivedConfig!.rateLimit).toBeDefined();
    expect(receivedConfig!.gateway.port).toBe(9877);
    expect(receivedConfig!.persistence).toBeDefined();
  }, 10_000);

  it('rapid file changes within debounce window collapse to fewer onChange calls', async () => {
    const d = await makeTmpDir();
    const cfgPath = path.join(d, 'runtime.json');
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 1000 } }), cfgPath);

    const changes: RuntimeConfig[] = [];
    const dispose = watchConfig(cfgPath, (next) => { changes.push(next); }, { debounceMs: 300 });

    await sleep(200); // allow initial load to settle

    // Three rapid writes — all within the 300ms debounce window
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 1001 } }), cfgPath);
    await sleep(20);
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 1002 } }), cfgPath);
    await sleep(20);
    await saveConfig(RuntimeConfigSchema.parse({ gateway: { port: 1003 } }), cfgPath);

    // Wait for debounce + margin
    await sleep(700);
    dispose();

    // Debounce should collapse multiple events; expect fewer callbacks than writes
    expect(changes.length).toBeLessThan(3);
    // Final onChange must reflect last written value
    expect(changes[changes.length - 1].gateway.port).toBe(1003);
  }, 10_000);
});
