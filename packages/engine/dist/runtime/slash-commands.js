/**
 * slash-commands.ts — Slash-command registry for Pyrfor.
 *
 * Provides:
 *  - SlashCommandRegistry: register/unregister/get/list/parse/validate/invoke
 *  - Pure helpers: tokenize(), parseArgs()
 *  - Factory: createDefaultRegistry() — stubs for /help /commit /diff /plan /clear /model /mode /status
 *
 * Event emission: uses EventLedger.append() directly to emit
 *   'tool.requested' and 'tool.executed' on every invocation.
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
// ====== Pure Helpers =========================================================
/**
 * Tokenize a command line string, respecting double-quoted segments and \" escapes.
 */
export function tokenize(line) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i += 2;
            continue;
        }
        if (ch === '"') {
            inQuotes = !inQuotes;
            i++;
            continue;
        }
        if (!inQuotes && (ch === ' ' || ch === '\t')) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
            i++;
            continue;
        }
        current += ch;
        i++;
    }
    if (current.length > 0)
        tokens.push(current);
    return tokens;
}
/**
 * Parse positional arguments and --flags from a token array (command token excluded).
 * Applies defaults from schema if provided.
 */
export function parseArgs(tokens, schema) {
    var _a, _b;
    const positional = [];
    const flags = {};
    // Seed defaults
    if (schema === null || schema === void 0 ? void 0 : schema.flags) {
        for (const [flagName, flagDef] of Object.entries(schema.flags)) {
            if (flagDef.default !== undefined) {
                flags[flagName] = flagDef.default;
            }
        }
    }
    let i = 0;
    while (i < tokens.length) {
        const tok = tokens[i];
        if (tok.startsWith('--')) {
            const eqIdx = tok.indexOf('=');
            if (eqIdx !== -1) {
                // --flag=value
                const key = tok.slice(2, eqIdx);
                const val = tok.slice(eqIdx + 1);
                flags[key] = coerceFlag(val, key, schema);
            }
            else {
                const key = tok.slice(2);
                const flagDef = (_a = schema === null || schema === void 0 ? void 0 : schema.flags) === null || _a === void 0 ? void 0 : _a[key];
                const nextTok = tokens[i + 1];
                if ((flagDef === null || flagDef === void 0 ? void 0 : flagDef.type) === 'boolean' || nextTok === undefined || nextTok.startsWith('--')) {
                    // boolean flag or no value available
                    flags[key] = true;
                }
                else {
                    flags[key] = coerceFlag(nextTok, key, schema);
                    i++;
                }
            }
        }
        else {
            // positional
            const schemaEntry = (_b = schema === null || schema === void 0 ? void 0 : schema.positional) === null || _b === void 0 ? void 0 : _b[positional.length];
            positional.push(coercePositional(tok, schemaEntry === null || schemaEntry === void 0 ? void 0 : schemaEntry.type));
        }
        i++;
    }
    return { positional, flags };
}
function coerceFlag(value, key, schema) {
    var _a, _b;
    const type = (_b = (_a = schema === null || schema === void 0 ? void 0 : schema.flags) === null || _a === void 0 ? void 0 : _a[key]) === null || _b === void 0 ? void 0 : _b.type;
    return coerceValue(value, type);
}
function coercePositional(value, type) {
    return coerceValue(value, type);
}
function coerceValue(value, type) {
    if (type === 'number')
        return Number(value);
    if (type === 'boolean')
        return value === 'true' || value === '1';
    return value;
}
// ====== SlashCommandRegistry =================================================
export class SlashCommandRegistry {
    constructor() {
        /** Insertion-ordered list of commands. */
        this.commands = [];
        /** Fast lookup: name and aliases → command. */
        this.index = new Map();
    }
    // ─── Registration ─────────────────────────────────────────────────────────
    /**
     * Register a slash command. Throws if name or any alias collides.
     */
    register(cmd) {
        var _a;
        const keysToCheck = [cmd.name, ...((_a = cmd.aliases) !== null && _a !== void 0 ? _a : [])];
        for (const key of keysToCheck) {
            if (this.index.has(key)) {
                throw new Error(`SlashCommandRegistry: duplicate name/alias "${key}"`);
            }
        }
        this.commands.push(cmd);
        for (const key of keysToCheck) {
            this.index.set(key, cmd);
        }
    }
    /**
     * Unregister by name. Returns true if the command was found and removed.
     */
    unregister(name) {
        const cmd = this.index.get(name);
        if (!cmd)
            return false;
        const idx = this.commands.indexOf(cmd);
        if (idx !== -1)
            this.commands.splice(idx, 1);
        // Remove all keys pointing to this command
        for (const [key, val] of this.index.entries()) {
            if (val === cmd)
                this.index.delete(key);
        }
        return true;
    }
    // ─── Lookup ───────────────────────────────────────────────────────────────
    get(nameOrAlias) {
        return this.index.get(nameOrAlias);
    }
    has(nameOrAlias) {
        return this.index.has(nameOrAlias);
    }
    /** Returns commands in insertion order. */
    list() {
        return [...this.commands];
    }
    // ─── Parsing & Validation ─────────────────────────────────────────────────
    /**
     * Parse a raw input line into { command, args }.
     * Accepts leading '/' or bare command name.
     * Returns null if the command is unknown or validation fails.
     */
    parse(line) {
        const tokens = tokenize(line.trim());
        if (tokens.length === 0)
            return null;
        let commandToken = tokens[0];
        if (commandToken.startsWith('/'))
            commandToken = commandToken.slice(1);
        const cmd = this.index.get(commandToken);
        if (!cmd)
            return null;
        const args = parseArgs(tokens.slice(1), cmd.argSchema);
        const validation = this.validate(cmd, args);
        if (!validation.ok)
            return null;
        return { command: commandToken, args };
    }
    /**
     * Validate parsed args against a command's argSchema.
     */
    validate(cmd, args) {
        const errors = [];
        const schema = cmd.argSchema;
        if (!schema)
            return { ok: true, errors };
        // Check required positionals
        if (schema.positional) {
            for (let i = 0; i < schema.positional.length; i++) {
                const def = schema.positional[i];
                if (def.required) {
                    if (args.positional[i] === undefined) {
                        errors.push(`Missing required positional argument: ${def.name}`);
                    }
                    else {
                        const actualType = typeof args.positional[i];
                        if (actualType !== def.type) {
                            errors.push(`Positional argument "${def.name}" expects type "${def.type}", got "${actualType}"`);
                        }
                    }
                }
            }
        }
        // Check flag types
        if (schema.flags) {
            for (const [flagName, flagDef] of Object.entries(schema.flags)) {
                const val = args.flags[flagName];
                if (val !== undefined) {
                    const actualType = typeof val;
                    if (actualType !== flagDef.type) {
                        errors.push(`Flag "--${flagName}" expects type "${flagDef.type}", got "${actualType}"`);
                    }
                }
            }
        }
        return { ok: errors.length === 0, errors };
    }
    // ─── Invocation ───────────────────────────────────────────────────────────
    /**
     * Parse, validate, and invoke the command on the given line.
     * Measures execution time and emits ledger events if a ledger is provided.
     */
    invoke(line, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const trimmed = line.trim();
            const tokens = tokenize(trimmed);
            if (tokens.length === 0) {
                return { ok: false, error: 'Empty command line' };
            }
            let commandToken = tokens[0];
            if (commandToken.startsWith('/'))
                commandToken = commandToken.slice(1);
            const cmd = this.index.get(commandToken);
            if (!cmd) {
                return { ok: false, error: `Unknown command: /${commandToken}` };
            }
            const args = parseArgs(tokens.slice(1), cmd.argSchema);
            const validation = this.validate(cmd, args);
            if (!validation.ok) {
                return { ok: false, error: `Validation failed: ${validation.errors.join('; ')}` };
            }
            const fullCtx = Object.assign(Object.assign({}, ctx), { raw: trimmed, command: commandToken, args });
            const toolName = `slash:${commandToken}`;
            const runId = (_a = ctx.runId) !== null && _a !== void 0 ? _a : 'unknown';
            // Emit tool.requested
            if (ctx.ledger) {
                yield ctx.ledger.append({
                    type: 'tool.requested',
                    run_id: runId,
                    tool: toolName,
                    args: args.flags,
                });
            }
            const start = Date.now();
            let result;
            try {
                result = yield cmd.handler(fullCtx);
            }
            catch (err) {
                const ms = Date.now() - start;
                const errorMsg = err instanceof Error ? err.message : String(err);
                if (ctx.ledger) {
                    yield ctx.ledger.append({
                        type: 'tool.executed',
                        run_id: runId,
                        tool: toolName,
                        ms,
                        status: 'error',
                        error: errorMsg,
                    });
                }
                return { ok: false, error: errorMsg, ms };
            }
            const ms = Date.now() - start;
            result = Object.assign(Object.assign({}, result), { ms });
            if (ctx.ledger) {
                yield ctx.ledger.append({
                    type: 'tool.executed',
                    run_id: runId,
                    tool: toolName,
                    ms,
                    status: result.ok ? 'ok' : 'error',
                    error: result.error,
                });
            }
            return result;
        });
    }
}
// ====== Default Registry Factory ============================================
/**
 * Create a registry pre-populated with placeholder stubs for the built-in commands.
 * Real implementations are wired in later modules.
 */
