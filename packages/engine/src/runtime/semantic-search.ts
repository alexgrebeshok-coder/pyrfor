// @vitest-environment node
import * as crypto from 'crypto';
import * as fs from 'fs';

// ─── Error codes ─────────────────────────────────────────────────────────────

export const SEMANTIC_NO_EMBEDDER = 'SEMANTIC_NO_EMBEDDER';
export const SEMANTIC_DIM_MISMATCH = 'SEMANTIC_DIM_MISMATCH';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SemanticSearchOptions<T = unknown> {
  embedder?: (text: string) => Promise<number[]> | number[];
  persistPath?: string;
}

export interface SearchResult<T = unknown> {
  id: string;
  score: number;
  metadata?: T;
}

export interface SemanticSearch<T = unknown> {
  index(id: string, text: string, metadata?: T): Promise<void>;
  indexVector(id: string, vector: number[], metadata?: T): void;
  search(
    query: string | number[],
    opts?: { topK?: number; threshold?: number; filter?: (m: T) => boolean },
  ): Promise<Array<SearchResult<T>>>;
  remove(id: string): boolean;
  size(): number;
  clear(): void;
  save(): void;
  load(): void;
}

interface StoredItem<T> {
  id: string;
  vector: number[];
  metadata?: T;
  norm: number;
}

interface PersistedData<T> {
  version: number;
  items: Array<{ id: string; vector: number[]; metadata?: T }>;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function computeNorm(v: number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[], normA: number, normB: number): number {
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (normA * normB);
}

// ─── hashEmbedder ─────────────────────────────────────────────────────────────

/**
 * Deterministic toy embedder: SHA-256 fold → dim floats in [-1,1], then L2-normalised.
 * Useful in tests where a real model is unavailable.
 */
export function hashEmbedder(dim = 64): (text: string) => number[] {
  return (text: string): number[] => {
    // Accumulate enough bytes via chained SHA-256 rounds
    const bytes: number[] = [];
    let input = text;
    while (bytes.length < dim * 4) {
      const hash = crypto.createHash('sha256').update(input).digest();
      for (const b of hash) bytes.push(b);
      input = hash.toString('hex');
    }

    // Pack 4 bytes → uint32 → float in [-1, 1]
    const raw: number[] = [];
    for (let i = 0; i < dim; i++) {
      const u32 =
        bytes[i * 4] * 16777216 +
        bytes[i * 4 + 1] * 65536 +
        bytes[i * 4 + 2] * 256 +
        bytes[i * 4 + 3];
      raw.push(u32 / 2147483648 - 1); // map [0, 2^31) → [-1, 1)
    }

    // L2-normalise so the vector lies on the unit hypersphere
    const norm = computeNorm(raw);
    return norm === 0 ? raw : raw.map(x => x / norm);
  };
}

// ─── createSemanticSearch ─────────────────────────────────────────────────────

export function createSemanticSearch<T = unknown>(
  opts?: SemanticSearchOptions<T>,
): SemanticSearch<T> {
  const items = new Map<string, StoredItem<T>>();
  const embedder = opts?.embedder;
  const persistPath = opts?.persistPath;

  function throwNoEmbedder(): never {
    const err = new Error('No embedder configured for SemanticSearch');
    (err as NodeJS.ErrnoException & { code: string }).code = SEMANTIC_NO_EMBEDDER;
    throw err;
  }

  function throwDimMismatch(expected: number, got: number): never {
    const err = new Error(
      `Vector dimension mismatch: expected ${expected}, got ${got}`,
    );
    (err as NodeJS.ErrnoException & { code: string }).code = SEMANTIC_DIM_MISMATCH;
    throw err;
  }

  function validateDim(v: number[]): void {
    if (items.size === 0) return;
    const first = items.values().next().value as StoredItem<T>;
    if (first.vector.length !== v.length) throwDimMismatch(first.vector.length, v.length);
  }

  return {
    async index(id: string, text: string, metadata?: T): Promise<void> {
      if (!embedder) throwNoEmbedder();
      const vector = await Promise.resolve(embedder(text));
      validateDim(vector);
      const norm = computeNorm(vector);
      items.set(id, { id, vector, metadata, norm });
    },

    indexVector(id: string, vector: number[], metadata?: T): void {
      validateDim(vector);
      const norm = computeNorm(vector);
      items.set(id, { id, vector, metadata, norm });
    },

    async search(
      query: string | number[],
      opts?: { topK?: number; threshold?: number; filter?: (m: T) => boolean },
    ): Promise<Array<SearchResult<T>>> {
      const topK = opts?.topK ?? 10;
      const threshold = opts?.threshold ?? 0;
      const filter = opts?.filter;

      let queryVector: number[];
      if (typeof query === 'string') {
        if (!embedder) throwNoEmbedder();
        queryVector = await Promise.resolve(embedder(query));
      } else {
        queryVector = query;
      }

      const queryNorm = computeNorm(queryVector);
      const results: Array<SearchResult<T>> = [];

      for (const item of items.values()) {
        if (item.vector.length !== queryVector.length) {
          throwDimMismatch(queryVector.length, item.vector.length);
        }
        if (filter !== undefined && !filter(item.metadata as T)) continue;
        const score = cosineSimilarity(queryVector, item.vector, queryNorm, item.norm);
        if (score >= threshold) {
          results.push({ id: item.id, score, metadata: item.metadata });
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    },

    remove(id: string): boolean {
      return items.delete(id);
    },

    size(): number {
      return items.size;
    },

    clear(): void {
      items.clear();
    },

    save(): void {
      if (!persistPath) throw new Error('No persistPath configured');
      const data: PersistedData<T> = {
        version: 1,
        items: Array.from(items.values()).map(({ id, vector, metadata }) => ({
          id,
          vector,
          metadata,
        })),
      };
      const json = JSON.stringify(data);
      const tmpPath = `${persistPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
      fs.writeFileSync(tmpPath, json, 'utf8');
      fs.renameSync(tmpPath, persistPath);
    },

    load(): void {
      if (!persistPath) throw new Error('No persistPath configured');
      if (!fs.existsSync(persistPath)) return;
      const json = fs.readFileSync(persistPath, 'utf8');
      const data = JSON.parse(json) as PersistedData<T>;
      items.clear();
      for (const item of data.items) {
        const norm = computeNorm(item.vector);
        items.set(item.id, { id: item.id, vector: item.vector, metadata: item.metadata, norm });
      }
    },
  };
}
