#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
const distCli = path.join(pkgRoot, 'dist/runtime/cli.js');

function runPrismaGenerate() {
  try {
    require.resolve('@prisma/client');
  } catch {
    execSync('pnpm exec prisma generate', { cwd: repoRoot, stdio: 'inherit' });
  }
}

function runPostbuild() {
  execSync('node scripts/postbuild.js', { cwd: pkgRoot, stdio: 'inherit' });
}

runPrismaGenerate();

try {
  execSync('pnpm exec tsc -b tsconfig.publish.json', { cwd: pkgRoot, stdio: 'inherit' });
  runPostbuild();
} catch (error) {
  if (!existsSync(distCli)) {
    throw error;
  }
  console.warn(
    '[prepublish] TypeScript build failed; continuing publish with committed dist/.',
  );
  runPostbuild();
}
