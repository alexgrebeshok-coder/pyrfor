// Re-export port helpers so existing importers (useDaemonHealth, etc.) are unaffected
export { getDaemonPort, getApiBase } from './apiFetch';
import { daemonFetch } from './apiFetch';
import { getCloudFallbackConfig, chatStreamCloud } from './cloudFallback';
export { getCloudFallbackConfig, setCloudFallbackConfig, CloudFallbackUnavailableError } from './cloudFallback';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Backward-compatible thin wrapper — prepends daemon URL and adds auth. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return daemonFetch(path, init);
}

async function apiCall<T>(
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  let url = path;
  if (opts.query) {
    const params = new URLSearchParams(opts.query);
    url = `${path}?${params}`;
  }

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await daemonFetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new ApiError(
      data.error || `HTTP ${res.status}`,
      data.code || String(res.status),
      res.status
    );
  }
  return data as T;
}

export interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedMs?: number;
}

export interface FsListResult {
  path: string;
  entries: FsEntry[];
}
export interface FsReadResult {
  path: string;
  content: string;
  size: number;
}
export interface FsSearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}
export interface FsSearchResult {
  query: string;
  hits: FsSearchHit[];
  truncated: boolean;
}
export interface ChatResult {
  reply: string;
  model?: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
}
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}
export interface DashboardResult {
  model?: string;
  workspaceRoot?: string;
  cwd?: string;
  orchestration?: OrchestrationDashboard;
}
export interface WorkspaceResult {
  workspaceRoot: string;
  cwd: string;
}
export interface ApprovalRequest {
  id: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
  run_id?: string;
  effect_id?: string;
  effect_kind?: string;
  policy_id?: string;
  reason?: string;
  approval_required?: boolean;
}

export interface PendingEffect {
  id: string;
  effect_id: string;
  run_id?: string;
  effect_kind?: string;
  tool?: string;
  preview?: string;
  idempotency_key?: string;
  proposed_event_id?: string;
  proposed_seq?: number;
  ts?: string;
  decision?: string;
  policy_id?: string;
  reason?: string;
  approval_required?: boolean;
}

export type OperatorStreamEvent =
  | {
      type: 'snapshot';
      dashboard?: OrchestrationDashboard;
      runs?: RunRecord[];
      approvals?: ApprovalRequest[];
      effects?: PendingEffect[];
    }
  | { type: 'ledger'; event: AuditEvent }
  | { type: 'approval-requested'; request: ApprovalRequest }
  | { type: 'approval-resolved'; request: ApprovalRequest; decision: 'approve' | 'deny' | 'timeout' }
  | { type: 'approval-audit'; event: AuditEvent };
export interface AuditEvent {
  id: string;
  ts: string;
  type: string;
  requestId?: string;
  toolName?: string;
  summary?: string;
  args?: Record<string, unknown>;
  decision?: 'approve' | 'deny' | 'timeout';
  sessionId?: string;
  toolCallId?: string;
  resultSummary?: string;
  error?: string;
  undo?: { supported: boolean; kind?: string };
  run_id?: string;
  seq?: number;
  effect_id?: string;
  reason?: string;
  status?: string;
}

