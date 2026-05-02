#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tauriConfigPath = path.join(root, 'apps/pyrfor-ide/src-tauri/tauri.conf.json');
const sidecarSourcePath = path.join(root, 'apps/pyrfor-ide/src-tauri/src/sidecar.rs');
const apiFetchPath = path.join(root, 'apps/pyrfor-ide/web/src/lib/apiFetch.ts');
const binariesDir = path.join(root, 'apps/pyrfor-ide/src-tauri/binaries');

const config = JSON.parse(readFileSync(tauriConfigPath, 'utf-8'));
const sidecarSource = readFileSync(sidecarSourcePath, 'utf-8');
const apiFetchSource = readFileSync(apiFetchPath, 'utf-8');
const engineCliSourcePath = path.join(root, 'packages/engine/src/runtime/cli.ts');
const engineCliDistPath = path.join(root, 'packages/engine/dist/runtime/cli.js');
const bundledCliDistPath = path.join(root, 'apps/pyrfor-ide/src-tauri/binaries/_app/dist/runtime/cli.js');
const launcherPath = path.join(root, 'apps/pyrfor-ide/src-tauri/binaries/pyrfor-daemon-aarch64-apple-darwin');

function assert(condition, message) {
  if (!condition) {
    console.error(`release-check failed: ${message}`);
    process.exit(1);
  }
}

assert(config.bundle?.externalBin?.includes('binaries/pyrfor-daemon'), 'Tauri externalBin must include pyrfor-daemon');
assert(config.bundle?.resources?.['binaries/_runtime'] === '_runtime', 'Tauri resources must include bundled Node runtime');
assert(config.bundle?.resources?.['binaries/_app'] === '_app', 'Tauri resources must include bundled engine app');
assert(config.plugins?.updater?.active === true, 'Tauri updater must be active for release builds');
assert(sidecarSource.includes('PYRFOR_ALLOW_STANDALONE_ENGINE'), 'standalone engine fallback must be explicit debug opt-in');
assert(sidecarSource.includes('cfg!(debug_assertions)'), 'standalone engine fallback must be debug-gated');
assert(apiFetchSource.includes('Pyrfor bundled sidecar port unavailable'), 'Tauri port lookup must not silently fall back to 18790');

function assertTelegramAutostartContract(source, label) {
  assert(source.includes('PYRFOR_TELEGRAM_AUTOSTART'), `${label} must expose Telegram autostart rollback env`);
  assert(source.includes('shouldAutostartTelegramWithDaemon'), `${label} must route daemon Telegram startup through the autostart decision helper`);
  assert(source.includes('runTelegram(runtime)'), `${label} daemon branch must be able to start Telegram`);
  assert(source.includes('runDaemon(runtime)'), `${label} daemon branch must retain gateway-only fallback`);
}

assertTelegramAutostartContract(readFileSync(engineCliSourcePath, 'utf-8'), 'engine source CLI');
assertTelegramAutostartContract(readFileSync(engineCliDistPath, 'utf-8'), 'engine dist CLI');
if (existsSync(bundledCliDistPath)) {
  assertTelegramAutostartContract(readFileSync(bundledCliDistPath, 'utf-8'), 'bundled sidecar CLI');
}
assert(readFileSync(launcherPath, 'utf-8').includes('--daemon'), 'sidecar launcher must default to --daemon');
assert(!readFileSync(launcherPath, 'utf-8').includes('${PYRFOR_PORT:-0}'), 'sidecar launcher must not force random port unless PYRFOR_PORT is explicit');

const requiredArtifacts = [
  'pyrfor-daemon-aarch64-apple-darwin',
  '_runtime/node',
  '_app/bin/pyrfor.cjs',
  '_app/dist/runtime/gateway.js',
  '_app/dist/runtime/cli.js',
  '_app/node_modules/server-only/index.js',
];

for (const artifact of requiredArtifacts) {
  assert(existsSync(path.join(binariesDir, artifact)), `missing sidecar artifact: ${artifact}`);
}

console.log('Pyrfor release check passed');
