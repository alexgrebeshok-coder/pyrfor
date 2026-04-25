/**
 * migrate-sessions — Import legacy daemon/openclaw sessions into ~/.pyrfor/sessions/ format.
 *
 * Legacy candidates:
 *   ~/.openclaw/sessions/*.sqlite | *.db  (SQLite — requires better-sqlite3)
 *   ~/.ceoclaw/sessions/**\/*.json         (older daemon JSON)
 *   ~/.openclaw/memory/*.json             (free-form memory dumps — skipped)
 */
export type LegacyStoreType = 'json' | 'sqlite' | 'unknown';
export interface LegacyStore {
    type: LegacyStoreType;
    /** Absolute path to the file (JSON/SQLite) or directory root. */
    filePath: string;
    /** Human-readable label for progress messages. */
    label?: string;
}
export interface MigrationError {
    file?: string;
    msg: string;
}
export interface MigrationReport {
    imported: number;
    skipped: number;
    errors: MigrationError[];
    /** Absolute paths of files written (empty on dry-run). */
    files: string[];
}
export interface MigrateOptions {
    destRoot: string;
    channel?: string;
    dryRun?: boolean;
    overwrite?: boolean;
    onProgress?: (msg: string) => void;
}
export interface PersistedMessage {
    role: string;
    content: string;
    timestamp: string;
}
export interface SessionData {
    schemaVersion: number;
    id: string;
    channel: string;
    userId: string;
    chatId: string;
    systemPrompt: string;
    messages: PersistedMessage[];
    tokenCount: number;
    maxTokens: number;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
/** Probe each root directory and return discovered legacy stores. */
export declare function discoverLegacyStores(roots?: string[]): Promise<LegacyStore[]>;
export declare function migrateLegacyStore(store: LegacyStore, opts: MigrateOptions): Promise<MigrationReport>;
//# sourceMappingURL=migrate-sessions.d.ts.map