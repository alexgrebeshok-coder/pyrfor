/**
 * Error sanitiser — strips secrets, paths, and PII from error messages
 * before they are surfaced in Telegram chats.
 */
export interface SanitiseOptions {
    homeDir?: string;
    cwd?: string;
    /** Truncate final message to this length. Default 1500. */
    maxLength?: number;
    /** Custom regex patterns to redact. */
    extraPatterns?: Array<{
        pattern: RegExp;
        replacement: string;
    }>;
    /** Include stack trace? Default false. */
    includeStack?: boolean;
}
export interface SanitiseResult {
    message: string;
    redactions: number;
    truncated: boolean;
}
export declare function sanitiseError(err: unknown, opts?: SanitiseOptions): SanitiseResult;
export declare function formatErrorForTelegram(err: unknown, opts?: SanitiseOptions): string;
//# sourceMappingURL=error-sanitiser.d.ts.map