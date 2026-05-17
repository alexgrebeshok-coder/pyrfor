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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as fs from 'fs';
import * as path from 'path';
import { logger as defaultLogger } from '../observability/logger.js';
// ====== Constants ======
const DEFAULT_IGNORE = [
    'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
    '.cache', '.venv', '__pycache__', 'target', 'vendor', 'coverage',
];
const EXT_TO_LANG = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.mts': 'TypeScript',
    '.cts': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.py': 'Python',
    '.rs': 'Rust',
    '.go': 'Go',
    '.java': 'Java',
    '.rb': 'Ruby',
    '.md': 'Markdown',
    '.mdx': 'Markdown',
    '.json': 'JSON',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.html': 'HTML',
    '.htm': 'HTML',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.sass': 'SCSS',
    '.sh': 'Shell',
    '.bash': 'Shell',
    '.zsh': 'Shell',
    '.kt': 'Kotlin',
    '.kts': 'Kotlin',
    '.swift': 'Swift',
    '.cpp': 'C++',
    '.cxx': 'C++',
    '.cc': 'C++',
    '.c': 'C',
    '.h': 'C',
    '.cs': 'C#',
    '.php': 'PHP',
    '.lua': 'Lua',
    '.r': 'R',
};
const SEMANTIC_LANGUAGES = new Set(['TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'Java']);
const MAX_SEMANTIC_FILES = 200;
const MAX_SEMANTIC_FILE_BYTES = 128 * 1024;
const TS_JS_EXPORTED_RE = /^\s*export\b/;
// ====== Pure Helpers ======
/**
 * Detect programming language from filename extension.
 * Returns null for unknown or extensionless files.
 * Covers ~25 common languages.
 */
export function detectLanguage(filename) {
    var _a;
    const ext = path.extname(filename).toLowerCase();
    if (!ext)
        return null;
    return (_a = EXT_TO_LANG[ext]) !== null && _a !== void 0 ? _a : null;
}
/**
 * Detect package manager from filenames present in a directory.
 * Priority: pnpm > yarn > npm > cargo > python > go > unknown.
 */
export function detectPackageManager(filenames) {
    const s = new Set(filenames);
    if (s.has('pnpm-lock.yaml') || s.has('pnpm-workspace.yaml'))
        return 'pnpm';
    if (s.has('yarn.lock'))
        return 'yarn';
    if (s.has('package.json') || s.has('package-lock.json'))
        return 'npm';
    if (s.has('Cargo.toml'))
        return 'cargo';
    if (s.has('pyproject.toml') || s.has('requirements.txt') || s.has('setup.py'))
        return 'python';
    if (s.has('go.mod'))
        return 'go';
    return 'unknown';
}
/**
 * True for README*, CHANGELOG*, LICENSE*, CONTRIBUTING*, AUTHORS*, NOTICE*,
 * HISTORY*, SECURITY* (case-insensitive prefix match).
 */
export function isDocumentationFile(name) {
    const u = name.toUpperCase();
    return (u.startsWith('README') ||
        u.startsWith('CHANGELOG') ||
        u.startsWith('LICENSE') ||
        u.startsWith('CONTRIBUTING') ||
        u.startsWith('AUTHORS') ||
        u.startsWith('NOTICE') ||
        u.startsWith('HISTORY') ||
        u.startsWith('SECURITY'));
}
/**
 * True for directory names that indicate a test suite:
 * test, tests, __tests__, spec, specs, test_*, spec_*
 */
export function isTestDir(name) {
    const l = name.toLowerCase();
    return (l === 'test' ||
        l === 'tests' ||
        l === '__tests__' ||
        l === 'spec' ||
        l === 'specs' ||
        l.startsWith('test_') ||
        l.startsWith('spec_'));
}
/**
 * True for well-known config files: tsconfig*.json, package.json,
 * pnpm-workspace.yaml, Cargo.toml, pyproject.toml, vite/jest/webpack
 * configs, Dockerfile, .env*, and more.
 */
export function isConfigFile(name) {
    const EXACT = new Set([
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
    if (EXACT.has(name))
        return true;
    if (/^tsconfig.*\.json$/.test(name))
        return true;
    if (/^vite\.config\.(js|ts|mts|mjs)$/.test(name))
        return true;
    if (/^vitest\.config\.(js|ts|mts|mjs)$/.test(name))
        return true;
    if (/^webpack\.config\.(js|ts)$/.test(name))
        return true;
    if (/^next\.config\.(js|ts|mjs)$/.test(name))
        return true;
    return false;
}
/**
 * Compute language percentage from per-language byte counts.
 * Percentages are relative to total detected-language bytes, rounded to 0.01.
 * All detected languages sum to ~100 %.
 */
export function computeLanguagePercent(stats) {
    const total = Object.values(stats).reduce((s, v) => s + v.bytes, 0);
    if (total === 0) {
        return Object.fromEntries(Object.keys(stats).map(k => [k, 0]));
    }
    return Object.fromEntries(Object.entries(stats).map(([lang, { bytes }]) => [
        lang,
        Math.round((bytes / total) * 10000) / 100,
    ]));
}
/**
 * Produce a human-readable, deterministic summary of a RepoMap suitable for
 * inclusion in LLM prompts. Output is stable for identical inputs.
 */
export function summarize(map, maxLines = 60) {
    var _a, _b;
    const lines = [];
    lines.push(`# Repository Map: ${map.rootDir}`);
    lines.push(`Scanned: ${map.scannedAt} | Files: ${map.fileCount} | Dirs: ${map.dirCount} | Size: ${map.totalBytes} bytes`);
    if (map.truncated)
        lines.push('⚠  Scan truncated (file cap reached)');
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
            const tag = `${(_a = pkg.name) !== null && _a !== void 0 ? _a : '(unnamed)'}@${(_b = pkg.version) !== null && _b !== void 0 ? _b : '?'}`;
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
    if (map.semantic) {
        lines.push('');
        lines.push(`## Semantic (${map.semantic.depth})`);
        lines.push(`Symbols: ${map.semantic.symbolCount} | Imports: ${map.semantic.importCount}`);
        if (map.semantic.entrySymbolNames.length > 0) {
            lines.push(`Entry Symbols: ${map.semantic.entrySymbolNames.join(', ')}`);
        }
        for (const file of [...map.semantic.files]
            .sort((left, right) => (right.symbols.length + right.imports.length) - (left.symbols.length + left.imports.length)
            || left.relPath.localeCompare(right.relPath))
            .slice(0, 5)) {
            lines.push(`  ${file.relPath}: ${file.symbols.length} symbols, ${file.imports.length} imports`);
        }
    }
    return lines.slice(0, maxLines).join('\n');
}
/**
 * Return the typed-subagent spec descriptor.
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export function subagentSpec() {
    return {
        name: 'repo-mapper',
        description: 'Produces a structured map of a repository: top-level layout, language stats, ' +
            'package boundaries, and key entry points, for downstream agent consumption.',
        inputSchema: {
            type: 'object',
            required: ['rootDir'],
            properties: {
                rootDir: { type: 'string', description: 'Absolute path to repository root' },
                maxDepth: { type: 'number', default: 4, description: 'Max BFS recursion depth from rootDir' },
                maxFiles: { type: 'number', default: 5000, description: 'Hard file cap; truncated:true if exceeded' },
                includeHidden: { type: 'boolean', default: false, description: 'Include dot-files and dot-dirs' },
                extraIgnore: { type: 'array', items: { type: 'string' }, description: 'Extra dir names to skip' },
                languages: { type: 'array', items: { type: 'string' }, description: 'Restrict language detection to these names' },
                semanticDepth: { type: 'string', enum: ['files', 'symbols', 'imports'], default: 'files', description: 'Optional semantic extraction depth layered on top of the structural scan' },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                rootDir: { type: 'string' },
                scannedAt: { type: 'string', format: 'date-time' },
                truncated: { type: 'boolean' },
                fileCount: { type: 'number' },
                dirCount: { type: 'number' },
                totalBytes: { type: 'number' },
                languages: { type: 'object', additionalProperties: { type: 'object' } },
                packages: { type: 'array', items: { type: 'object' } },
                entryPoints: { type: 'array', items: { type: 'object' } },
                topLevel: { type: 'array', items: { type: 'object' } },
                documentationFiles: { type: 'array', items: { type: 'string' } },
                testDirs: { type: 'array', items: { type: 'string' } },
                configFiles: { type: 'array', items: { type: 'string' } },
                semantic: { type: 'object' },
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
function extractTomlSection(content, sectionHeader) {
    const target = `[${sectionHeader}]`;
    const result = {};
    let inSection = false;
    for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('[')) {
            inSection = line === target;
            continue;
        }
        if (!inSection)
            continue;
        // Match: key = "value"  or  key = 'value'
        const m = line.match(/^([\w-]+)\s*=\s*["']([^"']*)["']/);
        if (m)
            result[m[1]] = m[2];
    }
    return result;
}
/** Return heuristic entry-point kind for a repo-relative file path, or null. */
function getHeuristicEntryKind(relPath) {
    const p = relPath.replace(/\\/g, '/');
    const base = path.basename(p);
    if (/(?:^|\/)src\/index\.(ts|tsx|js|jsx|mts|mjs)$/.test(p))
        return 'main';
    if (/(?:^|\/)src\/main\.(ts|tsx|js|jsx|rs|go)$/.test(p))
        return 'main';
    if (/(?:^|\/)src\/cli\.(ts|js)$/.test(p))
        return 'cli';
    if (/(?:^|\/)cmd\/main\.go$/.test(p))
        return 'service';
    if (/(?:^|\/)bin\/[^/]+$/.test(p) && !base.endsWith('.d.ts'))
        return 'bin';
    if (base === 'manage.py')
        return 'service';
    return null;
}
function supportsSemanticLanguage(language) {
    return language !== null && SEMANTIC_LANGUAGES.has(language);
}
function extractSemanticFile(relPath, language, content, depth) {
    var _a;
    const lines = content.split(/\r?\n/);
    const symbols = [];
    const imports = [];
    let inGoImportBlock = false;
    for (let index = 0; index < lines.length; index++) {
        const line = (_a = lines[index]) !== null && _a !== void 0 ? _a : '';
        const lineNo = index + 1;
        if (depth === 'imports' && language === 'Go') {
            if (/^\s*import\s*\(\s*$/.test(line)) {
                inGoImportBlock = true;
                continue;
            }
            if (inGoImportBlock) {
                if (/^\s*\)\s*$/.test(line)) {
                    inGoImportBlock = false;
                    continue;
                }
                const goImport = line.match(/"([^"]+)"/);
                if (goImport === null || goImport === void 0 ? void 0 : goImport[1]) {
                    imports.push({ target: goImport[1], line: lineNo, local: false });
                }
                continue;
            }
        }
        for (const symbol of extractSymbolsFromLine(language, line, lineNo)) {
            symbols.push(symbol);
        }
        if (depth === 'imports') {
            for (const edge of extractImportsFromLine(language, line, lineNo)) {
                imports.push(edge);
            }
        }
    }
    return { relPath, language, symbols, imports };
}
function extractSymbolsFromLine(language, line, lineNo) {
    const specs = [];
    switch (language) {
        case 'TypeScript':
        case 'JavaScript':
            specs.push({ re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', exported: (source) => TS_JS_EXPORTED_RE.test(source) }, { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, kind: 'function', exported: (source) => TS_JS_EXPORTED_RE.test(source) }, { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface', exported: (source) => TS_JS_EXPORTED_RE.test(source) }, { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/, kind: 'type', exported: (source) => TS_JS_EXPORTED_RE.test(source) }, { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/, kind: 'const', exported: (source) => TS_JS_EXPORTED_RE.test(source) });
            break;
        case 'Python':
            specs.push({ re: /^\s*def\s+([A-Za-z_]\w*)\s*\(/, kind: 'function', exported: (source, name) => !source.trimStart().startsWith('_') && !name.startsWith('_') }, { re: /^\s*class\s+([A-Za-z_]\w*)\b/, kind: 'class', exported: (source, name) => !source.trimStart().startsWith('_') && !name.startsWith('_') });
            break;
        case 'Rust':
            specs.push({ re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/, kind: 'function', exported: (source) => /\bpub\b/.test(source) }, { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)\b/, kind: 'struct', exported: (source) => /\bpub\b/.test(source) }, { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)\b/, kind: 'enum', exported: (source) => /\bpub\b/.test(source) }, { re: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)\b/, kind: 'trait', exported: (source) => /\bpub\b/.test(source) });
            break;
        case 'Go':
            specs.push({ re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, kind: 'function', exported: (_source, name) => startsWithUpper(name) }, { re: /^\s*type\s+([A-Za-z_]\w*)\s+struct\b/, kind: 'struct', exported: (_source, name) => startsWithUpper(name) }, { re: /^\s*type\s+([A-Za-z_]\w*)\s+interface\b/, kind: 'interface', exported: (_source, name) => startsWithUpper(name) });
            break;
        case 'Java':
            specs.push({ re: /^\s*(?:public|protected|private|abstract|final|static|\s)+class\s+([A-Za-z_]\w*)\b/, kind: 'class', exported: (source) => /\bpublic\b/.test(source) }, { re: /^\s*(?:public|protected|private|abstract|final|static|\s)+interface\s+([A-Za-z_]\w*)\b/, kind: 'interface', exported: (source) => /\bpublic\b/.test(source) }, { re: /^\s*(?:public|protected|private|abstract|final|static|\s)+enum\s+([A-Za-z_]\w*)\b/, kind: 'enum', exported: (source) => /\bpublic\b/.test(source) });
            break;
    }
    for (const spec of specs) {
        const match = line.match(spec.re);
        if (match === null || match === void 0 ? void 0 : match[1]) {
            return [{
                    name: match[1],
                    kind: spec.kind,
                    line: lineNo,
                    exported: spec.exported ? spec.exported(line, match[1]) : false,
                }];
        }
    }
    return [];
}
function extractImportsFromLine(language, line, lineNo) {
    const imports = [];
    switch (language) {
        case 'TypeScript':
        case 'JavaScript': {
            const esm = line.match(/^\s*(?:import|export)\b.*?\bfrom\s+['"]([^'"]+)['"]/);
            if (esm === null || esm === void 0 ? void 0 : esm[1])
                imports.push({ target: esm[1], line: lineNo, local: isLocalImportTarget(esm[1], language) });
            const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
            if (sideEffect === null || sideEffect === void 0 ? void 0 : sideEffect[1])
                imports.push({ target: sideEffect[1], line: lineNo, local: isLocalImportTarget(sideEffect[1], language) });
            const requireMatch = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
            if (requireMatch === null || requireMatch === void 0 ? void 0 : requireMatch[1])
                imports.push({ target: requireMatch[1], line: lineNo, local: isLocalImportTarget(requireMatch[1], language) });
            break;
        }
        case 'Python': {
            const fromMatch = line.match(/^\s*from\s+([.\w]+)\s+import\b/);
            if (fromMatch === null || fromMatch === void 0 ? void 0 : fromMatch[1])
                imports.push({ target: fromMatch[1], line: lineNo, local: isLocalImportTarget(fromMatch[1], language) });
            const importMatch = line.match(/^\s*import\s+([.\w]+)/);
            if (importMatch === null || importMatch === void 0 ? void 0 : importMatch[1])
                imports.push({ target: importMatch[1], line: lineNo, local: isLocalImportTarget(importMatch[1], language) });
            break;
        }
        case 'Rust': {
            const useMatch = line.match(/^\s*(?:pub\s+)?use\s+([^;]+);/);
            if (useMatch === null || useMatch === void 0 ? void 0 : useMatch[1])
                imports.push({ target: useMatch[1].trim(), line: lineNo, local: isLocalImportTarget(useMatch[1].trim(), language) });
            break;
        }
        case 'Go': {
            const importMatch = line.match(/^\s*import\s+"([^"]+)"/);
            if (importMatch === null || importMatch === void 0 ? void 0 : importMatch[1])
                imports.push({ target: importMatch[1], line: lineNo, local: false });
            break;
        }
        case 'Java': {
            const importMatch = line.match(/^\s*import\s+([A-Za-z0-9_.*]+);/);
            if (importMatch === null || importMatch === void 0 ? void 0 : importMatch[1])
                imports.push({ target: importMatch[1], line: lineNo, local: false });
            break;
        }
    }
    return imports;
}
function isLocalImportTarget(target, language) {
    if (target.startsWith('.') || target.startsWith('/'))
        return true;
    if (language === 'Rust')
        return target.startsWith('crate::') || target.startsWith('self::') || target.startsWith('super::');
    return false;
}
function startsWithUpper(name) {
    return /^[A-Z]/.test(name);
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
    constructor(opts) {
        var _a, _b;
        this._logger = (_a = opts === null || opts === void 0 ? void 0 : opts.logger) !== null && _a !== void 0 ? _a : defaultLogger;
        this._clock = (_b = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _b !== void 0 ? _b : (() => Date.now());
    }
    /** Directory names always skipped unless overridden by the caller. */
    getDefaultIgnore() {
        return [...DEFAULT_IGNORE];
    }
    /** Walk rootDir and return a fully structured RepoMap. */
    scan(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const { rootDir, maxDepth = 4, maxFiles = 5000, includeHidden = false, extraIgnore = [], languages, semanticDepth = 'files', } = input;
            const ignoreSet = new Set([...DEFAULT_IGNORE, ...extraIgnore]);
            // BFS queue — each entry: [absoluteDirPath, depthOfThisDir]
            const queue = [[rootDir, 0]];
            let fileCount = 0;
            let dirCount = 0;
            let totalBytes = 0;
            let truncated = false;
            const langStats = {};
            const packages = [];
            const entryPoints = [];
            const topLevel = [];
            const documentationFiles = [];
            const testDirs = [];
            const configFiles = [];
            const semanticCandidates = [];
            outer: while (queue.length > 0) {
                const [dir, depth] = queue.shift();
                const isRoot = dir === rootDir;
                let entries;
                try {
                    entries = yield fs.promises.readdir(dir, { withFileTypes: true });
                }
                catch (err) {
                    this._logger.warn('repo-mapper: cannot read dir', { dir, err: String(err) });
                    continue;
                }
                // Full name list used for package-manager detection
                const dirFilenames = entries.map(e => e.name);
                for (const entry of entries) {
                    const name = entry.name;
                    // Skip hidden entries unless explicitly included
                    if (!includeHidden && name.startsWith('.'))
                        continue;
                    // Skip ignored directory/file names
                    if (ignoreSet.has(name))
                        continue;
                    const absPath = path.join(dir, name);
                    const relPath = path.relative(rootDir, absPath);
                    // ── Directory ──────────────────────────────────────────────────────
                    if (entry.isDirectory()) {
                        dirCount++;
                        if (isRoot)
                            topLevel.push({ name, type: 'dir' });
                        if (isTestDir(name))
                            testDirs.push(relPath);
                        if (depth < maxDepth)
                            queue.push([absPath, depth + 1]);
                        // ── File ───────────────────────────────────────────────────────────
                    }
                    else if (entry.isFile()) {
                        let size = 0;
                        try {
                            const st = yield fs.promises.stat(absPath);
                            size = st.size;
                        }
                        catch (err) {
                            this._logger.warn('repo-mapper: cannot stat file', { absPath, err: String(err) });
                        }
                        fileCount++;
                        totalBytes += size;
                        if (isRoot)
                            topLevel.push({ name, type: 'file', size });
                        // Language stats
                        const lang = detectLanguage(name);
                        if (lang && (!languages || languages.includes(lang))) {
                            if (!langStats[lang])
                                langStats[lang] = { files: 0, bytes: 0 };
                            langStats[lang].files++;
                            langStats[lang].bytes += size;
                            if (semanticDepth !== 'files'
                                && supportsSemanticLanguage(lang)
                                && semanticCandidates.length < MAX_SEMANTIC_FILES
                                && size <= MAX_SEMANTIC_FILE_BYTES) {
                                semanticCandidates.push({ absPath, relPath, language: lang, size });
                            }
                        }
                        // Categorise special files
                        if (isDocumentationFile(name))
                            documentationFiles.push(relPath);
                        if (isConfigFile(name))
                            configFiles.push(relPath);
                        // Package manifest handling
                        if (name === 'package.json') {
                            yield this._processPackageJson(absPath, rootDir, dirFilenames, packages, entryPoints);
                        }
                        else if (name === 'Cargo.toml') {
                            yield this._processCargoToml(absPath, rootDir, packages);
                        }
                        else if (name === 'pyproject.toml') {
                            yield this._processPyprojectToml(absPath, rootDir, packages);
                        }
                        // Heuristic entry points
                        const hKind = getHeuristicEntryKind(relPath);
                        if (hKind)
                            entryPoints.push({ relPath, kind: hKind, source: 'heuristic' });
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
            const langResult = {};
            for (const [lang, stats] of Object.entries(langStats)) {
                langResult[lang] = {
                    files: stats.files,
                    bytes: stats.bytes,
                    percent: totalLangBytes > 0
                        ? Math.round((stats.bytes / totalLangBytes) * 10000) / 100
                        : 0,
                };
            }
            const semantic = semanticDepth !== 'files'
                ? yield this._buildSemanticMap(semanticCandidates, semanticDepth, entryPoints)
                : undefined;
            return Object.assign({ rootDir, scannedAt: new Date(this._clock()).toISOString(), truncated,
                fileCount,
                dirCount,
                totalBytes, languages: langResult, packages,
                entryPoints,
                topLevel,
                documentationFiles,
                testDirs,
                configFiles }, (semantic ? { semantic } : {}));
        });
    }
    // ── Private manifest processors ──────────────────────────────────────────
    _processPackageJson(absPath, rootDir, dirFilenames, packages, entryPoints) {
        return __awaiter(this, void 0, void 0, function* () {
            let raw;
            try {
                raw = yield fs.promises.readFile(absPath, 'utf-8');
            }
            catch (err) {
                this._logger.warn('repo-mapper: cannot read package.json', { absPath, err: String(err) });
                return;
            }
            let pkg;
            try {
                pkg = JSON.parse(raw);
            }
            catch (_a) {
                this._logger.warn('repo-mapper: invalid JSON in package.json', { absPath });
                return;
            }
            const relDir = path.relative(rootDir, path.dirname(absPath)) || '.';
            const manager = detectPackageManager(dirFilenames);
            // Normalise workspaces — can be string[] or { packages: string[] }
            let workspaces;
            if (Array.isArray(pkg.workspaces)) {
                workspaces = pkg.workspaces;
            }
            else if (pkg.workspaces && typeof pkg.workspaces === 'object') {
                const ws = pkg.workspaces;
                workspaces = ws.packages;
            }
            packages.push({
                relPath: relDir,
                manager: manager === 'unknown' ? 'npm' : manager,
                name: typeof pkg.name === 'string' ? pkg.name : undefined,
                version: typeof pkg.version === 'string' ? pkg.version : undefined,
                private: typeof pkg.private === 'boolean' ? pkg.private : undefined,
                workspaces,
            });
            // Add declared entry points
            const addEp = (val, kind) => {
                if (typeof val !== 'string' || !val)
                    return;
                const joined = relDir === '.' ? val : path.join(relDir, val);
                entryPoints.push({ relPath: path.normalize(joined), kind, source: 'package.json' });
            };
            addEp(pkg.main, 'main');
            addEp(pkg.module, 'module');
            addEp(pkg.browser, 'browser');
            if (typeof pkg.bin === 'string') {
                addEp(pkg.bin, 'bin');
            }
            else if (pkg.bin && typeof pkg.bin === 'object') {
                for (const v of Object.values(pkg.bin)) {
                    addEp(v, 'bin');
                }
            }
        });
    }
    _processCargoToml(absPath, rootDir, packages) {
        return __awaiter(this, void 0, void 0, function* () {
            let raw;
            try {
                raw = yield fs.promises.readFile(absPath, 'utf-8');
            }
            catch (err) {
                this._logger.warn('repo-mapper: cannot read Cargo.toml', { absPath, err: String(err) });
                return;
            }
            const sec = extractTomlSection(raw, 'package');
            const relDir = path.relative(rootDir, path.dirname(absPath)) || '.';
            packages.push({
                relPath: relDir,
                manager: 'cargo',
                name: sec.name,
                version: sec.version,
            });
        });
    }
    _processPyprojectToml(absPath, rootDir, packages) {
        return __awaiter(this, void 0, void 0, function* () {
            let raw;
            try {
                raw = yield fs.promises.readFile(absPath, 'utf-8');
            }
            catch (err) {
                this._logger.warn('repo-mapper: cannot read pyproject.toml', { absPath, err: String(err) });
                return;
            }
            // Prefer [tool.poetry]; fall back to [project]
            let sec = extractTomlSection(raw, 'tool.poetry');
            if (!sec.name)
                sec = extractTomlSection(raw, 'project');
            const relDir = path.relative(rootDir, path.dirname(absPath)) || '.';
            packages.push({
                relPath: relDir,
                manager: 'python',
                name: sec.name,
                version: sec.version,
            });
        });
    }
    _buildSemanticMap(candidates, depth, entryPoints) {
        return __awaiter(this, void 0, void 0, function* () {
            const files = [];
            for (const candidate of candidates) {
                try {
                    const content = yield fs.promises.readFile(candidate.absPath, 'utf-8');
                    const extracted = extractSemanticFile(candidate.relPath, candidate.language, content, depth);
                    if (extracted.symbols.length > 0 || extracted.imports.length > 0) {
                        files.push(extracted);
                    }
                }
                catch (err) {
                    this._logger.warn('repo-mapper: cannot read semantic file', { absPath: candidate.absPath, err: String(err) });
                }
            }
            if (files.length === 0)
                return undefined;
            const entryPointSet = new Set(entryPoints.map((entry) => entry.relPath.replace(/\\/g, '/')));
            const entrySymbolNames = files
                .filter((file) => entryPointSet.has(file.relPath.replace(/\\/g, '/')))
                .flatMap((file) => file.symbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name))
                .filter((name, index, all) => all.indexOf(name) === index)
                .sort((left, right) => left.localeCompare(right))
                .slice(0, 12);
            return {
                depth,
                symbolCount: files.reduce((sum, file) => sum + file.symbols.length, 0),
                importCount: files.reduce((sum, file) => sum + file.imports.length, 0),
                entrySymbolNames,
                files: files.sort((left, right) => left.relPath.localeCompare(right.relPath)),
            };
        });
    }
}