export interface RunRecord {
  run_id: string;
  task_id: string;
  parent_run_id?: string;
  workspace_id: string;
  repo_id: string;
  branch_or_worktree_id: string;
  mode: 'chat' | 'edit' | 'autonomous' | 'pm';
  status: string;
  artifact_refs: string[];
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface DagNode {
  id: string;
  kind: string;
  status: string;
  dependsOn: string[];
  payload: Record<string, unknown>;
  provenance: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface DomainOverlayManifest {
  schemaVersion: 'domain_overlay.v1';
  domainId: string;
  version: string;
  title: string;
  workflowTemplates?: unknown[];
  adapterRegistrations?: unknown[];
  [key: string]: unknown;
}

export interface ArtifactRef {
  id: string;
  kind: string;
  uri: string;
  sha256?: string;
  bytes?: number;
  createdAt: string;
  runId?: string;
  meta?: Record<string, unknown>;
}

export interface DeliveryEvidenceGitSnapshot {
  available: boolean;
  branch: string | null;
  headSha: string | null;
  ahead: number;
  behind: number;
  dirtyFiles: Array<{ path: string; x: string; y: string }>;
  latestCommits: Array<{ sha: string; author: string; dateUnix: number; subject: string }>;
  remote?: {
    name: string;
    url: string;
    repository?: string;
  } | null;
  error?: string;
}

export interface DeliveryEvidenceSnapshot {
  schemaVersion: 'pyrfor.delivery_evidence.v1';
  capturedAt: string;
  runId: string;
  summary?: string;
  verifierStatus?: string;
  deliveryChecklist: string[];
  deliveryArtifactId?: string;
  verifier?: {
    status: string;
    rawStatus?: string;
    waivedFrom?: string;
    reason?: string;
    waiverArtifactId?: string;
  };
  git: DeliveryEvidenceGitSnapshot;
  github: {
    provider: 'github';
    available: boolean;
    repository: string | null;
    branch: {
      name: string;
      protected?: boolean;
      commitSha?: string;
      url?: string;
    } | null;
    pullRequests: Array<{
      number: number;
      title?: string;
      state: 'open' | 'closed' | 'merged';
      url: string;
      headRef?: string;
      baseRef?: string;
    }>;
    workflowRuns: Array<{
      id: number;
      name?: string;
      status?: string;
      conclusion?: string | null;
      url?: string;
      headSha?: string;
    }>;
    issue?: {
      number: number;
      title?: string;
      state?: string;
      url?: string;
    } | null;
    errors: Array<{ scope: string; status?: number; message: string }>;
  };
}

export interface DeliveryEvidenceResponse {
  artifact: ArtifactRef | null;
  snapshot: DeliveryEvidenceSnapshot | null;
}

export interface GitHubDeliveryPlan {
  schemaVersion: 'pyrfor.github_delivery_plan.v1';
  createdAt: string;
  runId: string;
  mode: 'dry_run';
  applySupported: boolean;
  approvalRequired: true;
  repository: string | null;
  baseBranch: string | null;
  headSha: string | null;
  proposedBranch: string;
  pullRequest: {
    title: string;
    body: string;
    draft: true;
  };
  issue?: {
    number: number;
    commentBody: string;
  };
  ci: {
    observeWorkflowRuns: Array<{
      id: number;
      name?: string;
      status?: string;
      conclusion?: string | null;
      url?: string;
    }>;
  };
  blockers: string[];
  evidenceArtifactId?: string;
  provenance?: {
    repository: string | null;
    baseBranch: string | null;
    headSha: string | null;
    evidenceArtifactId?: string;
  };
}

export interface GitHubDeliveryPlanResponse {
  artifact: ArtifactRef | null;
  plan: GitHubDeliveryPlan | null;
  evidenceArtifact?: ArtifactRef;
}

export interface GitHubDeliveryApplyRequest {
  planArtifactId: string;
  expectedPlanSha256: string;
  approvalId?: string;
}

export interface GitHubDraftPullRequestResult {
  number: number;
  url: string;
  title: string;
  state: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
}

export interface GitHubDeliveryApplyResult {
  schemaVersion: 'pyrfor.github_delivery_apply.v1';
  appliedAt: string;
  mode: 'draft_pr';
  runId: string;
  repository: string;
  baseBranch: string;
  branch: string;
  headSha: string;
  planArtifactId: string;
  planSha256: string;
  evidenceArtifactId?: string;
  approvalId: string;
  idempotencyKey: string;
  draftPullRequest: GitHubDraftPullRequestResult;
}

export interface GitHubDeliveryApplyPending {
  status: 'awaiting_approval';
  approval: ApprovalRequest;
  planArtifactId: string;
  expectedPlanSha256: string;
}

export interface GitHubDeliveryApplyApplied {
  status: 'applied';
  artifact: ArtifactRef;
  result: GitHubDeliveryApplyResult;
}

export type GitHubDeliveryApplyResponse = GitHubDeliveryApplyPending | GitHubDeliveryApplyApplied;

export interface GitHubDeliveryApplyState {
  artifact: ArtifactRef | null;
  result: GitHubDeliveryApplyResult | null;
}

export type VerifierWaiverScope = 'run' | 'delivery' | 'delivery_plan' | 'delivery_apply' | 'all';

export interface VerifierWaiverRecord {
  schemaVersion: 'pyrfor.verifier_waiver.v1';
  runId: string;
  verifierRunId?: string;
  verifierArtifactId?: string;
  verifierEventId?: string;
  rawStatus: 'passed' | 'warning' | 'failed' | 'blocked';
  operator: {
    id: string;
    name?: string;
  };
  reason: string;
  scope: VerifierWaiverScope;
  waivedAt: string;
}

export interface VerifierDecision {
  status: 'passed' | 'warning' | 'failed' | 'blocked' | 'waived';
  rawStatus: 'passed' | 'warning' | 'failed' | 'blocked';
  reason?: string;
  findings?: number;
  verifierRunId?: string;
  verifierArtifactId?: string;
  verifierEventId?: string;
  decidedAt?: string;
  waivedFrom?: 'passed' | 'warning' | 'failed' | 'blocked';
  waiverArtifact?: ArtifactRef;
  waiver?: VerifierWaiverRecord;
  waiverEligible: boolean;
  waiverPath: string;
}

export interface VerifierStatusResponse {
  decision: VerifierDecision;
}

export interface VerifierWaiverResponse {
  artifact: ArtifactRef;
  waiver: VerifierWaiverRecord;
  decision: VerifierDecision;
  run: RunRecord;
}

export interface OrchestrationDashboard {
  runs: {
    total: number;
    active: number;
    blocked: number;
    latest: RunRecord[];
  };
  dag: {
    total: number;
    ready: number;
    running: number;
    blocked: number;
  };
  effects: {
    pending: number;
  };
  approvals: {
    pending: number;
  };
  verifier: {
    blocked: number;
    status?: string | null;
    latest?: AuditEvent | null;
  };
  workerFrames: {
    total: number;
    pending: number;
    lastType?: string | null;
  };
  contextPack: ArtifactRef | null;
  overlays: {
    total: number;
    domainIds: string[];
  };
}

export type ProductFactoryTemplateId =
  | 'feature'
  | 'refactor'
  | 'bugfix'
  | 'bot_workflow'
  | 'ochag_family_reminder'
  | 'business_brief'
  | 'ui_scaffold';

export interface ProductFactoryClarification {
  id: string;
  question: string;
  required: boolean;
}

export interface ProductFactoryTemplate {
  id: ProductFactoryTemplateId;
  title: string;
  description: string;
  recommendedDomainIds: string[];
  clarifications: ProductFactoryClarification[];
  deliveryArtifacts: string[];
  qualityGates: string[];
}

export interface ProductFactoryPlanInput {
  templateId: ProductFactoryTemplateId;
  prompt: string;
  answers?: Record<string, string>;
  domainIds?: string[];
}

export interface ProductFactoryPlanPreview {
  intent: {
    id: string;
    templateId: ProductFactoryTemplateId;
    title: string;
    goal: string;
    domainIds: string[];
  };
  template: ProductFactoryTemplate;
  missingClarifications: ProductFactoryClarification[];
  scopedPlan: {
    objective: string;
    scope: string[];
    assumptions: string[];
    risks: string[];
    qualityGates: string[];
  };
  dagPreview: {
    nodes: Array<{
      id?: string;
      kind: string;
      dependsOn?: string[];
      payload?: Record<string, unknown>;
    }>;
  };
  deliveryChecklist: string[];
}

export interface WorkerFrameSummary {
  nodeId: string;
  frame_id: string;
  type: string;
  source?: unknown;
  disposition?: unknown;
  ok?: unknown;
  seq?: unknown;
  ts?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export type RunControlAction = 'replay' | 'continue' | 'abort' | 'execute';

export const fsList = (path: string) =>
  apiCall<FsListResult>('GET', '/api/fs/list', { query: { path } });
export const fsRead = (path: string) =>
  apiCall<FsReadResult>('GET', '/api/fs/read', { query: { path } });
export const fsWrite = (path: string, content: string) =>
  apiCall<void>('PUT', '/api/fs/write', { body: { path, content } });
export const fsSearch = (query: string, root: string) =>
  apiCall<FsSearchResult>('POST', '/api/fs/search', { body: { query, path: root } });
export const chat = (text: string, sessionId?: string, workspace?: string) =>
  apiCall<ChatResult>('POST', '/api/chat', { body: { text, sessionId, workspace } });
export const getWorkspace = () =>
  apiCall<WorkspaceResult>('GET', '/api/workspace');
export const openWorkspace = (path: string) =>
  apiCall<WorkspaceResult>('POST', '/api/workspace/open', { body: { path } });
export const syncProviderCredentials = (credentials: Record<string, string | null>) =>
  daemonFetch('/api/runtime/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  }).then((res) => {
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, String(res.status), res.status);
    }
  });
