/**
 * migrate-sessions — Import legacy daemon/openclaw sessions into ~/.pyrfor/sessions/ format.
 *
 * Legacy candidates:
 *   ~/.openclaw/sessions/*.sqlite | *.db  (SQLite — requires better-sqlite3)
 *   ~/.ceoclaw/sessions/**\/*.json         (older daemon JSON)
 *   ~/.openclaw/memory/*.json             (free-form memory dumps — skipped)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Persisted session shape ────────────────────────────────────────────────

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

// ── Path safety (mirrors session-store.ts logic) ───────────────────────────

function safeSegment(s: string): string {
  return (
    s
      .normalize('NFKC')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 200) || '_'
  );
}

function buildDestPath(rootDir: string, channel: string, userId: string, chatId: string): string {
  return path.join(rootDir, safeSegment(channel), `${safeSegment(userId)}_${safeSegment(chatId)}.json`);
}

// ── Discovery ──────────────────────────────────────────────────────────────

const DEFAULT_ROOTS = [
  path.join(homedir(), '.openclaw', 'sessions'),
  path.join(homedir(), '.ceoclaw', 'sessions'),
  path.join(homedir(), '.openclaw', 'memory'),
];

/** Probe each root directory and return discovered legacy stores. */
export async function discoverLegacyStores(roots?: string[]): Promise<LegacyStore[]> {
  const candidates = roots ?? DEFAULT_ROOTS;
  const stores: LegacyStore[] = [];

  for (const root of candidates) {
    // Check the root exists
    try {
      await fs.access(root);
    } catch {
      continue;
    }

    const isMemoryDir = root.endsWith(path.join('.openclaw', 'memory'));

    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        // Recurse one level for ~/.ceoclaw/sessions/**/*.json
        const subEntries = await fs.readdir(fullPath, { withFileTypes: true }).catch(() => []);
        for (const sub of subEntries) {
          if (sub.isFile()) {
            stores.push(...classifyFile(path.join(fullPath, sub.name), isMemoryDir));
          }
        }
      } else if (entry.isFile()) {
        stores.push(...classifyFile(fullPath, isMemoryDir));
      }
    }
  }

  return stores;
}

function classifyFile(filePath: string, isMemoryDir: boolean): LegacyStore[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.sqlite' || ext === '.db') {
    return [{ type: 'sqlite', filePath, label: path.basename(filePath) }];
  }
  if (ext === '.json') {
    if (isMemoryDir) {
      return [{ type: 'unknown', filePath, label: path.basename(filePath) }];
    }
    return [{ type: 'json', filePath, label: path.basename(filePath) }];
  }
  return [];
}

// ── JSON coercion ──────────────────────────────────────────────────────────

/**
 * Attempt to coerce an arbitrary parsed JSON value into one or more SessionData objects.
 * Returns null if the shape is unrecognisable.
 */
