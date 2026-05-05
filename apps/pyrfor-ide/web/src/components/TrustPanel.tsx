import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  decideApproval,
  listAuditEvents,
  listPendingApprovals,
  listPendingEffects,
  streamOperatorEvents,
  type ApprovalRequest,
  type AuditEvent,
  type PendingEffect,
} from '../lib/api';

interface TrustPanelProps {
  onToast?: (message: string, type?: string) => void;
}

function safeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '-';
}

function renderScalarMetadata(entries: Array<readonly [string, unknown]>) {
  const visible = entries.filter(([, value]) => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  ));
  if (visible.length === 0) return null;
  return (
    <div className="trust-metadata">
      {visible.map(([label, value]) => (
        <div key={label}>{label}: {safeText(value)}</div>
      ))}
    </div>
  );
}

function renderTrustMetadata(toolName?: string, args?: Record<string, unknown>) {
  if (!args) return null;
  if (toolName === 'connector_live_probe') {
    return (
      <div className="trust-metadata">
        <div>Connector: {safeText(args['connectorName'] ?? args['connectorId'])}</div>
        <div>Source: {safeText(args['sourceSystem'])}</div>
        <div>Action: live connector probe requires explicit approval.</div>
      </div>
    );
  }
  if (toolName === 'research_live_search') {
    return (
      <div className="trust-metadata">
        <div>Run: {safeText(args['runId'])}</div>
        <div>Query hash: {safeText(args['queryHash'])}</div>
        <div>Provider: {safeText(args['provider'])}</div>
        <div>Max results: {safeText(args['maxResults'])}</div>
      </div>
    );
  }
  if (toolName === 'browser_smoke') {
    return (
      <div className="trust-metadata">
        <div>Run: {safeText(args['runId'])}</div>
        <div>Target hash: {safeText(args['targetUrlHash'])}</div>
        <div>Host: {safeText(args['host'])}</div>
        <div>Path hash: {safeText(args['pathHash'])}</div>
        <div>Full page: {safeText(args['fullPage'])}</div>
      </div>
    );
  }
  if (toolName === 'research_source_capture') {
    return (
      <div className="trust-metadata">
        <div>Run: {safeText(args['runId'])}</div>
        <div>Source host: {safeText(args['sourceHost'])}</div>
        <div>Source hash: {safeText(args['sourceUrlHash'])}</div>
        <div>Path hash: {safeText(args['sourcePathHash'])}</div>
      </div>
    );
  }
  if (toolName === 'github_delivery_apply') {
    return (
      <div className="trust-metadata">
        <div>Repository: {safeText(args['repository'])}</div>
        <div>Base branch: {safeText(args['baseBranch'])}</div>
        <div>Proposed branch: {safeText(args['proposedBranch'])}</div>
        <div>Head SHA: {safeText(args['headSha'])}</div>
        <div>Plan artifact: {safeText(args['planArtifactId'])}</div>
      </div>
    );
  }
  if (toolName === 'ceoclaw_business_brief_approval') {
    const evidenceRefs = Array.isArray(args['evidenceRefs']) ? args['evidenceRefs'].length : 0;
    return (
      <div className="trust-metadata">
        <div>Run: {safeText(args['runId'])}</div>
        <div>Project: {safeText(args['projectId'])}</div>
        <div>Decision: {safeText(args['decision'])}</div>
        <div>Evidence refs: {evidenceRefs}</div>
        {args['evidenceArtifactId'] !== undefined && <div>Evidence artifact: {safeText(args['evidenceArtifactId'])}</div>}
        {args['deadline'] !== undefined && <div>Deadline: {safeText(args['deadline'])}</div>}
      </div>
    );
  }
  return (
    <div className="trust-metadata">
      <div>Additional metadata hidden until this approval type has a safe renderer.</div>
    </div>
  );
}