export const listPendingApprovals = () =>
  apiCall<{ approvals: ApprovalRequest[] }>('GET', '/api/approvals/pending');
export const listPendingEffects = () =>
  apiCall<{ effects: PendingEffect[] }>('GET', '/api/effects/pending');
export const decideApproval = (id: string, decision: 'approve' | 'deny') =>
  apiCall<{ ok: true; decision: 'approve' | 'deny' }>('POST', `/api/approvals/${encodeURIComponent(id)}/decision`, {
    body: { decision },
  });
export const listAuditEvents = (limit = 100) =>
  apiCall<{ events: AuditEvent[] }>('GET', '/api/audit/events', { query: { limit: String(limit) } });
export const listRuns = () =>
  apiCall<{ runs: RunRecord[] }>('GET', '/api/runs');
export const getRun = (runId: string) =>
  apiCall<{ run: RunRecord }>('GET', `/api/runs/${encodeURIComponent(runId)}`);
export const listRunEvents = (runId: string) =>
  apiCall<{ events: AuditEvent[] }>('GET', `/api/runs/${encodeURIComponent(runId)}/events`);
export const listRunDag = (runId: string) =>
  apiCall<{ nodes: DagNode[] }>('GET', `/api/runs/${encodeURIComponent(runId)}/dag`);
