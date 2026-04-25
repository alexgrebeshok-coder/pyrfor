import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { appendFile, rename, unlink } from 'node:fs/promises';

export interface AuditEntry {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  target?: string;
  data?: Record<string, unknown>;
  prevHash: string;
  hash: string;
  signature?: string;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  target?: string;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
}

export interface AuditLogHandle {
  append(entry: { actor: string; action: string; target?: string; data?: Record<string, unknown> }): Promise<AuditEntry>;
  read(query?: AuditQuery): Promise<AuditEntry[]>;
  verify(): Promise<{ ok: boolean; brokenAt?: number; reason?: string }>;
  getStats(): { totalEntries: number; fileBytes: number; rotations: number };
  flush(): Promise<void>;
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

function parseLines(content: string): AuditEntry[] {
  return content
    .split('\n')
    .filter(line => line.trim().length > 0)
    .flatMap(line => {
      try { return [JSON.parse(line) as AuditEntry]; }
      catch { return []; }
    });
}

function readFileEntries(p: string): AuditEntry[] {
  if (!existsSync(p)) return [];
  try {
    return parseLines(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

export function createAuditLog(opts: {
  filePath: string;
  hmacKey?: string | Buffer;
  maxFileBytes?: number;
  maxFiles?: number;
  clock?: () => number;
}): AuditLogHandle {
  const {
    filePath,
    hmacKey,
    maxFileBytes = 0,
    maxFiles = 3,
    clock = () => Date.now(),
  } = opts;

  let seq = 0;
  let prevHash = '0'.repeat(64);
  let totalEntries = 0;
  let fileBytes = 0;
  let rotations = 0;

  // Restore state from existing files on disk
  {
    const files: string[] = [];
    for (let i = maxFiles; i >= 1; i--) {
      files.push(`${filePath}.${i}`);
    }
    files.push(filePath);

    for (const f of files) {
      const entries = readFileEntries(f);
      for (const e of entries) {
        totalEntries++;
        if (e.seq > seq) {
          seq = e.seq;
          prevHash = e.hash;
        }
      }
    }

    if (existsSync(filePath)) {
      try { fileBytes = statSync(filePath).size; } catch { fileBytes = 0; }
    }
  }

  let mutex: Promise<void> = Promise.resolve();

  function lock<T>(fn: () => Promise<T>): Promise<T> {
    const result = mutex.then(fn);
    mutex = result.then(() => {}, () => {}) as Promise<void>;
    return result;
  }

  async function maybeRotate(): Promise<void> {
    if (!maxFileBytes || fileBytes < maxFileBytes) return;
    if (maxFiles <= 0) return;

    const oldest = `${filePath}.${maxFiles}`;
    if (existsSync(oldest)) {
      await unlink(oldest);
    }

    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = `${filePath}.${i}`;
      const to = `${filePath}.${i + 1}`;
      if (existsSync(from)) {
        await rename(from, to);
      }
    }

    if (existsSync(filePath)) {
      await rename(filePath, `${filePath}.1`);
    }

    fileBytes = 0;
    rotations++;
  }

  async function appendEntry(input: {
    actor: string;
    action: string;
    target?: string;
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    const currentSeq = seq + 1;
    const ts = new Date(clock()).toISOString();
    const { actor, action, target, data } = input;
    const currentPrevHash = prevHash;

    const hashInput = JSON.stringify({ seq: currentSeq, ts, actor, action, target, data, prevHash: currentPrevHash });
    const hash = sha256(hashInput);

    const entry: AuditEntry = { seq: currentSeq, ts, actor, action, prevHash: currentPrevHash, hash };
    if (target !== undefined) entry.target = target;
    if (data !== undefined) entry.data = data;
    if (hmacKey) entry.signature = hmacSha256(hmacKey, hash);

    const line = JSON.stringify(entry) + '\n';
    await appendFile(filePath, line, 'utf8');

    seq = currentSeq;
    prevHash = hash;
    totalEntries++;
    fileBytes += Buffer.byteLength(line, 'utf8');

    await maybeRotate();

    return entry;
  }

  function allLogFiles(): string[] {
    const files: string[] = [];
    for (let i = maxFiles; i >= 1; i--) {
      const f = `${filePath}.${i}`;
      if (existsSync(f)) files.push(f);
    }
    files.push(filePath);
    return files;
  }

  return {
    append(input) {
      return lock(() => appendEntry(input));
    },

    async read(query?: AuditQuery): Promise<AuditEntry[]> {
      const all: AuditEntry[] = [];
      for (const f of allLogFiles()) {
        all.push(...readFileEntries(f));
      }
      all.sort((a, b) => a.seq - b.seq);

      let results = all;
      if (query) {
        if (query.actor !== undefined) results = results.filter(e => e.actor === query.actor);
        if (query.action !== undefined) results = results.filter(e => e.action === query.action);
        if (query.target !== undefined) results = results.filter(e => e.target === query.target);
        if (query.sinceMs !== undefined) results = results.filter(e => new Date(e.ts).getTime() >= query.sinceMs!);
        if (query.untilMs !== undefined) results = results.filter(e => new Date(e.ts).getTime() <= query.untilMs!);
        if (query.limit !== undefined) results = results.slice(0, query.limit);
      }
      return results;
    },

    async verify(): Promise<{ ok: boolean; brokenAt?: number; reason?: string }> {
      const all: AuditEntry[] = [];
      for (const f of allLogFiles()) {
        all.push(...readFileEntries(f));
      }
      if (all.length === 0) return { ok: true };
      all.sort((a, b) => a.seq - b.seq);

      let expectedPrevHash = '0'.repeat(64);

      for (const entry of all) {
        const { seq: eSeq, ts, actor, action, target, data, prevHash: ePrevHash, hash, signature } = entry;

        const hashInput = JSON.stringify({ seq: eSeq, ts, actor, action, target, data, prevHash: ePrevHash });
        const derivedHash = sha256(hashInput);

        if (hash !== derivedHash) {
          return { ok: false, brokenAt: eSeq, reason: `hash mismatch at seq ${eSeq}` };
        }

        if (ePrevHash !== expectedPrevHash) {
          return { ok: false, brokenAt: eSeq, reason: `prevHash mismatch at seq ${eSeq}` };
        }

        if (hmacKey && signature !== undefined) {
          const expectedSig = hmacSha256(hmacKey, hash);
          if (signature !== expectedSig) {
            return { ok: false, brokenAt: eSeq, reason: `signature mismatch at seq ${eSeq}` };
          }
        }

        expectedPrevHash = hash;
      }

      return { ok: true };
    },

    getStats() {
      return { totalEntries, fileBytes, rotations };
    },

    flush() {
      return mutex;
    },
  };
}
