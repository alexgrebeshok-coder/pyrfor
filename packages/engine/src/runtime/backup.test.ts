// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import { createBackup, restoreBackup, listBackups } from './backup';

// ── check tar availability ─────────────────────────────────────────────────

let tarAvailable = false;
try {
  execSync('which tar', { stdio: 'ignore' });
  tarAvailable = true;
} catch {
  console.warn('[backup.test] tar binary not found — skipping all backup tests');
}

const itIfTar = tarAvailable ? it : it.skip;

// ── helpers ────────────────────────────────────────────────────────────────

async function makeTempDir(prefix: string): Promise<string> {
  const base = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '__backup_test_tmp__',
  );
  await fsp.mkdir(base, { recursive: true });
  return fsp.mkdtemp(path.join(base, prefix));
}

const tmpRoots: string[] = [];

async function tmpDir(prefix: string): Promise<string> {
  const d = await makeTempDir(prefix);
  tmpRoots.push(d);
  return d;
}

afterEach(async () => {
  for (const d of tmpRoots.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => undefined);
  }
  // clean up the shared temp base if empty
  const base = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '__backup_test_tmp__',
  );
  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined);
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('createBackup', () => {
  itIfTar('creates a non-empty .tar.gz at the expected path', async () => {
    const sourceDir = await tmpDir('src-');
    const outDir = await tmpDir('out-');

    // Put some content in sourceDir
    await fsp.writeFile(path.join(sourceDir, 'runtime.json'), JSON.stringify({ v: 1 }));
    await fsp.mkdir(path.join(sourceDir, 'sessions'), { recursive: true });
    await fsp.writeFile(path.join(sourceDir, 'sessions', 'foo.json'), '{}');

    const outputPath = path.join(outDir, 'test-backup.tar.gz');
    const result = await createBackup({ sourceDir, outputPath });

    expect(result.path).toBe(outputPath);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.createdAt).toBeTruthy();

    const stat = await fsp.stat(outputPath);
    expect(stat.size).toBe(result.bytes);
  });

  itIfTar('excludes backups/ directory to avoid recursion', async () => {
    const sourceDir = await tmpDir('src-');
    const backupsDir = path.join(sourceDir, 'backups');
    await fsp.mkdir(backupsDir, { recursive: true });
    await fsp.writeFile(path.join(backupsDir, 'old.tar.gz'), 'fake');
    await fsp.writeFile(path.join(sourceDir, 'runtime.json'), '{}');

    const outDir = await tmpDir('out-');
    const outputPath = path.join(outDir, 'backup.tar.gz');
    await createBackup({ sourceDir, outputPath });

    // Extract into a verify dir and check backups/ is absent
    const verifyDir = await tmpDir('verify-');
    const { execSync: exec } = await import('child_process');
    exec(`tar -xzf "${outputPath}" -C "${verifyDir}"`);

    const srcName = path.basename(sourceDir);
    const backupsInArchive = path.join(verifyDir, srcName, 'backups');
    let exists = false;
    try {
      await fsp.access(backupsInArchive);
      exists = true;
    } catch {
      // expected
    }
    expect(exists).toBe(false);
  });
});

