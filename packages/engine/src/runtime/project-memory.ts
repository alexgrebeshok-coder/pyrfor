import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { EventLedger, LedgerEvent } from './event-ledger';
import type { SessionRecord, SessionStore } from './session-store';
import { storeMemory, type MemoryType, type MemoryWriteOptions } from '../ai/memory/agent-memory-store';

export type ProjectMemoryCategory =
  | 'decision'
  | 'convention'
  | 'risk'
  | 'active_thread'
  | 'unresolved_task';

export interface ProjectMemoryRollupInput {
  workspaceId: string;
  projectId: string;
  agentId?: string;
  sessionLimit?: number;
}

export interface ProjectMemoryCategoryResult {
  category: ProjectMemoryCategory;
  memoryType: MemoryType;
  summary: string;
  content: string;
  memoryId: string;
}

export interface ProjectMemoryRollupResult {
  workspaceId: string;
  projectId: string;
  agentId: string;
  sessionCount: number;
  ledgerEventCount: number;
  runIds: string[];
  artifact?: ArtifactRef;
  memories: ProjectMemoryCategoryResult[];
}

export interface ProjectMemoryRollupDeps {
  sessionStore: SessionStore;
  eventLedger?: EventLedger;
  artifactStore?: ArtifactStore;
  memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
  now?: () => Date;
}

const CATEGORY_DEFS: Array<{ category: ProjectMemoryCategory; memoryType: MemoryType; title: string; importance: number }> = [
  { category: 'decision', memoryType: 'semantic', title: 'Decisions', importance: 0.9 },
  { category: 'convention', memoryType: 'procedural', title: 'Conventions', importance: 0.82 },
  { category: 'risk', memoryType: 'semantic', title: 'Risks', importance: 0.88 },
  { category: 'active_thread', memoryType: 'episodic', title: 'Active threads', importance: 0.78 },
  { category: 'unresolved_task', memoryType: 'semantic', title: 'Unresolved tasks', importance: 0.86 },
];

export async function createProjectMemoryRollup(
  deps: ProjectMemoryRollupDeps,
  input: ProjectMemoryRollupInput,
): Promise<ProjectMemoryRollupResult> {
  if (!input.projectId.trim()) throw new Error('Project memory rollup requires projectId');
  const agentId = input.agentId ?? 'pyrfor-runtime';
  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  const sessions = (await deps.sessionStore.list(input.workspaceId, {
    limit: input.sessionLimit ?? 200,
    orderBy: 'updatedAt',
    direction: 'desc',
  })).filter((session) => sessionProjectId(session) === input.projectId);
  const allEvents = await readLedgerEvents(deps.eventLedger);
  const projectRunIds = mapProjectRunIds(allEvents, sessions, input.projectId);
  const ledgerEvents = allEvents.filter((event) => event.run_id && projectRunIds.has(event.run_id));
  const runIds = [...projectRunIds].sort();
  const categoryContents = buildCategoryContents({ sessions, ledgerEvents, runIds, projectId: input.projectId });
  const artifact = deps.artifactStore
    ? await deps.artifactStore.writeJSON('summary', {
        schemaVersion: 'project_memory_rollup.v1',
        createdAt,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        agentId,
        sessionIds: sessions.map((session) => session.id),
        runIds,
        categories: categoryContents,
      }, {
        meta: {
          memoryKind: 'project_rollup',
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          agentId,
        },
      })
    : undefined;

  const memories: ProjectMemoryCategoryResult[] = [];
  for (const def of CATEGORY_DEFS) {
    const content = categoryContents[def.category];
    const summary = `${def.title} for project ${input.projectId}: ${firstContentLine(content)}`;
    const memoryId = await (deps.memoryWriter ?? storeMemory)({
      agentId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      memoryType: def.memoryType,
      content,
      summary,
      importance: def.importance,
      metadata: {
        projectMemoryCategory: def.category,
        rollupKind: 'project',
        scope: {
          visibility: 'project',
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        },
        confidence: 0.72,
        provenance: [
          ...sessions.map((session) => ({ kind: 'session' as const, ref: session.id, ts: session.updatedAt })),
          ...ledgerEvents.slice(-50).map((event) => ({ kind: 'ledger_event' as const, ref: event.id, ts: event.ts })),
          ...(artifact ? [{ kind: 'artifact' as const, ref: artifact.id, ts: artifact.createdAt }] : []),
        ],
      },
    });
    if (memoryId === 'short-term-only') throw new Error('Project memory rollup was not durably persisted');
    memories.push({ category: def.category, memoryType: def.memoryType, summary, content, memoryId });
  }

  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    agentId,
    sessionCount: sessions.length,
    ledgerEventCount: ledgerEvents.length,
    runIds,
    ...(artifact ? { artifact } : {}),
    memories,
  };
}

