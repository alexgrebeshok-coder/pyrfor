/**
 * Repo-Mapper Subagent
 *
 * Single-purpose subagent that produces a structured map of a repository:
 * top-level layout, language statistics, package boundaries, and key entry
 * points. Designed to be consumed by downstream agents that need structured
 * repository context without full file reads.
 *
 * Usage:
 *   const mapper = new RepoMapper();
 *   const map = await mapper.scan({ rootDir: '/path/to/repo' });
 *
 * @module repo-mapper
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger as defaultLogger } from '../observability/logger.js';

// ====== Interfaces ======

export interface RepoMapInput {
  rootDir: string;
  /** BFS recursion depth from rootDir. Default: 4 */
  maxDepth?: number;
  /** Hard file cap; scan returns truncated:true if exceeded. Default: 5000 */
  maxFiles?: number;
  /** Include dot-file/dot-dir entries. Default: false */
  includeHidden?: boolean;
  /** Additional directory names to skip (appended to defaults) */
  extraIgnore?: string[];
  /** Restrict language detection to these language names; omit for all */
  languages?: string[];
}

export interface RepoMap {
  rootDir: string;
  /** ISO 8601 timestamp of when the scan completed */
  scannedAt: string;
  /** True when the scan stopped early due to maxFiles cap */
  truncated: boolean;
  fileCount: number;
  dirCount: number;
  totalBytes: number;
  languages: Record<string, { files: number; bytes: number; percent: number }>;
  packages: PackageInfo[];
  entryPoints: EntryPoint[];
  topLevel: TopLevelEntry[];
  /** README, CHANGELOG, LICENSE-like files at any depth */
  documentationFiles: string[];
  /** Detected test / spec / __tests__ / test_* directories */
  testDirs: string[];
  /** package.json, tsconfig.json, pnpm-workspace.yaml, Cargo.toml, etc. */
  configFiles: string[];
}

export interface PackageInfo {
  /** Directory path relative to rootDir */
  relPath: string;
  manager: 'npm' | 'pnpm' | 'yarn' | 'cargo' | 'python' | 'go' | 'unknown';
  name?: string;
  version?: string;
  private?: boolean;
  /** Workspace globs when this is a monorepo root */
  workspaces?: string[];
}

export interface EntryPoint {
  relPath: string;
  kind: 'main' | 'bin' | 'module' | 'browser' | 'cli' | 'service' | 'test';
  source: 'package.json' | 'cargo.toml' | 'heuristic';
}

export interface TopLevelEntry {
  name: string;
  type: 'file' | 'dir';
  /** Size in bytes (files only) */
  size?: number;
}

// ====== Constants ======

const DEFAULT_IGNORE: readonly string[] = [
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  '.cache', '.venv', '__pycache__', 'target', 'vendor', 'coverage',
];

const EXT_TO_LANG: Readonly<Record<string, string>> = {
  '.ts':   'TypeScript',
  '.tsx':  'TypeScript',
  '.mts':  'TypeScript',
  '.cts':  'TypeScript',
  '.js':   'JavaScript',
  '.jsx':  'JavaScript',
  '.mjs':  'JavaScript',
  '.cjs':  'JavaScript',
  '.py':   'Python',
  '.rs':   'Rust',
  '.go':   'Go',
  '.java': 'Java',
  '.rb':   'Ruby',
  '.md':   'Markdown',
  '.mdx':  'Markdown',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml':  'YAML',
  '.html': 'HTML',
  '.htm':  'HTML',
  '.css':  'CSS',
  '.scss': 'SCSS',
  '.sass': 'SCSS',
  '.sh':   'Shell',
  '.bash': 'Shell',
  '.zsh':  'Shell',
  '.kt':   'Kotlin',
  '.kts':  'Kotlin',
  '.swift':'Swift',
  '.cpp':  'C++',
  '.cxx':  'C++',
  '.cc':   'C++',
  '.c':    'C',
  '.h':    'C',
  '.cs':   'C#',
  '.php':  'PHP',
  '.lua':  'Lua',
  '.r':    'R',
};

// ====== Pure Helpers ======

/**
 * Detect programming language from filename extension.
 * Returns null for unknown or extensionless files.
 * Covers ~25 common languages.
 */
export function detectLanguage(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) return null;
  return EXT_TO_LANG[ext] ?? null;
}

/**
 * Detect package manager from filenames present in a directory.
 * Priority: pnpm > yarn > npm > cargo > python > go > unknown.
 */
