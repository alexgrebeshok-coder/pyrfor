import React, { useCallback, useEffect, useState } from 'react';
import { ApiError, getTelemetrySpans, type TelemetrySpan } from '../lib/api';

function spanCategory(name: string): 'lifecycle' | 'llm' | 'tool' | 'other' {
  if (name.startsWith('lifecycle.')) return 'lifecycle';
  if (name === 'llm.chat') return 'llm';
  if (name.startsWith('tool.')) return 'tool';
  return 'other';
}

export default function TraceTimeline() {
  const [spans, setSpans] = useState<TelemetrySpan[]>([]);
  const [limit, setLimit] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTelemetrySpans(limit);
      setSpans(res.spans);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load spans');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="telemetry-panel" data-testid="trace-timeline">
      <div className="telemetry-panel-toolbar">
        <label className="telemetry-panel-limit">
          Limit
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            data-testid="trace-limit-select"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
        </label>
        <button type="button" className="secondary-btn" onClick={() => void refresh()} data-testid="trace-refresh">
          Refresh
        </button>
        {loading && <span className="telemetry-panel-muted">Loading…</span>}
      </div>
      {error && (
        <div className="telemetry-panel-error" data-testid="trace-error">
          {error}
        </div>
      )}
      <div className="telemetry-table-wrap">
        <table className="telemetry-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Trace</th>
            </tr>
          </thead>
          <tbody>
            {spans.length === 0 && !error && (
              <tr>
                <td colSpan={4} className="telemetry-panel-muted">No spans yet.</td>
              </tr>
            )}
            {spans.map((s) => (
              <tr key={s.id} data-span-name={s.name}>
                <td>
                  <span
                    className={`telemetry-name telemetry-name--${spanCategory(s.name)}`}
                    title={JSON.stringify(s.attrs)}
                  >
                    {s.name}
                  </span>
                </td>
                <td>{s.durationMs} ms</td>
                <td>{s.status}</td>
                <td className="telemetry-traceid">{s.traceId.slice(0, 8)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
