#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--no-build');
const runCargo = args.has('--cargo');

function run(label, command, commandArgs, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (['.git', 'node_modules', 'dist', 'target', 'coverage'].includes(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function privacyScan() {
  console.log('\n==> Privacy/security source scan');
  const scannedRoots = [
    path.join(root, 'apps/pyrfor-ide/web/src'),
    path.join(root, 'apps/pyrfor-ide/src-tauri'),
    path.join(root, 'packages/engine/src/runtime'),
    path.join(root, 'packages/engine/dist/runtime'),
  ];
  const patterns = [
    { name: 'dangerouslySetInnerHTML', re: /dangerouslySetInnerHTML/ },
    { name: 'pyrfor token in localStorage', re: /localStorage\.(setItem|getItem|removeItem)\(['"]pyrfor-token['"]/ },
    { name: 'disabled Tauri CSP', re: /"csp"\s*:\s*null/ },
    { name: 'cloud fallback API key in localStorage config', re: /cloudFallback[^\\n]+apiKey|apiKey[^\\n]+cloudFallback/ },
  ];

  const failures = [];
  for (const base of scannedRoots) {
    if (!existsSync(base)) continue;
    for (const file of walk(base)) {
      if (!/\.(ts|tsx|js|rs|json)$/.test(file)) continue;
      const rel = path.relative(root, file);
      const text = readFileSync(file, 'utf-8');
      for (const pattern of patterns) {
        if (pattern.re.test(text)) {
          failures.push(`${rel}: ${pattern.name}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('OK privacy/security scan');
}

JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
JSON.parse(readFileSync(path.join(root, 'docs/capability-inventory.json'), 'utf-8'));
privacyScan();

run('Engine readiness tests', 'pnpm', [
  '--dir',
  'packages/engine',
  'test',
  'src/runtime/__tests__/gateway-credentials.test.ts',
  'src/runtime/__tests__/gateway-pty.test.ts',
  'src/runtime/ide/__tests__/gateway-fs.test.ts',
  'src/runtime/__tests__/gateway-chat-stream.test.ts',
  'src/runtime/gateway.test.ts',
  'src/runtime/openapi-contract.test.ts',
  'src/runtime/integration-scope.test.ts',
  'src/runtime/telegram-autostart.test.ts',
]);

run('Engine typecheck', 'pnpm', ['engine:typecheck']);

run('IDE web readiness tests', 'npm', [
  '--prefix',
  'apps/pyrfor-ide/web',
  'test',
  '--',
  'src/lib/__tests__/apiFetch.test.ts',
  'src/lib/__tests__/cloudFallback.test.ts',
  'src/components/__tests__/OnboardingWizard.test.tsx',
  'src/components/__tests__/SettingsModal.test.tsx',
  'src/components/__tests__/TrustPanel.test.tsx',
  'src/components/__tests__/Chat.test.tsx',
  'src/components/App.test.tsx',
  '--run',
]);

if (!skipBuild) {
  run('IDE web build', 'npm', ['--prefix', 'apps/pyrfor-ide/web', 'run', 'build']);
}

if (runCargo) {
  run('Tauri cargo check', 'cargo', ['check'], { cwd: path.join(root, 'apps/pyrfor-ide/src-tauri') });
}

console.log('\nPyrfor readiness gate passed');
