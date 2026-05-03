/**
 * Agent Memory Store
 *
 * Provides short-term (in-process) and long-term (database) memory for agents.
 *
 * Memory types:
 * - episodic: specific events ("Project X was delayed 2 weeks in January")
 * - semantic: factual knowledge ("Project X has 5 active risks")
 * - procedural: workflow knowledge ("Always check budget before approving tasks")
 * - policy: governance constraints that must outrank project/task memory
 *
 * Storage:
 * - Short-term: LRU in-process Map (per agentId, TTL 30 min)
 * - Long-term: Prisma AgentMemory table (JSON-backed, upgradeable to pgvector)
 *
 * Retrieval: keyword BM25-style scoring (no embedding required).
 * When pgvector becomes available, swap embeddingJson for vector similarity.
 */

import { logger } from '../../observability/logger';

// ============================================
// Types
// ============================================

export type MemoryType = "episodic" | "semantic" | "procedural" | "policy";
export type MemoryVisibility = "member" | "project" | "workspace" | "family" | "global";

export interface MemoryProvenanceRef {
  kind: "run" | "session" | "ledger_event" | "artifact" | "user" | "system" | "external";
  ref: string;
  ts?: string;
}

export interface MemoryScope {
  visibility: MemoryVisibility;
  workspaceId?: string;
  projectId?: string;
  familyId?: string;
  memberId?: string;
}

export interface MemoryGovernance {
  provenance?: MemoryProvenanceRef[];
  scope?: MemoryScope;
  confidence?: number;
  retention?: {
    expiresAt?: string;
    ttlDays?: number;
  };
  lastValidatedAt?: string;
  revoked?: boolean;
  frozen?: boolean;
}

export type StructuredMemoryMetadata = MemoryGovernance & Record<string, unknown>;

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
  metadata?: StructuredMemoryMetadata;
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

export interface DurableMemorySearchOptions extends MemorySearchOptions {
  scope?: MemoryScopeFilter;
  projectMemoryCategories?: string[];
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
  metadata?: StructuredMemoryMetadata;
}

export interface MemoryScopeFilter {
  visibility: MemoryVisibility;
  workspaceId?: string;
  projectId?: string;
  familyId?: string;
  memberId?: string;
  now?: Date;
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
  projectId?: string;
}

const _shortTermStore = new Map<string, ShortTermEntry[]>();

function shortTermKey(agentId: string, workspaceId?: string, projectId?: string): string {
  const workspaceKey = workspaceId ? `${agentId}:${workspaceId}` : agentId;
  return projectId ? `${workspaceKey}:project:${projectId}` : workspaceKey;
}

export function storeShortTerm(
  agentId: string,
  content: string,
  options: { workspaceId?: string; projectId?: string; importance?: number; memoryType?: MemoryType } = {}
): void {
  const key = shortTermKey(agentId, options.workspaceId, options.projectId);
  const now = Date.now();
  const existing = filterAliveShortTermEntries(_shortTermStore.get(key) ?? [], now);

  existing.push({
    content,
    createdAt: now,
    importance: options.importance ?? 0.5,
    memoryType: options.memoryType ?? "episodic",
    projectId: options.projectId,
  });

  const sorted = existing
    .sort((a, b) => b.importance - a.importance)
    .slice(0, SHORT_TERM_MAX_PER_AGENT);

  _shortTermStore.set(key, sorted);
}

