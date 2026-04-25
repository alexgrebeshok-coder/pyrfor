/**
 * Approval Flow — safety gate between LLM tool calls and execution.
 *
 * Categories:
 *   auto  — execute immediately (read/write/web tools, etc.)
 *   ask   — prompt user via Telegram inline keyboard
 *   block — deny immediately (dangerous destructive commands)
 *
 * Persistent settings: ~/.pyrfor/approval-settings.json
 *   whitelist           — always auto-approve (substring match on "tool: cmd")
 *   blacklist           — always deny
 *   autoApprovePatterns — additional regex auto-approves
 *   defaultAction       — 'approve' | 'ask' | 'deny' for unmatched ask-category tools
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
import { EventEmitter } from 'events';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../observability/logger.js';
// ---------------------------------------------------------------------------
// Default category lists
// ---------------------------------------------------------------------------
const DEFAULT_AUTO_APPROVE_TOOLS = new Set([
    'read',
    'write',
    'edit_file',
    'web_search',
    'web_fetch',
    'process_list',
    'process_poll',
    'send_message',
]);
const DEFAULT_ASK_TOOLS = new Set(['exec', 'process_spawn', 'process_kill', 'browser']);
/** Commands that are immediately denied — no user prompt. */
const DEFAULT_BLOCKED_PATTERNS = [
    /rm\s+-rf\s+\//,
    /sudo\s/,
    /\bdrop\s+(table|database)\b/i,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /\bshutdown\b/,
    /\breboot\b/,
    /:\(\)\{:|:&\};:/,
];
/** Commands in exec/process_spawn that need user confirmation. */
const DEFAULT_ASK_PATTERNS = [
    /npm\s+install/,
    /npm\s+run/,
    /git\s+push/,
    /git\s+commit/,
    /\bcurl\b/,
    /pip\s+install/,
];
// ---------------------------------------------------------------------------
// ApprovalFlow class
// ---------------------------------------------------------------------------
export class ApprovalFlow {
    constructor(opts = {}) {
        var _a, _b;
        this.events = new EventEmitter();
        this.pending = new Map();
        this.settings = {};
        this.settingsLoaded = false;
        this.settingsPath =
            (_a = opts.settingsPath) !== null && _a !== void 0 ? _a : path.join(os.homedir(), '.pyrfor', 'approval-settings.json');
        this.ttlMs = (_b = opts.ttlMs) !== null && _b !== void 0 ? _b : 600000;
    }
    // ── Settings I/O ──────────────────────────────────────────────────────────
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const raw = yield fsp.readFile(this.settingsPath, 'utf-8');
                this.settings = JSON.parse(raw);
            }
            catch (_a) {
                this.settings = {};
            }
            this.settingsLoaded = true;
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield fsp.mkdir(path.dirname(this.settingsPath), { recursive: true });
            yield fsp.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
        });
    }
    ensureLoaded() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.settingsLoaded) {
                yield this.loadSettings();
            }
        });
    }
    // ── Categorization ────────────────────────────────────────────────────────
    /**
     * Categorize a tool call — pure (synchronous) once settings are loaded.
     * Call loadSettings() / ensureLoaded() before using this.
     */
    categorize(toolName, args) {
        var _a, _b, _c, _d;
        const cmd = toolName === 'exec' || toolName === 'process_spawn'
            ? typeof args.command === 'string'
                ? args.command
                : ''
            : '';
        const summary = `${toolName}: ${cmd || JSON.stringify(args).slice(0, 200)}`;
        // Blacklist (user-configured) → block
        for (const bl of (_a = this.settings.blacklist) !== null && _a !== void 0 ? _a : []) {
            if (summary.includes(bl))
                return 'block';
        }
        // Hardcoded dangerous patterns → block
        if (toolName === 'exec' || toolName === 'process_spawn') {
            for (const re of DEFAULT_BLOCKED_PATTERNS) {
                if (re.test(cmd))
                    return 'block';
            }
        }
        // Whitelist (user-configured) → auto
        for (const wl of (_b = this.settings.whitelist) !== null && _b !== void 0 ? _b : []) {
            if (summary.includes(wl))
                return 'auto';
        }
        // User-configured regex auto-approves
        for (const pat of (_c = this.settings.autoApprovePatterns) !== null && _c !== void 0 ? _c : []) {
            try {
                if (new RegExp(pat).test(summary))
                    return 'auto';
            }
            catch (_e) {
                // ignore invalid regex in settings
            }
        }
        // Default auto-approve tools
        if (DEFAULT_AUTO_APPROVE_TOOLS.has(toolName))
            return 'auto';
        // Default ask tools
        if (DEFAULT_ASK_TOOLS.has(toolName))
            return 'ask';
        // exec with ask patterns → ask
        if (toolName === 'exec') {
            for (const re of DEFAULT_ASK_PATTERNS) {
                if (re.test(cmd))
                    return 'ask';
            }
        }
        // Unknown tool: respect defaultAction
        const def = (_d = this.settings.defaultAction) !== null && _d !== void 0 ? _d : 'ask';
        if (def === 'approve')
            return 'auto';
        if (def === 'deny')
            return 'block';
        return 'ask';
    }
    // ── Approval gate ─────────────────────────────────────────────────────────
    requestApproval(req) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureLoaded();
            const category = this.categorize(req.toolName, req.args);
            if (category === 'auto')
                return 'approve';
            if (category === 'block') {
                logger.warn('Tool blocked by approval flow', {
                    toolName: req.toolName,
                    summary: req.summary,
                });
                return 'deny';
            }
            // category === 'ask' — emit event and wait for resolveDecision or TTL
            return new Promise((resolve) => {
                const timeoutHandle = setTimeout(() => {
                    this.pending.delete(req.id);
                    logger.warn('Approval request timed out', { id: req.id, toolName: req.toolName });
                    resolve('timeout');
                }, this.ttlMs);
                this.pending.set(req.id, {
                    resolve,
                    timeoutHandle,
                    summary: req.summary,
                    toolName: req.toolName,
                    args: req.args,
                });
                this.events.emit('approval-requested', req);
            });
        });
    }
    /**
     * Called by the Telegram callback handler when the user clicks
     * Approve/Deny on the inline keyboard.
     */
    resolveDecision(id, decision) {
        const item = this.pending.get(id);
        if (!item) {
            logger.debug('resolveDecision: no pending item found', { id });
            return;
        }
        clearTimeout(item.timeoutHandle);
        this.pending.delete(id);
        item.resolve(decision);
    }
    getPending() {
        return Array.from(this.pending.entries()).map(([id, item]) => ({
            id,
            toolName: item.toolName,
            summary: item.summary,
            args: item.args,
        }));
    }
    // ── Settings mutations ────────────────────────────────────────────────────
    addToWhitelist(s) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            yield this.ensureLoaded();
            this.settings.whitelist = [...((_a = this.settings.whitelist) !== null && _a !== void 0 ? _a : []), s];
            yield this.saveSettings();
        });
    }
    addToBlacklist(s) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            yield this.ensureLoaded();
            this.settings.blacklist = [...((_a = this.settings.blacklist) !== null && _a !== void 0 ? _a : []), s];
            yield this.saveSettings();
        });
    }
    setDefault(action) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureLoaded();
            this.settings.defaultAction = action;
            yield this.saveSettings();
        });
    }
}
// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const approvalFlow = new ApprovalFlow({
    settingsPath: path.join(os.homedir(), '.pyrfor', 'approval-settings.json'),
});
