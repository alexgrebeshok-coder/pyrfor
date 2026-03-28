"use client";

import { useCallback, useEffect, useRef } from "react";

type SSEEvent = {
  event: string;
  data: Record<string, unknown>;
};

type SSEOptions = {
  /** Called on each incoming event */
  onEvent?: (event: SSEEvent) => void;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Events to listen for (default: all) */
  events?: string[];
};

/**
 * Hook to subscribe to the CEOClaw SSE endpoint.
 * Automatically reconnects on disconnect.
 */
export function useSSE(options: SSEOptions = {}) {
  const { onEvent, autoReconnect = true, events } = options;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const esRef = useRef<EventSource>();

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    const es = new EventSource("/api/sse");
    esRef.current = es;

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        onEventRef.current?.({ event: e.type, data });
      } catch { /* non-JSON event */ }
    };

    if (events && events.length > 0) {
      events.forEach((ev) => es.addEventListener(ev, handleEvent));
    } else {
      // Listen for common events
      for (const ev of [
        "connected",
        "task_created",
        "task_updated",
        "project_updated",
        "approval_created",
        "approval_reviewed",
      ]) {
        es.addEventListener(ev, handleEvent);
      }
    }

    es.onerror = () => {
      es.close();
      if (autoReconnect) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };
  }, [autoReconnect, events]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      esRef.current?.close();
    };
  }, [connect]);
}
