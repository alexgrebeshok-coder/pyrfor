import React, { useCallback, useEffect, useState } from 'react';
import {
  getDashboard,
  captureRunDeliveryEvidence,
  createRunGithubDeliveryPlan,
  getOverlay,
  getRun,
  getRunDeliveryEvidence,
  getRunGithubDeliveryApply,
  getRunGithubDeliveryPlan,
  getRunVerifierStatus,
  getMemorySnapshot,
  getSessionTimeline,
  createMemoryRollup,
  createMemoryCorrection,
  createOpenClawImportReport,
  importOpenClawMemory,
  requestRunGithubDeliveryApply,
  searchMemory,
  streamOperatorEvents,
  controlRun,
  createRunVerifierWaiver,
  createCeoclawBriefRun,
  createOchagReminderRun,
  createProductFactoryRun,
  getOchagPrivacy,
  listOverlays,
  listProductFactoryTemplates,
  listSessions,
  listRunDag,
  listRunEvents,
  listRunActors,
  listRunFrames,
  listRuns,
  previewCeoclawBrief,
  previewOchagReminder,
  previewProductFactoryPlan,
  type AuditEvent,
  type ApprovalRequest,
  type ArtifactRef,
  type DagNode,
  type DeliveryEvidenceSnapshot,
  type DomainOverlayManifest,
  type GitHubDeliveryApplyResult,
  type GitHubDeliveryPlan,
  type DailyMemoryRollupResult,
  type MemorySearchHit,
  type MemorySnapshot,
  type OpenClawMigrationPreviewResponse,
  type OrchestrationDashboard,
  type ProductFactoryPlanPreview,
  type ProductFactoryTemplate,
  type ProductFactoryTemplateId,
  type RunRecord,
  type RuntimeSessionSummary,
  type RuntimeSessionTimelineEvent,
  type RunActorSnapshot,
  type VerifierDecision,
  type WorkerFrameSummary,
} from '../lib/api';

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

function parseOptionalIssueNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed.replace(/^#/, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function findCeoclawApprovalId(events: AuditEvent[]): string | null {
  const requested = [...events].reverse().find((event) =>
    event.type === 'approval.requested'
    && event.tool === 'ceoclaw_business_brief_approval'
    && typeof event.approval_id === 'string'
  );
  if (!requested) return null;
  const resolved = events.some((event) =>
    typeof requested.seq === 'number'
    && typeof event.seq === 'number'
    && event.seq > requested.seq
    && (event.type === 'approval.granted' || event.type === 'approval.denied')
    && event.tool === 'ceoclaw_business_brief_approval'
  );
  if (resolved) return null;
  return requested?.approval_id ?? null;
}

