#!/usr/bin/env node
'use strict';

/**
 * Router: Universal Engine CLI commands go to @pyrfor/cli; everything else to the
 * canonical runtime entry (dist/runtime/cli.js).
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const userArgs = process.argv.slice(2);

if (userArgs.some((a) => a === '--version' || a === '-V')) {
  try {
    const pkgPath = require.resolve('@pyrfor/cli/package.json', {
      paths: [path.join(__dirname, '..'), path.join(__dirname, '..', '..', '..')],
    });
    const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(version);
  } catch {
    console.error(
      'Pyrfor: could not read @pyrfor/cli version (run `pnpm install` from the repo root).',
    );
    process.exit(1);
  }
  process.exit(0);
}

const CLI_FIRST_COMMANDS = new Set([
  'concept',
  'plan',
  'status',
  'abort',
  'migrate',
  'release',
  'skills',
  'tools',
  'memory',
  'run',
  'approvals',
  'block',
  'help',
  '-h',
  '--help',
]);

function shouldDelegateToUniversalCli(argv) {
  const first = argv[0];
  if (first === undefined) return false;
  return CLI_FIRST_COMMANDS.has(first);
}

if (shouldDelegateToUniversalCli(userArgs)) {
  let cliEntry;
  try {
    cliEntry = require.resolve('@pyrfor/cli/dist/index.js', {
      paths: [path.join(__dirname, '..'), path.join(__dirname, '..', '..', '..')],
    });
  } catch {
    console.error(
      'Pyrfor: @pyrfor/cli is missing or not built. From the repo root run: pnpm install && pnpm cli:build',
    );
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [cliEntry, ...userArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status === null ? 1 : result.status);
}

require('../dist/runtime/cli.js');