export function detectPackageManager(filenames: string[]): PackageInfo['manager'] {
  const s = new Set(filenames);
  if (s.has('pnpm-lock.yaml') || s.has('pnpm-workspace.yaml')) return 'pnpm';
  if (s.has('yarn.lock')) return 'yarn';
  if (s.has('package.json') || s.has('package-lock.json'))      return 'npm';
  if (s.has('Cargo.toml'))                                       return 'cargo';
  if (s.has('pyproject.toml') || s.has('requirements.txt') || s.has('setup.py')) return 'python';
  if (s.has('go.mod'))                                           return 'go';
  return 'unknown';
}

/**
 * True for README*, CHANGELOG*, LICENSE*, CONTRIBUTING*, AUTHORS*, NOTICE*,
 * HISTORY*, SECURITY* (case-insensitive prefix match).
 */
export function isDocumentationFile(name: string): boolean {
  const u = name.toUpperCase();
  return (
    u.startsWith('README')      ||
    u.startsWith('CHANGELOG')   ||
    u.startsWith('LICENSE')     ||
    u.startsWith('CONTRIBUTING')||
    u.startsWith('AUTHORS')     ||
    u.startsWith('NOTICE')      ||
    u.startsWith('HISTORY')     ||
    u.startsWith('SECURITY')
  );
}

/**
 * True for directory names that indicate a test suite:
 * test, tests, __tests__, spec, specs, test_*, spec_*
 */
export function isTestDir(name: string): boolean {
  const l = name.toLowerCase();
  return (
    l === 'test'      ||
    l === 'tests'     ||
    l === '__tests__' ||
    l === 'spec'      ||
    l === 'specs'     ||
    l.startsWith('test_') ||
    l.startsWith('spec_')
  );
}

/**
 * True for well-known config files: tsconfig*.json, package.json,
 * pnpm-workspace.yaml, Cargo.toml, pyproject.toml, vite/jest/webpack
 * configs, Dockerfile, .env*, and more.
 */
export function isConfigFile(name: string): boolean {
  const EXACT: ReadonlySet<string> = new Set([
    'package.json', 'package-lock.json',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'yarn.lock',
    'Cargo.toml', 'Cargo.lock',
    'pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg',
    'go.mod', 'go.sum',
    'Makefile', 'Dockerfile',
    'docker-compose.yml', 'docker-compose.yaml',
    '.env', '.env.example', '.env.local',
    'jest.config.js', 'jest.config.ts', 'jest.config.mjs',
    'babel.config.js', 'babel.config.ts',
    'rollup.config.js', 'rollup.config.ts',
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json',
  ]);
  if (EXACT.has(name)) return true;
  if (/^tsconfig.*\.json$/.test(name))                    return true;
  if (/^vite\.config\.(js|ts|mts|mjs)$/.test(name))      return true;
  if (/^vitest\.config\.(js|ts|mts|mjs)$/.test(name))    return true;
  if (/^webpack\.config\.(js|ts)$/.test(name))            return true;
  if (/^next\.config\.(js|ts|mjs)$/.test(name))           return true;
  return false;
}

/**
 * Compute language percentage from per-language byte counts.
 * Percentages are relative to total detected-language bytes, rounded to 0.01.
 * All detected languages sum to ~100 %.
 */
export function computeLanguagePercent(
  stats: Record<string, { bytes: number }>,
): Record<string, number> {
  const total = Object.values(stats).reduce((s, v) => s + v.bytes, 0);
  if (total === 0) {
    return Object.fromEntries(Object.keys(stats).map(k => [k, 0]));
  }
  return Object.fromEntries(
    Object.entries(stats).map(([lang, { bytes }]) => [
      lang,
      Math.round((bytes / total) * 10_000) / 100,
    ]),
  );
}

/**
 * Produce a human-readable, deterministic summary of a RepoMap suitable for
 * inclusion in LLM prompts. Output is stable for identical inputs.
 */
