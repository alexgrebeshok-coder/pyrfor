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
import { readFileSync, existsSync, readdirSync, writeFileSync as writeFileSyncNode, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import { processPhoto } from './media/process-photo.js';
import { logger } from '../observability/logger.js';
import { loadConfig, saveConfig } from './config.js';
import { providerRouter as defaultProviderRouter } from './provider-router.js';
import { collectMetrics, formatMetrics } from './metrics.js';
import { createRateLimiter } from './rate-limit.js';
import { createTokenValidator } from './auth-tokens.js';
import { GoalStore } from './goal-store.js';
import { approvalFlow } from './approval-flow.js';
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile, searchFiles, FsApiError, } from './ide/fs-api.js';
import { gitStatus, gitDiff, gitFileContent, gitStage, gitUnstage, gitCommit, gitLog, gitBlame, } from './git/api.js';
import { transcribeBuffer } from './voice.js';
import { setWorkspaceRoot } from './tools.js';
import { createDefaultProductFactory, isProductFactoryTemplateId } from './product-factory.js';
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
function applyRuntimeWorkspace(runtime, workspaceRoot) {
    const setter = runtime.setWorkspacePath;
    if (typeof setter === 'function') {
        setter.call(runtime, workspaceRoot);
        return;
    }
    setWorkspaceRoot(workspaceRoot);
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
function isOrchestrationEvent(event) {
    if (!event || typeof event !== 'object')
        return false;
    const type = event.type;
    return typeof type === 'string' && (type.startsWith('run.') ||
        type.startsWith('effect.') ||
        type.startsWith('dag.') ||
        type.startsWith('verifier.') ||
        type.startsWith('eval.') ||
        type === 'artifact.created' ||
        type === 'test.completed');
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
            return { ok: true, text, openFiles, workspace, sessionId, attachments };
        });
    }
    // ─── Server ────────────────────────────────────────────────────────────
    const server = createServer((req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43, _44, _45;
        const parsed = parseUrl((_d = req.url) !== null && _d !== void 0 ? _d : '/', true);
        const method = (_e = req.method) !== null && _e !== void 0 ? _e : 'GET';
        const pathname = (_f = parsed.pathname) !== null && _f !== void 0 ? _f : '/';
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
            const exemptPaths = (_g = rlCfg === null || rlCfg === void 0 ? void 0 : rlCfg.exemptPaths) !== null && _g !== void 0 ? _g : ['/ping', '/health', '/metrics'];
            if (!exemptPaths.includes(pathname)) {
                const authHeader = req.headers['authorization'];
                const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : undefined;
                const ip = (_h = req.socket.remoteAddress) !== null && _h !== void 0 ? _h : 'unknown';
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
            sendJson(res, status, snapshot !== null && snapshot !== void 0 ? snapshot : { status: 'unknown' });
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
            const activeModel = (_j = router.getActiveModel()) !== null && _j !== void 0 ? _j : null;
            sendJson(res, 200, { activeModel });
            return;
        }
        // GET /api/settings/local-mode — public (no sensitive data)
        if (method === 'GET' && pathname === '/api/settings/local-mode') {
            const mode = (_m = (_l = (_k = router).getLocalMode) === null || _l === void 0 ? void 0 : _l.call(_k)) !== null && _m !== void 0 ? _m : { localFirst: false, localOnly: false };
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
                if (!stat.isFile()) {
                    sendJson(res, 404, { error: 'not_found' });
                    return;
                }
            }
            catch (_46) {
                sendJson(res, 404, { error: 'not_found' });
                return;
            }
            const ext = path.extname(full).toLowerCase();
            const mime = (_o = MEDIA_MIME_MAP[ext]) !== null && _o !== void 0 ? _o : 'application/octet-stream';
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
                    const rStats = (_q = (_p = runtime).getStats) === null || _q === void 0 ? void 0 : _q.call(_p);
                    sessionsCount = (_s = (_r = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _r === void 0 ? void 0 : _r.active) !== null && _s !== void 0 ? _s : 0;
                }
                catch ( /* not critical */_47) { /* not critical */ }
                const activeGoals = goalStore.list('active').slice(0, 3);
                const recentActivity = goalStore.list().slice(-10).reverse();
                const model = (_u = (_t = config.providers) === null || _t === void 0 ? void 0 : _t.defaultProvider) !== null && _u !== void 0 ? _u : 'unknown';
                sendJson(res, 200, {
                    status: 'running',
                    model,
                    costToday,
                    sessionsCount,
                    activeGoals,
                    recentActivity,
                    workspaceRoot: fsConfig.workspaceRoot,
                    cwd: runtimeWorkspacePath(runtime, fsConfig.workspaceRoot),
                    orchestration: yield buildOrchestrationDashboard(orchestration, approvals.getPending().length),
                });
            }
            catch (err) {
                sendJson(res, 500, { error: 'Internal server error' });
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
            // TODO: expose subagents API from PyrforRuntime (currently returns empty array)
            sendJson(res, 200, []);
            return;
        }
        if (pathname === '/api/memory' && method === 'GET') {
            const memoryPath = path.join(homedir(), '.openclaw', 'workspace', 'MEMORY.md');
            let lines = [];
            try {
                const content = readFileSync(memoryPath, 'utf-8');
                const allLines = content.split('\n');
                lines = allLines.slice(-50);
            }
            catch ( /* file may not exist */_48) { /* file may not exist */ }
            let files = [];
            try {
                const wsDir = path.join(homedir(), '.openclaw', 'workspace');
                files = readdirSync(wsDir).filter(f => !f.startsWith('.'));
            }
            catch ( /* dir may not exist */_49) { /* dir may not exist */ }
            sendJson(res, 200, { lines, files });
            return;
        }
        if (pathname === '/api/settings' && method === 'GET') {
            if (!enforceAuth(req, res, query))
                return;
            const settings = readApprovalSettings(approvalSettingsPath);
            sendJson(res, 200, {
                defaultAction: (_v = settings.defaultAction) !== null && _v !== void 0 ? _v : 'ask',
                whitelist: (_w = settings.whitelist) !== null && _w !== void 0 ? _w : [],
                blacklist: (_x = settings.blacklist) !== null && _x !== void 0 ? _x : [],
                autoApprovePatterns: (_y = settings.autoApprovePatterns) !== null && _y !== void 0 ? _y : [],
                provider: (_0 = (_z = config.providers) === null || _z === void 0 ? void 0 : _z.defaultProvider) !== null && _0 !== void 0 ? _0 : null,
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
                const rStats = (_2 = (_1 = runtime).getStats) === null || _2 === void 0 ? void 0 : _2.call(_1);
                sessionsCount = (_4 = (_3 = rStats === null || rStats === void 0 ? void 0 : rStats.sessions) === null || _3 === void 0 ? void 0 : _3.active) !== null && _4 !== void 0 ? _4 : 0;
            }
            catch ( /* not critical */_50) { /* not critical */ }
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
            (_5 = router.refreshFromEnvironment) === null || _5 === void 0 ? void 0 : _5.call(router);
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
            res.end();
            return;
        }
        // All other routes require auth
        const authResult = checkAuth(req, query);
        if (!authResult.ok) {
            sendUnauthorized(res, (_6 = authResult.reason) !== null && _6 !== void 0 ? _6 : 'unknown');
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
                catch (_51) {
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
            if (pathname === '/api/effects/pending' && method === 'GET') {
                if (!enforceAuth(req, res, query))
                    return;
                sendJson(res, 200, { effects: yield listPendingEffects(orchestration) });
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
                    if ((_7 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger) === null || _7 === void 0 ? void 0 : _7.subscribe) {
                        cleanup.push(orchestration.eventLedger.subscribe((event) => {
                            if (isOrchestrationEvent(event))
                                writeSSE('ledger', { event });
                        }));
                    }
                    if (approvals.subscribe) {
                        cleanup.push(approvals.subscribe((event) => {
                            writeSSE(event.type, event);
                        }));
                    }
                    writeRawSSE('snapshot', {
                        dashboard: yield buildOrchestrationDashboard(orchestration, approvals.getPending().length),
                        runs: (_9 = (_8 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _8 === void 0 ? void 0 : _8.listRuns()) !== null && _9 !== void 0 ? _9 : [],
                        approvals: approvals.getPending(),
                        effects: yield listPendingEffects(orchestration),
                    });
                    bufferingLiveEvents = false;
                    for (const buffered of bufferedEvents.splice(0)) {
                        writeRawSSE(buffered.eventName, buffered.data);
                    }
                }
                catch (err) {
                    bufferingLiveEvents = false;
                    writeRawSSE('error', { message: err instanceof Error ? err.message : 'operator stream failed' });
                    close();
                    res.end();
                }
                return;
            }
            const approvalDecisionMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
            if (approvalDecisionMatch && method === 'POST') {
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
                const rawLimit = Number((_10 = query['limit']) !== null && _10 !== void 0 ? _10 : 100);
                const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 100;
                const approvalEvents = approvals.listAudit(limit);
                const ledgerEvents = (orchestration === null || orchestration === void 0 ? void 0 : orchestration.eventLedger)
                    ? (yield orchestration.eventLedger.readAll()).filter(isOrchestrationEvent).slice(-limit).reverse()
                    : [];
                sendJson(res, 200, { events: [...ledgerEvents, ...approvalEvents].slice(0, limit) });
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
                const overlay = (_12 = (_11 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _11 === void 0 ? void 0 : _11.get('ochag')) === null || _12 === void 0 ? void 0 : _12.manifest;
                if (!overlay) {
                    sendJson(res, 404, { error: 'ochag_overlay_not_found' });
                    return;
                }
                sendJson(res, 200, {
                    domainId: 'ochag',
                    privacyRules: (_13 = overlay.privacyRules) !== null && _13 !== void 0 ? _13 : [],
                    toolPermissionOverrides: (_14 = overlay.toolPermissionOverrides) !== null && _14 !== void 0 ? _14 : {},
                    adapterRegistrations: (_15 = overlay.adapterRegistrations) !== null && _15 !== void 0 ? _15 : [],
                });
                return;
            }
            if (pathname === '/api/ochag/reminders/preview' && method === 'POST') {
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
                sendJson(res, 200, { runs: (_17 = (_16 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _16 === void 0 ? void 0 : _16.listRuns()) !== null && _17 !== void 0 ? _17 : [] });
                return;
            }
            if (pathname === '/api/runs' && method === 'POST') {
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
                const runId = decodeURIComponent(runEventsMatch[1]);
                sendJson(res, 200, { events: yield listRunEvents(orchestration, runId) });
                return;
            }
            const runDagMatch = pathname.match(/^\/api\/runs\/([^/]+)\/dag$/);
            if (runDagMatch && method === 'GET') {
                const runId = decodeURIComponent(runDagMatch[1]);
                const nodes = (_19 = (_18 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.dag) === null || _18 === void 0 ? void 0 : _18.listNodes().filter((node) => nodeBelongsToRun(node, runId))) !== null && _19 !== void 0 ? _19 : [];
                sendJson(res, 200, { nodes });
                return;
            }
            const runFramesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/frames$/);
            if (runFramesMatch && method === 'GET') {
                const runId = decodeURIComponent(runFramesMatch[1]);
                sendJson(res, 200, { frames: listWorkerFrames(orchestration, runId) });
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
                    sendJson(res, 200, evidence !== null && evidence !== void 0 ? evidence : { artifact: null, snapshot: null });
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
                    sendJson(res, 201, evidence);
                }
                catch (err) {
                    sendJson(res, 409, { error: err instanceof Error ? err.message : 'delivery_evidence_failed' });
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
                    sendJson(res, 200, plan !== null && plan !== void 0 ? plan : { artifact: null, plan: null });
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
                    sendJson(res, 201, plan);
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
                    sendJson(res, 200, apply !== null && apply !== void 0 ? apply : { artifact: null, result: null });
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
                        sendJson(res, 201, applied);
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
                const getVerifierStatus = runtime.getRunVerifierStatus;
                if (typeof getVerifierStatus !== 'function') {
                    sendJson(res, 501, { error: 'verifier_policy_unavailable' });
                    return;
                }
                try {
                    sendJson(res, 200, yield getVerifierStatus.call(runtime, runId));
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
                    ? `token:${(_20 = authResult.label) !== null && _20 !== void 0 ? _20 : 'authenticated'}`
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
                        const result = yield executeProductRun.call(runtime, runId);
                        sendJson(res, 200, Object.assign({ ok: true, action: body.action }, result));
                        return;
                    }
                    if (body.action === 'replay') {
                        const replayed = yield ((_21 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _21 === void 0 ? void 0 : _21.replayRun(runId));
                        sendJson(res, 200, { ok: true, action: body.action, run: replayed });
                        return;
                    }
                    if (body.action === 'continue') {
                        const run = yield ((_22 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _22 === void 0 ? void 0 : _22.transition(runId, 'running', body.resumeToken ? `continue:${body.resumeToken}` : 'operator continue'));
                        sendJson(res, 200, { ok: true, action: body.action, run });
                        return;
                    }
                    const run = yield ((_23 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.runLedger) === null || _23 === void 0 ? void 0 : _23.transition(runId, 'cancelled', 'operator abort'));
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
                sendJson(res, 200, { overlays: (_25 = (_24 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _24 === void 0 ? void 0 : _24.list()) !== null && _25 !== void 0 ? _25 : [] });
                return;
            }
            const overlayMatch = pathname.match(/^\/api\/overlays\/([^/]+)$/);
            if (overlayMatch && method === 'GET') {
                const domainId = decodeURIComponent(overlayMatch[1]);
                const overlay = (_27 = (_26 = orchestration === null || orchestration === void 0 ? void 0 : orchestration.overlays) === null || _26 === void 0 ? void 0 : _26.get(domainId)) === null || _27 === void 0 ? void 0 : _27.manifest;
                if (!overlay) {
                    sendJson(res, 404, { error: 'overlay_not_found' });
                    return;
                }
                sendJson(res, 200, { overlay });
                return;
            }
            // GET /status
            if (method === 'GET' && pathname === '/status') {
                const snapshot = (_28 = health === null || health === void 0 ? void 0 : health.getLastSnapshot()) !== null && _28 !== void 0 ? _28 : null;
                const cronStatus = (_29 = cron === null || cron === void 0 ? void 0 : cron.getStatus()) !== null && _29 !== void 0 ? _29 : null;
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
                const messages = (_30 = payload.messages) !== null && _30 !== void 0 ? _30 : [];
                const lastMessage = messages[messages.length - 1];
                if (!(lastMessage === null || lastMessage === void 0 ? void 0 : lastMessage.content)) {
                    sendJson(res, 400, { error: 'messages must contain at least one entry with content' });
                    return;
                }
                const channel = ((_31 = payload.channel) !== null && _31 !== void 0 ? _31 : 'api');
                const userId = (_32 = payload.userId) !== null && _32 !== void 0 ? _32 : 'gateway-user';
                const chatId = (_33 = payload.chatId) !== null && _33 !== void 0 ? _33 : 'gateway-chat';
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
                const relPath = (_34 = query['path']) !== null && _34 !== void 0 ? _34 : '';
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
                const relPath = (_35 = query['path']) !== null && _35 !== void 0 ? _35 : '';
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
                const ct = (_36 = req.headers['content-type']) !== null && _36 !== void 0 ? _36 : '';
                if (ct.toLowerCase().includes('multipart/form-data')) {
                    const m = yield processChatMultipart(req, false);
                    if (!m.ok) {
                        sendJson(res, m.status, { error: m.error });
                        return;
                    }
                    const userId = 'ide-user';
                    const chatId = 'ide-chat';
                    try {
                        const result = yield runtime.handleMessage('http', userId, chatId, m.text, m.sessionId ? { sessionId: m.sessionId } : undefined);
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
                const userId = (_37 = body.userId) !== null && _37 !== void 0 ? _37 : 'ide-user';
                const chatId = (_38 = body.chatId) !== null && _38 !== void 0 ? _38 : 'ide-chat';
                try {
                    const result = yield runtime.handleMessage('http', userId, chatId, body.text, body.sessionId ? { sessionId: body.sessionId } : undefined);
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
                const ct = (_39 = req.headers['content-type']) !== null && _39 !== void 0 ? _39 : '';
                const isMultipart = ct.toLowerCase().includes('multipart/form-data');
                let bodyText;
                let bodyOpenFiles;
                let bodyWorkspace;
                let bodySessionId;
                let attachments = [];
                let bodyPrefer;
                let bodyRoutingHints;
                let bodyWorker;
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
                    attachments = m.attachments;
                    // TODO(media-attachments): forward prefer/routingHints from multipart fields when branch merges
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
                    bodyWorker = ((_40 = body.worker) === null || _40 === void 0 ? void 0 : _40.transport) ? { transport: body.worker.transport } : undefined;
                }
                // Always 200 for SSE; errors are sent inline.
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Content-Type-Options': 'nosniff',
                });
                const writeSSE = (eventName, data) => {
                    if (eventName)
                        res.write(`event: ${eventName}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                };
                try {
                    let firstEvent = true;
                    let emittedAny = false;
                    try {
                        for (var _52 = true, _53 = __asyncValues(runtime.streamChatRequest({
                            text: bodyText,
                            openFiles: bodyOpenFiles,
                            workspace: bodyWorkspace !== null && bodyWorkspace !== void 0 ? bodyWorkspace : fsConfig.workspaceRoot,
                            sessionId: bodySessionId,
                            prefer: bodyPrefer,
                            routingHints: bodyRoutingHints,
                            worker: bodyWorker,
                        })), _54; _54 = yield _53.next(), _a = _54.done, !_a; _52 = true) {
                            _c = _54.value;
                            _52 = false;
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
                            if (!_52 && !_a && (_b = _53.return)) yield _b.call(_53);
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
            // POST /api/audio/transcribe  multipart/form-data; field: audio (Blob, audio/*)
            if (method === 'POST' && pathname === '/api/audio/transcribe') {
                const contentType = (_41 = req.headers['content-type']) !== null && _41 !== void 0 ? _41 : '';
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
                const ref = (_42 = query['ref']) !== null && _42 !== void 0 ? _42 : 'HEAD';
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
                const limit = parseInt((_43 = query['limit']) !== null && _43 !== void 0 ? _43 : '50', 10);
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
                catch (_55) {
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
                (_45 = (_44 = router).setLocalMode) === null || _45 === void 0 ? void 0 : _45.call(_44, { localFirst, localOnly });
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
                server.close(() => {
                    logger.info('[gateway] Server stopped');
                    resolve();
                });
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