function renderPendingEffectMetadata(effect: PendingEffect) {
  return (
    <>
      {renderScalarMetadata([
        ['Run', effect.run_id],
        ['Effect', effect.effect_id],
        ['Tool', effect.tool],
        ['Policy', effect.policy_id],
        ['Decision', effect.decision],
        ['Reason', effect.reason],
        ['Timestamp', effect.ts],
        ['Approval required', effect.approval_required],
        ['Proposed seq', effect.proposed_seq],
      ])}
    </>
  );
}

function renderApprovalTraceMetadata(approval: ApprovalRequest) {
  return renderScalarMetadata([
    ['Run', approval.run_id],
    ['Effect', approval.effect_id],
    ['Effect kind', approval.effect_kind],
    ['Policy', approval.policy_id],
    ['Reason', approval.reason],
  ]);
}

function renderAuditTraceMetadata(event: AuditEvent) {
  return renderScalarMetadata([
    ['Run', event.run_id],
    ['Seq', event.seq],
    ['Effect', event.effect_id],
    ['Artifact', event.artifact_id],
    ['Status', event.status],
    ['Capability', event.capability],
    ['Frame', event.frameId],
    ['Approval', event.approval_id],
  ]);
}

export default function TrustPanel({ onToast }: TrustPanelProps) {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [effects, setEffects] = useState<PendingEffect[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const fullRefreshSeq = useRef(0);
  const auditRefreshSeq = useRef(0);
  const liveSeq = useRef(0);
  const selectedRequestIdRef = useRef<string | null>(null);

  const refresh = useCallback(async (
    requestId = selectedRequestIdRef.current,
    opts: { auditOnly?: boolean } = {},
  ) => {
    const seq = opts.auditOnly ? ++auditRefreshSeq.current : ++fullRefreshSeq.current;
    const auditSeqAtStart = auditRefreshSeq.current;
    const liveAtStart = liveSeq.current;
    setLoading(true);
    try {
      if (opts.auditOnly) {
        const auditResult = await listAuditEvents(50, requestId ? { requestId } : {});
        if (seq !== auditRefreshSeq.current) return;
        setEvents(auditResult.events);
        return;
      }
      const [pendingResult, effectResult, auditResult] = await Promise.allSettled([
        listPendingApprovals(),
        listPendingEffects(),
        listAuditEvents(50, requestId ? { requestId } : {}),
      ]);
      if (seq !== fullRefreshSeq.current) return;
      if (liveSeq.current === liveAtStart) {
        if (pendingResult.status === 'fulfilled') {
          setPending(pendingResult.value.approvals);
        } else {
          onToast?.(`Pending approvals unavailable: ${String(pendingResult.reason)}`, 'error');
        }
        if (effectResult.status === 'fulfilled') {
          setEffects(effectResult.value.effects);
        } else {
          onToast?.(`Pending effects unavailable: ${String(effectResult.reason)}`, 'error');
        }
      }
      if (
        auditResult.status === 'fulfilled' &&
        auditSeqAtStart === auditRefreshSeq.current &&
        requestId === selectedRequestIdRef.current
      ) {
        setEvents(auditResult.value.events);
      } else {
        if (auditResult.status === 'rejected') {
          onToast?.(`Audit timeline unavailable: ${String(auditResult.reason)}`, 'error');
        }
      }
    } catch (error) {
      if (opts.auditOnly ? seq !== auditRefreshSeq.current : seq !== fullRefreshSeq.current) return;
      onToast?.(`Trust data unavailable: ${String(error)}`, 'error');
    } finally {
      if (opts.auditOnly ? seq === auditRefreshSeq.current : seq === fullRefreshSeq.current) setLoading(false);
    }
  }, [onToast]);

  const applyAuditFilter = useCallback((requestId: string | null) => {
    selectedRequestIdRef.current = requestId;
    setSelectedRequestId(requestId);
    setEvents([]);
    void refresh(requestId, { auditOnly: true });
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const controller = new AbortController();
    let refreshTimer: number | undefined;
    let fallbackTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 150);
    };
    void streamOperatorEvents({
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'snapshot') {
          liveSeq.current += 1;
          if (event.approvals) setPending(event.approvals);
          if (event.effects) setEffects(event.effects);
          return;
        }
        scheduleRefresh();
      },
      onError: (message) => {
        onToast?.(`Trust live updates unavailable: ${message}`, 'error');
      },
    }).catch((error) => {
      if (controller.signal.aborted) return;
      onToast?.(`Trust live updates unavailable: ${String(error)}`, 'error');
      fallbackTimer = window.setInterval(() => void refresh(), 2500);
    });
    return () => {
      controller.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
    };
  }, [refresh]);

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    setActingId(id);
    try {
      await decideApproval(id, decision);
      onToast?.(`Approval ${decision}d`, decision === 'approve' ? 'success' : 'info');
      await refresh();
    } catch (error) {
      onToast?.(`Approval decision failed: ${String(error)}`, 'error');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="trust-panel">
      <section className="trust-section">
        <div className="trust-section-header">
          <h3>Pending approvals</h3>
          <button className="icon-btn" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        {pending.length === 0 ? (
          <div className="panel-placeholder">No pending approvals.</div>
        ) : (
          <div className="trust-list">
            {pending.map((item) => (
              <article className="trust-card" key={item.id}>
                <div className="trust-card-title">{item.toolName}</div>
                <div className="trust-card-summary">{item.summary}</div>
                {renderTrustMetadata(item.toolName, item.args)}
                {renderApprovalTraceMetadata(item)}
                <div className="trust-actions">
                  <button
                    className="secondary-btn"
                    onClick={() => applyAuditFilter(item.id)}
                    disabled={selectedRequestId === item.id}
                  >
                    Filter timeline
                  </button>
                  <button
                    className="primary-btn"
                    disabled={actingId === item.id}
                    onClick={() => void decide(item.id, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    className="secondary-btn"
                    disabled={actingId === item.id}
                    onClick={() => void decide(item.id, 'deny')}
                  >
                    Deny
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="trust-section">
        <h3>Pending effects</h3>
        {effects.length === 0 ? (
          <div className="panel-placeholder">No pending effects.</div>
        ) : (
          <div className="trust-list">
            {effects.map((effect) => (
              <article className="trust-card" key={effect.id}>
                <div className="trust-card-title">{effect.effect_kind ?? effect.tool ?? effect.effect_id}</div>
                <div className="trust-card-summary">{effect.preview ?? 'Effect preview unavailable.'}</div>
                {renderPendingEffectMetadata(effect)}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="trust-section trust-section--audit">
        <div className="trust-section-header">
          <h3>Audit timeline</h3>
          {selectedRequestId && (
            <button className="secondary-btn" onClick={() => applyAuditFilter(null)}>
              Clear filter
            </button>
          )}
        </div>
        {selectedRequestId && (
          <div className="trust-metadata">Filtered request: {selectedRequestId}</div>
        )}
        {events.length === 0 ? (
          <div className="panel-placeholder">
            {selectedRequestId ? 'No audit events for this request.' : 'No audit events yet.'}
          </div>
        ) : (
          <div className="trust-list">
            {events.map((event) => {
              const requestFilterId = event.requestId ?? event.approval_id;
              return (
                <article className="trust-event" key={event.id}>
                  <span className="trust-event-type">{event.type}</span>
                  <span className="trust-event-time">{new Date(event.ts).toLocaleString()}</span>
                  <div>{event.summary ?? event.toolName ?? event.requestId}</div>
                  {renderTrustMetadata(event.toolName, event.args)}
                  {renderAuditTraceMetadata(event)}
                  {event.decision && <div>Decision: {event.decision}</div>}
                  {event.resultSummary && <div>Result: {event.resultSummary}</div>}
                  {event.error && <div className="trust-event-error">Error: {event.error}</div>}
                  {requestFilterId && (
                    <button
                      className="secondary-btn"
                      onClick={() => applyAuditFilter(requestFilterId)}
                      disabled={selectedRequestId === requestFilterId}
                    >
                      Filter timeline
                    </button>
                  )}
                  {event.undo?.supported ? (
                    <button className="secondary-btn" disabled>Undo planned</button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
