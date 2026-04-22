#!/usr/bin/env ts-node
/**
 * tools/codemod/move-module.ts
 *
 * Moves a module from lib/ to packages/<target>/src/ and:
 * 1. Copies all files
 * 2. Rewrites internal relative imports (if needed)
 * 3. Creates a re-export stub in the original location for backward compat
 *
 * Usage:
 *   ts-node tools/codemod/move-module.ts \
 *     --from lib/ai \
 *     --to packages/engine/src/ai \
 *     --package @ceoclaw/engine
 */

import * as fs from 'fs'
import * as path from 'path'

const args = process.argv.slice(2)
function getArg(name: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1 || idx >= args.length - 1) {
    console.error(`Missing required argument: --${name}`)
    process.exit(1)
  }
  return args[idx + 1]
}

const fromPath = getArg('from')    // e.g. lib/ai
const toPath   = getArg('to')      // e.g. packages/engine/src/ai
const pkgName  = getArg('package') // e.g. @ceoclaw/engine

const root = path.resolve(__dirname, '../..')

function walkDir(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) {
      results.push(...walkDir(full))
    } else {
      results.push(full)
    }
  }
  return results
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

function createReExportStub(originalFile: string, targetFile: string): void {
  // relative import from original lib location to the new package location
  const fromDir = path.dirname(path.resolve(root, originalFile))
  const toFile  = path.resolve(root, targetFile)
  let rel = path.relative(fromDir, toFile).replace(/\\/g, '/').replace(/\.ts$/, '.js')
  if (!rel.startsWith('.')) rel = './' + rel

  // Detect exports style: if file has named exports, re-export all
  const content = fs.readFileSync(path.resolve(root, originalFile), 'utf-8')
  const hasDefault = /^export default /m.test(content)
  const hasNamed   = /^export (const|function|class|type|interface|enum|let|var) /m.test(content)

  let stub = `// @deprecated — module moved to ${pkgName}. This re-export stub will be removed in R3.\n`
  stub += `// Please update imports to: import { ... } from '${pkgName}'\n\n`
  if (hasNamed) stub += `export * from '${rel}'\n`
  if (hasDefault) stub += `export { default } from '${rel}'\n`
  if (!hasNamed && !hasDefault) stub += `// (no exports detected — file may be side-effect only)\n`

  fs.writeFileSync(path.resolve(root, originalFile), stub)
  console.log(`  ✓ stub: ${originalFile}`)
}

function main() {
  const srcAbs = path.resolve(root, fromPath)
  const dstAbs = path.resolve(root, toPath)

  if (!fs.existsSync(srcAbs)) {
    console.error(`Source does not exist: ${srcAbs}`)
    process.exit(1)
  }

  const isFile = fs.statSync(srcAbs).isFile()

  if (isFile) {
    ensureDir(path.dirname(dstAbs))
    fs.copyFileSync(srcAbs, dstAbs)
    console.log(`✓ copied: ${fromPath} → ${toPath}`)
    createReExportStub(fromPath, toPath)
  } else {
    // Directory
    const files = walkDir(srcAbs)
    for (const file of files) {
      const rel = path.relative(srcAbs, file)
      const dst = path.join(dstAbs, rel)
      ensureDir(path.dirname(dst))
      fs.copyFileSync(file, dst)
      console.log(`  ✓ copy: ${path.join(fromPath, rel)}`)
    }

    // Create re-export stubs for each .ts file in the original directory
    for (const file of files) {
      if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        const rel = path.relative(srcAbs, file)
        const origRelPath = path.join(fromPath, rel)
        const dstRelPath  = path.join(toPath, rel)
        createReExportStub(origRelPath, dstRelPath)
      }
    }
  }

  console.log(`\n✅ Done. Moved: ${fromPath} → ${toPath}`)
  console.log(`   Update imports: import { ... } from '${pkgName}/${path.basename(toPath)}'`)
  console.log(`   Run tests: npm run test:run`)
}

main()
