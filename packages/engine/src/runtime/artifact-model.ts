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

import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, open, rename, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import logger from '../observability/logger';

// ====== Public types =========================================================

export type ArtifactKind =
  | 'diff'
  | 'patch'
  | 'log'
  | 'test_result'
  | 'screenshot'
  | 'browser_trace'
  | 'plan'
  | 'summary'
  | 'risk_report'
  | 'pm_update'
  | 'release_note'
  | 'delivery_evidence'
  | 'delivery_plan'
  | 'delivery_apply'
  | 'verifier_waiver'
  | 'context_pack';

const ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  'diff',
  'patch',
  'log',
  'test_result',
  'screenshot',
  'browser_trace',
  'plan',
  'summary',
  'risk_report',
  'pm_update',
  'release_note',
  'delivery_evidence',
  'delivery_plan',
  'delivery_apply',
  'verifier_waiver',
  'context_pack',
]);

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

// ====== Pure helpers =========================================================

/** Compute hex-encoded SHA-256 digest of a buffer. */
export function computeSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Serialise an ArtifactRef to a single JSON line (no trailing newline). */
export function serializeRef(ref: ArtifactRef): string {
  return JSON.stringify(ref);
}

/**
 * Parse a single JSON line back into an ArtifactRef.
 * Returns null if the line is empty, malformed, or missing required fields.
 */
export function deserializeRef(line: string): ArtifactRef | null {
  try {
    const parsed = JSON.parse(line) as Partial<ArtifactRef>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.kind !== 'string' ||
      typeof parsed.uri !== 'string' ||
      typeof parsed.createdAt !== 'string'
    ) {
      return null;
    }
    return parsed as ArtifactRef;
  } catch {
    return null;
  }
}

// ====== ArtifactStore ========================================================

export class ArtifactStore {
  private readonly rootDir: string;
  private readonly indexPath: string;

  constructor(opts: ArtifactStoreOptions) {
    this.rootDir = opts.rootDir;
    this.indexPath = path.join(this.rootDir, '_index.jsonl');
  }

  // ─── Path resolution ──────────────────────────────────────────────────────

  /** Return the absolute filesystem path for a given ArtifactRef. */
  resolvePath(ref: ArtifactRef): string {
    const bucket = ref.runId ?? '_global';
    return path.join(this.rootDir, bucket, ref.kind, ref.id);
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  /**
   * Write content to disk, compute sha256, append ref to the index, and return
   * the resulting ArtifactRef.
   */
  async write(
    kind: ArtifactKind,
    content: string | Buffer,
    opts?: {
      runId?: string;
      ext?: string;
      meta?: Record<string, unknown>;
    },
  ): Promise<ArtifactRef> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const id = randomUUID() + (opts?.ext ?? '');
    const sha256 = computeSha256(buf);
    const createdAt = new Date().toISOString();

    const bucket = opts?.runId ?? '_global';
    const dirPath = path.join(this.rootDir, bucket, kind);
    await mkdir(dirPath, { recursive: true });
    const artifactPath = path.join(dirPath, id);
    const tmpPath = path.join(dirPath, `.${id}.${randomUUID()}.tmp`);
    await writeFile(tmpPath, buf);
    await rename(tmpPath, artifactPath);

    const ref: ArtifactRef = {
      id,
      kind,
      uri: artifactPath,
      sha256,
      bytes: buf.length,
      createdAt,
      ...(opts?.runId !== undefined ? { runId: opts.runId } : {}),
      ...(opts?.meta !== undefined ? { meta: opts.meta } : {}),
    };

    await this.appendIndex(ref);

    return ref;
  }