export function summarize(map: RepoMap, maxLines = 60): string {
  const lines: string[] = [];

  lines.push(`# Repository: ${map.rootDir}`);
  lines.push(
    `Scanned: ${map.scannedAt} | Files: ${map.fileCount} | Dirs: ${map.dirCount} | Size: ${map.totalBytes} bytes`,
  );
  if (map.truncated) lines.push('⚠  Scan truncated (file cap reached)');

  // Languages — sorted descending by bytes for determinism
  const sortedLangs = Object.entries(map.languages)
    .sort((a, b) => b[1].bytes - a[1].bytes || a[0].localeCompare(b[0]));
  if (sortedLangs.length > 0) {
    lines.push('');
    lines.push('## Languages');
    for (const [lang, stats] of sortedLangs) {
      lines.push(`  ${lang}: ${stats.files} files, ${stats.bytes} bytes (${stats.percent}%)`);
    }
  }

  // Packages
  if (map.packages.length > 0) {
    lines.push('');
    lines.push('## Packages');
    for (const pkg of map.packages) {
      const tag = `${pkg.name ?? '(unnamed)'}@${pkg.version ?? '?'}`;
      lines.push(`  ${pkg.relPath}: ${tag} [${pkg.manager}]`);
    }
  }

  // Entry points (first 10)
  if (map.entryPoints.length > 0) {
    lines.push('');
    lines.push('## Entry Points');
    for (const ep of map.entryPoints.slice(0, 10)) {
      lines.push(`  [${ep.kind}] ${ep.relPath} (${ep.source})`);
    }
  }

  // Config / docs / test dirs summary
  if (map.configFiles.length > 0) {
    lines.push('');
    lines.push(`## Config Files (${map.configFiles.length}): ${map.configFiles.slice(0, 5).join(', ')}`);
  }
  if (map.testDirs.length > 0) {
    lines.push(`## Test Dirs: ${map.testDirs.join(', ')}`);
  }
  if (map.documentationFiles.length > 0) {
    lines.push(`## Docs: ${map.documentationFiles.join(', ')}`);
  }

  return lines.slice(0, maxLines).join('\n');
}

/**
 * Return the typed-subagent spec descriptor.
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export function subagentSpec(): {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
} {
  return {
    name: 'repo-mapper',
    description:
      'Produces a structured map of a repository: top-level layout, language stats, ' +
      'package boundaries, and key entry points, for downstream agent consumption.',
    inputSchema: {
      type: 'object',
      required: ['rootDir'],
      properties: {
        rootDir:       { type: 'string',  description: 'Absolute path to repository root' },
        maxDepth:      { type: 'number',  default: 4,     description: 'Max BFS recursion depth from rootDir' },
        maxFiles:      { type: 'number',  default: 5000,  description: 'Hard file cap; truncated:true if exceeded' },
        includeHidden: { type: 'boolean', default: false, description: 'Include dot-files and dot-dirs' },
        extraIgnore:   { type: 'array',   items: { type: 'string' }, description: 'Extra dir names to skip' },
        languages:     { type: 'array',   items: { type: 'string' }, description: 'Restrict language detection to these names' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        rootDir:            { type: 'string' },
        scannedAt:          { type: 'string', format: 'date-time' },
        truncated:          { type: 'boolean' },
        fileCount:          { type: 'number' },
        dirCount:           { type: 'number' },
        totalBytes:         { type: 'number' },
        languages:          { type: 'object', additionalProperties: { type: 'object' } },
        packages:           { type: 'array',  items: { type: 'object' } },
        entryPoints:        { type: 'array',  items: { type: 'object' } },
        topLevel:           { type: 'array',  items: { type: 'object' } },
        documentationFiles: { type: 'array',  items: { type: 'string' } },
        testDirs:           { type: 'array',  items: { type: 'string' } },
        configFiles:        { type: 'array',  items: { type: 'string' } },
      },
    },
  };
}

// ====== Internal Helpers ======

/**
 * Minimal line-based TOML section extractor — no external deps.
 * Reads key = "value" or key = 'value' pairs from [sectionHeader] until
 * the next section starts.
 */
