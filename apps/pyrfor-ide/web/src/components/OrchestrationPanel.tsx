import React, { useCallback, useEffect, useState } from 'react';
import {
  getDashboard,
  captureRunDeliveryEvidence,
  createRunGithubDeliveryPlan,
  getOverlay,
  getRun,
  getRunDeliveryEvidence,
  getRunGithubDeliveryPlan,
  controlRun,
  createCeoclawBriefRun,
  createOchagReminderRun,
  createProductFactoryRun,
  getOchagPrivacy,
  listOverlays,
  listProductFactoryTemplates,
  listRunDag,
  listRunEvents,
  listRunFrames,
  listRuns,
  previewCeoclawBrief,
  previewOchagReminder,
  previewProductFactoryPlan,
  type AuditEvent,
  type DagNode,
  type DeliveryEvidenceSnapshot,
  type DomainOverlayManifest,
  type GitHubDeliveryPlan,
  type OrchestrationDashboard,
  type ProductFactoryPlanPreview,
  type ProductFactoryTemplate,
  type ProductFactoryTemplateId,
  type RunRecord,
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
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [deliveryEvidence, setDeliveryEvidence] = useState<DeliveryEvidenceSnapshot | null>(null);
  const [githubDeliveryPlan, setGithubDeliveryPlan] = useState<GitHubDeliveryPlan | null>(null);
  const [deliveryIssueNumber, setDeliveryIssueNumber] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nodes, setNodes] = useState<DagNode[]>([]);
  const [frames, setFrames] = useState<WorkerFrameSummary[]>([]);
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
    const [runResult, eventResult, dagResult, frameResult, evidenceResult, planResult] = await Promise.all([
      getRun(runId),
      listRunEvents(runId),
      listRunDag(runId),
      listRunFrames(runId),
      getRunDeliveryEvidence(runId).catch(() => ({ artifact: null, snapshot: null })),
      getRunGithubDeliveryPlan(runId).catch(() => ({ artifact: null, plan: null })),
    ]);
    setSelectedRun(runResult.run);
    setDeliveryEvidence(evidenceResult.snapshot);
    setGithubDeliveryPlan(planResult.plan);
    setEvents(eventResult.events);
    setNodes(dagResult.nodes);
    setFrames(frameResult.frames);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboardResult, runsResult, overlaysResult, templatesResult, privacyResult] = await Promise.all([
        getDashboard(),
        listRuns(),
        listOverlays(),
        listProductFactoryTemplates(),
        getOchagPrivacy().catch(() => ({ privacyRules: [] })),
      ]);
      setDashboard(dashboardResult.orchestration ?? null);
      setRuns(runsResult.runs);
      setOverlays(overlaysResult.overlays);
      setProductTemplates(templatesResult.templates);
      setOchagPrivacyRules(privacyResult.privacyRules);
      if (selectedRunId) {
        await loadRun(selectedRunId);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadRun, selectedRunId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectRun = async (runId: string) => {
    setSelectedRunId(runId);
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

  const runControl = async (action: 'execute' | 'replay' | 'continue' | 'abort') => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    try {
      await controlRun(selectedRunId, action);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
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
      setGithubDeliveryPlan(result.plan);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
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
                <button className="icon-btn" onClick={() => void captureDeliveryEvidence()} disabled={loading}>Capture evidence</button>
                <button className="icon-btn" onClick={() => void createGithubDeliveryPlan()} disabled={loading}>Plan GitHub delivery</button>
                <button className="icon-btn" onClick={() => void runControl('replay')} disabled={loading}>Replay</button>
                <button className="icon-btn" onClick={() => void runControl('continue')} disabled={loading}>Continue</button>
                <button className="icon-btn" onClick={() => void runControl('abort')} disabled={loading}>Abort</button>
              </div>
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
