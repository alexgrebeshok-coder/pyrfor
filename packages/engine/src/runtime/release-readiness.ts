import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_SECRET_ENV_VARS = [
  'APPLE_SIGNING_IDENTITY',
  'APPLE_CERTIFICATE_P12',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_ID',
  'APPLE_TEAM_ID',
  'APPLE_PASSWORD',
  'TAURI_SIGNING_PRIVATE_KEY',
] as const;

export const RELEASE_SIDECAR_ARTIFACTS = [
  'pyrfor-daemon-aarch64-apple-darwin',
  '_runtime/node',
  '_app/bin/pyrfor.cjs',
  '_app/dist/runtime/gateway.js',
  '_app/dist/runtime/cli.js',
  '_app/node_modules/server-only/index.js',
] as const;

export type ReleaseSecretEnvVar = typeof RELEASE_SECRET_ENV_VARS[number];

export interface ReleaseReadiness {
  checkedAt: string;
  statusSource: 'local-config';
  liveProbeSkipped: true;
  approvalRequired: true;
  status: 'ready' | 'unavailable';
  secrets: Array<{
    name: ReleaseSecretEnvVar;
    configured: boolean;
  }>;
  artifacts: Array<{
    name: typeof RELEASE_SIDECAR_ARTIFACTS[number];
    present: boolean;
  }>;
  contracts: Array<{
    id: string;
    passed: boolean;
    description: string;
  }>;
  reasons: string[];
  nextStep: string;
}

export interface ReleaseReadinessOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function getReleaseReadiness(options: ReleaseReadinessOptions = {}): ReleaseReadiness {
  const root = options.root ?? resolveReleaseReadinessRoot();
  const layout = resolveReleaseLayout(root);
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const secrets = RELEASE_SECRET_ENV_VARS.map((name) => ({
    name,
    configured: Boolean(env[name]?.trim()),
  }));
  const artifacts = RELEASE_SIDECAR_ARTIFACTS.map((name) => ({
    name,
    present: existsSync(resolveReleaseArtifactPath(root, layout, name)),
  }));
  const contracts = layout === 'bundled-resource'
    ? buildBundledReleaseContractChecks(root)
    : buildDevReleaseContractChecks(root);
  const reasons: string[] = [];

  for (const secret of secrets) {
    if (!secret.configured) reasons.push(`Release secret env is missing: ${secret.name}.`);
  }
  for (const artifact of artifacts) {
    if (!artifact.present) reasons.push(`Release sidecar artifact is missing: ${artifact.name}.`);
  }
  for (const contract of contracts) {
    if (!contract.passed) reasons.push(`Release contract failed: ${contract.description}.`);
  }

  const status = reasons.length === 0 ? 'ready' : 'unavailable';
  return {
    checkedAt: now().toISOString(),
    statusSource: 'local-config',
    liveProbeSkipped: true,
    approvalRequired: true,
    status,
    secrets,
    artifacts,
    contracts,
    reasons: reasons.length > 0 ? reasons : ['Local release prerequisites are configured.'],
    nextStep: status === 'ready'
      ? 'Run the release check and tagged release workflow when ready to cut a signed build.'
      : 'Set missing release secrets, build sidecar artifacts, and refresh Release readiness before tagging.',
  };
}

export function resolveReleaseReadinessRoot(startPathOrUrl: string = fileURLToPath(import.meta.url)): string {
  const candidates = [dirname(normalizeFileUrl(startPathOrUrl)), process.cwd()];
  for (const candidate of candidates) {
    const found = findReleaseRoot(candidate);
    if (found) return found;
  }
  return process.cwd();
}

function normalizeFileUrl(value: string): string {
  return value.startsWith('file:') ? fileURLToPath(value) : value;
}

function findReleaseRoot(startDir: string): string | null {
  let current = resolve(startDir);
  const root = parse(current).root;
  while (current && current !== root) {
    if (resolveReleaseLayout(current) !== 'unknown') return current;
    current = dirname(current);
  }
  return resolveReleaseLayout(root) !== 'unknown' ? root : null;
}

type ReleaseLayout = 'dev-repo' | 'bundled-resource' | 'unknown';

function resolveReleaseLayout(root: string): ReleaseLayout {
  if (existsSync(join(root, 'apps/pyrfor-ide/src-tauri/tauri.conf.json'))) return 'dev-repo';
  if (existsSync(join(root, '_app/bin/pyrfor.cjs')) || existsSync(join(root, '_runtime/node'))) return 'bundled-resource';
  return 'unknown';
}

function resolveReleaseArtifactPath(
  root: string,
  layout: ReleaseLayout,
  artifact: typeof RELEASE_SIDECAR_ARTIFACTS[number],
): string {
  if (layout === 'bundled-resource') {
    return artifact === 'pyrfor-daemon-aarch64-apple-darwin'
      ? resolveBundledLauncherPath(root)
      : join(root, artifact);
  }
  return join(root, 'apps/pyrfor-ide/src-tauri/binaries', artifact);
}

