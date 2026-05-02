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
import type { EventLedger } from './event-ledger';
export interface ArgSchema {
    positional?: Array<{
        name: string;
        type: 'string' | 'number' | 'boolean';
        required?: boolean;
        description?: string;
    }>;
    flags?: Record<string, {
        type: 'string' | 'number' | 'boolean';
        description?: string;
        default?: unknown;
    }>;
}
export interface ParsedArgs {
    positional: unknown[];
    flags: Record<string, unknown>;
}
export interface SlashContext {
    raw: string;
    command: string;
    args: ParsedArgs;
    workspaceId: string;
    sessionId: string;
    runId?: string;
    ledger?: EventLedger;
}
export interface SlashResult {
    ok: boolean;
    output?: string;
    data?: unknown;
    error?: string;
    ms?: number;
}
export type SlashHandler = (ctx: SlashContext) => Promise<SlashResult> | SlashResult;
export interface SlashCommand {
    name: string;
    description: string;
    aliases?: string[];
    argSchema?: ArgSchema;
    handler: SlashHandler;
    permissionClass?: 'auto_allow' | 'ask_once' | 'ask_every_time';
}
/**
 * Tokenize a command line string, respecting double-quoted segments and \" escapes.
 */
export declare function tokenize(line: string): string[];
/**
 * Parse positional arguments and --flags from a token array (command token excluded).
 * Applies defaults from schema if provided.
 */
export declare function parseArgs(tokens: string[], schema?: ArgSchema): ParsedArgs;
export declare class SlashCommandRegistry {
    /** Insertion-ordered list of commands. */
    private readonly commands;
    /** Fast lookup: name and aliases → command. */
    private readonly index;
    /**
     * Register a slash command. Throws if name or any alias collides.
     */
    register(cmd: SlashCommand): void;
    /**
     * Unregister by name. Returns true if the command was found and removed.
     */
    unregister(name: string): boolean;
    get(nameOrAlias: string): SlashCommand | undefined;
    has(nameOrAlias: string): boolean;
    /** Returns commands in insertion order. */
    list(): SlashCommand[];
    /**
     * Parse a raw input line into { command, args }.
     * Accepts leading '/' or bare command name.
     * Returns null if the command is unknown or validation fails.
     */
    parse(line: string): {
        command: string;
        args: ParsedArgs;
    } | null;
    /**
     * Validate parsed args against a command's argSchema.
     */
    validate(cmd: SlashCommand, args: ParsedArgs): {
        ok: boolean;
        errors: string[];
    };
    /**
     * Parse, validate, and invoke the command on the given line.
     * Measures execution time and emits ledger events if a ledger is provided.
     */
    invoke(line: string, ctx: Omit<SlashContext, 'raw' | 'command' | 'args'>): Promise<SlashResult>;
}
/**
 * Create a registry pre-populated with placeholder stubs for the built-in commands.
 * Real implementations are wired in later modules.
 */
export declare function createDefaultRegistry(): SlashCommandRegistry;
//# sourceMappingURL=slash-commands.d.ts.map