function buildCategoryContents(input: {
  sessions: SessionRecord[];
  ledgerEvents: LedgerEvent[];
  runIds: string[];
  projectId: string;
}): Record<ProjectMemoryCategory, string> {
  const sessionSummaries = input.sessions.map((session) => `- ${session.title} (${session.id}): ${session.summary ?? summarizeRecentMessages(session)}`);
  const decisionEvents = input.ledgerEvents.filter((event) => event.type.includes('approval') || event.type === 'verifier.waived');
  const blockedEvents = input.ledgerEvents.filter((event) => event.type === 'run.blocked' || event.type === 'run.failed' || event.type === 'dag.node.failed');
  const textLines = input.sessions.flatMap((session) => session.messages.map((message) => message.content));
  return {
    decision: sectionContent('decision', input.projectId, [
      ...matchingLines(textLines, /\b(decid|approved|approval|waiv)\w*/i),
      ...decisionEvents.map((event) => eventLine(event)),
    ]),
    convention: sectionContent('convention', input.projectId, matchingLines(textLines, /\b(always|never|must|convention|policy)\b/i)),
    risk: sectionContent('risk', input.projectId, [
      ...matchingLines(textLines, /\b(risk|block|fail)\w*/i),
      ...blockedEvents.map((event) => eventLine(event)),
    ]),
    active_thread: sectionContent('active_thread', input.projectId, [
      ...sessionSummaries,
      ...(input.runIds.length > 0 ? [`- Active/recent project runs: ${input.runIds.join(', ')}`] : []),
    ]),
    unresolved_task: sectionContent('unresolved_task', input.projectId, [
      ...matchingLines(textLines, /\b(todo|next|continue|remaining)\w*/i),
      ...blockedEvents.map((event) => `- Follow up ${event.run_id}: ${eventLine(event)}`),
    ]),
  };
}

function sectionContent(category: ProjectMemoryCategory, projectId: string, lines: string[]): string {
  const unique = [...new Set(lines.map((line) => line.trim()).filter(Boolean))].slice(0, 12);
  const body = unique.length > 0 ? unique : [`- No explicit ${category.replace('_', ' ')} facts detected yet.`];
  return [`# Pyrfor project memory: ${category}`, `Project: ${projectId}`, '', ...body].join('\n');
}

function matchingLines(lines: string[], pattern: RegExp): string[] {
  return lines
    .filter((line) => pattern.test(line))
    .map((line) => `- ${truncateLine(line, 220)}`);
}

function eventLine(event: LedgerEvent): string {
  const reason = (event as { reason?: unknown; error?: unknown; status?: unknown }).reason
    ?? (event as { error?: unknown }).error
    ?? (event as { status?: unknown }).status;
  return `- ${event.type} for ${event.run_id}${typeof reason === 'string' ? `: ${truncateLine(reason, 160)}` : ''}`;
}

function summarizeRecentMessages(session: SessionRecord): string {
  const messages = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-4)
    .map((message) => `${message.role}: ${truncateLine(message.content, 120)}`);
  return messages.length > 0 ? messages.join(' | ') : 'No conversational messages.';
}

function sessionProjectId(session: SessionRecord): string | undefined {
  const projectId = session.metadata?.projectId;
  return typeof projectId === 'string' ? projectId : undefined;
}

async function readLedgerEvents(eventLedger: EventLedger | undefined): Promise<LedgerEvent[]> {
  if (!eventLedger) return [];
  return eventLedger.readAll();
}

function mapProjectRunIds(events: LedgerEvent[], sessions: SessionRecord[], projectId: string): Set<string> {
  const runIds = new Set(sessions.map((session) => session.runId).filter((runId): runId is string => typeof runId === 'string'));
  for (const event of events) {
    const eventProjectId = (event as { projectId?: unknown; project_id?: unknown }).projectId
      ?? (event as { project_id?: unknown }).project_id;
    if (event.run_id && eventProjectId === projectId) runIds.add(event.run_id);
  }
  return runIds;
}

function firstContentLine(content: string): string {
  return content.split('\n').find((line) => line.startsWith('- '))?.slice(2) ?? 'no explicit facts yet';
}

function truncateLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}
