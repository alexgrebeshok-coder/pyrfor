"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Bot, CheckCircle, XCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ── Types ──

type FeedEvent = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  receivedAt: Date;
};

const EVENT_ICONS: Record<string, typeof Bot> = {
  agent_run_started: Zap,
  agent_run_completed: CheckCircle,
  agent_run_failed: XCircle,
  agent_status_changed: Bot,
  agent_budget_exceeded: Activity,
};

const EVENT_COLORS: Record<string, "info" | "success" | "danger" | "warning" | "neutral"> = {
  agent_run_started: "info",
  agent_run_completed: "success",
  agent_run_failed: "danger",
  agent_status_changed: "neutral",
  agent_budget_exceeded: "warning",
};

// ── Toast dedup ──

const recentToasts = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000;

export function shouldShowToast(key: string): boolean {
  const now = Date.now();
  const last = recentToasts.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  recentToasts.set(key, now);
  if (recentToasts.size > 100) {
    for (const [k, v] of recentToasts) {
      if (now - v > DEDUP_WINDOW_MS * 2) recentToasts.delete(k);
    }
  }
  return true;
}

// ── Component ──

const AGENT_EVENTS = [
  "agent_run_started",
  "agent_run_completed",
  "agent_run_failed",
  "agent_status_changed",
  "agent_budget_exceeded",
];

interface LiveAgentFeedProps {
  maxItems?: number;
  compact?: boolean;
  onEvent?: (event: FeedEvent) => void;
}

export function LiveAgentFeed({
  maxItems = 20,
  compact = false,
  onEvent,
}: LiveAgentFeedProps) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const handleEvent = useCallback(
    (type: string, data: Record<string, unknown>) => {
      const ev: FeedEvent = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        data,
        receivedAt: new Date(),
      };

      setEvents((prev) => [ev, ...prev].slice(0, maxItems));
      onEvent?.(ev);
    },
    [maxItems, onEvent]
  );

  useEffect(() => {
    const es = new EventSource("/api/sse");
    esRef.current = es;

    es.addEventListener("connected", () => setConnected(true));
    es.onerror = () => setConnected(false);

    for (const eventType of AGENT_EVENTS) {
      es.addEventListener(eventType, (e) => {
        try {
          const data = JSON.parse(e.data);
          handleEvent(eventType, data);
        } catch { /* skip malformed */ }
      });
    }

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [handleEvent]);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
        />
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {connected ? "Live" : "Disconnected"} · {events.length} events
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
        />
        <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
          {connected ? "Live Feed" : "Reconnecting…"}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          Waiting for agent events…
        </p>
      ) : (
        events.map((ev) => {
          const Icon = EVENT_ICONS[ev.type] ?? Bot;
          const color = EVENT_COLORS[ev.type] ?? "neutral";
          return (
            <div
              key={ev.id}
              className="flex items-start gap-2 rounded border px-2 py-1.5"
              style={{ borderColor: "var(--line)" }}
            >
              <Icon size={14} className="mt-0.5 shrink-0" style={{ color: "var(--ink-soft)" }} />
              <div className="flex-1 text-xs">
                <Badge variant={color} className="mr-1 text-xs">
                  {ev.type.replace("agent_", "").replace(/_/g, " ")}
                </Badge>
                <span style={{ color: "var(--ink)" }}>
                  {(ev.data.agentName as string) ?? (ev.data.agentId as string) ?? ""}
                </span>
                {ev.data.error ? (
                  <span className="ml-1" style={{ color: "var(--danger, #ef4444)" }}>
                    {String(ev.data.error).slice(0, 80)}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 text-xs" style={{ color: "var(--ink-muted)" }}>
                {ev.receivedAt.toLocaleTimeString()}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
