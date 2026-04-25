/**
 * IDE Filesystem API — pure helper module (no HTTP I/O).
 *
 * All operations are restricted to a configured workspaceRoot via:
 *  1. Lexical path resolution (resolve + startsWith check)
 *  2. Symlink dereferencing (fs.realpath)
 *
 * No new runtime dependencies — uses only Node built-ins.
 */

import { promises as fsp } from 'fs';
import path from 'path';

// ─── Public types ──────────────────────────────────────────────────────────

export interface FsApiConfig {
  /** Absolute path to workspace root. All operations are restricted to this root. */
  workspaceRoot: string;
  /** Max file size for read/write (bytes). Default 5_000_000 (5 MB). */
  maxFileSize?: number;
}

export interface FsEntry {
  name: string;
  /** Relative to workspaceRoot, POSIX separators, no leading "/" */
  path: string;
  type: 'file' | 'directory';
  /** Bytes — only for files */
  size?: number;
  /** mtime milliseconds — only for files */
  modifiedMs?: number;
}

export interface FsListResult {
  path: string;
  entries: FsEntry[];
}

export interface FsReadResult {
  path: string;
  content: string;
  size: number;
}

export interface FsSearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface FsSearchResult {
  query: string;
  hits: FsSearchHit[];
  truncated: boolean;
}

// ─── Error ─────────────────────────────────────────────────────────────────

export type FsApiErrorCode = 'ENOENT' | 'EACCES' | 'EISDIR' | 'ENOTDIR' | 'E2BIG' | 'EINVAL';

export class FsApiError extends Error {
  constructor(
    public readonly code: FsApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FsApiError';
  }
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Directories that are always skipped during listing and search. */
export const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-cjs',
  '.next',
  '.cache',
  'coverage',
  '__pycache__',
]);

const DEFAULT_MAX_FILE_SIZE = 5_000_000;
const DEFAULT_MAX_HITS = 200;
/** First N bytes checked for NULL to detect binary files. */
const BINARY_SNIFF_BYTES = 1024;

// ─── Internal helpers ──────────────────────────────────────────────────────

function resolvedRoot(cfg: FsApiConfig): string {
  return path.resolve(cfg.workspaceRoot);
}

/** Resolve the workspace root's real path (dereferencing symlinks on macOS /var → /private/var). */
async function realRoot(cfg: FsApiConfig): Promise<string> {
  try {
    return await fsp.realpath(path.resolve(cfg.workspaceRoot));
  } catch {
    // If root doesn't exist yet (e.g., writeFile will create it), fall back to lexical resolution
    return path.resolve(cfg.workspaceRoot);
  }
}

/**
 * Resolve a relative path to an absolute path inside workspaceRoot.
 * Throws FsApiError('EACCES') for traversal attempts, absolute inputs, or
 * paths starting with '/'.
 * Empty/blank relPath resolves to workspaceRoot itself.
 */
function resolveInsideRoot(cfg: FsApiConfig, relPath: string): string {
  const root = resolvedRoot(cfg);

  // Reject absolute paths immediately
  if (relPath.startsWith('/') || path.isAbsolute(relPath)) {
    throw new FsApiError('EACCES', `Absolute paths are not allowed: ${relPath}`);
  }

  const normalised = relPath.trim();
  const resolved = normalised === '' ? root : path.resolve(root, normalised);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new FsApiError('EACCES', `Path traversal detected: ${relPath}`);
  }

  return resolved;
}

/**
 * Dereference symlinks and verify the real path is still inside the workspace.
 * Uses realpath on the workspace root too so macOS /var → /private/var is handled.
 */
async function realpathInsideRoot(cfg: FsApiConfig, absPath: string): Promise<string> {
  const root = await realRoot(cfg);
  let real: string;
  try {
    real = await fsp.realpath(absPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new FsApiError('ENOENT', `No such file or directory: ${absPath}`);
    throw err;
  }

  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new FsApiError('EACCES', `Symlink points outside workspace: ${absPath}`);
  }

  return real;
}

/** Convert an absolute real path back to a POSIX-style relative path. */
function toRelPath(realRootPath: string, absPath: string): string {
  const rel = path.relative(realRootPath, absPath);
  // Use forward slashes on all platforms
  return rel.split(path.sep).join('/');
}

function maxFileSize(cfg: FsApiConfig): number {
  return cfg.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
}

// ─── listDir ───────────────────────────────────────────────────────────────

export async function listDir(cfg: FsApiConfig, relPath: string): Promise<FsListResult> {
  const absPath = resolveInsideRoot(cfg, relPath);
  const realPath = await realpathInsideRoot(cfg, absPath);
  const root = await realRoot(cfg);

  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(realPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new FsApiError('ENOENT', `No such directory: ${relPath}`);
    throw err;
  }

  if (!stat.isDirectory()) {
    throw new FsApiError('ENOTDIR', `Not a directory: ${relPath}`);
  }

  const names = await fsp.readdir(realPath);
  const entries: FsEntry[] = [];

  for (const name of names) {
    const childAbs = path.join(realPath, name);
    let childStat: Awaited<ReturnType<typeof fsp.stat>> | null = null;
    try {
      childStat = await fsp.stat(childAbs);
    } catch {
      // skip unreadable entries
      continue;
    }

    const isDir = childStat.isDirectory();

    // Skip excluded directories
    if (isDir && EXCLUDED_DIRS.has(name)) continue;

    const entry: FsEntry = {
      name,
      path: toRelPath(root, childAbs),
      type: isDir ? 'directory' : 'file',
    };

    if (!isDir) {
      entry.size = childStat.size;
      entry.modifiedMs = childStat.mtimeMs;
    }

    entries.push(entry);
  }

  // Sort: directories first, then files; alphabetically within each group
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: toRelPath(root, realPath) || '.', entries };
}

