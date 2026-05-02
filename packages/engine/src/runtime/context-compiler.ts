import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { DagNode } from './durable-dag';
import type { EventLedger, LedgerEvent } from './event-ledger';
import type { RunLedger } from './run-ledger';
import type { SessionMessage, SessionStore } from './session-store';
import type { LoadedWorkspace, WorkspaceLoader } from './workspace-loader';
import {
  filterMemoryForScope,
  searchMemory,
  type MemoryEntry,
  type MemoryScopeFilter,
  type MemoryType,
} from '../ai/memory/agent-memory-store';
import {
  type ContextMemoryEntry,
  type ContextPack,
  type ContextPackSection,
  type ContextSourceRef,
  type ContextTaskContract,
  hashContextPack,
  stableStringify,
  withContextPackHash,
} from './context-pack';

export interface ContextFileInput {
  path: string;
  content: string;
  sha256?: string;
}

export interface ContextFactInput {
  id: string;
  content: unknown;
  source?: ContextSourceRef;
}

export interface ContextCompilerDeps {
  artifactStore?: ArtifactStore;
  eventLedger?: EventLedger;
  runLedger?: RunLedger;
  dag?: { listNodes(): DagNode[] };
  sessionStore?: SessionStore;
  workspace?: LoadedWorkspace;
  workspaceLoader?: WorkspaceLoader;
  memorySearch?: typeof searchMemory;
}

export interface CompileContextInput {
  runId?: string;
  workspaceId: string;
  projectId?: string;
  task: ContextTaskContract;
  compiledAt?: string;
  agentId?: string;
  query?: string;
  memoryTypes?: MemoryType[];
  memoryLimit?: number;
  memoryScope?: MemoryScopeFilter;
  filesOfInterest?: ContextFileInput[];
  historyRunIds?: string[];
  ledgerEventLimit?: number;
  sessionId?: string;
  sessionMessageLimit?: number;
  policyFacts?: ContextFactInput[];
  domainFacts?: ContextFactInput[];
}

export interface CompileContextResult {
  pack: ContextPack;
  hash: string;
  canonicalJson: string;
}

export class ContextCompiler {
  private readonly deps: ContextCompilerDeps;

  constructor(deps: ContextCompilerDeps = {}) {
    this.deps = deps;
  }

  async compile(input: CompileContextInput): Promise<CompileContextResult> {
    const sections: ContextPackSection[] = [];

    sections.push(makeSection({
      id: 'task_contract',
      kind: 'task_contract',
      title: 'Task contract',
      priority: 10,
      content: input.task,
      sources: [{ kind: 'task', ref: input.task.id ?? input.runId ?? 'task', role: 'input' }],
    }));

    const workspace = inputWorkspace(this.deps);
    const policySection = collectPolicySection(workspace, input.policyFacts ?? []);
    if (policySection) sections.push(policySection);

    const workspaceSection = collectWorkspaceSection(workspace);
    if (workspaceSection) sections.push(workspaceSection);

    const filesSection = collectFilesOfInterest(input.filesOfInterest ?? []);
    if (filesSection) sections.push(filesSection);

    const ledgerSection = await this.collectLedgerHistory(input);
    if (ledgerSection) sections.push(ledgerSection);

    const sessionSection = await this.collectSessionHistory(input);
    if (sessionSection) sections.push(sessionSection);

    const dagSection = collectDependencyGraph(this.deps.dag);
    if (dagSection) sections.push(dagSection);

    const memorySections = await this.collectMemory(input);
    sections.push(...memorySections);

    const domainSection = collectDomainFacts(input.domainFacts ?? []);
    if (domainSection) sections.push(domainSection);

    const sortedSections = sections.sort(compareSections);
    const sourceRefs = sortedSections
      .flatMap((section) => section.sources)
      .sort(compareSourceRefs);

    const withoutHash: Omit<ContextPack, 'hash'> = {
      schemaVersion: 'context_pack.v1',
      packId: `ctx:${input.runId ?? input.task.id ?? input.workspaceId}`,
      compiledAt: input.compiledAt ?? new Date().toISOString(),
      runId: input.runId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      task: input.task,
      sections: sortedSections,
      sourceRefs,
    };
    const pack = withContextPackHash(withoutHash);

    return {
      pack,
      hash: pack.hash,
      canonicalJson: stableStringify(withoutHash),
    };
  }

  async persist(
    result: CompileContextResult,
    opts: { artifactStore?: ArtifactStore; runId?: string } = {},
  ): Promise<ArtifactRef> {
    const artifactStore = opts.artifactStore ?? this.deps.artifactStore;
    if (!artifactStore) throw new Error('ContextCompiler: artifactStore is required to persist context packs');

    return artifactStore.writeJSON('context_pack', result.pack, {
      runId: opts.runId ?? result.pack.runId,
      meta: {
        context_hash: result.hash,
        schemaVersion: result.pack.schemaVersion,
      },
    });
  }

