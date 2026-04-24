/**
 * backup — Create and restore ~/.pyrfor data archives.
 *
 * createBackup  — tars ~/.pyrfor (excluding backups/) into a .tar.gz
 * restoreBackup — extracts a .tar.gz back into the target directory
 * listBackups   — lists pyrfor-backup-*.tar.gz files sorted newest first
 */

import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { logger } from '../observability/logger';

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

function isoSafe(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function runSpawn(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const errChunks: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const msg = Buffer.concat(errChunks).toString().trim();
        reject(new Error(`${cmd} exited with code ${code}: ${msg}`));
      }
    });
    proc.on('error', reject);
  });
}

// ── createBackup ───────────────────────────────────────────────────────────

export interface CreateBackupOptions {
  sourceDir?: string;
  outputPath?: string;
}

export async function createBackup(opts: CreateBackupOptions = {}): Promise<BackupResult> {
  const sourceDir = opts.sourceDir ?? path.join(homedir(), '.pyrfor');
  const backupsDir = path.join(sourceDir, 'backups');
  const createdAt = new Date().toISOString();
  // Append a short random suffix so concurrent calls within the same
  // millisecond never collide on the same archive filename.
  const rnd = Math.random().toString(36).slice(2, 7);
  const defaultName = `pyrfor-backup-${isoSafe()}-${rnd}.tar.gz`;
  const outputPath = opts.outputPath ?? path.join(backupsDir, defaultName);

  logger.info('[backup] Creating backup', { sourceDir, outputPath });

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  // Derive the exclude path relative to sourceDir so tar excludes backups/
  const relativeBackups = path.relative(sourceDir, backupsDir);

  await runSpawn('tar', [
    '-czf', outputPath,
    `--exclude=${relativeBackups}`,
    '-C', path.dirname(sourceDir),
    path.basename(sourceDir),
  ]);

  const stat = await fsp.stat(outputPath);

  logger.info('[backup] Backup created', { outputPath, bytes: stat.size });

  return { path: outputPath, bytes: stat.size, createdAt };
}

// ── restoreBackup ──────────────────────────────────────────────────────────

export interface RestoreBackupOptions {
  archivePath: string;
  targetDir?: string;
  force?: boolean;
}

export async function restoreBackup(opts: RestoreBackupOptions): Promise<RestoreResult> {
  const { archivePath, force = false } = opts;
  const targetDir = opts.targetDir ?? path.join(homedir(), '.pyrfor');

  logger.info('[backup] Restoring backup', { archivePath, targetDir, force });

  let backupOfPrevious: string | undefined;

  let targetExists = false;
  try {
    await fsp.access(targetDir);
    targetExists = true;
  } catch {
    // target doesn't exist — fine
  }

  if (targetExists) {
    if (!force) {
      throw new Error(
        `Target directory already exists: ${targetDir}. Use force: true to overwrite.`,
      );
    }
    backupOfPrevious = `${targetDir}.bak-${isoSafe()}`;
    await fsp.rename(targetDir, backupOfPrevious);
    logger.info('[backup] Existing directory moved', { from: targetDir, to: backupOfPrevious });
  }

  await fsp.mkdir(targetDir, { recursive: true });

  // tar extracts the top-level directory from the archive into the parent, so
  // we extract into the parent and let tar recreate the directory.
  await fsp.rm(targetDir, { recursive: true, force: true });

  await runSpawn('tar', [
    '-xzf', archivePath,
    '-C', path.dirname(targetDir),
  ]);

  logger.info('[backup] Restore complete', { restoredTo: targetDir });

  return { restoredTo: targetDir, backupOfPrevious };
}

// ── listBackups ────────────────────────────────────────────────────────────

export interface ListBackupsOptions {
  backupsDir?: string;
}

export async function listBackups(opts: ListBackupsOptions = {}): Promise<BackupEntry[]> {
  const backupsDir = opts.backupsDir ?? path.join(homedir(), '.pyrfor', 'backups');

  let entries: string[];
  try {
    entries = await fsp.readdir(backupsDir);
  } catch {
    return [];
  }

  const matching = entries.filter((f) => /^pyrfor-backup-.*\.tar\.gz$/.test(f));

  const results = await Promise.all(
    matching.map(async (name) => {
      const fullPath = path.join(backupsDir, name);
      const stat = await fsp.stat(fullPath);
      return { name, path: fullPath, bytes: stat.size, mtime: stat.mtime };
    }),
  );

  // Newest first
  results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return results;
}