export const listRunFrames = (runId: string) =>
  apiCall<{ frames: WorkerFrameSummary[] }>('GET', `/api/runs/${encodeURIComponent(runId)}/frames`);
export const getRunDeliveryEvidence = (runId: string) =>
  apiCall<DeliveryEvidenceResponse>('GET', `/api/runs/${encodeURIComponent(runId)}/delivery-evidence`);
export const captureRunDeliveryEvidence = (runId: string, input: {
  summary?: string;
  verifierStatus?: string;
  deliveryChecklist?: string[];
  deliveryArtifactId?: string;
  issueNumber?: number;
} = {}) =>
  apiCall<DeliveryEvidenceResponse>('POST', `/api/runs/${encodeURIComponent(runId)}/delivery-evidence`, { body: input });
export const getRunGithubDeliveryPlan = (runId: string) =>
  apiCall<GitHubDeliveryPlanResponse>('GET', `/api/runs/${encodeURIComponent(runId)}/github-delivery-plan`);
export const createRunGithubDeliveryPlan = (runId: string, input: {
  issueNumber?: number;
  title?: string;
  body?: string;
} = {}) =>
  apiCall<GitHubDeliveryPlanResponse>('POST', `/api/runs/${encodeURIComponent(runId)}/github-delivery-plan`, { body: input });
export const getRunGithubDeliveryApply = (runId: string) =>
  apiCall<GitHubDeliveryApplyState>('GET', `/api/runs/${encodeURIComponent(runId)}/github-delivery-apply`);
export const requestRunGithubDeliveryApply = (runId: string, input: GitHubDeliveryApplyRequest) =>
  apiCall<GitHubDeliveryApplyResponse>('POST', `/api/runs/${encodeURIComponent(runId)}/github-delivery-apply`, { body: input });
export const getRunVerifierStatus = (runId: string) =>
  apiCall<VerifierStatusResponse>('GET', `/api/runs/${encodeURIComponent(runId)}/verifier-status`);
