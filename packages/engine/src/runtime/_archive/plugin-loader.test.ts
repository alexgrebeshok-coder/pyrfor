// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createPluginLoader } from './plugin-loader';
import type { PluginManifest } from './plugin-loader';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pyrfor-plugin-test-'));
}

function writeManifest(pluginsDir: string, name: string, manifest: Partial<PluginManifest> & { name?: string }): void {
  const dir = path.join(pluginsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', entry: 'index.js', ...manifest }));
}

function writeEntryFile(pluginsDir: string, name: string, entry = 'index.js'): void {
  const dir = path.join(pluginsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, entry), '');
}

function setupPlugin(
  pluginsDir: string,
  name: string,
  extra: Partial<PluginManifest> = {},
): void {
  writeManifest(pluginsDir, name, { name, version: '1.0.0', entry: 'index.js', ...extra });
  writeEntryFile(pluginsDir, name, (extra.entry as string | undefined) ?? 'index.js');
}

function fakeLoader(mod: unknown) {
  return (_p: string) => Promise.resolve(mod);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('PluginLoader', () => {
  let pluginsDir: string;

  beforeEach(() => {
    pluginsDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(pluginsDir, { recursive: true, force: true });
  });

  // ── discover ────────────────────────────────────────────────────────────────

  describe('discover()', () => {
    it('finds plugins with valid plugin.json', async () => {
      setupPlugin(pluginsDir, 'alpha');
      setupPlugin(pluginsDir, 'beta');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      const manifests = await loader.discover();
      const names = manifests.map((m) => m.name).sort();
      expect(names).toEqual(['alpha', 'beta']);
    });

    it('skips directories without plugin.json', async () => {
      fs.mkdirSync(path.join(pluginsDir, 'no-manifest'));
      setupPlugin(pluginsDir, 'valid');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      const manifests = await loader.discover();
      expect(manifests.map((m) => m.name)).toEqual(['valid']);
    });

    it('returns empty array for non-existent pluginsDir', async () => {
      const loader = createPluginLoader({ pluginsDir: '/non/existent/path', moduleLoader: fakeLoader({}) });
      const manifests = await loader.discover();
      expect(manifests).toEqual([]);
    });

    it('skips dirs with invalid plugin.json silently', async () => {
      const badDir = path.join(pluginsDir, 'bad');
      fs.mkdirSync(badDir);
      fs.writeFileSync(path.join(badDir, 'plugin.json'), 'not-json');
      setupPlugin(pluginsDir, 'good');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      const manifests = await loader.discover();
      expect(manifests.map((m) => m.name)).toEqual(['good']);
    });
  });

  // ── manifest validation ─────────────────────────────────────────────────────

  describe('load() manifest validation', () => {
    it('rejects missing name', async () => {
      const dir = path.join(pluginsDir, 'unnamed');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ version: '1.0.0', entry: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), '');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await expect(loader.load('unnamed')).rejects.toThrow(/name/i);
    });

    it('rejects empty name', async () => {
      const dir = path.join(pluginsDir, 'emptyname');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: '', version: '1.0.0', entry: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), '');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await expect(loader.load('emptyname')).rejects.toThrow(/name/i);
    });

    it('rejects invalid semver-ish version "foo.bar"', async () => {
      const dir = path.join(pluginsDir, 'badver');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'badver', version: 'foo.bar', entry: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), '');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await expect(loader.load('badver')).rejects.toThrow(/version/i);
    });

    it('rejects version like "1.0" (only two parts)', async () => {
      const dir = path.join(pluginsDir, 'shortver');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'shortver', version: '1.0', entry: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), '');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await expect(loader.load('shortver')).rejects.toThrow(/version/i);
    });

    it('accepts valid semver-ish version "2.3.4"', async () => {
      setupPlugin(pluginsDir, 'goodver', { version: '2.3.4' });
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      const plugin = await loader.load('goodver');
      expect(plugin.manifest.version).toBe('2.3.4');
    });

    it('rejects missing entry file on disk', async () => {
      const dir = path.join(pluginsDir, 'noentry');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'noentry', version: '1.0.0', entry: 'missing.js' }));
      // intentionally NOT creating missing.js
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await expect(loader.load('noentry')).rejects.toThrow(/Entry file not found/i);
    });

    it('sets state=error and stores error when entry file missing', async () => {
      const dir = path.join(pluginsDir, 'noentry2');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'noentry2', version: '1.0.0', entry: 'absent.js' }));
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await loader.load('noentry2').catch(() => {});
      const plugin = loader.get('noentry2');
      expect(plugin?.state).toBe('error');
      expect(plugin?.error).toBeInstanceOf(Error);
    });
  });

  // ── permissions ──────────────────────────────────────────────────────────────

  describe('permissions', () => {
    it('throws PLUGIN_PERMISSION_DENIED when required permission not granted', async () => {
      setupPlugin(pluginsDir, 'restricted', { permissions: ['shell:run'] });
      const loader = createPluginLoader({ pluginsDir, grantedPermissions: [], moduleLoader: fakeLoader({}) });
      const err = await loader.load('restricted').catch((e: Error) => e);
      expect((err as Error & { code: string }).code).toBe('PLUGIN_PERMISSION_DENIED');
      expect(err.message).toMatch(/shell:run/);
    });

    it('error message lists all missing permissions', async () => {
      setupPlugin(pluginsDir, 'multi-perm', { permissions: ['fs:read', 'net:fetch', 'shell:run'] });
      const loader = createPluginLoader({ pluginsDir, grantedPermissions: ['fs:read'], moduleLoader: fakeLoader({}) });
      const err = await loader.load('multi-perm').catch((e: Error) => e);
      expect(err.message).toMatch(/net:fetch/);
      expect(err.message).toMatch(/shell:run/);
    });

    it('granted permissions allow load to proceed', async () => {
      setupPlugin(pluginsDir, 'allowed', { permissions: ['fs:read', 'net:fetch'] });
      const loader = createPluginLoader({
        pluginsDir,
        grantedPermissions: ['fs:read', 'net:fetch'],
        moduleLoader: fakeLoader({ default: {} }),
      });
      const plugin = await loader.load('allowed');
      expect(plugin.state).toBe('loaded');
    });

    it('plugin with no permissions always loads', async () => {
      setupPlugin(pluginsDir, 'open', { permissions: [] });
      const loader = createPluginLoader({ pluginsDir, grantedPermissions: [], moduleLoader: fakeLoader({ default: {} }) });
      const plugin = await loader.load('open');
      expect(plugin.state).toBe('loaded');
    });

    it('sets state=error on permission denied', async () => {
      setupPlugin(pluginsDir, 'permerror', { permissions: ['shell:run'] });
      const loader = createPluginLoader({ pluginsDir, grantedPermissions: [], moduleLoader: fakeLoader({}) });
      await loader.load('permerror').catch(() => {});
      expect(loader.get('permerror')?.state).toBe('error');
    });

    it('invokes onError on permission denied', async () => {
      setupPlugin(pluginsDir, 'perrcb', { permissions: ['shell:run'] });
      const onError = vi.fn();
      const loader = createPluginLoader({ pluginsDir, grantedPermissions: [], moduleLoader: fakeLoader({}), onError });
      await loader.load('perrcb').catch(() => {});
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'perrcb');
    });
  });

  // ── duplicate ────────────────────────────────────────────────────────────────

  describe('duplicate detection', () => {
    it('throws PLUGIN_DUPLICATE when loading same name twice', async () => {
      setupPlugin(pluginsDir, 'dupecheck');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      await loader.load('dupecheck');
      const err = await loader.load('dupecheck').catch((e: Error) => e);
      expect((err as Error & { code: string }).code).toBe('PLUGIN_DUPLICATE');
    });
  });

  // ── module loading ───────────────────────────────────────────────────────────

  describe('module loading', () => {
    it('calls onLoad with manifest config', async () => {
      const onLoad = vi.fn();
      setupPlugin(pluginsDir, 'withload', { config: { theme: 'dark' } });
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { onLoad } }),
      });
      await loader.load('withload');
      expect(onLoad).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('calls onLoad with empty object when no config in manifest', async () => {
      const onLoad = vi.fn();
      setupPlugin(pluginsDir, 'noconfig');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { onLoad } }),
      });
      await loader.load('noconfig');
      expect(onLoad).toHaveBeenCalledWith({});
    });

    it('sets state=error when moduleLoader throws', async () => {
      setupPlugin(pluginsDir, 'failload');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: () => Promise.reject(new Error('import failed')),
      });
      await loader.load('failload').catch(() => {});
      const plugin = loader.get('failload');
      expect(plugin?.state).toBe('error');
      expect(plugin?.error?.message).toBe('import failed');
    });

    it('invokes onError when moduleLoader throws', async () => {
      setupPlugin(pluginsDir, 'failcb');
      const onError = vi.fn();
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: () => Promise.reject(new Error('boom')),
        onError,
      });
      await loader.load('failcb').catch(() => {});
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), 'failcb');
    });

    it('injected moduleLoader is used instead of native import', async () => {
      const customLoader = vi.fn().mockResolvedValue({ default: {} });
      setupPlugin(pluginsDir, 'injected');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: customLoader });
      await loader.load('injected');
      expect(customLoader).toHaveBeenCalled();
    });

    it('stores hooks from module exports', async () => {
      const myHook = vi.fn().mockReturnValue('hook-result');
      setupPlugin(pluginsDir, 'hookplugin');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { hooks: { myHook } } }),
      });
      const plugin = await loader.load('hookplugin');
      expect(plugin.hooks).toHaveProperty('myHook');
    });
  });

  // ── loadAll ─────────────────────────────────────────────────────────────────

  describe('loadAll()', () => {
    it('loads all discovered plugins', async () => {
      setupPlugin(pluginsDir, 'p1');
      setupPlugin(pluginsDir, 'p2');
      setupPlugin(pluginsDir, 'p3');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      const plugins = await loader.loadAll();
      expect(plugins).toHaveLength(3);
    });

    it('returns all plugins including error ones', async () => {
      setupPlugin(pluginsDir, 'good');
      // bad plugin - no entry file
      const badDir = path.join(pluginsDir, 'bad');
      fs.mkdirSync(badDir);
      fs.writeFileSync(path.join(badDir, 'plugin.json'), JSON.stringify({ name: 'bad', version: '1.0.0', entry: 'missing.js' }));
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      const plugins = await loader.loadAll();
      const states = plugins.map((p) => p.state).sort();
      expect(states).toContain('loaded');
      expect(states).toContain('error');
    });
  });

  // ── enable / disable ─────────────────────────────────────────────────────────

  describe('enable() and disable()', () => {
    it('calls onEnable and sets state=active', async () => {
      const onEnable = vi.fn();
      setupPlugin(pluginsDir, 'toenable');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { onEnable } }),
      });
      await loader.load('toenable');
      await loader.enable('toenable');
      expect(onEnable).toHaveBeenCalled();
      expect(loader.get('toenable')?.state).toBe('active');
    });

    it('calls onDisable and sets state=disabled', async () => {
      const onDisable = vi.fn();
      setupPlugin(pluginsDir, 'todisable');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { onDisable } }),
      });
      await loader.load('todisable');
      await loader.enable('todisable');
      await loader.disable('todisable');
      expect(onDisable).toHaveBeenCalled();
      expect(loader.get('todisable')?.state).toBe('disabled');
    });

    it('throws when enabling unknown plugin', async () => {
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await expect(loader.enable('ghost')).rejects.toThrow(/ghost/);
    });

    it('throws when disabling unknown plugin', async () => {
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      await expect(loader.disable('ghost')).rejects.toThrow(/ghost/);
    });
  });

  // ── unload ──────────────────────────────────────────────────────────────────

  describe('unload()', () => {
    it('calls onUnload and removes from registry', async () => {
      const onUnload = vi.fn();
      setupPlugin(pluginsDir, 'tounload');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { onUnload } }),
      });
      await loader.load('tounload');
      const result = await loader.unload('tounload');
      expect(result).toBe(true);
      expect(onUnload).toHaveBeenCalled();
      expect(loader.get('tounload')).toBeUndefined();
    });

    it('returns false for unknown plugin', async () => {
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      const result = await loader.unload('nonexistent');
      expect(result).toBe(false);
    });

    it('plugin not in list after unload', async () => {
      setupPlugin(pluginsDir, 'cleanup');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      await loader.load('cleanup');
      await loader.unload('cleanup');
      expect(loader.list()).toHaveLength(0);
    });
  });

  // ── get / list ───────────────────────────────────────────────────────────────

  describe('get() and list()', () => {
    it('get returns plugin by name', async () => {
      setupPlugin(pluginsDir, 'getme');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      await loader.load('getme');
      const plugin = loader.get('getme');
      expect(plugin).toBeDefined();
      expect(plugin?.manifest.name).toBe('getme');
    });

    it('get returns undefined for unknown name', () => {
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({}) });
      expect(loader.get('unknown')).toBeUndefined();
    });

    it('list returns all loaded plugins', async () => {
      setupPlugin(pluginsDir, 'l1');
      setupPlugin(pluginsDir, 'l2');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      await loader.load('l1');
      await loader.load('l2');
      expect(loader.list()).toHaveLength(2);
    });

    it('list reflects state changes', async () => {
      setupPlugin(pluginsDir, 'statecheck');
      const loader = createPluginLoader({ pluginsDir, moduleLoader: fakeLoader({ default: {} }) });
      await loader.load('statecheck');
      expect(loader.list()[0].state).toBe('loaded');
      await loader.enable('statecheck');
      expect(loader.list()[0].state).toBe('active');
      await loader.disable('statecheck');
      expect(loader.list()[0].state).toBe('disabled');
    });
  });

  // ── invokeHook ───────────────────────────────────────────────────────────────

  describe('invokeHook()', () => {
    it('calls hook only on active plugins', async () => {
      const hook = vi.fn().mockReturnValue('ok');
      setupPlugin(pluginsDir, 'activeplugin');
      setupPlugin(pluginsDir, 'loadedplugin');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { hooks: { myHook: hook } } }),
      });
      await loader.load('activeplugin');
      await loader.load('loadedplugin');
      await loader.enable('activeplugin');
      // loadedplugin remains in 'loaded' state

      const results = await loader.invokeHook('myHook', 'arg1');
      expect(hook).toHaveBeenCalledTimes(1);
      expect(results).toEqual(['ok']);
    });

    it('does not call hook on disabled plugins', async () => {
      const hook = vi.fn().mockReturnValue('val');
      setupPlugin(pluginsDir, 'wentdisabled');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { hooks: { someHook: hook } } }),
      });
      await loader.load('wentdisabled');
      await loader.enable('wentdisabled');
      await loader.disable('wentdisabled');
      const results = await loader.invokeHook('someHook');
      expect(hook).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('returns results from all active plugins', async () => {
      setupPlugin(pluginsDir, 'h1');
      setupPlugin(pluginsDir, 'h2');
      let call = 0;
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: (_p: string) => {
          const n = ++call;
          return Promise.resolve({ default: { hooks: { compute: () => n * 10 } } });
        },
      });
      await loader.load('h1');
      await loader.load('h2');
      await loader.enable('h1');
      await loader.enable('h2');
      const results = await loader.invokeHook<number>('compute');
      expect(results.sort((a, b) => a - b)).toEqual([10, 20]);
    });

    it('hook error does not stop other plugins from being invoked', async () => {
      const goodHook = vi.fn().mockReturnValue('good');
      const badHook = vi.fn().mockRejectedValue(new Error('hook-boom'));
      setupPlugin(pluginsDir, 'hookgood');
      setupPlugin(pluginsDir, 'hookbad');

      let call2 = 0;
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: (p: string) => {
          call2++;
          if (p.includes('hookbad')) return Promise.resolve({ default: { hooks: { run: badHook } } });
          return Promise.resolve({ default: { hooks: { run: goodHook } } });
        },
      });
      await loader.load('hookgood');
      await loader.load('hookbad');
      await loader.enable('hookgood');
      await loader.enable('hookbad');

      const results = await loader.invokeHook('run');
      expect(goodHook).toHaveBeenCalled();
      expect(badHook).toHaveBeenCalled();
      expect(results).toEqual(['good']); // only good result collected
    });

    it('onError invoked when hook throws', async () => {
      const onError = vi.fn();
      setupPlugin(pluginsDir, 'hookerror');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { hooks: { boom: () => { throw new Error('hook-err'); } } } }),
        onError,
      });
      await loader.load('hookerror');
      await loader.enable('hookerror');
      await loader.invokeHook('boom');
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'hook-err' }), 'hookerror');
    });

    it('returns empty array when no active plugins have the hook', async () => {
      setupPlugin(pluginsDir, 'nohook');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: {} }),
      });
      await loader.load('nohook');
      await loader.enable('nohook');
      const results = await loader.invokeHook('nonExistentHook');
      expect(results).toEqual([]);
    });

    it('passes args to hook functions', async () => {
      const hook = vi.fn().mockReturnValue(null);
      setupPlugin(pluginsDir, 'argplugin');
      const loader = createPluginLoader({
        pluginsDir,
        moduleLoader: fakeLoader({ default: { hooks: { handle: hook } } }),
      });
      await loader.load('argplugin');
      await loader.enable('argplugin');
      await loader.invokeHook('handle', 'a', 42, { x: true });
      expect(hook).toHaveBeenCalledWith('a', 42, { x: true });
    });
  });
});
