/**
 * Runtime HTTP Gateway
 *
 * Thin HTTP server that exposes health/status/chat endpoints for the runtime.
 * Uses Node's built-in `http` module — no framework dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { PtyManager } from './pty/manager.js';
import { readFileSync, existsSync, readdirSync, writeFileSync as writeFileSyncNode, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import { processPhoto } from './media/process-photo.js';
import { logger } from '../observability/logger';
import type { RuntimeConfig } from './config';
import { loadConfig, saveConfig } from './config.js';
import { providerRouter as defaultProviderRouter, type ModelEntry } from './provider-router.js';
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';
import { collectMetrics, formatMetrics } from './metrics';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { createTokenValidator, type TokenValidator } from './auth-tokens';
import { GoalStore } from './goal-store';
import type { ApprovalSettings } from './approval-flow';
import { approvalFlow } from './approval-flow';
import {
  listDir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  searchFiles,
  FsApiError,
  type FsApiConfig,
} from './ide/fs-api.js';
import {
  gitStatus,
  gitDiff,
  gitFileContent,
  gitStage,
  gitUnstage,
  gitCommit,
  gitLog,
  gitBlame,
} from './git/api.js';
import { transcribeBuffer } from './voice.js';
import { setWorkspaceRoot } from './tools.js';
import type { ArtifactStore } from './artifact-model';
import type { DomainOverlayRegistry } from './domain-overlay';
import type { DurableDag } from './durable-dag';
import type { EventLedger, LedgerEvent } from './event-ledger';
import type { RunLedger } from './run-ledger';
import type { RunRecord } from './run-lifecycle';
import { createDefaultProductFactory, isProductFactoryTemplateId, type ProductFactoryPlanInput } from './product-factory';

// ─── Public API ────────────────────────────────────────────────────────────

export interface GatewayDeps {
  config: RuntimeConfig;
  runtime: PyrforRuntime;
  health?: HealthMonitor;
  cron?: CronService;
  /** Optional GoalStore — defaults to ~/.pyrfor */
  goalStore?: GoalStore;
  /** Optional path to approval-settings.json — defaults to ~/.pyrfor/approval-settings.json */
  approvalSettingsPath?: string;
  /** Optional directory for static Mini App files — defaults to telegram/app/ relative to this module */
  staticDir?: string;
  /** Optional directory for IDE static files — defaults to telegram/ide/ relative to this module */
  ideStaticDir?: string;
  /** Optional directory for chat-attachment storage — defaults to ~/.pyrfor/media */
  mediaDir?: string;
  /**
   * Override exec timeout for testing. Defaults to DEFAULT_EXEC_TIMEOUT_MS (30 s).
   * Set to a small value (e.g., 2000) in tests that verify the timeout path.
   */
  execTimeoutMs?: number;
  /**
   * Override the bind port, taking precedence over `config.gateway.port`.
   * Pass `0` to let the OS assign a random available port.
   * When omitted, the value of the `PYRFOR_PORT` environment variable is checked
   * next (also supports `0`); if absent, `config.gateway.port` is used (default 18790).
   */
  portOverride?: number;
  /** Optional ProviderRouter instance for model listing. Falls back to imported singleton. */
  providerRouter?: {
    listAllModels(): Promise<ModelEntry[]>;
    setActiveModel(provider: string, modelId: string): void;
    getActiveModel(): { provider: string; modelId: string } | undefined;
    setLocalMode(opts: { localFirst: boolean; localOnly: boolean }): void;
    getLocalMode(): { localFirst: boolean; localOnly: boolean };
    refreshFromEnvironment?(): void;
  };
  approvalFlow?: {
    getPending(): Array<{
      id: string;
      toolName: string;
      summary: string;
      args: Record<string, unknown>;
      run_id?: string;
      effect_id?: string;
      effect_kind?: string;
      policy_id?: string;
      reason?: string;
      approval_required?: boolean;
    }>;
    resolveDecision(id: string, decision: 'approve' | 'deny'): boolean;
    listAudit(limit?: number): unknown[];
  };
  orchestration?: {
    runLedger?: Pick<RunLedger, 'listRuns' | 'getRun' | 'replayRun' | 'eventsForRun' | 'transition' | 'completeRun'>;
    eventLedger?: Pick<EventLedger, 'readAll' | 'byRun'>;
    dag?: Pick<DurableDag, 'listNodes'>;
    artifactStore?: Pick<ArtifactStore, 'list'>;
    overlays?: Pick<DomainOverlayRegistry, 'list' | 'get'>;
  };
  configPath?: string;
}

export interface GatewayHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
}

// ─── Static file helpers ───────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const fallbackProductFactory = createDefaultProductFactory();

function resolveDefaultStaticDir(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return path.join(path.dirname(__filename), 'telegram', 'app');
  } catch {
    // Fallback for environments where import.meta.url is unavailable
    return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'app');
  }
}

function resolveDefaultIdeStaticDir(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return path.join(path.dirname(__filename), 'telegram', 'ide');
  } catch {
    return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'ide');
  }
}

function serveStaticFile(res: ServerResponse, staticDir: string, filePath: string): void {
  const full = path.resolve(staticDir, filePath);
  // Prevent path traversal — resolved path must stay inside staticDir
  if (!full.startsWith(path.resolve(staticDir) + path.sep) && full !== path.resolve(staticDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end('Forbidden');
    return;
  }
  if (!existsSync(full)) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';
  const body = readFileSync(full);
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

// ─── Approval-settings helpers ─────────────────────────────────────────────

function readApprovalSettings(settingsPath: string): ApprovalSettings {
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(raw) as ApprovalSettings;
  } catch {
    return {};
  }
}

function saveApprovalSettings(settingsPath: string, settings: ApprovalSettings): void {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSyncNode(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// ─── Gateway Helpers ───────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendUnauthorized(res: ServerResponse, reason: 'unknown' | 'expired' = 'unknown'): void {
  sendJson(res, 401, { error: 'unauthorized', reason });
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Minimal multipart/form-data parser — extracts the raw bytes of the first
 * named part matching `fieldName`.  Only handles the subset needed here:
 * a single binary file field with a Content-Type sub-header.
 */
function extractMultipartField(body: Buffer, boundary: string, fieldName: string): Buffer | null {
  const enc = 'binary' as BufferEncoding;
  const bodyStr = body.toString(enc);
  const delim = `--${boundary}`;
  const parts = bodyStr.split(delim);

  for (const part of parts) {
    if (!part.includes(`name="${fieldName}"`)) continue;
    // Headers end at the first \r\n\r\n
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    // The content is everything after the header block, minus the trailing \r\n
    const content = part.slice(headerEnd + 4);
    const trimmed = content.endsWith('\r\n') ? content.slice(0, -2) : content;
    return Buffer.from(trimmed, enc);
  }
  return null;
}

/**
 * Parses an entire multipart/form-data body into an array of parts.
 * Each part includes its name, optional filename, optional Content-Type,
 * and the raw bytes. Suitable for handling multiple file uploads under
 * keys like `attachments` or `attachments[]`.
 */
interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const enc = 'binary' as BufferEncoding;
  const bodyStr = body.toString(enc);
  const delim = `--${boundary}`;
  const parts = bodyStr.split(delim);
  const out: MultipartPart[] = [];
  for (const part of parts) {
    if (!part) continue;
    const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    if (trimmed === '' || trimmed === '--') continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headersRaw = part.slice(0, headerEnd);
    let content = part.slice(headerEnd + 4);
    if (content.endsWith('\r\n')) content = content.slice(0, -2);
    const nameMatch = /name="([^"]*)"/.exec(headersRaw);
    if (!nameMatch) continue;
    const filenameMatch = /filename="([^"]*)"/.exec(headersRaw);
    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headersRaw);
    out.push({
      name: nameMatch[1],
      filename: filenameMatch?.[1],
      contentType: ctMatch?.[1]?.trim(),
      data: Buffer.from(content, enc),
    });
  }
  return out;
}

