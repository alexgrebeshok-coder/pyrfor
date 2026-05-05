import { createHash } from 'node:crypto';
import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { DagNode } from './durable-dag';
import type { EventLedger, LedgerEvent } from './event-ledger';
import type { BrowserSmokeSnapshot } from './browser-smoke';
import type { DeliveryEvidenceSnapshot } from './github-delivery-evidence';
import type { ResearchEvidenceSnapshot } from './research-evidence';
import type { ResearchSourceCaptureArtifactDocument } from './research-source-capture';
import type { RunLedger } from './run-ledger';
import type { SessionMessage, SessionStore } from './session-store';
import type { LoadedWorkspace, WorkspaceLoader } from './workspace-loader';
import {
  filterMemoryForScope,
  searchDurableMemoryForContext,
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
  durableMemorySearch?: typeof searchDurableMemoryForContext;
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

const EVIDENCE_ARTIFACT_LIMIT = 5;
const EVIDENCE_SOURCE_LIMIT = 3;
const EVIDENCE_TEXT_LIMIT = 400;

type ContextEvidenceArtifactKind = 'research_evidence' | 'research_source_capture' | 'browser_smoke' | 'delivery_evidence';
type ActorContextEvidenceArtifactKind = ContextEvidenceArtifactKind | 'actor_work_proof';

interface ActorWorkProofArtifactDocument {
  schemaVersion: 'pyrfor.actor_work_proof.v1';
  runId: string;
  proofRunId: string;
  actorId: string;
  nodeId: string;
  task?: unknown;
  completedAt: string;
  owner?: string;
  summary?: string;
  output?: string;
  proof?: Record<string, unknown>;
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

    const evidenceSection = await this.collectRunEvidence(input);
    if (evidenceSection) sections.push(evidenceSection);

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

  async compileRunEvidenceSection(runId: string): Promise<ContextPackSection | undefined> {
    return this.collectRunEvidence({ runId });
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
    const memorySearch = this.deps.memorySearch ?? this.deps.durableMemorySearch ?? searchDurableMemoryForContext;
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
    const projectMemory = scoped.filter(isProjectMemoryEntry);
    const nonPolicy = scoped.filter((entry) => entry.memoryType !== 'policy' && !isProjectMemoryEntry(entry));

    return [
      memorySection('memory_policy', 'Policy memory', 20, policy),
      memorySection('project_memory', 'Project memory', 65, projectMemory),
      memorySection('memory_working_set', 'Relevant memory', 70, nonPolicy),
    ].filter((section): section is ContextPackSection => section !== undefined);
  }

  private async collectRunEvidence(input: Pick<CompileContextInput, 'runId'>): Promise<ContextPackSection | undefined> {
    if (!input.runId || !this.deps.artifactStore) return undefined;
    const artifactStore = this.deps.artifactStore;
    const [summaryArtifacts, sourceArtifacts, deliveryArtifacts, actorProofArtifacts] = await Promise.all([
      artifactStore.list({ runId: input.runId, kind: 'summary' }),
      artifactStore.list({ runId: input.runId, kind: 'research_source_capture' }),
      artifactStore.list({ runId: input.runId, kind: 'delivery_evidence' }),
      this.collectActorWorkProofArtifacts(input.runId, artifactStore),
    ]);
    const artifacts = dedupeArtifacts([...summaryArtifacts, ...sourceArtifacts, ...deliveryArtifacts, ...actorProofArtifacts])
      .filter(isContextEvidenceArtifact)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, EVIDENCE_ARTIFACT_LIMIT);
    if (artifacts.length === 0) return undefined;

    const items = await Promise.all(artifacts.map((artifact) => readContextEvidenceArtifactSafe(artifactStore, artifact)));
    if (items.length === 0) return undefined;

    return makeSection({
      id: 'run_evidence',
      kind: 'evidence',
      title: 'Run evidence',
      priority: 58,
      content: { items },
      sources: artifacts.map((artifact) => ({
        kind: 'artifact',
        ref: artifact.id,
        role: 'evidence',
        ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
        meta: {
          artifactKind: contextEvidenceArtifactKind(artifact),
          createdAt: artifact.createdAt,
        },
      })),
    });
  }

  private async collectActorWorkProofArtifacts(runId: string, artifactStore: ArtifactStore): Promise<ArtifactRef[]> {
    const proofRunIds = new Set<string>([runId]);
    for (const run of this.deps.runLedger?.listRuns() ?? []) {
      if (run.parent_run_id === runId) proofRunIds.add(run.run_id);
    }
    const artifacts = await Promise.all(Array.from(proofRunIds).sort().map((proofRunId) =>
      artifactStore.list({ runId: proofRunId, kind: 'summary' })
    ));
    return artifacts.flat().filter((artifact) => isActorWorkProofArtifactForRun(artifact, runId));
  }
}

