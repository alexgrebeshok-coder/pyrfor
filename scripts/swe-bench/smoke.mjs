#!/usr/bin/env node
/**
 * P0-6 SWE-bench smoke harness: prints official setup guidance and optionally
 * verifies local tooling. Default path requires no API keys or network.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const SWE_BENCH_UPSTREAM = 'https://github.com/princeton-nlp/SWE-bench';
const DOC_URL =
  'https://github.com/princeton-nlp/SWE-bench/blob/main/README.md';

function printBanner() {
  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│ Pyrfor — SWE-bench evaluation (smoke / setup notes)             │
└─────────────────────────────────────────────────────────────────┘

Official benchmark & harness upstream:
  ${SWE_BENCH_UPSTREAM}
  Docs: ${DOC_URL}

Recommended local setup (Python venv — not executed by this smoke):
  git clone ${SWE_BENCH_UPSTREAM}.git ~/swe-bench
  cd ~/swe-bench && python3 -m venv .venv && source .venv/bin/activate
  pip install -e .

API keys / credentials:
  Running agent-based evaluation against SWE-bench tasks requires whatever
  provider keys your harness uses (for example Anthropic/OpenAI/etc.).
  This repository smoke command does NOT read or require those variables.

Clone path hints (optional):
  Set SWE_BENCH_CLONE to your local SWE-bench checkout; use --verify to assert
  the path exists.

Pyrfor cache default (documentation only — not created unless you clone there):
  ${defaultCloneHint()}
`);
}

function defaultCloneHint() {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(home, '.cache', 'pyrfor', 'swe-bench', 'SWE-bench');
}

function runCmd(label, command, argv, cwd = repoRoot) {
  console.log(`\n==> ${label}`);
  const r = spawnSync(command, argv, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) {
    console.error(String(r.error));
    return false;
  }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`Command failed (${r.status ?? 'unknown'}).`);
    return false;
  }
  return true;
}

function verifyGit() {
  return runCmd('git --version', 'git', ['--version']);
}

function verifyPythonOptional() {
  const r = spawnSync('python3', ['--version'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status === 0 && r.stdout) {
    console.log('\n==> python3 (optional for full harness)');
    process.stdout.write(r.stdout);
    return true;
  }
  console.log('\n==> python3 not found — install Python 3.9+ for SWE-bench harness.');
  return true;
}

function verifyClonePath() {
  const p = process.env.SWE_BENCH_CLONE?.trim();
  if (!p) {
    console.log(
      '\n==> SWE_BENCH_CLONE unset — skipping clone-dir check ' +
        '(set to your SWE-bench checkout to validate).'
    );
    return true;
  }
  console.log('\n==> Checking SWE_BENCH_CLONE');
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) {
    console.error(`Path does not exist: ${resolved}`);
    return false;
  }
  const gitDir = path.join(resolved, '.git');
  if (!fs.existsSync(gitDir)) {
    console.error(`Not a git checkout (missing .git): ${resolved}`);
    return false;
  }
  console.log(`OK — ${resolved}`);
  return true;
}

function verifyRepoRootSanity() {
  const pkg = path.join(repoRoot, 'package.json');
  const enginePkg = path.join(repoRoot, 'packages', 'engine', 'package.json');
  if (!fs.existsSync(pkg) || !fs.existsSync(enginePkg)) {
    console.error('Unexpected cwd: expected Pyrfor monorepo root.');
    return false;
  }
  console.log('\n==> Monorepo root looks valid');
  console.log(`    ${repoRoot}`);
  return true;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const verify = args.has('--verify');
  const ci = args.has('--ci');

  printBanner();

  if (!verifyRepoRootSanity()) {
    process.exit(1);
  }

  if (ci || verify) {
    if (!verifyGit()) process.exit(1);
    if (!verifyClonePath()) process.exit(1);
    if (verify && !ci) verifyPythonOptional();
  }

  console.log('\nSmoke complete (instructional shell). Exit 0.\n');
  process.exit(0);
}

main();
