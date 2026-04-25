import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  description?: string;
  permissions?: string[];
  dependencies?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface Plugin {
  manifest: PluginManifest;
  instance: unknown;
  hooks: Record<string, (...args: unknown[]) => unknown>;
  state: 'loaded' | 'active' | 'disabled' | 'error';
  error?: Error;
}

interface PluginModuleShape {
  default?: {
    onLoad?: (config: unknown) => void | Promise<void>;
    onEnable?: () => void | Promise<void>;
    onDisable?: () => void | Promise<void>;
    onUnload?: () => void | Promise<void>;
    hooks?: Record<string, (...args: unknown[]) => unknown>;
  };
}

export interface PluginLoaderOptions {
  pluginsDir: string;
  grantedPermissions?: string[];
  moduleLoader?: (filePath: string) => Promise<unknown>;
  onError?: (err: Error, name?: string) => void;
}

export interface PluginLoader {
  discover(): Promise<PluginManifest[]>;
  load(name: string): Promise<Plugin>;
  loadAll(): Promise<Plugin[]>;
  unload(name: string): Promise<boolean>;
  enable(name: string): Promise<void>;
  disable(name: string): Promise<void>;
  get(name: string): Plugin | undefined;
  list(): Plugin[];
  invokeHook<T = unknown>(hook: string, ...args: unknown[]): Promise<T[]>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function makeError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code: string };
  (err as Error & { code: string }).code = code;
  return err;
}

function validateManifestFields(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== 'object') {
    throw makeError('PLUGIN_INVALID_MANIFEST', 'plugin.json must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string' || obj.name.trim() === '') {
    throw makeError('PLUGIN_INVALID_MANIFEST', 'Manifest "name" must be a non-empty string');
  }
  if (!obj.version || typeof obj.version !== 'string' || !SEMVER_RE.test(obj.version)) {
    throw makeError(
      'PLUGIN_INVALID_MANIFEST',
      `Manifest "version" must match \\d+.\\d+.\\d+, got: ${String(obj.version)}`,
    );
  }
  if (!obj.entry || typeof obj.entry !== 'string') {
    throw makeError('PLUGIN_INVALID_MANIFEST', 'Manifest "entry" must be a non-empty string');
  }

  return obj as unknown as PluginManifest;
}