export const createRunVerifierWaiver = (runId: string, input: {
  operatorId?: string;
  operatorName?: string;
  reason: string;
  scope?: VerifierWaiverScope;
}) =>
  apiCall<VerifierWaiverResponse>('POST', `/api/runs/${encodeURIComponent(runId)}/verifier-waiver`, { body: input });
export const controlRun = (runId: string, action: RunControlAction, resumeToken?: string) =>
  apiCall<{
    ok: true;
    action: RunControlAction;
    run?: RunRecord;
    deliveryArtifact?: ArtifactRef;
    deliveryEvidenceArtifact?: ArtifactRef;
    deliveryEvidence?: DeliveryEvidenceSnapshot;
    summary?: string;
  }>('POST', `/api/runs/${encodeURIComponent(runId)}/control`, {
    body: { action, resumeToken },
  });
export const listProductFactoryTemplates = () =>
  apiCall<{ templates: ProductFactoryTemplate[] }>('GET', '/api/product-factory/templates');
export const previewProductFactoryPlan = (input: ProductFactoryPlanInput) =>
  apiCall<{ preview: ProductFactoryPlanPreview }>('POST', '/api/product-factory/plan', { body: input });
export const createProductFactoryRun = (input: ProductFactoryPlanInput) =>
  apiCall<{ run: RunRecord; preview: ProductFactoryPlanPreview; artifact: ArtifactRef }>('POST', '/api/runs', {
    body: { productFactory: input },
  });
export interface OchagReminderInput {
  title: string;
  familyId?: string;
  dueAt?: string;
  visibility?: 'member' | 'family';
  audience?: string;
  memberIds?: string[];
  privacy?: string;
  escalationPolicy?: string;
}
export const previewOchagReminder = (input: OchagReminderInput) =>
  apiCall<{ preview: ProductFactoryPlanPreview }>('POST', '/api/ochag/reminders/preview', { body: input });
export const createOchagReminderRun = (input: OchagReminderInput) =>
  apiCall<{ run: RunRecord; preview: ProductFactoryPlanPreview; artifact: ArtifactRef }>('POST', '/api/ochag/reminders', { body: input });
export const getOchagPrivacy = () =>
  apiCall<{
    domainId: 'ochag';
    privacyRules: unknown[];
    toolPermissionOverrides: Record<string, string>;
    adapterRegistrations: unknown[];
  }>('GET', '/api/ochag/privacy');
export interface CeoclawBriefInput {
  decision: string;
  evidence?: string | string[];
  deadline?: string;
  projectId?: string;
  title?: string;
}
export const previewCeoclawBrief = (input: CeoclawBriefInput) =>
  apiCall<{ preview: ProductFactoryPlanPreview }>('POST', '/api/ceoclaw/briefs/preview', { body: input });
export const createCeoclawBriefRun = (input: CeoclawBriefInput) =>
  apiCall<{ run: RunRecord; preview: ProductFactoryPlanPreview; artifact: ArtifactRef }>('POST', '/api/ceoclaw/briefs', { body: input });
export const listOverlays = () =>
  apiCall<{ overlays: DomainOverlayManifest[] }>('GET', '/api/overlays');
export const getOverlay = (domainId: string) =>
  apiCall<{ overlay: DomainOverlayManifest }>('GET', `/api/overlays/${encodeURIComponent(domainId)}`);

export interface OpenFile {
  path: string;
  content: string;
  language?: string;
}

export async function chatStream(params: {
  text: string;
  openFiles?: OpenFile[];
  workspace?: string;
  sessionId?: string;
  signal?: AbortSignal;
  /** Called for each text chunk when cloud fallback is active. */
  onChunk?: (text: string) => void;
}): Promise<Response> {
  const { signal, onChunk, ...body } = params;
  // retries: 0 — streaming bodies must not be retried after first byte;
  // a connect failure will still emit an apiEvents 'retry' event.
  try {
    return await daemonFetch(
      '/api/chat/stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
      { retries: 0 }
    );
  } catch (daemonErr) {
    // Only attempt cloud fallback on network-level errors (daemon unreachable)
    if (daemonErr instanceof TypeError && getCloudFallbackConfig().enabled) {
      if (!onChunk) {
        // No chunk handler provided — caller is not set up for cloud streaming;
        // rethrow so the offline queue can pick it up.
        throw daemonErr;
      }
      try {
        await chatStreamCloud({
          text: params.text,
          sessionId: params.sessionId,
          openFiles: params.openFiles,
          workspace: params.workspace,
          onChunk,
          signal,
        });
        // Return a synthetic completed response so callers don't need special-casing.
        return new Response(null, { status: 200 });
      } catch {
        // Cloud also failed — rethrow original so caller can enqueue offline.
        throw daemonErr;
      }
    }
    throw daemonErr;
  }
}