function extractTomlSection(content: string, sectionHeader: string): Record<string, string> {
  const target = `[${sectionHeader}]`;
  const result: Record<string, string> = {};
  let inSection = false;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inSection = line === target;
      continue;
    }
    if (!inSection) continue;
    // Match: key = "value"  or  key = 'value'
    const m = line.match(/^([\w-]+)\s*=\s*["']([^"']*)["']/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

/** Return heuristic entry-point kind for a repo-relative file path, or null. */
function getHeuristicEntryKind(relPath: string): EntryPoint['kind'] | null {
  const p = relPath.replace(/\\/g, '/');
  const base = path.basename(p);

  if (/(?:^|\/)src\/index\.(ts|tsx|js|jsx|mts|mjs)$/.test(p)) return 'main';
  if (/(?:^|\/)src\/main\.(ts|tsx|js|jsx|rs|go)$/.test(p))    return 'main';
  if (/(?:^|\/)src\/cli\.(ts|js)$/.test(p))                   return 'cli';
  if (/(?:^|\/)cmd\/main\.go$/.test(p))                       return 'service';
  if (/(?:^|\/)bin\/[^/]+$/.test(p) && !base.endsWith('.d.ts')) return 'bin';
  if (base === 'manage.py')                                    return 'service';
  return null;
}

// ====== RepoMapper Class ======

/**
 * RepoMapper — BFS-walks a repository root and produces a typed RepoMap.
 *
 * @example
 *   const mapper = new RepoMapper();
 *   const map    = await mapper.scan({ rootDir: '/path/to/repo' });
 *   console.log(summarize(map));
 */
export class RepoMapper {
  private readonly _logger: typeof defaultLogger;
  private readonly _clock: () => number;

  constructor(opts?: { logger?: typeof defaultLogger; clock?: () => number }) {
    this._logger = opts?.logger ?? defaultLogger;
    this._clock  = opts?.clock  ?? (() => Date.now());
  }

  /** Directory names always skipped unless overridden by the caller. */
  getDefaultIgnore(): string[] {
    return [...DEFAULT_IGNORE];
  }

  /** Walk rootDir and return a fully structured RepoMap. */
  async scan(input: RepoMapInput): Promise<RepoMap> {
    const {
      rootDir,
      maxDepth      = 4,
      maxFiles      = 5000,
      includeHidden = false,
      extraIgnore   = [],
      languages,
    } = input;

    const ignoreSet = new Set([...DEFAULT_IGNORE, ...extraIgnore]);

    // BFS queue — each entry: [absoluteDirPath, depthOfThisDir]
    const queue: Array<[string, number]> = [[rootDir, 0]];

    let fileCount  = 0;
    let dirCount   = 0;
    let totalBytes = 0;
    let truncated  = false;

    const langStats: Record<string, { files: number; bytes: number }> = {};
    const packages:           PackageInfo[]   = [];
    const entryPoints:        EntryPoint[]    = [];
    const topLevel:           TopLevelEntry[] = [];
    const documentationFiles: string[]        = [];
    const testDirs:           string[]        = [];
    const configFiles:        string[]        = [];

    outer: while (queue.length > 0) {
      const [dir, depth] = queue.shift()!;
      const isRoot = dir === rootDir;

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err) {
        this._logger.warn('repo-mapper: cannot read dir', { dir, err: String(err) });
        continue;
      }

      // Full name list used for package-manager detection
      const dirFilenames = entries.map(e => e.name);

      for (const entry of entries) {
        const name = entry.name;

        // Skip hidden entries unless explicitly included
        if (!includeHidden && name.startsWith('.')) continue;
        // Skip ignored directory/file names
        if (ignoreSet.has(name)) continue;

        const absPath = path.join(dir, name);
        const relPath = path.relative(rootDir, absPath);

        // ── Directory ──────────────────────────────────────────────────────
        if (entry.isDirectory()) {
          dirCount++;

          if (isRoot) topLevel.push({ name, type: 'dir' });

          if (isTestDir(name)) testDirs.push(relPath);

          if (depth < maxDepth) queue.push([absPath, depth + 1]);

        // ── File ───────────────────────────────────────────────────────────
        } else if (entry.isFile()) {
          let size = 0;
          try {
            const st = await fs.promises.stat(absPath);
            size = st.size;
          } catch (err) {
            this._logger.warn('repo-mapper: cannot stat file', { absPath, err: String(err) });
          }

          fileCount++;
          totalBytes += size;

          if (isRoot) topLevel.push({ name, type: 'file', size });

          // Language stats
          const lang = detectLanguage(name);
          if (lang && (!languages || languages.includes(lang))) {
            if (!langStats[lang]) langStats[lang] = { files: 0, bytes: 0 };
            langStats[lang].files++;
            langStats[lang].bytes += size;
          }

          // Categorise special files
          if (isDocumentationFile(name)) documentationFiles.push(relPath);
          if (isConfigFile(name))         configFiles.push(relPath);

          // Package manifest handling
          if (name === 'package.json') {
            await this._processPackageJson(absPath, rootDir, dirFilenames, packages, entryPoints);
          } else if (name === 'Cargo.toml') {
            await this._processCargoToml(absPath, rootDir, packages);
          } else if (name === 'pyproject.toml') {
            await this._processPyprojectToml(absPath, rootDir, packages);
          }

          // Heuristic entry points
          const hKind = getHeuristicEntryKind(relPath);
          if (hKind) entryPoints.push({ relPath, kind: hKind, source: 'heuristic' });

          // Bail early when file cap is reached
          if (fileCount >= maxFiles) {
            truncated = true;
            break outer;
          }
        }
      }
    }

    // Compute per-language percentages relative to detected-language bytes
    const totalLangBytes = Object.values(langStats).reduce((s, v) => s + v.bytes, 0);
    const langResult: RepoMap['languages'] = {};
    for (const [lang, stats] of Object.entries(langStats)) {
      langResult[lang] = {
        files:   stats.files,
        bytes:   stats.bytes,
        percent: totalLangBytes > 0
          ? Math.round((stats.bytes / totalLangBytes) * 10_000) / 100
          : 0,
      };
    }

    return {
      rootDir,
      scannedAt: new Date(this._clock()).toISOString(),
      truncated,
      fileCount,
      dirCount,
      totalBytes,
      languages:          langResult,
      packages,
      entryPoints,
      topLevel,
      documentationFiles,
      testDirs,
      configFiles,
    };
  }

  // ── Private manifest processors ──────────────────────────────────────────

  private async _processPackageJson(
    absPath:      string,
    rootDir:      string,
    dirFilenames: string[],
    packages:     PackageInfo[],
    entryPoints:  EntryPoint[],
  ): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(absPath, 'utf-8');
    } catch (err) {
      this._logger.warn('repo-mapper: cannot read package.json', { absPath, err: String(err) });
      return;
    }

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this._logger.warn('repo-mapper: invalid JSON in package.json', { absPath });
      return;
    }

    const relDir = path.relative(rootDir, path.dirname(absPath)) || '.';
    const manager = detectPackageManager(dirFilenames);

    // Normalise workspaces — can be string[] or { packages: string[] }
    let workspaces: string[] | undefined;
    if (Array.isArray(pkg.workspaces)) {
      workspaces = pkg.workspaces as string[];
    } else if (pkg.workspaces && typeof pkg.workspaces === 'object') {
      const ws = pkg.workspaces as { packages?: string[] };
      workspaces = ws.packages;
    }

    packages.push({
      relPath:    relDir,
      manager:    manager === 'unknown' ? 'npm' : manager,
      name:       typeof pkg.name    === 'string'  ? pkg.name    : undefined,
      version:    typeof pkg.version === 'string'  ? pkg.version : undefined,
      private:    typeof pkg.private === 'boolean' ? pkg.private : undefined,
      workspaces,
    });

    // Add declared entry points
    const addEp = (val: unknown, kind: EntryPoint['kind']): void => {
      if (typeof val !== 'string' || !val) return;
      const joined = relDir === '.' ? val : path.join(relDir, val);
      entryPoints.push({ relPath: path.normalize(joined), kind, source: 'package.json' });
    };

    addEp(pkg.main,    'main');
    addEp(pkg.module,  'module');
    addEp(pkg.browser, 'browser');
    if (typeof pkg.bin === 'string') {
      addEp(pkg.bin, 'bin');
    } else if (pkg.bin && typeof pkg.bin === 'object') {
      for (const v of Object.values(pkg.bin as Record<string, unknown>)) {
        addEp(v, 'bin');
      }
    }
  }

  private async _processCargoToml(
    absPath:  string,
    rootDir:  string,
    packages: PackageInfo[],
  ): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(absPath, 'utf-8');
    } catch (err) {
      this._logger.warn('repo-mapper: cannot read Cargo.toml', { absPath, err: String(err) });
      return;
    }

    const sec    = extractTomlSection(raw, 'package');
    const relDir = path.relative(rootDir, path.dirname(absPath)) || '.';

    packages.push({
      relPath: relDir,
      manager: 'cargo',
      name:    sec.name,
      version: sec.version,
    });
  }

  private async _processPyprojectToml(
    absPath:  string,
    rootDir:  string,
    packages: PackageInfo[],
  ): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(absPath, 'utf-8');
    } catch (err) {
      this._logger.warn('repo-mapper: cannot read pyproject.toml', { absPath, err: String(err) });
      return;
    }

    // Prefer [tool.poetry]; fall back to [project]
    let sec = extractTomlSection(raw, 'tool.poetry');
    if (!sec.name) sec = extractTomlSection(raw, 'project');

    const relDir = path.relative(rootDir, path.dirname(absPath)) || '.';

    packages.push({
      relPath: relDir,
      manager: 'python',
      name:    sec.name,
      version: sec.version,
    });
  }
}