function findGithubDeliveryApplyApproval(
  events: AuditEvent[],
  runId: string,
  planArtifact: ArtifactRef | null,
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
    },
    approval_required: true,
  };
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
  const [lastMemoryRollup, setLastMemoryRollup] = useState<DailyMemoryRollupResult | null>(null);
  const [memoryRollupLoading, setMemoryRollupLoading] = useState(false);
  const [memoryRollupError, setMemoryRollupError] = useState<string | null>(null);
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
  const [openClawMigrationLoading, setOpenClawMigrationLoading] = useState(false);
  const [openClawMigrationImporting, setOpenClawMigrationImporting] = useState(false);
  const [openClawMigrationResult, setOpenClawMigrationResult] = useState<string | null>(null);
  const [openClawMigrationError, setOpenClawMigrationError] = useState<string | null>(null);
  const [sessionTimeline, setSessionTimeline] = useState<{ sessionId: string; events: RuntimeSessionTimelineEvent[] } | null>(null);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [deliveryEvidence, setDeliveryEvidence] = useState<DeliveryEvidenceSnapshot | null>(null);
  const [githubDeliveryPlanArtifact, setGithubDeliveryPlanArtifact] = useState<ArtifactRef | null>(null);
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
  const [overlays, setOverlays] = useState<DomainOverlayManifest[]>([]);
  const [selectedOverlay, setSelectedOverlay] = useState<DomainOverlayManifest | null>(null);
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
  const [ceoclawApprovalId, setCeoclawApprovalId] = useState<string | null>(null);
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

  const loadRun = useCallback(async (runId: string) => {
    const [runResult, eventResult, dagResult, frameResult, actorResult, evidenceResult, planResult, applyResult, verifierResult] = await Promise.all([
      getRun(runId),
      listRunEvents(runId),
      listRunDag(runId),
      listRunFrames(runId),
      listRunActors(runId).catch(() => null),
      getRunDeliveryEvidence(runId).catch(() => ({ artifact: null, snapshot: null })),
      getRunGithubDeliveryPlan(runId).catch(() => ({ artifact: null, plan: null })),
      getRunGithubDeliveryApply(runId).catch(() => ({ artifact: null, result: null })),
      getRunVerifierStatus(runId).catch(() => ({ decision: null })),
    ]);
    setSelectedRun(runResult.run);
    setDeliveryEvidence(evidenceResult.snapshot);
    setGithubDeliveryPlanArtifact(planResult.artifact);
    setGithubDeliveryPlan(planResult.plan);
    setGithubDeliveryApply(applyResult.result);
    setGithubDeliveryApplyApproval(applyResult.result ? null : findGithubDeliveryApplyApproval(eventResult.events, runId, planResult.artifact));
    setVerifierDecision(verifierResult.decision);
    setEvents(eventResult.events);
    setCeoclawApprovalId(findCeoclawApprovalId(eventResult.events));
    setNodes(dagResult.nodes);
    setFrames(frameResult.frames);
    setActorSnapshot(actorResult);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboardResult, runsResult, overlaysResult, templatesResult, privacyResult, memoryResult, sessionsResult] = await Promise.all([
        getDashboard(),
        listRuns(),
        listOverlays(),
        listProductFactoryTemplates(),
        getOchagPrivacy().catch(() => ({ privacyRules: [] })),
        getMemorySnapshot().catch(() => null),
        listSessions({ limit: 5 }).catch(() => ({ sessions: [] })),
      ]);
      setDashboard(dashboardResult.orchestration ?? null);
      setRuns(runsResult.runs);
      setOverlays(overlaysResult.overlays);
      setProductTemplates(templatesResult.templates);
      setOchagPrivacyRules(privacyResult.privacyRules);
      setMemorySnapshot(memoryResult);
      setSessions(sessionsResult.sessions);
      if (selectedRunId) {
        await loadRun(selectedRunId);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadRun, selectedRunId]);

  const handleCreateMemoryRollup = useCallback(async () => {
    setMemoryRollupLoading(true);
    setMemoryRollupError(null);
    try {
      const result = await createMemoryRollup();
      setLastMemoryRollup(result.rollup);
      const [memoryResult, sessionsResult] = await Promise.all([
        getMemorySnapshot().catch(() => null),
        listSessions({ limit: 5 }).catch(() => ({ sessions: [] })),
      ]);
      setMemorySnapshot(memoryResult);
      setSessions(sessionsResult.sessions);
    } catch (err) {
      setMemoryRollupError(String(err));
    } finally {
      setMemoryRollupLoading(false);
    }
  }, []);

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
    setOpenClawMigrationLoading(true);
    setOpenClawMigrationError(null);
    setOpenClawMigrationResult(null);
    try {
      const preview = await createOpenClawImportReport({ includePersonality: true, includeMemories: true });
      setOpenClawMigration(preview);
    } catch (err) {
      setOpenClawMigrationError(String(err));
    } finally {
      setOpenClawMigrationLoading(false);
    }
  }, []);

  const handleImportOpenClawMigration = useCallback(async () => {
    if (!openClawMigration?.artifact.sha256) {
      setOpenClawMigrationError('OpenClaw import report is missing a verification hash');
      return;
    }
    setOpenClawMigrationImporting(true);
    setOpenClawMigrationError(null);
    try {
      const response = await importOpenClawMemory({
        reportArtifactId: openClawMigration.artifact.id,
        expectedReportSha256: openClawMigration.artifact.sha256,
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
  }, [openClawMigration]);

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

  const selectRun = async (runId: string) => {
    setSelectedRunId(runId);
    setCeoclawApprovalId(null);
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

  const workflowCount = selectedOverlay ? asArray(selectedOverlay['workflowTemplates']).length : 0;
  const adapterCount = selectedOverlay ? asArray(selectedOverlay['adapterRegistrations']).length : 0;
  const effectEvents = events.filter((event) => event.type.startsWith('effect.'));
  const verifierEvents = events.filter((event) => event.type.startsWith('verifier.'));

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
        setCeoclawApprovalId(result.approval.id);
      } else if (opts.approvalId) {
        setCeoclawApprovalId(null);
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
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
        {error && <div className="orchestration-error">Unavailable: {error}</div>}
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
        <h3>Memory continuity</h3>
        <div className="orchestration-detail-card">
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
          {memoryRollupError && <div className="panel-error">{memoryRollupError}</div>}
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
          {memorySearchError && <div className="panel-error">{memorySearchError}</div>}
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
            {memoryCorrectionResult && <span>Saved: {memoryCorrectionResult.summary ?? memoryCorrectionResult.id}</span>}
            {memoryCorrectionError && <div className="panel-error">{memoryCorrectionError}</div>}
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
                disabled={!openClawMigration || openClawMigrationLoading || openClawMigrationImporting}
              >
                {openClawMigrationImporting ? 'Importing…' : 'Import approved report'}
              </button>
            </div>
            {openClawMigration && (
              <>
                <span>
                  Report: {openClawMigration.report.counts.importable} importable, {openClawMigration.report.counts.skipped} skipped, {openClawMigration.report.counts.redactions} redactions
                </span>
                <span>Source: {openClawMigration.report.sourceRoot}</span>
                {openClawMigration.report.entries.slice(0, 5).map((entry) => (
                  <span key={entry.fingerprint}>
                    {entry.sourceKind} · {entry.sourceRelPath} · {entry.summary}
                  </span>
                ))}
              </>
            )}
            {openClawMigrationResult && <span>{openClawMigrationResult}</span>}
            {openClawMigrationError && <div className="panel-error">{openClawMigrationError}</div>}
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
                  [{hit.source}{hit.projectMemoryCategory ? ` · ${hit.projectMemoryCategory}` : hit.rollupKind ? ` · ${hit.rollupKind}` : ''}] {hit.summary ?? hit.content.slice(0, 180)}
                </span>
              ))}
            </div>
          )}
          {memorySnapshot && memorySnapshot.lines.length > 0 ? (
            <div className="orchestration-overlay-detail">
              <strong>Recent remembered context</strong>
              {memorySnapshot.lines.slice(-5).map((line, index) => (
                <span key={`${index}:${line}`}>{line}</span>
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
                  {session.title} · {session.messageCount} messages · {formatTime(session.updatedAt)}
                  {session.summary ? ` · ${session.summary}` : ''}
                  {' '}
                  <button onClick={() => void handleLoadSessionTimeline(session.id)}>Timeline</button>
                </span>
              ))}
              {sessionTimeline && (
                <div className="orchestration-overlay-detail">
                  <strong>Timeline: {sessionTimeline.sessionId}</strong>
                  {sessionTimeline.events.map((event) => (
                    <span key={event.id}>{event.role}: {event.content}</span>
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
              <span>Privacy rules: {asArray(ceoclawOverlay['privacyRules']).map((rule) => (rule as { id?: string }).id).filter(Boolean).join(', ') || 'none'}</span>
              <span>Tool permissions: {Object.entries((ceoclawOverlay['toolPermissionOverrides'] as Record<string, unknown>) ?? {}).map(([key, value]) => `${key}:${String(value)}`).join(', ') || 'none'}</span>
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
                {selectedRun.status === 'blocked' && ceoclawApprovalId && (
                  <button className="icon-btn" onClick={() => void runControl('execute', { approvalId: ceoclawApprovalId })} disabled={loading}>
                    Finalize CEOClaw approval
                  </button>
                )}
                <button className="icon-btn" onClick={() => void captureDeliveryEvidence()} disabled={loading}>Capture evidence</button>
                <button className="icon-btn" onClick={() => void createGithubDeliveryPlan()} disabled={loading}>Plan GitHub delivery</button>
                <button className="icon-btn" onClick={() => void runControl('replay')} disabled={loading}>Replay</button>
                <button className="icon-btn" onClick={() => void runControl('continue')} disabled={loading}>Continue</button>
                <button className="icon-btn" onClick={() => void runControl('abort')} disabled={loading}>Abort</button>
              </div>
              {ceoclawApprovalId && (
                <span className="orchestration-hint">
                  CEOClaw approval pending: {ceoclawApprovalId}. Resolve it in the approvals panel, then finalize this run.
                </span>
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
                <h4>Actors</h4>
                {!actorSnapshot || actorSnapshot.actors.length === 0 ? (
                  <div className="panel-placeholder">No actor state for this run yet.</div>
                ) : (
                  <div className="orchestration-list">
                    {actorSnapshot.actors.map((actor) => (
                      <article className="orchestration-node" key={actor.actorId}>
                        <strong>{actor.agentName ?? actor.actorId}</strong>
                        <span className="orchestration-badge">{actor.status}</span>
                        {actor.role && <span>{actor.role}</span>}
                        {actor.currentWork && <span>{actor.currentWork}</span>}
                        <span>mailbox: {actor.mailbox.pending} pending · {actor.mailbox.leased} leased</span>
                        {actor.budget?.profile && <span>budget: {actor.budget.profile}</span>}
                        {actor.outputs[0] && <span>output: {actor.outputs[0]}</span>}
                        {actor.blockers[0] && <span>blocker: {actor.blockers[0]}</span>}
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
                        <span>{event.reason ?? event.decision ?? event.status ?? ''}</span>
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
                    <span>{verifierDecision.reason ?? 'latest verifier decision'}</span>
                    {verifierDecision.waiver && (
                      <span>waived by {verifierDecision.waiver.operator.name ?? verifierDecision.waiver.operator.id}: {verifierDecision.waiver.reason}</span>
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
                        {waiverError && <span className="orchestration-error">{waiverError}</span>}
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
                        <span>{event.reason ?? ''}</span>
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
                      <strong>{deliveryEvidence.github.repository ?? deliveryEvidence.git.remote?.repository ?? 'local workspace'}</strong>
                      <span className="orchestration-badge">{deliveryEvidence.verifierStatus ?? 'snapshot'}</span>
                      <span>branch: {deliveryEvidence.git.branch ?? 'unknown'}</span>
                        {deliveryEvidence.git.headSha && <span>sha: {deliveryEvidence.git.headSha.slice(0, 12)}</span>}
                      </article>
                    {deliveryEvidence.github.issue && (
                      <article className="orchestration-node">
                        <strong>Issue #{deliveryEvidence.github.issue.number}</strong>
                        <span className="orchestration-badge">{deliveryEvidence.github.issue.state ?? 'linked'}</span>
                        {deliveryEvidence.github.issue.url ? (
                          <a href={deliveryEvidence.github.issue.url} target="_blank" rel="noreferrer">
                            {deliveryEvidence.github.issue.title ?? deliveryEvidence.github.issue.url}
                          </a>
                        ) : (
                          <span>{deliveryEvidence.github.issue.title ?? 'linked issue'}</span>
                        )}
                      </article>
                    )}
                    {deliveryEvidence.github.pullRequests.slice(0, 3).map((pr) => (
                      <article className="orchestration-node" key={pr.number}>
                        <strong>PR #{pr.number}</strong>
                        <span className="orchestration-badge">{pr.state}</span>
                        <a href={pr.url} target="_blank" rel="noreferrer">{pr.title ?? pr.url}</a>
                      </article>
                    ))}
                    {deliveryEvidence.github.workflowRuns.slice(0, 3).map((run) => (
                      <article className="orchestration-node" key={run.id}>
                        <strong>{run.name ?? `Workflow ${run.id}`}</strong>
                        <span className="orchestration-badge">{run.conclusion ?? run.status ?? 'unknown'}</span>
                        {run.url && <a href={run.url} target="_blank" rel="noreferrer">workflow run</a>}
                      </article>
                    ))}
                    {deliveryEvidence.deliveryChecklist.length > 0 && (
                      <article className="orchestration-node">
                        <strong>Delivery checklist</strong>
                        <span>{deliveryEvidence.deliveryChecklist.join(', ')}</span>
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
                      <strong>{githubDeliveryPlan.proposedBranch}</strong>
                      <span className="orchestration-badge">{githubDeliveryPlan.mode}</span>
                      <span>{githubDeliveryPlan.repository ?? 'repository pending'}</span>
                      <span>apply: {githubDeliveryPlan.applySupported ? 'supported' : 'not supported'}</span>
                    </article>
                    <article className="orchestration-node">
                      <strong>{githubDeliveryPlan.pullRequest.title}</strong>
                      <span className="orchestration-badge">draft PR plan</span>
                      {githubDeliveryPlan.issue && <span>links issue #{githubDeliveryPlan.issue.number}</span>}
                    </article>
                    {githubDeliveryPlan.blockers.length > 0 ? (
                      <article className="orchestration-node">
                        <strong>Blockers</strong>
                        <span>{githubDeliveryPlan.blockers.join(', ')}</span>
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
                      <span>Type {expectedApplyConfirmation || 'APPLY <branch>'} to request a draft PR.</span>
                      <input
                        value={githubDeliveryApplyConfirmation}
                        onChange={(event) => setGithubDeliveryApplyConfirmation(event.target.value)}
                        placeholder={expectedApplyConfirmation || 'APPLY pyrfor/...'}
                        disabled={!githubDeliveryPlan.applySupported || githubDeliveryApplyLoading}
                      />
                      <button
                        className="icon-btn"
                        onClick={() => void requestGithubDeliveryApply()}
                        disabled={!canRequestGithubDeliveryApply}
                      >
                        Request apply approval
                      </button>
                      {githubDeliveryApplyApproval && (
                        <>
                          <span>Approval pending: {githubDeliveryApplyApproval.id}. Approve in Trust panel, then apply.</span>
                          <button
                            className="icon-btn"
                            onClick={() => void applyApprovedGithubDelivery()}
                            disabled={githubDeliveryApplyLoading}
                          >
                            Apply approved delivery
                          </button>
                        </>
                      )}
                      {githubDeliveryApplyError && <span className="orchestration-error">{githubDeliveryApplyError}</span>}
                    </article>
                    {githubDeliveryApply && (
                      <article className="orchestration-node">
                        <strong>Draft PR #{githubDeliveryApply.draftPullRequest.number}</strong>
                        <span className="orchestration-badge">{githubDeliveryApply.draftPullRequest.draft ? 'draft' : githubDeliveryApply.draftPullRequest.state}</span>
                        <a href={githubDeliveryApply.draftPullRequest.url} target="_blank" rel="noreferrer">
                          {githubDeliveryApply.draftPullRequest.title}
                        </a>
                        <span>branch: {githubDeliveryApply.branch}</span>
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
            {asArray(selectedOverlay['privacyRules']).length > 0 && (
              <span>Privacy rules: {asArray(selectedOverlay['privacyRules']).map((rule) => (rule as { id?: string }).id).filter(Boolean).join(', ')}</span>
            )}
            <pre>{compactJson(selectedOverlay)}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
