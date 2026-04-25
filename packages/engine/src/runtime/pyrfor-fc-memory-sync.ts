/**
 * pyrfor-fc-memory-sync.ts — Read-only FreeClaude memory → Pyrfor MemoryStore sync.
 *
 * Imports FC memory entries into Pyrfor for searching/cross-referencing.
 * FC remains the source of truth; we never write back to ~/.freeclaude.
 */

import { homedir } from 'os';
import path from 'path';
import type { MemoryStore, MemoryKind } from './memory-store';

// ─── Public types ────────────────────────────────────────────────────────────

export interface FcMemoryEntry {
  key: string;
  value: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface FcEmbeddingEntry {
  key: string;
  value: string;
  embedding?: number[];
  updatedAt?: string;
}

export interface FcMemorySnapshot {
  memory: FcMemoryEntry[];
  embeddings: FcEmbeddingEntry[];
  embeddingModel?: string;
  loadedAt: number;
}

export interface FcMemorySyncOptions {
  /** Path to memory.json. Default: ~/.freeclaude/memory.json. */
  memoryPath?: string;
  /** Path to embeddings.json. Default: ~/.freeclaude/embeddings.json. */
  embeddingsPath?: string;
  /** Memory store to sync into. */
  store: MemoryStore;
  /** Scope for synced entries. Default: 'fc-import'. */
  scope?: string;
  /** Source string. Default: 'freeclaude'. */
  source?: string;
  /** Filesystem (for tests). Default: node:fs. */
  fs?: {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, enc: 'utf8') => string;
  };
  /** Clock. */
  now?: () => number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferKind(tags: string[] | undefined): MemoryKind {
  if (!tags || tags.length === 0) return 'fact';
  
  // Check for specific tags
  if (tags.includes('personal')) return 'preference';
  if (tags.includes('lesson')) return 'lesson';
  
  return 'fact';
}

function getDefaultMemoryPath(): string {
  return path.join(homedir(), '.freeclaude', 'memory.json');
}

function getDefaultEmbeddingsPath(): string {
  return path.join(homedir(), '.freeclaude', 'embeddings.json');
}

// ─── Load snapshot ───────────────────────────────────────────────────────────

/**
 * Load FC memory snapshot from disk (no DB writes).
 * Missing files → empty arrays, not throw.
 */
export function loadFcMemorySnapshot(
  opts: Pick<FcMemorySyncOptions, 'memoryPath' | 'embeddingsPath' | 'fs' | 'now'>,
): FcMemorySnapshot {
  const fs = opts.fs ?? require('fs');
  const now = opts.now ?? (() => Date.now());
  
  const memoryPath = opts.memoryPath ?? getDefaultMemoryPath();
  const embeddingsPath = opts.embeddingsPath ?? getDefaultEmbeddingsPath();

  let memory: FcMemoryEntry[] = [];
  let embeddings: FcEmbeddingEntry[] = [];
  let embeddingModel: string | undefined;

  // Load memory.json
  if (fs.existsSync(memoryPath)) {
    try {
      const raw = fs.readFileSync(memoryPath, 'utf8');
      const parsed = JSON.parse(raw);
      
      if (parsed && typeof parsed === 'object' && parsed.entries) {
        const entries = parsed.entries;
        
        // Handle both object (keyed by key) and array formats
        if (typeof entries === 'object' && !Array.isArray(entries)) {
          memory = Object.values(entries).filter((e: any) => e && typeof e === 'object' && e.key) as FcMemoryEntry[];
        } else if (Array.isArray(entries)) {
          memory = entries.filter((e: any) => e && typeof e === 'object' && e.key) as FcMemoryEntry[];
        } else {
          console.warn(`Unexpected entries shape in ${memoryPath}: expected object or array, got ${typeof entries}`);
        }
      }
    } catch (err: any) {
      if (err.name === 'SyntaxError') {
        throw new Error(`Malformed JSON in ${memoryPath}: ${err.message}`);
      }
      throw err;
    }
  }

  // Load embeddings.json
  if (fs.existsSync(embeddingsPath)) {
    try {
      const raw = fs.readFileSync(embeddingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      
      if (parsed && typeof parsed === 'object') {
        if (parsed.model) {
          embeddingModel = parsed.model;
        }
        
        if (Array.isArray(parsed.entries)) {
          embeddings = parsed.entries.filter((e: any) => e && typeof e === 'object' && e.key) as FcEmbeddingEntry[];
        }
      }
    } catch (err: any) {
      if (err.name === 'SyntaxError') {
        throw new Error(`Malformed JSON in ${embeddingsPath}: ${err.message}`);
      }
      throw err;
    }
  }

  return {
    memory,
    embeddings,
    embeddingModel,
    loadedAt: now(),
  };
}

// ─── Sync to store ───────────────────────────────────────────────────────────

/**
 * Sync snapshot into MemoryStore. Returns { added, skipped, total }.
 * Idempotent: re-running with same data adds 0.
 * 
 * TODO: Future enhancement — extend memory-store with embedding column to support
 * vector search. Currently, embeddings are preserved in snapshot but not stored.
 */
export function syncFcMemoryToStore(
  snapshot: FcMemorySnapshot,
  opts: FcMemorySyncOptions,
): { added: number; skipped: number; total: number } {
  const store = opts.store;
  const scope = opts.scope ?? 'fc-import';
  const sourcePrefix = opts.source ?? 'freeclaude';

  const total = snapshot.memory.length;
  
  if (total === 0) {
    return { added: 0, skipped: 0, total: 0 };
  }

  // Build set of existing sources for idempotency check
  const existingSources = new Set<string>();
  const existing = store.query({ scope, limit: 10000 });
  for (const entry of existing) {
    existingSources.add(entry.source);
  }

  let added = 0;
  let skipped = 0;

  for (const fcEntry of snapshot.memory) {
    const source = `${sourcePrefix}#${fcEntry.key}`;
    
    // Skip if already synced
    if (existingSources.has(source)) {
      skipped++;
      continue;
    }

    // Build MemoryStore add input
    const kind = inferKind(fcEntry.tags);
    const text = `${fcEntry.key}: ${fcEntry.value}`;
    const tags = fcEntry.tags ?? [];
    const weight = 1.0;

    store.add({
      kind,
      text,
      source,
      scope,
      tags,
      weight,
      expires_at: undefined,
    });

    added++;
  }

  return { added, skipped, total };
}

// ─── Convenience: load + sync ────────────────────────────────────────────────

/**
 * Convenience: load + sync.
 */
export function syncFcMemory(
  opts: FcMemorySyncOptions,
): { added: number; skipped: number; total: number; snapshot: FcMemorySnapshot } {
  const snapshot = loadFcMemorySnapshot(opts);
  const result = syncFcMemoryToStore(snapshot, opts);
  
  return {
    ...result,
    snapshot,
  };
}
