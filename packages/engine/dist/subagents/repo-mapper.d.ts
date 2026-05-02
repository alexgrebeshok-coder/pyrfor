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
import { logger as defaultLogger } from '../observability/logger.js';
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
    languages: Record<string, {
        files: number;
        bytes: number;
        percent: number;
    }>;
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
/**
 * Detect programming language from filename extension.
 * Returns null for unknown or extensionless files.
 * Covers ~25 common languages.
 */
export declare function detectLanguage(filename: string): string | null;
/**
 * Detect package manager from filenames present in a directory.
 * Priority: pnpm > yarn > npm > cargo > python > go > unknown.
 */
export declare function detectPackageManager(filenames: string[]): PackageInfo['manager'];
/**
 * True for README*, CHANGELOG*, LICENSE*, CONTRIBUTING*, AUTHORS*, NOTICE*,
 * HISTORY*, SECURITY* (case-insensitive prefix match).
 */
export declare function isDocumentationFile(name: string): boolean;
/**
 * True for directory names that indicate a test suite:
 * test, tests, __tests__, spec, specs, test_*, spec_*
 */
export declare function isTestDir(name: string): boolean;
/**
 * True for well-known config files: tsconfig*.json, package.json,
 * pnpm-workspace.yaml, Cargo.toml, pyproject.toml, vite/jest/webpack
 * configs, Dockerfile, .env*, and more.
 */
export declare function isConfigFile(name: string): boolean;
/**
 * Compute language percentage from per-language byte counts.
 * Percentages are relative to total detected-language bytes, rounded to 0.01.
 * All detected languages sum to ~100 %.
 */
export declare function computeLanguagePercent(stats: Record<string, {
    bytes: number;
}>): Record<string, number>;
/**
 * Produce a human-readable, deterministic summary of a RepoMap suitable for
 * inclusion in LLM prompts. Output is stable for identical inputs.
 */
export declare function summarize(map: RepoMap, maxLines?: number): string;
/**
 * Return the typed-subagent spec descriptor.
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export declare function subagentSpec(): {
    name: string;
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
};
/**
 * RepoMapper — BFS-walks a repository root and produces a typed RepoMap.
 *
 * @example
 *   const mapper = new RepoMapper();
 *   const map    = await mapper.scan({ rootDir: '/path/to/repo' });
 *   console.log(summarize(map));
 */
export declare class RepoMapper {
    private readonly _logger;
    private readonly _clock;
    constructor(opts?: {
        logger?: typeof defaultLogger;
        clock?: () => number;
    });
    /** Directory names always skipped unless overridden by the caller. */
    getDefaultIgnore(): string[];
    /** Walk rootDir and return a fully structured RepoMap. */
    scan(input: RepoMapInput): Promise<RepoMap>;
    private _processPackageJson;
    private _processCargoToml;
    private _processPyprojectToml;
}
//# sourceMappingURL=repo-mapper.d.ts.map