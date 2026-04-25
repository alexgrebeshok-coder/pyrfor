/**
 * backup-restore — Snapshot and restore all Pyrfor JSON stores into a single
 * gzip-compressed archive (.bk). No external dependencies; uses node:zlib,
 * node:fs (sync), node:path, node:crypto.
 *
 * Archive format (pyrfor-bk-v1):
 *   gzip( JSON.stringify({ manifest: BackupManifest, files: { [relpath]: base64 } }) )
 * Written atomically via tmp file + rename.
 */
export type BackupSource = {
    id: string;
    path: string;
    include?: RegExp;
    exclude?: RegExp;
};
export type BackupManifest = {
    id: string;
    createdAt: number;
    sources: {
        id: string;
        path: string;
        fileCount: number;
        bytes: number;
    }[];
    totalBytes: number;
    format: 'pyrfor-bk-v1';
};
export type BackupArchive = {
    manifest: BackupManifest;
    archivePath: string;
};
export type RestoreReport = {
    restoredFiles: number;
    bytes: number;
    skipped: {
        path: string;
        reason: string;
    }[];
};
export declare function createBackupManager(opts: {
    archiveDir: string;
    clock?: () => number;
    logger?: (msg: string, meta?: any) => void;
}): {
    addSource: (s: BackupSource) => void;
    removeSource: (id: string) => void;
    listSources: () => BackupSource[];
    snapshot: (opts?: {
        tag?: string;
    }) => Promise<BackupArchive>;
    listArchives: () => {
        path: string;
        manifest: BackupManifest;
    }[];
    restore: (archivePath: string, opts: {
        targetRoot: string;
        sourceIds?: string[];
        overwrite?: boolean;
    }) => Promise<RestoreReport>;
    verify: (archivePath: string) => Promise<{
        ok: boolean;
        errors: string[];
    }>;
    prune: (opts: {
        keepLast?: number;
        olderThanMs?: number;
    }) => Promise<{
        deleted: string[];
    }>;
};
//# sourceMappingURL=backup-restore.d.ts.map