describe('restoreBackup', () => {
  itIfTar('round-trips: backup → wipe → restore → file contents identical', async () => {
    const sourceDir = await tmpDir('src-');
    const outDir = await tmpDir('out-');

    const fileContent = JSON.stringify({ hello: 'world', ts: Date.now() });
    await fsp.writeFile(path.join(sourceDir, 'runtime.json'), fileContent);
    await fsp.mkdir(path.join(sourceDir, 'sessions', 'tg'), { recursive: true });
    await fsp.writeFile(path.join(sourceDir, 'sessions', 'tg', 'u1_c1.json'), '{"v":42}');

    const outputPath = path.join(outDir, 'backup.tar.gz');
    await createBackup({ sourceDir, outputPath });

    // Wipe source
    await fsp.rm(sourceDir, { recursive: true, force: true });

    const result = await restoreBackup({
      archivePath: outputPath,
      targetDir: sourceDir,
    });

    expect(result.restoredTo).toBe(sourceDir);
    expect(result.backupOfPrevious).toBeUndefined();

    const restored = await fsp.readFile(path.join(sourceDir, 'runtime.json'), 'utf8');
    expect(restored).toBe(fileContent);

    const restoredSession = await fsp.readFile(
      path.join(sourceDir, 'sessions', 'tg', 'u1_c1.json'),
      'utf8',
    );
    expect(restoredSession).toBe('{"v":42}');
  });

  itIfTar('throws without force when targetDir already exists', async () => {
    const sourceDir = await tmpDir('src-');
    const outDir = await tmpDir('out-');

    await fsp.writeFile(path.join(sourceDir, 'runtime.json'), '{}');
    const outputPath = path.join(outDir, 'backup.tar.gz');
    await createBackup({ sourceDir, outputPath });

    await expect(
      restoreBackup({ archivePath: outputPath, targetDir: sourceDir }),
    ).rejects.toThrow(/force: true/);
  });

  itIfTar('with force: renames existing dir to .bak and restores', async () => {
    const sourceDir = await tmpDir('src-');
    const outDir = await tmpDir('out-');

    await fsp.writeFile(path.join(sourceDir, 'runtime.json'), '{"original":true}');
    const outputPath = path.join(outDir, 'backup.tar.gz');
    await createBackup({ sourceDir, outputPath });

    // Overwrite with different content
    await fsp.writeFile(path.join(sourceDir, 'runtime.json'), '{"overwritten":true}');

    const result = await restoreBackup({
      archivePath: outputPath,
      targetDir: sourceDir,
      force: true,
    });

    expect(result.backupOfPrevious).toBeDefined();
    // The .bak dir should exist
    const bakStat = await fsp.stat(result.backupOfPrevious!);
    expect(bakStat.isDirectory()).toBe(true);

    // Restored content should be the original backup
    const restored = await fsp.readFile(path.join(sourceDir, 'runtime.json'), 'utf8');
    expect(restored).toBe('{"original":true}');
  });
});

describe('listBackups', () => {
  itIfTar('returns sorted list with metadata', async () => {
    const backupsDir = await tmpDir('bkp-');

    // Write fake backup files
    for (const name of ['pyrfor-backup-2024-01-01.tar.gz', 'pyrfor-backup-2024-06-15.tar.gz']) {
      await fsp.writeFile(path.join(backupsDir, name), 'fake content');
      // small delay to ensure different mtimes
      await new Promise((r) => setTimeout(r, 10));
    }

    const entries = await listBackups({ backupsDir });

    expect(entries).toHaveLength(2);
    // Newest first (june > january)
    expect(entries[0].name).toBe('pyrfor-backup-2024-06-15.tar.gz');
    expect(entries[1].name).toBe('pyrfor-backup-2024-01-01.tar.gz');
    expect(entries[0].bytes).toBeGreaterThan(0);
    expect(entries[0].mtime).toBeInstanceOf(Date);
  });

  itIfTar('ignores non-matching files', async () => {
    const backupsDir = await tmpDir('bkp-');
    await fsp.writeFile(path.join(backupsDir, 'unrelated.tar.gz'), 'x');
    await fsp.writeFile(path.join(backupsDir, 'pyrfor-backup-2024-01-01.tar.gz'), 'y');

    const entries = await listBackups({ backupsDir });
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('pyrfor-backup-2024-01-01.tar.gz');
  });

  it('returns empty array when backupsDir does not exist', async () => {
    const entries = await listBackups({ backupsDir: '/nonexistent/path/that/does/not/exist' });
    expect(entries).toEqual([]);
  });

  it('returns empty array when backupsDir exists but contains no matching files', async () => {
    const backupsDir = await tmpDir('bkp-empty-');
    // Dir exists but is empty
    const entries = await listBackups({ backupsDir });
    expect(entries).toEqual([]);
  });
});

