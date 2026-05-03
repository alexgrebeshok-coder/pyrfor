import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { EventLedger, LedgerEvent } from './event-ledger';
import type { SessionRecord, SessionStore } from './session-store';
import { storeMemory, type MemoryWriteOptions } from '../ai/memory/agent-memory-store';

export interface DailyMemoryRollupInput {
  workspaceId: string;
  date?: string;
  agentId?: string;
  projectId?: string;
  sessionLimit?: number;
}

export interface DailyMemoryRollupResult {
  date: string;
  workspaceId: string;
  agentId: string;
  sessionCount: number;
  messageCount: number;
  ledgerEventCount: number;
  runIds: string[];
  summary: string;
  content: string;
  memoryId: string;
  artifact?: ArtifactRef;
}

export interface DailyMemoryRollupDeps {
  sessionStore: SessionStore;
  eventLedger?: EventLedger;
  artifactStore?: ArtifactStore;
  memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
  now?: () => Date;
}

export async function createDailyMemoryRollup(
  deps: DailyMemoryRollupDeps,
  input: DailyMemoryRollupInput,
): Promise<DailyMemoryRollupResult> {
  const date = input.date ?? toDateKey((deps.now ?? (() => new Date()))());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid daily rollup date: ${date}`);
  const agentId = input.agentId ?? 'pyrfor-runtime';
  const sessions = (await deps.sessionStore.list(input.workspaceId, {
    mode: 'chat',
    limit: input.sessionLimit ?? 200,
    orderBy: 'updatedAt',
    direction: 'desc',
  })).filter((session) => sessionTouchesDate(session, date));
  const allLedgerEvents = await readLedgerEvents(deps.eventLedger);
  const runWorkspaceIds = mapRunWorkspaceIds(allLedgerEvents);
  const dailyLedgerEvents = allLedgerEvents.filter((event) => event.ts.startsWith(date));
  const ledgerEvents = filterWorkspaceEvents(dailyLedgerEvents, input.workspaceId, runWorkspaceIds);
  const runIds = [...new Set(ledgerEvents.map((event) => event.run_id).filter(Boolean))].sort();
  const messageCount = sessions.reduce((sum, session) => sum + session.messages.length, 0);
  const summary = `Daily rollup for ${date}: ${sessions.length} sessions, ${messageCount} messages, ${ledgerEvents.length} ledger events.`;
  const content = renderDailyRollup({
    date,
    workspaceId: input.workspaceId,
    sessions,
    ledgerEvents,
    runIds,
    summary,
  });
  const artifact = deps.artifactStore
    ? await deps.artifactStore.writeJSON('summary', {
        schemaVersion: 'memory_daily_rollup.v1',
        date,
        workspaceId: input.workspaceId,
        agentId,
        projectId: input.projectId,
        summary,
        content,
        sessionIds: sessions.map((session) => session.id),
        runIds,
      }, {
        meta: {
          memoryKind: 'daily_rollup',
          workspaceId: input.workspaceId,
          agentId,
          date,
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
      })
    : undefined;
  const memoryId = await (deps.memoryWriter ?? storeMemory)({
    agentId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    memoryType: 'semantic',
    content,
    summary,
    importance: 0.85,
    metadata: {
      rollupKind: 'daily',
      date,
      scope: {
        visibility: input.projectId ? 'project' : 'workspace',
        workspaceId: input.workspaceId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
      confidence: 0.75,
      provenance: [
        ...sessions.map((session) => ({ kind: 'session' as const, ref: session.id, ts: session.updatedAt })),
        ...ledgerEvents.slice(-50).map((event) => ({ kind: 'ledger_event' as const, ref: event.id, ts: event.ts })),
        ...(artifact ? [{ kind: 'artifact' as const, ref: artifact.id, ts: artifact.createdAt }] : []),
      ],
    },
  });
  if (memoryId === 'short-term-only') {
    throw new Error('Daily memory rollup was not durably persisted');
  }

  return {
    date,
    workspaceId: input.workspaceId,
    agentId,
    sessionCount: sessions.length,
    messageCount,
    ledgerEventCount: ledgerEvents.length,
    runIds,
    summary,
    content,
    memoryId,
    ...(artifact ? { artifact } : {}),
  };
}

function renderDailyRollup(input: {
  date: string;
  workspaceId: string;
  sessions: SessionRecord[];
  ledgerEvents: LedgerEvent[];
  runIds: string[];
  summary: string;
}): string {
  const lines = [
    `# Pyrfor daily memory rollup — ${input.date}`,
    '',
    input.summary,
    `Workspace: ${input.workspaceId}`,
    '',
    '## Sessions',
    ...sessionLines(input.sessions),
    '',
    '## Runs and ledger',
    ...ledgerLines(input.ledgerEvents, input.runIds),
    '',
    '## Next-session continuity hints',
    ...continuityHints(input.sessions, input.ledgerEvents),
  ];
  return lines.join('\n').trim();
}

