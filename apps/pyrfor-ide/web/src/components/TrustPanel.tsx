import React, { useCallback, useEffect, useState } from 'react';
import {
  decideApproval,
  listAuditEvents,
  listPendingApprovals,
  streamOperatorEvents,
  type ApprovalRequest,
  type AuditEvent,
} from '../lib/api';

interface TrustPanelProps {
  onToast?: (message: string, type?: string) => void;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '-';
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
  return <pre>{compactJson(args)}</pre>;
}

export default function TrustPanel({ onToast }: TrustPanelProps) {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingResult, auditResult] = await Promise.all([
        listPendingApprovals(),
        listAuditEvents(50),
      ]);
      setPending(pendingResult.approvals);
      setEvents(auditResult.events);
    } catch (error) {
      onToast?.(`Trust data unavailable: ${String(error)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

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
          if (event.approvals) setPending(event.approvals);
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
                <div className="trust-actions">
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

      <section className="trust-section trust-section--audit">
        <h3>Audit timeline</h3>
        {events.length === 0 ? (
          <div className="panel-placeholder">No audit events yet.</div>
        ) : (
          <div className="trust-list">
            {events.map((event) => (
              <article className="trust-event" key={event.id}>
                <span className="trust-event-type">{event.type}</span>
                <span className="trust-event-time">{new Date(event.ts).toLocaleString()}</span>
                <div>{event.summary ?? event.toolName ?? event.requestId}</div>
                {renderTrustMetadata(event.toolName, event.args)}
                {event.decision && <div>Decision: {event.decision}</div>}
                {event.resultSummary && <div>Result: {event.resultSummary}</div>}
                {event.error && <div className="trust-event-error">Error: {event.error}</div>}
                {event.undo?.supported ? (
                  <button className="secondary-btn" disabled>Undo planned</button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
