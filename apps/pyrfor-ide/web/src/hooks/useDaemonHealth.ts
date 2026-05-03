import { useEffect, useRef, useState } from 'react';
import { getDaemonPort } from '../lib/api';
import { apiEvents, resetDaemonPortCache } from '../lib/apiFetch';

export type DaemonHealth = 'connected' | 'reconnecting' | 'offline';

export interface DaemonHealthState {
  status: DaemonHealth;
  lastOk: number | null;
}

export function useDaemonHealth(intervalMs = 5000): DaemonHealthState {
  const [state, setState] = useState<DaemonHealthState>({ status: 'reconnecting', lastOk: null });
  const failuresRef = useRef(0);

  // React immediately to retry/recovered events emitted by daemonFetch so we
  // don't have to wait for the next /health poll to update the status.
  useEffect(() => {
    function onRetry(event: Event) {
      const error = (event as CustomEvent<{ error?: unknown }>).detail?.error;
      if (error instanceof TypeError) resetDaemonPortCache();
      setState((prev) => ({
        status: failuresRef.current >= 3 ? 'offline' : 'reconnecting',
        lastOk: prev.lastOk,
      }));
    }

    function onRecovered() {
      failuresRef.current = 0;
      setState({ status: 'connected', lastOk: Date.now() });
    }

    apiEvents.addEventListener('retry', onRetry);
    apiEvents.addEventListener('recovered', onRecovered);
    return () => {
      apiEvents.removeEventListener('retry', onRetry);
      apiEvents.removeEventListener('recovered', onRecovered);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    let unlisten: Array<() => void> = [];
    let disposed = false;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const handlers = await Promise.all([
        listen('daemon:ready', () => {
          resetDaemonPortCache();
          failuresRef.current = 0;
        }),
        listen('daemon:restarting', () => {
          resetDaemonPortCache();
          setState((prev) => ({ status: 'reconnecting', lastOk: prev.lastOk }));
        }),
        listen('daemon:fatal', () => {
          resetDaemonPortCache();
          setState((prev) => ({ status: 'offline', lastOk: prev.lastOk }));
        }),
      ]);
      if (disposed) handlers.forEach((fn) => fn());
      else unlisten = handlers;
    }).catch(() => {
      // Non-Tauri tests/dev browsers can ignore native daemon events.
    });
    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const port = await getDaemonPort();
        const res = await fetch(`http://localhost:${port}/health`);
        if (!cancelled) {
          if (res.ok || res.status < 600) {
            // Any HTTP response means the daemon is reachable
            failuresRef.current = 0;
            setState({ status: 'connected', lastOk: Date.now() });
          } else {
            throw new Error('non-ok');
          }
        }
      } catch {
        if (!cancelled) {
          failuresRef.current += 1;
          if (failuresRef.current >= 2) resetDaemonPortCache();
          setState((prev) => ({
            status: failuresRef.current >= 3 ? 'offline' : 'reconnecting',
            lastOk: prev.lastOk,
          }));
        }
      }
    }

    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return state;
}