// ── additional coverage ────────────────────────────────────────────────────

describe('createBackup — default naming', () => {
  itIfTar('default outputPath contains a timestamp-like segment in filename', async () => {
    const sourceDir = await tmpDir('src-ts-');
    await fsp.writeFile(path.join(sourceDir, 'data.json'), '{"ok":1}');

    // Use default output path (inside sourceDir/backups/)
    const result = await createBackup({ sourceDir });
    tmpRoots.push(result.path); // ensure cleanup

    expect(path.basename(result.path)).toMatch(/^pyrfor-backup-.*\.tar\.gz$/);
    // Timestamp pattern: digits and dashes from ISO 8601 followed by random suffix
    expect(path.basename(result.path)).toMatch(/pyrfor-backup-\d{4}-\d{2}-\d{2}T/);
    expect(result.bytes).toBeGreaterThan(0);
  });

  itIfTar('empty source dir produces a valid (extractable) archive', async () => {
    const sourceDir = await tmpDir('src-empty-');
    // No files — directory is completely empty

    const outDir = await tmpDir('out-empty-');
    const outputPath = path.join(outDir, 'empty-backup.tar.gz');
    const result = await createBackup({ sourceDir, outputPath });

    expect(result.bytes).toBeGreaterThan(0);

    // Must be extractable without error
    const verifyDir = await tmpDir('verify-empty-');
    const { execSync: exec } = await import('child_process');
    expect(() => exec(`tar -xzf "${outputPath}" -C "${verifyDir}"`)).not.toThrow();
  });

  itIfTar('concurrent calls produce distinct archive paths', async () => {
    const sourceDir = await tmpDir('src-concurrent-');
    await fsp.writeFile(path.join(sourceDir, 'x.json'), '1');

    // Fire two createBackup calls with default naming simultaneously
    const [r1, r2] = await Promise.all([
      createBackup({ sourceDir }),
      createBackup({ sourceDir }),
    ]);

    expect(r1.path).not.toBe(r2.path);
    // Both archives must actually exist
    const s1 = await fsp.stat(r1.path);
    const s2 = await fsp.stat(r2.path);
    expect(s1.size).toBeGreaterThan(0);
    expect(s2.size).toBeGreaterThan(0);
  });
});

describe('restoreBackup — error paths', () => {
  itIfTar('rejects with an error when archive does not exist', async () => {
    const targetDir = await tmpDir('tgt-noarch-');
    await fsp.rm(targetDir, { recursive: true, force: true }); // ensure it doesn't exist

    await expect(
      restoreBackup({
        archivePath: '/nonexistent/path/archive-does-not-exist.tar.gz',
        targetDir,
      }),
    ).rejects.toThrow();
  });
});

describe('spawn failure', () => {
  itIfTar('runSpawn rejection propagates when tar binary is replaced with bad path', async () => {
    // We exercise the error path by pointing createBackup at a non-existent tar
    // binary. Since we cannot easily mock spawn directly, we verify that
    // passing a bad command surfaces an error with meaningful context.
    // createBackup calls tar internally; we cannot override the binary, so we
    // test restoreBackup on a corrupt archive to trigger tar exit-code != 0.
    const sourceDir = await tmpDir('src-corrupt-');
    const outDir = await tmpDir('out-corrupt-');
    const corruptArchive = path.join(outDir, 'corrupt.tar.gz');
    await fsp.writeFile(corruptArchive, 'this is not a valid tar.gz file');

    const targetDir = await tmpDir('tgt-corrupt-');
    await fsp.rm(targetDir, { recursive: true, force: true });

    await expect(
      restoreBackup({ archivePath: corruptArchive, targetDir }),
    ).rejects.toThrow(/tar exited with code/);
  });
});
