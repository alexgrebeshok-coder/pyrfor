import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { homedir } from 'node:os';
import { registerStandardTools, ToolRegistry } from './permission-engine.js';
import { runtimeToolDefinitions } from './tools.js';
const PLAYWRIGHT_INSTALL_HINT = 'Install Playwright and Chromium with: pnpm add -w playwright @playwright/browsers && pnpm exec playwright install chromium';
export function getBrowserQAReadiness(options = {}) {
    var _a, _b, _c;
    const now = (_a = options.now) !== null && _a !== void 0 ? _a : (() => new Date());
    const browserTool = runtimeToolDefinitions.find((tool) => tool.name === 'browser');
    const actionSchema = browserTool === null || browserTool === void 0 ? void 0 : browserTool.parameters.properties['action'];
    const actions = isEnumSchema(actionSchema) ? actionSchema.enum : [];
    const registry = new ToolRegistry();
    registerStandardTools(registry);
    const browserPermission = registry.get('browser_navigate');
    const playwrightEntryPath = resolveModulePath('playwright', options.resolveModule);
    const playwrightInstalled = Boolean(playwrightEntryPath);
    const chromiumInstalled = playwrightInstalled
        ? ((_b = options.isChromiumRuntimeInstalled) !== null && _b !== void 0 ? _b : hasLocalPlaywrightChromiumRuntime)(playwrightEntryPath)
        : false;
    const reasons = [];
    if (!browserTool)
        reasons.push('Runtime browser tool is not registered.');
    if (!playwrightInstalled)
        reasons.push('Playwright package is not installed for Browser QA.');
    if (playwrightInstalled && !chromiumInstalled)
        reasons.push('Playwright Chromium runtime is not installed for Browser QA.');
    if (!browserPermission)
        reasons.push('browser_navigate permission policy is not registered.');
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
            actions: actions.filter((item) => typeof item === 'string'),
        },
        playwright: {
            packageName: 'playwright',
            installed: playwrightInstalled,
            chromiumInstalled,
            installHint: PLAYWRIGHT_INSTALL_HINT,
        },
        permission: {
            toolName: 'browser_navigate',
            permissionClass: (_c = browserPermission === null || browserPermission === void 0 ? void 0 : browserPermission.defaultPermission) !== null && _c !== void 0 ? _c : null,
            sideEffect: (browserPermission === null || browserPermission === void 0 ? void 0 : browserPermission.sideEffect) === 'network' ? 'network' : null,
        },
        reasons: reasons.length > 0 ? reasons : ['Browser QA local prerequisites are configured.'],
        nextStep: status === 'ready'
            ? 'Request Trust approval before running any live browser smoke or screenshot capture.'
            : 'Install missing local Browser QA prerequisites before requesting browser smoke approval.',
    };
}
function resolveModulePath(moduleName, resolveModule) {
    const resolver = resolveModule !== null && resolveModule !== void 0 ? resolveModule : createRequire(import.meta.url).resolve;
    try {
        return resolver(moduleName);
    }
    catch (_a) {
        return null;
    }
}
function isEnumSchema(value) {
    return Boolean(value && typeof value === 'object' && Array.isArray(value.enum));
}
function hasLocalPlaywrightChromiumRuntime(playwrightEntryPath) {
    return getPlaywrightBrowserCacheDirs(playwrightEntryPath).some((cacheDir) => {
        if (!existsSync(cacheDir))
            return false;
        try {
            return readdirSync(cacheDir, { withFileTypes: true }).some((entry) => (entry.isDirectory() && /^chromium(?:[_-]|$)/.test(entry.name)));
        }
        catch (_a) {
            return false;
        }
    });
}
function getPlaywrightBrowserCacheDirs(playwrightEntryPath) {
    const configuredPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (configuredPath && configuredPath !== '0')
        return [configuredPath];
    const packageRoot = playwrightEntryPath ? findPackageRoot(playwrightEntryPath) : null;
    if (configuredPath === '0' && packageRoot)
        return [join(packageRoot, '.local-browsers')];
    const dirs = [
        join(homedir(), 'Library', 'Caches', 'ms-playwright'),
        join(homedir(), '.cache', 'ms-playwright'),
    ];
    if (process.env.LOCALAPPDATA)
        dirs.push(join(process.env.LOCALAPPDATA, 'ms-playwright'));
    return dirs;
}
function findPackageRoot(entryPath) {
    let current = dirname(entryPath);
    const root = parse(current).root;
    while (current && current !== root) {
        if (existsSync(join(current, 'package.json')))
            return current;
        current = dirname(current);
    }
    return null;
}