  /** Convenience wrapper: serialises value as JSON and sets ext to '.json'. */
  async writeJSON(
    kind: ArtifactKind,
    value: unknown,
    opts?: { runId?: string; meta?: Record<string, unknown> },
  ): Promise<ArtifactRef> {
    return this.write(kind, JSON.stringify(value), { ...opts, ext: '.json' });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /** Read the raw bytes of an artifact. */
  async read(ref: ArtifactRef): Promise<Buffer> {
    return readFile(this.resolvePath(ref));
  }

  /** Read raw bytes and verify they still match the reviewed sha256 digest. */
  async readVerified(ref: ArtifactRef, expectedSha256: string): Promise<Buffer> {
    const buf = await this.read(ref);
    const actualSha256 = computeSha256(buf);
    if (actualSha256 !== expectedSha256) {
      throw new Error('ArtifactStore: artifact sha256 mismatch');
    }
    return buf;
  }

  /** Read artifact content as a UTF-8 string. */
  async readText(ref: ArtifactRef): Promise<string> {
    return (await this.read(ref)).toString('utf-8');
  }

  /** Deserialise a JSON artifact into a typed value. */
  async readJSON<T = unknown>(ref: ArtifactRef): Promise<T> {
    return JSON.parse(await this.readText(ref)) as T;
  }

  /** Deserialise JSON only after verifying current artifact bytes. */
  async readJSONVerified<T = unknown>(ref: ArtifactRef, expectedSha256: string): Promise<T> {
    return JSON.parse((await this.readVerified(ref, expectedSha256)).toString('utf-8')) as T;
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  /**
   * List all artifacts by reading the _index.jsonl file.
   * Corrupt lines are warned and skipped; valid entries are always returned.
   * Optionally filter by runId and/or kind.
   */
  async list(opts?: { runId?: string; kind?: ArtifactKind }): Promise<ArtifactRef[]> {
    const refs = await this.repairIndex();

    let results = refs;
    if (opts?.runId !== undefined) {
      results = results.filter(r => r.runId === opts.runId);
    }
    if (opts?.kind !== undefined) {
      results = results.filter(r => r.kind === opts.kind);
    }
    return results;
  }

  async repairIndex(): Promise<ArtifactRef[]> {
    const indexed = await this.readIndexRefs();
    const present: ArtifactRef[] = [];
    const seen = new Set<string>();
    for (const ref of indexed) {
      try {
        await stat(this.resolvePath(ref));
        present.push(ref);
        seen.add(`${ref.runId ?? '_global'}/${ref.kind}/${ref.id}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        logger.warn('ArtifactStore: indexed artifact missing on disk', { id: ref.id, runId: ref.runId, kind: ref.kind });
      }
    }

    const recovered: ArtifactRef[] = [];
    try {
      const buckets = await readdir(this.rootDir, { withFileTypes: true });
      for (const bucket of buckets) {
        if (!bucket.isDirectory()) continue;
        const bucketName = bucket.name;
        const bucketPath = path.join(this.rootDir, bucketName);
        const kinds = await readdir(bucketPath, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') return [];
          throw err;
        });
        for (const kindDir of kinds) {
          if (!kindDir.isDirectory() || !ARTIFACT_KINDS.has(kindDir.name)) continue;
          const kind = kindDir.name as ArtifactKind;
          const kindPath = path.join(bucketPath, kind);
          const files = await readdir(kindPath, { withFileTypes: true });
          for (const file of files) {
            if (!file.isFile() || file.name.endsWith('.tmp')) continue;
            const key = `${bucketName}/${kind}/${file.name}`;
            if (seen.has(key)) continue;
            const uri = path.join(kindPath, file.name);
            const buf = await readFile(uri);
            const fileStat = await stat(uri);
            const ref: ArtifactRef = {
              id: file.name,
              kind,
              uri,
              sha256: computeSha256(buf),
              bytes: buf.length,
              createdAt: fileStat.birthtime.toISOString(),
              ...(bucketName !== '_global' ? { runId: bucketName } : {}),
              meta: { recovered: true },
            };
            recovered.push(ref);
            present.push(ref);
            seen.add(key);
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    for (const ref of recovered) {
      await this.appendIndex(ref);
    }
    return present;
  }

  private async readIndexRefs(): Promise<ArtifactRef[]> {
    const refs: ArtifactRef[] = [];
    try {
      const stream = createReadStream(this.indexPath);
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const ref = deserializeRef(trimmed);
        if (ref === null) {
          logger.warn('ArtifactStore: corrupt index line skipped', { line: trimmed });
          continue;
        }
        refs.push(ref);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // Index does not yet exist — return empty list
    }
    return refs;
  }

  private async appendIndex(ref: ArtifactRef): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const index = await open(this.indexPath, 'a');
    try {
      await index.write(serializeRef(ref) + '\n');
      await index.datasync();
    } finally {
      await index.close();
    }
  }

  // ─── Remove ───────────────────────────────────────────────────────────────

  /**
   * Delete the artifact file.
   * Returns true if the file existed and was removed, false if it was already
   * absent.  Note: the index entry is retained (tombstone behaviour).
   */
  async remove(ref: ArtifactRef): Promise<boolean> {
    try {
      await unlink(this.resolvePath(ref));
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}