export interface ChatAttachment {
  kind: 'audio' | 'image';
  url: string;
  mime: string;
  size: number;
}

/**
 * Streaming chat request that supports file attachments via multipart/form-data.
 * Calls onChunk for each token; calls onAttachments once when the server reports
 * the persisted attachment metadata (carried on the first SSE data event).
 */
export async function chatStreamMultipart(params: {
  text: string;
  attachments: File[];
  openFiles?: OpenFile[];
  workspace?: string;
  sessionId?: string;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onAttachments?: (attachments: ChatAttachment[]) => void;
  onTool?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onError?: (message: string) => void;
}): Promise<void> {
  const fd = new FormData();
  fd.append('text', params.text);
  if (params.openFiles) fd.append('openFiles', JSON.stringify(params.openFiles));
  if (params.workspace) fd.append('workspace', params.workspace);
  if (params.sessionId) fd.append('sessionId', params.sessionId);
  for (const f of params.attachments) {
    fd.append('attachments[]', f, f.name);
  }

  // retries: 0 — streaming; connect failure still surfaces via apiEvents
  const res = await daemonFetch(
    '/api/chat/stream',
    { method: 'POST', body: fd, signal: params.signal },
    { retries: 0 }
  );
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let attachmentsEmitted = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (params.signal?.aborted) return;
      throw new Error('operator stream ended');
    }
    buf += decoder.decode(value, { stream: true });
    // Parse SSE frames: split on "\n\n"
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event: string | undefined;
      let dataLine: string | undefined;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
      }
      if (dataLine === undefined) continue;
      if (event === 'done') return;
      if (event === 'error') {
        let msg = 'stream error';
        try { msg = (JSON.parse(dataLine) as { message?: string }).message ?? msg; } catch { /* ignore */ }
        params.onError?.(msg);
        return;
      }
      try {
        const parsed = JSON.parse(dataLine) as {
          type?: string;
          text?: string;
          name?: string;
          args?: Record<string, unknown>;
          result?: unknown;
          attachments?: ChatAttachment[];
        };
        if (!attachmentsEmitted && Array.isArray(parsed.attachments)) {
          attachmentsEmitted = true;
          params.onAttachments?.(parsed.attachments);
        }
        if (parsed.type === 'token' && typeof parsed.text === 'string') {
          params.onChunk(parsed.text);
        } else if (parsed.type === 'final' && typeof parsed.text === 'string') {
          params.onChunk(parsed.text);
        } else if (parsed.type === 'tool' && typeof parsed.name === 'string') {
          params.onTool?.(parsed.name, parsed.args ?? {});
        } else if (parsed.type === 'tool_result' && typeof parsed.name === 'string') {
          params.onToolResult?.(parsed.name, parsed.result);
        }
      } catch { /* ignore malformed */ }
    }
  }
}

export async function streamOperatorEvents(params: {
  signal?: AbortSignal;
  onEvent: (event: OperatorStreamEvent) => void;
  onError?: (message: string) => void;
}): Promise<void> {
  const res = await daemonFetch(
    '/api/events/stream',
    { method: 'GET', signal: params.signal },
    { retries: 0 }
  );
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (params.signal?.aborted) return;
      throw new Error('operator stream ended');
    }
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let eventName = 'message';
      let dataLine: string | undefined;
      for (const rawLine of frame.split('\n')) {
        const line = rawLine.trimEnd();
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
      }
      if (dataLine === undefined) continue;
      if (eventName === 'error') {
        let msg = 'operator stream error';
        try { msg = (JSON.parse(dataLine) as { message?: string }).message ?? msg; } catch { /* ignore */ }
        params.onError?.(msg);
        throw new Error(msg);
      }
      try {
        const parsed = JSON.parse(dataLine) as Record<string, unknown>;
        params.onEvent({ type: eventName, ...parsed } as OperatorStreamEvent);
      } catch {
        // Ignore malformed stream frames; the next snapshot/refresh repairs state.
      }
    }
  }
}
export const exec = (command: string, cwd?: string) =>
  apiCall<ExecResult>('POST', '/api/exec', { body: { command, cwd } });