export function createDefaultRegistry() {
    const registry = new SlashCommandRegistry();
    registry.register({
        name: 'help',
        description: 'List all available slash commands',
        handler: (ctx) => {
            // Reconstruct list from the bound registry by re-parsing context.
            // Because handler has no direct registry reference we return a
            // description and let the invoker supply the list.
            const output = ctx.args.flags['registry']
                ? ctx.args.flags['registry']
                : 'Use /help to list all commands. (Full list available at runtime.)';
            return { ok: true, output };
        },
    });
    registry.register({
        name: 'commit',
        description: 'Stage and commit current changes with an AI-generated message',
        handler: (_ctx) => ({
            ok: true,
            output: '/commit — would stage all changes and commit with an AI-generated message.',
        }),
    });
    registry.register({
        name: 'diff',
        description: 'Show the current git diff',
        handler: (_ctx) => ({
            ok: true,
            output: '/diff — would display the current git diff.',
        }),
    });
    registry.register({
        name: 'plan',
        description: 'Generate or display the current action plan',
        handler: (_ctx) => ({
            ok: true,
            output: '/plan — would generate or display the current action plan.',
        }),
    });
    registry.register({
        name: 'clear',
        description: 'Clear the current session context / conversation history',
        handler: (_ctx) => ({
            ok: true,
            output: '/clear — would clear the conversation history.',
        }),
    });
    registry.register({
        name: 'model',
        description: 'Switch or display the active model',
        handler: (_ctx) => ({
            ok: true,
            output: '/model — would display or switch the active model.',
        }),
    });
    registry.register({
        name: 'mode',
        description: 'Switch the active operating mode (e.g. auto, supervised)',
        handler: (_ctx) => ({
            ok: true,
            output: '/mode — would switch the active operating mode.',
        }),
    });
    registry.register({
        name: 'status',
        description: 'Display current session / run status',
        handler: (_ctx) => ({
            ok: true,
            output: '/status — would display the current session and run status.',
        }),
    });
    // Patch /help to list all commands after all are registered
    const helpCmd = registry.get('help');
    const originalHandler = helpCmd.handler;
    helpCmd.handler = (ctx) => {
        const all = registry.list();
        const lines = all.map((c) => `/${c.name} — ${c.description}`).join('\n');
        return { ok: true, output: lines };
    };
    // prevent TS unused-variable error
    void originalHandler;
    return registry;
}
