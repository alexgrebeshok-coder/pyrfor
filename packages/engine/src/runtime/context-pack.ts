import { createHash } from 'node:crypto';
import type { MemoryType } from '../ai/memory/agent-memory-store';

export type ContextPackSchemaVersion = 'context_pack.v1';

export type ContextSectionKind =
  | 'task_contract'
  | 'policy'
  | 'workspace'
  | 'files'
  | 'ledger'
  | 'session'
  | 'dag'
  | 'memory'
  | 'domain';

export interface ContextSourceRef {
  kind:
    | 'task'
    | 'workspace_file'
    | 'file'
    | 'ledger_event'
    | 'dag_node'
    | 'session'
    | 'memory'
    | 'policy'
    | 'domain_fact';
  ref: string;
  role: 'input' | 'policy' | 'evidence' | 'history' | 'memory' | 'constraint';
  sha256?: string;
  meta?: Record<string, unknown>;
}

export interface ContextPackSection {
  id: string;
  kind: ContextSectionKind;
  title: string;
  priority: number;
  content: unknown;
  sources: ContextSourceRef[];
}

export interface ContextTaskContract {
  id?: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  nonGoals?: string[];
}

export interface ContextMemoryEntry {
  id: string;
  memoryType: MemoryType;
  content: string;
  summary?: string;
  importance: number;
  provenance?: unknown;
  scope?: unknown;
  confidence?: number;
  lastValidatedAt?: string;
  frozen?: boolean;
}

export interface ContextPack {
  schemaVersion: ContextPackSchemaVersion;
  packId: string;
  hash: string;
  compiledAt: string;
  runId?: string;
  workspaceId: string;
  projectId?: string;
  task: ContextTaskContract;
  sections: ContextPackSection[];
  sourceRefs: ContextSourceRef[];
}

type Jsonish = null | boolean | number | string | Jsonish[] | { [key: string]: Jsonish };

function normalizeStable(value: unknown): Jsonish {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeStable(item));

  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return value as Jsonish;
  if (kind === 'undefined' || kind === 'function' || kind === 'symbol' || kind === 'bigint') return null;

  if (kind === 'object') {
    const object = value as Record<string, unknown>;
    const result: { [key: string]: Jsonish } = {};
    for (const key of Object.keys(object).sort()) {
      const normalized = normalizeStable(object[key]);
      if (normalized !== null || object[key] === null) result[key] = normalized;
    }
    return result;
  }

  return null;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStable(value));
}

export function hashContextPack(pack: Omit<ContextPack, 'hash'>): string {
  return createHash('sha256').update(stableStringify(pack)).digest('hex');
}

export function withContextPackHash(pack: Omit<ContextPack, 'hash'>): ContextPack {
  return {
    ...pack,
    hash: hashContextPack(pack),
  };
}
