import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { homedir } from 'node:os';
import { registerStandardTools, ToolRegistry, type PermissionClass } from './permission-engine.js';
import { runtimeToolDefinitions } from './tools.js';

export interface BrowserQAReadiness {
  checkedAt: string;
  statusSource: 'local-config';
  liveProbeSkipped: true;
  approvalRequired: true;
  status: 'ready' | 'unavailable';
  browserTool: {
    name: 'browser';
    available: boolean;
    actions: string[];
  };
  playwright: {
    packageName: 'playwright';
    installed: boolean;
    chromiumInstalled: boolean;
    installHint: string;
  };
  permission: {
    toolName: 'browser_navigate';
    permissionClass: PermissionClass | null;
    sideEffect: 'network' | null;
  };
  reasons: string[];
  nextStep: string;
}

export interface BrowserQAReadinessOptions {
  resolveModule?: (moduleName: string) => string;
  isChromiumRuntimeInstalled?: (playwrightEntryPath: string | null) => boolean;
  now?: () => Date;
}

const PLAYWRIGHT_INSTALL_HINT = 'Install Playwright and Chromium with: pnpm add -w playwright @playwright/browsers && pnpm exec playwright install chromium';

export function getBrowserQAReadiness(options: BrowserQAReadinessOptions = {}): BrowserQAReadiness {
  const now = options.now ?? (() => new Date());
  const browserTool = runtimeToolDefinitions.find((tool) => tool.name === 'browser');
  const actionSchema = browserTool?.parameters.properties['action'];
  const actions = isEnumSchema(actionSchema) ? actionSchema.enum : [];
  const registry = new ToolRegistry();
  registerStandardTools(registry);
  const browserPermission = registry.get('browser_navigate');
  const playwrightEntryPath = resolveModulePath('playwright', options.resolveModule);
  const playwrightInstalled = Boolean(playwrightEntryPath);
  const chromiumInstalled = playwrightInstalled
    ? (options.isChromiumRuntimeInstalled ?? hasLocalPlaywrightChromiumRuntime)(playwrightEntryPath)
    : false;
  const reasons: string[] = [];

  if (!browserTool) reasons.push('Runtime browser tool is not registered.');
  if (!playwrightInstalled) reasons.push('Playwright package is not installed for Browser QA.');
  if (playwrightInstalled && !chromiumInstalled) reasons.push('Playwright Chromium runtime is not installed for Browser QA.');
  if (!browserPermission) reasons.push('browser_navigate permission policy is not registered.');
  if (browserPermission && browserPermission.defaultPermission !== 'ask_once') {
    reasons.push(`browser_navigate permission is ${browserPermission.defaultPermission}; expected ask_once.`);
  }

  const status = reasons.length === 0 ? 'ready' : 'unavailable';
  return {
    checkedAt: now().toISOString(),
    statusSource: 'local-config',
    liveProbeSkipped: true,
    approvalRequired: true,
    status,
    browserTool: {
      name: 'browser',
      available: Boolean(browserTool),
      actions: actions.filter((item): item is string => typeof item === 'string'),
    },
    playwright: {
      packageName: 'playwright',
      installed: playwrightInstalled,
      chromiumInstalled,
      installHint: PLAYWRIGHT_INSTALL_HINT,
    },
    permission: {
      toolName: 'browser_navigate',
      permissionClass: browserPermission?.defaultPermission ?? null,
      sideEffect: browserPermission?.sideEffect === 'network' ? 'network' : null,
    },
    reasons: reasons.length > 0 ? reasons : ['Browser QA local prerequisites are configured.'],
    nextStep: status === 'ready'
      ? 'Request Trust approval before running any live browser smoke or screenshot capture.'
      : 'Install missing local Browser QA prerequisites before requesting browser smoke approval.',
  };
}

function resolveModulePath(moduleName: string, resolveModule?: (moduleName: string) => string): string | null {
  const resolver = resolveModule ?? createRequire(import.meta.url).resolve;
  try {
    return resolver(moduleName);
  } catch {
    return null;
  }
}

function isEnumSchema(value: unknown): value is { enum: unknown[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { enum?: unknown }).enum));
}

function hasLocalPlaywrightChromiumRuntime(playwrightEntryPath: string | null): boolean {
  return getPlaywrightBrowserCacheDirs(playwrightEntryPath).some((cacheDir) => {
    if (!existsSync(cacheDir)) return false;
    try {
      return readdirSync(cacheDir, { withFileTypes: true }).some((entry) => (
        entry.isDirectory() && /^chromium(?:[_-]|$)/.test(entry.name)
      ));
    } catch {
      return false;
    }
  });
}

function getPlaywrightBrowserCacheDirs(playwrightEntryPath: string | null): string[] {
  const configuredPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (configuredPath && configuredPath !== '0') return [configuredPath];
  const packageRoot = playwrightEntryPath ? findPackageRoot(playwrightEntryPath) : null;
  if (configuredPath === '0' && packageRoot) return [join(packageRoot, '.local-browsers')];
  const dirs = [
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ];
  if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, 'ms-playwright'));
  return dirs;
}

function findPackageRoot(entryPath: string): string | null {
  let current = dirname(entryPath);
  const root = parse(current).root;
  while (current && current !== root) {
    if (existsSync(join(current, 'package.json'))) return current;
    current = dirname(current);
  }
  return null;
}
