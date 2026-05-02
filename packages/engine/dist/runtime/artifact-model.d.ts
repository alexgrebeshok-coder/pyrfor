/**
 * artifact-model.ts — Filesystem-backed artifact store for Pyrfor run outputs.
 *
 * Features:
 * - Typed ArtifactKind union covering all Pyrfor output categories
 * - Atomic file writes with sha256 integrity, auto-mkdir
 * - Append-only _index.jsonl for fast listing and persistence across restarts
 * - Corrupt index lines are warned and skipped; valid entries still returned
 * - Pure helper exports: computeSha256, serializeRef, deserializeRef
 * - No external dependencies; uses node:crypto and node:fs/promises
 */
export type ArtifactKind = 'diff' | 'patch' | 'log' | 'test_result' | 'screenshot' | 'browser_trace' | 'plan' | 'summary' | 'risk_report' | 'pm_update' | 'release_note' | 'delivery_evidence' | 'context_pack';
export interface ArtifactRef {
    /** UUID v4 (with optional extension suffix) used as the on-disk filename */
    id: string;
    kind: ArtifactKind;
    /** Absolute path on the local filesystem */
    uri: string;
    sha256?: string;
    bytes?: number;
    createdAt: string;
    runId?: string;
    meta?: Record<string, unknown>;
}
export interface ArtifactStoreOptions {
    rootDir: string;
}
/** Compute hex-encoded SHA-256 digest of a buffer. */
export declare function computeSha256(buf: Buffer): string;
/** Serialise an ArtifactRef to a single JSON line (no trailing newline). */
export declare function serializeRef(ref: ArtifactRef): string;
/**
 * Parse a single JSON line back into an ArtifactRef.
 * Returns null if the line is empty, malformed, or missing required fields.
 */
export declare function deserializeRef(line: string): ArtifactRef | null;
export declare class ArtifactStore {
    private readonly rootDir;
    private readonly indexPath;
    constructor(opts: ArtifactStoreOptions);
    /** Return the absolute filesystem path for a given ArtifactRef. */
    resolvePath(ref: ArtifactRef): string;
    /**
     * Write content to disk, compute sha256, append ref to the index, and return
     * the resulting ArtifactRef.
     */
    write(kind: ArtifactKind, content: string | Buffer, opts?: {
        runId?: string;
        ext?: string;
        meta?: Record<string, unknown>;
    }): Promise<ArtifactRef>;
    /** Convenience wrapper: serialises value as JSON and sets ext to '.json'. */
    writeJSON(kind: ArtifactKind, value: unknown, opts?: {
        runId?: string;
        meta?: Record<string, unknown>;
    }): Promise<ArtifactRef>;
    /** Read the raw bytes of an artifact. */
    read(ref: ArtifactRef): Promise<Buffer>;
    /** Read artifact content as a UTF-8 string. */
    readText(ref: ArtifactRef): Promise<string>;
    /** Deserialise a JSON artifact into a typed value. */
    readJSON<T = unknown>(ref: ArtifactRef): Promise<T>;
    /**
     * List all artifacts by reading the _index.jsonl file.
     * Corrupt lines are warned and skipped; valid entries are always returned.
     * Optionally filter by runId and/or kind.
     */
    list(opts?: {
        runId?: string;
        kind?: ArtifactKind;
    }): Promise<ArtifactRef[]>;
    /**
     * Delete the artifact file.
     * Returns true if the file existed and was removed, false if it was already
     * absent.  Note: the index entry is retained (tombstone behaviour).
     */
    remove(ref: ArtifactRef): Promise<boolean>;
}
//# sourceMappingURL=artifact-model.d.ts.map