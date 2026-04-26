// Re-export port helpers so existing importers (useDaemonHealth, etc.) are unaffected
export { getDaemonPort, getApiBase } from './apiFetch';
import { daemonFetch } from './apiFetch';
import { getCloudFallbackConfig, chatStreamCloud } from './cloudFallback';
export { getCloudFallbackConfig, setCloudFallbackConfig, CloudFallbackUnavailableError } from './cloudFallback';

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

/** Backward-compatible thin wrapper — prepends daemon URL and adds auth. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return daemonFetch(path, init);
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

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await daemonFetch(url, {
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
  /** Called for each text chunk when cloud fallback is active. */
  onChunk?: (text: string) => void;
}): Promise<Response> {
  const { signal, onChunk, ...body } = params;
  // retries: 0 — streaming bodies must not be retried after first byte;
  // a connect failure will still emit an apiEvents 'retry' event.
  try {
    return await daemonFetch(
      '/api/chat/stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
      { retries: 0 }
    );
  } catch (daemonErr) {
    // Only attempt cloud fallback on network-level errors (daemon unreachable)
    if (daemonErr instanceof TypeError && getCloudFallbackConfig().enabled) {
      if (!onChunk) {
        // No chunk handler provided — caller is not set up for cloud streaming;
        // rethrow so the offline queue can pick it up.
        throw daemonErr;
      }
      try {
        await chatStreamCloud({
          text: params.text,
          sessionId: params.sessionId,
          openFiles: params.openFiles,
          workspace: params.workspace,
          onChunk,
          signal,
        });
        // Return a synthetic completed response so callers don't need special-casing.
        return new Response(null, { status: 200 });
      } catch {
        // Cloud also failed — rethrow original so caller can enqueue offline.
        throw daemonErr;
      }
    }
    throw daemonErr;
  }
}

export interface ChatAttachment {
  kind: 'audio' | 'image';
  url: string;
  mime: string;
  size: number;
}

/**
 * Streaming chat request that supports file attachments via multipart/form-data.
 * Calls onChunk for each token; calls onAttachments once when the server reports
 * the persisted attachment metadata (carried on the first SSE data event).
 */
export async function chatStreamMultipart(params: {
  text: string;
  attachments: File[];
  openFiles?: OpenFile[];
  workspace?: string;
  sessionId?: string;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onAttachments?: (attachments: ChatAttachment[]) => void;
  onTool?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onError?: (message: string) => void;
}): Promise<void> {
  const fd = new FormData();
  fd.append('text', params.text);
  if (params.openFiles) fd.append('openFiles', JSON.stringify(params.openFiles));
  if (params.workspace) fd.append('workspace', params.workspace);
  if (params.sessionId) fd.append('sessionId', params.sessionId);
  for (const f of params.attachments) {
    fd.append('attachments[]', f, f.name);
  }

  // retries: 0 — streaming; connect failure still surfaces via apiEvents
  const res = await daemonFetch(
    '/api/chat/stream',
    { method: 'POST', body: fd, signal: params.signal },
    { retries: 0 }
  );
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let attachmentsEmitted = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // Parse SSE frames: split on "\n\n"
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event: string | undefined;
      let dataLine: string | undefined;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
      }
      if (dataLine === undefined) continue;
      if (event === 'done') return;
      if (event === 'error') {
        let msg = 'stream error';
        try { msg = (JSON.parse(dataLine) as { message?: string }).message ?? msg; } catch { /* ignore */ }
        params.onError?.(msg);
        return;
      }
      try {
        const parsed = JSON.parse(dataLine) as {
          type?: string;
          text?: string;
          name?: string;
          args?: Record<string, unknown>;
          result?: unknown;
          attachments?: ChatAttachment[];
        };
        if (!attachmentsEmitted && Array.isArray(parsed.attachments)) {
          attachmentsEmitted = true;
          params.onAttachments?.(parsed.attachments);
        }
        if (parsed.type === 'token' && typeof parsed.text === 'string') {
          params.onChunk(parsed.text);
        } else if (parsed.type === 'final' && typeof parsed.text === 'string') {
          params.onChunk(parsed.text);
        } else if (parsed.type === 'tool' && typeof parsed.name === 'string') {
          params.onTool?.(parsed.name, parsed.args ?? {});
        } else if (parsed.type === 'tool_result' && typeof parsed.name === 'string') {
          params.onToolResult?.(parsed.name, parsed.result);
        }
      } catch { /* ignore malformed */ }
    }
  }
}
export const exec = (command: string, cwd?: string) =>
  apiCall<ExecResult>('POST', '/api/exec', { body: { command, cwd } });
export const getDashboard = () => apiCall<DashboardResult>('GET', '/api/dashboard');

export async function transcribeAudio(blob: Blob): Promise<{ text: string }> {
  const fd = new FormData();
  fd.append('audio', blob, 'recording.webm');
  const res = await daemonFetch('/api/audio/transcribe', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}`);
  return res.json();
}

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

// ─── Models ──────────────────────────────────────────────────────────────────

export interface ModelEntry {
  provider: string;
  id: string;
  label?: string;
  available: boolean;
}

export interface ActiveModel {
  provider: string;
  modelId: string;
}

export const listModels = () =>
  apiCall<{ models: ModelEntry[] }>('GET', '/api/models').then((r) => r.models);

export const getActiveModel = () =>
  apiCall<{ activeModel: ActiveModel | null }>('GET', '/api/settings/active-model').then(
    (r) => r.activeModel
  );

export const setActiveModel = (provider: string, modelId: string) =>
  apiCall<{ ok: boolean; activeModel: ActiveModel }>('POST', '/api/settings/active-model', {
    body: { provider, modelId },
  });

// ─── Local Mode ──────────────────────────────────────────────────────────────

export interface LocalMode {
  localFirst: boolean;
  localOnly: boolean;
}

export const getLocalMode = () =>
  apiCall<LocalMode>('GET', '/api/settings/local-mode');

export const setLocalMode = (opts: LocalMode) =>
  apiCall<{ ok: boolean; localFirst: boolean; localOnly: boolean }>('POST', '/api/settings/local-mode', {
    body: opts,
  });
