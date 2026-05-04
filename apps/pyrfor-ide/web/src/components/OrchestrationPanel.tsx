import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDashboard,
  captureRunDeliveryEvidence,
  createRunGithubDeliveryPlan,
  getOverlay,
  getRun,
  getRunContextPack,
  getRunDeliveryEvidence,
  getRunGithubDeliveryApply,
  getRunGithubDeliveryPlan,
  getRunVerifierStatus,
  getMemorySnapshot,
  getConnectorInventory,
  getSkills,
  getSlashCommands,
  invokeSlashCommand,
  recommendSkills,
  probeConnector,
  createRunResearchEvidence,
  getSessionTimeline,
  createMemoryRollup,
  createProjectMemoryRollup,
  createMemoryCorrection,
  getMemoryContinuity,
  createOpenClawImportReport,
  getOpenClawImportReport,
  importOpenClawMemory,
  requestRunGithubDeliveryApply,
  requestRunResearchSearch,
  searchMemory,
  streamOperatorEvents,
  controlRun,
  createRunVerifierWaiver,
  getAgents,
  createCeoclawBriefRun,
  createOchagReminderRun,
  createProductFactoryRun,
  getOchagPrivacy,
  listAuditEvents,
  listOverlays,
  listProductFactoryTemplates,
  listPendingApprovals,
  listSessions,
  listRunDag,
  listRunEvents,
  listRunResearchEvidence,
  listRunActors,
  listRunFrames,
  listRuns,
  dispatchNextRunActorMessage,
  recoverStuckRunActorMessages,
  previewCeoclawBrief,
  previewOchagReminder,
  previewProductFactoryPlan,
  type AuditEvent,
  type ApprovalRequest,
  type ConnectorInventorySnapshot,
  type ConnectorStatus,
  type ContextPackResponse,
  type DagNode,
  type DeliveryEvidenceSnapshot,
  type GitHubDeliveryApplyResult,
  type GitHubDeliveryPlan,
  type DailyMemoryRollupResult,
  type MemorySearchHit,
  type MemoryContinuityStatus,
  type MemorySnapshot,
  type OpenClawMigrationPreviewResponse,
  type OrchestrationDashboard,
  type ProductFactoryPlanPreview,
  type ProductFactoryTemplate,
  type ProductFactoryTemplateId,
  type ProjectMemoryRollupResult,
  type PublicDomainOverlay,
  type PublicArtifactRef,
  type PublicSlashCommand,
  type PublicSkillSummary,
  type ResearchEvidenceResponse,
  type RunRecord,
  type RuntimeSessionSummary,
  type RuntimeSessionTimelineEvent,
  type RuntimeSubagentSummary,
  type RunActorSnapshot,
  type SkillCatalogResponse,
  type VerifierDecision,
  type WorkerFrameSummary,
} from '../lib/api';

const ACTOR_STALE_AFTER_MS = 60_000;

type ResearchSearchProviderOption = '' | 'brave' | 'duckduckgo';
type ResearchSearchProvider = Exclude<ResearchSearchProviderOption, ''>;
type CapabilityRequestSummary = {
  key: string;
  capability: string;
  reason: string;
  scope: Record<string, unknown> | undefined;
  status: 'pending' | 'granted' | 'denied';
};

function approvalResearchProvider(approval: ApprovalRequest): ResearchSearchProvider | undefined {
  const provider = approval.args?.['provider'];
  return provider === 'brave' || provider === 'duckduckgo' ? provider : undefined;
}

function approvalMatchesResearchProvider(approval: ApprovalRequest, provider: ResearchSearchProviderOption): boolean {
  return !provider || approvalResearchProvider(approval) === provider;
}

function eventStringArg(event: AuditEvent, key: string): string {
  const value = event.args?.[key] ?? (event as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function eventRecordArg(event: AuditEvent, key: string): Record<string, unknown> | undefined {
  const value = event.args?.[key] ?? (event as unknown as Record<string, unknown>)[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function sanitizeCapabilityScopeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeCapabilityScopeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /token|secret|password|authorization|api[-_]?key/i.test(key) ? '[redacted]' : sanitizeCapabilityScopeValue(entry),
    ]));
  }
  return typeof value === 'string' ? sanitizeOverviewText(value, 120) : value;
}

function sanitizeCapabilityScope(scope: Record<string, unknown>): string {
  return sanitizeOverviewText(JSON.stringify(sanitizeCapabilityScopeValue(scope)), 220);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactContextContent(value: unknown, maxChars = 260): string {
  const raw = typeof value === 'string' ? value : compactJson(value);
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  return singleLine.length <= maxChars ? singleLine : `${singleLine.slice(0, maxChars - 1)}…`;
}

const SENSITIVE_URL_QUERY_KEY_RE = /(token|secret|password|passwd|credential|signature|authorization|apikey|accesskey|keypairid)|(^|[-_])(auth|sig|pwd)([-_]|$)|^api[-_]?key$|^access[-_]?key$|^awsaccesskeyid$|^key[-_]?pair[-_]?id$|^x-amz-|^x-goog-|^x-oss-/i;

function normalizeOperatorResearchSourceUrl(rawUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Source URL must be a valid http(s) URL.' };
    }
    if (url.username || url.password) {
      return { ok: false, error: 'Source URL must not contain embedded credentials.' };
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_URL_QUERY_KEY_RE.test(key)) {
        url.searchParams.set(key, 'redacted');
      }
    }
    url.hash = '';
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, error: 'Source URL must be a valid http(s) URL.' };
  }
}

function sanitizeOverviewUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '[redacted-url]';
    }
    if (url.username) url.username = 'redacted';
    if (url.password) url.password = 'redacted';
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_URL_QUERY_KEY_RE.test(key)) {
        url.searchParams.set(key, 'redacted');
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return '[redacted-url]';
  }
}

function safeExternalHref(rawUrl: string | null | undefined): string | undefined {
  if (!rawUrl) return undefined;
  const sanitized = sanitizeOverviewUrl(rawUrl);
  return sanitized === '[redacted-url]' ? undefined : sanitized;
}