/** Safe JSON parse — returns the parsed value or null on syntax error. */
function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw || '{}') };
  } catch {
    return { ok: false };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildValidator(config: RuntimeConfig): TokenValidator {
  return createTokenValidator({
    bearerToken: config.gateway.bearerToken,
    bearerTokens: config.gateway.bearerTokens,
  });
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string');
  return undefined;
}

function extractBearerToken(req: IncomingMessage, query?: Record<string, unknown>): string | undefined {
  const authHeader = firstString(req.headers['authorization']);
  if (authHeader) {
    return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  }

  // Browser WebSocket clients cannot set Authorization headers. This query
  // token keeps PTY WS aligned with HTTP auth until Tauri owns session transport.
  return firstString(query?.['token']);
}

function providerSecretEnvKey(secretKey: string): string | null {
  const provider = secretKey.replace(/^provider:/, '').toLowerCase();
  switch (provider) {
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'zai':
      return 'ZAI_API_KEY';
    case 'zhipu':
      return 'ZHIPU_API_KEY';
    case 'telegram_token':
      return 'TELEGRAM_BOT_TOKEN';
    default:
      return provider ? `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY` : null;
  }
}

function runtimeWorkspacePath(runtime: PyrforRuntime, fallback: string): string {
  const getter = (runtime as unknown as { getWorkspacePath?: () => string }).getWorkspacePath;
  if (typeof getter === 'function') {
    return getter.call(runtime);
  }
  return fallback;
}

function applyRuntimeWorkspace(runtime: PyrforRuntime, workspaceRoot: string): void {
  const setter = (runtime as unknown as { setWorkspacePath?: (path: string) => void }).setWorkspacePath;
  if (typeof setter === 'function') {
    setter.call(runtime, workspaceRoot);
    return;
  }
  setWorkspaceRoot(workspaceRoot);
}

// ─── IDE helpers ────────────────────────────────────────────────────────────

/** Map FsApiError.code to HTTP status. */
function fsErrStatus(code: FsApiError['code']): number {
  switch (code) {
    case 'ENOENT': return 404;
    case 'E2BIG': return 413;
    case 'EACCES':
    case 'EISDIR':
    case 'ENOTDIR':
    case 'EINVAL':
    default: return 400;
  }
}

function sendFsError(res: ServerResponse, err: FsApiError): void {
  sendJson(res, fsErrStatus(err.code), { error: err.message, code: err.code });
}

/**
 * Exec timeout in milliseconds. Exported so tests can override it via
 * the `execTimeoutMs` field in GatewayDeps.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

/** Max bytes captured per stream (stdout / stderr). */
const EXEC_MAX_OUTPUT = 100_000;

/**
 * Run an external command with a timeout. Does NOT use shell:true unless the
 * command string starts with "bash -c " or "sh -c ", in which case the shell
 * is invoked with a single argument (the rest of the string).
 *
 * Returns stdout, stderr, exitCode, and durationMs.
 * On timeout: kills the process, sets exitCode = -1, stderr = 'TIMEOUT'.
 */
function runExec(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();

    let file: string;
    let args: string[];
    let useShell = false;

    // Allow explicit shell invocation via "bash -c <script>" or "sh -c <script>"
    const shellMatch = command.match(/^(bash|sh)\s+-c\s+([\s\S]+)$/);
    if (shellMatch) {
      file = shellMatch[1]!;
      args = ['-c', shellMatch[2]!];
      useShell = false; // We're calling bash/sh directly — still no shell:true
    } else {
      // Simple whitespace tokenizer — handles quoted strings naively
      const tokens = tokenize(command);
      file = tokens[0] ?? '';
      args = tokens.slice(1);
    }

    const child = spawn(file, args, {
      cwd,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > EXEC_MAX_OUTPUT) {
        stdout = stdout.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > EXEC_MAX_OUTPUT) {
        stderr = stderr.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      if (timedOut) {
        resolve({ stdout, stderr: 'TIMEOUT', exitCode: -1, durationMs });
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0, durationMs });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      resolve({ stdout, stderr: err.message, exitCode: -1, durationMs });
    });
  });
}

/**
 * Minimal command tokenizer. Splits on whitespace, respects single- and
 * double-quoted substrings (no escape sequences — sufficient for test commands).
 */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseProductFactoryPlanInput(value: unknown): ProductFactoryPlanInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as {
    templateId?: unknown;
    prompt?: unknown;
    answers?: unknown;
    domainIds?: unknown;
    productFactory?: unknown;
  };
  if (body.productFactory !== undefined) return parseProductFactoryPlanInput(body.productFactory);
  if (typeof body.templateId !== 'string' || !isProductFactoryTemplateId(body.templateId) || typeof body.prompt !== 'string') return null;
  const input: ProductFactoryPlanInput = {
    templateId: body.templateId,
    prompt: body.prompt,
  };
  if (body.answers !== undefined) {
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return null;
    input.answers = Object.fromEntries(
      Object.entries(body.answers as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }
  if (body.domainIds !== undefined) {
    if (!Array.isArray(body.domainIds) || body.domainIds.some((item) => typeof item !== 'string')) return null;
    input.domainIds = body.domainIds;
  }
  return input;
}

function parseOchagReminderPlanInput(value: unknown): ProductFactoryPlanInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as {
    title?: unknown;
    familyId?: unknown;
    dueAt?: unknown;
    visibility?: unknown;
    audience?: unknown;
    memberIds?: unknown;
    privacy?: unknown;
    escalationPolicy?: unknown;
  };
  if (typeof body.title !== 'string' || !body.title.trim()) return null;
  const answers: Record<string, string> = {};
  if (typeof body.familyId === 'string') answers['familyId'] = body.familyId;
  if (typeof body.dueAt === 'string') answers['dueAt'] = body.dueAt;
  if (body.visibility === 'member' || body.visibility === 'family') answers['visibility'] = body.visibility;
  if (typeof body.audience === 'string') answers['audience'] = body.audience;
  if (Array.isArray(body.memberIds)) {
    answers['memberIds'] = body.memberIds.filter((item): item is string => typeof item === 'string').join(',');
  }
  if (typeof body.privacy === 'string') answers['privacy'] = body.privacy;
  if (typeof body.escalationPolicy === 'string') answers['escalationPolicy'] = body.escalationPolicy;
  return {
    templateId: 'ochag_family_reminder',
    prompt: body.title,
    answers,
    domainIds: ['ochag'],
  };
}

function parseCeoclawBriefPlanInput(value: unknown): ProductFactoryPlanInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as {
    decision?: unknown;
    evidence?: unknown;
    deadline?: unknown;
    projectId?: unknown;
    title?: unknown;
  };
  const decision = typeof body.decision === 'string' ? body.decision.trim() : '';
  if (!decision) return null;
  const answers: Record<string, string> = { decision };
  if (typeof body.evidence === 'string') answers['evidence'] = body.evidence;
  if (Array.isArray(body.evidence)) {
    answers['evidence'] = body.evidence.filter((item): item is string => typeof item === 'string').join(',');
  }
  if (typeof body.deadline === 'string') answers['deadline'] = body.deadline;
  if (typeof body.projectId === 'string') answers['projectId'] = body.projectId;
  return {
    templateId: 'business_brief',
    prompt: typeof body.title === 'string' && body.title.trim() ? body.title : decision,
    answers,
    domainIds: ['ceoclaw'],
  };
}

function missingRequiredAnswers(input: ProductFactoryPlanInput, requiredAnswerIds: string[]): string[] {
  const answers = input.answers ?? {};
  return requiredAnswerIds.filter((id) => !answers[id]?.trim());
}

type OrchestrationDeps = NonNullable<GatewayDeps['orchestration']>;

function isOrchestrationEvent(event: unknown): event is LedgerEvent {
  if (!event || typeof event !== 'object') return false;
  const type = (event as { type?: unknown }).type;
  return typeof type === 'string' && (
    type.startsWith('run.') ||
    type.startsWith('effect.') ||
    type.startsWith('dag.') ||
    type.startsWith('verifier.') ||
    type.startsWith('eval.') ||
    type === 'artifact.created' ||
    type === 'test.completed'
  );
}

function latestByCreatedAt<T extends { createdAt?: string }>(items: T[]): T | null {
  return [...items].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0] ?? null;
}

function nodeBelongsToRun(node: { payload?: Record<string, unknown>; provenance?: Array<{ kind?: string; ref?: string }> }, runId: string): boolean {
  return node.payload?.['runId'] === runId ||
    node.payload?.['run_id'] === runId ||
    (node.provenance ?? []).some((link) => link.kind === 'run' && link.ref === runId);
}

async function listRunEvents(orchestration: OrchestrationDeps | undefined, runId: string): Promise<LedgerEvent[]> {
  if (orchestration?.runLedger) return orchestration.runLedger.eventsForRun(runId);
  return orchestration?.eventLedger?.byRun(runId) ?? [];
}

async function getRunRecord(orchestration: OrchestrationDeps | undefined, runId: string): Promise<RunRecord | undefined> {
  const cached = orchestration?.runLedger?.getRun(runId);
  if (cached) return cached;
  return orchestration?.runLedger?.replayRun(runId);
}

function listWorkerFrames(orchestration: OrchestrationDeps | undefined, runId: string): Array<Record<string, unknown>> {
  return orchestration?.dag?.listNodes()
    .filter((node) => nodeBelongsToRun(node, runId) && node.kind.startsWith('worker.frame.'))
    .map((node) => {
      const frameLink = (node.provenance ?? []).find((link) => link.kind === 'worker_frame');
      return {
        nodeId: node.id,
        frame_id: frameLink?.ref ?? node.id,
        type: String(node.payload?.['frameType'] ?? node.kind.replace(/^worker\.frame\./, '')),
        source: node.payload?.['source'],
        disposition: node.payload?.['disposition'],
        ok: node.payload?.['ok'],
        seq: node.payload?.['seq'],
        ts: node.updatedAt,
        payload: node.payload,
      };
    }) ?? [];
}