function resolveBundledLauncherPath(root: string): string {
  const macosLauncher = join(root, '..', 'MacOS', 'pyrfor-daemon-aarch64-apple-darwin');
  return existsSync(macosLauncher) ? macosLauncher : join(root, 'pyrfor-daemon-aarch64-apple-darwin');
}

function buildDevReleaseContractChecks(root: string): ReleaseReadiness['contracts'] {
  const tauriConfig = readText(join(root, 'apps/pyrfor-ide/src-tauri/tauri.conf.json'));
  const sidecarSource = readText(join(root, 'apps/pyrfor-ide/src-tauri/src/sidecar.rs'));
  const apiFetchSource = readText(join(root, 'apps/pyrfor-ide/web/src/lib/apiFetch.ts'));
  const gatewaySource = readText(join(root, 'packages/engine/src/runtime/gateway.ts'));
  const gatewayDist = readText(join(root, 'packages/engine/dist/runtime/gateway.js'));
  const webApiSource = readText(join(root, 'apps/pyrfor-ide/web/src/lib/api.ts'));
  const launcher = readText(join(root, 'apps/pyrfor-ide/src-tauri/binaries/pyrfor-daemon-aarch64-apple-darwin'));
  const parsedTauriConfig = parseJsonObject(tauriConfig);
  const bundle = childObject(parsedTauriConfig, 'bundle');
  const resources = childObject(bundle, 'resources');
  const plugins = childObject(parsedTauriConfig, 'plugins');
  const updater = childObject(plugins, 'updater');

  return [
    {
      id: 'tauri-external-bin',
      passed: stringArrayIncludes(bundle?.['externalBin'], 'binaries/pyrfor-daemon'),
      description: 'Tauri externalBin includes pyrfor-daemon',
    },
    {
      id: 'tauri-bundled-runtime',
      passed: resources?.['binaries/_runtime'] === '_runtime',
      description: 'Tauri resources include bundled Node runtime',
    },
    {
      id: 'tauri-bundled-engine',
      passed: resources?.['binaries/_app'] === '_app',
      description: 'Tauri resources include bundled engine app',
    },
    {
      id: 'tauri-updater-active',
      passed: updater?.['active'] === true,
      description: 'Tauri updater is active',
    },
    {
      id: 'debug-standalone-sidecar',
      passed: sidecarSource.includes('PYRFOR_ALLOW_STANDALONE_ENGINE') && sidecarSource.includes('cfg!(debug_assertions)'),
      description: 'standalone sidecar fallback is debug gated',
    },
    {
      id: 'tauri-port-fail-closed',
      passed: apiFetchSource.includes('Pyrfor bundled sidecar port unavailable'),
      description: 'Tauri port lookup fails closed instead of silently falling back',
    },
    {
      id: 'gateway-product-factory-routes',
      passed: [gatewaySource, gatewayDist].every((source) => (
        source.includes('/api/product-factory/templates')
        && source.includes('/api/product-factory/plan')
        && source.includes('/api/runs')
      )),
      description: 'gateway exposes Product Factory routes in source and dist',
    },
    {
      id: 'web-provider-routing-preview',
      passed: webApiSource.includes('getProviderRoutingPreview')
        && webApiSource.includes('/api/settings/provider-routing-preview'),
      description: 'IDE web API exposes provider routing preview',
    },
    {
      id: 'sidecar-launcher-daemon',
      passed: launcher.includes('--daemon')
        && !launcher.includes('${PYRFOR_PORT:-0}')
        && !launcher.includes('DYLD_FALLBACK_LIBRARY_PATH'),
      description: 'sidecar launcher defaults to daemon without host dylib fallbacks',
    },
  ];
}

function buildBundledReleaseContractChecks(root: string): ReleaseReadiness['contracts'] {
  const gatewayDist = readText(join(root, '_app/dist/runtime/gateway.js'));
  const launcher = readText(resolveBundledLauncherPath(root));
  return [
    {
      id: 'bundled-runtime',
      passed: existsSync(join(root, '_runtime/node')),
      description: 'bundled Node runtime is present',
    },
    {
      id: 'bundled-engine',
      passed: existsSync(join(root, '_app/bin/pyrfor.cjs')),
      description: 'bundled engine app is present',
    },
    {
      id: 'gateway-product-factory-routes',
      passed: gatewayDist.includes('/api/product-factory/templates')
        && gatewayDist.includes('/api/product-factory/plan')
        && gatewayDist.includes('/api/runs'),
      description: 'bundled gateway exposes Product Factory routes',
    },
    {
      id: 'sidecar-launcher-daemon',
      passed: launcher.includes('--daemon')
        && !launcher.includes('${PYRFOR_PORT:-0}')
        && !launcher.includes('DYLD_FALLBACK_LIBRARY_PATH'),
      description: 'sidecar launcher defaults to daemon without host dylib fallbacks',
    },
  ];
}

function readText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

type JsonObject = Record<string, unknown>;

function parseJsonObject(source: string): JsonObject | null {
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function childObject(parent: JsonObject | null | undefined, key: string): JsonObject | null {
  const value = parent?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function stringArrayIncludes(value: unknown, item: string): boolean {
  return Array.isArray(value) && value.some((entry) => entry === item);
}
