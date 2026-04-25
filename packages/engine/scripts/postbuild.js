#!/usr/bin/env node
/**
 * postbuild.js
 *
 * 1. Rewrites bare relative imports in the dist/ ESM output to have .js
 *    extensions (required by Node.js ESM loader; tsc with moduleResolution:
 *    "bundler" omits them).
 * 2. Ensures dist/runtime/cli.js has the shebang and is chmod +x.
 */
'use strict';
const { readFileSync, writeFileSync, chmodSync, existsSync, readdirSync, statSync } = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../dist');

// ── 1. Walk dist/ and fix bare relative imports ────────────────────────────
function walkJs(dir, cb) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkJs(full, cb);
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      cb(full);
    }
  }
}

function resolveExtension(importPath, fromFile) {
  if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.cjs')) {
    return importPath; // already has extension
  }
  const dir = path.dirname(fromFile);
  const abs = path.resolve(dir, importPath);
  // Check: exact .js, then index.js
  if (existsSync(abs + '.js')) return importPath + '.js';
  if (existsSync(path.join(abs, 'index.js'))) return importPath + '/index.js';
  return importPath; // unknown — leave unchanged
}

const IMPORT_RE = /(\bfrom\s+['"])(\.\.?\/[^'"]+)(['"])/g;
const DYNAMIC_RE = /(\bimport\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g;
const EXPORT_RE = /(\bexport\s+(?:\w+\s+)*from\s+['"])(\.\.?\/[^'"]+)(['"])/g;

function fixFile(filePath) {
  let src = readFileSync(filePath, 'utf8');
  let changed = false;

  function replacer(match, pre, specifier, post) {
    const fixed = resolveExtension(specifier, filePath);
    if (fixed !== specifier) { changed = true; }
    return pre + fixed + post;
  }

  src = src.replace(IMPORT_RE, replacer);
  src = src.replace(EXPORT_RE, replacer);
  src = src.replace(DYNAMIC_RE, replacer);

  if (changed) writeFileSync(filePath, src, 'utf8');
}

walkJs(distDir, fixFile);
console.log('[postbuild] Fixed relative import extensions in dist/.');

// ── 2. Ensure shebang + chmod +x on dist/runtime/cli.js ──────────────────
const cliPath = path.resolve(distDir, 'runtime/cli.js');
let cliSrc = readFileSync(cliPath, 'utf8');
if (!cliSrc.startsWith('#!/usr/bin/env node')) {
  cliSrc = '#!/usr/bin/env node\n' + cliSrc;
  writeFileSync(cliPath, cliSrc, 'utf8');
  console.log('[postbuild] Prepended shebang to dist/runtime/cli.js');
}
chmodSync(cliPath, 0o755);
console.log('[postbuild] chmod +x dist/runtime/cli.js — done.');

// ── 3. Copy telegram/app/ static files to dist/ ───────────────────────────
const srcAppDir = path.resolve(__dirname, '../src/runtime/telegram/app');
const dstAppDir = path.resolve(distDir, 'runtime/telegram/app');

function copyDirRecursive(src, dst) {
  const { mkdirSync: mkd, copyFileSync } = require('fs');
  mkd(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcFull = path.join(src, entry);
    const dstFull = path.join(dst, entry);
    if (statSync(srcFull).isDirectory()) {
      copyDirRecursive(srcFull, dstFull);
    } else {
      copyFileSync(srcFull, dstFull);
    }
  }
}

if (existsSync(srcAppDir)) {
  copyDirRecursive(srcAppDir, dstAppDir);
  console.log('[postbuild] Copied telegram/app/ static files to dist/runtime/telegram/app/');
} else {
  console.warn('[postbuild] Warning: src/runtime/telegram/app/ not found — skipping copy.');
}