async function buildOrchestrationDashboard(
  orchestration: OrchestrationDeps | undefined,
  approvalsPending = 0,
): Promise<Record<string, unknown>> {
  const runs = orchestration?.runLedger?.listRuns() ?? [];
  const nodes = orchestration?.dag?.listNodes() ?? [];
  const events = orchestration?.eventLedger ? await orchestration.eventLedger.readAll() : [];
  const kernelEvents = events.filter(isOrchestrationEvent);
  const proposedEffects = new Set<string>();
  const settledEffects = new Set<string>();
  for (const event of kernelEvents) {
    if (event.type === 'effect.proposed') proposedEffects.add(event.effect_id);
    if (event.type === 'effect.applied' || event.type === 'effect.denied' || event.type === 'effect.failed') {
      settledEffects.add(event.effect_id);
    }
  }
  const contextPacks = orchestration?.artifactStore
    ? await orchestration.artifactStore.list({ kind: 'context_pack' })
    : [];
  const overlays = orchestration?.overlays?.list() ?? [];
  const verifierEvents = kernelEvents.filter((event) => event.type === 'verifier.completed');
  const latestVerifier = verifierEvents[verifierEvents.length - 1];
  const workerFrameNodes = nodes.filter((node) => node.kind.startsWith('worker.frame.'));

  return {
    runs: {
      total: runs.length,
      active: runs.filter((run) => run.status === 'running' || run.status === 'awaiting_approval').length,
      blocked: runs.filter((run) => run.status === 'blocked').length,
      latest: runs.slice(-5).reverse(),
    },
    dag: {
      total: nodes.length,
      ready: nodes.filter((node) => node.status === 'ready').length,
      running: nodes.filter((node) => node.status === 'running' || node.status === 'leased').length,
      blocked: nodes.filter((node) => node.status === 'blocked' || node.status === 'failed').length,
    },
    effects: {
      pending: Array.from(proposedEffects).filter((effectId) => !settledEffects.has(effectId)).length,
    },
    approvals: {
      pending: approvalsPending,
    },
    verifier: {
      blocked: verifierEvents.filter((event) => event.status === 'blocked').length,
      status: latestVerifier?.status ?? null,
      latest: latestVerifier ?? null,
    },
    workerFrames: {
      total: workerFrameNodes.length,
      pending: workerFrameNodes.filter((node) => node.status === 'pending' || node.status === 'ready' || node.status === 'running' || node.status === 'leased').length,
      lastType: workerFrameNodes[workerFrameNodes.length - 1]?.payload?.['frameType'] ?? null,
    },
    contextPack: latestByCreatedAt(contextPacks),
    overlays: {
      total: overlays.length,
      domainIds: overlays.map((overlay) => overlay.domainId).sort(),
    },
  };
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createRuntimeGateway(deps: GatewayDeps): GatewayHandle {
  const { config, runtime, health, cron } = deps;
  const router = deps.providerRouter ?? defaultProviderRouter;
  const approvals = deps.approvalFlow ?? approvalFlow;
  const orchestration = deps.orchestration;

  // Mini App dependencies
  const goalStore = deps.goalStore ?? new GoalStore();
  const approvalSettingsPath = deps.approvalSettingsPath
    ?? path.join(homedir(), '.pyrfor', 'approval-settings.json');
  const STATIC_DIR = deps.staticDir ?? resolveDefaultStaticDir();
  const IDE_STATIC_DIR = deps.ideStaticDir ?? resolveDefaultIdeStaticDir();
  const MEDIA_DIR = deps.mediaDir ?? path.join(homedir(), '.pyrfor', 'media');

  // ─── IDE filesystem config ─────────────────────────────────────────────
  const fsConfig: FsApiConfig = {
    workspaceRoot: config.workspaceRoot
      ?? config.workspacePath
      ?? path.join(homedir(), '.pyrfor', 'workspace'),
  };

  const execTimeout = deps.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const ptyManager = new PtyManager();

  // Build token validator from config. Rebuilt on each request is fine for v1
  // (config is passed in at construction time). For hot-reload, callers should
  // reconstruct the gateway or we'd need an onConfigChange hook — deferred to v2.
  const tokenValidator: TokenValidator = buildValidator(config);

  const requireAuth =
    !!(config.gateway.bearerToken) ||
    (config.gateway.bearerTokens?.length ?? 0) > 0;

  // ─── Rate limiter ──────────────────────────────────────────────────────

  const rlCfg = config.rateLimit;
  let rateLimiter: RateLimiter | null = null;
  if (rlCfg?.enabled) {
    rateLimiter = createRateLimiter({
      capacity: rlCfg.capacity,
      refillPerSec: rlCfg.refillPerSec,
    });
    logger.info('[gateway-rate-limit] Rate limiter enabled', {
      capacity: rlCfg.capacity,
      refillPerSec: rlCfg.refillPerSec,
      exemptPaths: rlCfg.exemptPaths,
    });
  }

  // ─── Auth ──────────────────────────────────────────────────────────────

  function checkAuth(req: IncomingMessage, query?: Record<string, unknown>): { ok: boolean; reason?: 'unknown' | 'expired' } {
    if (!requireAuth) return { ok: true };
    const token = extractBearerToken(req, query);
    if (!token) return { ok: false, reason: 'unknown' };
    const result = tokenValidator.validate(token);
    if (!result.ok) {
      const last4 = token.length >= 4 ? token.slice(-4) : token.padStart(4, '*').slice(-4);
      logger.warn(`[auth] Denied request (token…last4=${last4})`, {
        reason: result.reason,
        label: result.label,
      });
    }
    return result;
  }

  function enforceAuth(req: IncomingMessage, res: ServerResponse, query?: Record<string, unknown>): boolean {
    const authResult = checkAuth(req, query);
    if (authResult.ok) return true;
    sendUnauthorized(res, authResult.reason ?? 'unknown');
    return false;
  }

  // ─── Media helpers ─────────────────────────────────────────────────────

  const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;
  const MEDIA_MIME_MAP: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
  };

  function extFromContentType(ct?: string): string {
    if (!ct) return '.bin';
    const lower = ct.toLowerCase();
    if (lower.includes('png')) return '.png';
    if (lower.includes('jpeg') || lower.includes('jpg')) return '.jpg';
    if (lower.includes('gif')) return '.gif';
    if (lower.includes('webp')) return '.webp';
    if (lower.includes('svg')) return '.svg';
    if (lower.includes('mpeg')) return '.mp3';
    if (lower.includes('wav')) return '.wav';
    if (lower.includes('ogg')) return '.ogg';
    if (lower.includes('webm')) return '.webm';
    if (lower.includes('mp4')) return '.m4a';
    if (lower.includes('flac')) return '.flac';
    if (lower.includes('aac')) return '.aac';
    return '.bin';
  }

  function extFromFilename(name?: string): string | null {
    if (!name) return null;
    const ext = path.extname(name).toLowerCase();
    return ext && SAFE_NAME_RE.test(ext.slice(1)) ? ext : null;
  }

  /**
   * Parse a multipart/form-data chat request, persist any attachments, and
   * (when applicable) enrich the user's text with image descriptions and
   * audio transcripts. Returns either an error or the assembled chat input.
   */
  async function processChatMultipart(
    req: IncomingMessage,
    requireText: boolean,
  ): Promise<
    | { ok: false; status: number; error: string }
    | {
        ok: true;
        text: string;
        openFiles?: Array<{ path: string; content: string; language?: string }>;
        workspace?: string;
        sessionId?: string;
        attachments: Array<{ kind: 'audio' | 'image'; url: string; mime: string; size: number }>;
      }
  > {
    const ct = req.headers['content-type'] ?? '';
    const boundaryMatch = /boundary=([^\s;]+)/.exec(ct);
    if (!boundaryMatch) {
      return { ok: false, status: 400, error: 'Expected multipart/form-data with boundary' };
    }
    const boundary = boundaryMatch[1];
    const rawBody = await readBodyBuffer(req);
    const parts = parseMultipart(rawBody, boundary);

    let text = '';
    let workspace: string | undefined;
    let sessionId: string | undefined;
    let openFiles: Array<{ path: string; content: string; language?: string }> | undefined;
    const fileParts: MultipartPart[] = [];

    for (const p of parts) {
      if (p.filename !== undefined) {
        if (p.name === 'attachments' || p.name === 'attachments[]') {
          fileParts.push(p);
        }
        continue;
      }
      const value = p.data.toString('utf-8');
      if (p.name === 'text') text = value;
      else if (p.name === 'workspace') workspace = value;
      else if (p.name === 'sessionId') sessionId = value;
      else if (p.name === 'openFiles') {
        const parsedJson = tryParseJson(value);
        if (parsedJson.ok && Array.isArray(parsedJson.value)) {
          openFiles = parsedJson.value as Array<{ path: string; content: string; language?: string }>;
        }
      }
    }

    if (requireText && !text) {
      return { ok: false, status: 400, error: 'text required' };
    }

    // Resolve / validate sessionId for media storage
    const safeSession = sessionId && SAFE_NAME_RE.test(sessionId) ? sessionId : randomUUID();
    sessionId = safeSession;

    const attachments: Array<{ kind: 'audio' | 'image'; url: string; mime: string; size: number }> = [];
    if (fileParts.length > 0) {
      const sessionDir = path.join(MEDIA_DIR, safeSession);
      mkdirSync(sessionDir, { recursive: true });

      const port = (() => {
        const addr = server.address();
        return addr && typeof addr === 'object' ? addr.port : resolveBindPort();
      })();

      for (const fp of fileParts) {
        const ctype = fp.contentType ?? 'application/octet-stream';
        const ext = extFromFilename(fp.filename) ?? extFromContentType(ctype);
        const id = randomUUID();
        const filename = `${id}${ext}`;
        const fullPath = path.join(sessionDir, filename);
        writeFileSync(fullPath, fp.data);
        const isAudio = ctype.toLowerCase().startsWith('audio/');
        const isImage = ctype.toLowerCase().startsWith('image/');
        const kind: 'audio' | 'image' = isAudio ? 'audio' : isImage ? 'image' : (
          ['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac', '.aac', '.opus', '.oga'].includes(ext)
            ? 'audio'
            : 'image'
        );
        const url = `http://localhost:${port}/api/media/${safeSession}/${filename}`;
        attachments.push({ kind, url, mime: ctype, size: fp.data.length });

        // Enrich text based on attachment type
        try {
          if (kind === 'image') {
            const base64 = fp.data.toString('base64');
            const result = await processPhoto({ base64, caption: text || undefined });
            const desc = result.description ?? result.enrichedPrompt;
            if (desc) {
              text = (text ? text + '\n\n' : '') + `[Image description: ${desc}]`;
            }
          } else if (kind === 'audio') {
            try {
              const { transcribeBuffer } = await import('./voice.js');
              const transcript = await transcribeBuffer(fp.data, config.voice);
              if (transcript) {
                text = (text ? text + '\n\n' : '') + `[Audio transcript: ${transcript}]`;
              }
            } catch (err) {
              logger.warn('[gateway-media] audio transcription failed', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch (err) {
          logger.warn('[gateway-media] attachment enrichment failed', {
            kind,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return { ok: true, text, openFiles, workspace, sessionId, attachments };
  }

  // ─── Server ────────────────────────────────────────────────────────────

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const parsed = parseUrl(req.url ?? '/', true);
    const method = req.method ?? 'GET';
    const pathname = parsed.pathname ?? '/';
    const query = parsed.query;

    // CORS preflight — always respond 204 with permissive headers
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end();
      return;
    }

    // Rate limiting — applied to all non-exempt paths
    if (rateLimiter) {
      const exemptPaths = rlCfg?.exemptPaths ?? ['/ping', '/health', '/metrics'];
      if (!exemptPaths.includes(pathname)) {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
        const ip = req.socket.remoteAddress ?? 'unknown';
        const rlKey = token ?? ip;
        const { allowed, retryAfterMs } = rateLimiter.tryConsume(rlKey);
        if (!allowed) {
          const retryAfterSec = Math.ceil(retryAfterMs / 1000);
          logger.warn('[gateway-rate-limit] Request denied', { key: rlKey, pathname, retryAfterMs });
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfterSec),
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(JSON.stringify({ error: 'rate_limited', retryAfterMs }));
          return;
        }
      }
    }

    // Public routes — no auth required
    if (method === 'GET' && pathname === '/ping') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && pathname === '/health') {
      if (!health) {
        sendJson(res, 200, { status: 'unknown' });
        return;
      }
      const snapshot = health.getLastSnapshot();
      const status =
        snapshot == null || snapshot.status === 'healthy' || snapshot.status === 'degraded'
          ? 200
          : 503;
      sendJson(res, status, snapshot ?? { status: 'unknown' });
      return;
    }

    // GET /metrics — Prometheus text exposition format.
    if (method === 'GET' && pathname === '/metrics') {
      if (!enforceAuth(req, res, query)) return;
      const metricsSnapshot = collectMetrics({ runtime, health, cron });
      const body = formatMetrics(metricsSnapshot);
      sendText(res, 200, body, 'text/plain; version=0.0.4; charset=utf-8');
      return;
    }

    // GET /api/settings/active-model — public (no sensitive data)
    if (method === 'GET' && pathname === '/api/settings/active-model') {
      const activeModel = router.getActiveModel() ?? null;
      sendJson(res, 200, { activeModel });
      return;
    }

    // GET /api/settings/local-mode — public (no sensitive data)
    if (method === 'GET' && pathname === '/api/settings/local-mode') {
      const mode = (router as typeof router & { getLocalMode?: () => { localFirst: boolean; localOnly: boolean } }).getLocalMode?.() ?? { localFirst: false, localOnly: false };
      sendJson(res, 200, mode);
      return;
    }

    // ─── Root redirect → /app (Telegram Mini App) ───────────────────────
    if (method === 'GET' && (pathname === '/' || pathname === '')) {
      res.writeHead(302, { Location: '/app' });
      res.end();
      return;
    }

    // ─── Telegram Mini App static files (public) ────────────────────────

    if (method === 'GET' && (pathname === '/app' || pathname === '/app/')) {
      serveStaticFile(res, STATIC_DIR, 'index.html');
      return;
    }

    if (method === 'GET' && pathname.startsWith('/app/')) {
      const relative = pathname.slice('/app/'.length); // e.g. "style.css"
      serveStaticFile(res, STATIC_DIR, relative);
      return;
    }

    // ─── IDE static files (public) ──────────────────────────────────────

    if (method === 'GET' && (pathname === '/ide' || pathname === '/ide/')) {
      serveStaticFile(res, IDE_STATIC_DIR, 'index.html');
      return;
    }

    if (method === 'GET' && pathname.startsWith('/ide/')) {
      const relative = pathname.slice('/ide/'.length);
      serveStaticFile(res, IDE_STATIC_DIR, relative);
      return;
    }

    // ─── Chat-attachment media files (public read) ───────────────────────
    if (method === 'GET' && pathname.startsWith('/api/media/')) {
      const rest = pathname.slice('/api/media/'.length);
      const segs = rest.split('/');
      if (segs.length !== 2) {
        sendJson(res, 400, { error: 'invalid_path' });
        return;
      }
      const [sessId, fname] = segs;
      if (!SAFE_NAME_RE.test(sessId) || !SAFE_NAME_RE.test(fname)) {
        sendJson(res, 400, { error: 'invalid_path' });
        return;
      }
      const full = path.join(MEDIA_DIR, sessId, fname);
      const expectedRoot = path.resolve(MEDIA_DIR) + path.sep;
      if (!path.resolve(full).startsWith(expectedRoot)) {
        sendJson(res, 400, { error: 'invalid_path' });
        return;
      }
      if (!existsSync(full)) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      try {
        const stat = statSync(full);
        if (!stat.isFile()) { sendJson(res, 404, { error: 'not_found' }); return; }
      } catch { sendJson(res, 404, { error: 'not_found' }); return; }
      const ext = path.extname(full).toLowerCase();
      const mime = MEDIA_MIME_MAP[ext] ?? 'application/octet-stream';
      const body = readFileSync(full);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
      return;
    }

    // ─── Telegram Mini App API routes (public — auth via X-Telegram-Init-Data, deferred) ──

    if (pathname === '/api/dashboard' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      try {
        let sessionsCount = 0;
        // TODO: wire LLM cost accumulator (#dashboard-cost)
        let costToday: number | null = null;
        try {
          const rStats = (runtime as unknown as { getStats?: () => { sessions?: { active?: number } } }).getStats?.();
          sessionsCount = rStats?.sessions?.active ?? 0;
        } catch { /* not critical */ }

        const activeGoals = goalStore.list('active').slice(0, 3);
        const recentActivity = goalStore.list().slice(-10).reverse();
        const model = config.providers?.defaultProvider ?? 'unknown';
        sendJson(res, 200, {
          status: 'running',
          model,
          costToday,
          sessionsCount,
          activeGoals,
          recentActivity,
          workspaceRoot: fsConfig.workspaceRoot,
          cwd: runtimeWorkspacePath(runtime, fsConfig.workspaceRoot),
          orchestration: await buildOrchestrationDashboard(orchestration, approvals.getPending().length),
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Internal server error' });
      }
      return;
    }

    if (pathname === '/api/goals' && method === 'GET') {
      sendJson(res, 200, goalStore.list());
      return;
    }

    if (pathname === '/api/goals' && method === 'POST') {
      const raw = await readBody(req);
      const parsed2 = tryParseJson(raw);
      if (!parsed2.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const body2 = parsed2.value as { title?: string; description?: string };
      const desc = body2.title || body2.description;
      if (!desc) { sendJson(res, 400, { error: 'title required' }); return; }
      const goal = goalStore.create(desc);
      sendJson(res, 200, goal);
      return;
    }

    // POST /api/goals/:id/done
    const goalDoneMatch = pathname.match(/^\/api\/goals\/([^/]+)\/done$/);
    if (goalDoneMatch && method === 'POST') {
      const id = goalDoneMatch[1]!;
      const updated = goalStore.markDone(id);
      if (!updated) { sendJson(res, 404, { error: 'Goal not found' }); return; }
      sendJson(res, 200, updated);
      return;
    }

    // DELETE /api/goals/:id
    const goalDeleteMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
    if (goalDeleteMatch && method === 'DELETE') {
      const id = goalDeleteMatch[1]!;
      const updated = goalStore.cancel(id);
      if (!updated) { sendJson(res, 404, { error: 'Goal not found' }); return; }
      sendJson(res, 200, updated);
      return;
    }

    if (pathname === '/api/agents' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      // TODO: expose subagents API from PyrforRuntime (currently returns empty array)
      sendJson(res, 200, [] as { id: string; name: string; status: string; startedAt: string }[]);
      return;
    }

    if (pathname === '/api/memory' && method === 'GET') {
      const memoryPath = path.join(homedir(), '.openclaw', 'workspace', 'MEMORY.md');
      let lines: string[] = [];
      try {
        const content = readFileSync(memoryPath, 'utf-8');
        const allLines = content.split('\n');
        lines = allLines.slice(-50);
      } catch { /* file may not exist */ }

      let files: string[] = [];
      try {
        const wsDir = path.join(homedir(), '.openclaw', 'workspace');
        files = readdirSync(wsDir).filter(f => !f.startsWith('.'));
      } catch { /* dir may not exist */ }

      sendJson(res, 200, { lines, files });
      return;
    }

    if (pathname === '/api/settings' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      const settings = readApprovalSettings(approvalSettingsPath);
      sendJson(res, 200, {
        defaultAction: settings.defaultAction ?? 'ask',
        whitelist: settings.whitelist ?? [],
        blacklist: settings.blacklist ?? [],
        autoApprovePatterns: settings.autoApprovePatterns ?? [],
        provider: config.providers?.defaultProvider ?? null,
      });
      return;
    }

    if (pathname === '/api/settings' && method === 'POST') {
      if (!enforceAuth(req, res, query)) return;
      const raw = await readBody(req);
      const parsedS = tryParseJson(raw);
      if (!parsedS.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const updates = parsedS.value as {
        defaultAction?: 'approve' | 'ask' | 'deny';
        whitelist?: string[];
        blacklist?: string[];
      };
      const current = readApprovalSettings(approvalSettingsPath);
      if (updates.defaultAction !== undefined) {
        const valid = ['approve', 'ask', 'deny'] as const;
        if (!valid.includes(updates.defaultAction)) {
          sendJson(res, 400, { error: 'invalid defaultAction' }); return;
        }
        current.defaultAction = updates.defaultAction;
      }
      if (Array.isArray(updates.whitelist)) current.whitelist = updates.whitelist;
      if (Array.isArray(updates.blacklist)) current.blacklist = updates.blacklist;
      try {
        saveApprovalSettings(approvalSettingsPath, current);
        sendJson(res, 200, { ok: true, settings: current });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to save settings' });
      }
      return;
    }

    if (pathname === '/api/stats' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      let sessionsCount = 0;
      try {
        const rStats = (runtime as unknown as { getStats?: () => { sessions?: { active?: number } } }).getStats?.();
        sessionsCount = rStats?.sessions?.active ?? 0;
      } catch { /* not critical */ }
      // TODO: wire LLM cost accumulator (#dashboard-cost)
      sendJson(res, 200, {
        costToday: null,
        sessionsCount,
        uptime: process.uptime(),
      });
      return;
    }

    // POST /api/runtime/credentials — inject provider keys into process.env for this session.
    // Called by the Tauri frontend on startup after loading keys from Keychain.
    if (pathname === '/api/runtime/credentials' && method === 'POST') {
      if (!enforceAuth(req, res, query)) return;
      const raw = await readBody(req);
      const parsedCreds = tryParseJson(raw);
      if (!parsedCreds.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const creds = parsedCreds.value as Record<string, unknown>;
      for (const [k, v] of Object.entries(creds)) {
        const envKey = providerSecretEnvKey(k);
        if (!envKey) continue;
        if (typeof v === 'string') {
          process.env[envKey] = v;
        } else if (v === null) {
          delete process.env[envKey];
        }
      }
      router.refreshFromEnvironment?.();
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
      res.end();
      return;
    }

    // All other routes require auth
    const authResult = checkAuth(req, query);
    if (!authResult.ok) {
      sendUnauthorized(res, authResult.reason ?? 'unknown');
      return;
    }

    try {
      if (pathname === '/api/workspace' && method === 'GET') {
        sendJson(res, 200, {
          workspaceRoot: fsConfig.workspaceRoot,
          cwd: runtimeWorkspacePath(runtime, fsConfig.workspaceRoot),
        });
        return;
      }

      if (pathname === '/api/workspace/open' && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { path?: string };
        if (!body.path || !path.isAbsolute(body.path)) {
          sendJson(res, 400, { error: 'absolute workspace path required', code: 'EINVAL' });
          return;
        }

        const workspaceRoot = path.resolve(body.path);
        try {
          const stat = statSync(workspaceRoot);
          if (!stat.isDirectory()) {
            sendJson(res, 400, { error: 'workspace path is not a directory', code: 'ENOTDIR' });
            return;
          }
        } catch {
          sendJson(res, 400, { error: 'workspace path does not exist', code: 'ENOENT' });
          return;
        }

        const nextConfig = {
          ...config,
          workspacePath: workspaceRoot,
          workspaceRoot,
        };
        try {
          await saveConfig(nextConfig, deps.configPath);
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : 'Failed to save workspace' });
          return;
        }

        Object.assign(config, nextConfig);
        fsConfig.workspaceRoot = workspaceRoot;
        applyRuntimeWorkspace(runtime, workspaceRoot);
        sendJson(res, 200, {
          ok: true,
          workspaceRoot,
          cwd: runtimeWorkspacePath(runtime, workspaceRoot),
        });
        return;
      }

      if (pathname === '/api/approvals/pending' && method === 'GET') {
        sendJson(res, 200, { approvals: approvals.getPending() });
        return;
      }

      const approvalDecisionMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
      if (approvalDecisionMatch && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { decision?: 'approve' | 'deny' };
        if (body.decision !== 'approve' && body.decision !== 'deny') {
          sendJson(res, 400, { error: 'decision must be approve or deny' });
          return;
        }
        const ok = approvals.resolveDecision(approvalDecisionMatch[1]!, body.decision);
        if (!ok) {
          sendJson(res, 404, { error: 'approval_not_found' });
          return;
        }
        sendJson(res, 200, { ok: true, decision: body.decision });
        return;
      }

      if (pathname === '/api/audit/events' && method === 'GET') {
        const rawLimit = Number(query['limit'] ?? 100);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 100;
        const approvalEvents = approvals.listAudit(limit);
        const ledgerEvents = orchestration?.eventLedger
          ? (await orchestration.eventLedger.readAll()).filter(isOrchestrationEvent).slice(-limit).reverse()
          : [];
        sendJson(res, 200, { events: [...ledgerEvents, ...approvalEvents].slice(0, limit) });
        return;
      }

      if (pathname === '/api/product-factory/templates' && method === 'GET') {
        const listTemplates = (runtime as Partial<PyrforRuntime>).listProductFactoryTemplates;
        const templates = typeof listTemplates === 'function'
          ? listTemplates.call(runtime)
          : fallbackProductFactory.listTemplates();
        sendJson(res, 200, { templates });
        return;
      }

      if (pathname === '/api/product-factory/plan' && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseProductFactoryPlanInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'templateId and prompt are required' });
          return;
        }
        try {
          const previewPlan = (runtime as Partial<PyrforRuntime>).previewProductFactoryPlan;
          const preview = typeof previewPlan === 'function'
            ? previewPlan.call(runtime, input)
            : fallbackProductFactory.previewPlan(input);
          sendJson(res, 200, { preview });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'product_factory_plan_failed' });
        }
        return;
      }

      if (pathname === '/api/ochag/privacy' && method === 'GET') {
        const overlay = orchestration?.overlays?.get('ochag')?.manifest;
        if (!overlay) {
          sendJson(res, 404, { error: 'ochag_overlay_not_found' });
          return;
        }
        sendJson(res, 200, {
          domainId: 'ochag',
          privacyRules: overlay.privacyRules ?? [],
          toolPermissionOverrides: overlay.toolPermissionOverrides ?? {},
          adapterRegistrations: overlay.adapterRegistrations ?? [],
        });
        return;
      }

      if (pathname === '/api/ochag/reminders/preview' && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseOchagReminderPlanInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'title is required' });
          return;
        }
        try {
          const previewPlan = (runtime as Partial<PyrforRuntime>).previewProductFactoryPlan;
          const preview = typeof previewPlan === 'function'
            ? previewPlan.call(runtime, input)
            : fallbackProductFactory.previewPlan(input);
          sendJson(res, 200, { preview });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'ochag_preview_failed' });
        }
        return;
      }

      if (pathname === '/api/ochag/reminders' && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseOchagReminderPlanInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'title is required' });
          return;
        }
        const missing = missingRequiredAnswers(input, ['familyId', 'audience', 'dueAt', 'visibility']);
        if (missing.length > 0) {
          sendJson(res, 400, { error: 'missing_required_clarifications', missingClarifications: missing });
          return;
        }
        const createProductRun = (runtime as Partial<PyrforRuntime>).createProductFactoryRun;
        if (typeof createProductRun !== 'function') {
          sendJson(res, 501, { error: 'product_factory_unavailable' });
          return;
        }
        try {
          const result = await createProductRun.call(runtime, input);
          sendJson(res, 201, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'ochag_create_failed' });
        }
        return;
      }

      if (pathname === '/api/ceoclaw/briefs/preview' && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseCeoclawBriefPlanInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'decision is required' });
          return;
        }
        try {
          const previewPlan = (runtime as Partial<PyrforRuntime>).previewProductFactoryPlan;
          const preview = typeof previewPlan === 'function'
            ? previewPlan.call(runtime, input)
            : fallbackProductFactory.previewPlan(input);
          sendJson(res, 200, { preview });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'ceoclaw_preview_failed' });
        }
        return;
      }

      if (pathname === '/api/ceoclaw/briefs' && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseCeoclawBriefPlanInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'decision is required' });
          return;
        }
        const missing = missingRequiredAnswers(input, ['evidence']);
        if (missing.length > 0) {
          sendJson(res, 400, { error: 'missing_required_clarifications', missingClarifications: missing });
          return;
        }
        const createProductRun = (runtime as Partial<PyrforRuntime>).createProductFactoryRun;
        if (typeof createProductRun !== 'function') {
          sendJson(res, 501, { error: 'product_factory_unavailable' });
          return;
        }
        try {
          const result = await createProductRun.call(runtime, input);
          sendJson(res, 201, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'ceoclaw_create_failed' });
        }
        return;
      }

      if (pathname === '/api/runs' && method === 'GET') {
        sendJson(res, 200, { runs: orchestration?.runLedger?.listRuns() ?? [] });
        return;
      }

      if (pathname === '/api/runs' && method === 'POST') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseProductFactoryPlanInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'templateId and prompt are required' });
          return;
        }
        const missing = fallbackProductFactory.previewPlan(input).missingClarifications.map((item) => item.id);
        if (missing.length > 0) {
          sendJson(res, 400, { error: 'missing_required_clarifications', missingClarifications: missing });
          return;
        }
        const createProductRun = (runtime as Partial<PyrforRuntime>).createProductFactoryRun;
        if (typeof createProductRun !== 'function') {
          sendJson(res, 501, { error: 'product_factory_unavailable' });
          return;
        }
        try {
          const result = await createProductRun.call(runtime, input);
          sendJson(res, 201, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'product_factory_run_failed' });
        }
        return;
      }

      const runEventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (runEventsMatch && method === 'GET') {
        const runId = decodeURIComponent(runEventsMatch[1]!);
        sendJson(res, 200, { events: await listRunEvents(orchestration, runId) });
        return;
      }

      const runDagMatch = pathname.match(/^\/api\/runs\/([^/]+)\/dag$/);
      if (runDagMatch && method === 'GET') {
        const runId = decodeURIComponent(runDagMatch[1]!);
        const nodes = orchestration?.dag?.listNodes()
          .filter((node) => nodeBelongsToRun(node, runId)) ?? [];
        sendJson(res, 200, { nodes });
        return;
      }

      const runFramesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/frames$/);
      if (runFramesMatch && method === 'GET') {
        const runId = decodeURIComponent(runFramesMatch[1]!);
        sendJson(res, 200, { frames: listWorkerFrames(orchestration, runId) });
        return;
      }

      const runControlMatch = pathname.match(/^\/api\/runs\/([^/]+)\/control$/);
      if (runControlMatch && method === 'POST') {
        const runId = decodeURIComponent(runControlMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { action?: 'replay' | 'continue' | 'abort'; resumeToken?: string };
        if (body.action !== 'replay' && body.action !== 'continue' && body.action !== 'abort') {
          sendJson(res, 400, { error: 'action must be replay, continue, or abort' });
          return;
        }
        try {
          if (body.action === 'replay') {
            const replayed = await orchestration?.runLedger?.replayRun(runId);
            sendJson(res, 200, { ok: true, action: body.action, run: replayed });
            return;
          }
          if (body.action === 'continue') {
            const run = await orchestration?.runLedger?.transition(runId, 'running', body.resumeToken ? `continue:${body.resumeToken}` : 'operator continue');
            sendJson(res, 200, { ok: true, action: body.action, run });
            return;
          }
          const run = await orchestration?.runLedger?.transition(runId, 'cancelled', 'operator abort');
          sendJson(res, 200, { ok: true, action: body.action, run });
        } catch (err) {
          sendJson(res, 409, { error: err instanceof Error ? err.message : 'control_failed' });
        }
        return;
      }

      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && method === 'GET') {
        const runId = decodeURIComponent(runMatch[1]!);
        const run = await getRunRecord(orchestration, runId);
        if (!run) {
          sendJson(res, 404, { error: 'run_not_found' });
          return;
        }
        sendJson(res, 200, { run });
        return;
      }

      if (pathname === '/api/overlays' && method === 'GET') {
        sendJson(res, 200, { overlays: orchestration?.overlays?.list() ?? [] });
        return;
      }

      const overlayMatch = pathname.match(/^\/api\/overlays\/([^/]+)$/);
      if (overlayMatch && method === 'GET') {
        const domainId = decodeURIComponent(overlayMatch[1]!);
        const overlay = orchestration?.overlays?.get(domainId)?.manifest;
        if (!overlay) {
          sendJson(res, 404, { error: 'overlay_not_found' });
          return;
        }
        sendJson(res, 200, { overlay });
        return;
      }

      // GET /status
      if (method === 'GET' && pathname === '/status') {
        const snapshot = health?.getLastSnapshot() ?? null;
        const cronStatus = cron?.getStatus() ?? null;
        sendJson(res, 200, {
          uptime: process.uptime(),
          config: {
            gateway: { port: config.gateway.port, host: config.gateway.host },
          },
          cron: cronStatus,
          health: snapshot,
        });
        return;
      }

      // GET /cron/jobs
      if (method === 'GET' && pathname === '/cron/jobs') {
        if (!cron) {
          sendJson(res, 200, { jobs: [] });
          return;
        }
        sendJson(res, 200, { jobs: cron.getStatus() });
        return;
      }

      // POST /cron/trigger
      if (method === 'POST' && pathname === '/cron/trigger') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { error: 'invalid_json' });
          return;
        }
        const payload = parsed.value as { name?: string };
        if (!payload.name) {
          sendJson(res, 400, { error: 'name required' });
          return;
        }
        if (!cron) {
          sendJson(res, 503, { error: 'CronService not available' });
          return;
        }
        try {
          await cron.triggerJob(payload.name);
          sendJson(res, 200, { ok: true, name: payload.name });
        } catch (err) {
          sendJson(res, 404, {
            error: err instanceof Error ? err.message : 'Job not found',
          });
        }
        return;
      }

      // POST /v1/chat/completions  (OpenAI-compatible)
      if (method === 'POST' && pathname === '/v1/chat/completions') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) {
          sendJson(res, 400, { error: 'invalid_json' });
          return;
        }
        const payload = parsed.value as {
          messages?: Array<{ role: string; content: string }>;
          channel?: string;
          userId?: string;
          chatId?: string;
        };

        const messages = payload.messages ?? [];
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage?.content) {
          sendJson(res, 400, { error: 'messages must contain at least one entry with content' });
          return;
        }

        const channel = (payload.channel ?? 'api') as Parameters<typeof runtime.handleMessage>[0];
        const userId = payload.userId ?? 'gateway-user';
        const chatId = payload.chatId ?? 'gateway-chat';

        const result = await runtime.handleMessage(channel, userId, chatId, lastMessage.content);

        sendJson(res, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          pyrfor: {
            sessionId: result.sessionId,
            runId: result.runId,
            taskId: result.taskId,
          },
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: result.response },
              finish_reason: 'stop',
            },
          ],
        });
        return;
      }

      // ─── IDE Filesystem routes ────────────────────────────────────────────

      // GET /api/fs/list?path=<relPath>
      if (method === 'GET' && pathname === '/api/fs/list') {
        const relPath = (query['path'] as string | undefined) ?? '';
        try {
          const result = await listDir(fsConfig, relPath);
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // GET /api/fs/read?path=<relPath>
      if (method === 'GET' && pathname === '/api/fs/read') {
        const relPath = (query['path'] as string | undefined) ?? '';
        if (!relPath) { sendJson(res, 400, { error: 'path query param required', code: 'EINVAL' }); return; }
        try {
          const result = await fsReadFile(fsConfig, relPath);
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // PUT /api/fs/write  body: {path, content}
      if (method === 'PUT' && pathname === '/api/fs/write') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { path?: string; content?: string };
        if (!body.path) { sendJson(res, 400, { error: 'path required', code: 'EINVAL' }); return; }
        if (body.content === undefined) { sendJson(res, 400, { error: 'content required', code: 'EINVAL' }); return; }
        try {
          const result = await fsWriteFile(fsConfig, body.path, body.content);
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // POST /api/fs/search  body: {query, maxHits?, path?}
      if (method === 'POST' && pathname === '/api/fs/search') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { query?: string; maxHits?: number; path?: string };
        if (!body.query) { sendJson(res, 400, { error: 'query required', code: 'EINVAL' }); return; }
        try {
          const result = await searchFiles(fsConfig, body.query, {
            maxHits: body.maxHits,
            relPath: body.path,
          });
          sendJson(res, 200, result);
        } catch (err) {
          if (err instanceof FsApiError) { sendFsError(res, err); return; }
          throw err;
        }
        return;
      }

      // POST /api/chat  body: {userId?, chatId?, text}  OR  multipart/form-data
      if (method === 'POST' && pathname === '/api/chat') {
        const ct = req.headers['content-type'] ?? '';
        if (ct.toLowerCase().includes('multipart/form-data')) {
          const m = await processChatMultipart(req, false);
          if (!m.ok) { sendJson(res, m.status, { error: m.error }); return; }
          const userId = 'ide-user';
          const chatId = 'ide-chat';
          try {
            const result = await runtime.handleMessage(
              'http' as Parameters<typeof runtime.handleMessage>[0],
              userId, chatId, m.text,
              m.sessionId ? { sessionId: m.sessionId } : undefined,
            );
            sendJson(res, 200, {
              reply: result.response,
              sessionId: result.sessionId,
              runId: result.runId,
              taskId: result.taskId,
              attachments: m.attachments,
            });
          } catch (err) {
            sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
          }
          return;
        }
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { userId?: string; chatId?: string; sessionId?: string; text?: string; prefer?: string; routingHints?: unknown };
        if (!body.text) { sendJson(res, 400, { error: 'text required' }); return; }
        const userId = body.userId ?? 'ide-user';
        const chatId = body.chatId ?? 'ide-chat';
        try {
          const result = await runtime.handleMessage(
            'http' as Parameters<typeof runtime.handleMessage>[0],
            userId, chatId, body.text,
            body.sessionId ? { sessionId: body.sessionId } : undefined,
          );
          sendJson(res, 200, {
            reply: result.response,
            sessionId: result.sessionId,
            runId: result.runId,
            taskId: result.taskId,
          });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
        }
        return;
      }

      // POST /api/chat/stream  body: {text, openFiles?, workspace?, sessionId?}  OR  multipart/form-data
      if (method === 'POST' && pathname === '/api/chat/stream') {
        const ct = req.headers['content-type'] ?? '';
        const isMultipart = ct.toLowerCase().includes('multipart/form-data');

        let bodyText: string;
        let bodyOpenFiles: Array<{ path: string; content: string; language?: string }> | undefined;
        let bodyWorkspace: string | undefined;
        let bodySessionId: string | undefined;
        let attachments: Array<{ kind: 'audio' | 'image'; url: string; mime: string; size: number }> = [];
        let bodyPrefer: 'local' | 'cloud' | 'auto' | undefined;
        let bodyRoutingHints: { contextSizeChars?: number; sensitive?: boolean } | undefined;
        let bodyWorker: { transport: 'freeclaude' | 'acp' } | undefined;

        if (isMultipart) {
          const m = await processChatMultipart(req, true);
          if (!m.ok) {
            res.writeHead(m.status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
            res.end(JSON.stringify({ error: m.error }));
            return;
          }
          bodyText = m.text;
          bodyOpenFiles = m.openFiles;
          bodyWorkspace = m.workspace;
          bodySessionId = m.sessionId;
          attachments = m.attachments;
          // TODO(media-attachments): forward prefer/routingHints from multipart fields when branch merges
        } else {
          const raw = await readBody(req);
          const parsed = tryParseJson(raw);
          if (!parsed.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
            res.end(JSON.stringify({ error: 'invalid_json' }));
            return;
          }
          const body = parsed.value as {
            text?: string;
            openFiles?: Array<{ path: string; content: string; language?: string }>;
            workspace?: string;
            sessionId?: string;
            prefer?: 'local' | 'cloud' | 'auto';
            routingHints?: { contextSizeChars?: number; sensitive?: boolean };
            worker?: { transport?: 'freeclaude' | 'acp' };
          };
          if (!body.text) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
            res.end(JSON.stringify({ error: 'text required' }));
            return;
          }
          bodyText = body.text;
          bodyOpenFiles = body.openFiles;
          bodyWorkspace = body.workspace;
          bodySessionId = body.sessionId;
          bodyPrefer = body.prefer;
          bodyRoutingHints = body.routingHints;
          bodyWorker = body.worker?.transport ? { transport: body.worker.transport } : undefined;
        }

        // Always 200 for SSE; errors are sent inline.
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        });

        const writeSSE = (eventName: string | null, data: unknown): void => {
          if (eventName) res.write(`event: ${eventName}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        try {
          let firstEvent = true;
          let emittedAny = false;
          for await (const event of runtime.streamChatRequest({
            text: bodyText,
            openFiles: bodyOpenFiles,
            workspace: bodyWorkspace ?? fsConfig.workspaceRoot,
            sessionId: bodySessionId,
            prefer: bodyPrefer,
            routingHints: bodyRoutingHints,
            worker: bodyWorker,
          })) {
            const wrapped = firstEvent && attachments.length > 0
              ? { ...event, attachments }
              : event;
            firstEvent = false;
            emittedAny = true;
            writeSSE(null, wrapped);
          }
          // If runtime didn't emit any events but we have attachments, surface them.
          if (!emittedAny && attachments.length > 0) {
            writeSSE(null, { type: 'attachments', attachments });
          }
          writeSSE('done', {});
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Internal error';
          writeSSE('error', { message });
        } finally {
          res.end();
        }
        return;
      }

      // POST /api/audio/transcribe  multipart/form-data; field: audio (Blob, audio/*)
      if (method === 'POST' && pathname === '/api/audio/transcribe') {
        const contentType = req.headers['content-type'] ?? '';
        const boundaryMatch = /boundary=([^\s;]+)/.exec(contentType);
        if (!contentType.startsWith('multipart/form-data') || !boundaryMatch) {
          sendJson(res, 400, { error: 'Expected multipart/form-data with boundary' });
          return;
        }
        const boundary = boundaryMatch[1];
        const rawBody = await readBodyBuffer(req);
        const audioBuffer = extractMultipartField(rawBody, boundary, 'audio');
        if (!audioBuffer || audioBuffer.length === 0) {
          sendJson(res, 400, { error: 'Missing or empty "audio" field in multipart body' });
          return;
        }
        try {
          const text = await transcribeBuffer(audioBuffer, config.voice);
          sendJson(res, 200, { text });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Transcription failed';
          sendJson(res, 500, { error: message });
        }
        return;
      }

      // POST /api/exec  body: {command, cwd?}
      if (method === 'POST' && pathname === '/api/exec') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { command?: string; cwd?: string };
        if (!body.command) { sendJson(res, 400, { error: 'command required' }); return; }

        // Resolve cwd: must be inside workspaceRoot
        let execCwd: string;
        if (body.cwd) {
          // Reuse the same path-safety logic as the FS module
          const root = path.resolve(fsConfig.workspaceRoot);
          const candidate = body.cwd.startsWith('/')
            ? body.cwd
            : path.resolve(root, body.cwd);
          if (candidate !== root && !candidate.startsWith(root + path.sep)) {
            sendJson(res, 400, { error: `cwd is outside workspace: ${body.cwd}` });
            return;
          }
          execCwd = candidate;
        } else {
          execCwd = path.resolve(fsConfig.workspaceRoot);
        }

        const result = await runExec(body.command, execCwd, execTimeout);
        sendJson(res, 200, result);
        return;
      }

      // ─── Git routes ───────────────────────────────────────────────────────

      // GET /api/git/status?workspace=...
      if (method === 'GET' && pathname === '/api/git/status') {
        const workspace = query['workspace'] as string | undefined;
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        try {
          const result = await gitStatus(workspace);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/diff?workspace=...&path=...&staged=0|1
      if (method === 'GET' && pathname === '/api/git/diff') {
        const workspace = query['workspace'] as string | undefined;
        const filePath = query['path'] as string | undefined;
        const staged = (query['staged'] as string | undefined) === '1';
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        if (!filePath) { sendJson(res, 400, { error: 'path query param required' }); return; }
        try {
          const diff = await gitDiff(workspace, filePath, staged);
          sendJson(res, 200, { diff });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/file?workspace=...&path=...&ref=HEAD
      if (method === 'GET' && pathname === '/api/git/file') {
        const workspace = query['workspace'] as string | undefined;
        const filePath = query['path'] as string | undefined;
        const ref = (query['ref'] as string | undefined) ?? 'HEAD';
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        if (!filePath) { sendJson(res, 400, { error: 'path query param required' }); return; }
        try {
          const content = await gitFileContent(workspace, filePath, ref);
          sendJson(res, 200, { content });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/git/stage  body: {workspace, paths}
      if (method === 'POST' && pathname === '/api/git/stage') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { workspace?: string; paths?: string[] };
        if (!body.workspace) { sendJson(res, 400, { error: 'workspace required' }); return; }
        if (!Array.isArray(body.paths) || body.paths.length === 0) {
          sendJson(res, 400, { error: 'paths must be a non-empty array' }); return;
        }
        try {
          await gitStage(body.workspace, body.paths);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/git/unstage  body: {workspace, paths}
      if (method === 'POST' && pathname === '/api/git/unstage') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { workspace?: string; paths?: string[] };
        if (!body.workspace) { sendJson(res, 400, { error: 'workspace required' }); return; }
        if (!Array.isArray(body.paths) || body.paths.length === 0) {
          sendJson(res, 400, { error: 'paths must be a non-empty array' }); return;
        }
        try {
          await gitUnstage(body.workspace, body.paths);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/git/commit  body: {workspace, message}
      if (method === 'POST' && pathname === '/api/git/commit') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { workspace?: string; message?: string };
        if (!body.workspace) { sendJson(res, 400, { error: 'workspace required' }); return; }
        if (!body.message || !body.message.trim()) {
          sendJson(res, 400, { error: 'message must not be empty' }); return;
        }
        try {
          const result = await gitCommit(body.workspace, body.message);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/log?workspace=...&limit=50
      if (method === 'GET' && pathname === '/api/git/log') {
        const workspace = query['workspace'] as string | undefined;
        const limit = parseInt((query['limit'] as string | undefined) ?? '50', 10);
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        try {
          const entries = await gitLog(workspace, isNaN(limit) ? 50 : limit);
          sendJson(res, 200, { entries });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // GET /api/git/blame?workspace=...&path=...
      if (method === 'GET' && pathname === '/api/git/blame') {
        const workspace = query['workspace'] as string | undefined;
        const filePath = query['path'] as string | undefined;
        if (!workspace) { sendJson(res, 400, { error: 'workspace query param required' }); return; }
        if (!filePath) { sendJson(res, 400, { error: 'path query param required' }); return; }
        try {
          const entries = await gitBlame(workspace, filePath);
          sendJson(res, 200, { entries });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
        }
        return;
      }

      // POST /api/pty/spawn  body: {cwd, shell?, cols?, rows?}
      if (method === 'POST' && pathname === '/api/pty/spawn') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { cwd?: string; shell?: string; cols?: number; rows?: number };
        if (!body.cwd) { sendJson(res, 400, { error: 'cwd required' }); return; }
        const id = ptyManager.spawn({
          cwd: body.cwd,
          shell: body.shell,
          cols: body.cols,
          rows: body.rows,
        });
        sendJson(res, 200, { id });
        return;
      }

      // GET /api/pty/list
      if (method === 'GET' && pathname === '/api/pty/list') {
        sendJson(res, 200, ptyManager.list());
        return;
      }

      // POST /api/pty/:id/resize  body: {cols, rows}
      const ptyResizeMatch = pathname.match(/^\/api\/pty\/([^/]+)\/resize$/);
      if (ptyResizeMatch && method === 'POST') {
        const ptyId = ptyResizeMatch[1]!;
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { cols?: number; rows?: number };
        if (!body.cols || !body.rows) { sendJson(res, 400, { error: 'cols and rows required' }); return; }
        try {
          ptyManager.resize(ptyId, body.cols, body.rows);
          res.writeHead(204); res.end();
        } catch {
          sendJson(res, 404, { error: 'PTY not found' });
        }
        return;
      }

      // DELETE /api/pty/:id
      const ptyDeleteMatch = pathname.match(/^\/api\/pty\/([^/]+)$/);
      if (ptyDeleteMatch && method === 'DELETE') {
        const ptyId = ptyDeleteMatch[1]!;
        ptyManager.kill(ptyId);
        res.writeHead(204); res.end();
        return;
      }

      // GET /api/models — list all models across providers
      if (method === 'GET' && pathname === '/api/models') {
        try {
          const models = await router.listAllModels();
          sendJson(res, 200, { models });
        } catch (err) {
          logger.warn('[gateway] /api/models failed', { error: String(err) });
          sendJson(res, 500, { error: 'Failed to list models' });
        }
        return;
      }

      // POST /api/settings/active-model  body: { provider, modelId }
      if (method === 'POST' && pathname === '/api/settings/active-model') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { provider?: string; modelId?: string };
        if (!body.provider || !body.modelId) {
          sendJson(res, 400, { error: 'provider and modelId are required' });
          return;
        }
        router.setActiveModel(body.provider, body.modelId);
        try {
          const { config: latest, path: cfgPath } = await loadConfig();
          const updated = {
            ...latest,
            ai: { ...latest.ai, activeModel: { provider: body.provider, modelId: body.modelId } },
          };
          await saveConfig(updated, cfgPath);
        } catch (err) {
          logger.warn('[gateway] failed to persist active model', { error: String(err) });
        }
        sendJson(res, 200, {
          ok: true,
          activeModel: { provider: body.provider, modelId: body.modelId },
        });
        return;
      }

      // POST /api/settings/local-mode  body: { localFirst, localOnly }
      if (method === 'POST' && pathname === '/api/settings/local-mode') {
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as { localFirst?: unknown; localOnly?: unknown };
        const localFirst = typeof body.localFirst === 'boolean' ? body.localFirst : false;
        const localOnly = typeof body.localOnly === 'boolean' ? body.localOnly : false;
        (router as typeof router & { setLocalMode?: (opts: { localFirst: boolean; localOnly: boolean }) => void }).setLocalMode?.({ localFirst, localOnly });
        try {
          const { config: latest, path: cfgPath } = await loadConfig();
          const updated = {
            ...latest,
            ai: { ...latest.ai, localFirst, localOnly },
          };
          await saveConfig(updated, cfgPath);
        } catch (err) {
          logger.warn('[gateway] failed to persist local mode', { error: String(err) });
        }
        sendJson(res, 200, { ok: true, localFirst, localOnly });
        return;
      }

      // 404 fallback
      sendJson(res, 404, { error: 'Not found', path: pathname });
    } catch (err) {
      logger.error(`[gateway] Route error ${method} ${pathname}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  // ─── WebSocket server (PTY streams) ────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WsWebSocket, ptyId: string) => {
    const onData = (id: string, data: string) => {
      if (id !== ptyId) return;
      try { ws.send(data); } catch { /* closed */ }
    };
    ptyManager.on('data', onData);

    const onExit = (id: string) => {
      if (id !== ptyId) return;
      ptyManager.off('data', onData);
      ptyManager.off('exit', onExit);
      try { ws.close(); } catch { /* already closed */ }
    };
    ptyManager.on('exit', onExit);

    ws.on('message', (msg: Buffer | string) => {
      try { ptyManager.write(ptyId, msg.toString()); } catch { /* pty gone */ }
    });

    ws.on('close', () => {
      ptyManager.off('data', onData);
      ptyManager.off('exit', onExit);
      try { ptyManager.kill(ptyId); } catch { /* already gone */ }
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const parsed2 = parseUrl(request.url ?? '/', true);
    const wsMatch = (parsed2.pathname ?? '').match(/^\/ws\/pty\/([^/]+)$/);
    if (!wsMatch) {
      socket.destroy();
      return;
    }
    const authResult = checkAuth(request, parsed2.query);
    if (!authResult.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const ptyId = wsMatch[1]!;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, ptyId);
    });
  });

  const cleanup = () => { ptyManager.killAll(); };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // ─── Controls ──────────────────────────────────────────────────────────

  /**
   * Resolve the bind port from (in priority order):
   *   1. `deps.portOverride` if provided (supports 0 for OS-assigned random port)
   *   2. `PYRFOR_PORT` environment variable (also supports 0)
   *   3. `config.gateway.port` (default 18790)
   */
  function resolveBindPort(): number {
    if (deps.portOverride !== undefined) return deps.portOverride;
    const envVal = process.env['PYRFOR_PORT'];
    if (envVal !== undefined && envVal !== '') {
      const p = parseInt(envVal, 10);
      if (!isNaN(p) && p >= 0) return p;
    }
    return config.gateway.port;
  }

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        const host = config.gateway.host ?? '127.0.0.1';
        const bindPort = resolveBindPort();

        server.once('error', reject);

        server.listen(bindPort, host, () => {
          const addr = server.address();
          const actualPort = addr && typeof addr === 'object' ? addr.port : bindPort;
          logger.info(`[gateway] Listening on ${host}:${actualPort}`, {
            auth: requireAuth ? 'bearer' : 'none',
          });
          // Signal the actual port to stdout so the sidecar manager (Rust / shell)
          // can discover the port without polling. One line, no trailing newline needed.
          process.stdout.write(`LISTENING_ON=${actualPort}\n`);
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        ptyManager.killAll();
        wss.close();
        process.off('SIGTERM', cleanup);
        process.off('SIGINT', cleanup);
        server.close(() => {
          logger.info('[gateway] Server stopped');
          resolve();
        });
      });
    },

    get port(): number {
      const addr = server.address();
      if (addr && typeof addr === 'object') return addr.port;
      return resolveBindPort();
    },
  };
}