export function recallShortTerm(
  agentId: string,
  query: string,
  options: { workspaceId?: string; projectId?: string; limit?: number } = {}
): string[] {
  const key = shortTermKey(agentId, options.workspaceId, options.projectId);
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
    const { prisma } = await import('../../prisma');

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
      projectId: options.projectId,
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
    projectId: opts.projectId,
    limit: Math.ceil(limit / 2),
  });

  try {
    const { prisma } = await import('../../prisma');

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

    const entries: MemoryEntry[] = scored.map((s) => rowToMemoryEntry(s.row));

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

export async function searchDurableMemoryForContext(opts: DurableMemorySearchOptions): Promise<MemoryEntry[]> {
  const limit = opts.limit ?? 10;
  const queryTerms = opts.query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const scope = opts.scope ?? {
    visibility: opts.projectId ? "project" : "workspace",
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
  } satisfies MemoryScopeFilter;
  const scopeCandidates = [
    { workspaceId: null, projectId: null },
    ...(opts.workspaceId ? [{ workspaceId: opts.workspaceId }] : []),
    ...(opts.projectId ? [{ projectId: opts.projectId }] : []),
  ];

  try {
    const { prisma } = await import('../../prisma');
    const rows = await prisma.agentMemory.findMany({
      where: {
        agentId: opts.agentId,
        ...(opts.memoryType && { memoryType: opts.memoryType }),
        ...(opts.minImportance !== undefined && { importance: { gte: opts.minImportance } }),
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          { OR: scopeCandidates },
        ],
      },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: limit * 8,
    });
    const categories = new Set(opts.projectMemoryCategories ?? []);
    const scopedEntries = filterMemoryForScope(rows.map(rowToMemoryEntry), scope)
      .filter((entry) => {
        if (categories.size === 0) return true;
        const category = entry.metadata?.projectMemoryCategory;
        return typeof category === "string" && categories.has(category);
      });
    const documentFrequency = buildDocumentFrequency(scopedEntries, queryTerms);
    const totalDocs = Math.max(scopedEntries.length, 1);
    const termPatterns = compileTermPatterns(queryTerms);
    const scored = scopedEntries
      .map((entry) => ({
        entry,
        score:
          bm25Score(
            `${entry.content} ${entry.summary ?? ""}`,
            queryTerms,
            documentFrequency,
            totalDocs,
            termPatterns,
          ) + entry.importance,
      }))
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
      .slice(0, limit);

    const ids = scored.map((item) => item.entry.id);
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

    return scored.map((item) => item.entry);
  } catch (err) {
    logger.warn("agent-memory: durable context search failed", {
      agentId: opts.agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
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

export function filterMemoryForScope(
  entries: MemoryEntry[],
  scope: MemoryScopeFilter,
): MemoryEntry[] {
  const now = scope.now ?? new Date();
  return entries.filter((entry) => {
    const metadata = entry.metadata ?? {};
    if (metadata.revoked === true) return false;
    if (isExpired(metadata, now)) return false;

    const entryScope = metadata.scope ?? inferEntryScope(entry);
    return isVisibleInScope(entryScope, scope);
  });
}

function isExpired(metadata: StructuredMemoryMetadata, now: Date): boolean {
  const expiresAt = metadata.retention?.expiresAt;
  if (typeof expiresAt !== "string") return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts <= now.getTime();
}

function inferEntryScope(entry: MemoryEntry): MemoryScope {
  if (entry.projectId) {
    return {
      visibility: "project",
      projectId: entry.projectId,
      workspaceId: entry.workspaceId,
    };
  }
  if (entry.workspaceId) {
    return { visibility: "workspace", workspaceId: entry.workspaceId };
  }
  return { visibility: "global" };
}

function isVisibleInScope(entryScope: MemoryScope, target: MemoryScopeFilter): boolean {
  switch (entryScope.visibility) {
    case "member":
      return (
        target.visibility === "member" &&
        entryScope.memberId !== undefined &&
        entryScope.memberId === target.memberId
      );
    case "project":
      return (
        (target.visibility === "project" || target.visibility === "member") &&
        entryScope.workspaceId !== undefined &&
        entryScope.workspaceId === target.workspaceId &&
        entryScope.projectId !== undefined &&
        entryScope.projectId === target.projectId
      );
    case "workspace":
      return (
        (target.visibility === "workspace" || target.visibility === "project" || target.visibility === "member") &&
        entryScope.workspaceId !== undefined &&
        entryScope.workspaceId === target.workspaceId
      );
    case "family":
      return (
        (target.visibility === "family" || target.visibility === "member") &&
        entryScope.familyId !== undefined &&
        entryScope.familyId === target.familyId
      );
    case "global":
      return true;
  }
}

function safeParseMetadata(value: string): StructuredMemoryMetadata {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StructuredMemoryMetadata)
      : {};
  } catch {
    return {};
  }
}

interface AgentMemoryRow {
  id: string;
  agentId: string;
  workspaceId: string | null;
  projectId: string | null;
  memoryType: string;
  content: string;
  summary: string | null;
  importance: number;
  createdAt: Date;
  metadata: string;
}

function rowToMemoryEntry(row: AgentMemoryRow): MemoryEntry {
  return {
    id: row.id,
    agentId: row.agentId,
    workspaceId: row.workspaceId ?? undefined,
    projectId: row.projectId ?? undefined,
    memoryType: row.memoryType as MemoryType,
    content: row.content,
    summary: row.summary ?? undefined,
    importance: row.importance,
    createdAt: row.createdAt,
    metadata: safeParseMetadata(row.metadata),
  };
}

function buildDocumentFrequency(
  rows: Array<{ content: string; summary?: string | null }>,
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