function validateManifest(raw: unknown, pluginsDir: string): PluginManifest {
  const manifest = validateManifestFields(raw);

  const entryAbs = path.resolve(pluginsDir, manifest.name, manifest.entry);
  if (!fs.existsSync(entryAbs)) {
    throw makeError(
      'PLUGIN_INVALID_MANIFEST',
      `Entry file not found: ${entryAbs}`,
    );
  }

  return manifest;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPluginLoader(opts: PluginLoaderOptions): PluginLoader {
  const {
    pluginsDir,
    grantedPermissions = [],
    onError,
  } = opts;

  const moduleLoader: (filePath: string) => Promise<unknown> =
    opts.moduleLoader ?? ((p) => import(p));

  const registry = new Map<string, Plugin>();

  // ── discover ────────────────────────────────────────────────────────────────

  async function discover(): Promise<PluginManifest[]> {
    if (!fs.existsSync(pluginsDir)) return [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const manifests: PluginManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
        const manifest = validateManifestFields(raw);
        manifests.push(manifest);
      } catch {
        // skip invalid manifests in discover
      }
    }
    return manifests;
  }

  // ── load ────────────────────────────────────────────────────────────────────

  async function load(name: string): Promise<Plugin> {
    if (registry.has(name)) {
      throw makeError('PLUGIN_DUPLICATE', `Plugin "${name}" is already loaded`);
    }

    const manifestPath = path.join(pluginsDir, name, 'plugin.json');
    let manifest: PluginManifest;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
      manifest = validateManifest(raw, pluginsDir);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const plugin: Plugin = {
        manifest: { name, version: '0.0.0', entry: '' },
        instance: undefined,
        hooks: {},
        state: 'error',
        error,
      };
      registry.set(name, plugin);
      onError?.(error, name);
      throw error;
    }

    // Permission check
    const required = manifest.permissions ?? [];
    const missing = required.filter((p) => !grantedPermissions.includes(p));
    if (missing.length > 0) {
      const error = makeError(
        'PLUGIN_PERMISSION_DENIED',
        `Plugin "${name}" requires permissions not granted: ${missing.join(', ')}`,
      );
      const plugin: Plugin = {
        manifest,
        instance: undefined,
        hooks: {},
        state: 'error',
        error,
      };
      registry.set(name, plugin);
      onError?.(error, name);
      throw error;
    }

    // Load module
    const entryAbs = path.resolve(pluginsDir, name, manifest.entry);
    let instance: unknown;
    try {
      instance = await moduleLoader(entryAbs);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const plugin: Plugin = {
        manifest,
        instance: undefined,
        hooks: {},
        state: 'error',
        error,
      };
      registry.set(name, plugin);
      onError?.(error, name);
      throw error;
    }

    const mod = instance as PluginModuleShape;
    const pluginExports = mod?.default ?? (mod as PluginModuleShape['default']);
    const hooks: Record<string, (...args: unknown[]) => unknown> =
      (pluginExports as { hooks?: Record<string, (...args: unknown[]) => unknown> })?.hooks ?? {};

    const plugin: Plugin = {
      manifest,
      instance,
      hooks,
      state: 'loaded',
    };
    registry.set(name, plugin);

    // Call onLoad lifecycle hook
    try {
      const onLoad = (pluginExports as { onLoad?: (c: unknown) => unknown })?.onLoad;
      if (typeof onLoad === 'function') {
        await onLoad(manifest.config ?? {});
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      plugin.state = 'error';
      plugin.error = error;
      onError?.(error, name);
    }

    return plugin;
  }

  // ── loadAll ─────────────────────────────────────────────────────────────────

  async function loadAll(): Promise<Plugin[]> {
    const manifests = await discover();
    const results: Plugin[] = [];
    for (const m of manifests) {
      try {
        const plugin = await load(m.name);
        results.push(plugin);
      } catch {
        const existing = registry.get(m.name);
        if (existing) results.push(existing);
      }
    }
    return results;
  }

  // ── unload ──────────────────────────────────────────────────────────────────

  async function unload(name: string): Promise<boolean> {
    const plugin = registry.get(name);
    if (!plugin) return false;

    const mod = plugin.instance as PluginModuleShape;
    const pluginExports = mod?.default ?? (mod as PluginModuleShape['default']);
    try {
      const onUnload = (pluginExports as { onUnload?: () => unknown })?.onUnload;
      if (typeof onUnload === 'function') {
        await onUnload();
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error, name);
    }

    registry.delete(name);
    return true;
  }

  // ── enable ──────────────────────────────────────────────────────────────────

  async function enable(name: string): Promise<void> {
    const plugin = registry.get(name);
    if (!plugin) throw new Error(`Plugin "${name}" not found`);

    const mod = plugin.instance as PluginModuleShape;
    const pluginExports = mod?.default ?? (mod as PluginModuleShape['default']);
    try {
      const onEnable = (pluginExports as { onEnable?: () => unknown })?.onEnable;
      if (typeof onEnable === 'function') {
        await onEnable();
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error, name);
      throw error;
    }

    plugin.state = 'active';
  }

  // ── disable ─────────────────────────────────────────────────────────────────

  async function disable(name: string): Promise<void> {
    const plugin = registry.get(name);
    if (!plugin) throw new Error(`Plugin "${name}" not found`);

    const mod = plugin.instance as PluginModuleShape;
    const pluginExports = mod?.default ?? (mod as PluginModuleShape['default']);
    try {
      const onDisable = (pluginExports as { onDisable?: () => unknown })?.onDisable;
      if (typeof onDisable === 'function') {
        await onDisable();
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error, name);
      throw error;
    }

    plugin.state = 'disabled';
  }

  // ── get / list ───────────────────────────────────────────────────────────────

  function get(name: string): Plugin | undefined {
    return registry.get(name);
  }

  function list(): Plugin[] {
    return Array.from(registry.values());
  }

  // ── invokeHook ───────────────────────────────────────────────────────────────

  async function invokeHook<T = unknown>(hook: string, ...args: unknown[]): Promise<T[]> {
    const results: T[] = [];
    for (const plugin of registry.values()) {
      if (plugin.state !== 'active') continue;
      const hookFn = plugin.hooks[hook];
      if (typeof hookFn !== 'function') continue;
      try {
        const result = await hookFn(...args);
        results.push(result as T);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error, plugin.manifest.name);
      }
    }
    return results;
  }

  return { discover, load, loadAll, unload, enable, disable, get, list, invokeHook };
}
