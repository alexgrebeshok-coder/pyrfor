/**
 * backup — Create and restore ~/.pyrfor data archives.
 *
 * createBackup  — tars ~/.pyrfor (excluding backups/) into a .tar.gz
 * restoreBackup — extracts a .tar.gz back into the target directory
 * listBackups   — lists pyrfor-backup-*.tar.gz files sorted newest first
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
import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { logger } from '../observability/logger.js';
// ── Helpers ────────────────────────────────────────────────────────────────
function isoSafe() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}
function runSpawn(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const errChunks = [];
        proc.stderr.on('data', (chunk) => errChunks.push(chunk));
        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                const msg = Buffer.concat(errChunks).toString().trim();
                reject(new Error(`${cmd} exited with code ${code}: ${msg}`));
            }
        });
        proc.on('error', reject);
    });
}
export function createBackup() {
    return __awaiter(this, arguments, void 0, function* (opts = {}) {
        var _a, _b;
        const sourceDir = (_a = opts.sourceDir) !== null && _a !== void 0 ? _a : path.join(homedir(), '.pyrfor');
        const backupsDir = path.join(sourceDir, 'backups');
        const createdAt = new Date().toISOString();
        // Append a short random suffix so concurrent calls within the same
        // millisecond never collide on the same archive filename.
        const rnd = Math.random().toString(36).slice(2, 7);
        const defaultName = `pyrfor-backup-${isoSafe()}-${rnd}.tar.gz`;
        const outputPath = (_b = opts.outputPath) !== null && _b !== void 0 ? _b : path.join(backupsDir, defaultName);
        logger.info('[backup] Creating backup', { sourceDir, outputPath });
        yield fsp.mkdir(path.dirname(outputPath), { recursive: true });
        // Derive the exclude path relative to sourceDir so tar excludes backups/
        const relativeBackups = path.relative(sourceDir, backupsDir);
        yield runSpawn('tar', [
            '-czf', outputPath,
            `--exclude=${relativeBackups}`,
            '-C', path.dirname(sourceDir),
            path.basename(sourceDir),
        ]);
        const stat = yield fsp.stat(outputPath);
        logger.info('[backup] Backup created', { outputPath, bytes: stat.size });
        return { path: outputPath, bytes: stat.size, createdAt };
    });
}
export function restoreBackup(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { archivePath, force = false } = opts;
        const targetDir = (_a = opts.targetDir) !== null && _a !== void 0 ? _a : path.join(homedir(), '.pyrfor');
        logger.info('[backup] Restoring backup', { archivePath, targetDir, force });
        let backupOfPrevious;
        let targetExists = false;
        try {
            yield fsp.access(targetDir);
            targetExists = true;
        }
        catch (_b) {
            // target doesn't exist — fine
        }
        if (targetExists) {
            if (!force) {
                throw new Error(`Target directory already exists: ${targetDir}. Use force: true to overwrite.`);
            }
            backupOfPrevious = `${targetDir}.bak-${isoSafe()}`;
            yield fsp.rename(targetDir, backupOfPrevious);
            logger.info('[backup] Existing directory moved', { from: targetDir, to: backupOfPrevious });
        }
        yield fsp.mkdir(targetDir, { recursive: true });
        // tar extracts the top-level directory from the archive into the parent, so
        // we extract into the parent and let tar recreate the directory.
        yield fsp.rm(targetDir, { recursive: true, force: true });
        yield runSpawn('tar', [
            '-xzf', archivePath,
            '-C', path.dirname(targetDir),
        ]);
        logger.info('[backup] Restore complete', { restoredTo: targetDir });
        return { restoredTo: targetDir, backupOfPrevious };
    });
}
export function listBackups() {
    return __awaiter(this, arguments, void 0, function* (opts = {}) {
        var _a;
        const backupsDir = (_a = opts.backupsDir) !== null && _a !== void 0 ? _a : path.join(homedir(), '.pyrfor', 'backups');
        let entries;
        try {
            entries = yield fsp.readdir(backupsDir);
        }
        catch (_b) {
            return [];
        }
        const matching = entries.filter((f) => /^pyrfor-backup-.*\.tar\.gz$/.test(f));
        const results = yield Promise.all(matching.map((name) => __awaiter(this, void 0, void 0, function* () {
            const fullPath = path.join(backupsDir, name);
            const stat = yield fsp.stat(fullPath);
            return { name, path: fullPath, bytes: stat.size, mtime: stat.mtime };
        })));
        // Newest first
        results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        return results;
    });
}
