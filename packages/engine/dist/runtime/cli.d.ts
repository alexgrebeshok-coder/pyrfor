#!/usr/bin/env node
/**
 * Pyrfor Runtime CLI — Entry point
 *
 * Usage:
 *   node dist/runtime/cli.js              # Start runtime
 *   node dist/runtime/cli.js --chat       # Interactive CLI mode
 *   node dist/runtime/cli.js --telegram   # Telegram bot mode
 *   node dist/runtime/cli.js --once "question"  # One-shot question
 */
/**
 * Parse `--since` flag value.
 *   "7d"  → 7 days ago
 *   "30d" → 30 days ago
 *   ISO   → exact Date
 * Throws a descriptive error for unrecognised values.
 */
export declare function parseSince(raw: string): Date;
/**
 * Handler for `pyrfor export-trajectories [flags]`.
 * Exported so integration tests can call it directly (without spawning a child process).
 */
export declare function runExportTrajectories(args: string[]): Promise<void>;
//# sourceMappingURL=cli.d.ts.map