function coerceToSessions(raw: unknown, channel: string, sourceFile: string): SessionData[] | null {
  if (!raw || typeof raw !== 'object') return null;

  // Case 1: already looks like a PersistedSession (has id + messages)
  if (isSessionLike(raw)) {
    return [normaliseSession(raw as Record<string, unknown>, channel, sourceFile)];
  }

  // Case 2: array of {role, content} — treat as a single session's message list
  if (Array.isArray(raw) && raw.length > 0 && isMessageLike(raw[0])) {
    const msgs: PersistedMessage[] = raw.map((m: Record<string, unknown>) => ({
      role: String(m['role'] ?? 'user'),
      content: String(m['content'] ?? ''),
      timestamp: typeof m['timestamp'] === 'string' ? m['timestamp'] : new Date().toISOString(),
    }));
    const base = path.basename(sourceFile, '.json');
    const [userId = 'unknown', chatId = 'unknown'] = base.split('_');
    const now = new Date().toISOString();
    return [
      {
        schemaVersion: 1,
        id: randomUUID(),
        channel,
        userId,
        chatId,
        systemPrompt: '',
        messages: msgs,
        tokenCount: 0,
        maxTokens: 128000,
        metadata: { migratedFrom: sourceFile },
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  // Case 3: array of session-like objects
  if (Array.isArray(raw) && raw.length > 0 && isSessionLike(raw[0])) {
    return raw.map((item: Record<string, unknown>) =>
      normaliseSession(item, channel, sourceFile)
    );
  }

  return null;
}

function isSessionLike(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o['messages']) || typeof o['id'] === 'string';
}

function isMessageLike(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return 'role' in o && 'content' in o;
}

function normaliseSession(
  o: Record<string, unknown>,
  channel: string,
  sourceFile: string
): SessionData {
  const now = new Date().toISOString();
  const rawMsgs = Array.isArray(o['messages']) ? (o['messages'] as unknown[]) : [];

  const messages: PersistedMessage[] = rawMsgs
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && !Array.isArray(m))
    .map((m) => ({
      role: String(m['role'] ?? 'user'),
      content: String(m['content'] ?? ''),
      timestamp:
        typeof m['timestamp'] === 'string' ? m['timestamp'] : now,
    }));

  const base = path.basename(sourceFile, '.json');
  const [defaultUserId = 'unknown', defaultChatId = 'unknown'] = base.split('_');

  return {
    schemaVersion: 1,
    id: typeof o['id'] === 'string' ? o['id'] : randomUUID(),
    channel: typeof o['channel'] === 'string' ? o['channel'] : channel,
    userId: typeof o['userId'] === 'string' ? o['userId'] : defaultUserId,
    chatId: typeof o['chatId'] === 'string' ? o['chatId'] : defaultChatId,
    systemPrompt: typeof o['systemPrompt'] === 'string' ? o['systemPrompt'] : '',
    messages,
    tokenCount: typeof o['tokenCount'] === 'number' ? o['tokenCount'] : 0,
    maxTokens: typeof o['maxTokens'] === 'number' ? o['maxTokens'] : 128000,
    metadata: {
      ...(o['metadata'] && typeof o['metadata'] === 'object' && !Array.isArray(o['metadata'])
        ? (o['metadata'] as Record<string, unknown>)
        : {}),
      migratedFrom: sourceFile,
    },
    createdAt: typeof o['createdAt'] === 'string' ? o['createdAt'] : now,
    updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : now,
  };
}

// ── Migration ──────────────────────────────────────────────────────────────

export async function migrateLegacyStore(
  store: LegacyStore,
  opts: MigrateOptions
): Promise<MigrationReport> {
  const { destRoot, channel = 'imported', dryRun = false, overwrite = false, onProgress } = opts;
  const report: MigrationReport = { imported: 0, skipped: 0, errors: [], files: [] };

  const log = (msg: string) => onProgress?.(msg);

  if (store.type === 'unknown') {
    log(`[skip] ${store.filePath} — memory dump, not session data`);
    report.skipped++;
    return report;
  }

  if (store.type === 'sqlite') {
    return migrateSqliteStore(store, opts, report);
  }

  // JSON store
  let raw: unknown;
  try {
    const text = await fs.readFile(store.filePath, 'utf-8');
    raw = JSON.parse(text);
  } catch (err) {
    report.errors.push({ file: store.filePath, msg: `Parse error: ${String(err)}` });
    return report;
  }

  const sessions = coerceToSessions(raw, channel, store.filePath);

  if (!sessions) {
    log(`[skip] ${store.filePath} — unrecognised shape`);
    report.skipped++;
    return report;
  }

  for (const session of sessions) {
    const destPath = buildDestPath(destRoot, session.channel, session.userId, session.chatId);

    // Check existence
    if (!dryRun && !overwrite) {
      try {
        await fs.access(destPath);
        log(`[skip] ${destPath} — already exists (use --overwrite to replace)`);
        report.skipped++;
        continue;
      } catch {
        // file doesn't exist — proceed
      }
    }

    if (dryRun) {
      log(`[dry-run] would write ${destPath}`);
      report.imported++;
    } else {
      try {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, JSON.stringify(session, null, 2), 'utf-8');
        log(`[import] ${destPath}`);
        report.imported++;
        report.files.push(destPath);
      } catch (err) {
        report.errors.push({ file: destPath, msg: String(err) });
      }
    }
  }

  return report;
}

// ── SQLite (optional) ──────────────────────────────────────────────────────

async function migrateSqliteStore(
  store: LegacyStore,
  opts: MigrateOptions,
  report: MigrationReport
): Promise<MigrationReport> {
  const { destRoot, channel = 'imported', dryRun = false, overwrite = false, onProgress } = opts;
  const log = (msg: string) => onProgress?.(msg);

  // Attempt dynamic import — graceful degradation if not installed
  let Database: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Database = (await import('better-sqlite3' as string)).default;
  } catch {
    log(`[skip] ${store.filePath} — better-sqlite3 not installed`);
    report.skipped++;
    report.errors.push({ file: store.filePath, msg: 'better-sqlite3 not installed' });
    return report;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new (Database as any)(store.filePath, { readonly: true });

    // Attempt common table names
    const tables: Array<{ name: string }> = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all();
    const sessionTable = tables.find((t) =>
      ['sessions', 'session', 'messages'].includes(t.name.toLowerCase())
    );

    if (!sessionTable) {
      log(`[skip] ${store.filePath} — no sessions table found`);
      report.skipped++;
      db.close();
      return report;
    }

    const rows: unknown[] = db.prepare(`SELECT * FROM ${sessionTable.name}`).all();

    for (const row of rows) {
      const sessions = coerceToSessions(row, channel, store.filePath);
      if (!sessions) {
        report.skipped++;
        continue;
      }

      for (const session of sessions) {
        const destPath = buildDestPath(destRoot, session.channel, session.userId, session.chatId);

        if (!dryRun && !overwrite) {
          try {
            await fs.access(destPath);
            report.skipped++;
            continue;
          } catch {
            // proceed
          }
        }

        if (dryRun) {
          log(`[dry-run] would write ${destPath}`);
          report.imported++;
        } else {
          try {
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.writeFile(destPath, JSON.stringify(session, null, 2), 'utf-8');
            log(`[import] ${destPath}`);
            report.imported++;
            report.files.push(destPath);
          } catch (err) {
            report.errors.push({ file: destPath, msg: String(err) });
          }
        }
      }
    }

    db.close();
  } catch (err) {
    report.errors.push({ file: store.filePath, msg: `SQLite error: ${String(err)}` });
  }

  return report;
}