function sanitizeOverviewText(value: unknown, maxChars = 180): string {
  const raw = typeof value === 'string' ? value : compactJson(value);
  const sanitized = raw
    .replace(/\bhttps?:\/\/[^\s'"`<>),]+/g, (url) => sanitizeOverviewUrl(url))
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted-token]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-token]')
    .replace(/\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|credential|signature|authorization|api[-_]?key|access[-_]?key|awsaccesskeyid|key[-_]?pair[-_]?id)[A-Za-z0-9_.-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;\n]+)/gi, '$1=[redacted]')
    .replace(/file:\/\/[^\s'"`<>),]+(?:\s+[^\s'"`<>),]*\/[^\s'"`<>),]+)*/g, '[redacted-file-uri]')
    .replace(/(^|[^:])\/\/(?:Users|home|var|tmp|private|Volumes)\b[^\s'"`<>),]*/g, '$1/[redacted-path]')
    .replace(/[A-Za-z]:\\[^\s'"`<>),]+(?:\s+[^\s'"`<>),]*\\[^\s'"`<>),]+)*/g, '[redacted-path]')
    .replace(/\\\\[^\s'"`<>),]+(?:\s+[^\s'"`<>),]*\\[^\s'"`<>),]+)*/g, '[redacted-path]')
    .replace(/(^|[\s'"`(=:-])\/(?!\/)(?=[^\s'"`<>),]*\/)[^\s'"`<>),]+(?:\s+[^\s'"`<>),]*\/[^\s'"`<>),]+)*/g, '$1[redacted-path]');
  return compactContextContent(sanitized, maxChars);
}

function renderDeliveryEvidenceReadiness(deliveryEvidence: DeliveryEvidenceSnapshot): React.ReactNode {
  const dirtyFiles = deliveryEvidence.git.dirtyFiles.slice(0, 5);
  const hiddenDirtyCount = Math.max(0, deliveryEvidence.git.dirtyFiles.length - dirtyFiles.length);
  const branchProtected = deliveryEvidence.github.branch?.protected;
  const latestCommits = deliveryEvidence.git.latestCommits.slice(0, 3);

  return (
    <>
      <article className="orchestration-node">
        <strong>Delivery readiness</strong>
        <span className="orchestration-badge">
          {deliveryEvidence.git.available ? 'git available' : 'git unavailable'}
        </span>
        <span>ahead/behind: {deliveryEvidence.git.ahead}/{deliveryEvidence.git.behind}</span>
        <span>
          branch protection: {branchProtected === true ? 'protected' : branchProtected === false ? 'unprotected' : 'unknown'}
        </span>
        <span>captured: {sanitizeOverviewText(formatTime(deliveryEvidence.capturedAt), 120)}</span>
        {deliveryEvidence.git.error && <span>git error: {sanitizeOverviewText(deliveryEvidence.git.error, 180)}</span>}
      </article>
      {deliveryEvidence.verifier && (
        <article className="orchestration-node">
          <strong>Verifier provenance</strong>
          <span className="orchestration-badge">{sanitizeOverviewText(deliveryEvidence.verifier.status, 80)}</span>
          {deliveryEvidence.verifier.rawStatus && <span>raw: {sanitizeOverviewText(deliveryEvidence.verifier.rawStatus, 80)}</span>}
          {deliveryEvidence.verifier.waivedFrom && <span>waived from: {sanitizeOverviewText(deliveryEvidence.verifier.waivedFrom, 80)}</span>}
          {deliveryEvidence.verifier.waiverArtifactId && <span>waiver artifact: {sanitizeOverviewText(deliveryEvidence.verifier.waiverArtifactId, 120)}</span>}
          {deliveryEvidence.verifier.reason && <span>reason: {sanitizeOverviewText(deliveryEvidence.verifier.reason, 180)}</span>}
        </article>
      )}
      <article className="orchestration-node">
        <strong>Working tree</strong>
        <span className="orchestration-badge">
          {deliveryEvidence.git.dirtyFiles.length === 0 ? 'clean' : `${deliveryEvidence.git.dirtyFiles.length} dirty`}
        </span>
        {dirtyFiles.length === 0 ? (
          <span>No dirty files reported.</span>
        ) : (
          <span>
            {dirtyFiles
              .map((file) => `${sanitizeOverviewText(`${file.x}${file.y}`.trim() || '??', 16)} ${sanitizeOverviewText(file.path, 120)}`)
              .join(', ')}
            {hiddenDirtyCount > 0 ? `, +${hiddenDirtyCount} more` : ''}
          </span>
        )}
      </article>
      {deliveryEvidence.github.errors.length > 0 && (
        <article className="orchestration-node">
          <strong>GitHub readiness errors</strong>
          <span className="orchestration-badge">{deliveryEvidence.github.errors.length}</span>
          {deliveryEvidence.github.errors.slice(0, 4).map((error, index) => (
            <span key={`${index}:${error.scope}:${error.status ?? 'status'}`}>
              {sanitizeOverviewText(error.scope, 80)}
              {error.status ? ` ${error.status}` : ''}: {sanitizeOverviewText(error.message, 180)}
            </span>
          ))}
        </article>
      )}
      {latestCommits.length > 0 && (
        <article className="orchestration-node">
          <strong>Latest local commits</strong>
          <span className="orchestration-badge">{deliveryEvidence.git.latestCommits.length}</span>
          {latestCommits.map((commit) => (
            <span key={`${commit.sha}:${commit.dateUnix}`}>
              {sanitizeOverviewText(commit.sha.slice(0, 12), 16)} · {sanitizeOverviewText(commit.subject, 180)} · {sanitizeOverviewText(commit.author, 80)}
            </span>
          ))}
        </article>
      )}
    </>
  );
}

function countContextSourcesByRole(sourceRefs: Array<{ role: string }>): string {
  const counts = sourceRefs.reduce<Record<string, number>>((acc, source) => {
    acc[source.role] = (acc[source.role] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([role, count]) => `${role}: ${count}`).join(' · ') || 'none';
}

function safeApprovalText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '-';
}

function parseOptionalIssueNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed.replace(/^#/, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function findLatestCeoclawApprovalRequestEvent(events: AuditEvent[]): AuditEvent | undefined {
  return [...events].reverse().find((event) =>
    event.type === 'approval.requested'
    && event.tool === 'ceoclaw_business_brief_approval'
    && typeof event.approval_id === 'string'
  );
}

function findResolvedCeoclawApprovalFromEvents(
  events: AuditEvent[],
  auditEvents: AuditEvent[],
  runId: string,
): ApprovalRequest | null {
  const requested = findLatestCeoclawApprovalRequestEvent(events);
  if (!requested || typeof requested.approval_id !== 'string') return null;
  const resolution = events.find((event) =>
    typeof requested.seq === 'number'
    && typeof event.seq === 'number'
    && event.seq > requested.seq
    && (event.type === 'approval.granted' || event.type === 'approval.denied')
    && event.tool === 'ceoclaw_business_brief_approval'
    && event.approval_id === requested.approval_id
  );
  if (resolution?.type === 'approval.denied') return null;
  const auditResolution = auditEvents.find((event) =>
    event.requestId === requested.approval_id
    && event.toolName === 'ceoclaw_business_brief_approval'
    && (event.type === 'approval.approved' || event.type === 'approval.denied')
  );
  if (auditResolution?.type === 'approval.denied') return null;
  if (resolution?.type !== 'approval.granted' && auditResolution?.type !== 'approval.approved') return null;
  return {
    id: requested.approval_id,
    toolName: 'ceoclaw_business_brief_approval',
    summary: auditResolution?.summary ?? requested.reason ?? 'Approve CEOClaw business brief',
    run_id: runId,
    args: {
      ...(requested.args ?? {}),
      ...(auditResolution?.args ?? {}),
      runId: auditResolution?.args?.['runId'] ?? requested.args?.['runId'] ?? runId,
    },
    approval_required: true,
  };
}

function findPendingCeoclawApprovalFromEvents(events: AuditEvent[], runId: string): ApprovalRequest | null {
  const requested = findLatestCeoclawApprovalRequestEvent(events);
  if (!requested || typeof requested.approval_id !== 'string') return null;
  const resolved = events.some((event) =>
    typeof requested.seq === 'number'
    && typeof event.seq === 'number'
    && event.seq > requested.seq
    && (event.type === 'approval.granted' || event.type === 'approval.denied')
    && event.tool === 'ceoclaw_business_brief_approval'
    && event.approval_id === requested.approval_id
  );
  if (resolved) return null;
  return {
    id: requested.approval_id,
    toolName: 'ceoclaw_business_brief_approval',
    summary: requested.reason ?? 'Approve CEOClaw business brief',
    run_id: runId,
    args: {
      ...(requested.args ?? {}),
      runId: requested.args?.['runId'] ?? runId,
    },
    approval_required: true,
  };
}

function findGithubDeliveryApplyApproval(
  events: AuditEvent[],
  runId: string,
  planArtifact: PublicArtifactRef | null,
  plan: GitHubDeliveryPlan | null,
): ApprovalRequest | null {
  const requested = [...events].reverse().find((event) =>
    event.type === 'approval.requested'
    && event.tool === 'github_delivery_apply'
    && typeof event.approval_id === 'string'
    && (!planArtifact || event.artifact_id === planArtifact.id)
  );
  if (!requested || typeof requested.approval_id !== 'string') return null;
  const resolved = events.some((event) =>
    typeof requested.seq === 'number'
    && typeof event.seq === 'number'
    && event.seq > requested.seq
    && (event.type === 'approval.granted' || event.type === 'approval.denied')
    && event.tool === 'github_delivery_apply'
    && event.approval_id === requested.approval_id
  );
  if (resolved) return null;
  return {
    id: requested.approval_id,
    toolName: 'github_delivery_apply',
    summary: requested.reason ?? 'Create draft GitHub PR',
    run_id: runId,
    args: {
      runId,
      ...(planArtifact ? {
        planArtifactId: planArtifact.id,
        expectedPlanSha256: planArtifact.sha256,
      } : {}),
      ...(plan ? {
        repository: plan.repository,
        baseBranch: plan.baseBranch,
        proposedBranch: plan.proposedBranch,
        headSha: plan.headSha,
      } : {}),
    },
    approval_required: true,
  };
}

function renderGithubDeliveryApprovalContext(approval: ApprovalRequest) {
  const args = approval.args ?? {};
  const fields = [
    ['Repository', args['repository']],
    ['Base branch', args['baseBranch']],
    ['Proposed branch', args['proposedBranch']],
    ['Head SHA', args['headSha']],
    ['Plan artifact', args['planArtifactId']],
  ] as const;
  const visibleFields = fields.filter(([, value]) => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  ));
  if (visibleFields.length === 0) return null;
  return (
    <div className="trust-metadata">
      {visibleFields.map(([label, value]) => (
        <div key={label}>{label}: {String(value)}</div>
      ))}
    </div>
  );
}

function renderCeoclawApprovalContext(approval: ApprovalRequest) {
  const args = approval.args ?? {};
  const evidenceRefs = Array.isArray(args['evidenceRefs']) ? args['evidenceRefs'].length : 0;
  return (
    <div className="trust-metadata">
      <div>Run: {safeApprovalText(args['runId'])}</div>
      <div>Project: {safeApprovalText(args['projectId'])}</div>
      <div>Decision: {safeApprovalText(args['decision'])}</div>
      <div>Evidence refs: {evidenceRefs}</div>
      {args['evidenceArtifactId'] !== undefined && <div>Evidence artifact: {safeApprovalText(args['evidenceArtifactId'])}</div>}
      {args['deadline'] !== undefined && <div>Deadline: {safeApprovalText(args['deadline'])}</div>}
    </div>
  );
}

function renderApprovalContext(approval: ApprovalRequest) {
  const args = approval.args ?? {};
  if (approval.toolName === 'connector_live_probe') {
    return (
      <div className="trust-metadata">
        <div>Connector: {safeApprovalText(args['connectorName'] ?? args['connectorId'])}</div>
        <div>Source: {safeApprovalText(args['sourceSystem'])}</div>
        <div>Action: live connector probe requires explicit approval.</div>
      </div>
    );
  }
  if (approval.toolName === 'research_live_search') {
    return (
      <div className="trust-metadata">
        <div>Run: {safeApprovalText(args['runId'])}</div>
        <div>Query hash: {safeApprovalText(args['queryHash'])}</div>
        <div>Provider: {safeApprovalText(args['provider'])}</div>
        <div>Max results: {safeApprovalText(args['maxResults'])}</div>
      </div>
    );
  }
  if (approval.toolName === 'github_delivery_apply') return renderGithubDeliveryApprovalContext(approval);
  if (approval.toolName === 'ceoclaw_business_brief_approval') return renderCeoclawApprovalContext(approval);
  return null;
}

function connectorProbeApprovalsByConnectorId(approvals: ApprovalRequest[]): Record<string, ApprovalRequest> {
  return approvals
    .filter((approval) => approval.toolName === 'connector_live_probe')
    .reduce<Record<string, ApprovalRequest>>((acc, approval) => {
      const connectorId = typeof approval.args?.['connectorId'] === 'string' ? approval.args['connectorId'].trim() : '';
      if (connectorId) acc[connectorId] = approval;
      return acc;
    }, {});
}

function findResearchSearchApproval(
  approvals: ApprovalRequest[],
  runId: string,
  provider: ResearchSearchProviderOption,
): ApprovalRequest | null {
  return approvals.find((approval) => (
    approval.toolName === 'research_live_search'
    && approval.args?.['runId'] === runId
    && approvalMatchesResearchProvider(approval, provider)
  )) ?? null;
}

function findCeoclawApproval(approvals: ApprovalRequest[], runId: string): ApprovalRequest | null {
  return approvals.find((approval) => (
    approval.toolName === 'ceoclaw_business_brief_approval'
    && (approval.run_id === runId || approval.args?.['runId'] === runId)
  )) ?? null;
}

function continuityStatusLabel(status: MemoryContinuityStatus['latestDailyRollup']): string {
  if (status.status === 'ok') return 'ok';
  if (status.status === 'not_configured') return 'not configured';
  return 'missing';
}

function renderContinuityArtifactTrust(
  label: string,
  status: MemoryContinuityStatus['latestDailyRollup'],
) {
  if (status.status !== 'ok' || !status.artifact) return null;
  const createdAt = status.createdAt ?? status.artifact.createdAt;
  return (
    <div className="trust-metadata">
      <div>{label} artifact: {status.artifact.id}</div>
      {createdAt && <div>{label} created: {formatTime(createdAt)}</div>}
      {status.artifact.sha256 && <div>{label} SHA-256: {status.artifact.sha256}</div>}
    </div>
  );
}

function renderResearchEvidenceTrust(
  artifact: ResearchEvidenceResponse['artifact'],
  snapshot: ResearchEvidenceResponse['snapshot'],
) {
  const approvalIds = Array.from(new Set(
    snapshot.effectsExecuted
      .map((effect) => effect.approvalId)
      .filter((approvalId): approvalId is string => Boolean(approvalId)),
  ));
  return (
    <div className="trust-metadata">
      <div>Evidence artifact: {artifact.id}</div>
      {artifact.createdAt && <div>Evidence created: {formatTime(artifact.createdAt)}</div>}
      {artifact.sha256 && <div>Evidence SHA-256: {artifact.sha256}</div>}
      {approvalIds.length > 0 && <div>Evidence approvals: {approvalIds.join(', ')}</div>}
    </div>
  );
}

function renderResearchEvidenceSource(
  artifactId: string,
  source: ResearchEvidenceResponse['snapshot']['sources'][number],
  index: number,
) {
  const href = safeExternalHref(source.url);
  const label = sanitizeOverviewText(source.title ?? source.citation ?? source.url, 180);
  return (
    <div className="trust-metadata" key={`${artifactId}:source:${index}`}>
      <div>
        Source {index + 1}:{' '}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">{label}</a>
        ) : (
          <span>{label}</span>
        )}
      </div>
      {source.citation && <div>Citation: {sanitizeOverviewText(source.citation, 180)}</div>}
      {source.snippet && <div>Snippet: {sanitizeOverviewText(source.snippet, 220)}</div>}
      {source.observedAt && <div>Observed: {sanitizeOverviewText(formatTime(source.observedAt), 120)}</div>}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="orchestration-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function OrchestrationPanel() {
  const [dashboard, setDashboard] = useState<OrchestrationDashboard | null>(null);
  const [memorySnapshot, setMemorySnapshot] = useState<MemorySnapshot | null>(null);
  const [connectorInventory, setConnectorInventory] = useState<ConnectorInventorySnapshot | null>(null);
  const [connectorInventoryError, setConnectorInventoryError] = useState<string | null>(null);
  const [connectorProbeApprovals, setConnectorProbeApprovals] = useState<Record<string, ApprovalRequest>>({});
  const [pendingApprovalIds, setPendingApprovalIds] = useState<string[]>([]);
  const pendingApprovalsRef = useRef<ApprovalRequest[]>([]);
  const pendingApprovalsUnavailableRef = useRef(false);
  const [connectorProbeResults, setConnectorProbeResults] = useState<Record<string, ConnectorStatus>>({});
  const [connectorProbeLoading, setConnectorProbeLoading] = useState<string | null>(null);
  const [connectorProbeError, setConnectorProbeError] = useState<string | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogResponse | null>(null);
  const [slashCommands, setSlashCommands] = useState<PublicSlashCommand[]>([]);
  const [skillInspectorError, setSkillInspectorError] = useState<string | null>(null);
  const [slashCommandError, setSlashCommandError] = useState<string | null>(null);
  const [skillTask, setSkillTask] = useState('Fix a TypeScript error');
  const [skillRecommendations, setSkillRecommendations] = useState<PublicSkillSummary[]>([]);
  const [skillRecommendationRequested, setSkillRecommendationRequested] = useState(false);
  const [skillRecommendLoading, setSkillRecommendLoading] = useState(false);
  const [slashInvokeOutput, setSlashInvokeOutput] = useState<string | null>(null);
  const [slashInvokeError, setSlashInvokeError] = useState<string | null>(null);
  const [slashInvokeLoading, setSlashInvokeLoading] = useState(false);
  const skillRecommendRequestSeq = useRef(0);
  const [subagents, setSubagents] = useState<RuntimeSubagentSummary[]>([]);
  const [subagentsError, setSubagentsError] = useState<string | null>(null);
  const [lastMemoryRollup, setLastMemoryRollup] = useState<DailyMemoryRollupResult | null>(null);
  const [memoryContinuity, setMemoryContinuity] = useState<MemoryContinuityStatus | null>(null);
  const [memoryRollupLoading, setMemoryRollupLoading] = useState(false);
  const [memoryRollupError, setMemoryRollupError] = useState<string | null>(null);
  const [projectRollupProjectId, setProjectRollupProjectId] = useState('');
  const [projectRollupResult, setProjectRollupResult] = useState<ProjectMemoryRollupResult | null>(null);
  const [projectRollupLoading, setProjectRollupLoading] = useState(false);
  const [projectRollupError, setProjectRollupError] = useState<string | null>(null);
  const [memorySearchQuery, setMemorySearchQuery] = useState('');
  const [memorySearchProjectId, setMemorySearchProjectId] = useState('');
  const [memorySearchResults, setMemorySearchResults] = useState<MemorySearchHit[]>([]);
  const [memorySearchLoading, setMemorySearchLoading] = useState(false);
  const [memorySearchError, setMemorySearchError] = useState<string | null>(null);
  const [memoryCorrectionContent, setMemoryCorrectionContent] = useState('');
  const [memoryCorrectionSummary, setMemoryCorrectionSummary] = useState('');
  const [memoryCorrectionProjectId, setMemoryCorrectionProjectId] = useState('');
  const [memoryCorrectionLoading, setMemoryCorrectionLoading] = useState(false);
  const [memoryCorrectionResult, setMemoryCorrectionResult] = useState<MemorySearchHit | null>(null);
  const [memoryCorrectionError, setMemoryCorrectionError] = useState<string | null>(null);
  const [openClawMigration, setOpenClawMigration] = useState<OpenClawMigrationPreviewResponse | null>(null);
  const [latestOpenClawMigration, setLatestOpenClawMigration] = useState<OpenClawMigrationPreviewResponse | null>(null);
  const [openClawMigrationLoading, setOpenClawMigrationLoading] = useState(false);
  const [openClawMigrationImporting, setOpenClawMigrationImporting] = useState(false);
  const [openClawMigrationResult, setOpenClawMigrationResult] = useState<string | null>(null);
  const [openClawMigrationError, setOpenClawMigrationError] = useState<string | null>(null);
  const [sessionTimeline, setSessionTimeline] = useState<{ sessionId: string; events: RuntimeSessionTimelineEvent[] } | null>(null);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [contextPack, setContextPack] = useState<ContextPackResponse | null>(null);
  const [deliveryEvidence, setDeliveryEvidence] = useState<DeliveryEvidenceSnapshot | null>(null);
  const [researchEvidence, setResearchEvidence] = useState<ResearchEvidenceResponse[]>([]);
  const [operatorResearchQuery, setOperatorResearchQuery] = useState('');
  const [operatorResearchSourceUrl, setOperatorResearchSourceUrl] = useState('');
  const [operatorResearchSourceTitle, setOperatorResearchSourceTitle] = useState('');
  const [operatorResearchSummary, setOperatorResearchSummary] = useState('');
  const [operatorResearchLoading, setOperatorResearchLoading] = useState(false);
  const [operatorResearchError, setOperatorResearchError] = useState<string | null>(null);
  const [researchSearchQuery, setResearchSearchQuery] = useState('');
  const [researchSearchProvider, setResearchSearchProvider] = useState<ResearchSearchProviderOption>('');
  const researchSearchProviderRef = useRef<ResearchSearchProviderOption>('');
  const [researchSearchApproval, setResearchSearchApproval] = useState<ApprovalRequest | null>(null);
  const [researchSearchLoading, setResearchSearchLoading] = useState(false);
  const [researchSearchError, setResearchSearchError] = useState<string | null>(null);
  const [githubDeliveryPlanArtifact, setGithubDeliveryPlanArtifact] = useState<PublicArtifactRef | null>(null);
  const [githubDeliveryPlan, setGithubDeliveryPlan] = useState<GitHubDeliveryPlan | null>(null);
  const [githubDeliveryApply, setGithubDeliveryApply] = useState<GitHubDeliveryApplyResult | null>(null);
  const [githubDeliveryApplyApproval, setGithubDeliveryApplyApproval] = useState<ApprovalRequest | null>(null);
  const [githubDeliveryApplyConfirmation, setGithubDeliveryApplyConfirmation] = useState('');
  const [githubDeliveryApplyLoading, setGithubDeliveryApplyLoading] = useState(false);
  const [githubDeliveryApplyError, setGithubDeliveryApplyError] = useState<string | null>(null);
  const [verifierDecision, setVerifierDecision] = useState<VerifierDecision | null>(null);
  const [waiverOperatorId, setWaiverOperatorId] = useState('operator');
  const [waiverReason, setWaiverReason] = useState('');
  const [waiverScope, setWaiverScope] = useState<'run' | 'delivery' | 'delivery_plan' | 'delivery_apply' | 'all'>('all');
  const [waiverLoading, setWaiverLoading] = useState(false);
  const [waiverError, setWaiverError] = useState<string | null>(null);
  const [deliveryIssueNumber, setDeliveryIssueNumber] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nodes, setNodes] = useState<DagNode[]>([]);
  const [frames, setFrames] = useState<WorkerFrameSummary[]>([]);
  const [actorSnapshot, setActorSnapshot] = useState<RunActorSnapshot | null>(null);
  const [overlays, setOverlays] = useState<PublicDomainOverlay[]>([]);
  const [selectedOverlay, setSelectedOverlay] = useState<PublicDomainOverlay | null>(null);
  const [productTemplates, setProductTemplates] = useState<ProductFactoryTemplate[]>([]);
  const [selectedProductTemplateId, setSelectedProductTemplateId] = useState<ProductFactoryTemplateId>('feature');
  const [productPrompt, setProductPrompt] = useState('Describe the product idea or task to plan');
  const [productAnswers, setProductAnswers] = useState<Record<string, string>>({
    acceptance: 'Visible outcome is available in the operator console.',
    surface: 'Pyrfor IDE and runtime API.',
  });
  const [productPreview, setProductPreview] = useState<ProductFactoryPlanPreview | null>(null);
  const [ochagTitle, setOchagTitle] = useState('Send dinner reminder');
  const [ochagFamilyId, setOchagFamilyId] = useState('family-1');
  const [ochagDueAt, setOchagDueAt] = useState('18:00 today');
  const [ochagAudience, setOchagAudience] = useState('family');
  const [ochagPrivacyRules, setOchagPrivacyRules] = useState<unknown[]>([]);
  const [ceoclawDecision, setCeoclawDecision] = useState('Approve evidence-backed project action');
  const [ceoclawEvidence, setCeoclawEvidence] = useState('evidence-1');
  const [ceoclawDeadline, setCeoclawDeadline] = useState('this week');
  const [ceoclawApproval, setCeoclawApproval] = useState<ApprovalRequest | null>(null);
  const [actorDispatchingId, setActorDispatchingId] = useState<string | null>(null);
  const [actorRecoveringId, setActorRecoveringId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedProductTemplate = productTemplates.find((template) => template.id === selectedProductTemplateId) ?? null;
  const selectedProductAnswers = Object.fromEntries(
    (selectedProductTemplate?.clarifications ?? [])
      .map((clarification) => [clarification.id, productAnswers[clarification.id]?.trim() ?? ''] as const)
      .filter(([, value]) => value),
  );
  const missingProductAnswerIds = (selectedProductTemplate?.clarifications ?? [])
    .filter((clarification) => clarification.required && !productAnswers[clarification.id]?.trim())
    .map((clarification) => clarification.id);
  const currentOpenClawProjectId = projectRollupProjectId.trim();
  const continuityOpenClawReport = memoryContinuity?.latestOpenClawReport.status === 'ok'
    && memoryContinuity.latestOpenClawReport.artifact?.sha256
    ? memoryContinuity.latestOpenClawReport
    : null;
  const openClawImportArtifact = openClawMigration?.artifact ?? latestOpenClawMigration?.artifact ?? continuityOpenClawReport?.artifact ?? null;
  const openClawImportProjectId = (
    openClawMigration?.report.projectId
    ?? latestOpenClawMigration?.report.projectId
    ?? continuityOpenClawReport?.projectId
    ?? ''
  ).trim();
  const openClawImportScopeMatches = !openClawImportArtifact || currentOpenClawProjectId === openClawImportProjectId;
  const openClawImportReady = Boolean(openClawImportArtifact?.sha256 && openClawImportScopeMatches);
  const openClawUsingContinuityFallback = !openClawMigration && !latestOpenClawMigration && Boolean(continuityOpenClawReport?.artifact?.sha256);
  const skillsSlashCommandExposed = slashCommands.some((command) => command.name === 'skills');

  const loadRun = useCallback(async (
    runId: string,
    knownApprovals: ApprovalRequest[] | null = pendingApprovalsUnavailableRef.current ? null : pendingApprovalsRef.current,
  ) => {
    const [runResult, eventResult, dagResult, frameResult, actorResult, contextPackResult, evidenceResult, researchResult, planResult, applyResult, verifierResult] = await Promise.all([
      getRun(runId),
      listRunEvents(runId),
      listRunDag(runId),
      listRunFrames(runId),
      listRunActors(runId, { staleAfterMs: ACTOR_STALE_AFTER_MS }).catch(() => null),
      getRunContextPack(runId).catch(() => null),
      getRunDeliveryEvidence(runId).catch(() => ({ artifact: null, snapshot: null })),
      listRunResearchEvidence(runId).catch(() => ({ evidence: [] })),
      getRunGithubDeliveryPlan(runId).catch(() => ({ artifact: null, plan: null })),
      getRunGithubDeliveryApply(runId).catch(() => ({ artifact: null, result: null })),
      getRunVerifierStatus(runId).catch(() => ({ decision: null })),
    ]);
    const knownCeoclawApproval = knownApprovals ? findCeoclawApproval(knownApprovals, runId) : null;
    const ceoclawRequest = knownCeoclawApproval ? undefined : findLatestCeoclawApprovalRequestEvent(eventResult.events);
    const ceoclawAuditResult = !knownCeoclawApproval && runResult.run.status === 'blocked' && typeof ceoclawRequest?.approval_id === 'string'
      ? await listAuditEvents(25, { requestId: ceoclawRequest.approval_id }).catch(() => ({ events: [] }))
      : { events: [] };
    setSelectedRun(runResult.run);
    setContextPack(contextPackResult);
    setDeliveryEvidence(evidenceResult.snapshot);
    setGithubDeliveryPlanArtifact(planResult.artifact);
    setGithubDeliveryPlan(planResult.plan);
    setGithubDeliveryApply(applyResult.result);
    const restoredApplyApproval = applyResult.result ? null : findGithubDeliveryApplyApproval(eventResult.events, runId, planResult.artifact, planResult.plan);
    setGithubDeliveryApplyApproval(restoredApplyApproval);
    if (restoredApplyApproval) {
      setPendingApprovalIds((previous) => Array.from(new Set([...previous, restoredApplyApproval.id])));
    }
    setVerifierDecision(verifierResult.decision);
    setEvents(eventResult.events);
    const resolvedCeoclawApproval = runResult.run.status === 'blocked'
      ? findResolvedCeoclawApprovalFromEvents(eventResult.events, ceoclawAuditResult.events, runId)
      : null;
    const pendingCeoclawFallback = !knownApprovals && !resolvedCeoclawApproval && runResult.run.status === 'blocked'
      ? findPendingCeoclawApprovalFromEvents(eventResult.events, runId)
      : null;
    const restoredCeoclawApproval = knownCeoclawApproval
      ?? resolvedCeoclawApproval
      ?? pendingCeoclawFallback;
    if (pendingCeoclawFallback) {
      setPendingApprovalIds((previous) => Array.from(new Set([...previous, pendingCeoclawFallback.id])));
    } else if (resolvedCeoclawApproval) {
      setPendingApprovalIds((previous) => previous.filter((approvalId) => approvalId !== resolvedCeoclawApproval.id));
    }
    setCeoclawApproval((previous) => (
      restoredCeoclawApproval
      ?? (!ceoclawRequest && (previous?.args?.['runId'] === runId || previous?.run_id === runId) ? previous : null)
    ));
    setNodes(dagResult.nodes);
    setFrames(frameResult.frames);
    setActorSnapshot(actorResult);
    setResearchEvidence(researchResult.evidence);
    const restoredResearchApproval = knownApprovals
      ? findResearchSearchApproval(knownApprovals, runId, researchSearchProviderRef.current)
      : null;
    setResearchSearchApproval((previous) => (
      restoredResearchApproval
      ?? (previous?.args?.['runId'] === runId && approvalMatchesResearchProvider(previous, researchSearchProviderRef.current)
        ? previous
        : null)
    ));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const continuityProjectId = projectRollupProjectId.trim();
      const [dashboardResult, runsResult, overlaysResult, templatesResult, privacyResult, memoryResult, sessionsResult, connectorResult, skillsResult, slashCommandResult, subagentsResult, approvalsResult, latestOpenClawResult, continuityResult] = await Promise.all([
        getDashboard(),
        listRuns(),
        listOverlays(),
        listProductFactoryTemplates(),
        getOchagPrivacy().catch(() => ({ privacyRules: [] })),
        getMemorySnapshot().catch(() => null),
        listSessions({ limit: 5 }).catch(() => ({ sessions: [] })),
        getConnectorInventory()
          .then((snapshot) => {
            setConnectorInventoryError(null);
            return snapshot;
          })
          .catch((err) => {
            setConnectorInventoryError(String(err));
            return null;
          }),
        getSkills()
          .then((catalog) => {
            setSkillInspectorError(null);
            return catalog;
          })
          .catch((err) => {
            setSkillInspectorError(String(err));
            return null;
          }),
        getSlashCommands()
          .then((result) => {
            setSlashCommandError(null);
            return result.commands;
          })
          .catch((err) => {
            setSlashCommandError(String(err));
            return [];
          }),
        getAgents()
          .then((result) => {
            setSubagentsError(null);
            return result;
          })
          .catch((err) => {
            setSubagentsError(String(err));
            return [];
          }),
        listPendingApprovals().catch(() => null),
        getOpenClawImportReport(continuityProjectId ? { projectId: continuityProjectId } : {}).catch((err) => {
          if (typeof err === 'object' && err !== null && 'status' in err && err.status === 404) return null;
          setOpenClawMigrationError(String(err));
          return null;
        }),
        getMemoryContinuity(continuityProjectId ? { projectId: continuityProjectId } : {}).catch(() => null),
      ]);
      setDashboard(dashboardResult.orchestration ?? null);
      setRuns(runsResult.runs);
      setOverlays(overlaysResult.overlays);
      setProductTemplates(templatesResult.templates);
      setOchagPrivacyRules(privacyResult.privacyRules);
      setMemorySnapshot(memoryResult);
      setSessions(sessionsResult.sessions);
      setConnectorInventory(connectorResult);
      setSkillCatalog(skillsResult);
      setSlashCommands(slashCommandResult);
      setSubagents(subagentsResult);
      setLatestOpenClawMigration(latestOpenClawResult);
      setMemoryContinuity(continuityResult);
      if (approvalsResult) {
        const approvals = approvalsResult.approvals;
        pendingApprovalsUnavailableRef.current = false;
        pendingApprovalsRef.current = approvals;
        setPendingApprovalIds(approvals.map((approval) => approval.id));
        const connectorApprovals = connectorProbeApprovalsByConnectorId(approvals);
        if (Object.keys(connectorApprovals).length > 0) {
          setConnectorProbeApprovals((previous) => ({ ...previous, ...connectorApprovals }));
        }
        const restoredResearchApproval = selectedRunId
          ? findResearchSearchApproval(approvals, selectedRunId, researchSearchProviderRef.current)
          : null;
        if (restoredResearchApproval) setResearchSearchApproval(restoredResearchApproval);
        const restoredCeoclawApproval = selectedRunId ? findCeoclawApproval(approvals, selectedRunId) : null;
        if (restoredCeoclawApproval) setCeoclawApproval(restoredCeoclawApproval);
      } else {
        pendingApprovalsUnavailableRef.current = true;
      }
      if (selectedRunId) {
        await loadRun(selectedRunId, approvalsResult ? approvalsResult.approvals : null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadRun, projectRollupProjectId, selectedRunId]);

  const handleCreateMemoryRollup = useCallback(async () => {
    setMemoryRollupLoading(true);
    setMemoryRollupError(null);
    try {
      const result = await createMemoryRollup();
      setLastMemoryRollup(result.rollup);
      const continuityProjectId = projectRollupProjectId.trim();
      const [memoryResult, sessionsResult, continuityResult] = await Promise.all([
        getMemorySnapshot().catch(() => null),
        listSessions({ limit: 5 }).catch(() => ({ sessions: [] })),
        getMemoryContinuity(continuityProjectId ? { projectId: continuityProjectId } : {}).catch(() => null),
      ]);
      setMemorySnapshot(memoryResult);
      setSessions(sessionsResult.sessions);
      setMemoryContinuity(continuityResult);
    } catch (err) {
      setMemoryRollupError(String(err));
    } finally {
      setMemoryRollupLoading(false);
    }
  }, [projectRollupProjectId]);

  const handleCreateProjectMemoryRollup = useCallback(async () => {
    const projectId = projectRollupProjectId.trim();
    if (!projectId) return;
    setProjectRollupLoading(true);
    setProjectRollupError(null);
    try {
      const result = await createProjectMemoryRollup({ projectId, sessionLimit: 200 });
      setProjectRollupResult(result.rollup);
      const [memoryResult, continuityResult] = await Promise.all([
        getMemorySnapshot().catch(() => null),
        getMemoryContinuity({ projectId }).catch(() => null),
      ]);
      setMemorySnapshot(memoryResult);
      setMemoryContinuity(continuityResult);
    } catch (err) {
      setProjectRollupError(String(err));
    } finally {
      setProjectRollupLoading(false);
    }
  }, [projectRollupProjectId]);

  const handleRequestConnectorProbe = useCallback(async (connectorId: string) => {
    setConnectorProbeLoading(`request:${connectorId}`);
    setConnectorProbeError(null);
    try {
      const response = await probeConnector(connectorId);
      if (response.status === 'approval_required') {
        setConnectorProbeApprovals((previous) => ({ ...previous, [connectorId]: response.approval }));
        setPendingApprovalIds((previous) => Array.from(new Set([...previous, response.approval.id])));
      } else {
        setConnectorProbeResults((previous) => ({ ...previous, [connectorId]: response.connector }));
        setConnectorProbeApprovals((previous) => {
          const next = { ...previous };
          delete next[connectorId];
          return next;
        });
      }
    } catch (err) {
      setConnectorProbeError(String(err));
    } finally {
      setConnectorProbeLoading(null);
    }
  }, []);

  const handleRunApprovedConnectorProbe = useCallback(async (connectorId: string, approvalId: string) => {
    if (pendingApprovalIds.includes(approvalId)) {
      setConnectorProbeError(`Approval ${approvalId} is still pending. Approve it in Trust, then refresh Orchestration.`);
      return;
    }
    setConnectorProbeLoading(`run:${connectorId}`);
    setConnectorProbeError(null);
    try {
      const response = await probeConnector(connectorId, { approvalId });
      if (response.status === 'approval_required') {
        setConnectorProbeApprovals((previous) => ({ ...previous, [connectorId]: response.approval }));
        return;
      }
      setConnectorProbeResults((previous) => ({ ...previous, [connectorId]: response.connector }));
      setConnectorProbeApprovals((previous) => {
        const next = { ...previous };
        delete next[connectorId];
        return next;
      });
    } catch (err) {
      setConnectorProbeError(String(err));
    } finally {
      setConnectorProbeLoading(null);
    }
  }, [pendingApprovalIds]);

  const handleRecommendSkills = useCallback(async () => {
    const task = skillTask.trim();
    if (!task) return;
    const requestSeq = ++skillRecommendRequestSeq.current;
    setSkillRecommendLoading(true);
    setSkillInspectorError(null);
    try {
      const result = await recommendSkills({ task, limit: 5 });
      if (requestSeq !== skillRecommendRequestSeq.current) return;
      setSkillRecommendationRequested(true);
      setSkillRecommendations(result.recommendations);
    } catch (err) {
      if (requestSeq !== skillRecommendRequestSeq.current) return;
      setSkillRecommendationRequested(false);
      setSkillRecommendations([]);
      setSkillInspectorError(String(err));
    } finally {
      if (requestSeq === skillRecommendRequestSeq.current) {
        setSkillRecommendLoading(false);
      }
    }
  }, [skillTask]);

  const handleInvokeSkillsCommand = useCallback(async () => {
    if (!skillsSlashCommandExposed) {
      setSlashInvokeError(slashCommandError ? 'Slash command registry unavailable.' : '/skills is not currently exposed by the governed slash command registry.');
      setSlashInvokeOutput(null);
      return;
    }
    const task = skillTask.trim();
    const command = task ? `/skills "${task.replace(/"/g, '\\"')}" --limit=5` : '/skills --limit=5';
    setSlashInvokeLoading(true);
    setSlashInvokeError(null);
    try {
      const result = await invokeSlashCommand({ command });
      if (!result.ok) {
        setSlashInvokeError(result.error || 'slash_command_failed');
        setSlashInvokeOutput(null);
        return;
      }
      setSlashInvokeOutput(result.output || 'Slash command completed without output.');
    } catch (err) {
      setSlashInvokeError(String(err));
      setSlashInvokeOutput(null);
    } finally {
      setSlashInvokeLoading(false);
    }
  }, [skillTask, skillsSlashCommandExposed, slashCommandError]);

  const handleRequestResearchSearch = useCallback(async () => {
    const query = researchSearchQuery.trim();
    if (!selectedRunId || !query) return;
    setResearchSearchLoading(true);
    setResearchSearchError(null);
    try {
      const response = await requestRunResearchSearch(selectedRunId, {
        query,
        maxResults: 5,
        ...(researchSearchProvider ? { provider: researchSearchProvider } : {}),
      });
      if (response.status === 'approval_required') {
        setResearchSearchApproval(response.approval);
        setPendingApprovalIds((previous) => Array.from(new Set([...previous, response.approval.id])));
        return;
      }
      setResearchEvidence((previous) => [...previous, { artifact: response.artifact, snapshot: response.snapshot }]);
      setResearchSearchApproval(null);
    } catch (err) {
      setResearchSearchError(String(err));
    } finally {
      setResearchSearchLoading(false);
    }
  }, [researchSearchProvider, researchSearchQuery, selectedRunId]);

  const handleCreateOperatorResearchEvidence = useCallback(async () => {
    const query = operatorResearchQuery.trim();
    const sourceUrl = operatorResearchSourceUrl.trim();
    const sourceTitle = operatorResearchSourceTitle.trim();
    const summary = operatorResearchSummary.trim();
    if (!selectedRunId || !query || !sourceUrl) return;
    const runId = selectedRunId;
    const normalizedUrl = normalizeOperatorResearchSourceUrl(sourceUrl);
    if (!normalizedUrl.ok) {
      setOperatorResearchError(normalizedUrl.error);
      return;
    }
    setOperatorResearchLoading(true);
    setOperatorResearchError(null);
    try {
      const evidence = await createRunResearchEvidence(runId, {
        query,
        sources: [{
          url: normalizedUrl.url,
          ...(sourceTitle ? { title: sourceTitle } : {}),
        }],
        ...(summary ? { summary } : {}),
      });
      if (selectedRunIdRef.current !== runId) return;
      setResearchEvidence((previous) => [...previous, evidence]);
      setOperatorResearchQuery('');
      setOperatorResearchSourceUrl('');
      setOperatorResearchSourceTitle('');
      setOperatorResearchSummary('');
    } catch (err) {
      if (selectedRunIdRef.current === runId) {
        setOperatorResearchError(String(err));
      }
    } finally {
      if (selectedRunIdRef.current === runId) {
        setOperatorResearchLoading(false);
      }
    }
  }, [operatorResearchQuery, operatorResearchSourceTitle, operatorResearchSourceUrl, operatorResearchSummary, selectedRunId]);

  const handleRunApprovedResearchSearch = useCallback(async () => {
    const query = researchSearchQuery.trim();
    if (!selectedRunId || !researchSearchApproval || !query) return;
    if (pendingApprovalIds.includes(researchSearchApproval.id)) {
      setResearchSearchError(`Approval ${researchSearchApproval.id} is still pending. Approve it in Trust, then refresh Orchestration.`);
      return;
    }
    setResearchSearchLoading(true);
    setResearchSearchError(null);
    try {
      const provider = approvalResearchProvider(researchSearchApproval);
      const response = await requestRunResearchSearch(selectedRunId, {
        query,
        maxResults: 5,
        ...(provider ? { provider } : {}),
        approvalId: researchSearchApproval.id,
      });
      if (response.status === 'approval_required') {
        setResearchSearchApproval(response.approval);
        return;
      }
      setResearchEvidence((previous) => [...previous, { artifact: response.artifact, snapshot: response.snapshot }]);
      setResearchSearchApproval(null);
    } catch (err) {
      setResearchSearchError(String(err));
    } finally {
      setResearchSearchLoading(false);
    }
  }, [pendingApprovalIds, researchSearchApproval, researchSearchQuery, selectedRunId]);

  const handleMemorySearch = useCallback(async () => {
    const query = memorySearchQuery.trim();
    if (!query) return;
    setMemorySearchLoading(true);
    setMemorySearchError(null);
    try {
      const result = await searchMemory({
        q: query,
        projectId: memorySearchProjectId.trim() || undefined,
        limit: 10,
      });
      setMemorySearchResults(result.results);
    } catch (err) {
      setMemorySearchError(String(err));
    } finally {
      setMemorySearchLoading(false);
    }
  }, [memorySearchProjectId, memorySearchQuery]);

  const handleLoadSessionTimeline = useCallback(async (sessionId: string) => {
    try {
      const result = await getSessionTimeline(sessionId);
      setSessionTimeline({ sessionId: result.sessionId, events: result.events.slice(-8) });
    } catch (err) {
      setMemorySearchError(String(err));
    }
  }, []);

  const handleCreateMemoryCorrection = useCallback(async () => {
    const content = memoryCorrectionContent.trim();
    if (!content) return;
    setMemoryCorrectionLoading(true);
    setMemoryCorrectionError(null);
    try {
      const result = await createMemoryCorrection({
        content,
        summary: memoryCorrectionSummary.trim() || undefined,
        projectId: memoryCorrectionProjectId.trim() || undefined,
        memoryType: 'semantic',
        operatorId: 'operator',
      });
      setMemoryCorrectionResult(result.memory);
      setMemorySearchResults((current) => [result.memory, ...current.filter((hit) => hit.id !== result.memory.id)]);
      setMemoryCorrectionContent('');
      setMemoryCorrectionSummary('');
    } catch (err) {
      setMemoryCorrectionError(String(err));
    } finally {
      setMemoryCorrectionLoading(false);
    }
  }, [memoryCorrectionContent, memoryCorrectionProjectId, memoryCorrectionSummary]);

  const handlePreviewOpenClawMigration = useCallback(async () => {
    const projectId = projectRollupProjectId.trim();
    setOpenClawMigrationLoading(true);
    setOpenClawMigrationError(null);
    setOpenClawMigrationResult(null);
    try {
      const preview = await createOpenClawImportReport({
        includePersonality: true,
        includeMemories: true,
        ...(projectId ? { projectId } : {}),
      });
      setOpenClawMigration(preview);
      setLatestOpenClawMigration(preview);
    } catch (err) {
      setOpenClawMigrationError(String(err));
    } finally {
      setOpenClawMigrationLoading(false);
    }
  }, [projectRollupProjectId]);

  const handleImportOpenClawMigration = useCallback(async () => {
    const currentProjectId = projectRollupProjectId.trim();
    const reportProjectId = openClawImportProjectId;
    if (!openClawImportArtifact?.sha256) {
      setOpenClawMigrationError('OpenClaw import report is missing a verification hash');
      return;
    }
    if (currentProjectId !== reportProjectId) {
      setOpenClawMigrationError('OpenClaw import report scope changed; preview the report again for the current project.');
      return;
    }
    setOpenClawMigrationImporting(true);
    setOpenClawMigrationError(null);
    try {
      const response = await importOpenClawMemory({
        reportArtifactId: openClawImportArtifact.id,
        expectedReportSha256: openClawImportArtifact.sha256,
        ...(reportProjectId ? { projectId: reportProjectId } : {}),
      });
      setOpenClawMigrationResult(
        `Imported ${response.result.imported} memory entries; skipped ${response.result.skipped}.`,
      );
      const [memoryResult, sessionsResult] = await Promise.all([
        getMemorySnapshot().catch(() => null),
        listSessions({ limit: 5 }).catch(() => ({ sessions: [] })),
      ]);
      setMemorySnapshot(memoryResult);
      setSessions(sessionsResult.sessions);
    } catch (err) {
      setOpenClawMigrationError(String(err));
    } finally {
      setOpenClawMigrationImporting(false);
    }
  }, [openClawImportArtifact, openClawImportProjectId, projectRollupProjectId]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    void refresh();
    const controller = new AbortController();
    let refreshTimer: number | undefined;
    let fallbackTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 250);
    };
    void streamOperatorEvents({
      signal: controller.signal,
      onEvent: (event) => {
          if (event.type === 'snapshot') {
            if (event.dashboard) setDashboard(event.dashboard);
            if (event.runs) setRuns(event.runs);
            if (event.approvals) {
              pendingApprovalsUnavailableRef.current = false;
              pendingApprovalsRef.current = event.approvals;
              setPendingApprovalIds(event.approvals.map((approval) => approval.id));
            }
          return;
        }
        scheduleRefresh();
      },
      onError: (message) => {
        setError(message);
      },
    }).catch((err) => {
      if (controller.signal.aborted) return;
      setError(String(err));
      fallbackTimer = window.setInterval(() => void refresh(), 5000);
    });
    return () => {
      controller.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
    };
  }, [refresh]);

  const resetOperatorResearchForm = useCallback(() => {
    setOperatorResearchQuery('');
    setOperatorResearchSourceUrl('');
    setOperatorResearchSourceTitle('');
    setOperatorResearchSummary('');
    setOperatorResearchError(null);
    setOperatorResearchLoading(false);
  }, []);

  const selectRun = async (runId: string) => {
    selectedRunIdRef.current = runId;
    setSelectedRunId(runId);
    setCeoclawApproval(null);
    resetOperatorResearchForm();
    setLoading(true);
    setError(null);
    try {
      await loadRun(runId);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const selectOverlay = async (domainId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getOverlay(domainId);
      setSelectedOverlay(result.overlay);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const workflowCount = selectedOverlay?.workflowCount ?? 0;
  const adapterCount = selectedOverlay?.adapterCount ?? 0;
  const effectEvents = events.filter((event) => event.type.startsWith('effect.'));
  const verifierEvents = events.filter((event) => event.type.startsWith('verifier.'));
  const capabilityDecisionsByName = events.reduce<Record<string, AuditEvent[]>>((decisions, event) => {
    if (event.type !== 'tool.executed' || !event.tool?.startsWith('capability:')) return decisions;
    const capability = event.tool.slice('capability:'.length);
    decisions[capability] = [...(decisions[capability] ?? []), event];
    return decisions;
  }, {});
  const capabilityDecisionsByFrameId = events.reduce<Record<string, AuditEvent>>((decisions, event) => {
    if (event.type === 'tool.executed') {
      const frameId = eventStringArg(event, 'frameId');
      if (frameId) decisions[frameId] = event;
    }
    return decisions;
  }, {});
  const capabilityDecisionCursor: Record<string, number> = {};
  const capabilityRequests = events.reduce<CapabilityRequestSummary[]>((requests, event) => {
    if (event.type === 'tool.requested' && event.tool?.startsWith('capability:')) {
      const capability = eventStringArg(event, 'capability') || event.tool.slice('capability:'.length);
      const frameId = eventStringArg(event, 'frameId');
      const decisionIndex = capabilityDecisionCursor[capability] ?? 0;
      const decisionEvent = frameId
        ? capabilityDecisionsByFrameId[frameId]
        : capabilityDecisionsByName[capability]?.[decisionIndex];
      if (!frameId) capabilityDecisionCursor[capability] = decisionIndex + 1;
      const status = decisionEvent?.status === 'granted' || decisionEvent?.status === 'denied'
        ? decisionEvent.status
        : 'pending';
      requests.push({
        key: event.id,
        capability,
        reason: eventStringArg(event, 'reason') || event.reason || '',
        scope: eventRecordArg(event, 'scope'),
        status,
      });
    }
    return requests;
  }, []);

  const runControl = async (
    action: 'execute' | 'replay' | 'continue' | 'abort',
    opts: { approvalId?: string } = {},
  ) => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await controlRun(selectedRunId, action, opts);
      if (result.approval?.toolName === 'ceoclaw_business_brief_approval') {
        const approval = result.approval;
        setCeoclawApproval(approval);
        setPendingApprovalIds((previous) => Array.from(new Set([...previous, approval.id])));
      } else if (opts.approvalId) {
        setCeoclawApproval(null);
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const dispatchActorMessage = async (actorId: string) => {
    if (!selectedRunId) return;
    setActorDispatchingId(actorId);
    setError(null);
    try {
      const result = await dispatchNextRunActorMessage(selectedRunId, { actorId });
      setActorSnapshot(result.snapshot);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setActorDispatchingId(null);
    }
  };

  const recoverActorMessages = async (actorId: string) => {
    if (!selectedRunId) return;
    setActorRecoveringId(actorId);
    setError(null);
    try {
      const result = await recoverStuckRunActorMessages(selectedRunId, {
        actorId,
        olderThanMs: ACTOR_STALE_AFTER_MS,
        reason: 'operator_recover_stuck_actor',
      });
      setActorSnapshot(result.snapshot);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setActorRecoveringId(null);
    }
  };

  const createVerifierWaiver = async () => {
    if (!selectedRunId) return;
    setWaiverLoading(true);
    setWaiverError(null);
    try {
      const result = await createRunVerifierWaiver(selectedRunId, {
        operatorId: waiverOperatorId,
        reason: waiverReason,
        scope: waiverScope,
      });
      setVerifierDecision(result.decision);
      setWaiverReason('');
      await refresh();
    } catch (err) {
      setWaiverError(String(err));
    } finally {
      setWaiverLoading(false);
    }
  };

  const captureDeliveryEvidence = async () => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    try {
      const issueNumber = parseOptionalIssueNumber(deliveryIssueNumber);
      const result = await captureRunDeliveryEvidence(selectedRunId, issueNumber ? { issueNumber } : {});
      await refresh();
      setDeliveryEvidence(result.snapshot);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const createGithubDeliveryPlan = async () => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    try {
      const issueNumber = parseOptionalIssueNumber(deliveryIssueNumber);
      const result = await createRunGithubDeliveryPlan(selectedRunId, issueNumber ? { issueNumber } : {});
      await refresh();
      setGithubDeliveryPlanArtifact(result.artifact);
      setGithubDeliveryPlan(result.plan);
      setGithubDeliveryApplyConfirmation('');
      setGithubDeliveryApplyApproval(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const expectedApplyConfirmation = githubDeliveryPlan
    ? `APPLY ${githubDeliveryPlan.proposedBranch}`
    : '';
  const canRequestGithubDeliveryApply = Boolean(
    selectedRunId
    && githubDeliveryPlan
    && githubDeliveryPlanArtifact?.id
    && githubDeliveryPlanArtifact.sha256
    && githubDeliveryPlan.applySupported
    && githubDeliveryPlan.blockers.length === 0
    && githubDeliveryApplyConfirmation === expectedApplyConfirmation
    && !githubDeliveryApplyLoading
  );

  const requestGithubDeliveryApply = async () => {
    if (!selectedRunId || !githubDeliveryPlanArtifact?.id || !githubDeliveryPlanArtifact.sha256) return;
    setGithubDeliveryApplyLoading(true);
    setGithubDeliveryApplyError(null);
    try {
      const result = await requestRunGithubDeliveryApply(selectedRunId, {
        planArtifactId: githubDeliveryPlanArtifact.id,
        expectedPlanSha256: githubDeliveryPlanArtifact.sha256,
      });
      if (result.status === 'awaiting_approval') {
        setGithubDeliveryApplyApproval(result.approval);
        setPendingApprovalIds((previous) => Array.from(new Set([...previous, result.approval.id])));
      } else {
        setGithubDeliveryApply(result.result);
      }
    } catch (err) {
      setGithubDeliveryApplyError(String(err));
    } finally {
      setGithubDeliveryApplyLoading(false);
    }
  };

  const applyApprovedGithubDelivery = async () => {
    if (!selectedRunId || !githubDeliveryPlanArtifact?.id || !githubDeliveryPlanArtifact.sha256 || !githubDeliveryApplyApproval) return;
    if (pendingApprovalIds.includes(githubDeliveryApplyApproval.id)) {
      setGithubDeliveryApplyError(`Approval ${githubDeliveryApplyApproval.id} is still pending. Approve it in Trust and wait for the live approval snapshot.`);
      return;
    }
    setGithubDeliveryApplyLoading(true);
    setGithubDeliveryApplyError(null);
    try {
      const result = await requestRunGithubDeliveryApply(selectedRunId, {
        planArtifactId: githubDeliveryPlanArtifact.id,
        expectedPlanSha256: githubDeliveryPlanArtifact.sha256,
        approvalId: githubDeliveryApplyApproval.id,
      });
      if (result.status === 'applied') {
        setGithubDeliveryApply(result.result);
        setGithubDeliveryApplyApproval(null);
        await loadRun(selectedRunId);
      }
    } catch (err) {
      setGithubDeliveryApplyError(String(err));
    } finally {
      setGithubDeliveryApplyLoading(false);
    }
  };

  const previewProductPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await previewProductFactoryPlan({
        templateId: selectedProductTemplateId,
        prompt: productPrompt,
        answers: selectedProductAnswers,
      });
      setProductPreview(result.preview);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const createProductRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createProductFactoryRun({
        templateId: selectedProductTemplateId,
        prompt: productPrompt,
        answers: selectedProductAnswers,
      });
      setProductPreview(result.preview);
      selectedRunIdRef.current = result.run.run_id;
      resetOperatorResearchForm();
      setSelectedRunId(result.run.run_id);
      await refresh();
      await loadRun(result.run.run_id);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const previewOchagPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await previewOchagReminder({
        title: ochagTitle,
        familyId: ochagFamilyId,
        dueAt: ochagDueAt,
        audience: ochagAudience,
        visibility: 'family',
      });
      setProductPreview(result.preview);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const createOchagRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createOchagReminderRun({
        title: ochagTitle,
        familyId: ochagFamilyId,
        dueAt: ochagDueAt,
        audience: ochagAudience,
        visibility: 'family',
      });
      setProductPreview(result.preview);
      selectedRunIdRef.current = result.run.run_id;
      resetOperatorResearchForm();
      setSelectedRunId(result.run.run_id);
      await refresh();
      await loadRun(result.run.run_id);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const previewCeoclawPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await previewCeoclawBrief({
        decision: ceoclawDecision,
        evidence: ceoclawEvidence,
        deadline: ceoclawDeadline,
      });
      setProductPreview(result.preview);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const createCeoclawRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createCeoclawBriefRun({
        decision: ceoclawDecision,
        evidence: ceoclawEvidence,
        deadline: ceoclawDeadline,
      });
      setProductPreview(result.preview);
      selectedRunIdRef.current = result.run.run_id;
      resetOperatorResearchForm();
      setSelectedRunId(result.run.run_id);
      await refresh();
      await loadRun(result.run.run_id);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const ceoclawOverlay = overlays.find((overlay) => overlay.domainId === 'ceoclaw') ?? null;

  return (
    <div className="orchestration-panel">
      <section className="orchestration-section orchestration-section--summary">
        <div className="orchestration-section-header">
          <h3>Orchestration</h3>
          <button className="icon-btn" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        {error && <div className="orchestration-error">Unavailable: {sanitizeOverviewText(error)}</div>}
        {dashboard ? (
          <div className="orchestration-summary-grid">
            <SummaryCard label="Runs" value={`${dashboard.runs.total} total / ${dashboard.runs.active} active`} />
            <SummaryCard label="DAG" value={`${dashboard.dag.total} nodes / ${dashboard.dag.running} running`} />
            <SummaryCard label="Blocked" value={`${dashboard.runs.blocked + dashboard.dag.blocked}`} />
            <SummaryCard label="Effects" value={`${dashboard.effects.pending} pending`} />
            <SummaryCard label="Approvals" value={`${dashboard.approvals?.pending ?? 0} pending`} />
            <SummaryCard label="Worker frames" value={`${dashboard.workerFrames?.total ?? 0} total`} />
            <SummaryCard label="Verifier" value={dashboard.verifier.status ?? `${dashboard.verifier.blocked} blocked`} />
            <SummaryCard label="Overlays" value={dashboard.overlays.domainIds.join(', ') || dashboard.overlays.total} />
          </div>
        ) : (
          <div className="panel-placeholder">No orchestration data yet.</div>
        )}
        {dashboard?.contextPack && (
          <div className="orchestration-context-pack">
            Latest context pack: {dashboard.contextPack.id}
          </div>
        )}
      </section>

      <section className="orchestration-section">
        <h3>Connector doctor</h3>
        <div className="orchestration-detail-card">
          <span>
            Local-config inventory only. Live connector probes are skipped, so this shows declared capabilities and missing secrets, not network health.
          </span>
          {connectorInventoryError && <div className="panel-error">Connector inventory unavailable: {sanitizeOverviewText(connectorInventoryError)}</div>}
          {connectorProbeError && <div className="panel-error">Connector probe unavailable: {sanitizeOverviewText(connectorProbeError)}</div>}
          {connectorInventory ? (
            <>
              <div className="orchestration-summary-grid">
                <SummaryCard label="Connectors" value={`${connectorInventory.summary.configured}/${connectorInventory.summary.total} configured`} />
                <SummaryCard label="Missing setup" value={connectorInventory.summary.pending} />
                <SummaryCard label="Stubs" value={connectorInventory.summary.stubs} />
                <SummaryCard label="Live probes skipped" value={connectorInventory.summary.liveProbeSkipped} />
                <SummaryCard label="Probe mode" value={connectorInventory.statusSource} />
              </div>
              <div className="orchestration-overlay-detail">
                <strong>Inventory checked {formatTime(connectorInventory.checkedAt)}</strong>
                {connectorInventory.connectors.map((connector) => {
                  const liveProbeResult = connectorProbeResults[connector.id];
                  return (
                    <span key={connector.id}>
                      {connector.name} · {connector.readiness.state} · {sanitizeOverviewText(connector.readiness.reasons.join('; '), 260)} · next: {sanitizeOverviewText(connector.readiness.nextStep, 160)} · {connector.stub ? 'stub' : 'live-capable'}
                      {!liveProbeResult && <> · live probes skipped</>}
                      {connector.probePreview && (
                        <>
                          {' '}
                          · probe preview: {connector.probePreview.mode}
                          {connector.probePreview.requiresApproval ? ' · approval required' : ''}
                          {connector.probePreview.method && ` ${connector.probePreview.method}`}
                          {connector.probePreview.path && ` ${sanitizeOverviewText(connector.probePreview.path, 120)}`}
                          {connector.probePreview.baseUrlEnvVar && ` · base URL env: ${sanitizeOverviewText(connector.probePreview.baseUrlEnvVar, 80)}`}
                          {connector.probePreview.authEnvVar && ` · auth env: ${sanitizeOverviewText(connector.probePreview.authEnvVar, 80)}`}
                          {connector.probePreview.authHeaderName && ` · auth header: ${sanitizeOverviewText(connector.probePreview.authHeaderName, 80)}`}
                          {connector.probePreview.expectedStatus !== undefined && ` · expects: ${connector.probePreview.expectedStatus}`}
                          {connector.probePreview.expectation && ` · expectation: ${connector.probePreview.expectation}`}
                          {connector.probePreview.requiredEnvVars.length > 0 && ` · env: ${connector.probePreview.requiredEnvVars.join(', ')}`}
                          {connector.probePreview.headerNames.length > 0 && ` · headers: ${connector.probePreview.headerNames.map((header) => sanitizeOverviewText(header, 60)).join(', ')}`}
                          {connector.probePreview.bodyConfigured ? ' · body configured' : ''}
                          {connector.probePreview.note && ` · note: ${sanitizeOverviewText(connector.probePreview.note, 180)}`}
                        </>
                      )}
                      {' '}
                      {connector.hasProbe && (
                        <>
                          <button
                            onClick={() => void handleRequestConnectorProbe(connector.id)}
                            disabled={connectorProbeLoading === `request:${connector.id}` || connectorProbeLoading === `run:${connector.id}`}
                          >
                            {connectorProbeLoading === `request:${connector.id}` ? 'Requesting…' : 'Request live probe'}
                          </button>
                          {connectorProbeApprovals[connector.id] && (() => {
                            const approval = connectorProbeApprovals[connector.id]!;
                            const approvalPending = pendingApprovalIds.includes(approval.id);
                            return (
                              <>
                                {' '}
                                <span>{approvalPending ? 'Approval pending' : 'Approval resolved'}: {approval.id}</span>
                                {renderApprovalContext(approval)}
                                {' '}
                                <button
                                  onClick={() => void handleRunApprovedConnectorProbe(connector.id, approval.id)}
                                  disabled={approvalPending || connectorProbeLoading === `run:${connector.id}`}
                                >
                                  {connectorProbeLoading === `run:${connector.id}`
                                    ? 'Running…'
                                    : approvalPending
                                      ? 'Approve in Trust first'
                                      : 'Run approved probe'}
                                </button>
                              </>
                            );
                          })()}
                        </>
                      )}
                      {liveProbeResult && (
                        <> · live status: {liveProbeResult.status} · {sanitizeOverviewText(liveProbeResult.message, 160)}</>
                      )}
                    </span>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="panel-placeholder">No connector inventory snapshot yet.</div>
          )}
        </div>
      </section>

      <section className="orchestration-section">
        <h3>Skill inspector</h3>
        <div className="orchestration-detail-card">
          <span>Read-only skill catalog and recommendation preview. System prompts are not returned; only hashes and metadata are shown.</span>
          {skillInspectorError && <div className="panel-error">Skill inspector unavailable: {sanitizeOverviewText(skillInspectorError)}</div>}
          {slashCommandError && <div className="panel-error">Slash commands unavailable: {sanitizeOverviewText(slashCommandError)}</div>}
          {skillCatalog ? (
            <>
              <div className="orchestration-summary-grid">
                <SummaryCard label="Skills" value={skillCatalog.total} />
                <SummaryCard label="Prompt mode" value="hash-only" />
                <SummaryCard label="Slash commands" value={slashCommands.length} />
              </div>
              <div className="orchestration-overlay-detail">
                <strong>Governed slash commands</strong>
                {slashCommands.length > 0 ? slashCommands.map((command) => (
                  <span key={command.name}>
                    /{sanitizeOverviewText(command.name, 80)} · {command.permissionClass} · {sanitizeOverviewText(command.description, 180)}
                    {command.argSchema?.positional?.length ? ` · args: ${command.argSchema.positional.map((arg) => arg.name).join(', ')}` : ''}
                  </span>
                )) : !slashCommandError ? (
                  <span>No auto-allow slash commands exposed.</span>
                ) : null}
              </div>
              <div className="orchestration-controls">
                <label>
                  Task preview
                  <input
                    value={skillTask}
                    onChange={(event) => {
                      skillRecommendRequestSeq.current += 1;
                      setSkillTask(event.target.value);
                      setSkillRecommendationRequested(false);
                      setSkillRecommendations([]);
                      setSkillRecommendLoading(false);
                    }}
                    placeholder="Describe task for skill recommendation"
                  />
                </label>
                <button onClick={() => void handleRecommendSkills()} disabled={!skillTask.trim() || skillRecommendLoading}>
                  {skillRecommendLoading ? 'Recommending…' : 'Recommend skills'}
                </button>
                <button onClick={() => void handleInvokeSkillsCommand()} disabled={slashInvokeLoading || !skillsSlashCommandExposed}>
                  {slashInvokeLoading ? 'Running…' : 'Run /skills'}
                </button>
              </div>
              {!skillsSlashCommandExposed && !slashCommandError && <span>/skills is not currently exposed by the governed slash command registry.</span>}
              {slashInvokeError && <div className="panel-error">Slash command failed: {sanitizeOverviewText(slashInvokeError)}</div>}
              {slashInvokeOutput && (
                <div className="orchestration-overlay-detail">
                  <strong>/skills output</strong>
                  <span>{sanitizeOverviewText(slashInvokeOutput, 520)}</span>
                </div>
              )}
              {skillRecommendationRequested && skillRecommendations.length === 0 ? (
                <div className="panel-placeholder">No matching skills for this task.</div>
              ) : (
                <div className="orchestration-list">
                  {(skillRecommendationRequested ? skillRecommendations : skillCatalog.skills.slice(0, 5)).map((skill) => (
                    <article className="orchestration-node" key={skill.id}>
                      <strong>{skill.name}</strong>
                      <span className="orchestration-badge">{skill.id}</span>
                      <span>{skill.description}</span>
                      <span>tags: {skill.tags.join(', ') || 'none'} · steps: {skill.stepsCount} · prompt hash: {skill.systemPromptHash.slice(0, 12)}</span>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="panel-placeholder">No skill catalog snapshot yet.</div>
          )}
        </div>
      </section>

      <section className="orchestration-section">
        <h3>Runtime subagents</h3>
        <div className="orchestration-detail-card">
          <span>Live read-only subagent inventory from Pyrfor Engine. This shows spawned work without starting or mutating agents.</span>
          {subagentsError && <div className="panel-error">Subagents unavailable: {sanitizeOverviewText(subagentsError)}</div>}
          <div className="orchestration-summary-grid">
            <SummaryCard label="Subagents" value={subagents.length} />
          </div>
          {subagents.length > 0 ? (
            <div className="orchestration-overlay-detail">
              <strong>Live subagents</strong>
              {subagents.map((agent) => (
                <span key={agent.id}>
                  {sanitizeOverviewText(agent.name, 160)} · {sanitizeOverviewText(agent.status, 80)} · started {formatTime(agent.startedAt)}
                </span>
              ))}
            </div>
          ) : (
            <div className="panel-placeholder">No live subagents reported.</div>
          )}
        </div>
      </section>

      <section className="orchestration-section">
        <h3>Memory continuity</h3>
        <div className="orchestration-detail-card">
          {memoryContinuity ? (
            <div className="orchestration-node">
              <strong>Continuity doctor</strong>
              <span className="orchestration-badge">{memoryContinuity.warnings.length === 0 ? 'ok' : 'attention'}</span>
              <span>
                Workspace memory files: {memoryContinuity.workspaceFiles.present}/{memoryContinuity.workspaceFiles.total}
                {memoryContinuity.workspaceFiles.missing.length > 0 ? ` · missing ${memoryContinuity.workspaceFiles.missing.join(', ')}` : ''}
              </span>
              <span>
                Daily rollup: {continuityStatusLabel(memoryContinuity.latestDailyRollup)}
                {memoryContinuity.latestDailyRollup.date ? ` · ${memoryContinuity.latestDailyRollup.date}` : ''}
                {memoryContinuity.latestDailyRollup.artifact?.id ? ` · ${memoryContinuity.latestDailyRollup.artifact.id}` : ''}
              </span>
              {renderContinuityArtifactTrust('Daily rollup', memoryContinuity.latestDailyRollup)}
              <span>
                Project rollup: {continuityStatusLabel(memoryContinuity.latestProjectRollup)}
                {memoryContinuity.latestProjectRollup.projectId ? ` · ${memoryContinuity.latestProjectRollup.projectId}` : ''}
                {memoryContinuity.latestProjectRollup.artifact?.id ? ` · ${memoryContinuity.latestProjectRollup.artifact.id}` : ''}
              </span>
              {renderContinuityArtifactTrust('Project rollup', memoryContinuity.latestProjectRollup)}
              <span>
                OpenClaw report: {continuityStatusLabel(memoryContinuity.latestOpenClawReport)}
                {memoryContinuity.latestOpenClawReport.artifact?.id ? ` · ${memoryContinuity.latestOpenClawReport.artifact.id}` : ''}
                {memoryContinuity.latestOpenClawReport.counts ? ` · ${memoryContinuity.latestOpenClawReport.counts.importable} importable` : ''}
              </span>
              {renderContinuityArtifactTrust('OpenClaw report', memoryContinuity.latestOpenClawReport)}
              {memoryContinuity.warnings.length > 0 && <span>Warnings: {memoryContinuity.warnings.join(', ')}</span>}
            </div>
          ) : (
            <div className="panel-placeholder">Memory continuity doctor unavailable.</div>
          )}
          <div className="orchestration-actions">
            <button onClick={handleCreateMemoryRollup} disabled={memoryRollupLoading}>
              {memoryRollupLoading ? 'Creating rollup…' : 'Create daily rollup'}
            </button>
            {lastMemoryRollup && (
              <span>
                {lastMemoryRollup.date}: {lastMemoryRollup.sessionCount} sessions, {lastMemoryRollup.ledgerEventCount} events
              </span>
            )}
          </div>
          {memoryRollupError && <div className="panel-error">{sanitizeOverviewText(memoryRollupError)}</div>}
          <div className="orchestration-overlay-detail">
            <strong>Project memory rollup</strong>
            <span>Promote project decisions, conventions, risks, active threads and unresolved tasks into durable memory.</span>
            <div className="orchestration-actions">
              <input
                value={projectRollupProjectId}
                onChange={(event) => setProjectRollupProjectId(event.target.value)}
                placeholder="Project ID"
              />
              <button
                onClick={handleCreateProjectMemoryRollup}
                disabled={projectRollupLoading || !projectRollupProjectId.trim()}
              >
                {projectRollupLoading ? 'Creating project rollup…' : 'Create project rollup'}
              </button>
            </div>
            {projectRollupError && <div className="panel-error">{sanitizeOverviewText(projectRollupError)}</div>}
            {projectRollupResult && (
              <>
                <span>
                  {sanitizeOverviewText(projectRollupResult.projectId)}: {projectRollupResult.sessionCount} sessions, {projectRollupResult.ledgerEventCount} events, {projectRollupResult.runIds.length} runs
                </span>
                {projectRollupResult.memories.map((memory) => (
                  <span key={`${memory.category}:${memory.memoryId}`}>
                    {memory.category} · {sanitizeOverviewText(memory.summary)} · {memory.memoryId}
                  </span>
                ))}
              </>
            )}
          </div>
          <div className="orchestration-actions">
            <input
              value={memorySearchQuery}
              onChange={(event) => setMemorySearchQuery(event.target.value)}
              placeholder="Search durable memory"
            />
            <input
              value={memorySearchProjectId}
              onChange={(event) => setMemorySearchProjectId(event.target.value)}
              placeholder="Project ID (optional)"
            />
            <button onClick={handleMemorySearch} disabled={memorySearchLoading || !memorySearchQuery.trim()}>
              {memorySearchLoading ? 'Searching…' : 'Search memory'}
            </button>
          </div>
          {memorySearchError && <div className="panel-error">{sanitizeOverviewText(memorySearchError)}</div>}
          <div className="orchestration-overlay-detail">
            <strong>Add memory correction</strong>
            <input
              value={memoryCorrectionSummary}
              onChange={(event) => setMemoryCorrectionSummary(event.target.value)}
              placeholder="Correction summary"
            />
            <input
              value={memoryCorrectionProjectId}
              onChange={(event) => setMemoryCorrectionProjectId(event.target.value)}
              placeholder="Project ID (optional)"
            />
            <textarea
              value={memoryCorrectionContent}
              onChange={(event) => setMemoryCorrectionContent(event.target.value)}
              placeholder="Corrected durable memory fact"
            />
            <button onClick={handleCreateMemoryCorrection} disabled={memoryCorrectionLoading || !memoryCorrectionContent.trim()}>
              {memoryCorrectionLoading ? 'Saving…' : 'Save correction'}
            </button>
            {memoryCorrectionResult && <span>Saved: {sanitizeOverviewText(memoryCorrectionResult.summary ?? memoryCorrectionResult.id)}</span>}
            {memoryCorrectionError && <div className="panel-error">{sanitizeOverviewText(memoryCorrectionError)}</div>}
          </div>
          <div className="orchestration-overlay-detail">
            <strong>OpenClaw migration</strong>
            <span>Preview imports safe markdown personality, memory and skill files into durable Pyrfor memory.</span>
            <div className="orchestration-actions">
              <button onClick={handlePreviewOpenClawMigration} disabled={openClawMigrationLoading || openClawMigrationImporting}>
                {openClawMigrationLoading ? 'Scanning…' : 'Preview OpenClaw import'}
              </button>
              <button
                onClick={handleImportOpenClawMigration}
                disabled={!openClawImportReady || openClawMigrationLoading || openClawMigrationImporting}
              >
                {openClawMigrationImporting ? 'Importing…' : 'Import approved report'}
              </button>
            </div>
            {openClawImportArtifact && !openClawImportScopeMatches && (
              <span>Preview scope differs from the current project; preview OpenClaw import again.</span>
            )}
            {latestOpenClawMigration ? (
              <div className="orchestration-node">
                <strong>Latest reviewed report</strong>
                <span>Artifact: {latestOpenClawMigration.artifact.id}</span>
                {latestOpenClawMigration.artifact.sha256 && <span>SHA-256: {latestOpenClawMigration.artifact.sha256}</span>}
                <span>Generated: {new Date(latestOpenClawMigration.report.generatedAt).toLocaleString()}</span>
                <span>Project scope: {latestOpenClawMigration.report.projectId ? sanitizeOverviewText(latestOpenClawMigration.report.projectId) : 'workspace'}</span>
                <span>Source: {sanitizeOverviewText(latestOpenClawMigration.report.sourceRoot)}</span>
                <span>
                  Counts: {latestOpenClawMigration.report.counts.importable} importable, {latestOpenClawMigration.report.counts.skipped} skipped, {latestOpenClawMigration.report.counts.redactions} redactions
                </span>
                {latestOpenClawMigration.report.skipped.slice(0, 3).map((entry) => (
                  <span key={`${entry.sourceRelPath}:${entry.reason}`}>
                    Skipped: {sanitizeOverviewText(entry.sourceRelPath)} · {sanitizeOverviewText(entry.reason)}
                  </span>
                ))}
              </div>
            ) : openClawUsingContinuityFallback && continuityOpenClawReport?.artifact ? (
              <div className="orchestration-node">
                <strong>Continuity doctor reviewed report</strong>
                <span>Artifact: {continuityOpenClawReport.artifact.id}</span>
                <span>SHA-256: {continuityOpenClawReport.artifact.sha256}</span>
                {continuityOpenClawReport.createdAt && <span>Generated: {new Date(continuityOpenClawReport.createdAt).toLocaleString()}</span>}
                {continuityOpenClawReport.projectId && <span>Project scope: {sanitizeOverviewText(continuityOpenClawReport.projectId)}</span>}
                {continuityOpenClawReport.counts && (
                  <span>
                    Counts: {continuityOpenClawReport.counts.importable} importable, {continuityOpenClawReport.counts.skipped} skipped, {continuityOpenClawReport.counts.redactions} redactions
                  </span>
                )}
                <span>Details unavailable; using continuity doctor artifact.</span>
              </div>
            ) : (
              <span>No reviewed OpenClaw import report yet.</span>
            )}
            {openClawMigration && (
              <>
                <span>
                  Report: {openClawMigration.report.counts.importable} importable, {openClawMigration.report.counts.skipped} skipped, {openClawMigration.report.counts.redactions} redactions
                </span>
                <span>Project scope: {openClawMigration.report.projectId ? sanitizeOverviewText(openClawMigration.report.projectId) : 'workspace'}</span>
                <span>Source: {sanitizeOverviewText(openClawMigration.report.sourceRoot)}</span>
                {openClawMigration.report.entries.slice(0, 5).map((entry) => (
                  <span key={entry.fingerprint}>
                    {entry.sourceKind} · {sanitizeOverviewText(entry.sourceRelPath)} · {sanitizeOverviewText(entry.summary)}
                  </span>
                ))}
              </>
            )}
            {openClawMigrationResult && <span>{sanitizeOverviewText(openClawMigrationResult)}</span>}
            {openClawMigrationError && <div className="panel-error">{sanitizeOverviewText(openClawMigrationError)}</div>}
          </div>
          <div className="orchestration-summary-grid">
            <SummaryCard label="Memory files" value={memorySnapshot?.files.length ?? 0} />
            <SummaryCard label="Recent lines" value={memorySnapshot?.lines.length ?? 0} />
            <SummaryCard label="Recent sessions" value={sessions.length} />
          </div>
          {memorySearchResults.length > 0 && (
            <div className="orchestration-overlay-detail">
              <strong>Durable memory search results</strong>
              {memorySearchResults.map((hit) => (
                <span key={hit.id}>
                  [{hit.source}{hit.projectMemoryCategory ? ` · ${hit.projectMemoryCategory}` : hit.rollupKind ? ` · ${hit.rollupKind}` : ''}] {sanitizeOverviewText(hit.summary ?? hit.content.slice(0, 180))}
                </span>
              ))}
            </div>
          )}
          {memorySnapshot && memorySnapshot.lines.length > 0 ? (
            <div className="orchestration-overlay-detail">
              <strong>Recent remembered context</strong>
              {memorySnapshot.lines.slice(-5).map((line, index) => (
                <span key={`${index}:${line}`}>{sanitizeOverviewText(line)}</span>
              ))}
            </div>
          ) : (
            <div className="panel-placeholder">No workspace memory snapshot yet.</div>
          )}
          {sessions.length > 0 && (
            <div className="orchestration-overlay-detail">
              <strong>Latest sessions</strong>
              {sessions.map((session) => (
                <span key={session.id}>
                  {sanitizeOverviewText(session.title, 120)} · {session.mode} · {session.messageCount} messages · {formatTime(session.updatedAt)}
                  {session.summary ? ` · ${sanitizeOverviewText(session.summary, 160)}` : ''}
                  {' '}
                  <button onClick={() => void handleLoadSessionTimeline(session.id)}>Timeline</button>
                </span>
              ))}
              {sessionTimeline && (
                <div className="orchestration-overlay-detail">
                  <strong>Timeline: {sessionTimeline.sessionId}</strong>
                  {sessionTimeline.events.map((event) => (
                    <span key={event.id}>
                      #{event.index + 1} · {event.role} · {formatTime(event.createdAt)} · {sanitizeOverviewText(event.content)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="orchestration-section">
        <h3>CEOClaw business overlay</h3>
        <div className="orchestration-detail-card">
          <label>
            Decision
            <input value={ceoclawDecision} onChange={(event) => setCeoclawDecision(event.target.value)} />
          </label>
          <label>
            Evidence
            <input value={ceoclawEvidence} onChange={(event) => setCeoclawEvidence(event.target.value)} />
          </label>
          <label>
            Deadline
            <input value={ceoclawDeadline} onChange={(event) => setCeoclawDeadline(event.target.value)} />
          </label>
          <div className="orchestration-actions">
            <button className="icon-btn" onClick={() => void previewCeoclawPlan()} disabled={loading}>Preview CEOClaw brief</button>
            <button className="icon-btn" onClick={() => void createCeoclawRun()} disabled={loading}>Create CEOClaw run</button>
          </div>
          {ceoclawOverlay && (
            <div className="orchestration-overlay-detail">
              <strong>CEOClaw controls</strong>
              <span>Privacy rules: {ceoclawOverlay.privacyRuleIds.join(', ') || 'none'}</span>
              <span>Tool permissions: {ceoclawOverlay.toolPermissionSummaries.join(', ') || 'none'}</span>
            </div>
          )}
        </div>
      </section>

      <section className="orchestration-section">
        <h3>Ochag family assistant</h3>
        <div className="orchestration-detail-card">
          <label>
            Reminder
            <input value={ochagTitle} onChange={(event) => setOchagTitle(event.target.value)} />
          </label>
          <label>
            Family ID
            <input value={ochagFamilyId} onChange={(event) => setOchagFamilyId(event.target.value)} />
          </label>
          <label>
            Due
            <input value={ochagDueAt} onChange={(event) => setOchagDueAt(event.target.value)} />
          </label>
          <label>
            Audience
            <input value={ochagAudience} onChange={(event) => setOchagAudience(event.target.value)} />
          </label>
          <div className="orchestration-actions">
            <button className="icon-btn" onClick={() => void previewOchagPlan()} disabled={loading}>Preview Ochag reminder</button>
            <button className="icon-btn" onClick={() => void createOchagRun()} disabled={loading}>Create Ochag run</button>
          </div>
          {ochagPrivacyRules.length > 0 && (
            <div className="orchestration-overlay-detail">
              <strong>Ochag privacy rules</strong>
              <span>{ochagPrivacyRules.map((rule) => (rule as { id?: string }).id).filter(Boolean).join(', ')}</span>
            </div>
          )}
        </div>
      </section>

      <section className="orchestration-section">
        <h3>Product Factory</h3>
        {productTemplates.length === 0 ? (
          <div className="panel-placeholder">No product templates available.</div>
        ) : (
          <div className="orchestration-detail-card">
            <label>
              Template
              <select
                value={selectedProductTemplateId}
                onChange={(event) => setSelectedProductTemplateId(event.target.value as ProductFactoryTemplateId)}
              >
                {productTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.title}</option>
                ))}
              </select>
            </label>
            <label>
              Product idea
              <textarea
                value={productPrompt}
                onChange={(event) => setProductPrompt(event.target.value)}
                rows={3}
              />
            </label>
            {selectedProductTemplate?.clarifications.map((clarification) => (
              <label key={clarification.id}>
                {clarification.question}
                <input
                  value={productAnswers[clarification.id] ?? ''}
                  onChange={(event) => setProductAnswers((current) => ({
                    ...current,
                    [clarification.id]: event.target.value,
                  }))}
                />
              </label>
            ))}
            <div className="orchestration-actions">
              <button className="icon-btn" onClick={() => void previewProductPlan()} disabled={loading}>Preview plan</button>
              <button
                className="icon-btn"
                onClick={() => void createProductRun()}
                disabled={loading || missingProductAnswerIds.length > 0}
                title={missingProductAnswerIds.length > 0 ? `Missing: ${missingProductAnswerIds.join(', ')}` : undefined}
              >
                Create run
              </button>
            </div>
            {productPreview && (
              <div className="orchestration-overlay-detail">
                <strong>{productPreview.intent.title}</strong>
                <span>{productPreview.template.title}</span>
                <span>
                  Missing clarifications: {productPreview.missingClarifications.map((item) => item.id).join(', ') || 'none'}
                </span>
                <span>DAG preview: {productPreview.dagPreview.nodes.map((node) => node.kind).join(' -> ')}</span>
                <span>Delivery: {productPreview.deliveryChecklist.join(', ')}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="orchestration-section">
        <h3>Runs</h3>
        {runs.length === 0 ? (
          <div className="panel-placeholder">No runs recorded.</div>
        ) : (
          <div className="orchestration-list">
            {runs.map((run) => (
              <button
                key={run.run_id}
                className={`orchestration-row${selectedRunId === run.run_id ? ' active' : ''}`}
                onClick={() => void selectRun(run.run_id)}
              >
                <span className="orchestration-row-title">{run.task_id || run.run_id}</span>
                <span className="orchestration-badge">{run.status}</span>
                <span>{formatTime(run.updated_at)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="orchestration-section orchestration-section--details">
        <h3>Run details</h3>
        {selectedRun ? (
          <>
            <div className="orchestration-detail-card">
              <strong>{selectedRun.run_id}</strong>
              <span>{selectedRun.mode} / {selectedRun.status}</span>
              <span>{selectedRun.workspace_id}</span>
              <div className="orchestration-actions">
                <label className="inline-field">
                  <span>GitHub issue #</span>
                  <input
                    value={deliveryIssueNumber}
                    onChange={(event) => setDeliveryIssueNumber(event.target.value)}
                    placeholder="optional"
                    inputMode="numeric"
                  />
                </label>
                {selectedRun.status === 'planned' && (
                  <button className="icon-btn" onClick={() => void runControl('execute')} disabled={loading}>Execute</button>
                )}
                {selectedRun.status === 'blocked' && ceoclawApproval && (
                  <button
                    className="icon-btn"
                    onClick={() => void runControl('execute', { approvalId: ceoclawApproval.id })}
                    disabled={loading || pendingApprovalIds.includes(ceoclawApproval.id)}
                  >
                    {pendingApprovalIds.includes(ceoclawApproval.id) ? 'Approve in Trust first' : 'Finalize CEOClaw approval'}
                  </button>
                )}
                <button className="icon-btn" onClick={() => void captureDeliveryEvidence()} disabled={loading}>Capture evidence</button>
                <button className="icon-btn" onClick={() => void createGithubDeliveryPlan()} disabled={loading}>Plan GitHub delivery</button>
                <button className="icon-btn" onClick={() => void runControl('replay')} disabled={loading}>Replay</button>
                <button className="icon-btn" onClick={() => void runControl('continue')} disabled={loading}>Continue</button>
                <button className="icon-btn" onClick={() => void runControl('abort')} disabled={loading}>Abort</button>
              </div>
              {ceoclawApproval && (
                <div className="orchestration-hint">
                  <span>
                    CEOClaw approval {pendingApprovalIds.includes(ceoclawApproval.id) ? 'pending' : 'resolved'}: {ceoclawApproval.id}.
                    {pendingApprovalIds.includes(ceoclawApproval.id) ? ' Resolve it in Trust, then finalize this run.' : ' Finalize this run to continue.'}
                  </span>
                  {renderApprovalContext(ceoclawApproval)}
                </div>
              )}
            </div>
            <div className="orchestration-subgrid">
              <div>
                <h4>Events</h4>
                {events.length === 0 ? (
                  <div className="panel-placeholder">No events for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    {events.slice(-12).reverse().map((event) => (
                      <article className="orchestration-event" key={event.id}>
                        <span className="orchestration-event-type">{event.type}</span>
                        <span>{formatTime(event.ts)}</span>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Worker frames</h4>
                {frames.length === 0 ? (
                  <div className="panel-placeholder">No worker frames for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    {frames.slice(-12).reverse().map((frame) => (
                      <article className="orchestration-node" key={frame.nodeId || frame.frame_id}>
                        <strong>{frame.type}</strong>
                        <span className="orchestration-badge">{String(frame.disposition ?? frame.ok ?? 'recorded')}</span>
                        {frame.seq !== undefined && <span>seq: {String(frame.seq)}</span>}
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Capability requests</h4>
                {capabilityRequests.length === 0 ? (
                  <div className="panel-placeholder">No worker capability requests for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    {capabilityRequests.map((request) => (
                      <article className="orchestration-node" key={request.key}>
                        <strong>{sanitizeOverviewText(request.capability, 80)}</strong>
                        <span className="orchestration-badge">{request.status}</span>
                        {request.reason && <span>reason: {sanitizeOverviewText(request.reason, 180)}</span>}
                        {request.scope && <span>scope: {sanitizeCapabilityScope(request.scope)}</span>}
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Actors</h4>
                {!actorSnapshot || actorSnapshot.actors.length === 0 ? (
                  <div className="panel-placeholder">No actor state for this run yet.</div>
                ) : (
                  <div className="orchestration-list">
                    <span>
                      Totals: {actorSnapshot.totals.actors} actors · {actorSnapshot.totals.running} running · {actorSnapshot.totals.blocked} blocked · {actorSnapshot.totals.failed} failed · {actorSnapshot.totals.mailboxPending} mailbox pending
                      {actorSnapshot.totals.mailboxStale ? ` · ${actorSnapshot.totals.mailboxStale} stale` : ''}
                    </span>
                    {actorSnapshot.actors.map((actor) => (
                      <article className="orchestration-node" key={actor.actorId}>
                        <strong>{actor.agentName ?? actor.actorId}</strong>
                        <span className="orchestration-badge">{actor.status}</span>
                        {actor.role && <span>{actor.role}</span>}
                        {actor.currentWork && <span>{actor.currentWork}</span>}
                        <span>
                          mailbox: {actor.mailbox.pending} pending · {actor.mailbox.leased} leased
                          {actor.mailbox.stale ? ` · ${actor.mailbox.stale} stale` : ''}
                          {actor.mailbox.oldestLeasedAgeMs !== undefined ? ` · oldest lease ${Math.round(actor.mailbox.oldestLeasedAgeMs / 1000)}s` : ''}
                        </span>
                        {actor.budget?.profile && <span>budget: {actor.budget.profile}</span>}
                        {actor.outputs[0] && <span>output: {actor.outputs[0]}</span>}
                        {actor.blockers[0] && <span>blocker: {actor.blockers[0]}</span>}
                        {actor.mailbox.pending > 0 && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void dispatchActorMessage(actor.actorId)}
                            disabled={actorDispatchingId !== null || actorRecoveringId !== null || loading}
                          >
                            {actorDispatchingId === actor.actorId ? 'Dispatching...' : 'Dispatch next'}
                          </button>
                        )}
                        {(actor.mailbox.stale ?? 0) > 0 && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void recoverActorMessages(actor.actorId)}
                            disabled={actorDispatchingId !== null || actorRecoveringId !== null || loading}
                          >
                            {actorRecoveringId === actor.actorId ? 'Recovering...' : 'Recover stale'}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Context pack</h4>
                {!contextPack ? (
                  <div className="panel-placeholder">No context pack artifact for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    <article className="orchestration-node">
                      <strong>{contextPack.pack.packId}</strong>
                      <span className="orchestration-badge">{contextPack.pack.hash.slice(0, 12)}</span>
                      <span>compiled {formatTime(contextPack.pack.compiledAt)}</span>
                      <span>workspace: {sanitizeOverviewText(contextPack.pack.workspaceId, 120)}</span>
                      {contextPack.pack.projectId && <span>project: {sanitizeOverviewText(contextPack.pack.projectId, 120)}</span>}
                      <span>sources: {contextPack.pack.sourceRefs.length} · {countContextSourcesByRole(contextPack.pack.sourceRefs)}</span>
                    </article>
                    {contextPack.pack.sections
                      .filter((section) => section.id === 'workspace_files' || section.id === 'policy' || section.id === 'project_memory')
                      .map((section) => (
                        <article className="orchestration-node" key={section.id}>
                          <strong>{sanitizeOverviewText(section.title, 120)}</strong>
                          <span className="orchestration-badge">{section.kind}</span>
                          <span>{section.sources.length} sources</span>
                          <span>{sanitizeOverviewText(section.content, 260)}</span>
                        </article>
                      ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Research evidence</h4>
                <div className="orchestration-controls">
                  <label>
                    Operator evidence query
                    <input
                      value={operatorResearchQuery}
                      onChange={(event) => setOperatorResearchQuery(event.target.value)}
                      placeholder="Question or claim this source supports"
                    />
                  </label>
                  <label>
                    Operator source URL
                    <input
                      value={operatorResearchSourceUrl}
                      onChange={(event) => setOperatorResearchSourceUrl(event.target.value)}
                      placeholder="https://example.com/source"
                    />
                  </label>
                  <label>
                    Operator source title
                    <input
                      value={operatorResearchSourceTitle}
                      onChange={(event) => setOperatorResearchSourceTitle(event.target.value)}
                      placeholder="Optional source title"
                    />
                  </label>
                  <label>
                    Operator evidence summary
                    <input
                      value={operatorResearchSummary}
                      onChange={(event) => setOperatorResearchSummary(event.target.value)}
                      placeholder="Optional summary"
                    />
                  </label>
                  <button
                    onClick={() => void handleCreateOperatorResearchEvidence()}
                    disabled={!operatorResearchQuery.trim() || !operatorResearchSourceUrl.trim() || operatorResearchLoading}
                  >
                    {operatorResearchLoading ? 'Saving…' : 'Save operator evidence'}
                  </button>
                  <label>
                    Governed web search
                    <input
                      value={researchSearchQuery}
                      onChange={(event) => setResearchSearchQuery(event.target.value)}
                      placeholder="Search query to capture as evidence"
                    />
                  </label>
                  <label>
                    Search provider
                    <select
                      value={researchSearchProvider}
                      onChange={(event) => {
                        const provider = event.target.value as ResearchSearchProviderOption;
                        researchSearchProviderRef.current = provider;
                        setResearchSearchProvider(provider);
                        setResearchSearchApproval((approval) => (
                          approval && approvalMatchesResearchProvider(approval, provider) ? approval : null
                        ));
                      }}
                    >
                      <option value="">Configured default</option>
                      <option value="brave">Brave</option>
                      <option value="duckduckgo">DuckDuckGo</option>
                    </select>
                  </label>
                  <button
                    onClick={() => void handleRequestResearchSearch()}
                    disabled={!researchSearchQuery.trim() || researchSearchLoading}
                  >
                    {researchSearchLoading ? 'Working…' : 'Request live search'}
                  </button>
                  {researchSearchApproval && (() => {
                    const approvalPending = pendingApprovalIds.includes(researchSearchApproval.id);
                    return (
                      <>
                        <span>{approvalPending ? 'Approval pending' : 'Approval resolved'}: {researchSearchApproval.id}</span>
                        {renderApprovalContext(researchSearchApproval)}
                        <button
                          onClick={() => void handleRunApprovedResearchSearch()}
                          disabled={approvalPending || researchSearchLoading}
                        >
                          {approvalPending ? 'Approve in Trust first' : 'Run approved search'}
                        </button>
                      </>
                    );
                  })()}
                </div>
                {operatorResearchError && <div className="panel-error">Operator evidence unavailable: {sanitizeOverviewText(operatorResearchError)}</div>}
                {researchSearchError && <div className="panel-error">Research search unavailable: {sanitizeOverviewText(researchSearchError)}</div>}
                {researchEvidence.length === 0 ? (
                  <div className="panel-placeholder">No research evidence artifacts for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    {researchEvidence.slice(-6).reverse().map(({ artifact, snapshot }) => (
                      <article className="orchestration-node" key={artifact.id}>
                        <strong>{sanitizeOverviewText(snapshot.query, 140)}</strong>
                        <span className="orchestration-badge">{snapshot.sourceMode}</span>
                        <span>{snapshot.sources.length} sources · {formatTime(snapshot.createdAt)}</span>
                        {renderResearchEvidenceTrust(artifact, snapshot)}
                        {snapshot.effectsExecuted.length > 0 && (
                          <span>
                            effect: {snapshot.effectsExecuted.map((effect) => `${effect.kind}/${effect.provider}`).join(', ')}
                          </span>
                        )}
                        {snapshot.summary && <span>{sanitizeOverviewText(snapshot.summary, 220)}</span>}
                        {snapshot.sources.slice(0, 3).map((source, index) => renderResearchEvidenceSource(artifact.id, source, index))}
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Effects</h4>
                {effectEvents.length === 0 ? (
                  <div className="panel-placeholder">No effect events for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    {effectEvents.slice(-12).reverse().map((event) => (
                      <article className="orchestration-event" key={event.id}>
                        <span className="orchestration-event-type">{event.type}</span>
                        <span>{event.effect_id ?? event.toolName ?? ''}</span>
                        <span>{event.reason ? sanitizeOverviewText(event.reason) : event.decision ?? event.status ?? ''}</span>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Verifier</h4>
                {verifierDecision && (
                  <article className="orchestration-node">
                    <strong>{verifierDecision.status}</strong>
                    <span className="orchestration-badge">raw: {verifierDecision.rawStatus}</span>
                    <span>{verifierDecision.reason ? sanitizeOverviewText(verifierDecision.reason) : 'latest verifier decision'}</span>
                    {verifierDecision.waiver && (
                      <span>
                        waived by {sanitizeOverviewText(verifierDecision.waiver.operator.name ?? verifierDecision.waiver.operator.id, 80)}: {sanitizeOverviewText(verifierDecision.waiver.reason)}
                      </span>
                    )}
                    {verifierDecision.waiverEligible && verifierDecision.status !== 'waived' && (
                      <>
                        <span>Create an explicit waiver to resume or unlock delivery actions.</span>
                        <input
                          value={waiverOperatorId}
                          onChange={(event) => setWaiverOperatorId(event.target.value)}
                          placeholder="operator id"
                          disabled={waiverLoading}
                        />
                        <select
                          value={waiverScope}
                          onChange={(event) => setWaiverScope(event.target.value as typeof waiverScope)}
                          disabled={waiverLoading}
                        >
                          <option value="all">all</option>
                          <option value="run">run completion</option>
                          <option value="delivery">delivery</option>
                          <option value="delivery_plan">delivery plan</option>
                          <option value="delivery_apply">delivery apply</option>
                        </select>
                        <textarea
                          value={waiverReason}
                          onChange={(event) => setWaiverReason(event.target.value)}
                          placeholder="waiver reason"
                          disabled={waiverLoading}
                        />
                        <button
                          className="icon-btn"
                          onClick={() => void createVerifierWaiver()}
                          disabled={waiverLoading || !waiverOperatorId.trim() || waiverReason.trim().length < 8}
                        >
                          Create verifier waiver
                        </button>
                        {waiverError && <span className="orchestration-error">{sanitizeOverviewText(waiverError)}</span>}
                      </>
                    )}
                  </article>
                )}
                {verifierEvents.length === 0 ? (
                  <div className="panel-placeholder">No verifier events for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    {verifierEvents.slice(-6).reverse().map((event) => (
                      <article className="orchestration-event" key={event.id}>
                        <span className="orchestration-event-type">{event.type}</span>
                        <span>{event.status ?? event.decision ?? ''}</span>
                        <span>{event.reason ? sanitizeOverviewText(event.reason) : ''}</span>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>GitHub delivery evidence</h4>
                {!deliveryEvidence ? (
                  <div className="panel-placeholder">No delivery evidence captured.</div>
                ) : (
                  <div className="orchestration-list">
                    <article className="orchestration-node">
                      <strong>{sanitizeOverviewText(deliveryEvidence.github.repository ?? deliveryEvidence.git.remote?.repository ?? 'local workspace', 120)}</strong>
                      <span className="orchestration-badge">{deliveryEvidence.verifierStatus ?? 'snapshot'}</span>
                      <span>branch: {deliveryEvidence.git.branch ? sanitizeOverviewText(deliveryEvidence.git.branch, 120) : 'unknown'}</span>
                      {deliveryEvidence.git.headSha && <span>sha: {deliveryEvidence.git.headSha.slice(0, 12)}</span>}
                      {safeExternalHref(deliveryEvidence.github.branch?.url) && (
                        <a href={safeExternalHref(deliveryEvidence.github.branch?.url)} target="_blank" rel="noreferrer">branch page</a>
                      )}
                    </article>
                    {renderDeliveryEvidenceReadiness(deliveryEvidence)}
                    {deliveryEvidence.github.issue && (
                      <article className="orchestration-node">
                        <strong>Issue #{deliveryEvidence.github.issue.number}</strong>
                        <span className="orchestration-badge">{deliveryEvidence.github.issue.state ?? 'linked'}</span>
                        {safeExternalHref(deliveryEvidence.github.issue.url) ? (
                          <a href={safeExternalHref(deliveryEvidence.github.issue.url)} target="_blank" rel="noreferrer">
                            {sanitizeOverviewText(deliveryEvidence.github.issue.title ?? deliveryEvidence.github.issue.url, 180)}
                          </a>
                        ) : (
                          <span>{deliveryEvidence.github.issue.title ? sanitizeOverviewText(deliveryEvidence.github.issue.title, 180) : 'linked issue'}</span>
                        )}
                      </article>
                    )}
                    {deliveryEvidence.github.pullRequests.slice(0, 3).map((pr) => (
                      <article className="orchestration-node" key={pr.number}>
                        <strong>PR #{pr.number}</strong>
                        <span className="orchestration-badge">{pr.state}</span>
                        {safeExternalHref(pr.url) ? (
                          <a href={safeExternalHref(pr.url)} target="_blank" rel="noreferrer">{sanitizeOverviewText(pr.title ?? pr.url, 180)}</a>
                        ) : (
                          <span>{sanitizeOverviewText(pr.title ?? 'pull request', 180)}</span>
                        )}
                      </article>
                    ))}
                    {deliveryEvidence.github.workflowRuns.slice(0, 3).map((run) => (
                      <article className="orchestration-node" key={run.id}>
                        <strong>{run.name ? sanitizeOverviewText(run.name, 120) : `Workflow ${run.id}`}</strong>
                        <span className="orchestration-badge">{run.conclusion ?? run.status ?? 'unknown'}</span>
                        {safeExternalHref(run.url) && <a href={safeExternalHref(run.url)} target="_blank" rel="noreferrer">workflow run</a>}
                      </article>
                    ))}
                    {deliveryEvidence.deliveryChecklist.length > 0 && (
                      <article className="orchestration-node">
                        <strong>Delivery checklist</strong>
                        <span>{sanitizeOverviewText(deliveryEvidence.deliveryChecklist.join(', '), 220)}</span>
                      </article>
                    )}
                  </div>
                )}
              </div>
              <div>
                <h4>GitHub delivery plan</h4>
                {!githubDeliveryPlan ? (
                  <div className="panel-placeholder">No dry-run delivery plan created.</div>
                ) : (
                  <div className="orchestration-list">
                    <article className="orchestration-node">
                      <strong>{sanitizeOverviewText(githubDeliveryPlan.proposedBranch, 120)}</strong>
                      <span className="orchestration-badge">{githubDeliveryPlan.mode}</span>
                      <span>{githubDeliveryPlan.repository ? sanitizeOverviewText(githubDeliveryPlan.repository, 120) : 'repository pending'}</span>
                      <span>apply: {githubDeliveryPlan.applySupported ? 'supported' : 'not supported'}</span>
                    </article>
                    <article className="orchestration-node">
                      <strong>{sanitizeOverviewText(githubDeliveryPlan.pullRequest.title, 180)}</strong>
                      <span className="orchestration-badge">draft PR plan</span>
                      {githubDeliveryPlan.issue && <span>links issue #{githubDeliveryPlan.issue.number}</span>}
                    </article>
                    {githubDeliveryPlan.blockers.length > 0 ? (
                      <article className="orchestration-node">
                        <strong>Blockers</strong>
                        <span>{sanitizeOverviewText(githubDeliveryPlan.blockers.join(', '), 220)}</span>
                      </article>
                    ) : (
                      <article className="orchestration-node">
                        <strong>Blockers</strong>
                        <span>none</span>
                      </article>
                    )}
                    <article className="orchestration-node">
                      <strong>Apply GitHub delivery</strong>
                      <span className="orchestration-badge">{githubDeliveryPlan.applySupported ? 'approval required' : 'disabled'}</span>
                      <span>Type {expectedApplyConfirmation ? sanitizeOverviewText(expectedApplyConfirmation, 140) : 'APPLY <branch>'} to request a draft PR.</span>
                      <input
                        value={githubDeliveryApplyConfirmation}
                        onChange={(event) => setGithubDeliveryApplyConfirmation(event.target.value)}
                        placeholder={expectedApplyConfirmation ? sanitizeOverviewText(expectedApplyConfirmation, 140) : 'APPLY pyrfor/...'}
                        disabled={!githubDeliveryPlan.applySupported || githubDeliveryApplyLoading}
                      />
                      <button
                        className="icon-btn"
                        onClick={() => void requestGithubDeliveryApply()}
                        disabled={!canRequestGithubDeliveryApply}
                      >
                        Request apply approval
                      </button>
                      {githubDeliveryApplyApproval && (() => {
                        const approvalPending = pendingApprovalIds.includes(githubDeliveryApplyApproval.id);
                        return (
                          <>
                            <span>{approvalPending ? 'Approval pending' : 'Approval resolved'}: {githubDeliveryApplyApproval.id}. {approvalPending ? 'Approve in Trust panel, then apply.' : 'Ready to apply approved delivery.'}</span>
                            {renderApprovalContext(githubDeliveryApplyApproval)}
                            <button
                              className="icon-btn"
                              onClick={() => void applyApprovedGithubDelivery()}
                              disabled={githubDeliveryApplyLoading || approvalPending}
                            >
                              {approvalPending ? 'Approve in Trust first' : 'Apply approved delivery'}
                            </button>
                          </>
                        );
                      })()}
                      {githubDeliveryApplyError && <span className="orchestration-error">{sanitizeOverviewText(githubDeliveryApplyError)}</span>}
                    </article>
                    {githubDeliveryApply && (
                      <article className="orchestration-node">
                        <strong>Draft PR #{githubDeliveryApply.draftPullRequest.number}</strong>
                        <span className="orchestration-badge">{githubDeliveryApply.draftPullRequest.draft ? 'draft' : githubDeliveryApply.draftPullRequest.state}</span>
                        {safeExternalHref(githubDeliveryApply.draftPullRequest.url) ? (
                          <a href={safeExternalHref(githubDeliveryApply.draftPullRequest.url)} target="_blank" rel="noreferrer">
                            {sanitizeOverviewText(githubDeliveryApply.draftPullRequest.title, 180)}
                          </a>
                        ) : (
                          <span>{sanitizeOverviewText(githubDeliveryApply.draftPullRequest.title, 180)}</span>
                        )}
                        <span>branch: {sanitizeOverviewText(githubDeliveryApply.branch, 120)}</span>
                      </article>
                    )}
                  </div>
                )}
              </div>
              <div>
                <h4>DAG nodes</h4>
                {nodes.length === 0 ? (
                  <div className="panel-placeholder">No DAG nodes for this run.</div>
                ) : (
                  <div className="orchestration-list">
                    {nodes.map((node) => (
                      <article className="orchestration-node" key={node.id}>
                        <strong>{node.kind}</strong>
                        <span className="orchestration-badge">{node.status}</span>
                        {node.dependsOn.length > 0 && <span>after: {node.dependsOn.join(', ')}</span>}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="panel-placeholder">Select a run to inspect events and DAG nodes.</div>
        )}
      </section>

      <section className="orchestration-section">
        <h3>Overlays</h3>
        {overlays.length === 0 ? (
          <div className="panel-placeholder">No overlays registered.</div>
        ) : (
          <div className="orchestration-list">
            {overlays.map((overlay) => (
              <button
                key={overlay.domainId}
                className={`orchestration-row${selectedOverlay?.domainId === overlay.domainId ? ' active' : ''}`}
                onClick={() => void selectOverlay(overlay.domainId)}
              >
                <span className="orchestration-row-title">{overlay.title}</span>
                <span>{overlay.domainId}</span>
              </button>
            ))}
          </div>
        )}
        {selectedOverlay && (
          <div className="orchestration-overlay-detail">
            <strong>{selectedOverlay.title}</strong>
            <span>{workflowCount} workflows / {adapterCount} adapters</span>
            {selectedOverlay.privacyRuleIds.length > 0 && (
              <span>Privacy rules: {selectedOverlay.privacyRuleIds.join(', ')}</span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
