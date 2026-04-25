/**
 * voice-output.ts — Pluggable TTS wrapper for the Pyrfor engine.
 *
 * Features:
 * - Multiple provider injection with priority-based fallback
 * - SHA-256 keyed disk cache with LRU eviction
 * - Hit/miss/error statistics per provider
 */

import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';

// ─── Public types ────────────────────────────────────────────────────────────

export interface TtsRequest {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'ogg';
  speed?: number;
}

export interface TtsResult {
  audio: Buffer;
  format: string;
  durationMs?: number;
  cached?: boolean;
}

export type TtsProvider = (req: TtsRequest) => Promise<TtsResult>;

export interface VoiceOutputOptions {
  providers: { name: string; provider: TtsProvider; priority?: number }[];
  cacheDir?: string;
  cacheMaxBytes?: number;
  defaultVoice?: string;
  defaultFormat?: 'mp3' | 'wav' | 'ogg';
  clock?: () => number;
}

export interface VoiceOutput {
  synthesize(req: TtsRequest): Promise<TtsResult>;
  synthesizeToFile(req: TtsRequest, filePath: string): Promise<TtsResult>;
  clearCache(): void;
  getCacheSize(): number;
  getStats(): {
    hits: number;
    misses: number;
    errors: number;
    providerUses: Record<string, number>;
  };
}

// ─── Error codes ─────────────────────────────────────────────────────────────

export class TtsError extends Error {
  constructor(
    public readonly code: 'TTS_NO_PROVIDER' | 'TTS_ALL_FAILED',
    message: string,
    public readonly cause?: { errors: Error[] },
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

function cacheKey(req: TtsRequest): string {
  const payload = JSON.stringify({
    text: req.text,
    voice: req.voice,
    format: req.format,
    speed: req.speed,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function listCacheFiles(dir: string): { file: string; size: number; mtime: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.[a-z0-9]+$/.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      try {
        const s = statSync(full);
        return { file: full, size: s.size, mtime: s.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { file: string; size: number; mtime: number } => x !== null);
}

function totalBytes(dir: string): number {
  return listCacheFiles(dir).reduce((acc, f) => acc + f.size, 0);
}

function evictLru(dir: string, maxBytes: number): void {
  let files = listCacheFiles(dir);
  let total = files.reduce((a, f) => a + f.size, 0);
  if (total <= maxBytes) return;
  // oldest mtime first
  files.sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    if (total <= maxBytes) break;
    try {
      total -= f.size;
      unlinkSync(f.file);
    } catch {
      // ignore
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createVoiceOutput(opts: VoiceOutputOptions): VoiceOutput {
  const {
    cacheDir,
    cacheMaxBytes = 100 * 1024 * 1024,
    defaultVoice,
    defaultFormat = 'mp3',
  } = opts;

  // Sort providers by priority descending (higher priority = tried first)
  const sorted = [...opts.providers].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  const stats = {
    hits: 0,
    misses: 0,
    errors: 0,
    providerUses: {} as Record<string, number>,
  };

  function resolveRequest(req: TtsRequest): TtsRequest {
    return {
      ...req,
      voice: req.voice ?? defaultVoice,
      format: req.format ?? defaultFormat,
    };
  }

  function readCache(key: string, format: string): TtsResult | null {
    if (!cacheDir) return null;
    const file = path.join(cacheDir, `${key}.${format}`);
    if (!existsSync(file)) return null;
    try {
      const audio = readFileSync(file);
      return { audio, format, cached: true };
    } catch {
      return null;
    }
  }

  function writeCache(key: string, result: TtsResult): void {
    if (!cacheDir) return;
    ensureDir(cacheDir);
    const file = path.join(cacheDir, `${key}.${result.format}`);
    try {
      writeFileSync(file, result.audio);
      evictLru(cacheDir, cacheMaxBytes);
    } catch {
      // non-fatal
    }
  }

  async function synthesize(req: TtsRequest): Promise<TtsResult> {
    if (sorted.length === 0) {
      throw new TtsError('TTS_NO_PROVIDER', 'No TTS providers configured');
    }

    const resolved = resolveRequest(req);
    const key = cacheKey(resolved);
    const fmt = resolved.format ?? defaultFormat;

    const cached = readCache(key, fmt);
    if (cached) {
      stats.hits++;
      return cached;
    }
    stats.misses++;

    const errors: Error[] = [];
    for (const entry of sorted) {
      try {
        const result = await entry.provider(resolved);
        stats.providerUses[entry.name] = (stats.providerUses[entry.name] ?? 0) + 1;
        writeCache(key, result);
        return result;
      } catch (err) {
        stats.errors++;
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    throw new TtsError('TTS_ALL_FAILED', 'All TTS providers failed', { errors });
  }

  async function synthesizeToFile(req: TtsRequest, filePath: string): Promise<TtsResult> {
    const result = await synthesize(req);
    const dir = path.dirname(filePath);
    ensureDir(dir);
    writeFileSync(filePath, result.audio);
    return result;
  }

  function clearCache(): void {
    if (!cacheDir || !existsSync(cacheDir)) return;
    for (const f of listCacheFiles(cacheDir)) {
      try { unlinkSync(f.file); } catch { /* ignore */ }
    }
  }

  function getCacheSize(): number {
    if (!cacheDir) return 0;
    return totalBytes(cacheDir);
  }

  function getStats() {
    return {
      hits: stats.hits,
      misses: stats.misses,
      errors: stats.errors,
      providerUses: { ...stats.providerUses },
    };
  }

  return { synthesize, synthesizeToFile, clearCache, getCacheSize, getStats };
}

// ─── Mock helper ─────────────────────────────────────────────────────────────

export function mockTtsProvider(opts?: {
  failRate?: number;
  latencyMs?: number;
  rng?: () => number;
}): TtsProvider {
  const { failRate = 0, latencyMs = 0, rng = Math.random } = opts ?? {};

  return async (req: TtsRequest): Promise<TtsResult> => {
    if (latencyMs > 0) {
      await new Promise<void>((res) => setTimeout(res, latencyMs));
    }
    if (rng() < failRate) {
      throw new Error('mockTtsProvider: simulated failure');
    }
    // Deterministic dummy audio: hash of request fields
    const seed = JSON.stringify({ text: req.text, voice: req.voice, format: req.format, speed: req.speed });
    const audio = Buffer.from(createHash('sha256').update(seed).digest('hex'), 'utf8');
    return { audio, format: req.format ?? 'mp3', durationMs: audio.length * 10 };
  };
}
