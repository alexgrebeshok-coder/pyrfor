/**
 * Runtime HTTP Gateway
 *
 * Thin HTTP server that exposes health/status/chat endpoints for the runtime.
 * Uses Node's built-in `http` module — no framework dependencies.
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import { createServer } from 'http';
import { parse as parseUrl } from 'url';
import { WebSocketServer } from 'ws';
import { PtyManager } from './pty/manager.js';
import { readFileSync, existsSync, realpathSync, writeFileSync as writeFileSyncNode, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { createHash, randomUUID } from 'node:crypto';
import { processPhoto } from './media/process-photo.js';
import { logger } from '../observability/logger.js';
import { activateBlock, deactivateBlock, loadBlock } from './block-loader.js';
import { loadConfig, saveConfig } from './config.js';
import { providerRouter as defaultProviderRouter } from './provider-router.js';
import { McpRestartRejectedError } from './mcp-restart-error.js';
import { getGitHubDeliveryReadiness } from './github-delivery-readiness.js';
import { getBrowserQAReadiness } from './browser-readiness.js';
import { getReleaseReadiness } from './release-readiness.js';
import { collectMetrics, formatMetrics } from './metrics.js';
import { createRateLimiter } from './rate-limit.js';
import { createTokenValidator } from './auth-tokens.js';
import { GoalStore } from './goal-store.js';
import { DurableMemoryContradictionError } from '../ai/memory/agent-memory-store.js';
import { approvalFlow } from './approval-flow.js';
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile, searchFiles, FsApiError, } from './ide/fs-api.js';
import { gitStatus, gitDiff, gitFileContent, gitStage, gitUnstage, gitCommit, gitLog, gitBlame, } from './git/api.js';
import { transcribeBuffer } from './voice.js';
import { setWorkspaceRoot } from './tools.js';
import { getGovernedResearchSearchReadiness, resolveGovernedResearchSearchProvider } from './research-search.js';
import { buildBrowserSmokeApprovalId, normalizeBrowserSmokeInput } from './browser-smoke.js';
import { buildResearchSourceCaptureApprovalId, normalizeResearchSourceCaptureInput } from './research-source-capture.js';
import { listSkillCatalog, recommendSkillsPreview } from './skill-inspector.js';
import { approveSkillRegistryEntry, importSkillMdToRegistry, listPublicToolRegistry, testSkillRegistryEntry, } from './skill-importer.js';
import { createDefaultRegistry, tokenize as tokenizeSlashCommand } from './slash-commands.js';
import { createDefaultProductFactory, isProductFactoryTemplateId } from './product-factory.js';
import { CONCEPT_ID_PATTERN } from './universal/engine-loop.js';
import { getEngineTracer } from '../observability/engine-telemetry.js';
import { createToolRegistry } from './universal/tool-registry.js';
import { createAgUiConceptProjector, createAgUiEventStream, parseAgUiRunRequest, toAgUiConceptInput } from './ag-ui.js';
function publicSlashCommandSummary(command) {
    if (command.permissionClass !== 'auto_allow')
        return null;
    return {
        name: command.name,
        description: command.description,
        aliases: command.aliases ? [...command.aliases] : [],
        argSchema: command.argSchema,
        permissionClass: 'auto_allow',
    };
}
// ─── Static file helpers ───────────────────────────────────────────────────
const MIME_MAP = {
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
let fallbackUniversalToolRegistry;
function resolveDefaultStaticDir() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        return path.join(path.dirname(__filename), 'telegram', 'app');
    }
    catch (_a) {
        // Fallback for environments where import.meta.url is unavailable
        return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'app');
    }
}
function resolveDefaultIdeStaticDir() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        return path.join(path.dirname(__filename), 'telegram', 'ide');
    }
    catch (_a) {
        return path.join(process.cwd(), 'src', 'runtime', 'telegram', 'ide');
    }
}
function serveStaticFile(res, staticDir, filePath) {
    var _a;
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
    const contentType = (_a = MIME_MAP[ext]) !== null && _a !== void 0 ? _a : 'application/octet-stream';
    const body = readFileSync(full);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
}
// ─── Approval-settings helpers ─────────────────────────────────────────────
function readApprovalSettings(settingsPath) {
    try {
        const raw = readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (_a) {
        return {};
    }
}
function saveApprovalSettings(settingsPath, settings) {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSyncNode(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}
// ─── Gateway Helpers ───────────────────────────────────────────────────────
function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
}
function parseIntQuery(value, fallback, max) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string' || raw.trim() === '')
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0)
        return fallback;
    return Math.min(parsed, max);
}
/** Maximum spans returned by GET /api/telemetry/spans (query limit is clamped to this). */
const TELEMETRY_SPANS_MAX = 500;
/** Maximum events returned by GET /api/git/worktree-merge-events (query limit is clamped to this). */
const WORKTREE_MERGE_EVENTS_MAX = 100;
/** Maximum path segment length for POST /api/mcp/servers/:name/restart. */
const MCP_RESTART_SERVER_NAME_MAX = 128;
const WORKTREE_MERGE_EVENT_TYPES = new Set([
    'git.worktree.merge.requested',
    'git.worktree.merge.completed',
    'git.worktree.merge.conflicted',
]);
function worktreeMergeStringField(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function sanitizeConflictPathsField(value, maxPaths) {
    if (!Array.isArray(value))
        return undefined;
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string' || !item)
            continue;
        out.push(item);
        if (out.length >= maxPaths)
            break;
    }
    return out.length > 0 ? out : undefined;
}
/** Response body for POST /api/git/worktree-merge (no stderr or raw git output). */
function publicWorktreeMergePostResult(result) {
    if (result.ok) {
        return { ok: true, kind: 'completed', mergeSha: result.mergeCommitSha };
    }
    if (result.kind === 'conflict') {
        return {
            ok: false,
            kind: 'conflict',
            conflictPaths: result.conflictPaths,
            message: 'Merge conflict',
        };
    }
    return { ok: false, kind: 'error', message: result.message };
}
const NO_SUBAGENT_WORKTREE_MESSAGE = 'No isolated subagent worktree';
function toPublicWorktreeMergeLedgerEvent(raw) {
    var _a, _b;
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    const t = o.type;
    if (typeof t !== 'string' || !WORKTREE_MERGE_EVENT_TYPES.has(t))
        return null;
    const runId = (_a = worktreeMergeStringField(o.run_id)) !== null && _a !== void 0 ? _a : '';
    const ts = (_b = worktreeMergeStringField(o.ts)) !== null && _b !== void 0 ? _b : '';
    const mergeBranch = worktreeMergeStringField(o.merge_branch);
    const safeReason = worktreeMergeStringField(o.reason);
    if (t === 'git.worktree.merge.requested') {
        return Object.assign({ type: t, run_id: runId, ts, merge_branch: mergeBranch, status: 'requested' }, (safeReason !== undefined ? { reason: safeReason } : {}));
    }
    if (t === 'git.worktree.merge.completed') {
        const mergeSha = worktreeMergeStringField(o.merge_sha);
        return Object.assign(Object.assign({ type: t, run_id: runId, ts, merge_branch: mergeBranch, status: 'completed' }, (mergeSha !== undefined ? { merge_sha: mergeSha } : {})), (safeReason !== undefined ? { reason: safeReason } : {}));
    }
    return {
        type: 'git.worktree.merge.conflicted',
        run_id: runId,
        ts,
        merge_branch: mergeBranch,
        status: 'conflicted',
        conflict_paths: sanitizeConflictPathsField(o.conflict_paths, 500),
    };
}
function compareWorktreeMergeByTimeDesc(a, b) {
    const msA = Date.parse(a.ts);
    const msB = Date.parse(b.ts);
    const tA = Number.isFinite(msA) ? msA : 0;
    const tB = Number.isFinite(msB) ? msB : 0;
    return tB - tA;
}
function publicWorktreeMergeEventsResponse(eventLedger, limit) {
    return __awaiter(this, void 0, void 0, function* () {
        const all = yield eventLedger.readAll();
        const events = [];
        for (const entry of all) {
            const pub = toPublicWorktreeMergeLedgerEvent(entry);
            if (pub)
                events.push(pub);
        }
        events.sort(compareWorktreeMergeByTimeDesc);
        return { limit, events: events.slice(0, limit) };
    });
}
function serializeSpanRecord(record) {
    return Object.assign(Object.assign(Object.assign({ id: record.id, traceId: record.traceId }, (record.parentId !== undefined ? { parentId: record.parentId } : {})), { name: record.name, startMs: record.startMs, endMs: record.endMs, durationMs: record.durationMs, attrs: record.attrs, events: record.events, status: record.status }), (record.error !== undefined ? { error: record.error } : {}));
}
function publicTelemetrySpansResponse(requestedLimit) {
    const limit = Math.max(1, Math.min(requestedLimit, TELEMETRY_SPANS_MAX));
    const spans = getEngineTracer().recent(limit).map(serializeSpanRecord);
    return { limit, spans };
}
/** MCP status for IDE — names, flags, tool counts from in-memory registry only (no network I/O). */
function publicMcpStatusPayload(client) {
    const names = [...client.listServers()].sort((a, b) => a.localeCompare(b));
    return {
        servers: names.map((name) => ({
            name,
            connected: client.isConnected(name),
            toolCount: client.listTools(name).length,
        })),
    };
}
function firstQueryValue(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' ? raw : undefined;
}
function isMemoryType(value) {
    return value === 'episodic' || value === 'semantic' || value === 'procedural' || value === 'policy';
}
function isMemoryReviewDecision(value) {
    return value === 'approve' || value === 'reject';
}
function decodePathSegment(value) {
    try {
        return decodeURIComponent(value);
    }
    catch (_a) {
        return null;
    }
}
function sendUnauthorized(res, reason = 'unknown') {
    sendJson(res, 401, { error: 'unauthorized', reason });
}
function sendText(res, status, body, contentType) {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}
function readBodyBuffer(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
/**
 * Minimal multipart/form-data parser — extracts the raw bytes of the first
 * named part matching `fieldName`.  Only handles the subset needed here:
 * a single binary file field with a Content-Type sub-header.
 */
function extractMultipartField(body, boundary, fieldName) {
    const enc = 'binary';
    const bodyStr = body.toString(enc);
    const delim = `--${boundary}`;
    const parts = bodyStr.split(delim);
    for (const part of parts) {
        if (!part.includes(`name="${fieldName}"`))
            continue;
        // Headers end at the first \r\n\r\n
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1)
            continue;
        // The content is everything after the header block, minus the trailing \r\n
        const content = part.slice(headerEnd + 4);
        const trimmed = content.endsWith('\r\n') ? content.slice(0, -2) : content;
        return Buffer.from(trimmed, enc);
    }
    return null;
}
function parseMultipart(body, boundary) {
    var _a;
    const enc = 'binary';
    const bodyStr = body.toString(enc);
    const delim = `--${boundary}`;
    const parts = bodyStr.split(delim);
    const out = [];
    for (const part of parts) {
        if (!part)
            continue;
        const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
        if (trimmed === '' || trimmed === '--')
            continue;
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1)
            continue;
        const headersRaw = part.slice(0, headerEnd);
        let content = part.slice(headerEnd + 4);
        if (content.endsWith('\r\n'))
            content = content.slice(0, -2);
        const nameMatch = /name="([^"]*)"/.exec(headersRaw);
        if (!nameMatch)
            continue;
        const filenameMatch = /filename="([^"]*)"/.exec(headersRaw);
        const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headersRaw);
        out.push({
            name: nameMatch[1],
            filename: filenameMatch === null || filenameMatch === void 0 ? void 0 : filenameMatch[1],
            contentType: (_a = ctMatch === null || ctMatch === void 0 ? void 0 : ctMatch[1]) === null || _a === void 0 ? void 0 : _a.trim(),
            data: Buffer.from(content, enc),
        });
    }
    return out;
}
/** Safe JSON parse — returns the parsed value or null on syntax error. */
function tryParseJson(raw) {
    try {
        return { ok: true, value: JSON.parse(raw || '{}') };
    }
    catch (_a) {
        return { ok: false };
    }
}
// ─── Helpers ───────────────────────────────────────────────────────────────
function buildValidator(config) {
    return createTokenValidator({
        bearerToken: config.gateway.bearerToken,
        bearerTokens: config.gateway.bearerTokens,
    });
}
function firstString(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.find((item) => typeof item === 'string');
    return undefined;
}
function extractBearerToken(req, query) {
    const authHeader = firstString(req.headers['authorization']);
    if (authHeader) {
        return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    }
    // Browser WebSocket clients cannot set Authorization headers. This query
    // token keeps PTY WS aligned with HTTP auth until Tauri owns session transport.
    return firstString(query === null || query === void 0 ? void 0 : query['token']);
}
function providerSecretEnvKey(secretKey) {
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
function runtimeWorkspacePath(runtime, fallback) {
    const getter = runtime.getWorkspacePath;
    if (typeof getter === 'function') {
        return getter.call(runtime);
    }
    return fallback;
}
function resolveExistingPath(inputPath) {
    const resolved = path.resolve(inputPath);
    try {
        return realpathSync(resolved);
    }
    catch (_a) {
        return resolved;
    }
}
function isWithinWorkspaceRoot(candidatePath, workspaceRoot) {
    const root = resolveExistingPath(workspaceRoot);
    const candidate = resolveExistingPath(candidatePath);
    return candidate === root || candidate.startsWith(root + path.sep);
}
function applyRuntimeWorkspace(runtime, workspaceRoot) {
    return __awaiter(this, void 0, void 0, function* () {
        const setter = runtime.setWorkspacePath;
        if (typeof setter === 'function') {
            yield setter.call(runtime, workspaceRoot);
            return;
        }
        setWorkspaceRoot(workspaceRoot);
    });
}
// ─── IDE helpers ────────────────────────────────────────────────────────────
/** Map FsApiError.code to HTTP status. */
function fsErrStatus(code) {
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
function sendFsError(res, err) {
    sendJson(res, fsErrStatus(err.code), { error: err.message, code: err.code });
}
/**
 * Exec timeout in milliseconds. Exported so tests can override it via
 * the `execTimeoutMs` field in GatewayDeps.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 30000;
/** Max bytes captured per stream (stdout / stderr). */
const EXEC_MAX_OUTPUT = 100000;
/**
 * Run an external command with a timeout. Does NOT use shell:true unless the
 * command string starts with "bash -c " or "sh -c ", in which case the shell
 * is invoked with a single argument (the rest of the string).
 *
 * Returns stdout, stderr, exitCode, and durationMs.
 * On timeout: kills the process, sets exitCode = -1, stderr = 'TIMEOUT'.
 */
function runExec(command, cwd, timeoutMs) {
    return new Promise((resolve) => {
        var _a;
        const t0 = Date.now();
        let file;
        let args;
        let useShell = false;
        // Allow explicit shell invocation via "bash -c <script>" or "sh -c <script>"
        const shellMatch = command.match(/^(bash|sh)\s+-c\s+([\s\S]+)$/);
        if (shellMatch) {
            file = shellMatch[1];
            args = ['-c', shellMatch[2]];
            useShell = false; // We're calling bash/sh directly — still no shell:true
        }
        else {
            // Simple whitespace tokenizer — handles quoted strings naively
            const tokens = tokenize(command);
            file = (_a = tokens[0]) !== null && _a !== void 0 ? _a : '';
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
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
            if (stdout.length > EXEC_MAX_OUTPUT) {
                stdout = stdout.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
            }
        });
        child.stderr.on('data', (chunk) => {
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
            }
            else {
                resolve({ stdout, stderr, exitCode: code !== null && code !== void 0 ? code : 0, durationMs });
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
function tokenize(cmd) {
    const tokens = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < cmd.length; i++) {
        const ch = cmd[i];
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === ' ' && !inSingle && !inDouble) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (current)
        tokens.push(current);
    return tokens;
}
function parseProductFactoryPlanInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const body = value;
    if (body.productFactory !== undefined)
        return parseProductFactoryPlanInput(body.productFactory);
    if (typeof body.templateId !== 'string' || !isProductFactoryTemplateId(body.templateId) || typeof body.prompt !== 'string')
        return null;
    const input = {
        templateId: body.templateId,
        prompt: body.prompt,
    };
    if (body.answers !== undefined) {
        if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers))
            return null;
        input.answers = Object.fromEntries(Object.entries(body.answers)
            .filter((entry) => typeof entry[1] === 'string'));
    }
    if (body.domainIds !== undefined) {
        if (!Array.isArray(body.domainIds) || body.domainIds.some((item) => typeof item !== 'string'))
            return null;
        input.domainIds = body.domainIds;
    }
    return input;
}
function parseActorMailboxMessageInput(value, runId) {
    const body = recordValue(value);
    if (!body)
        return null;
    const actorId = textValue(body['actorId']);
    const task = textValue(body['task']);
    if (!actorId || !task)
        return null;
    const payload = body['payload'] === undefined ? undefined : recordValue(body['payload']);
    if (body['payload'] !== undefined && !payload)
        return null;
    const priority = numberValue(body['priority']);
    const idempotencyKey = textValue(body['idempotencyKey']);
    const allowConcurrent = booleanValue(body['allowConcurrent']);
    const message = Object.assign(Object.assign(Object.assign(Object.assign({ runId,
        actorId,
        task }, (payload ? { payload } : {})), (idempotencyKey ? { idempotencyKey } : {})), (priority !== undefined ? { priority } : {})), (allowConcurrent !== undefined ? { allowConcurrent } : {}));
    const agentId = textValue(body['agentId']);
    if (!agentId)
        return { message };
    return {
        spawn: Object.assign(Object.assign(Object.assign(Object.assign({ runId,
            actorId,
            agentId }, (textValue(body['agentName']) ? { agentName: textValue(body['agentName']) } : {})), (textValue(body['role']) ? { role: textValue(body['role']) } : {})), (textValue(body['parentActorId']) ? { parentActorId: textValue(body['parentActorId']) } : {})), (textValue(body['goal']) ? { goal: textValue(body['goal']) } : {})),
        message,
    };
}
function parseActorLeaseInput(value, runId, owner) {
    const body = recordValue(value);
    if (!body)
        return null;
    const ttlMs = numberValue(body['ttlMs']);
    if (ttlMs !== undefined && ttlMs <= 0)
        return null;
    return Object.assign(Object.assign({ runId,
        owner }, (textValue(body['actorId']) ? { actorId: textValue(body['actorId']) } : {})), (ttlMs !== undefined ? { ttlMs } : {}));
}
function parseActorDispatchInput(value, runId, owner) {
    const body = recordValue(value);
    if (!body)
        return null;
    const ttlMs = numberValue(body['ttlMs']);
    if (ttlMs !== undefined && ttlMs <= 0)
        return null;
    const maxTokens = numberValue(body['maxTokens']);
    if (maxTokens !== undefined && maxTokens <= 0)
        return null;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ runId,
        owner }, (textValue(body['actorId']) ? { actorId: textValue(body['actorId']) } : {})), (ttlMs !== undefined ? { ttlMs } : {})), (textValue(body['instruction']) ? { instruction: textValue(body['instruction']) } : {})), (textValue(body['systemPrompt']) ? { systemPrompt: textValue(body['systemPrompt']) } : {})), (maxTokens !== undefined ? { maxTokens } : {}));
}
function parseRecoverStuckActorsInput(value, runId) {
    const body = recordValue(value);
    if (!body)
        return null;
    const olderThanMs = numberValue(body['olderThanMs']);
    if (olderThanMs === undefined || olderThanMs <= 0)
        return null;
    return Object.assign(Object.assign({ runId,
        olderThanMs }, (textValue(body['actorId']) ? { actorId: textValue(body['actorId']) } : {})), (textValue(body['reason']) ? { reason: textValue(body['reason']) } : {}));
}
function parseResearchEvidenceInput(value) {
    const body = recordValue(value);
    if (!body)
        return null;
    const query = textValue(body['query']);
    const sources = Array.isArray(body['sources']) ? body['sources'].map(recordValue) : [];
    if (!query || sources.length === 0 || sources.some((source) => !source || !textValue(source['url'])))
        return null;
    const notes = Array.isArray(body['notes'])
        ? body['notes'].filter((item) => typeof item === 'string')
        : undefined;
    return Object.assign(Object.assign(Object.assign({ query, sources: sources.map((source) => (Object.assign(Object.assign(Object.assign(Object.assign({ url: textValue(source['url']) }, (textValue(source['title']) ? { title: textValue(source['title']) } : {})), (textValue(source['snippet']) ? { snippet: textValue(source['snippet']) } : {})), (textValue(source['citation']) ? { citation: textValue(source['citation']) } : {})), (textValue(source['observedAt']) ? { observedAt: textValue(source['observedAt']) } : {})))) }, (textValue(body['summary']) ? { summary: textValue(body['summary']) } : {})), (textValue(body['conclusion']) ? { conclusion: textValue(body['conclusion']) } : {})), (notes ? { notes } : {}));
}
function parseResearchSearchInput(value) {
    const body = recordValue(value);
    if (!body)
        return null;
    const query = textValue(body['query']);
    if (!query)
        return null;
    const maxResults = numberValue(body['maxResults']);
    if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults <= 0 || maxResults > 5))
        return null;
    const provider = textValue(body['provider']);
    if (provider !== undefined && provider !== 'brave' && provider !== 'duckduckgo')
        return null;
    const notes = Array.isArray(body['notes'])
        ? body['notes'].filter((item) => typeof item === 'string')
        : undefined;
    return Object.assign(Object.assign(Object.assign(Object.assign({ query }, (maxResults !== undefined ? { maxResults } : {})), (provider !== undefined ? { provider } : {})), (textValue(body['approvalId']) ? { approvalId: textValue(body['approvalId']) } : {})), (notes ? { notes } : {}));
}
function parseResearchSourceCaptureInput(value) {
    const body = recordValue(value);
    if (!body)
        return null;
    const url = textValue(body['url']);
    if (!url)
        return null;
    return Object.assign(Object.assign({ url }, (textValue(body['approvalId']) ? { approvalId: textValue(body['approvalId']) } : {})), (textValue(body['note']) ? { note: textValue(body['note']) } : {}));
}
function parseBrowserSmokeInput(value) {
    const body = recordValue(value);
    if (!body)
        return null;
    const url = textValue(body['url']);
    if (!url)
        return null;
    const assertion = recordValue(body['assertion']);
    const notes = Array.isArray(body['notes'])
        ? body['notes'].filter((item) => typeof item === 'string')
        : undefined;
    const fullPage = typeof body['fullPage'] === 'boolean' ? body['fullPage'] : undefined;
    return Object.assign(Object.assign(Object.assign(Object.assign({ url }, (assertion && (textValue(assertion['selector']) || textValue(assertion['containsText'])) ? {
        assertion: Object.assign(Object.assign({}, (textValue(assertion['selector']) ? { selector: textValue(assertion['selector']) } : {})), (textValue(assertion['containsText']) ? { containsText: textValue(assertion['containsText']) } : {})),
    } : {})), (fullPage !== undefined ? { fullPage } : {})), (textValue(body['approvalId']) ? { approvalId: textValue(body['approvalId']) } : {})), (notes ? { notes } : {}));
}
function parseActorCompleteInput(value, runId, nodeId, owner) {
    const body = recordValue(value);
    if (!body)
        return null;
    const proof = body['proof'] === undefined ? undefined : recordValue(body['proof']);
    if (body['proof'] !== undefined && !proof)
        return null;
    return Object.assign(Object.assign(Object.assign({ runId,
        nodeId,
        owner }, (textValue(body['output']) ? { output: textValue(body['output']) } : {})), (textValue(body['summary']) ? { summary: textValue(body['summary']) } : {})), (proof ? { proof } : {}));
}
function parseActorFailInput(value, runId, nodeId, owner) {
    const body = recordValue(value);
    if (!body)
        return null;
    const reason = textValue(body['reason']);
    if (!reason)
        return null;
    return Object.assign({ runId,
        nodeId,
        owner,
        reason }, (typeof body['retryable'] === 'boolean' ? { retryable: body['retryable'] } : {}));
}
function parseOchagReminderPlanInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const body = value;
    if (typeof body.title !== 'string' || !body.title.trim())
        return null;
    const answers = {};
    if (typeof body.familyId === 'string')
        answers['familyId'] = body.familyId;
    if (typeof body.dueAt === 'string')
        answers['dueAt'] = body.dueAt;
    if (body.visibility === 'member' || body.visibility === 'family')
        answers['visibility'] = body.visibility;
    if (typeof body.audience === 'string')
        answers['audience'] = body.audience;
    if (Array.isArray(body.memberIds)) {
        answers['memberIds'] = body.memberIds.filter((item) => typeof item === 'string').join(',');
    }
    if (typeof body.privacy === 'string')
        answers['privacy'] = body.privacy;
    if (typeof body.escalationPolicy === 'string')
        answers['escalationPolicy'] = body.escalationPolicy;
    return {
        templateId: 'ochag_family_reminder',
        prompt: body.title,
        answers,
        domainIds: ['ochag'],
    };
}
function parseCeoclawBriefPlanInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const body = value;
    const decision = typeof body.decision === 'string' ? body.decision.trim() : '';
    if (!decision)
        return null;
    const answers = { decision };
    if (typeof body.evidence === 'string')
        answers['evidence'] = body.evidence;
    if (Array.isArray(body.evidence)) {
        answers['evidence'] = body.evidence.filter((item) => typeof item === 'string').join(',');
    }
    if (typeof body.deadline === 'string')
        answers['deadline'] = body.deadline;
    if (typeof body.projectId === 'string')
        answers['projectId'] = body.projectId;
    return {
        templateId: 'business_brief',
        prompt: typeof body.title === 'string' && body.title.trim() ? body.title : decision,
        answers,
        domainIds: ['ceoclaw'],
    };
}
function missingRequiredAnswers(input, requiredAnswerIds) {
    var _a;
    const answers = (_a = input.answers) !== null && _a !== void 0 ? _a : {};
    return requiredAnswerIds.filter((id) => { var _a; return !((_a = answers[id]) === null || _a === void 0 ? void 0 : _a.trim()); });
}
function supportsFreeClaudeExecution(orchestration) {
    return Boolean((orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) && orchestration.eventLedger && orchestration.dag);
}
function supportsUniversalEngine(config, orchestration) {
    var _a;
    return ((_a = config.features) === null || _a === void 0 ? void 0 : _a.universalEngine) === true && Boolean(orchestration === null || orchestration === void 0 ? void 0 : orchestration.universalEngine);
}
function effectiveUniversalToolRegistry(orchestration) {
    if (orchestration === null || orchestration === void 0 ? void 0 : orchestration.toolRegistry)
        return orchestration.toolRegistry;
    fallbackUniversalToolRegistry !== null && fallbackUniversalToolRegistry !== void 0 ? fallbackUniversalToolRegistry : (fallbackUniversalToolRegistry = createToolRegistry());
    return fallbackUniversalToolRegistry;
}
const TOOL_REGISTRY_STATUSES = new Set([
    'pending_validation',
    'sandboxed_experiment',
    'vetted',
    'trusted',
    'core',
    'retired',
    'active',
]);
function parseToolRegistryQuery(query) {
    var _a;
    const status = (_a = firstString(query['status'])) !== null && _a !== void 0 ? _a : firstString(query['state']);
    const tagValues = [
        ...[firstString(query['tag'])],
        ...(Array.isArray(query['tags']) ? query['tags'].filter((item) => typeof item === 'string') : []),
    ].filter((tag) => Boolean(tag === null || tag === void 0 ? void 0 : tag.trim()));
    const rawLimit = firstString(query['limit']);
    let limit;
    if (rawLimit !== undefined) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500)
            return { ok: false, error: 'invalid_limit' };
        limit = parsed;
    }
    if (status !== undefined && !TOOL_REGISTRY_STATUSES.has(status)) {
        return { ok: false, error: 'invalid_tool_status' };
    }
    return {
        ok: true,
        value: Object.assign(Object.assign(Object.assign({}, (status ? { status: status } : {})), (tagValues.length > 0 ? { tags: tagValues } : {})), (limit !== undefined ? { limit } : {})),
    };
}
function effectiveExecutionMode(config, orchestration) {
    if (config.executionMode === 'freeclaude' && supportsFreeClaudeExecution(orchestration)) {
        return 'freeclaude';
    }
    return 'pyrfor';
}
function isOrchestrationEvent(event) {
    if (!event || typeof event !== 'object')
        return false;
    const type = event.type;
    return typeof type === 'string' && (type.startsWith('run.') ||
        type.startsWith('effect.') ||
        type.startsWith('dag.') ||
        type.startsWith('actor.') ||
        type.startsWith('verifier.') ||
        type.startsWith('eval.') ||
        type === 'artifact.created' ||
        type === 'test.completed');
}
function isConceptLedgerEvent(event, conceptId, runId) {
    if (!event || typeof event !== 'object')
        return false;
    const candidate = event;
    if (candidate.concept_id === conceptId || candidate.dag_id === conceptId)
        return true;
    return Boolean(runId && candidate.run_id === runId && typeof candidate.type === 'string');
}
function textValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function numberValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function booleanValue(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function recordValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function stringArrayValue(value) {
    if (!Array.isArray(value))
        return undefined;
    const values = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
    return values.length > 0 ? values : undefined;
}
const MAX_CONCEPT_TRACE_EVENTS = 2000;
function publicConceptRecord(record) {
    return Object.assign(Object.assign(Object.assign(Object.assign({}, record), { artifactRefs: record.artifactRefs.map(publicArtifactRef) }), (record.planRef ? { planRef: publicArtifactRef(record.planRef) } : {})), (record.critiqueRef ? { critiqueRef: publicArtifactRef(record.critiqueRef) } : {}));
}
function traceConceptRecord(record) {
    const concept = publicConceptRecord(record);
    return Object.assign(Object.assign(Object.assign(Object.assign({}, concept), { goal: redactSensitiveText(concept.goal) }), (concept.workspaceId ? { workspaceId: 'current-workspace' } : {})), (concept.error ? { error: redactSensitiveText(concept.error) } : {}));
}
function parseConceptInput(body) {
    const record = recordValue(body);
    if (!record)
        return { ok: false, error: 'body_must_be_object' };
    const goal = textValue(record.goal);
    if (!goal)
        return { ok: false, error: 'goal_required' };
    const conceptId = textValue(record.conceptId);
    if (conceptId && !CONCEPT_ID_PATTERN.test(conceptId))
        return { ok: false, error: 'invalid_concept_id' };
    const runId = textValue(record.runId);
    const input = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ goal }, (textValue(record.workspaceId) ? { workspaceId: textValue(record.workspaceId) } : {})), (conceptId ? { conceptId } : {})), (runId ? { runId } : {})), (booleanValue(record.dryRun) !== undefined ? { dryRun: booleanValue(record.dryRun) } : {})), (stringArrayValue(record.strategies) ? { strategies: stringArrayValue(record.strategies) } : {}));
    return { ok: true, input };
}
function conceptPhaseSummary(record) {
    return record.phases.map((phase) => ({
        phase,
        status: record.currentPhase === phase && record.status !== 'done' ? 'current' : 'completed',
    }));
}
function buildPublicConceptTrace(orchestration, record) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!((_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) === null || _a === void 0 ? void 0 : _a.byRun)) {
            throw new Error('event_ledger_unavailable');
        }
        const matchingEvents = (yield orchestration.eventLedger.byRun(record.runId))
            .filter((event) => isConceptLedgerEvent(event, record.conceptId, record.runId));
        const cappedEvents = matchingEvents.slice(-MAX_CONCEPT_TRACE_EVENTS);
        const events = cappedEvents.map(sanitizeForTrace);
        return {
            schemaVersion: 'pyrfor.concept_trace.v1',
            generatedAt: new Date().toISOString(),
            concept: traceConceptRecord(record),
            phases: conceptPhaseSummary(record),
            events,
            artifactIds: extractConceptArtifactIds(record, events),
            totalEvents: matchingEvents.length,
            truncated: matchingEvents.length > cappedEvents.length,
        };
    });
}
function sanitizeForTrace(event) {
    return sanitizeTrustPayload(event);
}
function buildPublicConceptIncidentPacket(trace) {
    return {
        schemaVersion: 'pyrfor.concept_incident_packet.v1',
        exportedAt: new Date().toISOString(),
        exportKind: 'incident-packet',
        trace,
        summary: {
            conceptId: trace.concept.conceptId,
            runId: trace.concept.runId,
            status: trace.concept.status,
            eventCount: trace.totalEvents,
            artifactCount: trace.artifactIds.length,
            traceTruncated: trace.truncated,
            terminalEvents: trace.events
                .filter((event) => isTerminalConceptLedgerEvent(event))
                .map((event) => event.type),
        },
    };
}
function publicConceptLessonsResponse(record, memoryStore) {
    const lessons = memoryStore.query({
        kind: 'lesson',
        tags: [`conceptId:${record.conceptId}`],
        limit: 25,
    })
        .filter((entry) => (entry.tags.includes('approved')
        && !entry.tags.includes('legacy')
        && !entry.tags.includes('rejected')
        && !entry.tags.includes('quarantined')
        && !entry.tags.includes('superseded')))
        .map((entry) => {
        const lesson = parseJsonRecord(entry.text);
        return Object.assign({ id: entry.id, kind: (lesson === null || lesson === void 0 ? void 0 : lesson.kind) === 'single_loop'
                ? 'single_loop'
                : (lesson === null || lesson === void 0 ? void 0 : lesson.kind) === 'double_loop'
                    ? 'double_loop'
                    : 'unknown', createdAt: entry.created_at, updatedAt: entry.updated_at, source: redactSensitiveText(entry.source), scope: redactSensitiveText(entry.scope), tags: entry.tags.map((tag) => redactSensitiveText(tag)), weight: entry.weight, approvalState: deriveLessonApprovalState(entry.tags), provenance: deriveLessonProvenance(entry.tags), summary: redactSensitiveText(describeLessonSummary(entry.text, lesson)) }, (lesson ? { lesson: sanitizeTrustPayload(lesson) } : {}));
    });
    return Object.assign(Object.assign({ conceptId: record.conceptId, runId: record.runId }, (record.postmortemRef ? { postmortemRef: publicArtifactRef(record.postmortemRef) } : {})), { lessons });
}
function parseJsonRecord(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch (_a) {
        return null;
    }
}
function parseKsReconciliationFindingReviewInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const body = value;
    if (body['action'] !== 'accept'
        && body['action'] !== 'reject'
        && body['action'] !== 'defer'
        && body['action'] !== 'escalate') {
        return null;
    }
    const reviewerId = textValue(body['reviewerId']);
    if (!reviewerId)
        return null;
    const reviewerComment = body['reviewerComment'] === undefined ? undefined : textValue(body['reviewerComment']);
    return Object.assign({ action: body['action'], reviewerId }, (reviewerComment !== undefined ? { reviewerComment } : {}));
}
function deriveLessonApprovalState(tags) {
    if (tags.includes('approved'))
        return 'approved';
    if (tags.includes('candidate'))
        return 'candidate';
    if (tags.includes('pending_approval'))
        return 'pending_approval';
    if (tags.includes('rejected'))
        return 'rejected';
    if (tags.includes('quarantined'))
        return 'quarantined';
    if (tags.includes('superseded'))
        return 'superseded';
    return 'unknown';
}
function deriveLessonProvenance(tags) {
    if (tags.includes('native'))
        return 'native';
    if (tags.includes('legacy'))
        return 'legacy';
    if (tags.includes('imported'))
        return 'imported';
    return 'unknown';
}
function describeLessonSummary(text, lesson) {
    if (!lesson)
        return text.slice(0, 220);
    if (lesson.kind === 'single_loop') {
        const rootCause = typeof lesson.defectRootCause === 'string' ? lesson.defectRootCause : 'lesson';
        const fixApplied = typeof lesson.fixApplied === 'string' ? lesson.fixApplied : 'recorded';
        return `${rootCause}: ${fixApplied}`;
    }
    if (lesson.kind === 'double_loop') {
        const changeType = typeof lesson.proposedChangeType === 'string' ? lesson.proposedChangeType : 'policy';
        const expectedImpact = typeof lesson.expectedImpact === 'string' ? lesson.expectedImpact : 'recorded';
        return `${changeType}: ${expectedImpact}`;
    }
    return text.slice(0, 220);
}
function buildPublicRunTimeline(result) {
    var _a, _b;
    const events = result.events.map((event) => sanitizeTrustPayload(event));
    const contextPack = result.contextPack
        ? {
            artifact: publicArtifactRef(result.contextPack.artifact),
            pack: sanitizeTrustPayload(publicContextPack(result.contextPack.pack)),
        }
        : null;
    return {
        schemaVersion: 'pyrfor.run_timeline.v1',
        generatedAt: new Date().toISOString(),
        run: sanitizeTrustPayload(result.run),
        summary: {
            eventCount: events.length,
            artifactCount: result.run.artifact_refs.length,
            latestEventType: (_b = (_a = events.at(-1)) === null || _a === void 0 ? void 0 : _a.type) !== null && _b !== void 0 ? _b : null,
            hasContextPack: result.contextPack !== null,
            hasDeliveryEvidence: result.deliveryEvidence !== null,
            replayAvailable: result.replay.available,
        },
        events,
        contextPack,
        deliveryEvidence: publicDeliveryEvidenceResponse(result.deliveryEvidence),
        replay: {
            available: result.replay.available,
            controlPath: `/api/runs/${encodeURIComponent(result.run.run_id)}/control`,
        },
    };
}
function extractConceptArtifactIds(record, events) {
    const ids = new Set();
    for (const ref of record.artifactRefs)
        ids.add(ref.id);
    if (record.planRef)
        ids.add(record.planRef.id);
    if (record.critiqueRef)
        ids.add(record.critiqueRef.id);
    for (const event of events) {
        collectArtifactIdsFromValue(event, ids);
    }
    return [...ids].sort();
}
function collectArtifactIdsFromValue(value, ids, key = '') {
    if (typeof value === 'string') {
        if (isArtifactIdKey(key) && value.trim()) {
            ids.add(value.trim());
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value)
            collectArtifactIdsFromValue(entry, ids, key);
        return;
    }
    if (value && typeof value === 'object') {
        for (const [entryKey, entryValue] of Object.entries(value)) {
            collectArtifactIdsFromValue(entryValue, ids, entryKey);
        }
    }
}
function isArtifactIdKey(key) {
    return key === 'artifact_id'
        || key === 'artifactId'
        || key === 'artifact_refs'
        || key === 'artifactRefs'
        || key.endsWith('_artifact_id')
        || key.endsWith('ArtifactId')
        || key.endsWith('_artifact_refs')
        || key.endsWith('ArtifactRefs');
}
function isTerminalConceptLedgerEvent(event) {
    if (!event || typeof event !== 'object')
        return false;
    const candidate = event;
    if (candidate.type === 'concept.completed')
        return true;
    if (candidate.type === 'run.failed' || candidate.type === 'run.cancelled')
        return true;
    return false;
}
function appendActorOutput(actor, value) {
    if (typeof value === 'string' && value.trim()) {
        actor.outputs.push(value.trim());
        return;
    }
    if (Array.isArray(value)) {
        actor.outputs.push(...value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()));
    }
}
function getOrCreateActor(actors, actorId) {
    const existing = actors.get(actorId);
    if (existing)
        return existing;
    const actor = {
        actorId,
        status: 'unknown',
        outputs: [],
        blockers: [],
        mailbox: { pending: 0, leased: 0, completed: 0, failed: 0 },
    };
    actors.set(actorId, actor);
    return actor;
}
function buildActorSnapshot(orchestration_1, runId_1) {
    return __awaiter(this, arguments, void 0, function* (orchestration, runId, options = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21;
        const actors = new Map();
        const now = Date.now();
        const staleAfterMs = options.staleAfterMs && options.staleAfterMs > 0 ? options.staleAfterMs : undefined;
        const actorMailboxNodes = ((_b = (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.dag) === null || _a === void 0 ? void 0 : _a.listNodes()) !== null && _b !== void 0 ? _b : [])
            .filter((node) => nodeBelongsToRun(node, runId) && node.kind.startsWith('actor.mailbox.'));
        const dagNodeById = new Map(((_d = (_c = orchestration === null || orchestration === void 0 ? void 0 : orchestration.dag) === null || _c === void 0 ? void 0 : _c.listNodes()) !== null && _d !== void 0 ? _d : []).map((node) => [node.id, node]));
        const actorMailboxNodeIds = new Set(actorMailboxNodes.map((node) => node.id));
        const run = yield getRunRecord(orchestration, runId);
        if (run) {
            const root = getOrCreateActor(actors, `run:${run.run_id}`);
            root.agentName = 'Run supervisor';
            root.role = run.mode;
            root.status = run.status === 'running' ? 'running'
                : run.status === 'blocked' ? 'blocked'
                    : run.status === 'failed' ? 'failed'
                        : run.status === 'completed' ? 'completed'
                            : 'idle';
            root.currentWork = (_e = textValue(run['goal'])) !== null && _e !== void 0 ? _e : run.task_id;
            root.updatedAt = run.updated_at;
            const budgetProfile = textValue(run.budget_profile);
            if (budgetProfile)
                root.budget = { profile: budgetProfile };
        }
        const events = yield listRunEvents(orchestration, runId);
        for (const event of events) {
            const payload = event;
            const actorId = (_h = (_g = (_f = textValue(payload['actor_id'])) !== null && _f !== void 0 ? _f : textValue(payload['actorId'])) !== null && _g !== void 0 ? _g : textValue(payload['agent_id'])) !== null && _h !== void 0 ? _h : textValue(payload['agentId']);
            if (!actorId)
                continue;
            const actor = getOrCreateActor(actors, actorId);
            actor.updatedAt = (_k = (_j = textValue(payload['ts'])) !== null && _j !== void 0 ? _j : textValue(payload['created_at'])) !== null && _k !== void 0 ? _k : actor.updatedAt;
            actor.agentId = (_m = (_l = textValue(payload['agent_id'])) !== null && _l !== void 0 ? _l : textValue(payload['agentId'])) !== null && _m !== void 0 ? _m : actor.agentId;
            actor.agentName = (_p = (_o = textValue(payload['agent_name'])) !== null && _o !== void 0 ? _o : textValue(payload['agentName'])) !== null && _p !== void 0 ? _p : actor.agentName;
            actor.role = (_q = textValue(payload['role'])) !== null && _q !== void 0 ? _q : actor.role;
            actor.parentActorId = (_s = (_r = textValue(payload['parent_actor_id'])) !== null && _r !== void 0 ? _r : textValue(payload['parentActorId'])) !== null && _s !== void 0 ? _s : actor.parentActorId;
            const eventType = (_t = textValue(payload['type'])) !== null && _t !== void 0 ? _t : '';
            const mailboxNodeId = (_u = textValue(payload['node_id'])) !== null && _u !== void 0 ? _u : textValue(payload['nodeId']);
            const dagBackedMailboxEvent = mailboxNodeId ? actorMailboxNodeIds.has(mailboxNodeId) : false;
            if (eventType === 'actor.spawned')
                actor.status = 'idle';
            if (eventType === 'actor.mailbox.enqueued' && !dagBackedMailboxEvent)
                actor.mailbox.pending += 1;
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
                    if (!dagBackedMailboxEvent)
                        actor.mailbox.pending += 1;
                    actor.status = 'idle';
                }
                else {
                    actor.status = 'failed';
                }
            }
            if (eventType === 'actor.work.started')
                actor.status = 'running';
            if (eventType === 'actor.work.completed')
                actor.status = 'completed';
            if (eventType === 'actor.blocked')
                actor.status = 'blocked';
            if (eventType === 'actor.failed')
                actor.status = 'failed';
            actor.currentWork = (_x = (_w = (_v = textValue(payload['current_work'])) !== null && _v !== void 0 ? _v : textValue(payload['currentWork'])) !== null && _w !== void 0 ? _w : textValue(payload['task'])) !== null && _x !== void 0 ? _x : actor.currentWork;
            appendActorOutput(actor, payload['summary']);
            appendActorOutput(actor, payload['output']);
            appendActorOutput(actor, payload['highlights']);
            const blocker = (_z = (_y = textValue(payload['blocker'])) !== null && _y !== void 0 ? _y : textValue(payload['reason'])) !== null && _z !== void 0 ? _z : textValue(payload['error']);
            if (blocker && (actor.status === 'blocked' || actor.status === 'failed'))
                actor.blockers.push(blocker);
            const budget = recordValue(payload['budget']);
            if (budget) {
                actor.budget = {
                    profile: (_0 = textValue(budget['profile'])) !== null && _0 !== void 0 ? _0 : (_1 = actor.budget) === null || _1 === void 0 ? void 0 : _1.profile,
                    tokensUsed: (_2 = numberValue(budget['tokensUsed'])) !== null && _2 !== void 0 ? _2 : (_3 = actor.budget) === null || _3 === void 0 ? void 0 : _3.tokensUsed,
                    tokenLimit: (_4 = numberValue(budget['tokenLimit'])) !== null && _4 !== void 0 ? _4 : (_5 = actor.budget) === null || _5 === void 0 ? void 0 : _5.tokenLimit,
                    toolCallsUsed: (_6 = numberValue(budget['toolCallsUsed'])) !== null && _6 !== void 0 ? _6 : (_7 = actor.budget) === null || _7 === void 0 ? void 0 : _7.toolCallsUsed,
                    toolCallLimit: (_8 = numberValue(budget['toolCallLimit'])) !== null && _8 !== void 0 ? _8 : (_9 = actor.budget) === null || _9 === void 0 ? void 0 : _9.toolCallLimit,
                    exhausted: typeof budget['exhausted'] === 'boolean' ? budget['exhausted'] : (_10 = actor.budget) === null || _10 === void 0 ? void 0 : _10.exhausted,
                };
            }
        }
        for (const node of actorMailboxNodes) {
            const actorId = (_14 = (_12 = textValue((_11 = node.payload) === null || _11 === void 0 ? void 0 : _11['actorId'])) !== null && _12 !== void 0 ? _12 : textValue((_13 = node.payload) === null || _13 === void 0 ? void 0 : _13['actor_id'])) !== null && _14 !== void 0 ? _14 : 'unknown';
            const actor = getOrCreateActor(actors, actorId);
            if (node.status === 'pending' || node.status === 'ready') {
                const dependencyBlocked = ((_15 = node.dependsOn) !== null && _15 !== void 0 ? _15 : []).some((dep) => { var _a; return ((_a = dagNodeById.get(dep)) === null || _a === void 0 ? void 0 : _a.status) !== 'succeeded'; });
                if (dependencyBlocked) {
                    actor.mailbox.blocked = ((_16 = actor.mailbox.blocked) !== null && _16 !== void 0 ? _16 : 0) + 1;
                }
                else {
                    actor.mailbox.pending += 1;
                    const pendingAgeMs = Math.max(0, now - node.updatedAt);
                    actor.mailbox.oldestPendingAgeMs = Math.max((_17 = actor.mailbox.oldestPendingAgeMs) !== null && _17 !== void 0 ? _17 : 0, pendingAgeMs);
                }
            }
            if (node.status === 'leased' || node.status === 'running')
                actor.mailbox.leased += 1;
            if (staleAfterMs !== undefined && (node.status === 'leased' || node.status === 'running')) {
                const leasedAgeMs = now - ((_19 = (_18 = node.lease) === null || _18 === void 0 ? void 0 : _18.leasedAt) !== null && _19 !== void 0 ? _19 : node.updatedAt);
                if (leasedAgeMs >= staleAfterMs) {
                    actor.mailbox.stale = ((_20 = actor.mailbox.stale) !== null && _20 !== void 0 ? _20 : 0) + 1;
                    actor.mailbox.oldestLeasedAgeMs = Math.max((_21 = actor.mailbox.oldestLeasedAgeMs) !== null && _21 !== void 0 ? _21 : 0, leasedAgeMs);
                }
            }
            if (node.status === 'succeeded')
                actor.mailbox.completed += 1;
            if (node.status === 'failed')
                actor.mailbox.failed += 1;
        }
        const items = [...actors.values()]
            .map((actor) => (Object.assign(Object.assign({}, actor), { status: actor.status === 'completed' && (actor.mailbox.pending > 0 || actor.mailbox.leased > 0)
                ? actor.mailbox.leased > 0 ? 'running' : 'idle'
                : actor.status === 'running' && actor.mailbox.leased === 0 && actor.mailbox.pending > 0
                    ? 'idle'
                    : actor.status })))
            .map((actor) => (Object.assign(Object.assign({}, actor), { outputs: [...new Set(actor.outputs)].slice(-5), blockers: [...new Set(actor.blockers)].slice(-5) })))
            .sort((a, b) => a.actorId.localeCompare(b.actorId));
        const mailboxPending = items.reduce((sum, actor) => sum + actor.mailbox.pending, 0);
        const mailboxBlocked = items.reduce((sum, actor) => { var _a; return sum + ((_a = actor.mailbox.blocked) !== null && _a !== void 0 ? _a : 0); }, 0);
        const oldestPendingAgeMs = items.reduce((oldest, actor) => {
            if (actor.mailbox.pending <= 0 || actor.mailbox.oldestPendingAgeMs === undefined)
                return oldest;
            return Math.max(oldest !== null && oldest !== void 0 ? oldest : 0, actor.mailbox.oldestPendingAgeMs);
        }, undefined);
        const mailboxStale = staleAfterMs !== undefined
            ? items.reduce((sum, actor) => { var _a; return sum + ((_a = actor.mailbox.stale) !== null && _a !== void 0 ? _a : 0); }, 0)
            : undefined;
        const oldestLeasedAgeMs = staleAfterMs !== undefined
            ? items.reduce((oldest, actor) => {
                if (!actor.mailbox.stale || actor.mailbox.oldestLeasedAgeMs === undefined)
                    return oldest;
                return Math.max(oldest !== null && oldest !== void 0 ? oldest : 0, actor.mailbox.oldestLeasedAgeMs);
            }, undefined)
            : undefined;
        return {
            runId,
            actors: items,
            totals: Object.assign(Object.assign(Object.assign(Object.assign({ actors: items.length, running: items.filter((actor) => actor.status === 'running').length, blocked: items.filter((actor) => actor.status === 'blocked').length, failed: items.filter((actor) => actor.status === 'failed').length, mailboxPending }, (mailboxBlocked > 0 ? { mailboxBlocked } : {})), (mailboxPending > 0 && oldestPendingAgeMs !== undefined ? { oldestPendingAgeMs } : {})), (mailboxStale !== undefined ? { mailboxStale } : {})), (mailboxStale && oldestLeasedAgeMs !== undefined ? { oldestLeasedAgeMs } : {})),
        };
    });
}
function listActorMailboxMessages(orchestration, runId, options = {}) {
    var _a, _b;
    const now = Date.now();
    const staleAfterMs = options.staleAfterMs && options.staleAfterMs > 0 ? options.staleAfterMs : undefined;
    const nodes = (_b = (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.dag) === null || _a === void 0 ? void 0 : _a.listNodes()) !== null && _b !== void 0 ? _b : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return nodes
        .filter((node) => nodeBelongsToRun(node, runId) && node.kind === 'actor.mailbox.task')
        .map((node) => {
        var _a, _b, _c, _d, _e, _f;
        const payload = (_a = node.payload) !== null && _a !== void 0 ? _a : {};
        const dependencyBlocked = ((_b = node.dependsOn) !== null && _b !== void 0 ? _b : []).some((dep) => { var _a; return ((_a = nodeById.get(dep)) === null || _a === void 0 ? void 0 : _a.status) !== 'succeeded'; });
        const leaseAgeMs = node.lease ? Math.max(0, now - ((_c = node.lease.leasedAt) !== null && _c !== void 0 ? _c : node.updatedAt)) : undefined;
        const nodeId = redactSensitiveText(node.id).slice(0, 180);
        const actorId = redactSensitiveText((_e = (_d = textValue(payload['actorId'])) !== null && _d !== void 0 ? _d : textValue(payload['actor_id'])) !== null && _e !== void 0 ? _e : 'unknown').slice(0, 180);
        const agentId = textValue(payload['agentId']);
        const task = textValue(payload['task']);
        const priority = numberValue(payload['priority']);
        const allowConcurrent = booleanValue(payload['allowConcurrent']);
        return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ nodeId,
            actorId }, (agentId ? { agentId: redactSensitiveText(agentId).slice(0, 180) } : {})), (task ? { task: redactSensitiveText(task).slice(0, 240) } : {})), { status: node.status }), (priority !== undefined ? { priority } : {})), (allowConcurrent !== undefined ? { allowConcurrent } : {})), { dependsOn: [...((_f = node.dependsOn) !== null && _f !== void 0 ? _f : [])].map((dep) => redactSensitiveText(dep).slice(0, 180)), dependencyBlocked }), (node.lease ? {
            lease: Object.assign(Object.assign({ owner: redactSensitiveText(node.lease.owner).slice(0, 120), leasedAt: node.lease.leasedAt, expiresAt: node.lease.expiresAt }, (staleAfterMs !== undefined ? { stale: leaseAgeMs !== undefined && leaseAgeMs >= staleAfterMs } : {})), (leaseAgeMs !== undefined ? { ageMs: leaseAgeMs } : {})),
        } : {})), (node.failure ? {
            failure: {
                reason: redactSensitiveText(node.failure.reason).slice(0, 240),
                retryable: node.failure.retryable,
            },
        } : {})), { createdAt: node.createdAt, updatedAt: node.updatedAt });
    })
        .sort((a, b) => {
        var _a, _b;
        return ((_a = b.priority) !== null && _a !== void 0 ? _a : 0) - ((_b = a.priority) !== null && _b !== void 0 ? _b : 0)
            || a.createdAt - b.createdAt
            || a.nodeId.localeCompare(b.nodeId);
    });
}
function latestByCreatedAt(items) {
    var _a;
    return (_a = [...items].sort((a, b) => { var _a, _b; return String((_a = b.createdAt) !== null && _a !== void 0 ? _a : '').localeCompare(String((_b = a.createdAt) !== null && _b !== void 0 ? _b : '')); })[0]) !== null && _a !== void 0 ? _a : null;
}
function nodeBelongsToRun(node, runId) {
    var _a, _b, _c;
    return ((_a = node.payload) === null || _a === void 0 ? void 0 : _a['runId']) === runId ||
        ((_b = node.payload) === null || _b === void 0 ? void 0 : _b['run_id']) === runId ||
        ((_c = node.provenance) !== null && _c !== void 0 ? _c : []).some((link) => link.kind === 'run' && link.ref === runId);
}
function sanitizePublicDagCapability(value) {
    var _a, _b;
    const capability = recordValue(value);
    const kind = (_a = textValue(capability === null || capability === void 0 ? void 0 : capability['kind'])) !== null && _a !== void 0 ? _a : 'unknown';
    if (kind !== 'research_source_capture') {
        return { kind: 'unsupported' };
    }
    const publicSourceHost = textValue(capability === null || capability === void 0 ? void 0 : capability['sourceHost']);
    const publicSourceUrlHash = textValue(capability === null || capability === void 0 ? void 0 : capability['sourceUrlHash']);
    const publicSourcePathHash = textValue(capability === null || capability === void 0 ? void 0 : capability['sourcePathHash']);
    if (publicSourceHost || publicSourceUrlHash || publicSourcePathHash) {
        return Object.assign(Object.assign(Object.assign({ kind: 'research_source_capture' }, (publicSourceHost ? { sourceHost: redactSensitiveText(publicSourceHost).slice(0, 180) } : {})), (publicSourceUrlHash ? { sourceUrlHash: redactSensitiveText(publicSourceUrlHash).slice(0, 128) } : {})), (publicSourcePathHash ? { sourcePathHash: redactSensitiveText(publicSourcePathHash).slice(0, 128) } : {}));
    }
    try {
        const note = textValue(capability === null || capability === void 0 ? void 0 : capability['note']);
        const normalized = normalizeResearchSourceCaptureInput(Object.assign({ url: (_b = textValue(capability === null || capability === void 0 ? void 0 : capability['url'])) !== null && _b !== void 0 ? _b : '' }, (note ? { note } : {})));
        return {
            kind: 'research_source_capture',
            sourceHost: normalized.host,
            sourceUrlHash: normalized.urlHash,
            sourcePathHash: normalized.pathHash,
        };
    }
    catch (_c) {
        return { kind: 'research_source_capture', invalid: true };
    }
}
function sanitizePublicActorMailboxPayload(payload) {
    var _a, _b, _c;
    const publicPayload = {};
    const runId = (_a = textValue(payload['runId'])) !== null && _a !== void 0 ? _a : textValue(payload['run_id']);
    const actorId = (_b = textValue(payload['actorId'])) !== null && _b !== void 0 ? _b : textValue(payload['actor_id']);
    const agentId = (_c = textValue(payload['agentId'])) !== null && _c !== void 0 ? _c : textValue(payload['agent_id']);
    const task = textValue(payload['task']);
    const priority = numberValue(payload['priority']);
    const allowConcurrent = booleanValue(payload['allowConcurrent']);
    if (runId)
        publicPayload['runId'] = redactSensitiveText(runId).slice(0, 180);
    if (actorId)
        publicPayload['actorId'] = redactSensitiveText(actorId).slice(0, 180);
    if (agentId)
        publicPayload['agentId'] = redactSensitiveText(agentId).slice(0, 180);
    if (task)
        publicPayload['task'] = redactSensitiveText(task).slice(0, 240);
    if (priority !== undefined)
        publicPayload['priority'] = priority;
    if (allowConcurrent !== undefined)
        publicPayload['allowConcurrent'] = allowConcurrent;
    const nestedPayload = recordValue(payload['payload']);
    if (nestedPayload && Object.prototype.hasOwnProperty.call(nestedPayload, 'capability')) {
        publicPayload['payload'] = {
            capability: sanitizePublicDagCapability(nestedPayload['capability']),
        };
    }
    return publicPayload;
}
function sanitizePublicDagNode(node) {
    var _a;
    const sanitized = sanitizeTrustPayload(node);
    if (node.kind !== 'actor.mailbox.task')
        return sanitized;
    return Object.assign(Object.assign({}, sanitized), { payload: sanitizePublicActorMailboxPayload((_a = node.payload) !== null && _a !== void 0 ? _a : {}) });
}
function sanitizeActorDispatchResult(dispatch) {
    const sanitized = sanitizeTrustPayload(dispatch);
    if (dispatch.lease) {
        sanitized.lease = Object.assign(Object.assign({}, sanitizeTrustPayload(dispatch.lease)), { node: sanitizePublicDagNode(dispatch.lease.node) });
    }
    if (dispatch.completion) {
        sanitized.completion = Object.assign(Object.assign({}, sanitizeTrustPayload(dispatch.completion)), { node: sanitizePublicDagNode(dispatch.completion.node) });
    }
    if (dispatch.failure)
        sanitized.failure = sanitizePublicDagNode(dispatch.failure);
    if (dispatch.approval)
        sanitized.approval = sanitizeApprovalRequest(dispatch.approval);
    return sanitized;
}
function listRunEvents(orchestration, runId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger)
            return orchestration.runLedger.eventsForRun(runId);
        return (_b = (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) === null || _a === void 0 ? void 0 : _a.byRun(runId)) !== null && _b !== void 0 ? _b : [];
    });
}
function getRunRecord(orchestration, runId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const cached = (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _a === void 0 ? void 0 : _a.getRun(runId);
        if (cached)
            return cached;
        return (_b = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _b === void 0 ? void 0 : _b.replayRun(runId);
    });
}
function listWorkerFrames(orchestration, runId) {
    var _a, _b;
    return (_b = (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.dag) === null || _a === void 0 ? void 0 : _a.listNodes().filter((node) => nodeBelongsToRun(node, runId) && node.kind.startsWith('worker.frame.')).map((node) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const frameLink = ((_a = node.provenance) !== null && _a !== void 0 ? _a : []).find((link) => link.kind === 'worker_frame');
        return {
            nodeId: node.id,
            frame_id: (_b = frameLink === null || frameLink === void 0 ? void 0 : frameLink.ref) !== null && _b !== void 0 ? _b : node.id,
            type: String((_d = (_c = node.payload) === null || _c === void 0 ? void 0 : _c['frameType']) !== null && _d !== void 0 ? _d : node.kind.replace(/^worker\.frame\./, '')),
            source: (_e = node.payload) === null || _e === void 0 ? void 0 : _e['source'],
            disposition: (_f = node.payload) === null || _f === void 0 ? void 0 : _f['disposition'],
            ok: (_g = node.payload) === null || _g === void 0 ? void 0 : _g['ok'],
            seq: (_h = node.payload) === null || _h === void 0 ? void 0 : _h['seq'],
            ts: node.updatedAt,
            payload: node.payload,
        };
    })) !== null && _b !== void 0 ? _b : [];
}
function listPendingEffects(orchestration) {
    return __awaiter(this, void 0, void 0, function* () {
        const events = (orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) ? yield orchestration.eventLedger.readAll() : [];
        const proposed = new Map();
        const policy = new Map();
        const settled = new Set();
        for (const event of events.filter(isOrchestrationEvent)) {
            if (event.type === 'effect.proposed')
                proposed.set(event.effect_id, event);
            if (event.type === 'effect.policy_decided')
                policy.set(event.effect_id, event);
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
                decision: verdict === null || verdict === void 0 ? void 0 : verdict.decision,
                policy_id: verdict === null || verdict === void 0 ? void 0 : verdict.policy_id,
                reason: verdict === null || verdict === void 0 ? void 0 : verdict.reason,
                approval_required: verdict === null || verdict === void 0 ? void 0 : verdict.approval_required,
            };
        })
            .sort((a, b) => { var _a, _b; return Number((_a = a.proposed_seq) !== null && _a !== void 0 ? _a : 0) - Number((_b = b.proposed_seq) !== null && _b !== void 0 ? _b : 0); });
    });
}
function buildOrchestrationDashboard(orchestration_1) {
    return __awaiter(this, arguments, void 0, function* (orchestration, approvalsPending = 0) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const runs = (_b = (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _a === void 0 ? void 0 : _a.listRuns()) !== null && _b !== void 0 ? _b : [];
        const nodes = (_d = (_c = orchestration === null || orchestration === void 0 ? void 0 : orchestration.dag) === null || _c === void 0 ? void 0 : _c.listNodes()) !== null && _d !== void 0 ? _d : [];
        const events = (orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) ? yield orchestration.eventLedger.readAll() : [];
        const kernelEvents = events.filter(isOrchestrationEvent);
        const pendingEffects = yield listPendingEffects(orchestration);
        const contextPacks = (orchestration === null || orchestration === void 0 ? void 0 : orchestration.artifactStore)
            ? yield orchestration.artifactStore.list({ kind: 'context_pack' })
            : [];
        const overlays = (_f = (_e = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _e === void 0 ? void 0 : _e.list()) !== null && _f !== void 0 ? _f : [];
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
                status: (_g = latestVerifier === null || latestVerifier === void 0 ? void 0 : latestVerifier.status) !== null && _g !== void 0 ? _g : null,
                latest: latestVerifier !== null && latestVerifier !== void 0 ? latestVerifier : null,
            },
            workerFrames: {
                total: workerFrameNodes.length,
                pending: workerFrameNodes.filter((node) => node.status === 'pending' || node.status === 'ready' || node.status === 'running' || node.status === 'leased').length,
                lastType: (_k = (_j = (_h = workerFrameNodes[workerFrameNodes.length - 1]) === null || _h === void 0 ? void 0 : _h.payload) === null || _j === void 0 ? void 0 : _j['frameType']) !== null && _k !== void 0 ? _k : null,
            },
            contextPack: latestByCreatedAt(contextPacks),
            overlays: {
                total: overlays.length,
                domainIds: overlays.map((overlay) => overlay.domainId).sort(),
            },
        };
    });
}
function buildConnectorProbeApprovalId(connectorId) {
    return `connector-live-probe:${connectorId}`;
}
function buildResearchSearchApprovalId(runId, query, maxResults, provider) {
    const digest = createHash('sha256').update(`${runId}:${query.trim()}:${maxResults}:${provider}`).digest('hex').slice(0, 24);
    return `research-search:${digest}`;
}
function hashResearchSearchQuery(query) {
    return createHash('sha256').update(query.trim()).digest('hex');
}
function publicArtifactRef(ref) {
    const { uri: _uri } = ref, publicRef = __rest(ref, ["uri"]);
    return publicRef;
}
function publicDomainOverlay(manifest) {
    var _a, _b, _c, _d, _e, _f;
    return {
        schemaVersion: manifest.schemaVersion,
        domainId: manifest.domainId,
        version: manifest.version,
        title: manifest.title,
        workflowCount: (_b = (_a = manifest.workflowTemplates) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0,
        adapterCount: (_d = (_c = manifest.adapterRegistrations) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0,
        privacyRuleIds: ((_e = manifest.privacyRules) !== null && _e !== void 0 ? _e : []).map((rule) => rule.id).filter(Boolean).sort(),
        toolPermissionSummaries: Object.entries((_f = manifest.toolPermissionOverrides) !== null && _f !== void 0 ? _f : {})
            .map(([toolName, permission]) => `${toolName}:${permission}`)
            .sort(),
    };
}
function publicContinuityArtifactRef(ref) {
    var _a;
    const publicRef = publicArtifactRef(ref);
    const safeMeta = Object.fromEntries(Object.entries((_a = publicRef.meta) !== null && _a !== void 0 ? _a : {}).filter(([key]) => key !== 'workspaceId'));
    return Object.assign(Object.assign({}, publicRef), (Object.keys(safeMeta).length > 0 ? { meta: sanitizeTrustPayload(safeMeta) } : {}));
}
function publicDeliveryEvidenceResponse(evidence) {
    if (!evidence)
        return { artifact: null, snapshot: null };
    return {
        artifact: publicArtifactRef(evidence.artifact),
        snapshot: publicDeliveryEvidenceSnapshot(evidence.snapshot),
    };
}
function publicDeliveryEvidenceSnapshot(snapshot) {
    const publicSnapshot = sanitizeTrustPayload(snapshot);
    const remote = publicSnapshot.git.remote;
    if ((remote === null || remote === void 0 ? void 0 : remote.url) && (remote.url.startsWith('file:') || remote.url.includes('[redacted-path]') || !remote.repository)) {
        return Object.assign(Object.assign({}, publicSnapshot), { git: Object.assign(Object.assign({}, publicSnapshot.git), { remote: null }) });
    }
    return publicSnapshot;
}
function publicGithubDeliveryPlanResponse(plan) {
    if (!plan)
        return { artifact: null, plan: null };
    return Object.assign(Object.assign(Object.assign({}, plan), { artifact: publicArtifactRef(plan.artifact), plan: sanitizeTrustPayload(plan.plan) }), (plan.evidenceArtifact ? { evidenceArtifact: publicArtifactRef(plan.evidenceArtifact) } : {}));
}
function publicGithubDeliveryApplyState(apply) {
    if (!apply)
        return { artifact: null, result: null };
    return Object.assign(Object.assign({}, apply), { artifact: publicArtifactRef(apply.artifact) });
}
function publicKsReconciliationReviewPackState(review) {
    if (!review)
        return { artifact: null, reviewPack: null };
    return {
        artifact: publicArtifactRef(review.artifact),
        reviewPack: sanitizeTrustPayload(review.reviewPack),
    };
}
function sanitizeHealthValue(value, key = '') {
    if (value === null || value === undefined)
        return value;
    if (typeof value === 'string') {
        return SENSITIVE_METADATA_KEY_RE.test(key) ? '[redacted]' : redactSensitiveText(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (value instanceof Date)
        return value.toISOString();
    if (value instanceof URL)
        return redactSensitiveText(value.toString());
    if (Array.isArray(value))
        return value.map((entry) => sanitizeHealthValue(entry, key));
    if (typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return redactSensitiveText(String(value));
        }
        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeHealthValue(entryValue, entryKey),
        ]));
    }
    return value;
}
function publicHealthSnapshot(snapshot) {
    return sanitizeHealthValue(snapshot);
}
function publicGithubDeliveryApplyResponse(response) {
    if (!response || typeof response !== 'object')
        return response;
    const candidate = response;
    if (candidate.status !== 'applied' || !candidate.artifact || typeof candidate.artifact !== 'object')
        return response;
    return Object.assign(Object.assign({}, candidate), { artifact: publicArtifactRef(candidate.artifact) });
}
function publicMemoryContinuityStatus(status) {
    const publicStatus = Object.assign(Object.assign({}, status), { workspaceId: 'current-workspace', latestDailyRollup: Object.assign(Object.assign({}, status.latestDailyRollup), (status.latestDailyRollup.artifact ? { artifact: publicContinuityArtifactRef(status.latestDailyRollup.artifact) } : {})), latestProjectRollup: Object.assign(Object.assign({}, status.latestProjectRollup), (status.latestProjectRollup.artifact ? { artifact: publicContinuityArtifactRef(status.latestProjectRollup.artifact) } : {})), latestOpenClawReport: Object.assign(Object.assign({}, status.latestOpenClawReport), (status.latestOpenClawReport.artifact ? { artifact: publicContinuityArtifactRef(status.latestOpenClawReport.artifact) } : {})) });
    return publicStatus;
}
function publicMemorySearchHit(hit) {
    const { workspaceId: _workspaceId } = hit, publicHit = __rest(hit, ["workspaceId"]);
    return publicHit;
}
function publicMemorySearchResponse(result) {
    return Object.assign(Object.assign({}, result), { workspaceId: 'current-workspace', results: result.results.map((hit) => publicMemorySearchHit(hit)) });
}
function publicPendingMemoryReviewsResponse(result) {
    return {
        memoryReviews: result.memoryReviews.map((hit) => publicMemorySearchHit(hit)),
    };
}
function publicMemoryMutationResponse(result) {
    return Object.assign(Object.assign({}, result), { memory: publicMemorySearchHit(result.memory) });
}
function publicBlockEntry(entry) {
    var _a, _b, _c;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ blockId: entry.blockId }, (entry.projectId ? { projectId: entry.projectId } : {})), { version: (_a = entry.version) !== null && _a !== void 0 ? _a : entry.manifest.version, status: entry.status, registeredAt: entry.registeredAt }), (entry.error ? { error: redactSensitiveText(entry.error) } : {})), (entry.manifestRef ? { manifestRef: publicArtifactRef(entry.manifestRef) } : {})), { metadata: sanitizeTrustPayload({
            name: entry.manifest.name,
            description: entry.manifest.description,
            author: entry.manifest.author,
            runtimeMode: entry.manifest.runtime.mode,
            sandbox: entry.manifest.security.sandbox,
            certificationState: entry.manifest.certification.state,
            capabilities: entry.manifest.capabilities.map((capability) => capability.token),
            consumedContracts: entry.manifest.contracts.consumes.map((contract) => contract.ref),
            producedContracts: entry.manifest.contracts.produces.map((contract) => contract.ref),
            panelCount: (_c = (_b = entry.manifest.panels) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0,
            memoryNamespaces: entry.memoryScopeMap ? [...entry.memoryScopeMap.keys()].sort() : [],
        }) });
}
function publicBlockOperationResponse(result) {
    var _a;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ ok: result.ok, blockId: result.blockId, status: (_a = result.status) !== null && _a !== void 0 ? _a : 'error' }, (result.entry ? { block: publicBlockEntry(result.entry) } : {})), (result.error ? { error: redactSensitiveText(result.error) } : {})), (result.manifestRef ? { manifestRef: publicArtifactRef(result.manifestRef) } : {})), (result.resultRef ? { resultRef: publicArtifactRef(result.resultRef) } : {})), { warnings: result.warnings.map((warning) => redactSensitiveText(warning)), registeredCapabilityTools: [...result.registeredCapabilityTools], registeredContractRefs: [...result.registeredContractRefs] }), (result.report ? {
        validation: {
            status: result.report.status,
            errors: result.report.errors.map((issue) => sanitizeTrustPayload(issue)),
            warnings: result.report.warnings.map((issue) => sanitizeTrustPayload(issue)),
            summary: sanitizeTrustPayload(result.report.summary),
        },
    } : {}));
}
function resolveBlockRegistry(orchestration) {
    var _a;
    return (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.blockRegistry) !== null && _a !== void 0 ? _a : null;
}
function resolveBlockCatalogStore(orchestration) {
    var _a;
    return (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.blockCatalogStore) !== null && _a !== void 0 ? _a : null;
}
function resolveCapabilityToolRegistry(orchestration) {
    var _a;
    return (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.capabilityToolRegistry) !== null && _a !== void 0 ? _a : null;
}
function resolveContractRegistry(orchestration) {
    var _a;
    return (_a = orchestration === null || orchestration === void 0 ? void 0 : orchestration.contractRegistry) !== null && _a !== void 0 ? _a : null;
}
function publicOpenClawMigrationReport(report) {
    return Object.assign(Object.assign({}, sanitizeTrustPayload(report)), { workspaceId: 'current-workspace', sourceRoot: 'openclaw-source' });
}
function publicOpenClawMigrationPreviewResponse(result) {
    return {
        artifact: publicContinuityArtifactRef(result.artifact),
        report: publicOpenClawMigrationReport(result.report),
    };
}
function publicOpenClawMigrationImportResult(result) {
    return Object.assign(Object.assign({}, result), { artifact: publicContinuityArtifactRef(result.artifact) });
}
function publicOpenClawMigrationRollbackResult(result) {
    return Object.assign(Object.assign({}, result), { workspaceId: 'current-workspace', artifact: publicContinuityArtifactRef(result.artifact) });
}
function publicOpenClawMigrationVerificationResult(result) {
    return Object.assign(Object.assign({}, result), { artifact: publicContinuityArtifactRef(result.artifact) });
}
function publicOpenClawMigrationAuditView(result) {
    return Object.assign(Object.assign({}, result), { workspaceId: 'current-workspace', migrations: result.migrations.map((migration) => (Object.assign(Object.assign(Object.assign(Object.assign({}, migration), { workspaceId: 'current-workspace', importArtifact: publicContinuityArtifactRef(migration.importArtifact) }), (migration.latestVerification ? {
            latestVerification: Object.assign(Object.assign({}, migration.latestVerification), { artifact: publicContinuityArtifactRef(migration.latestVerification.artifact) }),
        } : {})), (migration.latestRollback ? {
            latestRollback: Object.assign(Object.assign({}, migration.latestRollback), { artifact: publicContinuityArtifactRef(migration.latestRollback.artifact) }),
        } : {})))) });
}
function publicOpenClawMigrationQuarantineState(result) {
    return Object.assign(Object.assign({}, result), { workspaceId: 'current-workspace' });
}
const MAX_CONTEXT_SECTION_CONTENT_CHARS = 600;
function compactPublicContextContent(value) {
    let raw;
    try {
        raw = typeof value === 'string' ? value : JSON.stringify(value);
    }
    catch (_a) {
        raw = String(value);
    }
    const singleLine = raw.replace(/\s+/g, ' ').trim();
    return singleLine.length <= MAX_CONTEXT_SECTION_CONTENT_CHARS
        ? singleLine
        : `${singleLine.slice(0, MAX_CONTEXT_SECTION_CONTENT_CHARS - 1)}…`;
}
function publicContextPack(pack) {
    return Object.assign(Object.assign({}, pack), { task: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, pack.task), { title: compactPublicContextContent(pack.task.title) }), (pack.task.description ? { description: compactPublicContextContent(pack.task.description) } : {})), (pack.task.acceptanceCriteria ? { acceptanceCriteria: pack.task.acceptanceCriteria.map((item) => compactPublicContextContent(item)) } : {})), (pack.task.constraints ? { constraints: pack.task.constraints.map((item) => compactPublicContextContent(item)) } : {})), (pack.task.nonGoals ? { nonGoals: pack.task.nonGoals.map((item) => compactPublicContextContent(item)) } : {})), sections: pack.sections.map((section) => (Object.assign(Object.assign({}, section), { content: compactPublicContextContent(section.content) }))) });
}
const SENSITIVE_KEY_PATTERN = '(?:token|secret|password|passwd|credential|signature|api[_-]?key|access[_-]?key|awsaccesskeyid|key[_-]?pair[_-]?id|(?:access|refresh|id|client|api|private|secret|auth|github|session)[A-Za-z0-9_.-]*(?:token|secret|password|passwd|credential|signature|key)|[A-Za-z0-9]+(?:[_-](?:token|secret|password|passwd|credential|signature|api[_-]?key|access[_-]?key|key))+[A-Za-z0-9_-]*)';
const SENSITIVE_METADATA_KEY_RE = new RegExp(`^(?:authorization|auth|${SENSITIVE_KEY_PATTERN})$`, 'i');
const URL_METADATA_KEY_RE = /(url|uri|endpoint)/i;
const SENSITIVE_QUERY_KEY_RE = /(token|secret|password|passwd|credential|authorization|auth|api[_-]?key|access[_-]?key|signature|sig|awsaccesskeyid|key[_-]?pair[_-]?id)/i;
const URL_TEXT_RE = /\bhttps?:\/\/[^\s<>"'`)]+/g;
const FILE_URL_TEXT_RE = /\bfile:\/\/[^\s<>"'`)]+/g;
const NON_HTTP_URI_TEXT_RE = /\b(?!https?:\/\/)(?!file:\/\/)[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`)]+/gi;
const TILDE_PATH_TEXT_RE = /(^|[\s([{:=<>"'`-])(~\/[^\s<>"'`)]+)/g;
const LOCAL_PATH_TEXT_RE = /(^|[\s([{:=<>"'`-])(\/(?!\/)[^\s<>"'`)]+)/g;
const AUTH_ASSIGNMENT_RE = /((?:"|')?\bauthorization\b(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\n;]+)/gi;
const SECRET_ASSIGNMENT_RE = new RegExp(`((?:"|')?\\b${SENSITIVE_KEY_PATTERN}\\b(?:"|')?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|\`[^\`]*\`|[^\\s,;}\\]]+)`, 'gi');
const AUTH_HEADER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
function sanitizeUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (url.username)
            url.username = 'redacted';
        if (url.password)
            url.password = 'redacted';
        for (const key of Array.from(url.searchParams.keys())) {
            if (SENSITIVE_QUERY_KEY_RE.test(key)) {
                url.searchParams.set(key, 'redacted');
            }
        }
        url.hash = '';
        return url.toString();
    }
    catch (_a) {
        return '[redacted-url]';
    }
}
function redactSensitiveText(value) {
    let redacted = value
        .replace(URL_TEXT_RE, (url) => sanitizeUrl(url))
        .replace(FILE_URL_TEXT_RE, 'file://[redacted-path]')
        .replace(NON_HTTP_URI_TEXT_RE, '[redacted-uri]')
        .replace(TILDE_PATH_TEXT_RE, (_match, prefix) => `${prefix}~/[redacted-path]`)
        .replace(LOCAL_PATH_TEXT_RE, (_match, prefix) => `${prefix}[redacted-path]`)
        .replace(AUTH_ASSIGNMENT_RE, (_match, prefix) => `${prefix}[redacted]`)
        .replace(SECRET_ASSIGNMENT_RE, (_match, prefix) => `${prefix}[redacted]`)
        .replace(AUTH_HEADER_RE, (match) => `${match.startsWith('Basic') ? 'Basic' : 'Bearer'} [redacted]`);
    for (const [key, rawEnvValue] of Object.entries(process.env)) {
        const envValue = rawEnvValue === null || rawEnvValue === void 0 ? void 0 : rawEnvValue.trim();
        if (!envValue || envValue.length < 8 || !SENSITIVE_METADATA_KEY_RE.test(key))
            continue;
        redacted = redacted.replace(new RegExp(escapeRegExp(envValue), 'g'), '[redacted]');
    }
    return redacted;
}
function sanitizeConnectorMetadata(metadata) {
    if (!metadata)
        return undefined;
    return Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
        if (typeof value !== 'string')
            return [key, value];
        if (SENSITIVE_METADATA_KEY_RE.test(key))
            return [key, '[redacted]'];
        if (URL_METADATA_KEY_RE.test(key))
            return [key, redactSensitiveText(value)];
        return [key, redactSensitiveText(value)];
    }));
}
function sanitizeConnectorStatus(status) {
    return Object.assign(Object.assign({}, status), { message: redactSensitiveText(status.message), metadata: sanitizeConnectorMetadata(status.metadata) });
}
function sanitizeTrustValue(value, key = '') {
    if (value === null || value === undefined)
        return value;
    if (typeof value === 'string') {
        return SENSITIVE_METADATA_KEY_RE.test(key) ? '[redacted]' : redactSensitiveText(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (Array.isArray(value))
        return value.map((entry) => sanitizeTrustValue(entry, key));
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeTrustValue(entryValue, entryKey),
        ]));
    }
    return value;
}
function sanitizeTrustRecord(record) {
    return sanitizeTrustValue(record);
}
function sanitizeTrustPayload(payload) {
    return sanitizeTrustValue(payload);
}
function sanitizeApprovalRequest(request) {
    return Object.assign(Object.assign({}, request), { summary: redactSensitiveText(request.summary), args: sanitizeTrustRecord(request.args), reason: request.reason ? redactSensitiveText(request.reason) : request.reason });
}
function sanitizeApprovalAuditEvent(event) {
    return Object.assign(Object.assign({}, event), { summary: redactSensitiveText(event.summary), args: sanitizeTrustRecord(event.args), resultSummary: event.resultSummary ? redactSensitiveText(event.resultSummary) : event.resultSummary, error: event.error ? redactSensitiveText(event.error) : event.error, reason: event.reason ? redactSensitiveText(event.reason) : event.reason });
}
function sanitizeApprovalFlowEvent(event) {
    if (event.type === 'approval-audit') {
        return Object.assign(Object.assign({}, event), { event: sanitizeApprovalAuditEvent(event.event) });
    }
    return Object.assign(Object.assign({}, event), { request: sanitizeApprovalRequest(event.request) });
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ─── Factory ───────────────────────────────────────────────────────────────
export function createRuntimeGateway(deps) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const { config, runtime, health, cron } = deps;
    const router = (_a = deps.providerRouter) !== null && _a !== void 0 ? _a : defaultProviderRouter;
    const approvals = (_b = deps.approvalFlow) !== null && _b !== void 0 ? _b : approvalFlow;
    const orchestration = deps.orchestration;
    // Mini App dependencies
    const goalStore = (_c = deps.goalStore) !== null && _c !== void 0 ? _c : new GoalStore();
    const approvalSettingsPath = (_d = deps.approvalSettingsPath) !== null && _d !== void 0 ? _d : path.join(homedir(), '.pyrfor', 'approval-settings.json');
    const STATIC_DIR = (_e = deps.staticDir) !== null && _e !== void 0 ? _e : resolveDefaultStaticDir();
    const IDE_STATIC_DIR = (_f = deps.ideStaticDir) !== null && _f !== void 0 ? _f : resolveDefaultIdeStaticDir();
    const MEDIA_DIR = (_g = deps.mediaDir) !== null && _g !== void 0 ? _g : path.join(homedir(), '.pyrfor', 'media');
    // ─── IDE filesystem config ─────────────────────────────────────────────
    const fsConfig = {
        workspaceRoot: (_j = (_h = config.workspaceRoot) !== null && _h !== void 0 ? _h : config.workspacePath) !== null && _j !== void 0 ? _j : path.join(homedir(), '.pyrfor', 'workspace'),
    };
    const execTimeout = (_k = deps.execTimeoutMs) !== null && _k !== void 0 ? _k : DEFAULT_EXEC_TIMEOUT_MS;
    const ptyManager = new PtyManager();
    // Build token validator from config. Rebuilt on each request is fine for v1
    // (config is passed in at construction time). For hot-reload, callers should
    // reconstruct the gateway or we'd need an onConfigChange hook — deferred to v2.
    const tokenValidator = buildValidator(config);
    const requireAuth = !!(config.gateway.bearerToken) ||
        ((_m = (_l = config.gateway.bearerTokens) === null || _l === void 0 ? void 0 : _l.length) !== null && _m !== void 0 ? _m : 0) > 0;
    // ─── Rate limiter ──────────────────────────────────────────────────────
    const rlCfg = config.rateLimit;
    let rateLimiter = null;
    if (rlCfg === null || rlCfg === void 0 ? void 0 : rlCfg.enabled) {
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
    function checkAuth(req, query) {
        if (!requireAuth)
            return { ok: true };
        const token = extractBearerToken(req, query);
        if (!token)
            return { ok: false, reason: 'unknown' };
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
    function enforceAuth(req, res, query) {
        var _a;
        const authResult = checkAuth(req, query);
        if (authResult.ok)
            return true;
        sendUnauthorized(res, (_a = authResult.reason) !== null && _a !== void 0 ? _a : 'unknown');
        return false;
    }
    function authenticatedActorOwner(req, res, body, query) {
        var _a, _b, _c;
        const authResult = checkAuth(req, query);
        if (!authResult.ok) {
            sendUnauthorized(res, (_a = authResult.reason) !== null && _a !== void 0 ? _a : 'unknown');
            return null;
        }
        const owner = requireAuth
            ? `token:${(_b = authResult.label) !== null && _b !== void 0 ? _b : 'authenticated'}`
            : (_c = textValue(body['owner'])) !== null && _c !== void 0 ? _c : 'operator';
        const requestedOwner = textValue(body['owner']);
        if (requireAuth && requestedOwner && requestedOwner !== owner) {
            sendJson(res, 403, { error: 'owner_mismatch' });
            return null;
        }
        return owner;
    }
    // ─── Media helpers ─────────────────────────────────────────────────────
    const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;
    const MEDIA_MIME_MAP = {
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
    function extFromContentType(ct) {
        if (!ct)
            return '.bin';
        const lower = ct.toLowerCase();
        if (lower.includes('png'))
            return '.png';
        if (lower.includes('jpeg') || lower.includes('jpg'))
            return '.jpg';
        if (lower.includes('gif'))
            return '.gif';
        if (lower.includes('webp'))
            return '.webp';
        if (lower.includes('svg'))
            return '.svg';
        if (lower.includes('mpeg'))
            return '.mp3';
        if (lower.includes('wav'))
            return '.wav';
        if (lower.includes('ogg'))
            return '.ogg';
        if (lower.includes('webm'))
            return '.webm';
        if (lower.includes('mp4'))
            return '.m4a';
        if (lower.includes('flac'))
            return '.flac';
        if (lower.includes('aac'))
            return '.aac';
        return '.bin';
    }
    function extFromFilename(name) {
        if (!name)
            return null;
        const ext = path.extname(name).toLowerCase();
        return ext && SAFE_NAME_RE.test(ext.slice(1)) ? ext : null;
    }
    /**
     * Parse a multipart/form-data chat request, persist any attachments, and
     * (when applicable) enrich the user's text with image descriptions and
     * audio transcripts. Returns either an error or the assembled chat input.
     */
    function processChatMultipart(req, requireText) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const ct = (_a = req.headers['content-type']) !== null && _a !== void 0 ? _a : '';
            const boundaryMatch = /boundary=([^\s;]+)/.exec(ct);
            if (!boundaryMatch) {
                return { ok: false, status: 400, error: 'Expected multipart/form-data with boundary' };
            }
            const boundary = boundaryMatch[1];
            const rawBody = yield readBodyBuffer(req);
            const parts = parseMultipart(rawBody, boundary);
            let text = '';
            let workspace;
            let sessionId;
            let prefer;
            let routingHints;
            let exposeToolPayloads;
            let openFiles;
            const fileParts = [];
            for (const p of parts) {
                if (p.filename !== undefined) {
                    if (p.name === 'attachments' || p.name === 'attachments[]') {
                        fileParts.push(p);
                    }
                    continue;
                }
                const value = p.data.toString('utf-8');
                if (p.name === 'text')
                    text = value;
                else if (p.name === 'workspace')
                    workspace = value;
                else if (p.name === 'sessionId')
                    sessionId = value;
                else if (p.name === 'prefer') {
                    if (value === 'local' || value === 'cloud' || value === 'auto')
                        prefer = value;
                }
                else if (p.name === 'routingHints') {
                    const parsedJson = tryParseJson(value);
                    if (parsedJson.ok && parsedJson.value && typeof parsedJson.value === 'object' && !Array.isArray(parsedJson.value)) {
                        const rawHints = parsedJson.value;
                        const nextHints = {};
                        if (typeof rawHints.contextSizeChars === 'number' && Number.isFinite(rawHints.contextSizeChars)) {
                            nextHints.contextSizeChars = rawHints.contextSizeChars;
                        }
                        if (typeof rawHints.sensitive === 'boolean')
                            nextHints.sensitive = rawHints.sensitive;
                        if (Object.keys(nextHints).length > 0)
                            routingHints = nextHints;
                    }
                }
                else if (p.name === 'exposeToolPayloads')
                    exposeToolPayloads = value === 'true';
                else if (p.name === 'openFiles') {
                    const parsedJson = tryParseJson(value);
                    if (parsedJson.ok && Array.isArray(parsedJson.value)) {
                        openFiles = parsedJson.value;
                    }
                }
            }
            if (requireText && !text) {
                return { ok: false, status: 400, error: 'text required' };
            }
            // Resolve / validate sessionId for media storage
            const safeSession = sessionId && SAFE_NAME_RE.test(sessionId) ? sessionId : randomUUID();
            sessionId = safeSession;
            const attachments = [];
            if (fileParts.length > 0) {
                const sessionDir = path.join(MEDIA_DIR, safeSession);
                mkdirSync(sessionDir, { recursive: true });
                const port = (() => {
                    const addr = server.address();
                    return addr && typeof addr === 'object' ? addr.port : resolveBindPort();
                })();
                for (const fp of fileParts) {
                    const ctype = (_b = fp.contentType) !== null && _b !== void 0 ? _b : 'application/octet-stream';
                    const ext = (_c = extFromFilename(fp.filename)) !== null && _c !== void 0 ? _c : extFromContentType(ctype);
                    const id = randomUUID();
                    const filename = `${id}${ext}`;
                    const fullPath = path.join(sessionDir, filename);
                    writeFileSync(fullPath, fp.data);
                    const isAudio = ctype.toLowerCase().startsWith('audio/');
                    const isImage = ctype.toLowerCase().startsWith('image/');
                    const kind = isAudio ? 'audio' : isImage ? 'image' : (['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac', '.aac', '.opus', '.oga'].includes(ext)
                        ? 'audio'
                        : 'image');
                    const url = `http://localhost:${port}/api/media/${safeSession}/${filename}`;
                    attachments.push({ kind, url, mime: ctype, size: fp.data.length });
                    // Enrich text based on attachment type
                    try {
                        if (kind === 'image') {
                            const base64 = fp.data.toString('base64');
                            const result = yield processPhoto({ base64, caption: text || undefined });
                            const desc = (_d = result.description) !== null && _d !== void 0 ? _d : result.enrichedPrompt;
                            if (desc) {
                                text = (text ? text + '\n\n' : '') + `[Image description: ${desc}]`;
                            }
                        }
                        else if (kind === 'audio') {
                            try {
                                const { transcribeBuffer } = yield import('./voice.js');
                                const transcript = yield transcribeBuffer(fp.data, config.voice);
                                if (transcript) {
                                    text = (text ? text + '\n\n' : '') + `[Audio transcript: ${transcript}]`;
                                }
                            }
                            catch (err) {
                                logger.warn('[gateway-media] audio transcription failed', {
                                    error: err instanceof Error ? err.message : String(err),
                                });
                            }
                        }
                    }
                    catch (err) {
                        logger.warn('[gateway-media] attachment enrichment failed', {
                            kind,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }
            return { ok: true, text, openFiles, workspace, sessionId, prefer, routingHints, exposeToolPayloads, attachments };
        });
    }
    // ─── Server ────────────────────────────────────────────────────────────
    const server = createServer((req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c, _d, e_2, _e, _f;
        var _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43, _44, _45, _46, _47, _48, _49, _50, _51, _52, _53, _54, _55, _56, _57, _58, _59, _60, _61, _62, _63, _64, _65, _66, _67, _68, _69, _70, _71, _72, _73, _74, _75, _76, _77, _78, _79, _80, _81, _82, _83, _84, _85, _86, _87, _88, _89, _90, _91, _92, _93, _94, _95, _96, _97, _98, _99, _100, _101, _102, _103, _104, _105, _106, _107, _108, _109, _110, _111, _112, _113, _114, _115, _116, _117, _118, _119, _120, _121, _122, _123, _124, _125, _126, _127, _128;
        const parsed = parseUrl((_g = req.url) !== null && _g !== void 0 ? _g : '/', true);
        const method = (_h = req.method) !== null && _h !== void 0 ? _h : 'GET';
        const pathname = (_j = parsed.pathname) !== null && _j !== void 0 ? _j : '/';
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
            const exemptPaths = (_k = rlCfg === null || rlCfg === void 0 ? void 0 : rlCfg.exemptPaths) !== null && _k !== void 0 ? _k : ['/ping', '/health', '/metrics'];
            if (!exemptPaths.includes(pathname)) {
                const authHeader = req.headers['authorization'];
                const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : undefined;
                const ip = (_l = req.socket.remoteAddress) !== null && _l !== void 0 ? _l : 'unknown';
                const rlKey = token !== null && token !== void 0 ? token : ip;
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
            const status = snapshot == null || snapshot.status === 'healthy' || snapshot.status === 'degraded'
                ? 200
                : 503;
            sendJson(res, status, snapshot ? publicHealthSnapshot(snapshot) : { status: 'unknown' });
            return;
        }
        // GET /metrics — Prometheus text exposition format.
        if (method === 'GET' && pathname === '/metrics') {
            if (!enforceAuth(req, res, query))
                return;
            const metricsSnapshot = collectMetrics({ runtime, health, cron });
            const body = formatMetrics(metricsSnapshot);
            sendText(res, 200, body, 'text/plain; version=0.0.4; charset=utf-8');
            return;
        }
        // GET /api/settings/active-model — public (no sensitive data)
        if (method === 'GET' && pathname === '/api/settings/active-model') {
            const activeModel = (_m = router.getActiveModel()) !== null && _m !== void 0 ? _m : null;
            sendJson(res, 200, { activeModel });
            return;
        }
        // GET /api/settings/local-mode — public (no sensitive data)
        if (method === 'GET' && pathname === '/api/settings/local-mode') {
            const mode = (_q = (_p = (_o = router).getLocalMode) === null || _p === void 0 ? void 0 : _p.call(_o)) !== null && _q !== void 0 ? _q : { localFirst: false, localOnly: false };
            sendJson(res, 200, mode);
            return;
        }
        // GET /api/settings/execution-mode — public (no sensitive data)
        if (method === 'GET' && pathname === '/api/settings/execution-mode') {
            sendJson(res, 200, { executionMode: effectiveExecutionMode(config, orchestration) });
            return;
        }
        // GET /api/settings/provider-routing-preview — authenticated read-only routing state (no keys/URLs)
        if (method === 'GET' && pathname === '/api/settings/provider-routing-preview') {
            if (!enforceAuth(req, res, query))
                return;
            const preview = (_s = (_r = router.getRoutingPreview) === null || _r === void 0 ? void 0 : _r.call(router)) !== null && _s !== void 0 ? _s : {
                activeModel: (_t = router.getActiveModel()) !== null && _t !== void 0 ? _t : null,
                localMode: router.getLocalMode(),
                reason: 'default',
                fallbackChain: [],
                providers: [],
                warnings: ['routing_preview_unavailable'],
            };
            sendJson(res, 200, preview);
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
                if (!stat.isFile()) {
                    sendJson(res, 404, { error: 'not_found' });
                    return;
                }
            }
            catch (_129) {
                sendJson(res, 404, { error: 'not_found' });
                return;
            }
            const ext = path.extname(full).toLowerCase();
            const mime = (_u = MEDIA_MIME_MAP[ext]) !== null && _u !== void 0 ? _u : 'application/octet-stream';
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
            if (!enforceAuth(req, res, query))
                return;
            try {
                let sessionsCount = 0;
                // TODO: wire LLM cost accumulator (#dashboard-cost)
                let costToday = null;
                try {
                    const rStats = (_w = (_v = runtime).getStats) === null || _w === void 0 ? void 0 : _w.call(_v);
                    sessionsCount = (_y = (_x = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _x === void 0 ? void 0 : _x.active) !== null && _y !== void 0 ? _y : 0;
                }
                catch ( /* not critical */_130) { /* not critical */ }
                const activeGoals = goalStore.list('active').slice(0, 3);
                const recentActivity = goalStore.list().slice(-10).reverse();
                const model = (_0 = (_z = config.providers) === null || _z === void 0 ? void 0 : _z.defaultProvider) !== null && _0 !== void 0 ? _0 : 'unknown';
                sendJson(res, 200, {
                    status: 'running',
                    model,
                    costToday,
                    sessionsCount,
                    activeGoals,
                    recentActivity,
                    workspaceRoot: fsConfig.workspaceRoot,
                    cwd: runtimeWorkspacePath(runtime, fsConfig.workspaceRoot),
                    orchestration: sanitizeTrustPayload(yield buildOrchestrationDashboard(orchestration, approvals.getPending().length)),
                });
            }
            catch (err) {
                sendJson(res, 500, { error: 'Internal server error' });
            }
            return;
        }
        if (pathname === '/api/connectors/inventory' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const snapshot = (_1 = deps.connectorInventory) === null || _1 === void 0 ? void 0 : _1.getSnapshot();
            if (!snapshot) {
                sendJson(res, 501, { error: 'connector_inventory_unavailable' });
                return;
            }
            sendJson(res, 200, snapshot);
            return;
        }
        if (pathname === '/api/research/readiness' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            sendJson(res, 200, getGovernedResearchSearchReadiness(process.env));
            return;
        }
        if (pathname === '/api/github/delivery-readiness' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            sendJson(res, 200, yield getGitHubDeliveryReadiness(runtimeWorkspacePath(runtime, fsConfig.workspaceRoot), process.env));
            return;
        }
        if (pathname === '/api/browser/readiness' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            sendJson(res, 200, getBrowserQAReadiness());
            return;
        }
        if (pathname === '/api/release/readiness' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            sendJson(res, 200, getReleaseReadiness());
            return;
        }
        if (pathname === '/api/skills' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            sendJson(res, 200, listSkillCatalog());
            return;
        }
        if (pathname === '/api/skills/import' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: false };
            if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            try {
                const content = textValue(body['content']);
                if (!content) {
                    sendJson(res, 400, { error: 'skill_content_required' });
                    return;
                }
                const result = importSkillMdToRegistry(effectiveUniversalToolRegistry(deps.orchestration), Object.assign({ content }, (textValue(body['sourceLabel']) ? { sourceLabel: textValue(body['sourceLabel']) } : {})));
                sendJson(res, result.duplicate ? 200 : 201, result);
            }
            catch (err) {
                sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid_skill_import' });
            }
            return;
        }
        const skillTestMatch = pathname.match(/^\/api\/skills\/([^/]+)\/test$/);
        if (skillTestMatch && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            try {
                const result = yield testSkillRegistryEntry(effectiveUniversalToolRegistry(deps.orchestration), decodeURIComponent(skillTestMatch[1]), { artifactStore: (_2 = deps.orchestration) === null || _2 === void 0 ? void 0 : _2.artifactStore });
                sendJson(res, 200, result);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : 'skill_test_failed';
                if (message === 'skill_not_found') {
                    sendJson(res, 404, { error: message });
                    return;
                }
                sendJson(res, 400, { error: message });
            }
            return;
        }
        const skillApproveMatch = pathname.match(/^\/api\/skills\/([^/]+)\/approve$/);
        if (skillApproveMatch && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            try {
                const result = approveSkillRegistryEntry(effectiveUniversalToolRegistry(deps.orchestration), decodeURIComponent(skillApproveMatch[1]));
                sendJson(res, 200, result);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : 'skill_approval_failed';
                if (message === 'skill_not_found') {
                    sendJson(res, 404, { error: message });
                    return;
                }
                if (message === 'skill_tests_required' || message === 'skill_validation_failed' || message === 'skill_retired') {
                    sendJson(res, 409, { error: message });
                    return;
                }
                sendJson(res, 400, { error: message });
            }
            return;
        }
        if (pathname === '/api/tools/registry' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const parsedQuery = parseToolRegistryQuery(query);
            if (!parsedQuery.ok) {
                sendJson(res, 400, { error: parsedQuery.error });
                return;
            }
            sendJson(res, 200, listPublicToolRegistry(effectiveUniversalToolRegistry(deps.orchestration), parsedQuery.value));
            return;
        }
        if (pathname === '/api/blocks' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const blockRegistry = resolveBlockRegistry(orchestration);
            if (!blockRegistry) {
                sendJson(res, 501, { error: 'block_registry_unavailable' });
                return;
            }
            const projectId = ((_3 = firstQueryValue(query['projectId'])) === null || _3 === void 0 ? void 0 : _3.trim()) || undefined;
            const blocks = blockRegistry.list(projectId ? { projectId } : {})
                .sort((left, right) => {
                var _a, _b;
                return left.blockId === right.blockId
                    ? ((_a = left.projectId) !== null && _a !== void 0 ? _a : '').localeCompare((_b = right.projectId) !== null && _b !== void 0 ? _b : '')
                    : left.blockId.localeCompare(right.blockId);
            })
                .map(publicBlockEntry);
            sendJson(res, 200, { blocks });
            return;
        }
        if (pathname === '/api/blocks/load' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const blockRegistry = resolveBlockRegistry(orchestration);
            if (!blockRegistry) {
                sendJson(res, 501, { error: 'block_registry_unavailable' });
                return;
            }
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = recordValue(parsed.value);
            const blockPath = (_4 = textValue(body === null || body === void 0 ? void 0 : body['path'])) === null || _4 === void 0 ? void 0 : _4.trim();
            const projectId = ((_5 = textValue(body === null || body === void 0 ? void 0 : body['projectId'])) === null || _5 === void 0 ? void 0 : _5.trim()) || undefined;
            if (!blockPath) {
                sendJson(res, 400, { error: 'block_path_required' });
                return;
            }
            const resolvedBlockPath = path.resolve(blockPath);
            if (!existsSync(resolvedBlockPath)) {
                sendJson(res, 400, { error: 'block_path_not_found' });
                return;
            }
            const workspaceRoot = runtimeWorkspacePath(runtime, fsConfig.workspaceRoot);
            if (!isWithinWorkspaceRoot(resolvedBlockPath, workspaceRoot)) {
                sendJson(res, 400, { error: 'block_path_outside_workspace' });
                return;
            }
            const result = yield loadBlock(resolvedBlockPath, Object.assign({ registry: blockRegistry, toolRegistry: (_6 = resolveCapabilityToolRegistry(orchestration)) !== null && _6 !== void 0 ? _6 : undefined, contractRegistry: (_7 = resolveContractRegistry(orchestration)) !== null && _7 !== void 0 ? _7 : undefined, ledger: orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger, artifactStore: orchestration === null || orchestration === void 0 ? void 0 : orchestration.artifactStore, dataRootDir: path.join(resolveExistingPath(workspaceRoot), '.pyrfor', 'blocks') }, (projectId ? { projectId } : {})));
            const status = result.ok
                ? 201
                : (((_8 = result.error) === null || _8 === void 0 ? void 0 : _8.includes('duplicate block id')) ? 409 : 400);
            if (result.ok) {
                (_9 = resolveBlockCatalogStore(orchestration)) === null || _9 === void 0 ? void 0 : _9.flush(blockRegistry);
            }
            sendJson(res, status, publicBlockOperationResponse(result));
            return;
        }
        const blockActivateMatch = pathname.match(/^\/api\/blocks\/([^/]+)\/activate$/);
        if (blockActivateMatch && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const blockRegistry = resolveBlockRegistry(orchestration);
            if (!blockRegistry) {
                sendJson(res, 501, { error: 'block_registry_unavailable' });
                return;
            }
            const blockId = decodePathSegment(blockActivateMatch[1]);
            if (!blockId) {
                sendJson(res, 400, { error: 'invalid_block_id' });
                return;
            }
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = recordValue(parsed.value);
            const projectId = ((_10 = textValue(body === null || body === void 0 ? void 0 : body['projectId'])) === null || _10 === void 0 ? void 0 : _10.trim()) || undefined;
            const result = yield activateBlock(blockId, blockRegistry, Object.assign({ ledger: orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger }, (projectId ? { projectId } : {})));
            if (!result.ok) {
                if (result.status === 'revoked') {
                    sendJson(res, 409, Object.assign(Object.assign({ error: 'block_revoked', blockId }, (projectId ? { projectId } : {})), { status: 'revoked' }));
                    return;
                }
                sendJson(res, 404, Object.assign({ error: 'block_not_found', blockId }, (projectId ? { projectId } : {})));
                return;
            }
            (_11 = resolveBlockCatalogStore(orchestration)) === null || _11 === void 0 ? void 0 : _11.flush(blockRegistry);
            sendJson(res, 200, publicBlockOperationResponse(result));
            return;
        }
        const blockDeactivateMatch = pathname.match(/^\/api\/blocks\/([^/]+)\/deactivate$/);
        if (blockDeactivateMatch && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const blockRegistry = resolveBlockRegistry(orchestration);
            if (!blockRegistry) {
                sendJson(res, 501, { error: 'block_registry_unavailable' });
                return;
            }
            const blockId = decodePathSegment(blockDeactivateMatch[1]);
            if (!blockId) {
                sendJson(res, 400, { error: 'invalid_block_id' });
                return;
            }
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = recordValue(parsed.value);
            const projectId = ((_12 = textValue(body === null || body === void 0 ? void 0 : body['projectId'])) === null || _12 === void 0 ? void 0 : _12.trim()) || undefined;
            const result = yield deactivateBlock(blockId, blockRegistry, Object.assign({ ledger: orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger }, (projectId ? { projectId } : {})));
            if (result.status === 'revoked') {
                sendJson(res, 409, Object.assign(Object.assign({ error: 'block_revoked', blockId }, (projectId ? { projectId } : {})), { status: 'revoked' }));
                return;
            }
            if (!result.ok) {
                sendJson(res, 404, Object.assign({ error: 'block_not_found', blockId }, (projectId ? { projectId } : {})));
                return;
            }
            (_13 = resolveBlockCatalogStore(orchestration)) === null || _13 === void 0 ? void 0 : _13.flush(blockRegistry);
            sendJson(res, 200, publicBlockOperationResponse(result));
            return;
        }
        if (pathname === '/api/slash-commands' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const commands = createDefaultRegistry()
                .list()
                .map(publicSlashCommandSummary)
                .filter((command) => Boolean(command));
            sendJson(res, 200, { commands });
            return;
        }
        if (pathname === '/api/slash-commands/invoke' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: false };
            if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
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
            const firstToken = (_14 = tokenizeSlashCommand(commandLine)[0]) !== null && _14 !== void 0 ? _14 : '';
            const commandName = firstToken.startsWith('/') ? firstToken.slice(1) : firstToken;
            const registry = createDefaultRegistry();
            const command = registry.get(commandName);
            if (!command || command.name !== 'skills' || command.permissionClass !== 'auto_allow') {
                sendJson(res, 403, { error: 'slash_command_not_exposed', command: commandName || null });
                return;
            }
            const result = yield registry.invoke(commandLine, {
                workspaceId: 'gateway',
                sessionId: 'slash-command',
                ledger: (_15 = deps.orchestration) === null || _15 === void 0 ? void 0 : _15.eventLedger,
            });
            sendJson(res, result.ok ? 200 : 400, result);
            return;
        }
        if (pathname === '/api/skills/recommend' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: false };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            try {
                sendJson(res, 200, recommendSkillsPreview(parsed.value));
            }
            catch (err) {
                sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid_skill_recommend_request' });
            }
            return;
        }
        const connectorProbeMatch = pathname.match(/^\/api\/connectors\/([^/]+)\/probe$/);
        if (connectorProbeMatch && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const connectorId = decodeURIComponent(connectorProbeMatch[1]);
            const connectors = deps.connectorInventory;
            if (!(connectors === null || connectors === void 0 ? void 0 : connectors.getSnapshot) || !connectors.probeStatus) {
                sendJson(res, 501, { error: 'connector_probe_unavailable' });
                return;
            }
            const descriptor = connectors.getSnapshot().connectors.find((connector) => connector.id === connectorId);
            if (!descriptor) {
                sendJson(res, 404, { error: 'connector_not_found', connectorId });
                return;
            }
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            const approvalId = typeof body['approvalId'] === 'string' ? body['approvalId'] : undefined;
            const expectedApprovalId = buildConnectorProbeApprovalId(connectorId);
            const approvalArgs = {
                connectorId,
                connectorName: descriptor.name,
                sourceSystem: descriptor.sourceSystem,
                liveProbe: true,
            };
            if (!approvalId) {
                const existing = (_16 = approvals.getPending().find((request) => request.id === expectedApprovalId
                    || (request.toolName === 'connector_live_probe' && request.args['connectorId'] === connectorId))) !== null && _16 !== void 0 ? _16 : (_18 = (_17 = approvals.getResolvedApproval) === null || _17 === void 0 ? void 0 : _17.call(approvals, expectedApprovalId)) === null || _18 === void 0 ? void 0 : _18.request;
                if (existing) {
                    sendJson(res, 202, { status: 'approval_required', connectorId, approval: existing, liveProbe: true });
                    return;
                }
                if (!approvals.enqueueApproval) {
                    sendJson(res, 501, { error: 'connector_probe_approval_unavailable' });
                    return;
                }
                const approval = yield approvals.enqueueApproval({
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
            const resolvedApproval = (_19 = approvals.getResolvedApproval) === null || _19 === void 0 ? void 0 : _19.call(approvals, approvalId);
            if (!resolvedApproval) {
                sendJson(res, 409, { error: 'approval_pending', connectorId, approvalId });
                return;
            }
            if (resolvedApproval.request.toolName !== 'connector_live_probe'
                || resolvedApproval.request.args['connectorId'] !== connectorId) {
                sendJson(res, 403, { error: 'approval_mismatch', connectorId });
                return;
            }
            if (resolvedApproval.decision !== 'approve') {
                (_20 = approvals.consumeResolvedApproval) === null || _20 === void 0 ? void 0 : _20.call(approvals, approvalId);
                sendJson(res, 403, { error: 'connector_probe_denied', connectorId, approvalId, decision: resolvedApproval.decision });
                return;
            }
            if (!((_21 = approvals.consumeResolvedApproval) === null || _21 === void 0 ? void 0 : _21.call(approvals, approvalId))) {
                sendJson(res, 409, { error: 'approval_unavailable', connectorId, approvalId });
                return;
            }
            try {
                const connector = yield connectors.probeStatus(connectorId);
                if (!connector) {
                    sendJson(res, 404, { error: 'connector_not_found', connectorId });
                    return;
                }
                const publicConnector = sanitizeConnectorStatus(connector);
                (_22 = approvals.recordToolOutcome) === null || _22 === void 0 ? void 0 : _22.call(approvals, {
                    requestId: approvalId,
                    toolName: 'connector_live_probe',
                    summary: `Run live connector probe for ${descriptor.name}`,
                    args: approvalArgs,
                    decision: 'approve',
                    resultSummary: publicConnector.message,
                    undo: { supported: false },
                });
                sendJson(res, 200, { status: 'probed', connectorId, connector: publicConnector, approvalId, liveProbe: true });
            }
            catch (error) {
                const errorMessage = redactSensitiveText(error instanceof Error ? error.message : String(error));
                (_23 = approvals.recordToolOutcome) === null || _23 === void 0 ? void 0 : _23.call(approvals, {
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
            const raw = yield readBody(req);
            const parsed2 = tryParseJson(raw);
            if (!parsed2.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body2 = parsed2.value;
            const desc = body2.title || body2.description;
            if (!desc) {
                sendJson(res, 400, { error: 'title required' });
                return;
            }
            const goal = goalStore.create(desc);
            sendJson(res, 200, goal);
            return;
        }
        // POST /api/goals/:id/done
        const goalDoneMatch = pathname.match(/^\/api\/goals\/([^/]+)\/done$/);
        if (goalDoneMatch && method === 'POST') {
            const id = goalDoneMatch[1];
            const updated = goalStore.markDone(id);
            if (!updated) {
                sendJson(res, 404, { error: 'Goal not found' });
                return;
            }
            sendJson(res, 200, updated);
            return;
        }
        // DELETE /api/goals/:id
        const goalDeleteMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
        if (goalDeleteMatch && method === 'DELETE') {
            const id = goalDeleteMatch[1];
            const updated = goalStore.cancel(id);
            if (!updated) {
                sendJson(res, 404, { error: 'Goal not found' });
                return;
            }
            sendJson(res, 200, updated);
            return;
        }
        if (pathname === '/api/agents' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const listSubagents = (_24 = deps.runtime.listSubagents) === null || _24 === void 0 ? void 0 : _24.bind(deps.runtime);
            sendJson(res, 200, listSubagents ? listSubagents() : []);
            return;
        }
        if (pathname === '/api/memory' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            sendJson(res, 200, deps.runtime.getMemorySnapshot());
            return;
        }
        if (pathname === '/api/memory/continuity' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            const projectId = (_25 = firstQueryValue(query['projectId'])) === null || _25 === void 0 ? void 0 : _25.trim();
            const status = yield deps.runtime.getMemoryContinuityStatus(projectId ? { projectId } : {});
            sendJson(res, 200, publicMemoryContinuityStatus(status));
            return;
        }
        if (pathname === '/api/memory/search' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            const q = (_27 = (_26 = firstQueryValue(query['q'])) === null || _26 === void 0 ? void 0 : _26.trim()) !== null && _27 !== void 0 ? _27 : '';
            if (!q) {
                sendJson(res, 400, { error: 'invalid_query' });
                return;
            }
            const limit = parseIntQuery(query['limit'], 10, 50);
            const projectId = (_28 = firstQueryValue(query['projectId'])) === null || _28 === void 0 ? void 0 : _28.trim();
            const result = yield deps.runtime.searchMemory(Object.assign({ query: q, limit }, (projectId ? { projectId } : {})));
            sendJson(res, 200, publicMemorySearchResponse(result));
            return;
        }
        if (pathname === '/api/memory/corrections' && method === 'POST') {
            const authResult = checkAuth(req, query);
            if (!authResult.ok) {
                sendUnauthorized(res, (_29 = authResult.reason) !== null && _29 !== void 0 ? _29 : 'unknown');
                return;
            }
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
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
                ? `token:${(_30 = authResult.label) !== null && _30 !== void 0 ? _30 : 'authenticated'}`
                : (typeof body.operatorId === 'string' && body.operatorId.trim() ? body.operatorId : 'operator');
            try {
                const result = yield deps.runtime.createMemoryCorrection(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ content: body.content }, (typeof body.summary === 'string' ? { summary: body.summary } : {})), (typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId } : {})), (isMemoryType(body.memoryType) ? { memoryType: body.memoryType } : {})), (typeof body.importance === 'number' ? { importance: body.importance } : {})), { operatorId }));
                sendJson(res, 201, publicMemoryMutationResponse(result));
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message.includes('durably persisted')) {
                    sendJson(res, 503, { error: 'memory_persistence_failed', message });
                    return;
                }
                sendJson(res, 500, { error: 'memory_correction_failed', message });
            }
            return;
        }
        if (pathname === '/api/memory/pending-reviews' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            const projectId = (_31 = firstQueryValue(query['projectId'])) === null || _31 === void 0 ? void 0 : _31.trim();
            const limit = parseIntQuery(query['limit'], 25, 100);
            const result = yield deps.runtime.listPendingMemoryReviews(Object.assign(Object.assign({}, (projectId ? { projectId } : {})), { limit }));
            sendJson(res, 200, publicPendingMemoryReviewsResponse(result));
            return;
        }
        const memoryReviewMatch = pathname.match(/^\/api\/memory\/([^/]+)\/review$/);
        if (memoryReviewMatch && method === 'POST') {
            const authResult = checkAuth(req, query);
            if (!authResult.ok) {
                sendUnauthorized(res, (_32 = authResult.reason) !== null && _32 !== void 0 ? _32 : 'unknown');
                return;
            }
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            if (body.agentId !== undefined || body.workspaceId !== undefined || body.projectId !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            if (!isMemoryReviewDecision(body.decision)) {
                sendJson(res, 400, { error: 'invalid_decision' });
                return;
            }
            const operatorId = requireAuth
                ? `token:${(_33 = authResult.label) !== null && _33 !== void 0 ? _33 : 'authenticated'}`
                : (typeof body.operatorId === 'string' && body.operatorId.trim() ? body.operatorId : 'operator');
            try {
                const result = yield deps.runtime.reviewMemory(Object.assign(Object.assign({ memoryId: decodeURIComponent(memoryReviewMatch[1]), decision: body.decision }, (typeof body.reason === 'string' ? { reason: body.reason } : {})), { operatorId }));
                sendJson(res, 200, publicMemoryMutationResponse(result));
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (err instanceof DurableMemoryContradictionError) {
                    sendJson(res, 409, {
                        error: 'memory_contradiction',
                        message,
                        conflictingMemoryIds: err.conflictingMemoryIds,
                    });
                    return;
                }
                if (message.includes('not found')) {
                    sendJson(res, 404, { error: 'memory_not_found' });
                    return;
                }
                if (message.includes('not pending approval')) {
                    sendJson(res, 409, { error: 'memory_review_not_pending', message });
                    return;
                }
                if (message.includes('revoked') || message.includes('not governable')) {
                    sendJson(res, 409, { error: 'memory_review_unavailable', message });
                    return;
                }
                sendJson(res, 500, { error: 'memory_review_failed', message });
            }
            return;
        }
        if (pathname === '/api/memory/openclaw-import-report' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            if (body.agentId !== undefined || body.workspaceId !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            try {
                const result = yield deps.runtime.previewOpenClawMigration(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (typeof body.sourcePath === 'string' && body.sourcePath.trim() ? { sourcePath: body.sourcePath } : {})), (typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId } : {})), (typeof body.includePersonality === 'boolean' ? { includePersonality: body.includePersonality } : {})), (typeof body.includeMemories === 'boolean' ? { includeMemories: body.includeMemories } : {})), (typeof body.maxFiles === 'number' ? { maxFiles: body.maxFiles } : {})));
                sendJson(res, 201, publicOpenClawMigrationPreviewResponse(result));
            }
            catch (err) {
                sendJson(res, 400, { error: 'openclaw_import_preview_failed', message: err instanceof Error ? err.message : String(err) });
            }
            return;
        }
        if (pathname === '/api/memory/openclaw-import-report' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            const projectId = (_34 = firstQueryValue(query.projectId)) === null || _34 === void 0 ? void 0 : _34.trim();
            const result = yield deps.runtime.getLatestOpenClawMigrationReport(projectId ? { projectId } : {});
            if (!result) {
                sendJson(res, 404, { error: 'openclaw_import_report_not_found' });
                return;
            }
            sendJson(res, 200, publicOpenClawMigrationPreviewResponse(result));
            return;
        }
        if (pathname === '/api/memory/openclaw-import' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            if (body.agentId !== undefined || body.workspaceId !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            if (typeof body.reportArtifactId !== 'string' || typeof body.expectedReportSha256 !== 'string') {
                sendJson(res, 400, { error: 'invalid_report_reference' });
                return;
            }
            try {
                const result = yield deps.runtime.importOpenClawMigration(Object.assign(Object.assign(Object.assign({ reportArtifactId: body.reportArtifactId, expectedReportSha256: body.expectedReportSha256 }, (typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId } : {})), (body.autoTestSkills === true ? { autoTestSkills: true } : {})), (body.autoApproveSkills === true ? { autoApproveSkills: true } : {})));
                sendJson(res, 201, { status: 'imported', result: publicOpenClawMigrationImportResult(result) });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message.includes('durably persisted')) {
                    sendJson(res, 503, { error: 'memory_persistence_failed', message });
                    return;
                }
                sendJson(res, 400, { error: 'openclaw_import_failed', message });
            }
            return;
        }
        if (pathname === '/api/memory/openclaw-rollback' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            if (body.agentId !== undefined || body.workspaceId !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            if (typeof body.resultArtifactId !== 'string' || typeof body.expectedResultSha256 !== 'string') {
                sendJson(res, 400, { error: 'invalid_result_reference' });
                return;
            }
            try {
                const result = yield deps.runtime.rollbackOpenClawMigration({
                    resultArtifactId: body.resultArtifactId,
                    expectedResultSha256: body.expectedResultSha256,
                });
                sendJson(res, 201, { status: 'rolled_back', result: publicOpenClawMigrationRollbackResult(result) });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                sendJson(res, 400, { error: 'openclaw_rollback_failed', message });
            }
            return;
        }
        if (pathname === '/api/memory/openclaw-verify' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            if (body.agentId !== undefined || body.workspaceId !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            if (typeof body.resultArtifactId !== 'string' || typeof body.expectedResultSha256 !== 'string') {
                sendJson(res, 400, { error: 'invalid_result_reference' });
                return;
            }
            try {
                const result = yield deps.runtime.verifyOpenClawMigration(Object.assign({ resultArtifactId: body.resultArtifactId, expectedResultSha256: body.expectedResultSha256 }, (typeof body.queryLimit === 'number' ? { queryLimit: body.queryLimit } : {})));
                sendJson(res, 201, { status: 'verified', result: publicOpenClawMigrationVerificationResult(result) });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                sendJson(res, 400, { error: 'openclaw_verify_failed', message });
            }
            return;
        }
        if (pathname === '/api/memory/openclaw-audit' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            try {
                const projectId = (_35 = firstQueryValue(query.projectId)) === null || _35 === void 0 ? void 0 : _35.trim();
                const limit = parseIntQuery(query['limit'], 50, 500);
                const result = yield deps.runtime.getOpenClawMigrationAudit(Object.assign(Object.assign({}, (projectId ? { projectId } : {})), { limit }));
                sendJson(res, 200, publicOpenClawMigrationAuditView(result));
            }
            catch (err) {
                sendJson(res, 400, { error: 'openclaw_audit_failed', message: err instanceof Error ? err.message : String(err) });
            }
            return;
        }
        if (pathname === '/api/memory/openclaw-quarantine' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            if (query['agentId'] !== undefined || query['workspaceId'] !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            try {
                const projectId = (_36 = firstQueryValue(query.projectId)) === null || _36 === void 0 ? void 0 : _36.trim();
                const limit = parseIntQuery(query['limit'], 50, 500);
                const result = yield deps.runtime.getOpenClawMigrationQuarantine(Object.assign(Object.assign({}, (projectId ? { projectId } : {})), { limit }));
                sendJson(res, 200, publicOpenClawMigrationQuarantineState(result));
            }
            catch (err) {
                sendJson(res, 400, { error: 'openclaw_quarantine_failed', message: err instanceof Error ? err.message : String(err) });
            }
            return;
        }
        if (pathname === '/api/memory/rollup' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
            if (body.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
                sendJson(res, 400, { error: 'invalid_date' });
                return;
            }
            if (body.agentId !== undefined || body.projectId !== undefined) {
                sendJson(res, 400, { error: 'scope_override_not_allowed' });
                return;
            }
            const rollup = yield deps.runtime.createDailyMemoryRollup(Object.assign(Object.assign({}, (body.date ? { date: body.date } : {})), (typeof body.sessionLimit === 'number' ? { sessionLimit: body.sessionLimit } : {})));
            sendJson(res, 201, { rollup });
            return;
        }
        if (pathname === '/api/memory/project-rollup' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
            if (!parsed.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const body = parsed.value;
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
                const rollup = yield deps.runtime.createProjectMemoryRollup(Object.assign({ projectId: body.projectId.trim() }, (sessionLimit !== undefined ? { sessionLimit } : {})));
                sendJson(res, 201, {
                    rollup: Object.assign(Object.assign({}, rollup), (rollup.artifact ? { artifact: publicArtifactRef(rollup.artifact) } : {})),
                });
            }
            catch (err) {
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
            if (!enforceAuth(req, res, query))
                return;
            const limit = parseIntQuery(query['limit'], 50, 200);
            const offset = parseIntQuery(query['offset'], 0, 10000);
            const archivedRaw = Array.isArray(query['archived']) ? query['archived'][0] : query['archived'];
            const archived = archivedRaw === 'true' ? true : archivedRaw === 'false' ? false : undefined;
            const sessions = yield deps.runtime.listSessions(Object.assign({ limit, offset }, (archived !== undefined ? { archived } : {})));
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
            if (!enforceAuth(req, res, query))
                return;
            const sessionId = decodePathSegment(sessionTimelineMatch[1]);
            if (!sessionId) {
                sendJson(res, 400, { error: 'invalid_session_id' });
                return;
            }
            const timeline = yield deps.runtime.getSessionTimeline(sessionId);
            if (!timeline) {
                sendJson(res, 404, { error: 'session_not_found' });
                return;
            }
            sendJson(res, 200, timeline);
            return;
        }
        const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
        if (sessionMatch && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const sessionId = decodePathSegment(sessionMatch[1]);
            if (!sessionId) {
                sendJson(res, 400, { error: 'invalid_session_id' });
                return;
            }
            const session = yield deps.runtime.getSession(sessionId);
            if (!session) {
                sendJson(res, 404, { error: 'session_not_found' });
                return;
            }
            sendJson(res, 200, { session });
            return;
        }
        if (pathname === '/api/settings' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const settings = readApprovalSettings(approvalSettingsPath);
            sendJson(res, 200, {
                defaultAction: (_37 = settings.defaultAction) !== null && _37 !== void 0 ? _37 : 'ask',
                whitelist: (_38 = settings.whitelist) !== null && _38 !== void 0 ? _38 : [],
                blacklist: (_39 = settings.blacklist) !== null && _39 !== void 0 ? _39 : [],
                autoApprovePatterns: (_40 = settings.autoApprovePatterns) !== null && _40 !== void 0 ? _40 : [],
                provider: (_42 = (_41 = config.providers) === null || _41 === void 0 ? void 0 : _41.defaultProvider) !== null && _42 !== void 0 ? _42 : null,
            });
            return;
        }
        if (pathname === '/api/settings' && method === 'POST') {
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsedS = tryParseJson(raw);
            if (!parsedS.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const updates = parsedS.value;
            const current = readApprovalSettings(approvalSettingsPath);
            if (updates.defaultAction !== undefined) {
                const valid = ['approve', 'ask', 'deny'];
                if (!valid.includes(updates.defaultAction)) {
                    sendJson(res, 400, { error: 'invalid defaultAction' });
                    return;
                }
                current.defaultAction = updates.defaultAction;
            }
            if (Array.isArray(updates.whitelist))
                current.whitelist = updates.whitelist;
            if (Array.isArray(updates.blacklist))
                current.blacklist = updates.blacklist;
            try {
                saveApprovalSettings(approvalSettingsPath, current);
                sendJson(res, 200, { ok: true, settings: current });
            }
            catch (err) {
                sendJson(res, 500, { error: 'Failed to save settings' });
            }
            return;
        }
        if (pathname === '/api/stats' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            let sessionsCount = 0;
            try {
                const rStats = (_44 = (_43 = runtime).getStats) === null || _44 === void 0 ? void 0 : _44.call(_43);
                sessionsCount = (_46 = (_45 = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _45 === void 0 ? void 0 : _45.active) !== null && _46 !== void 0 ? _46 : 0;
            }
            catch ( /* not critical */_131) { /* not critical */ }
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
            if (!enforceAuth(req, res, query))
                return;
            const raw = yield readBody(req);
            const parsedCreds = tryParseJson(raw);
            if (!parsedCreds.ok) {
                sendJson(res, 400, { error: 'invalid_json' });
                return;
            }
            const creds = parsedCreds.value;
            for (const [k, v] of Object.entries(creds)) {
                const envKey = providerSecretEnvKey(k);
                if (!envKey)
                    continue;
                if (typeof v === 'string') {
                    process.env[envKey] = v;
                }
                else if (v === null) {
                    delete process.env[envKey];
                }
            }
            (_47 = router.refreshFromEnvironment) === null || _47 === void 0 ? void 0 : _47.call(router);
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
            res.end();
            return;
        }
        // All other routes require auth
        const authResult = checkAuth(req, query);
        if (!authResult.ok) {
            sendUnauthorized(res, (_48 = authResult.reason) !== null && _48 !== void 0 ? _48 : 'unknown');
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
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
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
                }
                catch (_132) {
                    sendJson(res, 400, { error: 'workspace path does not exist', code: 'ENOENT' });
                    return;
                }
                const nextConfig = Object.assign(Object.assign({}, config), { workspacePath: workspaceRoot, workspaceRoot });
                try {
                    yield saveConfig(nextConfig, deps.configPath);
                }
                catch (err) {
                    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Failed to save workspace' });
                    return;
                }
                Object.assign(config, nextConfig);
                fsConfig.workspaceRoot = workspaceRoot;
                yield applyRuntimeWorkspace(runtime, workspaceRoot);
                sendJson(res, 200, {
                    ok: true,
                    workspaceRoot,
                    cwd: runtimeWorkspacePath(runtime, workspaceRoot),
                });
                return;
            }
            if (pathname === '/api/approvals/pending' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                sendJson(res, 200, { approvals: approvals.getPending().map(sanitizeApprovalRequest) });
                return;
            }
            if (pathname === '/api/effects/pending' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                sendJson(res, 200, { effects: sanitizeTrustPayload(yield listPendingEffects(orchestration)) });
                return;
            }
            if (pathname === '/api/concepts' && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const concept = parseConceptInput(parsed.value);
                if (!concept.ok) {
                    sendJson(res, 400, { error: concept.error });
                    return;
                }
                const handle = orchestration.universalEngine.dispatchConcept(concept.input);
                sendJson(res, 202, {
                    conceptId: handle.conceptId,
                    runId: handle.runId,
                    status: handle.status(),
                });
                return;
            }
            if (pathname === '/api/concepts' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const concepts = orchestration.universalEngine.listConcepts().map(publicConceptRecord);
                sendJson(res, 200, { concepts });
                return;
            }
            const conceptEventsMatch = pathname.match(/^\/api\/concepts\/([^/]+)\/events\/stream$/);
            if (conceptEventsMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptEventsMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Content-Type-Options': 'nosniff',
                });
                let closed = false;
                let heartbeat;
                const cleanup = [];
                const bufferedEvents = [];
                let bufferingLiveEvents = true;
                const writeRawSSE = (eventName, data) => {
                    if (closed || res.destroyed)
                        return;
                    res.write(`event: ${eventName}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                };
                const writeSSE = (eventName, data) => {
                    if (closed || res.destroyed)
                        return;
                    if (bufferingLiveEvents) {
                        bufferedEvents.push({ eventName, data });
                        return;
                    }
                    writeRawSSE(eventName, data);
                };
                const close = () => {
                    if (closed)
                        return;
                    closed = true;
                    for (const fn of cleanup.splice(0))
                        fn();
                    if (heartbeat)
                        clearInterval(heartbeat);
                };
                heartbeat = setInterval(() => {
                    if (closed || res.destroyed)
                        return;
                    res.write(': heartbeat\n\n');
                }, 15000);
                req.on('close', close);
                try {
                    if ((_49 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) === null || _49 === void 0 ? void 0 : _49.subscribe) {
                        cleanup.push(orchestration.eventLedger.subscribe((event) => {
                            if (isConceptLedgerEvent(event, conceptId, record.runId)) {
                                writeSSE('ledger', { event: sanitizeTrustPayload(event) });
                                if (isTerminalConceptLedgerEvent(event)) {
                                    close();
                                    res.end();
                                }
                            }
                        }));
                    }
                    const events = ((_50 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) === null || _50 === void 0 ? void 0 : _50.readAll)
                        ? (yield orchestration.eventLedger.readAll()).filter((event) => isConceptLedgerEvent(event, conceptId, record.runId))
                        : [];
                    writeRawSSE('snapshot', {
                        concept: publicConceptRecord(record),
                        events: events.map((event) => sanitizeTrustPayload(event)),
                    });
                    bufferingLiveEvents = false;
                    for (const buffered of bufferedEvents.splice(0)) {
                        writeRawSSE(buffered.eventName, buffered.data);
                    }
                }
                catch (err) {
                    bufferingLiveEvents = false;
                    writeRawSSE('error', { message: err instanceof Error ? redactSensitiveText(err.message) : 'concept stream failed' });
                    close();
                    res.end();
                }
                return;
            }
            const conceptPlanMatch = pathname.match(/^\/api\/concepts\/([^/]+)\/plan$/);
            if (conceptPlanMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptPlanMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                if (!record.planRef) {
                    sendJson(res, 404, { error: 'not_ready' });
                    return;
                }
                sendJson(res, 200, publicArtifactRef(record.planRef));
                return;
            }
            const conceptPhasesMatch = pathname.match(/^\/api\/concepts\/([^/]+)\/phases$/);
            if (conceptPhasesMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptPhasesMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                sendJson(res, 200, { phases: conceptPhaseSummary(record) });
                return;
            }
            if (pathname === '/api/telemetry/spans' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const parsed = parseIntQuery(query['limit'], 100, TELEMETRY_SPANS_MAX);
                sendJson(res, 200, publicTelemetrySpansResponse(parsed));
                return;
            }
            if (pathname === '/api/mcp/status' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                sendJson(res, 200, publicMcpStatusPayload(runtime.getMcpClient()));
                return;
            }
            if (pathname === '/api/mcp/config' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                sendJson(res, 200, runtime.getPublicMcpConfig());
                return;
            }
            const mcpRestartMatch = pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/restart$/);
            if (mcpRestartMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const decoded = decodePathSegment(mcpRestartMatch[1]);
                if (decoded === null) {
                    sendJson(res, 400, { error: 'invalid_mcp_server_name' });
                    return;
                }
                const name = decoded.trim();
                if (!name) {
                    sendJson(res, 400, { error: 'invalid_mcp_server_name' });
                    return;
                }
                if (name.length > MCP_RESTART_SERVER_NAME_MAX) {
                    sendJson(res, 400, { error: 'mcp_server_name_too_long' });
                    return;
                }
                const restartMcpServer = (_51 = runtime.restartMcpServer) === null || _51 === void 0 ? void 0 : _51.bind(runtime);
                if (typeof restartMcpServer !== 'function') {
                    sendJson(res, 503, { error: 'runtime_unavailable' });
                    return;
                }
                try {
                    yield restartMcpServer(name);
                    sendJson(res, 200, { ok: true });
                }
                catch (err) {
                    if (err instanceof McpRestartRejectedError) {
                        if (err.code === 'mcp_lifecycle_unavailable') {
                            sendJson(res, 409, { error: err.code, message: err.message });
                        }
                        else {
                            sendJson(res, 404, { error: err.code, message: err.message });
                        }
                        return;
                    }
                    const message = err instanceof Error ? err.message : String(err);
                    sendJson(res, 500, {
                        error: 'mcp_restart_failed',
                        message: redactSensitiveText(message),
                    });
                }
                return;
            }
            const conceptTraceMatch = pathname.match(/^\/api\/concepts\/([^/]+)\/trace$/);
            if (conceptTraceMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptTraceMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                try {
                    sendJson(res, 200, yield buildPublicConceptTrace(orchestration, record));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (message === 'event_ledger_unavailable') {
                        sendJson(res, 503, { error: 'event_ledger_unavailable' });
                        return;
                    }
                    sendJson(res, 500, { error: 'concept_trace_failed', message: redactSensitiveText(message) });
                }
                return;
            }
            const conceptExportMatch = pathname.match(/^\/api\/concepts\/([^/]+)\/export$/);
            if (conceptExportMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptExportMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const kind = ((_52 = firstQueryValue(query.kind)) === null || _52 === void 0 ? void 0 : _52.trim()) || 'incident-packet';
                if (kind !== 'incident-packet') {
                    sendJson(res, 400, { error: 'unsupported_export_kind' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                try {
                    const trace = yield buildPublicConceptTrace(orchestration, record);
                    sendJson(res, 200, buildPublicConceptIncidentPacket(trace));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (message === 'event_ledger_unavailable') {
                        sendJson(res, 503, { error: 'event_ledger_unavailable' });
                        return;
                    }
                    sendJson(res, 500, { error: 'concept_export_failed', message: redactSensitiveText(message) });
                }
                return;
            }
            const conceptLessonsMatch = pathname.match(/^\/api\/concepts\/([^/]+)\/lessons$/);
            if (conceptLessonsMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                if (!(orchestration === null || orchestration === void 0 ? void 0 : orchestration.memoryStore)) {
                    sendJson(res, 503, { error: 'universal_memory_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptLessonsMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                sendJson(res, 200, publicConceptLessonsResponse(record, orchestration.memoryStore));
                return;
            }
            const conceptMatch = pathname.match(/^\/api\/concepts\/([^/]+)$/);
            if (conceptMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                sendJson(res, 200, publicConceptRecord(record));
                return;
            }
            if (conceptMatch && method === 'DELETE') {
                if (!enforceAuth(req, res, query))
                    return;
                if (!supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                const conceptId = decodePathSegment(conceptMatch[1]);
                if (!conceptId) {
                    sendJson(res, 400, { error: 'invalid_concept_id' });
                    return;
                }
                const record = orchestration.universalEngine.getConceptRecord(conceptId);
                if (!record) {
                    sendJson(res, 404, { error: 'concept_not_found' });
                    return;
                }
                orchestration.universalEngine.abort(conceptId, 'aborted via gateway');
                sendJson(res, 200, { aborted: true, conceptId });
                return;
            }
            if (pathname === '/api/events/stream' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Content-Type-Options': 'nosniff',
                });
                let closed = false;
                let heartbeat;
                const cleanup = [];
                const bufferedEvents = [];
                let bufferingLiveEvents = true;
                const writeRawSSE = (eventName, data) => {
                    if (closed || res.destroyed)
                        return;
                    res.write(`event: ${eventName}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                };
                const writeSSE = (eventName, data) => {
                    if (closed || res.destroyed)
                        return;
                    if (bufferingLiveEvents) {
                        bufferedEvents.push({ eventName, data });
                        return;
                    }
                    writeRawSSE(eventName, data);
                };
                const close = () => {
                    if (closed)
                        return;
                    closed = true;
                    for (const fn of cleanup.splice(0))
                        fn();
                    if (heartbeat)
                        clearInterval(heartbeat);
                };
                heartbeat = setInterval(() => {
                    if (closed || res.destroyed)
                        return;
                    res.write(': heartbeat\n\n');
                }, 15000);
                req.on('close', close);
                try {
                    if ((_53 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) === null || _53 === void 0 ? void 0 : _53.subscribe) {
                        cleanup.push(orchestration.eventLedger.subscribe((event) => {
                            if (isOrchestrationEvent(event))
                                writeSSE('ledger', { event: sanitizeTrustPayload(event) });
                        }));
                    }
                    if (approvals.subscribe) {
                        cleanup.push(approvals.subscribe((event) => {
                            writeSSE(event.type, sanitizeApprovalFlowEvent(event));
                        }));
                    }
                    writeRawSSE('snapshot', {
                        dashboard: sanitizeTrustPayload(yield buildOrchestrationDashboard(orchestration, approvals.getPending().length)),
                        runs: sanitizeTrustPayload((_55 = (_54 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _54 === void 0 ? void 0 : _54.listRuns()) !== null && _55 !== void 0 ? _55 : []),
                        approvals: approvals.getPending().map(sanitizeApprovalRequest),
                        effects: sanitizeTrustPayload(yield listPendingEffects(orchestration)),
                        memoryReviews: (yield deps.runtime.listPendingMemoryReviews()).memoryReviews.map((hit) => publicMemorySearchHit(hit)),
                    });
                    bufferingLiveEvents = false;
                    for (const buffered of bufferedEvents.splice(0)) {
                        writeRawSSE(buffered.eventName, buffered.data);
                    }
                }
                catch (err) {
                    bufferingLiveEvents = false;
                    writeRawSSE('error', { message: err instanceof Error ? redactSensitiveText(err.message) : 'operator stream failed' });
                    close();
                    res.end();
                }
                return;
            }
            const approvalDecisionMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
            if (approvalDecisionMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (body.decision !== 'approve' && body.decision !== 'deny') {
                    sendJson(res, 400, { error: 'decision must be approve or deny' });
                    return;
                }
                const ok = approvals.resolveDecision(approvalDecisionMatch[1], body.decision);
                if (!ok) {
                    sendJson(res, 404, { error: 'approval_not_found' });
                    return;
                }
                sendJson(res, 200, { ok: true, decision: body.decision });
                return;
            }
            if (pathname === '/api/audit/events' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const rawLimit = Number((_56 = query['limit']) !== null && _56 !== void 0 ? _56 : 100);
                const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 100;
                const requestId = typeof query['requestId'] === 'string' ? query['requestId'].trim() : '';
                const matchesRequestId = (event) => {
                    if (!requestId || !event || typeof event !== 'object')
                        return !requestId;
                    const record = event;
                    return record['requestId'] === requestId || record['approval_id'] === requestId;
                };
                const rawApprovalEvents = requestId && approvals.listAuditByRequestId
                    ? approvals.listAuditByRequestId(requestId, 1000)
                    : approvals.listAudit(requestId ? 1000 : limit);
                const approvalEvents = rawApprovalEvents
                    .map((event) => sanitizeApprovalAuditEvent(event))
                    .filter(matchesRequestId);
                const resolvedApproval = requestId ? (_57 = approvals.getResolvedApproval) === null || _57 === void 0 ? void 0 : _57.call(approvals, requestId) : undefined;
                if (resolvedApproval && !approvalEvents.some((event) => event.requestId === requestId
                    && (event.type === 'approval.approved' || event.type === 'approval.denied' || event.type === 'approval.timeout'))) {
                    const request = resolvedApproval.request;
                    const resolvedEvent = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: `${requestId}:resolved:${resolvedApproval.decision}`, ts: new Date().toISOString(), type: resolvedApproval.decision === 'approve'
                            ? 'approval.approved'
                            : resolvedApproval.decision === 'deny'
                                ? 'approval.denied'
                                : 'approval.timeout', requestId, toolName: request.toolName, summary: request.summary, args: request.args, decision: resolvedApproval.decision }, (request.run_id !== undefined ? { run_id: request.run_id } : {})), (request.effect_id !== undefined ? { effect_id: request.effect_id } : {})), (request.effect_kind !== undefined ? { effect_kind: request.effect_kind } : {})), (request.policy_id !== undefined ? { policy_id: request.policy_id } : {})), (request.reason !== undefined ? { reason: request.reason } : {})), (request.approval_required !== undefined ? { approval_required: request.approval_required } : {}));
                    approvalEvents.unshift(sanitizeApprovalAuditEvent(resolvedEvent));
                }
                const ledgerEvents = (orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger)
                    ? (yield orchestration.eventLedger.readAll())
                        .filter(isOrchestrationEvent)
                        .filter(matchesRequestId)
                        .slice(-limit)
                        .reverse()
                        .map((event) => sanitizeTrustPayload(event))
                    : [];
                const events = [...ledgerEvents, ...approvalEvents].sort((left, right) => {
                    const leftTs = typeof left.ts === 'string' ? Date.parse(left.ts) : 0;
                    const rightTs = typeof right.ts === 'string' ? Date.parse(right.ts) : 0;
                    if (rightTs !== leftTs)
                        return rightTs - leftTs;
                    const leftSeq = 'seq' in left && typeof left.seq === 'number' ? left.seq : 0;
                    const rightSeq = 'seq' in right && typeof right.seq === 'number' ? right.seq : 0;
                    return rightSeq - leftSeq;
                });
                sendJson(res, 200, { events: events.slice(0, limit) });
                return;
            }
            if (pathname === '/api/product-factory/templates' && method === 'GET') {
                const listTemplates = runtime.listProductFactoryTemplates;
                const templates = typeof listTemplates === 'function'
                    ? listTemplates.call(runtime)
                    : fallbackProductFactory.listTemplates();
                sendJson(res, 200, { templates });
                return;
            }
            if (pathname === '/api/product-factory/plan' && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseProductFactoryPlanInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'templateId and prompt are required' });
                    return;
                }
                try {
                    const previewPlan = runtime.previewProductFactoryPlan;
                    const preview = typeof previewPlan === 'function'
                        ? previewPlan.call(runtime, input)
                        : fallbackProductFactory.previewPlan(input);
                    sendJson(res, 200, { preview });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'product_factory_plan_failed' });
                }
                return;
            }
            if (pathname === '/api/ochag/privacy' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const overlay = (_59 = (_58 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _58 === void 0 ? void 0 : _58.get('ochag')) === null || _59 === void 0 ? void 0 : _59.manifest;
                if (!overlay) {
                    sendJson(res, 404, { error: 'ochag_overlay_not_found' });
                    return;
                }
                sendJson(res, 200, {
                    domainId: 'ochag',
                    privacyRules: (_60 = overlay.privacyRules) !== null && _60 !== void 0 ? _60 : [],
                    toolPermissionOverrides: (_61 = overlay.toolPermissionOverrides) !== null && _61 !== void 0 ? _61 : {},
                    adapterRegistrations: (_62 = overlay.adapterRegistrations) !== null && _62 !== void 0 ? _62 : [],
                });
                return;
            }
            if (pathname === '/api/ochag/reminders/preview' && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseOchagReminderPlanInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'title is required' });
                    return;
                }
                try {
                    const previewPlan = runtime.previewProductFactoryPlan;
                    const preview = typeof previewPlan === 'function'
                        ? previewPlan.call(runtime, input)
                        : fallbackProductFactory.previewPlan(input);
                    sendJson(res, 200, { preview });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'ochag_preview_failed' });
                }
                return;
            }
            if (pathname === '/api/ochag/reminders' && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
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
                const createProductRun = runtime.createProductFactoryRun;
                if (typeof createProductRun !== 'function') {
                    sendJson(res, 501, { error: 'product_factory_unavailable' });
                    return;
                }
                try {
                    const result = yield createProductRun.call(runtime, input);
                    sendJson(res, 201, result);
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'ochag_create_failed' });
                }
                return;
            }
            if (pathname === '/api/ceoclaw/briefs/preview' && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseCeoclawBriefPlanInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'decision is required' });
                    return;
                }
                try {
                    const previewPlan = runtime.previewProductFactoryPlan;
                    const preview = typeof previewPlan === 'function'
                        ? previewPlan.call(runtime, input)
                        : fallbackProductFactory.previewPlan(input);
                    sendJson(res, 200, { preview });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'ceoclaw_preview_failed' });
                }
                return;
            }
            if (pathname === '/api/ceoclaw/briefs' && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
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
                const createProductRun = runtime.createProductFactoryRun;
                if (typeof createProductRun !== 'function') {
                    sendJson(res, 501, { error: 'product_factory_unavailable' });
                    return;
                }
                try {
                    const result = yield createProductRun.call(runtime, input);
                    sendJson(res, 201, result);
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'ceoclaw_create_failed' });
                }
                return;
            }
            if (pathname === '/api/runs' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                sendJson(res, 200, { runs: (_64 = (_63 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _63 === void 0 ? void 0 : _63.listRuns()) !== null && _64 !== void 0 ? _64 : [] });
                return;
            }
            if (pathname === '/api/runs' && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
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
                const createProductRun = runtime.createProductFactoryRun;
                if (typeof createProductRun !== 'function') {
                    sendJson(res, 501, { error: 'product_factory_unavailable' });
                    return;
                }
                try {
                    const result = yield createProductRun.call(runtime, input);
                    sendJson(res, 201, result);
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'product_factory_run_failed' });
                }
                return;
            }
            const runEventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
            if (runEventsMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runEventsMatch[1]);
                const events = (yield listRunEvents(orchestration, runId)).map((event) => sanitizeTrustPayload(event));
                sendJson(res, 200, { events });
                return;
            }
            const runTimelineMatch = pathname.match(/^\/api\/runs\/([^/]+)\/timeline$/);
            if (runTimelineMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runTimelineMatch[1]);
                const getRunTimeline = runtime.getRunTimeline;
                if (typeof getRunTimeline !== 'function') {
                    sendJson(res, 501, { error: 'run_timeline_unavailable' });
                    return;
                }
                try {
                    const result = yield getRunTimeline.call(runtime, runId);
                    if (!result) {
                        sendJson(res, 404, { error: 'run_not_found' });
                        return;
                    }
                    sendJson(res, 200, buildPublicRunTimeline(result));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'run_timeline_unavailable';
                    if (message === 'RunTimeline: orchestration is disabled') {
                        sendJson(res, 503, { error: 'run_timeline_unavailable' });
                        return;
                    }
                    sendJson(res, 500, { error: 'run_timeline_unavailable' });
                }
                return;
            }
            const runDagMatch = pathname.match(/^\/api\/runs\/([^/]+)\/dag$/);
            if (runDagMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runDagMatch[1]);
                const nodes = (_66 = (_65 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.dag) === null || _65 === void 0 ? void 0 : _65.listNodes().filter((node) => nodeBelongsToRun(node, runId)).map((node) => sanitizePublicDagNode(node))) !== null && _66 !== void 0 ? _66 : [];
                sendJson(res, 200, { nodes });
                return;
            }
            const runFramesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/frames$/);
            if (runFramesMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runFramesMatch[1]);
                sendJson(res, 200, { frames: listWorkerFrames(orchestration, runId) });
                return;
            }
            const runActorsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors$/);
            if (runActorsMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runActorsMatch[1]);
                const staleAfterMs = parseIntQuery(query['staleAfterMs'], 0, 24 * 60 * 60000);
                sendJson(res, 200, yield buildActorSnapshot(orchestration, runId, staleAfterMs > 0 ? { staleAfterMs } : {}));
                return;
            }
            const runActorRecoverStuckMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/recover-stuck$/);
            if (runActorRecoverStuckMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runActorRecoverStuckMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseRecoverStuckActorsInput(parsed.value, runId);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_actor_recovery_request' });
                    return;
                }
                const recoverStuckActorMessages = runtime.recoverStuckActorMessages;
                if (typeof recoverStuckActorMessages !== 'function') {
                    sendJson(res, 501, { error: 'actor_kernel_unavailable' });
                    return;
                }
                try {
                    const recovery = yield recoverStuckActorMessages.call(runtime, input);
                    sendJson(res, 200, {
                        ok: true,
                        recovery: Object.assign(Object.assign({}, recovery), { recovered: recovery.recovered.map((node) => sanitizePublicDagNode(node)) }),
                        snapshot: yield buildActorSnapshot(orchestration, runId, { staleAfterMs: input.olderThanMs }),
                    });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_recovery_failed' });
                }
                return;
            }
            const runActorMessagesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages$/);
            if (runActorMessagesMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runActorMessagesMatch[1]);
                const staleAfterMs = parseIntQuery(query['staleAfterMs'], 0, 24 * 60 * 60000);
                sendJson(res, 200, {
                    runId: redactSensitiveText(runId).slice(0, 180),
                    messages: listActorMailboxMessages(orchestration, runId, staleAfterMs > 0 ? { staleAfterMs } : {}),
                });
                return;
            }
            if (runActorMessagesMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runActorMessagesMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseActorMailboxMessageInput(parsed.value, runId);
                if (!input) {
                    sendJson(res, 400, { error: 'actorId and task are required' });
                    return;
                }
                const enqueueActorMessage = runtime.enqueueActorMessage;
                if (typeof enqueueActorMessage !== 'function') {
                    sendJson(res, 501, { error: 'actor_kernel_unavailable' });
                    return;
                }
                try {
                    const spawnActor = runtime.spawnActor;
                    const actor = input.spawn
                        ? typeof spawnActor === 'function'
                            ? yield spawnActor.call(runtime, input.spawn)
                            : null
                        : null;
                    if (input.spawn && !actor) {
                        sendJson(res, 501, { error: 'actor_kernel_unavailable' });
                        return;
                    }
                    const message = yield enqueueActorMessage.call(runtime, input.message);
                    sendJson(res, 201, Object.assign(Object.assign({ ok: true }, (actor ? { actor } : {})), { message: sanitizePublicDagNode(message), snapshot: yield buildActorSnapshot(orchestration, runId) }));
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_message_enqueue_failed' });
                }
                return;
            }
            const runActorLeaseMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages\/lease$/);
            if (runActorLeaseMatch && method === 'POST') {
                const runId = decodeURIComponent(runActorLeaseMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = recordValue(parsed.value);
                if (!body) {
                    sendJson(res, 400, { error: 'invalid_actor_lease_request' });
                    return;
                }
                const owner = authenticatedActorOwner(req, res, body, query);
                if (!owner)
                    return;
                const input = parseActorLeaseInput(parsed.value, runId, owner);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_actor_lease_request' });
                    return;
                }
                const leaseActorMessage = runtime.leaseActorMessage;
                if (typeof leaseActorMessage !== 'function') {
                    sendJson(res, 501, { error: 'actor_kernel_unavailable' });
                    return;
                }
                try {
                    const lease = yield leaseActorMessage.call(runtime, input);
                    sendJson(res, 200, {
                        ok: true,
                        lease: lease ? Object.assign(Object.assign({}, lease), { node: sanitizePublicDagNode(lease.node) }) : null,
                        snapshot: yield buildActorSnapshot(orchestration, runId),
                    });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_message_lease_failed' });
                }
                return;
            }
            const runActorDispatchNextMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages\/dispatch-next$/);
            if (runActorDispatchNextMatch && method === 'POST') {
                const runId = decodeURIComponent(runActorDispatchNextMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = recordValue(parsed.value);
                if (!body) {
                    sendJson(res, 400, { error: 'invalid_actor_dispatch_request' });
                    return;
                }
                const owner = authenticatedActorOwner(req, res, body, query);
                if (!owner)
                    return;
                const input = parseActorDispatchInput(parsed.value, runId, owner);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_actor_dispatch_request' });
                    return;
                }
                const dispatchNextActorMessage = runtime.dispatchNextActorMessage;
                if (typeof dispatchNextActorMessage !== 'function') {
                    sendJson(res, 501, { error: 'actor_kernel_unavailable' });
                    return;
                }
                try {
                    const dispatch = yield dispatchNextActorMessage.call(runtime, input);
                    sendJson(res, 200, {
                        ok: true,
                        dispatch: sanitizeActorDispatchResult(dispatch),
                        snapshot: yield buildActorSnapshot(orchestration, runId),
                    });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'actor_message_dispatch_failed' });
                }
                return;
            }
            const runActorMessageControlMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actors\/messages\/([^/]+)\/(complete|fail)$/);
            if (runActorMessageControlMatch && method === 'POST') {
                const runId = decodeURIComponent(runActorMessageControlMatch[1]);
                const nodeId = decodeURIComponent(runActorMessageControlMatch[2]);
                const action = runActorMessageControlMatch[3];
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = recordValue(parsed.value);
                if (!body) {
                    sendJson(res, 400, { error: `invalid_actor_message_${action}_request` });
                    return;
                }
                const owner = authenticatedActorOwner(req, res, body, query);
                if (!owner)
                    return;
                try {
                    if (action === 'complete') {
                        const input = parseActorCompleteInput(parsed.value, runId, nodeId, owner);
                        if (!input) {
                            sendJson(res, 400, { error: 'invalid_actor_message_complete_request' });
                            return;
                        }
                        const completeActorMessage = runtime.completeActorMessage;
                        if (typeof completeActorMessage !== 'function') {
                            sendJson(res, 501, { error: 'actor_kernel_unavailable' });
                            return;
                        }
                        const completion = yield completeActorMessage.call(runtime, input);
                        sendJson(res, 200, {
                            ok: true,
                            completion: Object.assign(Object.assign({}, completion), { node: sanitizePublicDagNode(completion.node), proofArtifact: publicArtifactRef(completion.proofArtifact) }),
                            snapshot: yield buildActorSnapshot(orchestration, runId),
                        });
                        return;
                    }
                    const input = parseActorFailInput(parsed.value, runId, nodeId, owner);
                    if (!input) {
                        sendJson(res, 400, { error: 'invalid_actor_message_fail_request' });
                        return;
                    }
                    const failActorMessage = runtime.failActorMessage;
                    if (typeof failActorMessage !== 'function') {
                        sendJson(res, 501, { error: 'actor_kernel_unavailable' });
                        return;
                    }
                    const failure = yield failActorMessage.call(runtime, input);
                    sendJson(res, 200, {
                        ok: true,
                        failure: sanitizePublicDagNode(failure),
                        snapshot: yield buildActorSnapshot(orchestration, runId),
                    });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : `actor_message_${action}_failed` });
                }
                return;
            }
            const runProductFactoryPlanMatch = pathname.match(/^\/api\/runs\/([^/]+)\/product-factory-plan$/);
            if (runProductFactoryPlanMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runProductFactoryPlanMatch[1]);
                const getRunProductFactoryPlan = runtime.getRunProductFactoryPlan;
                if (typeof getRunProductFactoryPlan !== 'function') {
                    sendJson(res, 501, { error: 'product_factory_plan_unavailable' });
                    return;
                }
                try {
                    const result = yield getRunProductFactoryPlan.call(runtime, runId);
                    sendJson(res, 200, {
                        artifact: publicArtifactRef(result.artifact),
                        preview: sanitizeTrustPayload(result.preview),
                    });
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'product_factory_plan_not_found' });
                }
                return;
            }
            const runContextPackMatch = pathname.match(/^\/api\/runs\/([^/]+)\/context-pack$/);
            if (runContextPackMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runContextPackMatch[1]);
                const getRunContextPack = runtime.getRunContextPack;
                if (typeof getRunContextPack !== 'function') {
                    sendJson(res, 501, { error: 'context_pack_unavailable' });
                    return;
                }
                try {
                    const result = yield getRunContextPack.call(runtime, runId);
                    if (!result) {
                        sendJson(res, 404, { error: 'context_pack_not_found', runId });
                        return;
                    }
                    sendJson(res, 200, {
                        artifact: publicArtifactRef(result.artifact),
                        pack: publicContextPack(result.pack),
                    });
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'context_pack_not_found' });
                }
                return;
            }
            if (runContextPackMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runContextPackMatch[1]);
                const refreshRunContextPack = runtime.refreshRunContextPack;
                if (typeof refreshRunContextPack !== 'function') {
                    sendJson(res, 501, { error: 'context_pack_refresh_unavailable' });
                    return;
                }
                try {
                    const result = yield refreshRunContextPack.call(runtime, runId);
                    sendJson(res, 200, {
                        artifact: publicArtifactRef(result.artifact),
                        previousArtifact: publicArtifactRef(result.previousArtifact),
                        pack: publicContextPack(result.pack),
                    });
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'context_pack_refresh_failed' });
                }
                return;
            }
            const runBrowserSmokeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/browser-smoke$/);
            if (runBrowserSmokeMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runBrowserSmokeMatch[1]);
                const listRunBrowserSmoke = runtime.listRunBrowserSmoke;
                if (typeof listRunBrowserSmoke !== 'function') {
                    sendJson(res, 501, { error: 'browser_smoke_unavailable' });
                    return;
                }
                try {
                    const smoke = yield listRunBrowserSmoke.call(runtime, runId);
                    sendJson(res, 200, {
                        smoke: smoke.map((entry) => ({
                            artifact: publicArtifactRef(entry.artifact),
                            screenshotArtifact: entry.screenshotArtifact ? publicArtifactRef(entry.screenshotArtifact) : null,
                            snapshot: entry.snapshot,
                        })),
                    });
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'browser_smoke_not_found' });
                }
                return;
            }
            if (runBrowserSmokeMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runBrowserSmokeMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseBrowserSmokeInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_browser_smoke_request' });
                    return;
                }
                let normalized;
                try {
                    normalized = normalizeBrowserSmokeInput(input);
                }
                catch (err) {
                    sendJson(res, 400, { error: 'invalid_browser_smoke_request', message: err instanceof Error ? err.message : 'invalid browser smoke request' });
                    return;
                }
                const captureRunBrowserSmoke = runtime.captureRunBrowserSmoke;
                if (typeof captureRunBrowserSmoke !== 'function') {
                    sendJson(res, 501, { error: 'browser_smoke_unavailable' });
                    return;
                }
                const expectedApprovalId = buildBrowserSmokeApprovalId(normalized, runId);
                const approvalArgs = {
                    runId,
                    targetUrlHash: normalized.urlHash,
                    host: normalized.host,
                    pathHash: createHash('sha256').update(normalized.path).digest('hex'),
                    assertionHash: normalized.assertionHash,
                    fullPage: normalized.fullPage,
                    browserSmoke: true,
                };
                const approvalId = input.approvalId;
                if (!approvalId) {
                    const existing = (_67 = approvals.getPending().find((request) => request.id === expectedApprovalId)) !== null && _67 !== void 0 ? _67 : (_69 = (_68 = approvals.getResolvedApproval) === null || _68 === void 0 ? void 0 : _68.call(approvals, expectedApprovalId)) === null || _69 === void 0 ? void 0 : _69.request;
                    if (existing) {
                        sendJson(res, 202, { status: 'approval_required', runId, approval: existing, browserSmoke: true });
                        return;
                    }
                    if (!approvals.enqueueApproval) {
                        sendJson(res, 501, { error: 'browser_smoke_approval_unavailable' });
                        return;
                    }
                    const approval = yield approvals.enqueueApproval({
                        id: expectedApprovalId,
                        toolName: 'browser_smoke',
                        summary: `Run local browser smoke for ${runId}`,
                        args: approvalArgs,
                        run_id: runId,
                        reason: 'Browser smoke launches a local browser, navigates to a localhost URL and captures a screenshot, so it requires explicit approval',
                        approval_required: true,
                    });
                    sendJson(res, 202, { status: 'approval_required', runId, approval, browserSmoke: true });
                    return;
                }
                if (approvalId !== expectedApprovalId) {
                    sendJson(res, 403, { error: 'approval_mismatch', runId });
                    return;
                }
                const resolvedApproval = (_70 = approvals.getResolvedApproval) === null || _70 === void 0 ? void 0 : _70.call(approvals, approvalId);
                if (!resolvedApproval) {
                    sendJson(res, 409, { error: 'approval_pending', runId, approvalId });
                    return;
                }
                if (resolvedApproval.request.toolName !== 'browser_smoke'
                    || resolvedApproval.request.args['runId'] !== runId
                    || resolvedApproval.request.args['targetUrlHash'] !== normalized.urlHash
                    || resolvedApproval.request.args['assertionHash'] !== normalized.assertionHash
                    || resolvedApproval.request.args['fullPage'] !== normalized.fullPage) {
                    sendJson(res, 403, { error: 'approval_mismatch', runId });
                    return;
                }
                if (resolvedApproval.decision !== 'approve') {
                    (_71 = approvals.consumeResolvedApproval) === null || _71 === void 0 ? void 0 : _71.call(approvals, approvalId);
                    sendJson(res, 403, { error: 'browser_smoke_denied', runId, approvalId, decision: resolvedApproval.decision });
                    return;
                }
                if (!((_72 = approvals.consumeResolvedApproval) === null || _72 === void 0 ? void 0 : _72.call(approvals, approvalId))) {
                    sendJson(res, 409, { error: 'approval_unavailable', runId, approvalId });
                    return;
                }
                try {
                    const result = yield captureRunBrowserSmoke.call(runtime, runId, Object.assign(Object.assign({}, input), { approvalId }));
                    (_73 = approvals.recordToolOutcome) === null || _73 === void 0 ? void 0 : _73.call(approvals, {
                        requestId: approvalId,
                        toolName: 'browser_smoke',
                        summary: `Run local browser smoke for ${runId}`,
                        args: approvalArgs,
                        decision: 'approve',
                        resultSummary: `Browser smoke ${result.snapshot.status}; screenshot captured`,
                        undo: { supported: false },
                    });
                    sendJson(res, 201, {
                        status: 'captured',
                        artifact: publicArtifactRef(result.artifact),
                        screenshotArtifact: publicArtifactRef(result.screenshotArtifact),
                        snapshot: result.snapshot,
                    });
                }
                catch (err) {
                    const errorMessage = redactSensitiveText(err instanceof Error ? err.message : String(err));
                    (_74 = approvals.recordToolOutcome) === null || _74 === void 0 ? void 0 : _74.call(approvals, {
                        requestId: approvalId,
                        toolName: 'browser_smoke',
                        summary: `Run local browser smoke for ${runId}`,
                        args: approvalArgs,
                        decision: 'approve',
                        error: errorMessage,
                        undo: { supported: false },
                    });
                    sendJson(res, 500, { error: 'browser_smoke_failed', runId, message: errorMessage });
                }
                return;
            }
            const runResearchSearchMatch = pathname.match(/^\/api\/runs\/([^/]+)\/research-search$/);
            if (runResearchSearchMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runResearchSearchMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseResearchSearchInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_research_search_request' });
                    return;
                }
                const captureRunResearchSearch = runtime.captureRunResearchSearch;
                if (typeof captureRunResearchSearch !== 'function') {
                    sendJson(res, 501, { error: 'research_search_unavailable' });
                    return;
                }
                const maxResults = (_75 = input.maxResults) !== null && _75 !== void 0 ? _75 : 5;
                let provider;
                try {
                    provider = (_76 = input.provider) !== null && _76 !== void 0 ? _76 : resolveGovernedResearchSearchProvider(process.env);
                }
                catch (err) {
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
                    const existing = (_77 = approvals.getPending().find((request) => request.id === expectedApprovalId)) !== null && _77 !== void 0 ? _77 : (_79 = (_78 = approvals.getResolvedApproval) === null || _78 === void 0 ? void 0 : _78.call(approvals, expectedApprovalId)) === null || _79 === void 0 ? void 0 : _79.request;
                    if (existing) {
                        sendJson(res, 202, { status: 'approval_required', runId, approval: existing, liveSearch: true });
                        return;
                    }
                    if (!approvals.enqueueApproval) {
                        sendJson(res, 501, { error: 'research_search_approval_unavailable' });
                        return;
                    }
                    const approval = yield approvals.enqueueApproval({
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
                const resolvedApproval = (_80 = approvals.getResolvedApproval) === null || _80 === void 0 ? void 0 : _80.call(approvals, approvalId);
                if (!resolvedApproval) {
                    sendJson(res, 409, { error: 'approval_pending', runId, approvalId });
                    return;
                }
                if (resolvedApproval.request.toolName !== 'research_live_search'
                    || resolvedApproval.request.args['runId'] !== runId
                    || resolvedApproval.request.args['queryHash'] !== queryHash
                    || resolvedApproval.request.args['maxResults'] !== maxResults
                    || resolvedApproval.request.args['provider'] !== provider) {
                    sendJson(res, 403, { error: 'approval_mismatch', runId });
                    return;
                }
                if (resolvedApproval.decision !== 'approve') {
                    (_81 = approvals.consumeResolvedApproval) === null || _81 === void 0 ? void 0 : _81.call(approvals, approvalId);
                    sendJson(res, 403, { error: 'research_search_denied', runId, approvalId, decision: resolvedApproval.decision });
                    return;
                }
                if (!((_82 = approvals.consumeResolvedApproval) === null || _82 === void 0 ? void 0 : _82.call(approvals, approvalId))) {
                    sendJson(res, 409, { error: 'approval_unavailable', runId, approvalId });
                    return;
                }
                try {
                    const result = yield captureRunResearchSearch.call(runtime, runId, Object.assign(Object.assign({}, input), { maxResults,
                        provider,
                        approvalId }));
                    (_83 = approvals.recordToolOutcome) === null || _83 === void 0 ? void 0 : _83.call(approvals, {
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
                }
                catch (err) {
                    const errorMessage = redactSensitiveText(err instanceof Error ? err.message : String(err));
                    (_84 = approvals.recordToolOutcome) === null || _84 === void 0 ? void 0 : _84.call(approvals, {
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
            const runResearchSourceCaptureMatch = pathname.match(/^\/api\/runs\/([^/]+)\/research-source-captures$/);
            if (runResearchSourceCaptureMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runResearchSourceCaptureMatch[1]);
                const listRunResearchSourceCaptures = runtime.listRunResearchSourceCaptures;
                if (typeof listRunResearchSourceCaptures !== 'function') {
                    sendJson(res, 501, { error: 'research_source_capture_unavailable' });
                    return;
                }
                try {
                    const captures = yield listRunResearchSourceCaptures.call(runtime, runId);
                    sendJson(res, 200, {
                        captures: captures.map((entry) => ({
                            artifact: publicArtifactRef(entry.artifact),
                            snapshot: sanitizeTrustPayload(entry.snapshot),
                        })),
                    });
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'research_source_capture_not_found' });
                }
                return;
            }
            if (runResearchSourceCaptureMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runResearchSourceCaptureMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseResearchSourceCaptureInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_research_source_capture_request' });
                    return;
                }
                let normalized;
                try {
                    normalized = normalizeResearchSourceCaptureInput(input);
                }
                catch (err) {
                    sendJson(res, 400, { error: 'invalid_research_source_capture_request', message: err instanceof Error ? err.message : 'invalid research source capture request' });
                    return;
                }
                const captureRunResearchSource = runtime.captureRunResearchSource;
                if (typeof captureRunResearchSource !== 'function') {
                    sendJson(res, 501, { error: 'research_source_capture_unavailable' });
                    return;
                }
                const expectedApprovalId = buildResearchSourceCaptureApprovalId(normalized, runId);
                const approvalArgs = {
                    runId,
                    sourceHost: normalized.host,
                    sourceUrlHash: normalized.urlHash,
                    sourcePathHash: normalized.pathHash,
                    governedSourceCapture: true,
                };
                const approvalId = input.approvalId;
                if (!approvalId) {
                    const existing = (_85 = approvals.getPending().find((request) => request.id === expectedApprovalId)) !== null && _85 !== void 0 ? _85 : (_87 = (_86 = approvals.getResolvedApproval) === null || _86 === void 0 ? void 0 : _86.call(approvals, expectedApprovalId)) === null || _87 === void 0 ? void 0 : _87.request;
                    if (existing) {
                        sendJson(res, 202, { status: 'approval_required', runId, approval: existing, sourceCapture: true });
                        return;
                    }
                    if (!approvals.enqueueApproval) {
                        sendJson(res, 501, { error: 'research_source_capture_approval_unavailable' });
                        return;
                    }
                    const approval = yield approvals.enqueueApproval({
                        id: expectedApprovalId,
                        toolName: 'research_source_capture',
                        summary: `Capture governed research source for ${runId}`,
                        args: approvalArgs,
                        run_id: runId,
                        reason: 'Research source capture performs a bounded network fetch and stores sanitized source evidence, so it requires explicit approval',
                        approval_required: true,
                    });
                    sendJson(res, 202, { status: 'approval_required', runId, approval, sourceCapture: true });
                    return;
                }
                if (approvalId !== expectedApprovalId) {
                    sendJson(res, 403, { error: 'approval_mismatch', runId });
                    return;
                }
                const resolvedApproval = (_88 = approvals.getResolvedApproval) === null || _88 === void 0 ? void 0 : _88.call(approvals, approvalId);
                if (!resolvedApproval) {
                    sendJson(res, 409, { error: 'approval_pending', runId, approvalId });
                    return;
                }
                if (resolvedApproval.request.toolName !== 'research_source_capture'
                    || resolvedApproval.request.args['runId'] !== runId
                    || resolvedApproval.request.args['sourceUrlHash'] !== normalized.urlHash
                    || resolvedApproval.request.args['sourcePathHash'] !== normalized.pathHash) {
                    sendJson(res, 403, { error: 'approval_mismatch', runId });
                    return;
                }
                if (resolvedApproval.decision !== 'approve') {
                    (_89 = approvals.consumeResolvedApproval) === null || _89 === void 0 ? void 0 : _89.call(approvals, approvalId);
                    sendJson(res, 403, { error: 'research_source_capture_denied', runId, approvalId, decision: resolvedApproval.decision });
                    return;
                }
                if (!((_90 = approvals.consumeResolvedApproval) === null || _90 === void 0 ? void 0 : _90.call(approvals, approvalId))) {
                    sendJson(res, 409, { error: 'approval_unavailable', runId, approvalId });
                    return;
                }
                try {
                    const result = yield captureRunResearchSource.call(runtime, runId, Object.assign(Object.assign({}, input), { approvalId }));
                    (_91 = approvals.recordToolOutcome) === null || _91 === void 0 ? void 0 : _91.call(approvals, {
                        requestId: approvalId,
                        toolName: 'research_source_capture',
                        summary: `Capture governed research source for ${runId}`,
                        args: approvalArgs,
                        decision: 'approve',
                        resultSummary: `Research source captured from ${result.snapshot.finalHost}`,
                        undo: { supported: false },
                    });
                    sendJson(res, 201, {
                        status: 'captured',
                        artifact: publicArtifactRef(result.artifact),
                        snapshot: sanitizeTrustPayload(result.snapshot),
                    });
                }
                catch (err) {
                    const errorMessage = redactSensitiveText(err instanceof Error ? err.message : String(err));
                    (_92 = approvals.recordToolOutcome) === null || _92 === void 0 ? void 0 : _92.call(approvals, {
                        requestId: approvalId,
                        toolName: 'research_source_capture',
                        summary: `Capture governed research source for ${runId}`,
                        args: approvalArgs,
                        decision: 'approve',
                        error: errorMessage,
                        undo: { supported: false },
                    });
                    sendJson(res, 500, { error: 'research_source_capture_failed', runId, message: errorMessage });
                }
                return;
            }
            const runResearchEvidenceMatch = pathname.match(/^\/api\/runs\/([^/]+)\/research-evidence$/);
            if (runResearchEvidenceMatch && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runResearchEvidenceMatch[1]);
                const listRunResearchEvidence = runtime.listRunResearchEvidence;
                if (typeof listRunResearchEvidence !== 'function') {
                    sendJson(res, 501, { error: 'research_evidence_unavailable' });
                    return;
                }
                try {
                    const evidence = yield listRunResearchEvidence.call(runtime, runId);
                    sendJson(res, 200, {
                        evidence: evidence.map((entry) => ({
                            artifact: publicArtifactRef(entry.artifact),
                            snapshot: entry.snapshot,
                        })),
                    });
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'research_evidence_not_found' });
                }
                return;
            }
            if (runResearchEvidenceMatch && method === 'POST') {
                if (!enforceAuth(req, res, query))
                    return;
                const runId = decodeURIComponent(runResearchEvidenceMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseResearchEvidenceInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_research_evidence_request' });
                    return;
                }
                const createRunResearchEvidence = runtime.createRunResearchEvidence;
                if (typeof createRunResearchEvidence !== 'function') {
                    sendJson(res, 501, { error: 'research_evidence_unavailable' });
                    return;
                }
                try {
                    const result = yield createRunResearchEvidence.call(runtime, runId, input);
                    sendJson(res, 201, {
                        artifact: publicArtifactRef(result.artifact),
                        snapshot: result.snapshot,
                    });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'research_evidence_failed' });
                }
                return;
            }
            const runDeliveryEvidenceMatch = pathname.match(/^\/api\/runs\/([^/]+)\/delivery-evidence$/);
            if (runDeliveryEvidenceMatch && method === 'GET') {
                const runId = decodeURIComponent(runDeliveryEvidenceMatch[1]);
                const getDeliveryEvidence = runtime.getRunDeliveryEvidence;
                if (typeof getDeliveryEvidence !== 'function') {
                    sendJson(res, 501, { error: 'delivery_evidence_unavailable' });
                    return;
                }
                try {
                    const evidence = yield getDeliveryEvidence.call(runtime, runId);
                    sendJson(res, 200, publicDeliveryEvidenceResponse(evidence));
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'delivery_evidence_not_found' });
                }
                return;
            }
            if (runDeliveryEvidenceMatch && method === 'POST') {
                const runId = decodeURIComponent(runDeliveryEvidenceMatch[1]);
                const raw = yield readBody(req);
                const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                const captureDeliveryEvidence = runtime.captureRunDeliveryEvidence;
                if (typeof captureDeliveryEvidence !== 'function') {
                    sendJson(res, 501, { error: 'delivery_evidence_unavailable' });
                    return;
                }
                try {
                    const evidence = yield captureDeliveryEvidence.call(runtime, runId, body);
                    sendJson(res, 201, publicDeliveryEvidenceResponse(evidence));
                }
                catch (err) {
                    sendJson(res, 409, { error: err instanceof Error ? err.message : 'delivery_evidence_failed' });
                }
                return;
            }
            const runKsReconciliationReviewPackMatch = pathname.match(/^\/api\/runs\/([^/]+)\/reconciliation\/review-pack$/);
            if (runKsReconciliationReviewPackMatch && method === 'GET') {
                const runId = decodeURIComponent(runKsReconciliationReviewPackMatch[1]);
                const getReviewPack = runtime.getRunKsReconciliationReviewPack;
                if (typeof getReviewPack !== 'function') {
                    sendJson(res, 501, { error: 'ks_reconciliation_review_unavailable' });
                    return;
                }
                try {
                    const review = yield getReviewPack.call(runtime, runId);
                    sendJson(res, 200, publicKsReconciliationReviewPackState(review));
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'ks_reconciliation_review_not_found' });
                }
                return;
            }
            const runKsReconciliationFindingReviewMatch = pathname.match(/^\/api\/runs\/([^/]+)\/reconciliation\/findings\/([^/]+)\/review$/);
            if (runKsReconciliationFindingReviewMatch && method === 'POST') {
                const runId = decodeURIComponent(runKsReconciliationFindingReviewMatch[1]);
                const findingId = decodeURIComponent(runKsReconciliationFindingReviewMatch[2]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const input = parseKsReconciliationFindingReviewInput(parsed.value);
                if (!input) {
                    sendJson(res, 400, { error: 'invalid_ks_reconciliation_finding_review_request' });
                    return;
                }
                const reviewFinding = runtime.reviewRunKsReconciliationFinding;
                if (typeof reviewFinding !== 'function') {
                    sendJson(res, 501, { error: 'ks_reconciliation_review_unavailable' });
                    return;
                }
                try {
                    const result = yield reviewFinding.call(runtime, runId, findingId, input);
                    sendJson(res, 200, {
                        artifact: publicArtifactRef(result.artifact),
                        reviewPack: sanitizeTrustPayload(result.reviewPack),
                        finding: sanitizeTrustPayload(result.finding),
                    });
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'ks_reconciliation_finding_review_failed';
                    if (message.includes('finding not found')) {
                        sendJson(res, 404, { error: message });
                        return;
                    }
                    if (message.includes('reviewerComment') || message.includes('reviewerId')) {
                        sendJson(res, 400, { error: message });
                        return;
                    }
                    sendJson(res, 409, { error: message });
                }
                return;
            }
            const runGithubDeliveryPlanMatch = pathname.match(/^\/api\/runs\/([^/]+)\/github-delivery-plan$/);
            if (runGithubDeliveryPlanMatch && method === 'GET') {
                const runId = decodeURIComponent(runGithubDeliveryPlanMatch[1]);
                const getDeliveryPlan = runtime.getRunGithubDeliveryPlan;
                if (typeof getDeliveryPlan !== 'function') {
                    sendJson(res, 501, { error: 'github_delivery_plan_unavailable' });
                    return;
                }
                try {
                    const plan = yield getDeliveryPlan.call(runtime, runId);
                    sendJson(res, 200, publicGithubDeliveryPlanResponse(plan));
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'github_delivery_plan_not_found' });
                }
                return;
            }
            if (runGithubDeliveryPlanMatch && method === 'POST') {
                const runId = decodeURIComponent(runGithubDeliveryPlanMatch[1]);
                const raw = yield readBody(req);
                const parsed = raw.trim() ? tryParseJson(raw) : { ok: true, value: {} };
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                const createDeliveryPlan = runtime.createRunGithubDeliveryPlan;
                if (typeof createDeliveryPlan !== 'function') {
                    sendJson(res, 501, { error: 'github_delivery_plan_unavailable' });
                    return;
                }
                try {
                    const plan = yield createDeliveryPlan.call(runtime, runId, body);
                    sendJson(res, 201, publicGithubDeliveryPlanResponse(plan));
                }
                catch (err) {
                    sendJson(res, 409, { error: err instanceof Error ? err.message : 'github_delivery_plan_failed' });
                }
                return;
            }
            const runGithubDeliveryApplyMatch = pathname.match(/^\/api\/runs\/([^/]+)\/github-delivery-apply$/);
            if (runGithubDeliveryApplyMatch && method === 'GET') {
                const runId = decodeURIComponent(runGithubDeliveryApplyMatch[1]);
                const getDeliveryApply = runtime.getRunGithubDeliveryApply;
                if (typeof getDeliveryApply !== 'function') {
                    sendJson(res, 501, { error: 'github_delivery_apply_unavailable' });
                    return;
                }
                try {
                    const apply = yield getDeliveryApply.call(runtime, runId);
                    sendJson(res, 200, publicGithubDeliveryApplyState(apply));
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'github_delivery_apply_not_found' });
                }
                return;
            }
            if (runGithubDeliveryApplyMatch && method === 'POST') {
                const runId = decodeURIComponent(runGithubDeliveryApplyMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.planArtifactId || !body.expectedPlanSha256) {
                    sendJson(res, 400, { error: 'planArtifactId and expectedPlanSha256 are required' });
                    return;
                }
                const applyInput = Object.assign({ planArtifactId: body.planArtifactId, expectedPlanSha256: body.expectedPlanSha256 }, (body.approvalId ? { approvalId: body.approvalId } : {}));
                try {
                    if (body.approvalId) {
                        const applyDelivery = runtime.applyApprovedRunGithubDelivery;
                        if (typeof applyDelivery !== 'function') {
                            sendJson(res, 501, { error: 'github_delivery_apply_unavailable' });
                            return;
                        }
                        const applied = yield applyDelivery.call(runtime, runId, applyInput);
                        sendJson(res, 201, publicGithubDeliveryApplyResponse(applied));
                        return;
                    }
                    const requestApply = runtime.requestRunGithubDeliveryApply;
                    if (typeof requestApply !== 'function') {
                        sendJson(res, 501, { error: 'github_delivery_apply_unavailable' });
                        return;
                    }
                    const pending = yield requestApply.call(runtime, runId, applyInput);
                    sendJson(res, 202, pending);
                }
                catch (err) {
                    sendJson(res, 409, { error: err instanceof Error ? err.message : 'github_delivery_apply_failed' });
                }
                return;
            }
            const runVerifierStatusMatch = pathname.match(/^\/api\/runs\/([^/]+)\/verifier-status$/);
            if (runVerifierStatusMatch && method === 'GET') {
                const runId = decodeURIComponent(runVerifierStatusMatch[1]);
                const scopeValue = firstQueryValue(query['scope']);
                if (scopeValue !== undefined && scopeValue !== 'run' && scopeValue !== 'delivery' && scopeValue !== 'delivery_plan' && scopeValue !== 'delivery_apply' && scopeValue !== 'all') {
                    sendJson(res, 400, { error: 'invalid_verifier_scope' });
                    return;
                }
                const scope = scopeValue;
                const getVerifierStatus = runtime.getRunVerifierStatus;
                if (typeof getVerifierStatus !== 'function') {
                    sendJson(res, 501, { error: 'verifier_policy_unavailable' });
                    return;
                }
                try {
                    const decision = scope === undefined
                        ? yield getVerifierStatus.call(runtime, runId)
                        : yield getVerifierStatus.call(runtime, runId, scope);
                    sendJson(res, 200, decision);
                }
                catch (err) {
                    sendJson(res, 404, { error: err instanceof Error ? err.message : 'verifier_status_not_found' });
                }
                return;
            }
            const runVerifierWaiverMatch = pathname.match(/^\/api\/runs\/([^/]+)\/verifier-waiver$/);
            if (runVerifierWaiverMatch && method === 'POST') {
                const runId = decodeURIComponent(runVerifierWaiverMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.reason || (!requireAuth && !body.operatorId)) {
                    sendJson(res, 400, { error: requireAuth ? 'reason is required' : 'operatorId and reason are required' });
                    return;
                }
                const operatorId = requireAuth
                    ? `token:${(_93 = authResult.label) !== null && _93 !== void 0 ? _93 : 'authenticated'}`
                    : body.operatorId;
                const operatorName = requireAuth
                    ? authResult.label
                    : body.operatorName;
                const createWaiver = runtime.createRunVerifierWaiver;
                if (typeof createWaiver !== 'function') {
                    sendJson(res, 501, { error: 'verifier_policy_unavailable' });
                    return;
                }
                try {
                    const result = yield createWaiver.call(runtime, runId, Object.assign(Object.assign(Object.assign({ operatorId }, (operatorName ? { operatorName } : {})), { reason: body.reason }), (body.scope ? { scope: body.scope } : {})));
                    sendJson(res, 201, result);
                }
                catch (err) {
                    sendJson(res, 409, { error: err instanceof Error ? err.message : 'verifier_waiver_failed' });
                }
                return;
            }
            const runControlMatch = pathname.match(/^\/api\/runs\/([^/]+)\/control$/);
            if (runControlMatch && method === 'POST') {
                const runId = decodeURIComponent(runControlMatch[1]);
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (body.action !== 'replay' && body.action !== 'continue' && body.action !== 'abort' && body.action !== 'execute') {
                    sendJson(res, 400, { error: 'action must be replay, continue, abort, or execute' });
                    return;
                }
                try {
                    if (body.action === 'execute') {
                        const executeProductRun = runtime.executeProductFactoryRun;
                        if (typeof executeProductRun !== 'function') {
                            sendJson(res, 501, { error: 'product_factory_unavailable' });
                            return;
                        }
                        const result = body.approvalId
                            ? yield executeProductRun.call(runtime, runId, { approvalId: body.approvalId })
                            : yield executeProductRun.call(runtime, runId);
                        sendJson(res, 200, Object.assign({ ok: true, action: body.action }, result));
                        return;
                    }
                    if (body.action === 'replay') {
                        const replayed = yield ((_94 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _94 === void 0 ? void 0 : _94.replayRun(runId));
                        sendJson(res, 200, { ok: true, action: body.action, run: replayed });
                        return;
                    }
                    if (body.action === 'continue') {
                        const run = yield ((_95 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _95 === void 0 ? void 0 : _95.transition(runId, 'running', body.resumeToken ? `continue:${body.resumeToken}` : 'operator continue'));
                        sendJson(res, 200, { ok: true, action: body.action, run });
                        return;
                    }
                    const run = yield ((_96 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _96 === void 0 ? void 0 : _96.transition(runId, 'cancelled', 'operator abort'));
                    sendJson(res, 200, { ok: true, action: body.action, run });
                }
                catch (err) {
                    sendJson(res, 409, { error: err instanceof Error ? err.message : 'control_failed' });
                }
                return;
            }
            const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
            if (runMatch && method === 'GET') {
                const runId = decodeURIComponent(runMatch[1]);
                const run = yield getRunRecord(orchestration, runId);
                if (!run) {
                    sendJson(res, 404, { error: 'run_not_found' });
                    return;
                }
                sendJson(res, 200, { run });
                return;
            }
            if (pathname === '/api/overlays' && method === 'GET') {
                sendJson(res, 200, { overlays: (_98 = (_97 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _97 === void 0 ? void 0 : _97.list()) !== null && _98 !== void 0 ? _98 : [] });
                return;
            }
            if (pathname === '/api/overlay-summaries' && method === 'GET') {
                sendJson(res, 200, { overlays: (_100 = (_99 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _99 === void 0 ? void 0 : _99.list().map(publicDomainOverlay)) !== null && _100 !== void 0 ? _100 : [] });
                return;
            }
            const publicOverlayMatch = pathname.match(/^\/api\/overlay-summaries\/([^/]+)$/);
            if (publicOverlayMatch && method === 'GET') {
                const domainId = decodeURIComponent(publicOverlayMatch[1]);
                const overlay = (_102 = (_101 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _101 === void 0 ? void 0 : _101.get(domainId)) === null || _102 === void 0 ? void 0 : _102.manifest;
                if (!overlay) {
                    sendJson(res, 404, { error: 'overlay_not_found' });
                    return;
                }
                sendJson(res, 200, { overlay: publicDomainOverlay(overlay) });
                return;
            }
            const overlayMatch = pathname.match(/^\/api\/overlays\/([^/]+)$/);
            if (overlayMatch && method === 'GET') {
                const domainId = decodeURIComponent(overlayMatch[1]);
                const overlay = (_104 = (_103 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _103 === void 0 ? void 0 : _103.get(domainId)) === null || _104 === void 0 ? void 0 : _104.manifest;
                if (!overlay) {
                    sendJson(res, 404, { error: 'overlay_not_found' });
                    return;
                }
                sendJson(res, 200, { overlay });
                return;
            }
            // GET /status
            if (method === 'GET' && pathname === '/status') {
                const snapshot = (_105 = health === null || health === void 0 ? void 0 : health.getLastSnapshot()) !== null && _105 !== void 0 ? _105 : null;
                const cronStatus = (_106 = cron === null || cron === void 0 ? void 0 : cron.getStatus()) !== null && _106 !== void 0 ? _106 : null;
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
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const payload = parsed.value;
                if (!payload.name) {
                    sendJson(res, 400, { error: 'name required' });
                    return;
                }
                if (!cron) {
                    sendJson(res, 503, { error: 'CronService not available' });
                    return;
                }
                try {
                    yield cron.triggerJob(payload.name);
                    sendJson(res, 200, { ok: true, name: payload.name });
                }
                catch (err) {
                    sendJson(res, 404, {
                        error: err instanceof Error ? err.message : 'Job not found',
                    });
                }
                return;
            }
            // POST /v1/chat/completions  (OpenAI-compatible)
            if (method === 'POST' && pathname === '/v1/chat/completions') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const payload = parsed.value;
                const messages = (_107 = payload.messages) !== null && _107 !== void 0 ? _107 : [];
                const lastMessage = messages[messages.length - 1];
                if (!(lastMessage === null || lastMessage === void 0 ? void 0 : lastMessage.content)) {
                    sendJson(res, 400, { error: 'messages must contain at least one entry with content' });
                    return;
                }
                const channel = ((_108 = payload.channel) !== null && _108 !== void 0 ? _108 : 'api');
                const userId = (_109 = payload.userId) !== null && _109 !== void 0 ? _109 : 'gateway-user';
                const chatId = (_110 = payload.chatId) !== null && _110 !== void 0 ? _110 : 'gateway-chat';
                const result = yield runtime.handleMessage(channel, userId, chatId, lastMessage.content);
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
                const relPath = (_111 = query['path']) !== null && _111 !== void 0 ? _111 : '';
                try {
                    const result = yield listDir(fsConfig, relPath);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // GET /api/fs/read?path=<relPath>
            if (method === 'GET' && pathname === '/api/fs/read') {
                const relPath = (_112 = query['path']) !== null && _112 !== void 0 ? _112 : '';
                if (!relPath) {
                    sendJson(res, 400, { error: 'path query param required', code: 'EINVAL' });
                    return;
                }
                try {
                    const result = yield fsReadFile(fsConfig, relPath);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // PUT /api/fs/write  body: {path, content}
            if (method === 'PUT' && pathname === '/api/fs/write') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.path) {
                    sendJson(res, 400, { error: 'path required', code: 'EINVAL' });
                    return;
                }
                if (body.content === undefined) {
                    sendJson(res, 400, { error: 'content required', code: 'EINVAL' });
                    return;
                }
                try {
                    const result = yield fsWriteFile(fsConfig, body.path, body.content);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // POST /api/fs/search  body: {query, maxHits?, path?}
            if (method === 'POST' && pathname === '/api/fs/search') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.query) {
                    sendJson(res, 400, { error: 'query required', code: 'EINVAL' });
                    return;
                }
                try {
                    const result = yield searchFiles(fsConfig, body.query, {
                        maxHits: body.maxHits,
                        relPath: body.path,
                    });
                    sendJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof FsApiError) {
                        sendFsError(res, err);
                        return;
                    }
                    throw err;
                }
                return;
            }
            // POST /api/chat  body: {userId?, chatId?, text}  OR  multipart/form-data
            if (method === 'POST' && pathname === '/api/chat') {
                const ct = (_113 = req.headers['content-type']) !== null && _113 !== void 0 ? _113 : '';
                if (ct.toLowerCase().includes('multipart/form-data')) {
                    const m = yield processChatMultipart(req, false);
                    if (!m.ok) {
                        sendJson(res, m.status, { error: m.error });
                        return;
                    }
                    const userId = 'ide-user';
                    const chatId = 'ide-chat';
                    const effectiveWorker = effectiveExecutionMode(config, orchestration) === 'freeclaude'
                        ? { transport: 'freeclaude' }
                        : undefined;
                    try {
                        const result = yield runtime.handleMessage('http', userId, chatId, m.text, m.sessionId || effectiveWorker
                            ? Object.assign(Object.assign({}, (m.sessionId ? { sessionId: m.sessionId } : {})), (effectiveWorker ? { worker: effectiveWorker } : {})) : undefined);
                        if (!result.success) {
                            sendJson(res, 500, {
                                error: (_114 = result.error) !== null && _114 !== void 0 ? _114 : 'Runtime message failed',
                                sessionId: result.sessionId,
                                runId: result.runId,
                                taskId: result.taskId,
                            });
                            return;
                        }
                        sendJson(res, 200, {
                            reply: result.response,
                            sessionId: result.sessionId,
                            runId: result.runId,
                            taskId: result.taskId,
                            attachments: m.attachments,
                        });
                    }
                    catch (err) {
                        sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
                    }
                    return;
                }
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.text) {
                    sendJson(res, 400, { error: 'text required' });
                    return;
                }
                const userId = (_115 = body.userId) !== null && _115 !== void 0 ? _115 : 'ide-user';
                const chatId = (_116 = body.chatId) !== null && _116 !== void 0 ? _116 : 'ide-chat';
                const effectiveWorker = effectiveExecutionMode(config, orchestration) === 'freeclaude'
                    ? { transport: 'freeclaude' }
                    : undefined;
                try {
                    const result = yield runtime.handleMessage('http', userId, chatId, body.text, body.sessionId || effectiveWorker
                        ? Object.assign(Object.assign({}, (body.sessionId ? { sessionId: body.sessionId } : {})), (effectiveWorker ? { worker: effectiveWorker } : {})) : undefined);
                    if (!result.success) {
                        sendJson(res, 500, {
                            error: (_117 = result.error) !== null && _117 !== void 0 ? _117 : 'Runtime message failed',
                            sessionId: result.sessionId,
                            runId: result.runId,
                            taskId: result.taskId,
                        });
                        return;
                    }
                    sendJson(res, 200, {
                        reply: result.response,
                        sessionId: result.sessionId,
                        runId: result.runId,
                        taskId: result.taskId,
                    });
                }
                catch (err) {
                    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
                }
                return;
            }
            // POST /api/chat/stream  body: {text, openFiles?, workspace?, sessionId?}  OR  multipart/form-data
            if (method === 'POST' && pathname === '/api/chat/stream') {
                const ct = (_118 = req.headers['content-type']) !== null && _118 !== void 0 ? _118 : '';
                const isMultipart = ct.toLowerCase().includes('multipart/form-data');
                let bodyText;
                let bodyOpenFiles;
                let bodyWorkspace;
                let bodySessionId;
                let attachments = [];
                let bodyPrefer;
                let bodyRoutingHints;
                let bodyWorker;
                let bodyExposeToolPayloads;
                if (isMultipart) {
                    const m = yield processChatMultipart(req, true);
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
                }
                else {
                    const raw = yield readBody(req);
                    const parsed = tryParseJson(raw);
                    if (!parsed.ok) {
                        res.writeHead(400, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
                        res.end(JSON.stringify({ error: 'invalid_json' }));
                        return;
                    }
                    const body = parsed.value;
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
                    bodyWorker = ((_119 = body.worker) === null || _119 === void 0 ? void 0 : _119.transport) ? { transport: body.worker.transport } : undefined;
                    bodyExposeToolPayloads = typeof body.exposeToolPayloads === 'boolean' ? body.exposeToolPayloads : undefined;
                }
                // Always 200 for SSE; errors are sent inline.
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Content-Type-Options': 'nosniff',
                });
                const abortController = new AbortController();
                const writeSSE = (eventName, data) => {
                    if (eventName)
                        res.write(`event: ${eventName}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                };
                req.on('close', () => abortController.abort());
                try {
                    const effectiveWorker = bodyWorker !== null && bodyWorker !== void 0 ? bodyWorker : (effectiveExecutionMode(config, orchestration) === 'freeclaude' ? { transport: 'freeclaude' } : undefined);
                    let firstEvent = true;
                    let emittedAny = false;
                    try {
                        for (var _133 = true, _134 = __asyncValues(runtime.streamChatRequest({
                            text: bodyText,
                            openFiles: bodyOpenFiles,
                            workspace: bodyWorkspace !== null && bodyWorkspace !== void 0 ? bodyWorkspace : fsConfig.workspaceRoot,
                            sessionId: bodySessionId,
                            prefer: bodyPrefer,
                            routingHints: bodyRoutingHints,
                            worker: effectiveWorker,
                            exposeToolPayloads: bodyExposeToolPayloads,
                            signal: abortController.signal,
                        })), _135; _135 = yield _134.next(), _a = _135.done, !_a; _133 = true) {
                            _c = _135.value;
                            _133 = false;
                            const event = _c;
                            const wrapped = firstEvent && attachments.length > 0
                                ? Object.assign(Object.assign({}, event), { attachments }) : event;
                            firstEvent = false;
                            emittedAny = true;
                            writeSSE(null, wrapped);
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (!_133 && !_a && (_b = _134.return)) yield _b.call(_134);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    // If runtime didn't emit any events but we have attachments, surface them.
                    if (!emittedAny && attachments.length > 0) {
                        writeSSE(null, { type: 'attachments', attachments });
                    }
                    writeSSE('done', {});
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'Internal error';
                    writeSSE('error', { message });
                }
                finally {
                    res.end();
                }
                return;
            }
            if (method === 'POST' && (pathname === '/agent/run' || pathname === '/api/agent/run')) {
                if (!enforceAuth(req, res, query))
                    return;
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const agUiRequest = parseAgUiRunRequest(parsed.value);
                if (!agUiRequest.ok) {
                    sendJson(res, 400, { error: agUiRequest.error });
                    return;
                }
                if (agUiRequest.input.mode === 'concept' && !supportsUniversalEngine(config, orchestration)) {
                    sendJson(res, 503, { error: 'universal_engine_unavailable' });
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Content-Type-Options': 'nosniff',
                });
                let closed = false;
                let heartbeat;
                const cleanup = [];
                const abortController = new AbortController();
                let activeConceptHandle;
                let settleConceptStream;
                const close = () => {
                    if (closed)
                        return;
                    closed = true;
                    abortController.abort();
                    for (const fn of cleanup.splice(0))
                        fn();
                    if (heartbeat)
                        clearInterval(heartbeat);
                };
                req.on('close', () => {
                    activeConceptHandle === null || activeConceptHandle === void 0 ? void 0 : activeConceptHandle.abort('ag_ui_client_disconnected');
                    activeConceptHandle = undefined;
                    close();
                    settleConceptStream === null || settleConceptStream === void 0 ? void 0 : settleConceptStream();
                });
                heartbeat = setInterval(() => {
                    if (closed || res.destroyed)
                        return;
                    res.write(': heartbeat\n\n');
                }, 15000);
                try {
                    if (agUiRequest.input.mode === 'concept') {
                        const universalEngine = orchestration.universalEngine;
                        const eventLedger = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger;
                        const handle = universalEngine.dispatchConcept(toAgUiConceptInput(agUiRequest.input, fsConfig.workspaceRoot));
                        activeConceptHandle = handle;
                        const record = universalEngine.getConceptRecord(handle.conceptId);
                        if (!record) {
                            throw new Error('ag_ui_concept_dispatch_failed');
                        }
                        const projector = createAgUiConceptProjector(record, agUiRequest.input);
                        const bufferedEvents = [];
                        let bufferingLiveEvents = true;
                        yield new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                            let settled = false;
                            const finish = () => {
                                if (settled)
                                    return;
                                settled = true;
                                activeConceptHandle = undefined;
                                settleConceptStream = undefined;
                                resolve();
                            };
                            settleConceptStream = finish;
                            const writeAgUiEvent = (event) => {
                                if (closed || res.destroyed)
                                    return;
                                res.write(`data: ${JSON.stringify(event)}\n\n`);
                            };
                            if (eventLedger === null || eventLedger === void 0 ? void 0 : eventLedger.subscribe) {
                                cleanup.push(eventLedger.subscribe((event) => {
                                    if (!isConceptLedgerEvent(event, record.conceptId, record.runId))
                                        return;
                                    if (bufferingLiveEvents) {
                                        bufferedEvents.push(event);
                                        return;
                                    }
                                    for (const agUiEvent of projector.project(event))
                                        writeAgUiEvent(agUiEvent);
                                    if (projector.isTerminal())
                                        finish();
                                }));
                            }
                            try {
                                const history = (eventLedger === null || eventLedger === void 0 ? void 0 : eventLedger.readAll)
                                    ? (yield eventLedger.readAll()).filter((event) => isConceptLedgerEvent(event, record.conceptId, record.runId))
                                    : [];
                                for (const event of projector.snapshot(history))
                                    writeAgUiEvent(event);
                                bufferingLiveEvents = false;
                                for (const event of bufferedEvents.splice(0)) {
                                    for (const agUiEvent of projector.project(event))
                                        writeAgUiEvent(agUiEvent);
                                    if (projector.isTerminal())
                                        break;
                                }
                                if (projector.isTerminal())
                                    finish();
                            }
                            catch (error) {
                                reject(error);
                            }
                            handle.promise()
                                .then((finalRecord) => {
                                var _a;
                                if (projector.isTerminal()) {
                                    finish();
                                    return;
                                }
                                for (const agUiEvent of projector.project(Object.assign({ id: `ag-ui-concept-terminal-${finalRecord.conceptId}`, ts: (_a = finalRecord.completedAt) !== null && _a !== void 0 ? _a : new Date().toISOString(), run_id: finalRecord.runId, seq: Number.MAX_SAFE_INTEGER, type: 'concept.completed', concept_id: finalRecord.conceptId, status: finalRecord.status === 'done' ? 'done' : finalRecord.status }, (finalRecord.error ? { error: finalRecord.error } : {})))) {
                                    writeAgUiEvent(agUiEvent);
                                }
                                finish();
                            })
                                .catch(reject);
                        }));
                        return;
                    }
                    try {
                        for (var _136 = true, _137 = __asyncValues(createAgUiEventStream(runtime.streamChatRequest({
                            text: agUiRequest.input.promptText,
                            openFiles: agUiRequest.input.openFiles,
                            workspace: (_120 = agUiRequest.input.workspace) !== null && _120 !== void 0 ? _120 : fsConfig.workspaceRoot,
                            sessionId: (_121 = agUiRequest.input.sessionId) !== null && _121 !== void 0 ? _121 : agUiRequest.input.threadId,
                            prefer: agUiRequest.input.prefer,
                            routingHints: agUiRequest.input.routingHints,
                            exposeToolPayloads: agUiRequest.input.exposeToolPayloads,
                            signal: abortController.signal,
                        }), agUiRequest.input)), _138; _138 = yield _137.next(), _d = _138.done, !_d; _136 = true) {
                            _f = _138.value;
                            _136 = false;
                            const event = _f;
                            if (closed || res.destroyed)
                                break;
                            res.write(`data: ${JSON.stringify(event)}\n\n`);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_136 && !_d && (_e = _137.return)) yield _e.call(_137);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                }
                catch (err) {
                    if (!closed && !res.destroyed) {
                        res.write(`data: ${JSON.stringify({
                            type: 'RUN_ERROR',
                            message: err instanceof Error ? redactSensitiveText(err.message) : 'ag_ui_stream_failed',
                            timestamp: Date.now(),
                        })}\n\n`);
                    }
                }
                finally {
                    close();
                    if (!res.writableEnded)
                        res.end();
                }
                return;
            }
            // POST /api/audio/transcribe  multipart/form-data; field: audio (Blob, audio/*)
            if (method === 'POST' && pathname === '/api/audio/transcribe') {
                const contentType = (_122 = req.headers['content-type']) !== null && _122 !== void 0 ? _122 : '';
                const boundaryMatch = /boundary=([^\s;]+)/.exec(contentType);
                if (!contentType.startsWith('multipart/form-data') || !boundaryMatch) {
                    sendJson(res, 400, { error: 'Expected multipart/form-data with boundary' });
                    return;
                }
                const boundary = boundaryMatch[1];
                const rawBody = yield readBodyBuffer(req);
                const audioBuffer = extractMultipartField(rawBody, boundary, 'audio');
                if (!audioBuffer || audioBuffer.length === 0) {
                    sendJson(res, 400, { error: 'Missing or empty "audio" field in multipart body' });
                    return;
                }
                try {
                    const text = yield transcribeBuffer(audioBuffer, config.voice);
                    sendJson(res, 200, { text });
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'Transcription failed';
                    sendJson(res, 500, { error: message });
                }
                return;
            }
            // POST /api/exec  body: {command, cwd?}
            if (method === 'POST' && pathname === '/api/exec') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.command) {
                    sendJson(res, 400, { error: 'command required' });
                    return;
                }
                // Resolve cwd: must be inside workspaceRoot
                let execCwd;
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
                }
                else {
                    execCwd = path.resolve(fsConfig.workspaceRoot);
                }
                const result = yield runExec(body.command, execCwd, execTimeout);
                sendJson(res, 200, result);
                return;
            }
            // ─── Git routes ───────────────────────────────────────────────────────
            // GET /api/git/worktree-merge-events?limit=20
            if (method === 'GET' && pathname === '/api/git/worktree-merge-events') {
                if (!enforceAuth(req, res, query))
                    return;
                const readAll = (_123 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) === null || _123 === void 0 ? void 0 : _123.readAll;
                if (!readAll) {
                    sendJson(res, 503, { error: 'event_ledger_unavailable' });
                    return;
                }
                try {
                    const requestedLimit = parseIntQuery(query['limit'], 20, WORKTREE_MERGE_EVENTS_MAX);
                    const limit = Math.max(1, requestedLimit);
                    const payload = yield publicWorktreeMergeEventsResponse({ readAll }, limit);
                    sendJson(res, 200, payload);
                }
                catch (err) {
                    sendJson(res, 500, { error: err instanceof Error ? err.message : 'event_ledger_read_failed' });
                }
                return;
            }
            // POST /api/git/worktree-merge  body: { taskId, noFf? }
            if (method === 'POST' && pathname === '/api/git/worktree-merge') {
                if (!enforceAuth(req, res, query))
                    return;
                const mergeWorktree = (_124 = runtime.mergeCompletedSubagentWorktree) === null || _124 === void 0 ? void 0 : _124.bind(runtime);
                if (typeof mergeWorktree !== 'function') {
                    sendJson(res, 503, { error: 'runtime_unavailable' });
                    return;
                }
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
                if (!taskId) {
                    sendJson(res, 400, { error: 'taskId required' });
                    return;
                }
                if (body.noFf !== undefined && body.noFf !== null && typeof body.noFf !== 'boolean') {
                    sendJson(res, 400, { error: 'noFf must be a boolean' });
                    return;
                }
                const noFf = body.noFf === true;
                try {
                    const result = yield mergeWorktree(taskId, { noFf });
                    if (!result.ok &&
                        result.kind === 'error' &&
                        result.message.includes(NO_SUBAGENT_WORKTREE_MESSAGE)) {
                        sendJson(res, 409, {
                            error: 'subagent_worktree_unavailable',
                            message: result.message,
                        });
                        return;
                    }
                    sendJson(res, 200, publicWorktreeMergePostResult(result));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'merge_failed';
                    sendJson(res, 500, { error: 'merge_failed', message });
                }
                return;
            }
            // GET /api/git/status?workspace=...
            if (method === 'GET' && pathname === '/api/git/status') {
                const workspace = query['workspace'];
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                try {
                    const result = yield gitStatus(workspace);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/diff?workspace=...&path=...&staged=0|1
            if (method === 'GET' && pathname === '/api/git/diff') {
                const workspace = query['workspace'];
                const filePath = query['path'];
                const staged = query['staged'] === '1';
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                if (!filePath) {
                    sendJson(res, 400, { error: 'path query param required' });
                    return;
                }
                try {
                    const diff = yield gitDiff(workspace, filePath, staged);
                    sendJson(res, 200, { diff });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/file?workspace=...&path=...&ref=HEAD
            if (method === 'GET' && pathname === '/api/git/file') {
                const workspace = query['workspace'];
                const filePath = query['path'];
                const ref = (_125 = query['ref']) !== null && _125 !== void 0 ? _125 : 'HEAD';
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                if (!filePath) {
                    sendJson(res, 400, { error: 'path query param required' });
                    return;
                }
                try {
                    const content = yield gitFileContent(workspace, filePath, ref);
                    sendJson(res, 200, { content });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/git/stage  body: {workspace, paths}
            if (method === 'POST' && pathname === '/api/git/stage') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.workspace) {
                    sendJson(res, 400, { error: 'workspace required' });
                    return;
                }
                if (!Array.isArray(body.paths) || body.paths.length === 0) {
                    sendJson(res, 400, { error: 'paths must be a non-empty array' });
                    return;
                }
                try {
                    yield gitStage(body.workspace, body.paths);
                    sendJson(res, 200, { ok: true });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/git/unstage  body: {workspace, paths}
            if (method === 'POST' && pathname === '/api/git/unstage') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.workspace) {
                    sendJson(res, 400, { error: 'workspace required' });
                    return;
                }
                if (!Array.isArray(body.paths) || body.paths.length === 0) {
                    sendJson(res, 400, { error: 'paths must be a non-empty array' });
                    return;
                }
                try {
                    yield gitUnstage(body.workspace, body.paths);
                    sendJson(res, 200, { ok: true });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/git/commit  body: {workspace, message}
            if (method === 'POST' && pathname === '/api/git/commit') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.workspace) {
                    sendJson(res, 400, { error: 'workspace required' });
                    return;
                }
                if (!body.message || !body.message.trim()) {
                    sendJson(res, 400, { error: 'message must not be empty' });
                    return;
                }
                try {
                    const result = yield gitCommit(body.workspace, body.message);
                    sendJson(res, 200, result);
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/log?workspace=...&limit=50
            if (method === 'GET' && pathname === '/api/git/log') {
                const workspace = query['workspace'];
                const limit = parseInt((_126 = query['limit']) !== null && _126 !== void 0 ? _126 : '50', 10);
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                try {
                    const entries = yield gitLog(workspace, isNaN(limit) ? 50 : limit);
                    sendJson(res, 200, { entries });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // GET /api/git/blame?workspace=...&path=...
            if (method === 'GET' && pathname === '/api/git/blame') {
                const workspace = query['workspace'];
                const filePath = query['path'];
                if (!workspace) {
                    sendJson(res, 400, { error: 'workspace query param required' });
                    return;
                }
                if (!filePath) {
                    sendJson(res, 400, { error: 'path query param required' });
                    return;
                }
                try {
                    const entries = yield gitBlame(workspace, filePath);
                    sendJson(res, 200, { entries });
                }
                catch (err) {
                    sendJson(res, 400, { error: err instanceof Error ? err.message : 'git error' });
                }
                return;
            }
            // POST /api/pty/spawn  body: {cwd, shell?, cols?, rows?}
            if (method === 'POST' && pathname === '/api/pty/spawn') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.cwd) {
                    sendJson(res, 400, { error: 'cwd required' });
                    return;
                }
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
                const ptyId = ptyResizeMatch[1];
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.cols || !body.rows) {
                    sendJson(res, 400, { error: 'cols and rows required' });
                    return;
                }
                try {
                    ptyManager.resize(ptyId, body.cols, body.rows);
                    res.writeHead(204);
                    res.end();
                }
                catch (_139) {
                    sendJson(res, 404, { error: 'PTY not found' });
                }
                return;
            }
            // DELETE /api/pty/:id
            const ptyDeleteMatch = pathname.match(/^\/api\/pty\/([^/]+)$/);
            if (ptyDeleteMatch && method === 'DELETE') {
                const ptyId = ptyDeleteMatch[1];
                ptyManager.kill(ptyId);
                res.writeHead(204);
                res.end();
                return;
            }
            // GET /api/models — list all models across providers
            if (method === 'GET' && pathname === '/api/models') {
                try {
                    const models = yield router.listAllModels();
                    sendJson(res, 200, { models });
                }
                catch (err) {
                    logger.warn('[gateway] /api/models failed', { error: String(err) });
                    sendJson(res, 500, { error: 'Failed to list models' });
                }
                return;
            }
            // POST /api/settings/active-model  body: { provider, modelId }
            if (method === 'POST' && pathname === '/api/settings/active-model') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                if (!body.provider || !body.modelId) {
                    sendJson(res, 400, { error: 'provider and modelId are required' });
                    return;
                }
                router.setActiveModel(body.provider, body.modelId);
                try {
                    const { config: latest, path: cfgPath } = yield loadConfig();
                    const updated = Object.assign(Object.assign({}, latest), { ai: Object.assign(Object.assign({}, latest.ai), { activeModel: { provider: body.provider, modelId: body.modelId } }) });
                    yield saveConfig(updated, cfgPath);
                }
                catch (err) {
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
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                const localFirst = typeof body.localFirst === 'boolean' ? body.localFirst : false;
                const localOnly = typeof body.localOnly === 'boolean' ? body.localOnly : false;
                (_128 = (_127 = router).setLocalMode) === null || _128 === void 0 ? void 0 : _128.call(_127, { localFirst, localOnly });
                try {
                    const { config: latest, path: cfgPath } = yield loadConfig();
                    const updated = Object.assign(Object.assign({}, latest), { ai: Object.assign(Object.assign({}, latest.ai), { localFirst, localOnly }) });
                    yield saveConfig(updated, cfgPath);
                }
                catch (err) {
                    logger.warn('[gateway] failed to persist local mode', { error: String(err) });
                }
                sendJson(res, 200, { ok: true, localFirst, localOnly });
                return;
            }
            // POST /api/settings/execution-mode  body: { executionMode }
            if (method === 'POST' && pathname === '/api/settings/execution-mode') {
                const raw = yield readBody(req);
                const parsed = tryParseJson(raw);
                if (!parsed.ok) {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                const body = parsed.value;
                const executionMode = body.executionMode === 'pyrfor'
                    ? 'pyrfor'
                    : body.executionMode === 'freeclaude'
                        ? 'freeclaude'
                        : undefined;
                if (!executionMode) {
                    sendJson(res, 400, { error: 'invalid_execution_mode' });
                    return;
                }
                if (executionMode === 'freeclaude' && !supportsFreeClaudeExecution(orchestration)) {
                    sendJson(res, 409, {
                        error: 'freeclaude_execution_unavailable',
                        reason: 'FreeClaude execution mode requires runtime orchestration',
                    });
                    return;
                }
                try {
                    const { config: latest, path: cfgPath } = yield loadConfig(deps.configPath);
                    const updated = Object.assign(Object.assign({}, latest), { executionMode });
                    yield saveConfig(updated, cfgPath);
                    config.executionMode = executionMode;
                }
                catch (err) {
                    logger.warn('[gateway] failed to persist execution mode', { error: String(err) });
                    sendJson(res, 500, { error: 'failed_to_persist_execution_mode' });
                    return;
                }
                sendJson(res, 200, { ok: true, executionMode });
                return;
            }
            // 404 fallback
            sendJson(res, 404, { error: 'Not found', path: pathname });
        }
        catch (err) {
            logger.error(`[gateway] Route error ${method} ${pathname}`, {
                error: err instanceof Error ? err.message : String(err),
            });
            sendJson(res, 500, { error: 'Internal server error' });
        }
    }));
    // ─── WebSocket server (PTY streams) ────────────────────────────────────
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', (ws, ptyId) => {
        const onData = (id, data) => {
            if (id !== ptyId)
                return;
            try {
                ws.send(data);
            }
            catch ( /* closed */_a) { /* closed */ }
        };
        ptyManager.on('data', onData);
        const onExit = (id) => {
            if (id !== ptyId)
                return;
            ptyManager.off('data', onData);
            ptyManager.off('exit', onExit);
            try {
                ws.close();
            }
            catch ( /* already closed */_a) { /* already closed */ }
        };
        ptyManager.on('exit', onExit);
        ws.on('message', (msg) => {
            try {
                ptyManager.write(ptyId, msg.toString());
            }
            catch ( /* pty gone */_a) { /* pty gone */ }
        });
        ws.on('close', () => {
            ptyManager.off('data', onData);
            ptyManager.off('exit', onExit);
            try {
                ptyManager.kill(ptyId);
            }
            catch ( /* already gone */_a) { /* already gone */ }
        });
    });
    server.on('upgrade', (request, socket, head) => {
        var _a, _b;
        const parsed2 = parseUrl((_a = request.url) !== null && _a !== void 0 ? _a : '/', true);
        const wsMatch = ((_b = parsed2.pathname) !== null && _b !== void 0 ? _b : '').match(/^\/ws\/pty\/([^/]+)$/);
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
        const ptyId = wsMatch[1];
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
    function resolveBindPort() {
        if (deps.portOverride !== undefined)
            return deps.portOverride;
        const envVal = process.env['PYRFOR_PORT'];
        if (envVal !== undefined && envVal !== '') {
            const p = parseInt(envVal, 10);
            if (!isNaN(p) && p >= 0)
                return p;
        }
        return config.gateway.port;
    }
    return {
        start() {
            return new Promise((resolve, reject) => {
                var _a;
                const host = (_a = config.gateway.host) !== null && _a !== void 0 ? _a : '127.0.0.1';
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
        stop() {
            return new Promise((resolve) => {
                ptyManager.killAll();
                wss.close();
                process.off('SIGTERM', cleanup);
                process.off('SIGINT', cleanup);
                const closeAllConnections = server.closeAllConnections;
                server.close(() => {
                    logger.info('[gateway] Server stopped');
                    resolve();
                });
                if (typeof closeAllConnections === 'function') {
                    closeAllConnections.call(server);
                }
            });
        },
        get port() {
            const addr = server.address();
            if (addr && typeof addr === 'object')
                return addr.port;
            return resolveBindPort();
        },
    };
}
