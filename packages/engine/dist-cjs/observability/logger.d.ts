/**
 * Structured Logger — replaces console.* in server/AI code
 * Controlled by LOG_LEVEL env var: debug | info | warn | error | silent
 */
export declare const logger: {
    debug(msg: string, meta?: unknown): void;
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
};
export default logger;
//# sourceMappingURL=logger.d.ts.map