// ─── readFile ──────────────────────────────────────────────────────────────

export async function readFile(cfg: FsApiConfig, relPath: string): Promise<FsReadResult> {
  const absPath = resolveInsideRoot(cfg, relPath);
  const realPath = await realpathInsideRoot(cfg, absPath);
  const root = await realRoot(cfg);

  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(realPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new FsApiError('ENOENT', `No such file: ${relPath}`);
    throw err;
  }

  if (stat.isDirectory()) {
    throw new FsApiError('EISDIR', `Path is a directory: ${relPath}`);
  }

  const limit = maxFileSize(cfg);
  if (stat.size > limit) {
    throw new FsApiError('E2BIG', `File too large: ${stat.size} bytes (limit ${limit})`);
  }

  const content = await fsp.readFile(realPath, 'utf-8');
  return { path: toRelPath(root, realPath), content, size: stat.size };
}

// ─── writeFile ─────────────────────────────────────────────────────────────

export async function writeFile(
  cfg: FsApiConfig,
  relPath: string,
  content: string,
): Promise<{ path: string; size: number }> {
  if (!relPath || relPath.trim() === '') {
    throw new FsApiError('EINVAL', 'relPath must not be empty for writeFile');
  }

  const limit = maxFileSize(cfg);
  const contentBytes = Buffer.byteLength(content, 'utf-8');
  if (contentBytes > limit) {
    throw new FsApiError('E2BIG', `Content too large: ${contentBytes} bytes (limit ${limit})`);
  }

  const absPath = resolveInsideRoot(cfg, relPath);

  // Ensure parent directory exists (inside workspace) — use lexical root for this check
  const parentAbs = path.dirname(absPath);
  const lexRoot = resolvedRoot(cfg);
  if (parentAbs !== lexRoot && !parentAbs.startsWith(lexRoot + path.sep)) {
    throw new FsApiError('EACCES', `Parent directory is outside workspace: ${relPath}`);
  }

  await fsp.mkdir(parentAbs, { recursive: true });
  await fsp.writeFile(absPath, content, 'utf-8');

  const stat = await fsp.stat(absPath);
  // Use realpath on the written file so relative path computation is consistent
  const realFilePath = await fsp.realpath(absPath);
  const realRootPath = await realRoot(cfg);
  return { path: toRelPath(realRootPath, realFilePath), size: stat.size };
}

// ─── searchFiles ───────────────────────────────────────────────────────────

/** Pure Node content search — no shell-out to ripgrep. */
export async function searchFiles(
  cfg: FsApiConfig,
  query: string,
  opts?: { maxHits?: number; relPath?: string },
): Promise<FsSearchResult> {
  if (!query) {
    throw new FsApiError('EINVAL', 'query must not be empty');
  }

  const maxHits = opts?.maxHits ?? DEFAULT_MAX_HITS;
  const root = await realRoot(cfg);
  const searchRoot = opts?.relPath
    ? await (async () => {
        const abs = resolveInsideRoot(cfg, opts.relPath!);
        try { return await fsp.realpath(abs); } catch { return abs; }
      })()
    : root;

  // Verify it exists
  try {
    const s = await fsp.stat(searchRoot);
    if (!s.isDirectory()) {
      throw new FsApiError('ENOTDIR', `Search path is not a directory: ${opts?.relPath}`);
    }
  } catch (err) {
    if (err instanceof FsApiError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new FsApiError('ENOENT', `Search path not found: ${opts?.relPath}`);
    throw err;
  }

  const hits: FsSearchHit[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;

    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (truncated) break;
      const childAbs = path.join(dir, name);

      let childStat: Awaited<ReturnType<typeof fsp.stat>> | null = null;
      try {
        childStat = await fsp.stat(childAbs);
      } catch {
        continue;
      }

      if (childStat.isDirectory()) {
        if (EXCLUDED_DIRS.has(name)) continue;
        await walk(childAbs);
      } else if (childStat.isFile()) {
        if (truncated) break;
        await searchInFile(childAbs);
      }
    }
  }

  async function searchInFile(absFile: string): Promise<void> {
    let buf: Buffer;
    try {
      buf = await fsp.readFile(absFile);
    } catch {
      return; // unreadable — skip
    }

    // Binary heuristic: NULL byte in first BINARY_SNIFF_BYTES bytes
    const sniff = buf.subarray(0, BINARY_SNIFF_BYTES);
    if (sniff.includes(0)) return;

    const text = buf.toString('utf-8');
    const lines = text.split('\n');
    const relFile = toRelPath(root, absFile);

    for (let i = 0; i < lines.length; i++) {
      if (truncated) break;
      const lineText = lines[i]!;
      let col = lineText.indexOf(query);
      while (col !== -1) {
        if (hits.length >= maxHits) {
          truncated = true;
          return;
        }
        hits.push({
          path: relFile,
          line: i + 1,
          column: col + 1,
          preview: lineText.trimEnd(),
        });
        col = lineText.indexOf(query, col + 1);
        if (truncated) return;
      }
    }
  }

  await walk(searchRoot);

  return { query, hits, truncated };
}