  private async collectLedgerHistory(input: CompileContextInput): Promise<ContextPackSection | undefined> {
    const runIds = input.historyRunIds ?? (input.runId ? [input.runId] : []);
    if (runIds.length === 0) return undefined;

    const events: LedgerEvent[] = [];
    for (const runId of [...runIds].sort()) {
      const runEvents = this.deps.runLedger
        ? await this.deps.runLedger.eventsForRun(runId)
        : await this.deps.eventLedger?.byRun(runId);
      events.push(...(runEvents ?? []));
    }

    const limited = events
      .sort((a, b) => a.seq - b.seq || a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id))
      .slice(-(input.ledgerEventLimit ?? 50));
    if (limited.length === 0) return undefined;

    return makeSection({
      id: 'ledger_history',
      kind: 'ledger',
      title: 'Ledger history',
      priority: 50,
      content: limited.map((event) => ({
        id: event.id,
        seq: event.seq,
        ts: event.ts,
        type: event.type,
        run_id: event.run_id,
      })),
      sources: limited.map((event) => ({
        kind: 'ledger_event',
        ref: event.id,
        role: 'history',
        meta: { run_id: event.run_id, type: event.type, seq: event.seq },
      })),
    });
  }

  private async collectSessionHistory(input: CompileContextInput): Promise<ContextPackSection | undefined> {
    if (!input.sessionId || !this.deps.sessionStore) return undefined;

    const session = await this.deps.sessionStore.get(input.workspaceId, input.sessionId);
    if (!session) return undefined;

    const content = session.summary
      ? { sessionId: session.id, title: session.title, summary: session.summary }
      : {
          sessionId: session.id,
          title: session.title,
          messages: cloneSessionMessages(session.messages.slice(-(input.sessionMessageLimit ?? 10))),
        };

    return makeSection({
      id: 'session_history',
      kind: 'session',
      title: 'Session history',
      priority: 60,
      content,
      sources: [{ kind: 'session', ref: session.id, role: 'history' }],
    });
  }

  private async collectMemory(input: CompileContextInput): Promise<ContextPackSection[]> {
    if (!input.agentId) return [];

    const query = input.query ?? [
      input.task.title,
      input.task.description,
      ...(input.task.acceptanceCriteria ?? []),
    ].filter(Boolean).join('\n');
    const memorySearch = this.deps.memorySearch ?? searchMemory;
    const memoryTypes = input.memoryTypes ?? ['policy', 'episodic', 'semantic', 'procedural'];
    const scope = input.memoryScope ?? {
      visibility: input.projectId ? 'project' : 'workspace',
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    } satisfies MemoryScopeFilter;

    const results: MemoryEntry[] = [];
    for (const memoryType of memoryTypes) {
      const entries = await memorySearch({
        agentId: input.agentId,
        query,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        memoryType,
        limit: input.memoryLimit ?? 8,
      });
      results.push(...entries);
    }

    const seen = new Set<string>();
    const scoped = filterMemoryForScope(results, scope)
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .sort(compareMemoryEntries);

    const policy = scoped.filter((entry) => entry.memoryType === 'policy');
    const nonPolicy = scoped.filter((entry) => entry.memoryType !== 'policy');

    return [
      memorySection('memory_policy', 'Policy memory', 20, policy),
      memorySection('memory_working_set', 'Relevant memory', 70, nonPolicy),
    ].filter((section): section is ContextPackSection => section !== undefined);
  }
}

function inputWorkspace(deps: ContextCompilerDeps): LoadedWorkspace | null {
  return deps.workspace ?? deps.workspaceLoader?.getWorkspace() ?? null;
}

function collectPolicySection(
  workspace: LoadedWorkspace | null,
  policyFacts: ContextFactInput[],
): ContextPackSection | undefined {
  const workspacePolicy = workspace
    ? [
        { path: 'AGENTS.md', content: workspace.files.agents },
        { path: 'TOOLS.md', content: workspace.files.tools },
      ].filter((file) => file.content.length > 0)
    : [];
  if (workspacePolicy.length === 0 && policyFacts.length === 0) return undefined;
  const facts = [...policyFacts].sort((a, b) => a.id.localeCompare(b.id));

  return makeSection({
    id: 'policy',
    kind: 'policy',
    title: 'Policy and tool constraints',
    priority: 15,
    content: {
      workspaceFiles: workspacePolicy,
      facts: facts.map((fact) => ({ id: fact.id, content: fact.content })),
    },
    sources: [
      ...workspacePolicy.map((file) => ({
        kind: 'workspace_file' as const,
        ref: file.path,
        role: 'policy' as const,
      })),
      ...facts.map((fact) => fact.source ?? ({
        kind: 'policy' as const,
        ref: fact.id,
        role: 'policy' as const,
      })),
    ],
  });
}

