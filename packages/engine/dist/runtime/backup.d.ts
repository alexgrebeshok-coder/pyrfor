/**
 * backup — Create and restore ~/.pyrfor data archives.
 *
 * createBackup  — tars ~/.pyrfor (excluding backups/) into a .tar.gz
 * restoreBackup — extracts a .tar.gz back into the target directory
 * listBackups   — lists pyrfor-backup-*.tar.gz files sorted newest first
 */
export interface BackupResult {
    path: string;
    bytes: number;
    createdAt: string;
}
export interface RestoreResult {
    restoredTo: string;
    backupOfPrevious?: string;
}
export interface BackupEntry {
    name: string;
    path: string;
    bytes: number;
    mtime: Date;
}
export interface CreateBackupOptions {
    sourceDir?: string;
    outputPath?: string;
}
export declare function createBackup(opts?: CreateBackupOptions): Promise<BackupResult>;
export interface RestoreBackupOptions {
    archivePath: string;
    targetDir?: string;
    force?: boolean;
}
export declare function restoreBackup(opts: RestoreBackupOptions): Promise<RestoreResult>;
export interface ListBackupsOptions {
    backupsDir?: string;
}
export declare function listBackups(opts?: ListBackupsOptions): Promise<BackupEntry[]>;
//# sourceMappingURL=backup.d.ts.map