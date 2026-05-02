import React, { useCallback, useEffect, useState } from 'react';
import {
  getDashboard,
  getOverlay,
  getRun,
  listOverlays,
  listRunDag,
  listRunEvents,
  listRuns,
  type AuditEvent,
  type DagNode,
  type DomainOverlayManifest,
  type OrchestrationDashboard,
  type RunRecord,
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
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nodes, setNodes] = useState<DagNode[]>([]);
  const [overlays, setOverlays] = useState<DomainOverlayManifest[]>([]);
  const [selectedOverlay, setSelectedOverlay] = useState<DomainOverlayManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRun = useCallback(async (runId: string) => {
    const [runResult, eventResult, dagResult] = await Promise.all([
      getRun(runId),
      listRunEvents(runId),
      listRunDag(runId),
    ]);
    setSelectedRun(runResult.run);
    setEvents(eventResult.events);
    setNodes(dagResult.nodes);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboardResult, runsResult, overlaysResult] = await Promise.all([
        getDashboard(),
        listRuns(),
        listOverlays(),
      ]);
      setDashboard(dashboardResult.orchestration ?? null);
      setRuns(runsResult.runs);
      setOverlays(overlaysResult.overlays);
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
  const adapterCount = selectedOverlay ? asArray(selectedOverlay['adapters']).length : 0;

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
            <SummaryCard label="Verifier" value={`${dashboard.verifier.blocked} blocked`} />
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
            <pre>{compactJson(selectedOverlay)}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