function collectWorkspaceSection(workspace: LoadedWorkspace | null): ContextPackSection | undefined {
  if (!workspace) return undefined;
  const files = [
    { path: 'IDENTITY.md', content: workspace.files.identity },
    { path: 'SOUL.md', content: workspace.files.soul },
    { path: 'USER.md', content: workspace.files.user },
    { path: 'MEMORY.md', content: workspace.files.memory },
    { path: 'HEARTBEAT.md', content: workspace.files.heartbeat },
    ...Array.from(workspace.files.daily.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, content]) => ({ path: `memory/${date}.md`, content })),
    ...workspace.files.skills.map((content, index) => ({ path: `SKILL-${index}.md`, content })),
  ].filter((file) => file.content.length > 0);
  if (files.length === 0) return undefined;

  return makeSection({
    id: 'workspace_files',
    kind: 'workspace',
    title: 'Workspace memory files',
    priority: 30,
    content: files,
    sources: files.map((file) => ({ kind: 'workspace_file', ref: file.path, role: 'input' })),
  });
}

function collectFilesOfInterest(filesOfInterest: ContextFileInput[]): ContextPackSection | undefined {
  const files = [...filesOfInterest].sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) return undefined;

  return makeSection({
    id: 'files_of_interest',
    kind: 'files',
    title: 'Files of interest',
    priority: 40,
    content: files,
    sources: files.map((file) => ({
      kind: 'file',
      ref: file.path,
      role: 'input',
      sha256: file.sha256,
    })),
  });
}

function collectDependencyGraph(dag: ContextCompilerDeps['dag']): ContextPackSection | undefined {
  const nodes = dag?.listNodes().sort((a, b) => a.id.localeCompare(b.id)) ?? [];
  if (nodes.length === 0) return undefined;

  return makeSection({
    id: 'dependency_graph',
    kind: 'dag',
    title: 'Dependency graph',
    priority: 55,
    content: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      status: node.status,
      dependsOn: [...node.dependsOn].sort(),
      attempts: node.attempts,
      provenance: node.provenance,
    })),
    sources: nodes.map((node) => ({ kind: 'dag_node', ref: node.id, role: 'evidence' })),
  });
}

function collectDomainFacts(domainFacts: ContextFactInput[]): ContextPackSection | undefined {
  const facts = [...domainFacts].sort((a, b) => a.id.localeCompare(b.id));
  if (facts.length === 0) return undefined;

  return makeSection({
    id: 'domain_facts',
    kind: 'domain',
    title: 'Domain facts',
    priority: 80,
    content: facts.map((fact) => ({ id: fact.id, content: fact.content })),
    sources: facts.map((fact) => fact.source ?? ({
      kind: 'domain_fact',
      ref: fact.id,
      role: 'input',
    })),
  });
}

function memorySection(
  id: string,
  title: string,
  priority: number,
  entries: MemoryEntry[],
): ContextPackSection | undefined {
  if (entries.length === 0) return undefined;
  const content: ContextMemoryEntry[] = entries.map((entry) => ({
    id: entry.id,
    memoryType: entry.memoryType,
    content: entry.content,
    summary: entry.summary,
    importance: entry.importance,
    provenance: entry.metadata?.provenance,
    scope: entry.metadata?.scope,
    confidence: entry.metadata?.confidence,
    lastValidatedAt: entry.metadata?.lastValidatedAt,
    frozen: entry.metadata?.frozen,
  }));

  return makeSection({
    id,
    kind: 'memory',
    title,
    priority,
    content,
    sources: entries.map((entry) => ({ kind: 'memory', ref: entry.id, role: 'memory' })),
  });
}

function makeSection(input: ContextPackSection): ContextPackSection {
  return {
    ...input,
    sources: [...input.sources].sort(compareSourceRefs),
  };
}

function cloneSessionMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages
    .map((message) => ({
      ...message,
      toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
      metadata: message.metadata ? { ...message.metadata } : undefined,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function compareSections(a: ContextPackSection, b: ContextPackSection): number {
  return a.priority - b.priority || a.id.localeCompare(b.id);
}

function compareSourceRefs(a: ContextSourceRef, b: ContextSourceRef): number {
  return (
    a.kind.localeCompare(b.kind) ||
    a.ref.localeCompare(b.ref) ||
    a.role.localeCompare(b.role)
  );
}

function compareMemoryEntries(a: MemoryEntry, b: MemoryEntry): number {
  if (a.memoryType !== b.memoryType) {
    const rank: Record<MemoryType, number> = { policy: 0, semantic: 1, procedural: 2, episodic: 3 };
    return rank[a.memoryType] - rank[b.memoryType];
  }
  return b.importance - a.importance || a.id.localeCompare(b.id);
}

export { hashContextPack };
