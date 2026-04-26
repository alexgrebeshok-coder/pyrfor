import { useEffect, useRef, useState } from 'react';
import { getDaemonPort } from '../lib/api';
import { apiEvents } from '../lib/apiFetch';

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
    function onRetry() {
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
