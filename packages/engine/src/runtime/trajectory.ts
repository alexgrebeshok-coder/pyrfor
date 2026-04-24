/**
 * trajectory.ts — Pyrfor self-improvement trajectory recorder.
 *
 * Records every pipeline run (tool calls, tokens, answer) as a JSONL line so
 * future phases (pattern miner, auto-skill synthesis, fine-tune export) can
 * learn from real usage.
 */

import { promises as fsp, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline';
import crypto from 'crypto';

// ── Public types ───────────────────────────────────────────────────────────

export interface ToolCallTrace {
  name: string;
  args: unknown;
  result: unknown;
  success: boolean;
  latencyMs: number;
  errorMessage?: string;
  timestamp: string; // ISO
}

export interface TrajectoryRecord {
  id: string; // ULID-like
  sessionId: string;
  channel: string; // 'telegram' | 'cli' | 'gateway' | 'cron'
  userId?: string;
  chatId?: string;
  userInput: string;
  toolCalls: ToolCallTrace[];
  finalAnswer: string;
  success: boolean; // true if pipeline produced final text answer
  abortReason?: 'aborted' | 'timeout' | 'iter-limit' | 'error';
  iterations: number;
  tokensUsed: { prompt: number; completion: number; total: number };
  costUsd?: number;
  provider?: string;
  model?: string;
  startedAt: string; // ISO
  completedAt: string; // ISO
  durationMs: number;
  private: boolean; // skip from export when true
  metadata?: Record<string, unknown>;
}

export interface TrajectoryRecorderOptions {
  baseDir: string; // default: ~/.pyrfor/trajectories
  enabled: boolean; // default: true
  rotateBy: 'day' | 'week'; // default: 'day'
  maxFileSizeMb?: number; // optional rotation by size
  retainDays?: number; // optional auto-delete threshold
}

export interface TrajectoryBuilder {
  recordToolCall(call: ToolCallTrace): void;
  setProvider(provider: string, model: string): void;
  addTokens(p: { prompt?: number; completion?: number }): void;
  /** Mark success and finalise. Writes one JSONL line atomically. */
  finish(p: {
    finalAnswer: string;
    success?: boolean;
    abortReason?: TrajectoryRecord['abortReason'];
    costUsd?: number;
    iterations?: number;
  }): Promise<TrajectoryRecord>;
  /** Discard without writing (e.g. tests, opt-out). */
  cancel(): void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + crypto.randomBytes(10).toString('hex');
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function isoWeekLabel(d: Date): string {
  const date = new Date(d.getTime());
  date.setUTCHours(0, 0, 0, 0);
  // ISO week: Thursday of the current week determines the year
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((date.getTime() - jan4.getTime()) / 86_400_000 -
        3 +
        ((jan4.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${year}-${String(weekNum).padStart(2, '0')}`;
}

function fileSuffix(d: Date, rotateBy: 'day' | 'week'): string {
  return rotateBy === 'day' ? formatDate(d) : isoWeekLabel(d);
}

// ── Per-path mutex ─────────────────────────────────────────────────────────

const mutexMap = new Map<string, Promise<void>>();

async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexMap.get(key) ?? Promise.resolve();
  let resolveMine!: () => void;
  const mine = new Promise<void>((res) => {
    resolveMine = res;
  });
  mutexMap.set(key, mine);
  await prev;
  try {
    return await fn();
  } finally {
    resolveMine();
    if (mutexMap.get(key) === mine) mutexMap.delete(key);
  }
}

// ── TrajectoryRecorder ─────────────────────────────────────────────────────

export class TrajectoryRecorder {
  private readonly opts: TrajectoryRecorderOptions;
  private _activeCount = 0;

  constructor(opts?: Partial<TrajectoryRecorderOptions>) {
    this.opts = {
      baseDir: path.join(os.homedir(), '.pyrfor', 'trajectories'),
      enabled: true,
      rotateBy: 'day',
      ...opts,
    };
  }

  /** Currently-active builders count (for tests / observability). */
  activeCount(): number {
    return this._activeCount;
  }

  /** Begin recording a pipeline run. Returns a builder. */
  begin(input: {
    sessionId: string;
    channel: string;
    userId?: string;
    chatId?: string;
    userInput: string;
    private?: boolean;
    metadata?: Record<string, unknown>;
  }): TrajectoryBuilder {
    if (!this.opts.enabled) return noopBuilder();

    const startedAt = new Date().toISOString();
    const id = generateId();
    const toolCalls: ToolCallTrace[] = [];
    let provider: string | undefined;
    let model: string | undefined;
    let tokensUsed = { prompt: 0, completion: 0, total: 0 };
    let finished = false;
    let cancelled = false;

    this._activeCount++;
    const recorder = this;

    return {
      recordToolCall(call) {
        if (!finished && !cancelled) toolCalls.push(call);
      },
      setProvider(p, m) {
        provider = p;
        model = m;
      },
      addTokens({ prompt = 0, completion = 0 }) {
        tokensUsed = {
          prompt: tokensUsed.prompt + prompt,
          completion: tokensUsed.completion + completion,
          total: tokensUsed.total + prompt + completion,
        };
      },
      async finish({ finalAnswer, success = true, abortReason, costUsd, iterations = 0 }) {
        if (finished || cancelled) {
          throw new Error('TrajectoryBuilder already finished or cancelled');
        }
        finished = true;
        recorder._activeCount--;

        const completedAt = new Date().toISOString();
        const record: TrajectoryRecord = {
          id,
          sessionId: input.sessionId,
          channel: input.channel,
          userId: input.userId,
          chatId: input.chatId,
          userInput: input.userInput,
          toolCalls,
          finalAnswer,
          success,
          abortReason,
          iterations,
          tokensUsed,
          costUsd,
          provider,
          model,
          startedAt,
          completedAt,
          durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
          private: input.private ?? false,
          metadata: input.metadata,
        };

        await recorder._writeRecord(record);
        return record;
      },
      cancel() {
        if (!finished && !cancelled) {
          cancelled = true;
          recorder._activeCount--;
        }
      },
    };
  }

  private async _writeRecord(record: TrajectoryRecord): Promise<void> {
    const dir = this.opts.baseDir;
    await fsp.mkdir(dir, { recursive: true });

    const suffix = fileSuffix(new Date(record.startedAt), this.opts.rotateBy);
    const baseKey = path.join(dir, `trajectories-${suffix}`);
    const line = JSON.stringify(record) + '\n';

    // Acquire mutex on base key so size check + append are atomic per process
    await withMutex(baseKey, async () => {
      let filePath: string;
      if (this.opts.maxFileSizeMb !== undefined) {
        filePath = await this._resolveRotatedPath(dir, suffix, this.opts.maxFileSizeMb);
      } else {
        filePath = `${baseKey}.jsonl`;
      }
      await fsp.appendFile(filePath, line, 'utf8');
    });
  }

  private async _resolveRotatedPath(
    dir: string,
    suffix: string,
    maxMb: number,
  ): Promise<string> {
    const maxBytes = maxMb * 1024 * 1024;
    let n = 0;
    for (;;) {
      const candidate =
        n === 0
          ? path.join(dir, `trajectories-${suffix}.jsonl`)
          : path.join(dir, `trajectories-${suffix}-${n}.jsonl`);
      try {
        const stat = await fsp.stat(candidate);
        if (stat.size < maxBytes) return candidate;
        n++;
      } catch {
        return candidate; // file doesn't exist yet
      }
    }
  }

  /** Read all trajectories matching predicates (date range, channel, success). */
  async query(filter?: {
    since?: Date;
    until?: Date;
    channel?: string;
    successOnly?: boolean;
    limit?: number;
  }): Promise<TrajectoryRecord[]> {
    const dir = this.opts.baseDir;
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      return [];
    }

    files = files
      .filter((f) => f.startsWith('trajectories-') && f.endsWith('.jsonl'))
      .sort();

    const results: TrajectoryRecord[] = [];
    const limit = filter?.limit;

    for (const file of files) {
      if (limit !== undefined && results.length >= limit) break;
      const fileRecords = await this._readFile(path.join(dir, file));
      for (const record of fileRecords) {
        if (limit !== undefined && results.length >= limit) break;
        if (filter?.since && new Date(record.startedAt) < filter.since) continue;
        if (filter?.until && new Date(record.startedAt) > filter.until) continue;
        if (filter?.channel && record.channel !== filter.channel) continue;
        if (filter?.successOnly && !record.success) continue;
        results.push(record);
      }
    }

    return results;
  }

  private async _readFile(filePath: string): Promise<TrajectoryRecord[]> {
    const records: TrajectoryRecord[] = [];
    let stream: ReturnType<typeof createReadStream> | undefined;
    try {
      stream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      await new Promise<void>((resolve, reject) => {
        rl.on('line', (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            records.push(JSON.parse(trimmed) as TrajectoryRecord);
          } catch {
            // skip malformed lines
          }
        });
        rl.on('close', resolve);
        rl.on('error', reject);
        stream!.on('error', reject);
      });
    } catch {
      // file vanished or is unreadable — return empty
    }
    return records;
  }

  /**
   * Stream JSONL → ShareGPT-formatted JSONL for fine-tuning.
   * Excludes private:true and success:false records.
   */
  async exportShareGpt(opts: {
    since?: Date;
    until?: Date;
    outPath: string;
    includePrivate?: false;
  }): Promise<{ exported: number; skipped: number }> {
    const records = await this.query({ since: opts.since, until: opts.until });

    const outDir = path.dirname(opts.outPath);
    await fsp.mkdir(outDir, { recursive: true });

    const writer = createWriteStream(opts.outPath, { flags: 'w', encoding: 'utf8' });
    let exported = 0;
    let skipped = 0;

    await new Promise<void>((resolve, reject) => {
      writer.on('error', reject);
      writer.on('finish', resolve);

      for (const record of records) {
        if (record.private || !record.success) {
          skipped++;
          continue;
        }

        const conversations: Array<{ from: string; value: string }> = [
          { from: 'human', value: record.userInput },
        ];

        if (record.toolCalls.length > 0) {
          conversations.push({
            from: 'tool_calls',
            value: JSON.stringify(record.toolCalls),
          });
        }

        conversations.push({ from: 'gpt', value: record.finalAnswer });

        writer.write(JSON.stringify({ conversations }) + '\n');
        exported++;
      }

      writer.end();
    });

    return { exported, skipped };
  }

  /** Delete trajectory files older than retainDays. */
  async pruneOld(retainDays: number): Promise<{ deleted: number }> {
    const dir = this.opts.baseDir;
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      return { deleted: 0 };
    }

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retainDays);
    cutoff.setUTCHours(0, 0, 0, 0);

    let deleted = 0;
    for (const file of files) {
      if (!file.startsWith('trajectories-') || !file.endsWith('.jsonl')) continue;

      const fileDate = parseDateFromFilename(file);
      if (fileDate !== null && fileDate < cutoff) {
        try {
          await fsp.unlink(path.join(dir, file));
          deleted++;
        } catch {
          // file already gone
        }
      }
    }
    return { deleted };
  }
}

// ── Filename date parsing ──────────────────────────────────────────────────

function parseDateFromFilename(filename: string): Date | null {
  // Daily: trajectories-YYYY-MM-DD.jsonl or trajectories-YYYY-MM-DD-N.jsonl
  const daily = filename.match(/^trajectories-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.jsonl$/);
  if (daily) return new Date(daily[1] + 'T00:00:00Z');

  // Weekly: trajectories-YYYY-WW.jsonl or trajectories-YYYY-WW-N.jsonl
  const weekly = filename.match(/^trajectories-(\d{4})-(\d{2})(?:-\d+)?\.jsonl$/);
  if (weekly) {
    const year = parseInt(weekly[1], 10);
    const week = parseInt(weekly[2], 10);
    // ISO week 1 contains Jan 4
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = (jan4.getUTCDay() + 6) % 7; // 0=Mon
    const weekStart = new Date(jan4.getTime() - dayOfWeek * 86_400_000 + (week - 1) * 7 * 86_400_000);
    return weekStart;
  }

  return null;
}

// ── Noop builder (disabled mode) ──────────────────────────────────────────

function noopBuilder(): TrajectoryBuilder {
  return {
    recordToolCall() {},
    setProvider() {},
    addTokens() {},
    async finish({ finalAnswer }) {
      return {
        id: '',
        sessionId: '',
        channel: '',
        userInput: '',
        toolCalls: [],
        finalAnswer,
        success: true,
        iterations: 0,
        tokensUsed: { prompt: 0, completion: 0, total: 0 },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        private: false,
      };
    },
    cancel() {},
  };
}
