"use client";

import { useCallback, useEffect, useState } from "react";

interface DaemonHealth {
  status: string;
  uptime?: number;
  version?: string;
  providers?: string[];
  cron?: { jobs: number; nextRun?: string };
}

interface ConnectorStatus {
  name: string;
  status: "connected" | "disconnected" | "error";
  lastSync?: string;
}

export function DaemonStatusWidget() {
  const [health, setHealth] = useState<DaemonHealth | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Try daemon health endpoint
      const daemonRes = await fetch("http://localhost:18790/health", {
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      if (daemonRes?.ok) {
        const data = await daemonRes.json();
        setHealth({
          status: "running",
          uptime: data.uptime,
          version: data.version,
          providers: data.providers,
          cron: data.cron,
        });
      } else {
        setHealth({ status: "offline" });
      }

      // Fetch connector statuses from API
      const connRes = await fetch("/api/connectors").catch(() => null);
      if (connRes?.ok) {
        const data = await connRes.json();
        if (Array.isArray(data.connectors)) {
          setConnectors(
            data.connectors.map((c: Record<string, unknown>) => ({
              name: c.name as string,
              status: c.status as string,
              lastSync: c.lastSync as string | undefined,
            })),
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить статус");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const statusDot = (status: string) => {
    switch (status) {
      case "running":
      case "connected":
        return "bg-green-500";
      case "offline":
      case "disconnected":
        return "bg-gray-400";
      case "error":
        return "bg-red-500";
      default:
        return "bg-yellow-500";
    }
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}ч ${m}м` : `${m}м`;
  };

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Daemon & Коннекторы</h3>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {loading ? "..." : "↻ Обновить"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-500">{error}</p>
      )}

      {/* Daemon status */}
      <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted/50 p-3">
        <div className={`h-2.5 w-2.5 rounded-full ${statusDot(health?.status ?? "offline")}`} />
        <div className="flex-1">
          <div className="text-sm font-medium">
            CEOClaw Daemon
            {health?.version && <span className="ml-2 text-xs text-muted-foreground">v{health.version}</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {health?.status === "running" ? (
              <>Работает • Uptime: {formatUptime(health.uptime)}</>
            ) : (
              "Не запущен — запустите: npm run daemon"
            )}
          </div>
        </div>
        {health?.cron && (
          <span className="text-xs text-muted-foreground">
            {health.cron.jobs} cron задач
          </span>
        )}
      </div>

      {/* Connectors */}
      {connectors.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Коннекторы
          </div>
          {connectors.map((c) => (
            <div key={c.name} className="flex items-center gap-2 text-sm">
              <div className={`h-2 w-2 rounded-full ${statusDot(c.status)}`} />
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {c.status === "connected" ? "✓" : c.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