function sessionLines(sessions: SessionRecord[]): string[] {
  if (sessions.length === 0) return ['- No chat sessions touched this date.'];
  return sessions.slice(0, 20).map((session) => {
    const summary = session.summary ?? summarizeRecentMessages(session);
    return `- ${session.title} (${session.id}): ${session.messages.length} messages. ${summary}`;
  });
}

function ledgerLines(events: LedgerEvent[], runIds: string[]): string[] {
  if (events.length === 0) return ['- No ledger events recorded this date.'];
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  const typeCounts = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type}:${count}`)
    .join(', ');
  return [
    `- Runs: ${runIds.join(', ') || 'none'}`,
    `- Event counts: ${typeCounts}`,
  ];
}

function continuityHints(sessions: SessionRecord[], events: LedgerEvent[]): string[] {
  const hints = new Set<string>();
  for (const session of sessions) {
    const lastUserMessage = [...session.messages].reverse().find((message) => message.role === 'user');
    if (lastUserMessage?.content) hints.add(`Resume from session "${session.title}": ${truncateLine(lastUserMessage.content, 180)}`);
  }
  const blockedRuns = events.filter((event) => event.type === 'run.blocked' || event.type === 'dag.node.failed' || event.type === 'run.failed');
  for (const event of blockedRuns) hints.add(`Review blocked/failed run ${event.run_id} (${event.type}).`);
  return hints.size > 0 ? [...hints].slice(0, 10).map((hint) => `- ${hint}`) : ['- No explicit follow-up hints detected.'];
}

function summarizeRecentMessages(session: SessionRecord): string {
  const messages = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-4)
    .map((message) => `${message.role}: ${truncateLine(message.content, 120)}`);
  return messages.length > 0 ? messages.join(' | ') : 'No conversational messages.';
}

function sessionTouchesDate(session: SessionRecord, date: string): boolean {
  if (session.updatedAt.startsWith(date) || session.createdAt.startsWith(date)) return true;
  return session.messages.some((message) => message.createdAt.startsWith(date));
}

async function readLedgerEvents(eventLedger: EventLedger | undefined): Promise<LedgerEvent[]> {
  if (!eventLedger) return [];
  return eventLedger.readAll();
}

function mapRunWorkspaceIds(events: LedgerEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const event of events) {
    const eventWorkspaceId = (event as { workspace_id?: unknown }).workspace_id;
    if (event.run_id && typeof eventWorkspaceId === 'string') map.set(event.run_id, eventWorkspaceId);
  }
  return map;
}

function filterWorkspaceEvents(
  events: LedgerEvent[],
  workspaceId: string,
  runWorkspaceIds: Map<string, string>,
): LedgerEvent[] {
  return events.filter((event) => {
    const eventWorkspaceId = (event as { workspace_id?: unknown }).workspace_id;
    if (typeof eventWorkspaceId === 'string') return eventWorkspaceId === workspaceId;
    return Boolean(event.run_id && runWorkspaceIds.get(event.run_id) === workspaceId);
  });
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function truncateLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}
