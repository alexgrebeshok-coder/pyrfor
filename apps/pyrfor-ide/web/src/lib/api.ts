// Daemon port discovery
const DEFAULT_PORT = 18790;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let cachedPort: number | null = null;

export async function getDaemonPort(): Promise<number> {
  if (cachedPort !== null) return cachedPort;

  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const port = await invoke<number>('get_daemon_port');
      cachedPort = port;
      return port;
    } catch {
      // fall through
    }
  }

  const envPort = (import.meta as any).env?.VITE_PYRFOR_PORT;
  cachedPort = envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
  return cachedPort;
}

/**
 * Synchronous accessor for the API base URL — uses cached port (populated by
 * any prior async call) or falls back to env/default.
 */
export function getApiBase(): string {
  if (cachedPort === null) {
    const envPort = (import.meta as any).env?.VITE_PYRFOR_PORT;
    cachedPort = envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
  }
  return `http://localhost:${cachedPort}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const port = await getDaemonPort();
  const url = `http://localhost:${port}${path}`;
  return fetch(url, init);
}

async function apiCall<T>(
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  let url = path;
  if (opts.query) {
    const params = new URLSearchParams(opts.query);
    url = `${path}?${params}`;
  }

  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('pyrfor-token')) || '';
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await apiFetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new ApiError(
      data.error || `HTTP ${res.status}`,
      data.code || String(res.status),
      res.status
    );
  }
  return data as T;
}

export interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
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
export interface ChatResult {
  reply: string;
  model?: string;
  sessionId?: string;
}
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}
export interface DashboardResult {
  model?: string;
  workspaceRoot?: string;
  cwd?: string;
}

export const fsList = (path: string) =>
  apiCall<FsListResult>('GET', '/api/fs/list', { query: { path } });
export const fsRead = (path: string) =>
  apiCall<FsReadResult>('GET', '/api/fs/read', { query: { path } });
export const fsWrite = (path: string, content: string) =>
  apiCall<void>('PUT', '/api/fs/write', { body: { path, content } });
export const fsSearch = (query: string, root: string) =>
  apiCall<FsSearchResult>('POST', '/api/fs/search', { body: { query, root } });
export const chat = (text: string, sessionId?: string) =>
  apiCall<ChatResult>('POST', '/api/chat', { body: { text, sessionId } });

export interface OpenFile {
  path: string;
  content: string;
  language?: string;
}

export async function chatStream(params: {
  text: string;
  openFiles?: OpenFile[];
  workspace?: string;
  sessionId?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const port = await getDaemonPort();
  const url = `http://localhost:${port}/api/chat/stream`;
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('pyrfor-token')) || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const { signal, ...body } = params;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
}
export const exec = (command: string, cwd?: string) =>
  apiCall<ExecResult>('POST', '/api/exec', { body: { command, cwd } });
export const getDashboard = () => apiCall<DashboardResult>('GET', '/api/dashboard');

// ─── Git API ───────────────────────────────────────────────────────────────

export interface GitFileEntry {
  path: string;
  x: string;
  y: string;
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
}

export interface GitLogEntry {
  sha: string;
  author: string;
  dateUnix: number;
  subject: string;
}

export interface GitBlameEntry {
  sha: string;
  author: string;
  line: number;
  content: string;
}

export const gitGetStatus = (workspace: string) =>
  apiCall<GitStatusResult>('GET', '/api/git/status', { query: { workspace } });

export const gitGetDiff = (workspace: string, path: string, staged = false) =>
  apiCall<{ diff: string }>('GET', '/api/git/diff', {
    query: { workspace, path, staged: staged ? '1' : '0' },
  }).then((r) => r.diff);

export const gitGetFileContent = (workspace: string, path: string, ref = 'HEAD') =>
  apiCall<{ content: string }>('GET', '/api/git/file', {
    query: { workspace, path, ref },
  }).then((r) => r.content);

export const gitStageFiles = (workspace: string, paths: string[]) =>
  apiCall<{ ok: boolean }>('POST', '/api/git/stage', { body: { workspace, paths } });

export const gitUnstageFiles = (workspace: string, paths: string[]) =>
  apiCall<{ ok: boolean }>('POST', '/api/git/unstage', { body: { workspace, paths } });

export const gitCommitFiles = (workspace: string, message: string) =>
  apiCall<{ sha: string }>('POST', '/api/git/commit', { body: { workspace, message } });

export const gitGetLog = (workspace: string, limit = 50) =>
  apiCall<{ entries: GitLogEntry[] }>('GET', '/api/git/log', {
    query: { workspace, limit: String(limit) },
  }).then((r) => r.entries);

export const gitGetBlame = (workspace: string, path: string) =>
  apiCall<{ entries: GitBlameEntry[] }>('GET', '/api/git/blame', {
    query: { workspace, path },
  }).then((r) => r.entries);

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  json: 'json',
  md: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sh: 'shell',
  bash: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  sql: 'sql',
  xml: 'xml',
  txt: 'plaintext',
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] || 'plaintext';
}
