#!/usr/bin/env node
/**
 * SWE-bench Lite baseline helper: documents the curated subset in lite-subset.json
 * and optionally verifies a local SWE-bench checkout + venv can import the harness.
 *
 * Env:
 *   SWE_BENCH_CLONE  — path to git clone of https://github.com/princeton-nlp/SWE-bench
 *   SWE_BENCH_PYTHON — optional path to python (defaults to .venv/bin/python under clone)
 *
 * Flags:
 *   --run  — when clone + python exist, run a lightweight import check (no tasks executed)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const subsetPath = path.join(__dirname, 'lite-subset.json');

function loadSubset() {
  const raw = fs.readFileSync(subsetPath, 'utf8');
  return JSON.parse(raw);
}

function resolvePython(clone) {
  const override = process.env.SWE_BENCH_PYTHON?.trim();
  if (override) return path.resolve(override);
  const venvPy = path.join(clone, '.venv', 'bin', 'python');
  const venvPyWin = path.join(clone, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPy)) return venvPy;
  if (fs.existsSync(venvPyWin)) return venvPyWin;
  return null;
}

function printDocs(subset) {
  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│ Pyrfor — SWE-bench Lite baseline (subset documentation)      │
└─────────────────────────────────────────────────────────────────┘

Upstream benchmark & harness:
  ${subset.upstream_repo}
  Dataset: ${subset.upstream}

Curated subset (${subset.instance_ids.length} instance_ids): ${subsetPath}

Recommended setup for full baseline runs (not executed here):
  git clone ${subset.upstream_repo}.git ~/swe-bench
  cd ~/swe-bench && python3 -m venv .venv && . .venv/bin/activate   # or Scripts\\\\activate on Windows
  pip install -e .

Optional integration with this script:
  export SWE_BENCH_CLONE=~/swe-bench
  # optionally: export SWE_BENCH_PYTHON=/path/to/python
  pnpm swe-bench:baseline --run

The harness evaluates agents against SWE-bench tasks; this repo only tracks IDs and smoke tooling.
`);
}

function verifyImport(pythonExe) {
  console.log(`\n==> Import check via: ${pythonExe}`);
  const r = spawnSync(pythonExe, ['-c', 'import swebench'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status === 0) console.log('OK: swebench importable');
  return r.status === 0;
}

function main() {
  const subset = loadSubset();
  printDocs(subset);

  console.log('Subset instance_ids:\n');
  for (const id of subset.instance_ids) console.log(`  - ${id}`);
  console.log('');

  const args = new Set(process.argv.slice(2));
  const run = args.has('--run');

  const cloneRaw = process.env.SWE_BENCH_CLONE?.trim();
  if (!cloneRaw) {
    console.log(
      'SWE_BENCH_CLONE unset — skipping optional venv/import checks (set it to enable --run).\n',
    );
    process.exit(0);
  }

  const clone = path.resolve(cloneRaw);
  if (!fs.existsSync(clone) || !fs.existsSync(path.join(clone, '.git'))) {
    console.error(`Invalid SWE_BENCH_CLONE (missing or not a git repo): ${clone}`);
    process.exit(1);
  }

  console.log(`SWE_BENCH_CLONE OK: ${clone}`);

  if (!run) {
    console.log('\nPass --run with SWE_BENCH_CLONE (+ venv pip install -e .) for import verification.\n');
    process.exit(0);
  }

  const py = resolvePython(clone);
  if (!py) {
    console.error(
      'No Python interpreter found. Create .venv under the clone or set SWE_BENCH_PYTHON.',
    );
    process.exit(1);
  }

  if (!verifyImport(py)) process.exit(1);

  console.log('\nBaseline helper complete (subset documented + import OK).\n');
  process.exit(0);
}

main();
