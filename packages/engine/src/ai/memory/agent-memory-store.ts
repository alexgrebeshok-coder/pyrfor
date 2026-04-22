/**
 * Agent Memory Store
 *
 * Provides short-term (in-process) and long-term (database) memory for agents.
 *
 * Memory types:
 * - episodic: specific events ("Project X was delayed 2 weeks in January")
 * - semantic: factual knowledge ("Project X has 5 active risks")
 * - procedural: workflow knowledge ("Always check budget before approving tasks")
 *
 * Storage:
 * - Short-term: LRU in-process Map (per agentId, TTL 30 min)
 * - Long-term: Prisma AgentMemory table (JSON-backed, upgradeable to pgvector)
 *
 * Retrieval: keyword BM25-style scoring (no embedding required).
 * When pgvector becomes available, swap embeddingJson for vector similarity.
 */

import { logger } from "@/lib/logger";

// ============================================
// Types
// ============================================

export type MemoryType = "episodic" | "semantic" | "procedural";

export interface MemoryEntry {
  id: string;
  agentId: string;
  workspaceId?: string;
  projectId?: string;
  memoryType: MemoryType;
  content: string;
  summary?: string;
  importance: number; // 0-1
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchOptions {
  agentId: string;
  query: string;
  workspaceId?: string;
  projectId?: string;
  memoryType?: MemoryType;
  limit?: number;
  minImportance?: number;
}

export interface MemoryWriteOptions {
  agentId: string;
  workspaceId?: string;
  projectId?: string;
  memoryType?: MemoryType;
  content: string;
  summary?: string;
  importance?: number;
  expiresInDays?: number;
  metadata?: Record<string, unknown>;
}

// ============================================
// Short-term memory (in-process, TTL-based)
// ============================================

const SHORT_TERM_TTL = 30 * 60 * 1000; // 30 minutes
const SHORT_TERM_MAX_PER_AGENT = 50;

interface ShortTermEntry {
  content: string;
  createdAt: number;
  importance: number;
  memoryType: MemoryType;
}

const _shortTermStore = new Map<string, ShortTermEntry[]>();

function shortTermKey(agentId: string, workspaceId?: string): string {
  return workspaceId ? `${agentId}:${workspaceId}` : agentId;
}

export function storeShortTerm(
  agentId: string,
  content: string,
  options: { workspaceId?: string; importance?: number; memoryType?: MemoryType } = {}
): void {
  const key = shortTermKey(agentId, options.workspaceId);
  const now = Date.now();
  const existing = filterAliveShortTermEntries(_shortTermStore.get(key) ?? [], now);

  existing.push({
    content,
    createdAt: now,
    importance: options.importance ?? 0.5,
    memoryType: options.memoryType ?? "episodic",
  });

  const sorted = existing
    .sort((a, b) => b.importance - a.importance)
    .slice(0, SHORT_TERM_MAX_PER_AGENT);

  _shortTermStore.set(key, sorted);
}

export function recallShortTerm(
  agentId: string,
  query: string,
  options: { workspaceId?: string; limit?: number } = {}
): string[] {
  const key = shortTermKey(agentId, options.workspaceId);
  const now = Date.now();
  const entries = filterAliveShortTermEntries(_shortTermStore.get(key) ?? [], now);
  _shortTermStore.set(key, entries);
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const limit = options.limit ?? 5;

  return entries
    .map((e) => {
      const lc = e.content.toLowerCase();
      const score =
        queryTerms.reduce((acc, term) => acc + (lc.includes(term) ? 1 : 0), 0) *
        e.importance;
      return { content: e.content, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.content);
}

// ============================================
// Long-term memory (database)
// ============================================

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

/** Pre-compile regex patterns once per query — avoids O(terms × rows) RegExp allocations. */
function compileTermPatterns(queryTerms: string[]): Map<string, RegExp> {
  const map = new Map<string, RegExp>();
  for (const term of queryTerms) {
    if (!term) continue;
    if (map.has(term)) continue;
    map.set(term, new RegExp(term.replace(REGEX_ESCAPE, "\\$&"), "g"));
  }
  return map;
}

/** Simple keyword scoring with a lightweight IDF approximation. */
function bm25Score(
  content: string,
  queryTerms: string[],
  documentFrequency: Map<string, number>,
  totalDocs: number,
  termPatterns: Map<string, RegExp>
): number {
  if (queryTerms.length === 0) return 0;
  const lc = content.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    const pattern = termPatterns.get(term);
    if (!pattern) continue;
    // RegExp with /g is stateful via lastIndex when using .exec; .match resets implicitly.
    const matches = lc.match(pattern);
    const count = matches ? matches.length : 0;
    if (count === 0) continue;

    const docFreq = documentFrequency.get(term) ?? 1;
    const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
    const tf = (count * 2.2) / (count + 1.2);
    score += tf * idf;
  }
  return score;
}

export async function storeMemory(options: MemoryWriteOptions): Promise<string> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const expiresAt = options.expiresInDays
      ? new Date(Date.now() + options.expiresInDays * 86400_000)
      : undefined;

    const record = await prisma.agentMemory.create({
      data: {
        agentId: options.agentId,
        workspaceId: options.workspaceId,
        projectId: options.projectId,
        memoryType: options.memoryType ?? "episodic",
        content: options.content,
        summary: options.summary,
        importance: options.importance ?? 0.5,
        metadata: JSON.stringify(options.metadata ?? {}),
        expiresAt,
      },
    });

    // Also keep in short-term for fast access
    storeShortTerm(options.agentId, options.content, {
      workspaceId: options.workspaceId,
      importance: options.importance,
      memoryType: options.memoryType,
    });

    return record.id as string;
  } catch (err) {
    logger.warn("agent-memory: failed to persist to DB", {
      agentId: options.agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Still store in short-term
    storeShortTerm(options.agentId, options.content, options);
    return "short-term-only";
  }
}

export async function searchMemory(opts: MemorySearchOptions): Promise<MemoryEntry[]> {
  const limit = opts.limit ?? 10;
  const queryTerms = opts.query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  // Always check short-term first
  const shortTermResults = recallShortTerm(opts.agentId, opts.query, {
    workspaceId: opts.workspaceId,
    limit: Math.ceil(limit / 2),
  });

  try {
    const { prisma } = await import("@/lib/prisma");

    const rows = await prisma.agentMemory.findMany({
      where: {
        agentId: opts.agentId,
        ...(opts.workspaceId && { workspaceId: opts.workspaceId }),
        ...(opts.projectId && { projectId: opts.projectId }),
        ...(opts.memoryType && { memoryType: opts.memoryType }),
        ...(opts.minImportance !== undefined && { importance: { gte: opts.minImportance } }),
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: limit * 3, // over-fetch for client-side scoring
    });

    const documentFrequency = buildDocumentFrequency(rows, queryTerms);
    const totalDocs = Math.max(rows.length, 1);
    const termPatterns = compileTermPatterns(queryTerms);

    // Score by keyword match
    const scored = rows
      .map((row) => ({
        row,
        score:
          bm25Score(
            row.content + " " + (row.summary ?? ""),
            queryTerms,
            documentFrequency,
            totalDocs,
            termPatterns
          ) + row.importance,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Update access counts in background
    const ids = scored.map((s) => s.row.id);
    if (ids.length > 0) {
      void prisma.agentMemory
        .updateMany({
          where: { id: { in: ids } },
          data: {
            accessCount: { increment: 1 },
            lastAccessedAt: new Date(),
          },
        })
        .catch(() => {});
    }

    const entries: MemoryEntry[] = scored.map((s) => ({
      id: s.row.id,
      agentId: s.row.agentId,
      workspaceId: s.row.workspaceId ?? undefined,
      projectId: s.row.projectId ?? undefined,
      memoryType: s.row.memoryType as MemoryType,
      content: s.row.content,
      summary: s.row.summary ?? undefined,
      importance: s.row.importance,
      createdAt: s.row.createdAt,
      metadata: safeParseMetadata(s.row.metadata),
    }));

    // Merge short-term (deduplicate by content)
    const longTermContents = new Set(entries.map((e) => e.content));
    const shortTermEntries: MemoryEntry[] = shortTermResults
      .filter((c) => !longTermContents.has(c))
      .map((c, i) => ({
        id: `short:${i}`,
        agentId: opts.agentId,
        memoryType: "episodic" as MemoryType,
        content: c,
        importance: 0.6,
        createdAt: new Date(),
      }));

    return [...shortTermEntries, ...entries].slice(0, limit);
  } catch (err) {
    logger.warn("agent-memory: DB search failed, returning short-term only", {
      error: err instanceof Error ? err.message : String(err),
    });
    return shortTermResults.map((c, i) => ({
      id: `short:${i}`,
      agentId: opts.agentId,
      memoryType: "episodic" as MemoryType,
      content: c,
      importance: 0.6,
      createdAt: new Date(),
    }));
  }
}

/**
 * Build a memory context string to inject into an agent's system prompt.
 * Returns empty string if no relevant memories found.
 */
export async function buildMemoryContext(
  agentId: string,
  query: string,
  options: { workspaceId?: string; projectId?: string; limit?: number } = {}
): Promise<string> {
  const memories = await searchMemory({
    agentId,
    query,
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    limit: options.limit ?? 5,
  });

  if (memories.length === 0) return "";

  const lines = memories.map((m) => `• ${m.summary ?? m.content.slice(0, 200)}`);
  return `## Relevant context from previous sessions:\n${lines.join("\n")}`;
}

function filterAliveShortTermEntries(entries: ShortTermEntry[], now: number): ShortTermEntry[] {
  return entries.filter((entry) => now - entry.createdAt < SHORT_TERM_TTL);
}

function safeParseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildDocumentFrequency(
  rows: Array<{ content: string; summary: string | null }>,
  queryTerms: string[]
): Map<string, number> {
  const frequencies = new Map<string, number>();

  for (const term of queryTerms) {
    let count = 0;
    for (const row of rows) {
      const haystack = `${row.content} ${row.summary ?? ""}`.toLowerCase();
      if (haystack.includes(term)) {
        count += 1;
      }
    }
    frequencies.set(term, Math.max(count, 1));
  }

  return frequencies;
}
