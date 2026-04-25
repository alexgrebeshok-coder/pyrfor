/**
 * Structured Logger — replaces console.* in server/AI code
 *
 * Level control (highest priority wins):
 *   PYRFOR_LOG_LEVEL=debug|info|warn|error|silent
 *   LOG_LEVEL=debug|info|warn|error|silent  (legacy fallback)
 *   Default: 'debug' in non-production, 'info' in production.
 *
 * Output format:
 *   PYRFOR_LOG_FORMAT=json  → one JSON object per line:
 *     {"ts":"<ISO>","level":"info","msg":"<message>","data":{...optional}}
 *   PYRFOR_LOG_FORMAT=text (default) → pretty text output (unchanged behaviour).
 */
export declare const logger: {
    debug(msg: string, meta?: unknown): void;
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
};
export default logger;
//# sourceMappingURL=logger.d.ts.map