function isContextEvidenceArtifact(artifact: ArtifactRef): boolean {
  return contextEvidenceArtifactKind(artifact) !== null;
}

function contextEvidenceArtifactKind(artifact: ArtifactRef): ActorContextEvidenceArtifactKind | null {
  const logicalKind = artifact.meta?.['artifactKind'];
  if (logicalKind === 'research_evidence' || logicalKind === 'browser_smoke') return logicalKind;
  if (artifact.kind === 'research_source_capture' || logicalKind === 'research_source_capture') return 'research_source_capture';
  if (artifact.kind === 'delivery_evidence' || logicalKind === 'delivery_evidence') return 'delivery_evidence';
  if (logicalKind === 'actor_work_proof') return 'actor_work_proof';
  return null;
}

function dedupeArtifacts(artifacts: ArtifactRef[]): ArtifactRef[] {
  const seen = new Set<string>();
  const deduped: ArtifactRef[] = [];
  for (const artifact of artifacts) {
    if (seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    deduped.push(artifact);
  }
  return deduped;
}

function isActorWorkProofArtifactForRun(artifact: ArtifactRef, runId: string): boolean {
  if (contextEvidenceArtifactKind(artifact) !== 'actor_work_proof') return false;
  return artifact.runId === runId || artifact.meta?.['parentRunId'] === runId;
}

async function readContextEvidenceArtifact(artifactStore: ArtifactStore, artifact: ArtifactRef): Promise<Record<string, unknown>> {
  const artifactKind = contextEvidenceArtifactKind(artifact);
  if (artifactKind === 'research_evidence') {
    const snapshot = artifact.sha256
      ? await artifactStore.readJSONVerified<ResearchEvidenceSnapshot>(artifact, artifact.sha256)
      : await artifactStore.readJSON<ResearchEvidenceSnapshot>(artifact);
    return publicResearchEvidenceContext(artifact, snapshot);
  }
  if (artifactKind === 'research_source_capture') {
    const document = artifact.sha256
      ? await artifactStore.readJSONVerified<ResearchSourceCaptureArtifactDocument>(artifact, artifact.sha256)
      : await artifactStore.readJSON<ResearchSourceCaptureArtifactDocument>(artifact);
    return publicResearchSourceCaptureContext(artifact, document.snapshot);
  }
  if (artifactKind === 'browser_smoke') {
    const snapshot = artifact.sha256
      ? await artifactStore.readJSONVerified<BrowserSmokeSnapshot>(artifact, artifact.sha256)
      : await artifactStore.readJSON<BrowserSmokeSnapshot>(artifact);
    return publicBrowserSmokeContext(artifact, snapshot);
  }
  if (artifactKind === 'delivery_evidence') {
    const snapshot = artifact.sha256
      ? await artifactStore.readJSONVerified<DeliveryEvidenceSnapshot>(artifact, artifact.sha256)
      : await artifactStore.readJSON<DeliveryEvidenceSnapshot>(artifact);
    return publicDeliveryEvidenceContext(artifact, snapshot);
  }
  if (artifactKind === 'actor_work_proof') {
    const proof = artifact.sha256
      ? await artifactStore.readJSONVerified<ActorWorkProofArtifactDocument>(artifact, artifact.sha256)
      : await artifactStore.readJSON<ActorWorkProofArtifactDocument>(artifact);
    return publicActorWorkProofContext(artifact, proof);
  }
  throw new Error(`ContextCompiler: unsupported evidence artifact ${artifact.id}`);
}

async function readContextEvidenceArtifactSafe(artifactStore: ArtifactStore, artifact: ArtifactRef): Promise<Record<string, unknown>> {
  try {
    return await readContextEvidenceArtifact(artifactStore, artifact);
  } catch (error) {
    return {
      artifactKind: contextEvidenceArtifactKind(artifact) ?? 'unknown',
      artifactId: artifact.id,
      ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
      createdAt: artifact.createdAt,
      status: 'evidence_unavailable',
      reason: sanitizeContextEvidenceText(error instanceof Error ? error.message : String(error), 200),
    };
  }
}

function publicResearchEvidenceContext(artifact: ArtifactRef, snapshot: ResearchEvidenceSnapshot): Record<string, unknown> {
  return {
    artifactKind: 'research_evidence',
    artifactId: artifact.id,
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
    createdAt: snapshot.createdAt,
    sourceMode: snapshot.sourceMode,
    queryHash: snapshot.queryHash,
    queryPreview: sanitizeContextEvidenceText(snapshot.query, 160),
    sourceCount: snapshot.sources.length,
    sources: snapshot.sources.slice(0, EVIDENCE_SOURCE_LIMIT).map((source) => ({
      host: hostFromHttpUrl(source.url),
      urlHash: hashText(source.url),
      ...(source.title ? { title: sanitizeContextEvidenceText(source.title, 160) } : {}),
      ...(source.snippet ? { snippet: sanitizeContextEvidenceText(source.snippet, EVIDENCE_TEXT_LIMIT) } : {}),
      ...(source.observedAt ? { observedAt: sanitizeContextEvidenceText(source.observedAt, 80) } : {}),
    })),
    ...(snapshot.summary ? { summary: sanitizeContextEvidenceText(snapshot.summary, EVIDENCE_TEXT_LIMIT) } : {}),
    ...(snapshot.conclusion ? { conclusion: sanitizeContextEvidenceText(snapshot.conclusion, EVIDENCE_TEXT_LIMIT) } : {}),
    notes: snapshot.notes.slice(0, 3).map((note) => sanitizeContextEvidenceText(note, 200)),
    effects: snapshot.effectsExecuted.map((effect) => ({
      kind: effect.kind,
      provider: effect.provider,
      executedAt: effect.executedAt,
      maxResults: effect.maxResults,
      resultCount: effect.resultCount,
    })),
  };
}

function publicResearchSourceCaptureContext(
  artifact: ArtifactRef,
  snapshot: ResearchSourceCaptureArtifactDocument['snapshot'],
): Record<string, unknown> {
  return {
    artifactKind: 'research_source_capture',
    artifactId: artifact.id,
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
    createdAt: snapshot.createdAt,
    sourceMode: snapshot.sourceMode,
    requestedHost: snapshot.requestedHost,
    requestedUrlHash: snapshot.requestedUrlHash,
    requestedPathHash: snapshot.requestedPathHash,
    finalHost: snapshot.finalHost,
    finalUrlHash: snapshot.finalUrlHash,
    statusCode: snapshot.statusCode,
    contentType: snapshot.contentType,
    contentHash: snapshot.contentHash,
    capturedBytes: snapshot.capturedBytes,
    truncated: snapshot.truncated,
    ...(snapshot.title ? { title: sanitizeContextEvidenceText(snapshot.title, 160) } : {}),
    excerpt: sanitizeContextEvidenceText(snapshot.excerpt, EVIDENCE_TEXT_LIMIT),
    ...(snapshot.note ? { note: sanitizeContextEvidenceText(snapshot.note, 200) } : {}),
  };
}

function publicBrowserSmokeContext(artifact: ArtifactRef, snapshot: BrowserSmokeSnapshot): Record<string, unknown> {
  return {
    artifactKind: 'browser_smoke',
    artifactId: artifact.id,
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
    createdAt: snapshot.createdAt,
    sourceMode: snapshot.sourceMode,
    status: snapshot.status,
    targetHost: snapshot.targetHost,
    targetUrlHash: snapshot.targetUrlHash,
    targetPathHash: snapshot.targetPathHash,
    finalHost: snapshot.finalHost,
    finalUrlHash: snapshot.finalUrlHash,
    title: sanitizeContextEvidenceText(snapshot.title, 160),
    screenshotArtifactId: snapshot.screenshot.artifactId,
    ...(snapshot.assertion ? {
      assertion: {
        ...(snapshot.assertion.selector ? { selector: sanitizeContextEvidenceText(snapshot.assertion.selector, 120) } : {}),
        ...(snapshot.assertion.containsTextHash ? { containsTextHash: snapshot.assertion.containsTextHash } : {}),
        matched: snapshot.assertion.matched,
      },
    } : {}),
  };
}

function publicDeliveryEvidenceContext(artifact: ArtifactRef, snapshot: DeliveryEvidenceSnapshot): Record<string, unknown> {
  return {
    artifactKind: 'delivery_evidence',
    artifactId: artifact.id,
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
    createdAt: snapshot.capturedAt,
    verifierStatus: snapshot.verifierStatus,
    ...(snapshot.summary ? { summary: sanitizeContextEvidenceText(snapshot.summary, EVIDENCE_TEXT_LIMIT) } : {}),
    ...(snapshot.deliveryArtifactId ? { deliveryArtifactId: snapshot.deliveryArtifactId } : {}),
    deliveryChecklist: snapshot.deliveryChecklist.slice(0, 5).map((item) => sanitizeContextEvidenceText(item, 160)),
    verifier: snapshot.verifier ? {
      status: snapshot.verifier.status,
      ...(snapshot.verifier.rawStatus ? { rawStatus: snapshot.verifier.rawStatus } : {}),
      ...(snapshot.verifier.waivedFrom ? { waivedFrom: snapshot.verifier.waivedFrom } : {}),
      ...(snapshot.verifier.waiverArtifactId ? { waiverArtifactId: snapshot.verifier.waiverArtifactId } : {}),
      ...(snapshot.verifier.reason ? { reason: sanitizeContextEvidenceText(snapshot.verifier.reason, 200) } : {}),
    } : undefined,
    git: {
      available: snapshot.git.available,
      ...(snapshot.git.branch ? { branch: sanitizeContextEvidenceText(snapshot.git.branch, 120) } : {}),
      ...(snapshot.git.headSha ? { headSha: snapshot.git.headSha } : {}),
      ahead: snapshot.git.ahead,
      behind: snapshot.git.behind,
      dirtyFileCount: snapshot.git.dirtyFiles.length,
      latestCommits: snapshot.git.latestCommits.slice(0, 3).map((commit) => ({
        sha: commit.sha,
        subject: sanitizeContextEvidenceText(commit.subject, 160),
        ...(commit.author ? { author: sanitizeContextEvidenceText(commit.author, 120) } : {}),
      })),
      ...(snapshot.git.remote?.repository ? { remoteRepository: sanitizeContextEvidenceText(snapshot.git.remote.repository, 120) } : {}),
      ...(snapshot.git.error ? { error: sanitizeContextEvidenceText(snapshot.git.error, 200) } : {}),
    },
    github: {
      available: snapshot.github.available,
      ...(snapshot.github.repository ? { repository: sanitizeContextEvidenceText(snapshot.github.repository, 120) } : {}),
      branch: snapshot.github.branch ? {
        name: sanitizeContextEvidenceText(snapshot.github.branch.name, 120),
        protected: snapshot.github.branch.protected,
        ...(snapshot.github.branch.commitSha ? { commitSha: snapshot.github.branch.commitSha } : {}),
        ...(snapshot.github.branch.url ? { urlHost: hostFromHttpUrl(snapshot.github.branch.url), urlHash: hashText(snapshot.github.branch.url) } : {}),
      } : null,
      pullRequests: snapshot.github.pullRequests.slice(0, 3).map((pullRequest) => ({
        number: pullRequest.number,
        state: pullRequest.state,
        ...(pullRequest.title ? { title: sanitizeContextEvidenceText(pullRequest.title, 160) } : {}),
        ...(pullRequest.headRef ? { headRef: sanitizeContextEvidenceText(pullRequest.headRef, 120) } : {}),
        ...(pullRequest.baseRef ? { baseRef: sanitizeContextEvidenceText(pullRequest.baseRef, 120) } : {}),
        urlHost: hostFromHttpUrl(pullRequest.url),
        urlHash: hashText(pullRequest.url),
      })),
      workflowRuns: snapshot.github.workflowRuns.slice(0, 3).map((workflowRun) => ({
        id: workflowRun.id,
        ...(workflowRun.name ? { name: sanitizeContextEvidenceText(workflowRun.name, 120) } : {}),
        ...(workflowRun.status ? { status: workflowRun.status } : {}),
        ...(workflowRun.conclusion !== undefined ? { conclusion: workflowRun.conclusion } : {}),
        ...(workflowRun.headSha ? { headSha: workflowRun.headSha } : {}),
        ...(workflowRun.url ? { urlHost: hostFromHttpUrl(workflowRun.url), urlHash: hashText(workflowRun.url) } : {}),
      })),
      issue: snapshot.github.issue ? {
        number: snapshot.github.issue.number,
        ...(snapshot.github.issue.state ? { state: snapshot.github.issue.state } : {}),
        ...(snapshot.github.issue.title ? { title: sanitizeContextEvidenceText(snapshot.github.issue.title, 160) } : {}),
        ...(snapshot.github.issue.url ? { urlHost: hostFromHttpUrl(snapshot.github.issue.url), urlHash: hashText(snapshot.github.issue.url) } : {}),
      } : null,
      errors: snapshot.github.errors.slice(0, 3).map((error) => ({
        scope: sanitizeContextEvidenceText(error.scope, 120),
        ...(error.status !== undefined ? { status: error.status } : {}),
        message: sanitizeContextEvidenceText(error.message, 200),
      })),
    },
  };
}

function publicActorWorkProofContext(artifact: ArtifactRef, proof: ActorWorkProofArtifactDocument): Record<string, unknown> {
  return {
    artifactKind: 'actor_work_proof',
    artifactId: artifact.id,
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
    createdAt: proof.completedAt,
    runId: proof.runId,
    proofRunId: proof.proofRunId,
    actorId: sanitizeContextEvidenceText(proof.actorId, 120),
    nodeId: sanitizeContextEvidenceText(proof.nodeId, 120),
    ...(proof.owner ? { owner: sanitizeContextEvidenceText(proof.owner, 120) } : {}),
    ...(proof.task !== undefined ? { task: sanitizeContextEvidenceText(proof.task, 200) } : {}),
    ...(proof.summary ? { summary: sanitizeContextEvidenceText(proof.summary, EVIDENCE_TEXT_LIMIT) } : {}),
    ...(proof.output ? { output: sanitizeContextEvidenceText(proof.output, EVIDENCE_TEXT_LIMIT) } : {}),
  };
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

const SENSITIVE_CONTEXT_TEXT_RE = /\b(?:gh[pousr]_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+)\b|\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|credential|signature|authorization|api[-_]?key|access[-_]?key|awsaccesskeyid|key[-_]?pair[-_]?id)[A-Za-z0-9_.-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;\n]+)/gi;

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sanitizeContextEvidenceText(value: unknown, maxChars: number): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw
    .replace(/https?:\/\/[^\s'"`<>),]+/gi, (match) => {
      const host = hostFromHttpUrl(match);
      return host ? `[redacted-url host=${host} hash=${hashText(match).slice(0, 16)}]` : '[redacted-url]';
    })
    .replace(SENSITIVE_CONTEXT_TEXT_RE, '[redacted-token]')
    .replace(SECRET_ASSIGNMENT_RE, '$1=[redacted]')
    .replace(/file:\/\/[^\s'"`<>),]+/g, '[redacted-file-uri]')
    .replace(/\b[A-Za-z]:\\[^\s'"`<>),]+/g, '[redacted-path]')
    .replace(/\\\\[^\s\\/"'`<>),]+\\[^\s'"`<>),]+/g, '[redacted-path]')
    .replace(/(^|[^:])\/\/(?:Users|home|var|tmp|private|Volumes)\b[^\s'"`<>),]*/g, '$1/[redacted-path]')
    .replace(/(^|[\s'"`(=:-])\/(?!\/)(?=[^\s'"`<>),]*\/)[^\s'"`<>),]+/g, '$1[redacted-path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function hostFromHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.host;
  } catch {
    return undefined;
  }
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
    projectMemoryCategory: typeof entry.metadata?.projectMemoryCategory === 'string'
      ? entry.metadata.projectMemoryCategory
      : undefined,
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

function isProjectMemoryEntry(entry: MemoryEntry): boolean {
  return typeof entry.metadata?.projectMemoryCategory === 'string';
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
