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
import { readFileSync, existsSync, writeFileSync as writeFileSyncNode, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { createHash, randomUUID } from 'node:crypto';
import { processPhoto } from './media/process-photo.js';
import { logger } from '../observability/logger';
import type { RuntimeConfig } from './config';
import { loadConfig, saveConfig } from './config.js';
import { providerRouter as defaultProviderRouter, type ModelEntry } from './provider-router.js';
import type { HealthMonitor, HealthSnapshot } from './health';
import type { CronService } from './cron';
import type { MemoryContinuityStatus, PyrforRuntime } from './index';
import type { DeliveryEvidenceSnapshot } from './github-delivery-evidence';
import type { OpenClawMigrationImportResult, OpenClawMigrationPreviewResult, OpenClawMigrationReport } from './openclaw-migration';
import { collectMetrics, formatMetrics } from './metrics';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { createTokenValidator, type TokenValidator } from './auth-tokens';
import { GoalStore } from './goal-store';
import type { ApprovalAuditEvent, ApprovalDecision, ApprovalFlowEvent, ApprovalRequest, ApprovalSettings, ResolvedApproval } from './approval-flow';
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
import type { ArtifactRef, ArtifactStore } from './artifact-model';
import { resolveGovernedResearchSearchProvider } from './research-search';
import type { DomainOverlayManifest, DomainOverlayRegistry } from './domain-overlay';
import type { DurableDag } from './durable-dag';
import type { EventLedger, LedgerEvent } from './event-ledger';
import type { RunLedger } from './run-ledger';
import type { RunRecord } from './run-lifecycle';
import type { ContextPack } from './context-pack';
import { listSkillCatalog, recommendSkillsPreview } from './skill-inspector';
import { createDefaultRegistry, tokenize as tokenizeSlashCommand, type ArgSchema, type SlashCommand } from './slash-commands';
import { createDefaultProductFactory, isProductFactoryTemplateId, type ProductFactoryPlanInput } from './product-factory';
import type { ConnectorInventorySnapshot, ConnectorStatus } from '../connectors';

// ─── Public API ────────────────────────────────────────────────────────────

interface PublicSlashCommandSummary {
  name: string;
  description: string;
  aliases: string[];
  argSchema?: ArgSchema;
  permissionClass: 'auto_allow';
}

function publicSlashCommandSummary(command: SlashCommand): PublicSlashCommandSummary | null {
  if (command.permissionClass !== 'auto_allow') return null;
  return {
    name: command.name,
    description: command.description,
    aliases: command.aliases ? [...command.aliases] : [],
    argSchema: command.argSchema,
    permissionClass: 'auto_allow',
  };
}

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
    getPending(): ApprovalRequest[];
    resolveDecision(id: string, decision: 'approve' | 'deny'): boolean;
    listAudit(limit?: number): unknown[];
    listAuditByRequestId?(requestId: string, limit?: number): unknown[];
    subscribe?(listener: (event: ApprovalFlowEvent) => void): () => void;
    enqueueApproval?(req: Omit<ApprovalRequest, 'id'> & { id?: string }): Promise<ApprovalRequest>;
    getResolvedApproval?(id: string): ResolvedApproval | undefined;
    consumeResolvedApproval?(id: string): ResolvedApproval | undefined;
    recordToolOutcome?(outcome: {
      requestId: string;
      toolName: string;
      summary: string;
      args: Record<string, unknown>;
      decision?: ApprovalDecision;
      resultSummary?: string;
      error?: string;
      undo?: { supported: boolean; kind?: string };
    }): void;
  };
  orchestration?: {
    runLedger?: Pick<RunLedger, 'listRuns' | 'getRun' | 'replayRun' | 'eventsForRun' | 'transition' | 'completeRun'>;
    eventLedger?: Pick<EventLedger, 'append' | 'readAll' | 'byRun' | 'subscribe'>;
    dag?: Pick<DurableDag, 'listNodes'>;
    artifactStore?: Pick<ArtifactStore, 'list'>;
    overlays?: Pick<DomainOverlayRegistry, 'list' | 'get'>;
  };
  connectorInventory?: {
    getSnapshot(): ConnectorInventorySnapshot;
    probeStatus?(connectorId: string): Promise<ConnectorStatus | null>;
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

function parseIntQuery(value: unknown, fallback: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function firstQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : undefined;
}

function isMemoryType(value: unknown): value is 'episodic' | 'semantic' | 'procedural' | 'policy' {
  return value === 'episodic' || value === 'semantic' || value === 'procedural' || value === 'policy';
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
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

async function applyRuntimeWorkspace(runtime: PyrforRuntime, workspaceRoot: string): Promise<void> {
  const setter = (runtime as unknown as { setWorkspacePath?: (path: string) => void | Promise<void> }).setWorkspacePath;
  if (typeof setter === 'function') {
    await setter.call(runtime, workspaceRoot);
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

function parseActorMailboxMessageInput(value: unknown, runId: string): {
  spawn?: Parameters<PyrforRuntime['spawnActor']>[0];
  message: Parameters<PyrforRuntime['enqueueActorMessage']>[0];
} | null {
  const body = recordValue(value);
  if (!body) return null;
  const actorId = textValue(body['actorId']);
  const task = textValue(body['task']);
  if (!actorId || !task) return null;
  const payload = body['payload'] === undefined ? undefined : recordValue(body['payload']);
  if (body['payload'] !== undefined && !payload) return null;
  const priority = numberValue(body['priority']);
  const idempotencyKey = textValue(body['idempotencyKey']);
  const allowConcurrent = booleanValue(body['allowConcurrent']);
  const message: Parameters<PyrforRuntime['enqueueActorMessage']>[0] = {
    runId,
    actorId,
    task,
    ...(payload ? { payload } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(allowConcurrent !== undefined ? { allowConcurrent } : {}),
  };
  const agentId = textValue(body['agentId']);
  if (!agentId) return { message };
  return {
    spawn: {
      runId,
      actorId,
      agentId,
      ...(textValue(body['agentName']) ? { agentName: textValue(body['agentName']) } : {}),
      ...(textValue(body['role']) ? { role: textValue(body['role']) } : {}),
      ...(textValue(body['parentActorId']) ? { parentActorId: textValue(body['parentActorId']) } : {}),
      ...(textValue(body['goal']) ? { goal: textValue(body['goal']) } : {}),
    },
    message,
  };
}

function parseActorLeaseInput(value: unknown, runId: string, owner: string): Parameters<PyrforRuntime['leaseActorMessage']>[0] | null {
  const body = recordValue(value);
  if (!body) return null;
  const ttlMs = numberValue(body['ttlMs']);
  if (ttlMs !== undefined && ttlMs <= 0) return null;
  return {
    runId,
    owner,
    ...(textValue(body['actorId']) ? { actorId: textValue(body['actorId']) } : {}),
    ...(ttlMs !== undefined ? { ttlMs } : {}),
  };
}

function parseActorDispatchInput(value: unknown, runId: string, owner: string): Parameters<PyrforRuntime['dispatchNextActorMessage']>[0] | null {
  const body = recordValue(value);
  if (!body) return null;
  const ttlMs = numberValue(body['ttlMs']);
  if (ttlMs !== undefined && ttlMs <= 0) return null;
  const maxTokens = numberValue(body['maxTokens']);
  if (maxTokens !== undefined && maxTokens <= 0) return null;
  return {
    runId,
    owner,
    ...(textValue(body['actorId']) ? { actorId: textValue(body['actorId']) } : {}),
    ...(ttlMs !== undefined ? { ttlMs } : {}),
    ...(textValue(body['instruction']) ? { instruction: textValue(body['instruction']) } : {}),
    ...(textValue(body['systemPrompt']) ? { systemPrompt: textValue(body['systemPrompt']) } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
}

function parseRecoverStuckActorsInput(value: unknown, runId: string): Parameters<PyrforRuntime['recoverStuckActorMessages']>[0] | null {
  const body = recordValue(value);
  if (!body) return null;
  const olderThanMs = numberValue(body['olderThanMs']);
  if (olderThanMs === undefined || olderThanMs <= 0) return null;
  return {
    runId,
    olderThanMs,
    ...(textValue(body['actorId']) ? { actorId: textValue(body['actorId']) } : {}),
    ...(textValue(body['reason']) ? { reason: textValue(body['reason']) } : {}),
  };
}

function parseResearchEvidenceInput(value: unknown): Parameters<PyrforRuntime['createRunResearchEvidence']>[1] | null {
  const body = recordValue(value);
  if (!body) return null;
  const query = textValue(body['query']);
  const sources = Array.isArray(body['sources']) ? body['sources'].map(recordValue) : [];
  if (!query || sources.length === 0 || sources.some((source) => !source || !textValue(source['url']))) return null;
  const notes = Array.isArray(body['notes'])
    ? body['notes'].filter((item): item is string => typeof item === 'string')
    : undefined;
  return {
    query,
    sources: sources.map((source) => ({
      url: textValue(source!['url'])!,
      ...(textValue(source!['title']) ? { title: textValue(source!['title']) } : {}),
      ...(textValue(source!['snippet']) ? { snippet: textValue(source!['snippet']) } : {}),
      ...(textValue(source!['citation']) ? { citation: textValue(source!['citation']) } : {}),
      ...(textValue(source!['observedAt']) ? { observedAt: textValue(source!['observedAt']) } : {}),
    })),
    ...(textValue(body['summary']) ? { summary: textValue(body['summary']) } : {}),
    ...(textValue(body['conclusion']) ? { conclusion: textValue(body['conclusion']) } : {}),
    ...(notes ? { notes } : {}),
  };
}

function parseResearchSearchInput(value: unknown): (Parameters<PyrforRuntime['captureRunResearchSearch']>[1] & { approvalId?: string }) | null {
  const body = recordValue(value);
  if (!body) return null;
  const query = textValue(body['query']);
  if (!query) return null;
  const maxResults = numberValue(body['maxResults']);
  if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults <= 0 || maxResults > 5)) return null;
  const provider = textValue(body['provider']);
  if (provider !== undefined && provider !== 'brave' && provider !== 'duckduckgo') return null;
  const notes = Array.isArray(body['notes'])
    ? body['notes'].filter((item): item is string => typeof item === 'string')
    : undefined;
  return {
    query,
    ...(maxResults !== undefined ? { maxResults } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(textValue(body['approvalId']) ? { approvalId: textValue(body['approvalId']) } : {}),
    ...(notes ? { notes } : {}),
  } as Parameters<PyrforRuntime['captureRunResearchSearch']>[1] & { approvalId?: string };
}

function parseActorCompleteInput(value: unknown, runId: string, nodeId: string, owner: string): Parameters<PyrforRuntime['completeActorMessage']>[0] | null {
  const body = recordValue(value);
  if (!body) return null;
  const proof = body['proof'] === undefined ? undefined : recordValue(body['proof']);
  if (body['proof'] !== undefined && !proof) return null;
  return {
    runId,
    nodeId,
    owner,
    ...(textValue(body['output']) ? { output: textValue(body['output']) } : {}),
    ...(textValue(body['summary']) ? { summary: textValue(body['summary']) } : {}),
    ...(proof ? { proof } : {}),
  };
}

function parseActorFailInput(value: unknown, runId: string, nodeId: string, owner: string): Parameters<PyrforRuntime['failActorMessage']>[0] | null {
  const body = recordValue(value);
  if (!body) return null;
  const reason = textValue(body['reason']);
  if (!reason) return null;
  return {
    runId,
    nodeId,
    owner,
    reason,
    ...(typeof body['retryable'] === 'boolean' ? { retryable: body['retryable'] } : {}),
  };
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
    type.startsWith('actor.') ||
    type.startsWith('verifier.') ||
    type.startsWith('eval.') ||
    type === 'artifact.created' ||
    type === 'test.completed'
  );
}

interface ActorSnapshotActor {
  actorId: string;
  parentActorId?: string;
  agentId?: string;
  agentName?: string;
  role?: string;
  status: 'idle' | 'running' | 'blocked' | 'failed' | 'completed' | 'unknown';
  currentWork?: string;
  outputs: string[];
  blockers: string[];
  mailbox: {
    pending: number;
    leased: number;
    completed: number;
    failed: number;
    stale?: number;
    oldestLeasedAgeMs?: number;
    oldestPendingAgeMs?: number;
  };
  budget?: {
    profile?: string;
    tokensUsed?: number;
    tokenLimit?: number;
    toolCallsUsed?: number;
    toolCallLimit?: number;
    exhausted?: boolean;
  };
  updatedAt?: string;
}

interface ActorSnapshot {
  runId: string;
  actors: ActorSnapshotActor[];
  totals: {
    actors: number;
    running: number;
    blocked: number;
    failed: number;
    mailboxPending: number;
    mailboxStale?: number;
    oldestPendingAgeMs?: number;
    oldestLeasedAgeMs?: number;
  };
}

interface ActorSnapshotOptions {
  staleAfterMs?: number;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function appendActorOutput(actor: ActorSnapshotActor, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    actor.outputs.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    actor.outputs.push(...value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()));
  }
}

function getOrCreateActor(actors: Map<string, ActorSnapshotActor>, actorId: string): ActorSnapshotActor {
  const existing = actors.get(actorId);
  if (existing) return existing;
  const actor: ActorSnapshotActor = {
    actorId,
    status: 'unknown',
    outputs: [],
    blockers: [],
    mailbox: { pending: 0, leased: 0, completed: 0, failed: 0 },
  };
  actors.set(actorId, actor);
  return actor;
}

async function buildActorSnapshot(orchestration: OrchestrationDeps | undefined, runId: string, options: ActorSnapshotOptions = {}): Promise<ActorSnapshot> {
  const actors = new Map<string, ActorSnapshotActor>();
  const now = Date.now();
  const staleAfterMs = options.staleAfterMs && options.staleAfterMs > 0 ? options.staleAfterMs : undefined;
  const actorMailboxNodes = (orchestration?.dag?.listNodes() ?? [])
    .filter((node) => nodeBelongsToRun(node, runId) && node.kind.startsWith('actor.mailbox.'));
  const actorMailboxNodeIds = new Set(actorMailboxNodes.map((node) => node.id));
  const run = await getRunRecord(orchestration, runId);
  if (run) {
    const root = getOrCreateActor(actors, `run:${run.run_id}`);
    root.agentName = 'Run supervisor';
    root.role = run.mode;
    root.status = run.status === 'running' ? 'running'
      : run.status === 'blocked' ? 'blocked'
      : run.status === 'failed' ? 'failed'
      : run.status === 'completed' ? 'completed'
      : 'idle';
    root.currentWork = textValue((run as unknown as Record<string, unknown>)['goal']) ?? run.task_id;
    root.updatedAt = run.updated_at;
    const budgetProfile = textValue(run.budget_profile);
    if (budgetProfile) root.budget = { profile: budgetProfile };
  }
  const events = await listRunEvents(orchestration, runId);
  for (const event of events) {
    const payload = event as unknown as Record<string, unknown>;
    const actorId = textValue(payload['actor_id']) ?? textValue(payload['actorId']) ?? textValue(payload['agent_id']) ?? textValue(payload['agentId']);
    if (!actorId) continue;
    const actor = getOrCreateActor(actors, actorId);
    actor.updatedAt = textValue(payload['ts']) ?? textValue(payload['created_at']) ?? actor.updatedAt;
    actor.agentId = textValue(payload['agent_id']) ?? textValue(payload['agentId']) ?? actor.agentId;
    actor.agentName = textValue(payload['agent_name']) ?? textValue(payload['agentName']) ?? actor.agentName;
    actor.role = textValue(payload['role']) ?? actor.role;
    actor.parentActorId = textValue(payload['parent_actor_id']) ?? textValue(payload['parentActorId']) ?? actor.parentActorId;
    const eventType = textValue(payload['type']) ?? '';
    const mailboxNodeId = textValue(payload['node_id']) ?? textValue(payload['nodeId']);
    const dagBackedMailboxEvent = mailboxNodeId ? actorMailboxNodeIds.has(mailboxNodeId) : false;
    if (eventType === 'actor.spawned') actor.status = 'idle';
    if (eventType === 'actor.mailbox.enqueued' && !dagBackedMailboxEvent) actor.mailbox.pending += 1;
    if (eventType === 'actor.mailbox.leased') {
      if (!dagBackedMailboxEvent) {
        actor.mailbox.pending = Math.max(0, actor.mailbox.pending - 1);
        actor.mailbox.leased += 1;
      }
      actor.status = 'running';
    }
    if (eventType === 'actor.mailbox.completed') {
      if (!dagBackedMailboxEvent) {
        actor.mailbox.leased = Math.max(0, actor.mailbox.leased - 1);
        actor.mailbox.completed += 1;
      }
    }
    if (eventType === 'actor.mailbox.failed') {
      if (!dagBackedMailboxEvent) {
        actor.mailbox.leased = Math.max(0, actor.mailbox.leased - 1);
        actor.mailbox.failed += 1;
      }
      if (payload['retryable'] === true) {
        if (!dagBackedMailboxEvent) actor.mailbox.pending += 1;
        actor.status = 'idle';
      } else {
        actor.status = 'failed';
      }
    }
    if (eventType === 'actor.work.started') actor.status = 'running';
    if (eventType === 'actor.work.completed') actor.status = 'completed';
    if (eventType === 'actor.blocked') actor.status = 'blocked';
    if (eventType === 'actor.failed') actor.status = 'failed';
    actor.currentWork = textValue(payload['current_work']) ?? textValue(payload['currentWork']) ?? textValue(payload['task']) ?? actor.currentWork;
    appendActorOutput(actor, payload['summary']);
    appendActorOutput(actor, payload['output']);
    appendActorOutput(actor, payload['highlights']);
    const blocker = textValue(payload['blocker']) ?? textValue(payload['reason']) ?? textValue(payload['error']);
    if (blocker && (actor.status === 'blocked' || actor.status === 'failed')) actor.blockers.push(blocker);
    const budget = recordValue(payload['budget']);
    if (budget) {
      actor.budget = {
        profile: textValue(budget['profile']) ?? actor.budget?.profile,
        tokensUsed: numberValue(budget['tokensUsed']) ?? actor.budget?.tokensUsed,
        tokenLimit: numberValue(budget['tokenLimit']) ?? actor.budget?.tokenLimit,
        toolCallsUsed: numberValue(budget['toolCallsUsed']) ?? actor.budget?.toolCallsUsed,
        toolCallLimit: numberValue(budget['toolCallLimit']) ?? actor.budget?.toolCallLimit,
        exhausted: typeof budget['exhausted'] === 'boolean' ? budget['exhausted'] : actor.budget?.exhausted,
      };
    }
  }
  for (const node of actorMailboxNodes) {
    const actorId = textValue(node.payload?.['actorId']) ?? textValue(node.payload?.['actor_id']) ?? 'unknown';
    const actor = getOrCreateActor(actors, actorId);
    if (node.status === 'pending' || node.status === 'ready') {
      actor.mailbox.pending += 1;
      const pendingAgeMs = Math.max(0, now - node.updatedAt);
      actor.mailbox.oldestPendingAgeMs = Math.max(actor.mailbox.oldestPendingAgeMs ?? 0, pendingAgeMs);
    }
    if (node.status === 'leased' || node.status === 'running') actor.mailbox.leased += 1;
    if (staleAfterMs !== undefined && (node.status === 'leased' || node.status === 'running')) {
      const leasedAgeMs = now - (node.lease?.leasedAt ?? node.updatedAt);
      if (leasedAgeMs >= staleAfterMs) {
        actor.mailbox.stale = (actor.mailbox.stale ?? 0) + 1;
        actor.mailbox.oldestLeasedAgeMs = Math.max(actor.mailbox.oldestLeasedAgeMs ?? 0, leasedAgeMs);
      }
    }
    if (node.status === 'succeeded') actor.mailbox.completed += 1;
    if (node.status === 'failed') actor.mailbox.failed += 1;
  }
  const items = [...actors.values()]
    .map((actor) => ({
      ...actor,
      status: actor.status === 'completed' && (actor.mailbox.pending > 0 || actor.mailbox.leased > 0)
        ? actor.mailbox.leased > 0 ? 'running' as const : 'idle' as const
        : actor.status === 'running' && actor.mailbox.leased === 0 && actor.mailbox.pending > 0
          ? 'idle' as const
        : actor.status,
    }))
    .map((actor) => ({
      ...actor,
      outputs: [...new Set(actor.outputs)].slice(-5),
      blockers: [...new Set(actor.blockers)].slice(-5),
    }))
    .sort((a, b) => a.actorId.localeCompare(b.actorId));
  const mailboxPending = items.reduce((sum, actor) => sum + actor.mailbox.pending, 0);
  const oldestPendingAgeMs = items.reduce<number | undefined>((oldest, actor) => {
    if (actor.mailbox.pending <= 0 || actor.mailbox.oldestPendingAgeMs === undefined) return oldest;
    return Math.max(oldest ?? 0, actor.mailbox.oldestPendingAgeMs);
  }, undefined);
  const mailboxStale = staleAfterMs !== undefined
    ? items.reduce((sum, actor) => sum + (actor.mailbox.stale ?? 0), 0)
    : undefined;
  const oldestLeasedAgeMs = staleAfterMs !== undefined
    ? items.reduce<number | undefined>((oldest, actor) => {
        if (!actor.mailbox.stale || actor.mailbox.oldestLeasedAgeMs === undefined) return oldest;
        return Math.max(oldest ?? 0, actor.mailbox.oldestLeasedAgeMs);
      }, undefined)
    : undefined;
  return {
    runId,
    actors: items,
    totals: {
      actors: items.length,
      running: items.filter((actor) => actor.status === 'running').length,
      blocked: items.filter((actor) => actor.status === 'blocked').length,
      failed: items.filter((actor) => actor.status === 'failed').length,
      mailboxPending,
      ...(mailboxPending > 0 && oldestPendingAgeMs !== undefined ? { oldestPendingAgeMs } : {}),
      ...(mailboxStale !== undefined ? { mailboxStale } : {}),
      ...(mailboxStale && oldestLeasedAgeMs !== undefined ? { oldestLeasedAgeMs } : {}),
    },
  };
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

async function listPendingEffects(orchestration: OrchestrationDeps | undefined): Promise<Array<Record<string, unknown>>> {
  const events = orchestration?.eventLedger ? await orchestration.eventLedger.readAll() : [];
  const proposed = new Map<string, Extract<LedgerEvent, { type: 'effect.proposed' }>>();
  const policy = new Map<string, Extract<LedgerEvent, { type: 'effect.policy_decided' }>>();
  const settled = new Set<string>();

  for (const event of events.filter(isOrchestrationEvent)) {
    if (event.type === 'effect.proposed') proposed.set(event.effect_id, event);
    if (event.type === 'effect.policy_decided') policy.set(event.effect_id, event);
    if (event.type === 'effect.applied' || event.type === 'effect.denied' || event.type === 'effect.failed') {
      settled.add(event.effect_id);
    }
  }

  return Array.from(proposed.values())
    .filter((event) => !settled.has(event.effect_id))
    .map((event) => {
      const verdict = policy.get(event.effect_id);
      return {
        id: event.effect_id,
        effect_id: event.effect_id,
        run_id: event.run_id,
        effect_kind: event.effect_kind,
        tool: event.tool,
        preview: event.preview,
        idempotency_key: event.idempotency_key,
        proposed_event_id: event.id,
        proposed_seq: event.seq,
        ts: event.ts,
        decision: verdict?.decision,
        policy_id: verdict?.policy_id,
        reason: verdict?.reason,
        approval_required: verdict?.approval_required,
      };
    })
    .sort((a, b) => Number(a.proposed_seq ?? 0) - Number(b.proposed_seq ?? 0));
}

async function buildOrchestrationDashboard(
  orchestration: OrchestrationDeps | undefined,
  approvalsPending = 0,
): Promise<Record<string, unknown>> {
  const runs = orchestration?.runLedger?.listRuns() ?? [];
  const nodes = orchestration?.dag?.listNodes() ?? [];
  const events = orchestration?.eventLedger ? await orchestration.eventLedger.readAll() : [];
  const kernelEvents = events.filter(isOrchestrationEvent);
  const pendingEffects = await listPendingEffects(orchestration);
  const contextPacks = orchestration?.artifactStore
    ? await orchestration.artifactStore.list({ kind: 'context_pack' })
    : [];
  const overlays = orchestration?.overlays?.list() ?? [];
  const verifierEvents = kernelEvents.filter((event) => event.type === 'verifier.completed' || event.type === 'verifier.waived');
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
      pending: pendingEffects.length,
    },
    approvals: {
      pending: approvalsPending,
    },
    verifier: {
      blocked: verifierEvents.filter((event) => event.status === 'blocked' || event.status === 'failed').length,
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

function buildConnectorProbeApprovalId(connectorId: string): string {
  return `connector-live-probe:${connectorId}`;
}

function buildResearchSearchApprovalId(runId: string, query: string, maxResults: number, provider: string): string {
  const digest = createHash('sha256').update(`${runId}:${query.trim()}:${maxResults}:${provider}`).digest('hex').slice(0, 24);
  return `research-search:${digest}`;
}

function hashResearchSearchQuery(query: string): string {
  return createHash('sha256').update(query.trim()).digest('hex');
}

function publicArtifactRef(ref: ArtifactRef): Omit<ArtifactRef, 'uri'> {
  const { uri: _uri, ...publicRef } = ref;
  return publicRef;
}

interface PublicDomainOverlay {
  schemaVersion: DomainOverlayManifest['schemaVersion'];
  domainId: string;
  version: string;
  title: string;
  workflowCount: number;
  adapterCount: number;
  privacyRuleIds: string[];
  toolPermissionSummaries: string[];
}

function publicDomainOverlay(manifest: DomainOverlayManifest): PublicDomainOverlay {
  return {
    schemaVersion: manifest.schemaVersion,
    domainId: manifest.domainId,
    version: manifest.version,
    title: manifest.title,
    workflowCount: manifest.workflowTemplates?.length ?? 0,
    adapterCount: manifest.adapterRegistrations?.length ?? 0,
    privacyRuleIds: (manifest.privacyRules ?? []).map((rule) => rule.id).filter(Boolean).sort(),
    toolPermissionSummaries: Object.entries(manifest.toolPermissionOverrides ?? {})
      .map(([toolName, permission]) => `${toolName}:${permission}`)
      .sort(),
  };
}

function publicContinuityArtifactRef(ref: ArtifactRef): Omit<ArtifactRef, 'uri'> {
  const publicRef = publicArtifactRef(ref);
  const safeMeta = Object.fromEntries(Object.entries(publicRef.meta ?? {}).filter(([key]) => key !== 'workspaceId'));
  return {
    ...publicRef,
    ...(Object.keys(safeMeta).length > 0 ? { meta: sanitizeTrustPayload(safeMeta) as Record<string, unknown> } : {}),
  };
}

function publicDeliveryEvidenceResponse(
  evidence: { artifact: ArtifactRef; snapshot: DeliveryEvidenceSnapshot } | null,
): { artifact: Omit<ArtifactRef, 'uri'> | null; snapshot: DeliveryEvidenceSnapshot | null } {
  if (!evidence) return { artifact: null, snapshot: null };
  return {
    artifact: publicArtifactRef(evidence.artifact),
    snapshot: publicDeliveryEvidenceSnapshot(evidence.snapshot),
  };
}

function publicDeliveryEvidenceSnapshot(snapshot: DeliveryEvidenceSnapshot): DeliveryEvidenceSnapshot {
  const publicSnapshot = sanitizeTrustPayload(snapshot);
  const remote = publicSnapshot.git.remote;
  if (remote?.url && (remote.url.startsWith('file:') || remote.url.includes('[redacted-path]') || !remote.repository)) {
    return {
      ...publicSnapshot,
      git: {
        ...publicSnapshot.git,
        remote: null,
      },
    };
  }
  return publicSnapshot;
}

function publicGithubDeliveryPlanResponse(
  plan: { artifact: ArtifactRef; plan: unknown; evidenceArtifact?: ArtifactRef } | null,
): { artifact: Omit<ArtifactRef, 'uri'> | null; plan: unknown; evidenceArtifact?: Omit<ArtifactRef, 'uri'> } {
  if (!plan) return { artifact: null, plan: null };
  return {
    ...plan,
    artifact: publicArtifactRef(plan.artifact),
    plan: sanitizeTrustPayload(plan.plan),
    ...(plan.evidenceArtifact ? { evidenceArtifact: publicArtifactRef(plan.evidenceArtifact) } : {}),
  };
}

function publicGithubDeliveryApplyState(
  apply: { artifact: ArtifactRef; result: unknown } | null,
): { artifact: Omit<ArtifactRef, 'uri'> | null; result: unknown } {
  if (!apply) return { artifact: null, result: null };
  return {
    ...apply,
    artifact: publicArtifactRef(apply.artifact),
  };
}

function sanitizeHealthValue(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return SENSITIVE_METADATA_KEY_RE.test(key) ? '[redacted]' : redactSensitiveText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return redactSensitiveText(value.toString());
  if (Array.isArray(value)) return value.map((entry) => sanitizeHealthValue(entry, key));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return redactSensitiveText(String(value));
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeHealthValue(entryValue, entryKey),
    ]));
  }
  return value;
}

function publicHealthSnapshot(snapshot: HealthSnapshot): HealthSnapshot {
  return sanitizeHealthValue(snapshot) as HealthSnapshot;
}

function publicGithubDeliveryApplyResponse(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response;
  const candidate = response as { status?: unknown; artifact?: unknown; result?: unknown };
  if (candidate.status !== 'applied' || !candidate.artifact || typeof candidate.artifact !== 'object') return response;
  return {
    ...candidate,
    artifact: publicArtifactRef(candidate.artifact as ArtifactRef),
  };
}

function publicMemoryContinuityStatus(status: MemoryContinuityStatus): MemoryContinuityStatus {
  const publicStatus = {
    ...status,
    workspaceId: 'current-workspace',
    latestDailyRollup: {
      ...status.latestDailyRollup,
      ...(status.latestDailyRollup.artifact ? { artifact: publicContinuityArtifactRef(status.latestDailyRollup.artifact) } : {}),
    },
    latestProjectRollup: {
      ...status.latestProjectRollup,
      ...(status.latestProjectRollup.artifact ? { artifact: publicContinuityArtifactRef(status.latestProjectRollup.artifact) } : {}),
    },
    latestOpenClawReport: {
      ...status.latestOpenClawReport,
      ...(status.latestOpenClawReport.artifact ? { artifact: publicContinuityArtifactRef(status.latestOpenClawReport.artifact) } : {}),
    },
  };
  return publicStatus as MemoryContinuityStatus;
}

function publicMemorySearchResponse(result: Awaited<ReturnType<PyrforRuntime['searchMemory']>>) {
  return {
    ...result,
    workspaceId: 'current-workspace',
    results: result.results.map((hit) => {
      const { workspaceId: _workspaceId, ...publicHit } = hit;
      return publicHit;
    }),
  };
}

function publicOpenClawMigrationReport(report: OpenClawMigrationReport): OpenClawMigrationReport {
  return {
    ...sanitizeTrustPayload(report),
    workspaceId: 'current-workspace',
    sourceRoot: 'openclaw-source',
  };
}

function publicOpenClawMigrationPreviewResponse(
  result: OpenClawMigrationPreviewResult,
): { artifact: Omit<ArtifactRef, 'uri'>; report: OpenClawMigrationReport } {
  return {
    artifact: publicContinuityArtifactRef(result.artifact),
    report: publicOpenClawMigrationReport(result.report),
  };
}

function publicOpenClawMigrationImportResult(
  result: OpenClawMigrationImportResult,
): Omit<OpenClawMigrationImportResult, 'artifact'> & { artifact: Omit<ArtifactRef, 'uri'> } {
  return {
    ...result,
    artifact: publicContinuityArtifactRef(result.artifact),
  };
}

const MAX_CONTEXT_SECTION_CONTENT_CHARS = 600;

function compactPublicContextContent(value: unknown): string {
  let raw: string;
  try {
    raw = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    raw = String(value);
  }
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  return singleLine.length <= MAX_CONTEXT_SECTION_CONTENT_CHARS
    ? singleLine
    : `${singleLine.slice(0, MAX_CONTEXT_SECTION_CONTENT_CHARS - 1)}…`;
}

function publicContextPack(pack: ContextPack): ContextPack {
  return {
    ...pack,
    task: {
      ...pack.task,
      title: compactPublicContextContent(pack.task.title),
      ...(pack.task.description ? { description: compactPublicContextContent(pack.task.description) } : {}),
      ...(pack.task.acceptanceCriteria ? { acceptanceCriteria: pack.task.acceptanceCriteria.map((item) => compactPublicContextContent(item)) } : {}),
      ...(pack.task.constraints ? { constraints: pack.task.constraints.map((item) => compactPublicContextContent(item)) } : {}),
      ...(pack.task.nonGoals ? { nonGoals: pack.task.nonGoals.map((item) => compactPublicContextContent(item)) } : {}),
    },
    sections: pack.sections.map((section) => ({
      ...section,
      content: compactPublicContextContent(section.content),
    })),
  };
}

const SENSITIVE_KEY_PATTERN = '(?:token|secret|password|passwd|credential|signature|api[_-]?key|access[_-]?key|awsaccesskeyid|key[_-]?pair[_-]?id|(?:access|refresh|id|client|api|private|secret|auth|github|session)[A-Za-z0-9_.-]*(?:token|secret|password|passwd|credential|signature|key)|[A-Za-z0-9]+(?:[_-](?:token|secret|password|passwd|credential|signature|api[_-]?key|access[_-]?key|key))+[A-Za-z0-9_-]*)';
const SENSITIVE_METADATA_KEY_RE = new RegExp(`^(?:authorization|auth|${SENSITIVE_KEY_PATTERN})$`, 'i');
const URL_METADATA_KEY_RE = /(url|uri|endpoint)/i;
const SENSITIVE_QUERY_KEY_RE = /(token|secret|password|passwd|credential|authorization|auth|api[_-]?key|access[_-]?key|signature|sig|awsaccesskeyid|key[_-]?pair[_-]?id)/i;
const URL_TEXT_RE = /\bhttps?:\/\/[^\s<>"'`)]+/g;
const FILE_URL_TEXT_RE = /\bfile:\/\/[^\s<>"'`)]+/g;
const LOCAL_PATH_TEXT_RE = /(^|[\s([{:=<>"'`-])(\/(?!\/)[^\s<>"'`)]+)/g;
const AUTH_ASSIGNMENT_RE = /((?:"|')?\bauthorization\b(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\n;]+)/gi;
const SECRET_ASSIGNMENT_RE = new RegExp(`((?:"|')?\\b${SENSITIVE_KEY_PATTERN}\\b(?:"|')?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|\`[^\`]*\`|[^\\s,;}\\]]+)`, 'gi');
const AUTH_HEADER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = 'redacted';
    if (url.password) url.password = 'redacted';
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY_RE.test(key)) {
        url.searchParams.set(key, 'redacted');
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return '[redacted-url]';
  }
}

function redactSensitiveText(value: string): string {
  let redacted = value
    .replace(URL_TEXT_RE, (url) => sanitizeUrl(url))
    .replace(FILE_URL_TEXT_RE, 'file://[redacted-path]')
    .replace(LOCAL_PATH_TEXT_RE, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(AUTH_ASSIGNMENT_RE, (_match, prefix: string) => `${prefix}[redacted]`)
    .replace(SECRET_ASSIGNMENT_RE, (_match, prefix: string) => `${prefix}[redacted]`)
    .replace(AUTH_HEADER_RE, (match) => `${match.startsWith('Basic') ? 'Basic' : 'Bearer'} [redacted]`);
  for (const [key, rawEnvValue] of Object.entries(process.env)) {
    const envValue = rawEnvValue?.trim();
    if (!envValue || envValue.length < 8 || !SENSITIVE_METADATA_KEY_RE.test(key)) continue;
    redacted = redacted.replace(new RegExp(escapeRegExp(envValue), 'g'), '[redacted]');
  }
  return redacted;
}

function sanitizeConnectorMetadata(
  metadata?: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
    if (typeof value !== 'string') return [key, value] as const;
    if (SENSITIVE_METADATA_KEY_RE.test(key)) return [key, '[redacted]'] as const;
    if (URL_METADATA_KEY_RE.test(key)) return [key, redactSensitiveText(value)] as const;
    return [key, redactSensitiveText(value)] as const;
  }));
}

function sanitizeConnectorStatus(status: ConnectorStatus): ConnectorStatus {
  return {
    ...status,
    message: redactSensitiveText(status.message),
    metadata: sanitizeConnectorMetadata(status.metadata),
  };
}

function sanitizeTrustValue(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return SENSITIVE_METADATA_KEY_RE.test(key) ? '[redacted]' : redactSensitiveText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeTrustValue(entry, key));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeTrustValue(entryValue, entryKey),
    ]));
  }
  return value;
}

function sanitizeTrustRecord<T extends Record<string, unknown>>(record: T): T {
  return sanitizeTrustValue(record) as T;
}

function sanitizeTrustPayload<T>(payload: T): T {
  return sanitizeTrustValue(payload) as T;
}

function sanitizeApprovalRequest(request: ApprovalRequest): ApprovalRequest {
  return {
    ...request,
    summary: redactSensitiveText(request.summary),
    args: sanitizeTrustRecord(request.args),
    reason: request.reason ? redactSensitiveText(request.reason) : request.reason,
  };
}

function sanitizeApprovalAuditEvent(event: ApprovalAuditEvent): ApprovalAuditEvent {
  return {
    ...event,
    summary: redactSensitiveText(event.summary),
    args: sanitizeTrustRecord(event.args),
    resultSummary: event.resultSummary ? redactSensitiveText(event.resultSummary) : event.resultSummary,
    error: event.error ? redactSensitiveText(event.error) : event.error,
    reason: event.reason ? redactSensitiveText(event.reason) : event.reason,
  };
}

function sanitizeApprovalFlowEvent(event: ApprovalFlowEvent): ApprovalFlowEvent {
  if (event.type === 'approval-audit') {
    return { ...event, event: sanitizeApprovalAuditEvent(event.event) };
  }
  return { ...event, request: sanitizeApprovalRequest(event.request) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  function checkAuth(req: IncomingMessage, query?: Record<string, unknown>): { ok: boolean; reason?: 'unknown' | 'expired'; label?: string } {
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

  function authenticatedActorOwner(
    req: IncomingMessage,
    res: ServerResponse,
    body: Record<string, unknown>,
    query?: Record<string, unknown>,
  ): string | null {
    const authResult = checkAuth(req, query);
    if (!authResult.ok) {
      sendUnauthorized(res, authResult.reason ?? 'unknown');
      return null;
    }
    const owner = requireAuth
      ? `token:${authResult.label ?? 'authenticated'}`
      : textValue(body['owner']) ?? 'operator';
    const requestedOwner = textValue(body['owner']);
    if (requireAuth && requestedOwner && requestedOwner !== owner) {
      sendJson(res, 403, { error: 'owner_mismatch' });
      return null;
    }
    return owner;
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
        prefer?: 'local' | 'cloud' | 'auto';
        routingHints?: { contextSizeChars?: number; sensitive?: boolean };
        exposeToolPayloads?: boolean;
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
    let prefer: 'local' | 'cloud' | 'auto' | undefined;
    let routingHints: { contextSizeChars?: number; sensitive?: boolean } | undefined;
    let exposeToolPayloads: boolean | undefined;
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
      else if (p.name === 'prefer') {
        if (value === 'local' || value === 'cloud' || value === 'auto') prefer = value;
      }
      else if (p.name === 'routingHints') {
        const parsedJson = tryParseJson(value);
        if (parsedJson.ok && parsedJson.value && typeof parsedJson.value === 'object' && !Array.isArray(parsedJson.value)) {
          const rawHints = parsedJson.value as { contextSizeChars?: unknown; sensitive?: unknown };
          const nextHints: { contextSizeChars?: number; sensitive?: boolean } = {};
          if (typeof rawHints.contextSizeChars === 'number' && Number.isFinite(rawHints.contextSizeChars)) {
            nextHints.contextSizeChars = rawHints.contextSizeChars;
          }
          if (typeof rawHints.sensitive === 'boolean') nextHints.sensitive = rawHints.sensitive;
          if (Object.keys(nextHints).length > 0) routingHints = nextHints;
        }
      }
      else if (p.name === 'exposeToolPayloads') exposeToolPayloads = value === 'true';
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

    return { ok: true, text, openFiles, workspace, sessionId, prefer, routingHints, exposeToolPayloads, attachments };
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
      sendJson(res, status, snapshot ? publicHealthSnapshot(snapshot) : { status: 'unknown' });
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
          orchestration: sanitizeTrustPayload(await buildOrchestrationDashboard(orchestration, approvals.getPending().length)),
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Internal server error' });
      }
      return;
    }

    if (pathname === '/api/connectors/inventory' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      const snapshot = deps.connectorInventory?.getSnapshot();
      if (!snapshot) {
        sendJson(res, 501, { error: 'connector_inventory_unavailable' });
        return;
      }
      sendJson(res, 200, snapshot);
      return;
    }

    if (pathname === '/api/skills' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      sendJson(res, 200, listSkillCatalog());
      return;
    }

    if (pathname === '/api/slash-commands' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      const commands = createDefaultRegistry()
        .list()
        .map(publicSlashCommandSummary)
        .filter((command): command is PublicSlashCommandSummary => Boolean(command));
      sendJson(res, 200, { commands });
      return;
    }

    if (pathname === '/api/slash-commands/invoke' && method === 'POST') {
      if (!enforceAuth(req, res, query)) return;
      const raw = await readBody(req);
      const parsed = raw.trim() ? tryParseJson(raw) : { ok: false as const };
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      const body = parsed.value as Record<string, unknown>;
      const scopeOverrideKeys = ['workspaceId', 'sessionId', 'runId'].filter((key) => Object.prototype.hasOwnProperty.call(body, key));
      if (scopeOverrideKeys.length > 0) {
        sendJson(res, 400, { error: 'scope_override_not_allowed', fields: scopeOverrideKeys });
        return;
      }
      const commandLine = typeof body.command === 'string' ? body.command.trim() : '';
      if (!commandLine) {
        sendJson(res, 400, { error: 'invalid_slash_command' });
        return;
      }
      const firstToken = tokenizeSlashCommand(commandLine)[0] ?? '';
      const commandName = firstToken.startsWith('/') ? firstToken.slice(1) : firstToken;
      const registry = createDefaultRegistry();
      const command = registry.get(commandName);
      if (!command || command.name !== 'skills' || command.permissionClass !== 'auto_allow') {
        sendJson(res, 403, { error: 'slash_command_not_exposed', command: commandName || null });
        return;
      }
      const result = await registry.invoke(commandLine, {
        workspaceId: 'gateway',
        sessionId: 'slash-command',
        ledger: deps.orchestration?.eventLedger,
      });
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }

    if (pathname === '/api/skills/recommend' && method === 'POST') {
      if (!enforceAuth(req, res, query)) return;
      const raw = await readBody(req);
      const parsed = raw.trim() ? tryParseJson(raw) : { ok: false as const };
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      try {
        sendJson(res, 200, recommendSkillsPreview(parsed.value));
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid_skill_recommend_request' });
      }
      return;
    }

    const connectorProbeMatch = pathname.match(/^\/api\/connectors\/([^/]+)\/probe$/);
    if (connectorProbeMatch && method === 'POST') {
      if (!enforceAuth(req, res, query)) return;
      const connectorId = decodeURIComponent(connectorProbeMatch[1]!);
      const connectors = deps.connectorInventory;
      if (!connectors?.getSnapshot || !connectors.probeStatus) {
        sendJson(res, 501, { error: 'connector_probe_unavailable' });
        return;
      }
      const descriptor = connectors.getSnapshot().connectors.find((connector) => connector.id === connectorId);
      if (!descriptor) {
        sendJson(res, 404, { error: 'connector_not_found', connectorId });
        return;
      }

      const raw = await readBody(req);
      const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      const body = parsed.value as Record<string, unknown>;
      const approvalId = typeof body['approvalId'] === 'string' ? body['approvalId'] : undefined;
      const expectedApprovalId = buildConnectorProbeApprovalId(connectorId);
      const approvalArgs = {
        connectorId,
        connectorName: descriptor.name,
        sourceSystem: descriptor.sourceSystem,
        liveProbe: true,
      };

      if (!approvalId) {
        const existing = approvals.getPending().find((request) =>
          request.id === expectedApprovalId
          || (request.toolName === 'connector_live_probe' && request.args['connectorId'] === connectorId)
        ) ?? approvals.getResolvedApproval?.(expectedApprovalId)?.request;
        if (existing) {
          sendJson(res, 202, { status: 'approval_required', connectorId, approval: existing, liveProbe: true });
          return;
        }
        if (!approvals.enqueueApproval) {
          sendJson(res, 501, { error: 'connector_probe_approval_unavailable' });
          return;
        }
        const approval = await approvals.enqueueApproval({
          id: expectedApprovalId,
          toolName: 'connector_live_probe',
          summary: `Run live connector probe for ${descriptor.name}`,
          args: approvalArgs,
          reason: 'Connector live probes may call external services and require explicit operator approval',
          approval_required: true,
        });
        sendJson(res, 202, { status: 'approval_required', connectorId, approval, liveProbe: true });
        return;
      }

      if (approvalId !== expectedApprovalId) {
        sendJson(res, 403, { error: 'approval_mismatch', connectorId });
        return;
      }
      const resolvedApproval = approvals.getResolvedApproval?.(approvalId);
      if (!resolvedApproval) {
        sendJson(res, 409, { error: 'approval_pending', connectorId, approvalId });
        return;
      }
      if (
        resolvedApproval.request.toolName !== 'connector_live_probe'
        || resolvedApproval.request.args['connectorId'] !== connectorId
      ) {
        sendJson(res, 403, { error: 'approval_mismatch', connectorId });
        return;
      }
      if (resolvedApproval.decision !== 'approve') {
        approvals.consumeResolvedApproval?.(approvalId);
        sendJson(res, 403, { error: 'connector_probe_denied', connectorId, approvalId, decision: resolvedApproval.decision });
        return;
      }
      if (!approvals.consumeResolvedApproval?.(approvalId)) {
        sendJson(res, 409, { error: 'approval_unavailable', connectorId, approvalId });
        return;
      }

      try {
        const connector = await connectors.probeStatus(connectorId);
        if (!connector) {
          sendJson(res, 404, { error: 'connector_not_found', connectorId });
          return;
        }
        const publicConnector = sanitizeConnectorStatus(connector);
        approvals.recordToolOutcome?.({
          requestId: approvalId,
          toolName: 'connector_live_probe',
          summary: `Run live connector probe for ${descriptor.name}`,
          args: approvalArgs,
          decision: 'approve',
          resultSummary: publicConnector.message,
          undo: { supported: false },
        });
        sendJson(res, 200, { status: 'probed', connectorId, connector: publicConnector, approvalId, liveProbe: true });
      } catch (error) {
        const errorMessage = redactSensitiveText(error instanceof Error ? error.message : String(error));
        approvals.recordToolOutcome?.({
          requestId: approvalId,
          toolName: 'connector_live_probe',
          summary: `Run live connector probe for ${descriptor.name}`,
          args: approvalArgs,
          decision: 'approve',
          error: errorMessage,
          undo: { supported: false },
        });
        sendJson(res, 500, { error: 'connector_probe_failed', connectorId, message: errorMessage });
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
      const listSubagents = deps.runtime.listSubagents?.bind(deps.runtime);
      sendJson(res, 200, listSubagents ? listSubagents() : [] as { id: string; name: string; status: string; startedAt: string }[]);
      return;
    }

    if (pathname === '/api/memory' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      sendJson(res, 200, deps.runtime.getMemorySnapshot());
      return;
    }

    if (pathname === '/api/memory/continuity' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
        sendJson(res, 400, { error: 'scope_override_not_allowed' });
        return;
      }
      const projectId = firstQueryValue(query['projectId'])?.trim();
      const status = await deps.runtime.getMemoryContinuityStatus(projectId ? { projectId } : {});
      sendJson(res, 200, publicMemoryContinuityStatus(status));
      return;
    }

    if (pathname === '/api/memory/search' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
        sendJson(res, 400, { error: 'scope_override_not_allowed' });
        return;
      }
      const q = firstQueryValue(query['q'])?.trim() ?? '';
      if (!q) { sendJson(res, 400, { error: 'invalid_query' }); return; }
      const limit = parseIntQuery(query['limit'], 10, 50);
      const projectId = firstQueryValue(query['projectId'])?.trim();
      const result = await deps.runtime.searchMemory({
        query: q,
        limit,
        ...(projectId ? { projectId } : {}),
      });
      sendJson(res, 200, publicMemorySearchResponse(result));
      return;
    }

    if (pathname === '/api/memory/corrections' && method === 'POST') {
      const authResult = checkAuth(req, query);
      if (!authResult.ok) {
        sendUnauthorized(res, authResult.reason ?? 'unknown');
        return;
      }
      const raw = await readBody(req);
      const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
      if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const body = parsed.value as {
        content?: unknown;
        summary?: unknown;
        projectId?: unknown;
        memoryType?: unknown;
        importance?: unknown;
        operatorId?: unknown;
        agentId?: unknown;
        workspaceId?: unknown;
      };
      if (body.agentId !== undefined || body.workspaceId !== undefined) {
        sendJson(res, 400, { error: 'scope_override_not_allowed' });
        return;
      }
      if (typeof body.content !== 'string' || body.content.trim().length === 0) {
        sendJson(res, 400, { error: 'invalid_content' });
        return;
      }
      if (body.memoryType !== undefined && !isMemoryType(body.memoryType)) {
        sendJson(res, 400, { error: 'invalid_memory_type' });
        return;
      }
      const operatorId = requireAuth
        ? `token:${authResult.label ?? 'authenticated'}`
        : (typeof body.operatorId === 'string' && body.operatorId.trim() ? body.operatorId : 'operator');
      try {
        const result = await deps.runtime.createMemoryCorrection({
          content: body.content,
          ...(typeof body.summary === 'string' ? { summary: body.summary } : {}),
          ...(typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId } : {}),
          ...(isMemoryType(body.memoryType) ? { memoryType: body.memoryType } : {}),
          ...(typeof body.importance === 'number' ? { importance: body.importance } : {}),
          operatorId,
        });
        sendJson(res, 201, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('durably persisted')) {
          sendJson(res, 503, { error: 'memory_persistence_failed', message });
          return;
        }
        sendJson(res, 500, { error: 'memory_correction_failed', message });
      }
      return;
    }

    if (pathname === '/api/memory/openclaw-import-report' && method === 'POST') {
      if (!enforceAuth(req, res, query)) return;
      const raw = await readBody(req);
      const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
      if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const body = parsed.value as {
        sourcePath?: unknown;
        projectId?: unknown;
        includePersonality?: unknown;
        includeMemories?: unknown;
        maxFiles?: unknown;
        agentId?: unknown;
        workspaceId?: unknown;
      };
      if (body.agentId !== undefined || body.workspaceId !== undefined) {
        sendJson(res, 400, { error: 'scope_override_not_allowed' });
        return;
      }
      try {
        const result = await deps.runtime.previewOpenClawMigration({
          ...(typeof body.sourcePath === 'string' && body.sourcePath.trim() ? { sourcePath: body.sourcePath } : {}),
          ...(typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId } : {}),
          ...(typeof body.includePersonality === 'boolean' ? { includePersonality: body.includePersonality } : {}),
          ...(typeof body.includeMemories === 'boolean' ? { includeMemories: body.includeMemories } : {}),
          ...(typeof body.maxFiles === 'number' ? { maxFiles: body.maxFiles } : {}),
        });
        sendJson(res, 201, publicOpenClawMigrationPreviewResponse(result));
      } catch (err) {
        sendJson(res, 400, { error: 'openclaw_import_preview_failed', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (pathname === '/api/memory/openclaw-import-report' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
        sendJson(res, 400, { error: 'scope_override_not_allowed' });
        return;
      }
      const projectId = firstQueryValue(query.projectId)?.trim();
      const result = await deps.runtime.getLatestOpenClawMigrationReport(projectId ? { projectId } : {});
      if (!result) { sendJson(res, 404, { error: 'openclaw_import_report_not_found' }); return; }
      sendJson(res, 200, publicOpenClawMigrationPreviewResponse(result));
      return;
    }

    if (pathname === '/api/memory/openclaw-import' && method === 'POST') {
      if (!enforceAuth(req, res, query)) return;
      const raw = await readBody(req);
      const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
      if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const body = parsed.value as {
        reportArtifactId?: unknown;
        expectedReportSha256?: unknown;
        projectId?: unknown;
        agentId?: unknown;
        workspaceId?: unknown;
      };
      if (body.agentId !== undefined || body.workspaceId !== undefined) {
        sendJson(res, 400, { error: 'scope_override_not_allowed' });
        return;
      }
      if (typeof body.reportArtifactId !== 'string' || typeof body.expectedReportSha256 !== 'string') {
        sendJson(res, 400, { error: 'invalid_report_reference' });
        return;
      }
      try {
        const result = await deps.runtime.importOpenClawMigration({
          reportArtifactId: body.reportArtifactId,
          expectedReportSha256: body.expectedReportSha256,
          ...(typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId } : {}),
        });
        sendJson(res, 201, { status: 'imported', result: publicOpenClawMigrationImportResult(result) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('durably persisted')) {
          sendJson(res, 503, { error: 'memory_persistence_failed', message });
          return;
        }
        sendJson(res, 400, { error: 'openclaw_import_failed', message });
      }
      return;
    }

      if (pathname === '/api/memory/rollup' && method === 'POST') {
        if (!enforceAuth(req, res, query)) return;
        const raw = await readBody(req);
        const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
      if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
      const body = parsed.value as { date?: string; agentId?: string; projectId?: string; sessionLimit?: number };
      if (body.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        sendJson(res, 400, { error: 'invalid_date' });
        return;
      }
      if (body.agentId !== undefined || body.projectId !== undefined) {
        sendJson(res, 400, { error: 'scope_override_not_allowed' });
        return;
      }
      const rollup = await deps.runtime.createDailyMemoryRollup({
        ...(body.date ? { date: body.date } : {}),
        ...(typeof body.sessionLimit === 'number' ? { sessionLimit: body.sessionLimit } : {}),
      });
        sendJson(res, 201, { rollup });
        return;
      }

      if (pathname === '/api/memory/project-rollup' && method === 'POST') {
        if (!enforceAuth(req, res, query)) return;
        const raw = await readBody(req);
        const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as {
          projectId?: unknown;
          agentId?: unknown;
          workspaceId?: unknown;
          sessionLimit?: unknown;
        };
        if (body.agentId !== undefined || body.workspaceId !== undefined) {
          sendJson(res, 400, { error: 'scope_override_not_allowed' });
          return;
        }
        if (typeof body.projectId !== 'string' || !body.projectId.trim()) {
          sendJson(res, 400, { error: 'project_id_required' });
          return;
        }
        const sessionLimit = typeof body.sessionLimit === 'number' ? Math.trunc(body.sessionLimit) : undefined;
        if (sessionLimit !== undefined && (sessionLimit <= 0 || sessionLimit > 500)) {
          sendJson(res, 400, { error: 'invalid_session_limit' });
          return;
        }
        try {
          const rollup = await deps.runtime.createProjectMemoryRollup({
            projectId: body.projectId.trim(),
            ...(sessionLimit !== undefined ? { sessionLimit } : {}),
          });
          sendJson(res, 201, {
            rollup: {
              ...rollup,
              ...(rollup.artifact ? { artifact: publicArtifactRef(rollup.artifact) } : {}),
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('durably persisted')) {
            sendJson(res, 503, { error: 'memory_persistence_failed', message });
            return;
          }
          sendJson(res, 400, { error: 'project_memory_rollup_failed', message });
        }
        return;
      }

      if (pathname === '/api/sessions' && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      const limit = parseIntQuery(query['limit'], 50, 200);
      const offset = parseIntQuery(query['offset'], 0, 10_000);
      const archivedRaw = Array.isArray(query['archived']) ? query['archived'][0] : query['archived'];
      const archived = archivedRaw === 'true' ? true : archivedRaw === 'false' ? false : undefined;
      const sessions = await deps.runtime.listSessions({ limit, offset, ...(archived !== undefined ? { archived } : {}) });
      sendJson(res, 200, {
        workspaceId: deps.runtime.getWorkspacePath(),
        sessions,
        limit,
        offset,
      });
      return;
    }

    const sessionTimelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/);
    if (sessionTimelineMatch && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      const sessionId = decodePathSegment(sessionTimelineMatch[1]!);
      if (!sessionId) { sendJson(res, 400, { error: 'invalid_session_id' }); return; }
      const timeline = await deps.runtime.getSessionTimeline(sessionId);
      if (!timeline) { sendJson(res, 404, { error: 'session_not_found' }); return; }
      sendJson(res, 200, timeline);
      return;
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && method === 'GET') {
      if (!enforceAuth(req, res, query)) return;
      const sessionId = decodePathSegment(sessionMatch[1]!);
      if (!sessionId) { sendJson(res, 400, { error: 'invalid_session_id' }); return; }
      const session = await deps.runtime.getSession(sessionId);
      if (!session) { sendJson(res, 404, { error: 'session_not_found' }); return; }
      sendJson(res, 200, { session });
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
        await applyRuntimeWorkspace(runtime, workspaceRoot);
        sendJson(res, 200, {
          ok: true,
          workspaceRoot,
          cwd: runtimeWorkspacePath(runtime, workspaceRoot),
        });
        return;
      }

      if (pathname === '/api/approvals/pending' && method === 'GET') {
        if (!enforceAuth(req, res, query)) return;
        sendJson(res, 200, { approvals: approvals.getPending().map(sanitizeApprovalRequest) });
        return;
      }

      if (pathname === '/api/effects/pending' && method === 'GET') {
        if (!enforceAuth(req, res, query)) return;
        sendJson(res, 200, { effects: sanitizeTrustPayload(await listPendingEffects(orchestration)) });
        return;
      }

      if (pathname === '/api/events/stream' && method === 'GET') {
        if (!enforceAuth(req, res, query)) return;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        });

        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const cleanup: Array<() => void> = [];
        const bufferedEvents: Array<{ eventName: string; data: unknown }> = [];
        let bufferingLiveEvents = true;
        const writeRawSSE = (eventName: string, data: unknown): void => {
          if (closed || res.destroyed) return;
          res.write(`event: ${eventName}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        const writeSSE = (eventName: string, data: unknown): void => {
          if (closed || res.destroyed) return;
          if (bufferingLiveEvents) {
            bufferedEvents.push({ eventName, data });
            return;
          }
          writeRawSSE(eventName, data);
        };
        const close = (): void => {
          if (closed) return;
          closed = true;
          for (const fn of cleanup.splice(0)) fn();
          if (heartbeat) clearInterval(heartbeat);
        };
        heartbeat = setInterval(() => {
          if (closed || res.destroyed) return;
          res.write(': heartbeat\n\n');
        }, 15_000);
        req.on('close', close);

        try {
          if (orchestration?.eventLedger?.subscribe) {
            cleanup.push(orchestration.eventLedger.subscribe((event) => {
              if (isOrchestrationEvent(event)) writeSSE('ledger', { event: sanitizeTrustPayload(event) });
            }));
          }
          if (approvals.subscribe) {
            cleanup.push(approvals.subscribe((event) => {
              writeSSE(event.type, sanitizeApprovalFlowEvent(event));
            }));
          }

          writeRawSSE('snapshot', {
            dashboard: sanitizeTrustPayload(await buildOrchestrationDashboard(orchestration, approvals.getPending().length)),
            runs: sanitizeTrustPayload(orchestration?.runLedger?.listRuns() ?? []),
            approvals: approvals.getPending().map(sanitizeApprovalRequest),
            effects: sanitizeTrustPayload(await listPendingEffects(orchestration)),
          });
          bufferingLiveEvents = false;
          for (const buffered of bufferedEvents.splice(0)) {
            writeRawSSE(buffered.eventName, buffered.data);
          }
        } catch (err) {
          bufferingLiveEvents = false;
          writeRawSSE('error', { message: err instanceof Error ? redactSensitiveText(err.message) : 'operator stream failed' });
          close();
          res.end();
        }
        return;
      }

      const approvalDecisionMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
      if (approvalDecisionMatch && method === 'POST') {
        if (!enforceAuth(req, res, query)) return;
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
        if (!enforceAuth(req, res, query)) return;
        const rawLimit = Number(query['limit'] ?? 100);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 100;
        const requestId = typeof query['requestId'] === 'string' ? query['requestId'].trim() : '';
        const matchesRequestId = (event: unknown): boolean => {
          if (!requestId || !event || typeof event !== 'object') return !requestId;
          const record = event as Record<string, unknown>;
          return record['requestId'] === requestId || record['approval_id'] === requestId;
        };
        const rawApprovalEvents = requestId && approvals.listAuditByRequestId
          ? approvals.listAuditByRequestId(requestId, 1000)
          : approvals.listAudit(requestId ? 1000 : limit);
        const approvalEvents = rawApprovalEvents
          .map((event) => sanitizeApprovalAuditEvent(event as ApprovalAuditEvent))
          .filter(matchesRequestId);
        const resolvedApproval = requestId ? approvals.getResolvedApproval?.(requestId) : undefined;
        if (resolvedApproval && !approvalEvents.some((event) =>
          event.requestId === requestId
          && (event.type === 'approval.approved' || event.type === 'approval.denied' || event.type === 'approval.timeout')
        )) {
          const request = resolvedApproval.request;
          const resolvedEvent: ApprovalAuditEvent = {
            id: `${requestId}:resolved:${resolvedApproval.decision}`,
            ts: new Date().toISOString(),
            type: resolvedApproval.decision === 'approve'
              ? 'approval.approved'
              : resolvedApproval.decision === 'deny'
                ? 'approval.denied'
                : 'approval.timeout',
            requestId,
            toolName: request.toolName,
            summary: request.summary,
            args: request.args,
            decision: resolvedApproval.decision,
            ...(request.run_id !== undefined ? { run_id: request.run_id } : {}),
            ...(request.effect_id !== undefined ? { effect_id: request.effect_id } : {}),
            ...(request.effect_kind !== undefined ? { effect_kind: request.effect_kind } : {}),
            ...(request.policy_id !== undefined ? { policy_id: request.policy_id } : {}),
            ...(request.reason !== undefined ? { reason: request.reason } : {}),
            ...(request.approval_required !== undefined ? { approval_required: request.approval_required } : {}),
          };
          approvalEvents.unshift(sanitizeApprovalAuditEvent(resolvedEvent));
        }
        const ledgerEvents = orchestration?.eventLedger
          ? (await orchestration.eventLedger.readAll())
            .filter(isOrchestrationEvent)
            .filter(matchesRequestId)
            .slice(-limit)
            .reverse()
            .map((event) => sanitizeTrustPayload(event))
          : [];
        const events = [...ledgerEvents, ...approvalEvents].sort((left, right) => {
          const leftTs = typeof left.ts === 'string' ? Date.parse(left.ts) : 0;
          const rightTs = typeof right.ts === 'string' ? Date.parse(right.ts) : 0;
          if (rightTs !== leftTs) return rightTs - leftTs;
          const leftSeq = 'seq' in left && typeof left.seq === 'number' ? left.seq : 0;
          const rightSeq = 'seq' in right && typeof right.seq === 'number' ? right.seq : 0;
          return rightSeq - leftSeq;
        });
        sendJson(res, 200, { events: events.slice(0, limit) });
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

      const runActorsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors$/);
      if (runActorsMatch && method === 'GET') {
        if (!enforceAuth(req, res, query)) return;
        const runId = decodeURIComponent(runActorsMatch[1]!);
        const staleAfterMs = parseIntQuery(query['staleAfterMs'], 0, 24 * 60 * 60_000);
        sendJson(res, 200, await buildActorSnapshot(orchestration, runId, staleAfterMs > 0 ? { staleAfterMs } : {}));
        return;
      }

      const runActorRecoverStuckMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/recover-stuck$/);
      if (runActorRecoverStuckMatch && method === 'POST') {
        if (!enforceAuth(req, res, query)) return;
        const runId = decodeURIComponent(runActorRecoverStuckMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseRecoverStuckActorsInput(parsed.value, runId);
        if (!input) {
          sendJson(res, 400, { error: 'invalid_actor_recovery_request' });
          return;
        }
        const recoverStuckActorMessages = (runtime as Partial<PyrforRuntime>).recoverStuckActorMessages;
        if (typeof recoverStuckActorMessages !== 'function') {
          sendJson(res, 501, { error: 'actor_kernel_unavailable' });
          return;
        }
        try {
          const recovery = await recoverStuckActorMessages.call(runtime, input);
          sendJson(res, 200, {
            ok: true,
            recovery,
            snapshot: await buildActorSnapshot(orchestration, runId, { staleAfterMs: input.olderThanMs }),
          });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_recovery_failed' });
        }
        return;
      }

      const runActorMessagesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages$/);
      if (runActorMessagesMatch && method === 'POST') {
        if (!enforceAuth(req, res, query)) return;
        const runId = decodeURIComponent(runActorMessagesMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseActorMailboxMessageInput(parsed.value, runId);
        if (!input) {
          sendJson(res, 400, { error: 'actorId and task are required' });
          return;
        }
        const enqueueActorMessage = (runtime as Partial<PyrforRuntime>).enqueueActorMessage;
        if (typeof enqueueActorMessage !== 'function') {
          sendJson(res, 501, { error: 'actor_kernel_unavailable' });
          return;
        }
        try {
          const spawnActor = (runtime as Partial<PyrforRuntime>).spawnActor;
          const actor = input.spawn
            ? typeof spawnActor === 'function'
              ? await spawnActor.call(runtime, input.spawn)
              : null
            : null;
          if (input.spawn && !actor) {
            sendJson(res, 501, { error: 'actor_kernel_unavailable' });
            return;
          }
          const message = await enqueueActorMessage.call(runtime, input.message);
          sendJson(res, 201, {
            ok: true,
            ...(actor ? { actor } : {}),
            message,
            snapshot: await buildActorSnapshot(orchestration, runId),
          });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_message_enqueue_failed' });
        }
        return;
      }

      const runActorLeaseMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages\/lease$/);
      if (runActorLeaseMatch && method === 'POST') {
        const runId = decodeURIComponent(runActorLeaseMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = recordValue(parsed.value);
        if (!body) { sendJson(res, 400, { error: 'invalid_actor_lease_request' }); return; }
        const owner = authenticatedActorOwner(req, res, body, query);
        if (!owner) return;
        const input = parseActorLeaseInput(parsed.value, runId, owner);
        if (!input) {
          sendJson(res, 400, { error: 'invalid_actor_lease_request' });
          return;
        }
        const leaseActorMessage = (runtime as Partial<PyrforRuntime>).leaseActorMessage;
        if (typeof leaseActorMessage !== 'function') {
          sendJson(res, 501, { error: 'actor_kernel_unavailable' });
          return;
        }
        try {
          const lease = await leaseActorMessage.call(runtime, input);
          sendJson(res, 200, {
            ok: true,
            lease,
            snapshot: await buildActorSnapshot(orchestration, runId),
          });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_message_lease_failed' });
        }
        return;
      }

      const runActorDispatchNextMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages\/dispatch-next$/);
      if (runActorDispatchNextMatch && method === 'POST') {
        const runId = decodeURIComponent(runActorDispatchNextMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = recordValue(parsed.value);
        if (!body) { sendJson(res, 400, { error: 'invalid_actor_dispatch_request' }); return; }
        const owner = authenticatedActorOwner(req, res, body, query);
        if (!owner) return;
        const input = parseActorDispatchInput(parsed.value, runId, owner);
        if (!input) {
          sendJson(res, 400, { error: 'invalid_actor_dispatch_request' });
          return;
        }
        const dispatchNextActorMessage = (runtime as Partial<PyrforRuntime>).dispatchNextActorMessage;
        if (typeof dispatchNextActorMessage !== 'function') {
          sendJson(res, 501, { error: 'actor_kernel_unavailable' });
          return;
        }
        try {
          const dispatch = await dispatchNextActorMessage.call(runtime, input);
          sendJson(res, 200, {
            ok: true,
            dispatch,
            snapshot: await buildActorSnapshot(orchestration, runId),
          });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_message_dispatch_failed' });
        }
        return;
      }

      const runActorMessageControlMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages\/([^/]+)\/(complete|fail)$/);
      if (runActorMessageControlMatch && method === 'POST') {
        const runId = decodeURIComponent(runActorMessageControlMatch[1]!);
        const nodeId = decodeURIComponent(runActorMessageControlMatch[2]!);
        const action = runActorMessageControlMatch[3]!;
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = recordValue(parsed.value);
        if (!body) { sendJson(res, 400, { error: `invalid_actor_message_${action}_request` }); return; }
        const owner = authenticatedActorOwner(req, res, body, query);
        if (!owner) return;
        try {
          if (action === 'complete') {
            const input = parseActorCompleteInput(parsed.value, runId, nodeId, owner);
            if (!input) {
              sendJson(res, 400, { error: 'invalid_actor_message_complete_request' });
              return;
            }
            const completeActorMessage = (runtime as Partial<PyrforRuntime>).completeActorMessage;
            if (typeof completeActorMessage !== 'function') {
              sendJson(res, 501, { error: 'actor_kernel_unavailable' });
              return;
            }
            const completion = await completeActorMessage.call(runtime, input);
            sendJson(res, 200, {
              ok: true,
              completion,
              snapshot: await buildActorSnapshot(orchestration, runId),
            });
            return;
          }

          const input = parseActorFailInput(parsed.value, runId, nodeId, owner);
          if (!input) {
            sendJson(res, 400, { error: 'invalid_actor_message_fail_request' });
            return;
          }
          const failActorMessage = (runtime as Partial<PyrforRuntime>).failActorMessage;
          if (typeof failActorMessage !== 'function') {
            sendJson(res, 501, { error: 'actor_kernel_unavailable' });
            return;
          }
          const failure = await failActorMessage.call(runtime, input);
          sendJson(res, 200, {
            ok: true,
            failure,
            snapshot: await buildActorSnapshot(orchestration, runId),
          });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : `actor_message_${action}_failed` });
        }
        return;
      }

      const runContextPackMatch = pathname.match(/^\/api\/runs\/([^/]+)\/context-pack$/);
      if (runContextPackMatch && method === 'GET') {
        if (!enforceAuth(req, res, query)) return;
        const runId = decodeURIComponent(runContextPackMatch[1]!);
        const getRunContextPack = (runtime as Partial<PyrforRuntime>).getRunContextPack;
        if (typeof getRunContextPack !== 'function') {
          sendJson(res, 501, { error: 'context_pack_unavailable' });
          return;
        }
        try {
          const result = await getRunContextPack.call(runtime, runId);
          if (!result) {
            sendJson(res, 404, { error: 'context_pack_not_found', runId });
            return;
          }
          sendJson(res, 200, {
            artifact: publicArtifactRef(result.artifact),
            pack: publicContextPack(result.pack),
          });
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : 'context_pack_not_found' });
        }
        return;
      }

      const runResearchSearchMatch = pathname.match(/^\/api\/runs\/([^/]+)\/research-search$/);
      if (runResearchSearchMatch && method === 'POST') {
        if (!enforceAuth(req, res, query)) return;
        const runId = decodeURIComponent(runResearchSearchMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseResearchSearchInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'invalid_research_search_request' });
          return;
        }
        const captureRunResearchSearch = (runtime as Partial<PyrforRuntime>).captureRunResearchSearch;
        if (typeof captureRunResearchSearch !== 'function') {
          sendJson(res, 501, { error: 'research_search_unavailable' });
          return;
        }
        const maxResults = input.maxResults ?? 5;
        let provider: ReturnType<typeof resolveGovernedResearchSearchProvider>;
        try {
          provider = input.provider ?? resolveGovernedResearchSearchProvider(process.env);
        } catch (err) {
          sendJson(res, 400, { error: 'research_search_provider_unavailable', message: err instanceof Error ? err.message : 'provider unavailable' });
          return;
        }
        const expectedApprovalId = buildResearchSearchApprovalId(runId, input.query, maxResults, provider);
        const queryHash = hashResearchSearchQuery(input.query);
        const approvalArgs = {
          runId,
          queryHash,
          maxResults,
          provider,
          liveSearch: true,
        };
        const approvalId = input.approvalId;
        if (!approvalId) {
          const existing = approvals.getPending().find((request) =>
            request.id === expectedApprovalId
          ) ?? approvals.getResolvedApproval?.(expectedApprovalId)?.request;
          if (existing) {
            sendJson(res, 202, { status: 'approval_required', runId, approval: existing, liveSearch: true });
            return;
          }
          if (!approvals.enqueueApproval) {
            sendJson(res, 501, { error: 'research_search_approval_unavailable' });
            return;
          }
          const approval = await approvals.enqueueApproval({
            id: expectedApprovalId,
            toolName: 'research_live_search',
            summary: `Run governed web search for ${runId}`,
            args: approvalArgs,
            run_id: runId,
            reason: 'Live web search calls an external provider and must be approved before execution',
            approval_required: true,
          });
          sendJson(res, 202, { status: 'approval_required', runId, approval, liveSearch: true });
          return;
        }

        if (approvalId !== expectedApprovalId) {
          sendJson(res, 403, { error: 'approval_mismatch', runId });
          return;
        }
        const resolvedApproval = approvals.getResolvedApproval?.(approvalId);
        if (!resolvedApproval) {
          sendJson(res, 409, { error: 'approval_pending', runId, approvalId });
          return;
        }
        if (
          resolvedApproval.request.toolName !== 'research_live_search'
          || resolvedApproval.request.args['runId'] !== runId
          || resolvedApproval.request.args['queryHash'] !== queryHash
          || resolvedApproval.request.args['maxResults'] !== maxResults
          || resolvedApproval.request.args['provider'] !== provider
        ) {
          sendJson(res, 403, { error: 'approval_mismatch', runId });
          return;
        }
        if (resolvedApproval.decision !== 'approve') {
          approvals.consumeResolvedApproval?.(approvalId);
          sendJson(res, 403, { error: 'research_search_denied', runId, approvalId, decision: resolvedApproval.decision });
          return;
        }
        if (!approvals.consumeResolvedApproval?.(approvalId)) {
          sendJson(res, 409, { error: 'approval_unavailable', runId, approvalId });
          return;
        }

        try {
          const result = await captureRunResearchSearch.call(runtime, runId, {
            ...input,
            maxResults,
            provider,
            approvalId,
          });
          approvals.recordToolOutcome?.({
            requestId: approvalId,
            toolName: 'research_live_search',
            summary: `Run governed web search for ${runId}`,
            args: approvalArgs,
            decision: 'approve',
            resultSummary: `${result.snapshot.sources.length} research sources captured`,
            undo: { supported: false },
          });
          sendJson(res, 201, {
            status: 'captured',
            artifact: publicArtifactRef(result.artifact),
            snapshot: result.snapshot,
          });
        } catch (err) {
          const errorMessage = redactSensitiveText(err instanceof Error ? err.message : String(err));
          approvals.recordToolOutcome?.({
            requestId: approvalId,
            toolName: 'research_live_search',
            summary: `Run governed web search for ${runId}`,
            args: approvalArgs,
            decision: 'approve',
            error: errorMessage,
            undo: { supported: false },
          });
          sendJson(res, 500, { error: 'research_search_failed', runId, message: errorMessage });
        }
        return;
      }

      const runResearchEvidenceMatch = pathname.match(/^\/api\/runs\/([^/]+)\/research-evidence$/);
      if (runResearchEvidenceMatch && method === 'GET') {
        if (!enforceAuth(req, res, query)) return;
        const runId = decodeURIComponent(runResearchEvidenceMatch[1]!);
        const listRunResearchEvidence = (runtime as Partial<PyrforRuntime>).listRunResearchEvidence;
        if (typeof listRunResearchEvidence !== 'function') {
          sendJson(res, 501, { error: 'research_evidence_unavailable' });
          return;
        }
        try {
          const evidence = await listRunResearchEvidence.call(runtime, runId);
          sendJson(res, 200, {
            evidence: evidence.map((entry) => ({
              artifact: publicArtifactRef(entry.artifact),
              snapshot: entry.snapshot,
            })),
          });
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : 'research_evidence_not_found' });
        }
        return;
      }

      if (runResearchEvidenceMatch && method === 'POST') {
        if (!enforceAuth(req, res, query)) return;
        const runId = decodeURIComponent(runResearchEvidenceMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const input = parseResearchEvidenceInput(parsed.value);
        if (!input) {
          sendJson(res, 400, { error: 'invalid_research_evidence_request' });
          return;
        }
        const createRunResearchEvidence = (runtime as Partial<PyrforRuntime>).createRunResearchEvidence;
        if (typeof createRunResearchEvidence !== 'function') {
          sendJson(res, 501, { error: 'research_evidence_unavailable' });
          return;
        }
        try {
          const result = await createRunResearchEvidence.call(runtime, runId, input);
          sendJson(res, 201, {
            artifact: publicArtifactRef(result.artifact),
            snapshot: result.snapshot,
          });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : 'research_evidence_failed' });
        }
        return;
      }

      const runDeliveryEvidenceMatch = pathname.match(/^\/api\/runs\/([^/]+)\/delivery-evidence$/);
      if (runDeliveryEvidenceMatch && method === 'GET') {
        const runId = decodeURIComponent(runDeliveryEvidenceMatch[1]!);
        const getDeliveryEvidence = (runtime as Partial<PyrforRuntime>).getRunDeliveryEvidence;
        if (typeof getDeliveryEvidence !== 'function') {
          sendJson(res, 501, { error: 'delivery_evidence_unavailable' });
          return;
        }
        try {
          const evidence = await getDeliveryEvidence.call(runtime, runId);
          sendJson(res, 200, publicDeliveryEvidenceResponse(evidence));
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : 'delivery_evidence_not_found' });
        }
        return;
      }

      if (runDeliveryEvidenceMatch && method === 'POST') {
        const runId = decodeURIComponent(runDeliveryEvidenceMatch[1]!);
        const raw = await readBody(req);
        const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as {
          summary?: string;
          deliveryChecklist?: string[];
          deliveryArtifactId?: string;
          issueNumber?: number;
        };
        const captureDeliveryEvidence = (runtime as Partial<PyrforRuntime>).captureRunDeliveryEvidence;
        if (typeof captureDeliveryEvidence !== 'function') {
          sendJson(res, 501, { error: 'delivery_evidence_unavailable' });
          return;
        }
        try {
          const evidence = await captureDeliveryEvidence.call(runtime, runId, body);
          sendJson(res, 201, publicDeliveryEvidenceResponse(evidence));
        } catch (err) {
          sendJson(res, 409, { error: err instanceof Error ? err.message : 'delivery_evidence_failed' });
        }
        return;
      }

      const runGithubDeliveryPlanMatch = pathname.match(/^\/api\/runs\/([^/]+)\/github-delivery-plan$/);
      if (runGithubDeliveryPlanMatch && method === 'GET') {
        const runId = decodeURIComponent(runGithubDeliveryPlanMatch[1]!);
        const getDeliveryPlan = (runtime as Partial<PyrforRuntime>).getRunGithubDeliveryPlan;
        if (typeof getDeliveryPlan !== 'function') {
          sendJson(res, 501, { error: 'github_delivery_plan_unavailable' });
          return;
        }
        try {
          const plan = await getDeliveryPlan.call(runtime, runId);
          sendJson(res, 200, publicGithubDeliveryPlanResponse(plan));
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : 'github_delivery_plan_not_found' });
        }
        return;
      }

      if (runGithubDeliveryPlanMatch && method === 'POST') {
        const runId = decodeURIComponent(runGithubDeliveryPlanMatch[1]!);
        const raw = await readBody(req);
        const parsed = raw.trim() ? tryParseJson(raw) : { ok: true as const, value: {} };
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as {
          issueNumber?: number;
          title?: string;
          body?: string;
        };
        const createDeliveryPlan = (runtime as Partial<PyrforRuntime>).createRunGithubDeliveryPlan;
        if (typeof createDeliveryPlan !== 'function') {
          sendJson(res, 501, { error: 'github_delivery_plan_unavailable' });
          return;
        }
        try {
          const plan = await createDeliveryPlan.call(runtime, runId, body);
          sendJson(res, 201, publicGithubDeliveryPlanResponse(plan));
        } catch (err) {
          sendJson(res, 409, { error: err instanceof Error ? err.message : 'github_delivery_plan_failed' });
        }
        return;
      }

      const runGithubDeliveryApplyMatch = pathname.match(/^\/api\/runs\/([^/]+)\/github-delivery-apply$/);
      if (runGithubDeliveryApplyMatch && method === 'GET') {
        const runId = decodeURIComponent(runGithubDeliveryApplyMatch[1]!);
        const getDeliveryApply = (runtime as Partial<PyrforRuntime>).getRunGithubDeliveryApply;
        if (typeof getDeliveryApply !== 'function') {
          sendJson(res, 501, { error: 'github_delivery_apply_unavailable' });
          return;
        }
        try {
          const apply = await getDeliveryApply.call(runtime, runId);
          sendJson(res, 200, publicGithubDeliveryApplyState(apply));
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : 'github_delivery_apply_not_found' });
        }
        return;
      }

      if (runGithubDeliveryApplyMatch && method === 'POST') {
        const runId = decodeURIComponent(runGithubDeliveryApplyMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as {
          planArtifactId?: string;
          expectedPlanSha256?: string;
          approvalId?: string;
        };
        if (!body.planArtifactId || !body.expectedPlanSha256) {
          sendJson(res, 400, { error: 'planArtifactId and expectedPlanSha256 are required' });
          return;
        }
        const applyInput = {
          planArtifactId: body.planArtifactId,
          expectedPlanSha256: body.expectedPlanSha256,
          ...(body.approvalId ? { approvalId: body.approvalId } : {}),
        };
        try {
          if (body.approvalId) {
            const applyDelivery = (runtime as Partial<PyrforRuntime>).applyApprovedRunGithubDelivery;
            if (typeof applyDelivery !== 'function') {
              sendJson(res, 501, { error: 'github_delivery_apply_unavailable' });
              return;
            }
            const applied = await applyDelivery.call(runtime, runId, applyInput);
            sendJson(res, 201, publicGithubDeliveryApplyResponse(applied));
            return;
          }
          const requestApply = (runtime as Partial<PyrforRuntime>).requestRunGithubDeliveryApply;
          if (typeof requestApply !== 'function') {
            sendJson(res, 501, { error: 'github_delivery_apply_unavailable' });
            return;
          }
          const pending = await requestApply.call(runtime, runId, applyInput);
          sendJson(res, 202, pending);
        } catch (err) {
          sendJson(res, 409, { error: err instanceof Error ? err.message : 'github_delivery_apply_failed' });
        }
        return;
      }

      const runVerifierStatusMatch = pathname.match(/^\/api\/runs\/([^/]+)\/verifier-status$/);
      if (runVerifierStatusMatch && method === 'GET') {
        const runId = decodeURIComponent(runVerifierStatusMatch[1]!);
        const getVerifierStatus = (runtime as Partial<PyrforRuntime>).getRunVerifierStatus;
        if (typeof getVerifierStatus !== 'function') {
          sendJson(res, 501, { error: 'verifier_policy_unavailable' });
          return;
        }
        try {
          sendJson(res, 200, await getVerifierStatus.call(runtime, runId));
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : 'verifier_status_not_found' });
        }
        return;
      }

      const runVerifierWaiverMatch = pathname.match(/^\/api\/runs\/([^/]+)\/verifier-waiver$/);
      if (runVerifierWaiverMatch && method === 'POST') {
        const runId = decodeURIComponent(runVerifierWaiverMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as {
          operatorId?: string;
          operatorName?: string;
          reason?: string;
          scope?: 'run' | 'delivery' | 'delivery_plan' | 'delivery_apply' | 'all';
        };
        if (!body.reason || (!requireAuth && !body.operatorId)) {
          sendJson(res, 400, { error: requireAuth ? 'reason is required' : 'operatorId and reason are required' });
          return;
        }
        const operatorId = requireAuth
          ? `token:${authResult.label ?? 'authenticated'}`
          : body.operatorId!;
        const operatorName = requireAuth
          ? authResult.label
          : body.operatorName;
        const createWaiver = (runtime as Partial<PyrforRuntime>).createRunVerifierWaiver;
        if (typeof createWaiver !== 'function') {
          sendJson(res, 501, { error: 'verifier_policy_unavailable' });
          return;
        }
        try {
          const result = await createWaiver.call(runtime, runId, {
            operatorId,
            ...(operatorName ? { operatorName } : {}),
            reason: body.reason,
            ...(body.scope ? { scope: body.scope } : {}),
          });
          sendJson(res, 201, result);
        } catch (err) {
          sendJson(res, 409, { error: err instanceof Error ? err.message : 'verifier_waiver_failed' });
        }
        return;
      }

      const runControlMatch = pathname.match(/^\/api\/runs\/([^/]+)\/control$/);
      if (runControlMatch && method === 'POST') {
        const runId = decodeURIComponent(runControlMatch[1]!);
        const raw = await readBody(req);
        const parsed = tryParseJson(raw);
        if (!parsed.ok) { sendJson(res, 400, { error: 'invalid_json' }); return; }
        const body = parsed.value as {
          action?: 'replay' | 'continue' | 'abort' | 'execute';
          resumeToken?: string;
          approvalId?: string;
        };
        if (body.action !== 'replay' && body.action !== 'continue' && body.action !== 'abort' && body.action !== 'execute') {
          sendJson(res, 400, { error: 'action must be replay, continue, abort, or execute' });
          return;
        }
        try {
          if (body.action === 'execute') {
            const executeProductRun = (runtime as Partial<PyrforRuntime>).executeProductFactoryRun;
            if (typeof executeProductRun !== 'function') {
              sendJson(res, 501, { error: 'product_factory_unavailable' });
              return;
            }
            const result = body.approvalId
              ? await executeProductRun.call(runtime, runId, { approvalId: body.approvalId })
              : await executeProductRun.call(runtime, runId);
            sendJson(res, 200, { ok: true, action: body.action, ...result });
            return;
          }
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

      if (pathname === '/api/overlay-summaries' && method === 'GET') {
        sendJson(res, 200, { overlays: orchestration?.overlays?.list().map(publicDomainOverlay) ?? [] });
        return;
      }

      const publicOverlayMatch = pathname.match(/^\/api\/overlay-summaries\/([^/]+)$/);
      if (publicOverlayMatch && method === 'GET') {
        const domainId = decodeURIComponent(publicOverlayMatch[1]!);
        const overlay = orchestration?.overlays?.get(domainId)?.manifest;
        if (!overlay) {
          sendJson(res, 404, { error: 'overlay_not_found' });
          return;
        }
        sendJson(res, 200, { overlay: publicDomainOverlay(overlay) });
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
          health: snapshot ? publicHealthSnapshot(snapshot) : null,
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
        let bodyExposeToolPayloads: boolean | undefined;

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
          bodyPrefer = m.prefer;
          bodyRoutingHints = m.routingHints;
          bodyExposeToolPayloads = m.exposeToolPayloads;
          attachments = m.attachments;
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
            exposeToolPayloads?: boolean;
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
          bodyExposeToolPayloads = typeof body.exposeToolPayloads === 'boolean' ? body.exposeToolPayloads : undefined;
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
            exposeToolPayloads: bodyExposeToolPayloads,
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
