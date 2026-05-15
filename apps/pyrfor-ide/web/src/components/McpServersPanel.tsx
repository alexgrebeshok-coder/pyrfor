import React, { useCallback, useEffect, useState } from 'react';
import { ApiError, getMcpStatus, postMcpServerRestart, type McpServerStatus } from '../lib/api';

export default function McpServersPanel() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMcpStatus();
      setServers(res.servers);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load MCP status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const onRestart = useCallback(
    async (name: string) => {
      setRestarting(name);
      setError(null);
      try {
        await postMcpServerRestart(name);
        await refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'MCP restart failed');
      } finally {
        setRestarting(null);
      }
    },
    [refresh],
  );

  return (
    <div className="mcp-status-panel" data-testid="mcp-servers-panel">
      <div className="mcp-status-toolbar">
        <button type="button" className="secondary-btn" onClick={() => void refresh()} data-testid="mcp-refresh">
          Refresh
        </button>
        {loading && <span className="telemetry-panel-muted">Loading…</span>}
      </div>
      <p className="mcp-status-hint">
        Status from the runtime MCP client. Use Restart to reconnect a server without restarting the engine.
        Endpoints and secrets are not shown here. Configure MCP servers in your engine / daemon setup.
      </p>
      {error && (
        <div className="telemetry-panel-error" data-testid="mcp-error">
          {error}
        </div>
      )}
      <div className="telemetry-table-wrap">
        <table className="telemetry-table">
          <thead>
            <tr>
              <th>Server</th>
              <th>Connected</th>
              <th>Tools (cached)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 && !error && (
              <tr>
                <td colSpan={4} className="telemetry-panel-muted">No MCP servers registered in this process.</td>
              </tr>
            )}
            {servers.map((s) => (
              <tr key={s.name} data-mcp-server={s.name}>
                <td>{s.name}</td>
                <td>
                  <span className={s.connected ? 'mcp-pill mcp-pill--ok' : 'mcp-pill mcp-pill--off'}>
                    {s.connected ? 'yes' : 'no'}
                  </span>
                </td>
                <td>{s.toolCount}</td>
                <td>
                  <button
                    type="button"
                    className="secondary-btn"
                    data-testid={`mcp-restart-${s.name}`}
                    disabled={restarting !== null}
                    onClick={() => void onRestart(s.name)}
                  >
                    {restarting === s.name ? 'Restarting…' : 'Restart'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