export const getDashboard = () => apiCall<DashboardResult>('GET', '/api/dashboard');

export async function transcribeAudio(blob: Blob): Promise<{ text: string }> {
  const fd = new FormData();
  fd.append('audio', blob, 'recording.webm');
  const res = await daemonFetch('/api/audio/transcribe', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}`);
  return res.json();
}

// ─── Git API ───────────────────────────────────────────────────────────────

export interface GitFileEntry {
  path: string;
  x: string;
  y: string;
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
}

export interface GitLogEntry {
  sha: string;
  author: string;
  dateUnix: number;
  subject: string;
}

export interface GitBlameEntry {
  sha: string;
  author: string;
  line: number;
  content: string;
}

export const gitGetStatus = (workspace: string) =>
  apiCall<GitStatusResult>('GET', '/api/git/status', { query: { workspace } });

export const gitGetDiff = (workspace: string, path: string, staged = false) =>
  apiCall<{ diff: string }>('GET', '/api/git/diff', {
    query: { workspace, path, staged: staged ? '1' : '0' },
  }).then((r) => r.diff);

export const gitGetFileContent = (workspace: string, path: string, ref = 'HEAD') =>
  apiCall<{ content: string }>('GET', '/api/git/file', {
    query: { workspace, path, ref },
  }).then((r) => r.content);

export const gitStageFiles = (workspace: string, paths: string[]) =>
  apiCall<{ ok: boolean }>('POST', '/api/git/stage', { body: { workspace, paths } });

export const gitUnstageFiles = (workspace: string, paths: string[]) =>
  apiCall<{ ok: boolean }>('POST', '/api/git/unstage', { body: { workspace, paths } });

export const gitCommitFiles = (workspace: string, message: string) =>
  apiCall<{ sha: string }>('POST', '/api/git/commit', { body: { workspace, message } });

export const gitGetLog = (workspace: string, limit = 50) =>
  apiCall<{ entries: GitLogEntry[] }>('GET', '/api/git/log', {
    query: { workspace, limit: String(limit) },
  }).then((r) => r.entries);

export const gitGetBlame = (workspace: string, path: string) =>
  apiCall<{ entries: GitBlameEntry[] }>('GET', '/api/git/blame', {
    query: { workspace, path },
  }).then((r) => r.entries);

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  json: 'json',
  md: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sh: 'shell',
  bash: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  sql: 'sql',
  xml: 'xml',
  txt: 'plaintext',
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] || 'plaintext';
}

// ─── Models ──────────────────────────────────────────────────────────────────

export interface ModelEntry {
  provider: string;
  id: string;
  label?: string;
  available: boolean;
}

export interface ActiveModel {
  provider: string;
  modelId: string;
}

export const listModels = () =>
  apiCall<{ models: ModelEntry[] }>('GET', '/api/models').then((r) => r.models);

export const getActiveModel = () =>
  apiCall<{ activeModel: ActiveModel | null }>('GET', '/api/settings/active-model').then(
    (r) => r.activeModel
  );

export const setActiveModel = (provider: string, modelId: string) =>
  apiCall<{ ok: boolean; activeModel: ActiveModel }>('POST', '/api/settings/active-model', {
    body: { provider, modelId },
  });

// ─── Local Mode ──────────────────────────────────────────────────────────────

export interface LocalMode {
  localFirst: boolean;
  localOnly: boolean;
}

export const getLocalMode = () =>
  apiCall<LocalMode>('GET', '/api/settings/local-mode');

export const setLocalMode = (opts: LocalMode) =>
  apiCall<{ ok: boolean; localFirst: boolean; localOnly: boolean }>('POST', '/api/settings/local-mode', {
    body: opts,
  });
