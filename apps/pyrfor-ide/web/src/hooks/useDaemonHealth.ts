import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  apiEvents,
  probeDaemonHealth,
  resetDaemonPortCache,
  seedDaemonPort,
} from '../lib/apiFetch';
import { list as offlineQueueList } from '../lib/offlineQueue';

export type DaemonHealth = 'connected' | 'reconnecting' | 'offline';

export interface DaemonHealthState {
  status: DaemonHealth;
  lastOk: number | null;
}

function markConnected(
  failuresRef: MutableRefObject<number>,
  setState: Dispatch<SetStateAction<DaemonHealthState>>,
  emitRecovered: boolean,
) {
  if (emitRecovered && (failuresRef.current > 0 || offlineQueueList().length > 0)) {
    apiEvents.dispatchEvent(new CustomEvent('recovered'));
  }
  failuresRef.current = 0;
  setState({ status: 'connected', lastOk: Date.now() });
}

export function useDaemonHealth(intervalMs = 5000): DaemonHealthState {
  const [state, setState] = useState<DaemonHealthState>({ status: 'reconnecting', lastOk: null });
  const failuresRef = useRef(0);

  useEffect(() => {
    function onRetry(event: Event) {
      const error = (event as CustomEvent<{ error?: unknown }>).detail?.error;
      if (error instanceof TypeError) resetDaemonPortCache();
      void probeDaemonHealth().then((ok) => {
        if (ok) {
          markConnected(failuresRef, setState, true);
          return;
        }
        setState((prev) => ({
          status: failuresRef.current >= 8 ? 'offline' : 'reconnecting',
          lastOk: prev.lastOk,
        }));
      });
    }

    function onRecovered() {
      markConnected(failuresRef, setState, false);
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
        listen<number>('daemon:ready', (event) => {
          const port = event.payload;
          if (typeof port === 'number' && port > 0) {
            seedDaemonPort(port);
          }
          markConnected(failuresRef, setState, true);
        }),
        listen('daemon:restarting', () => {
          resetDaemonPortCache();
          setState((prev) => ({ status: 'reconnecting', lastOk: prev.lastOk }));
        }),
        listen('daemon:fatal', () => {
          resetDaemonPortCache();
          void probeDaemonHealth().then((ok) => {
            if (ok) {
              markConnected(failuresRef, setState, true);
            } else {
              setState((prev) => ({ status: 'offline', lastOk: prev.lastOk }));
            }
          });
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
        const ok = await probeDaemonHealth();
        if (!cancelled) {
          if (ok) {
            markConnected(failuresRef, setState, failuresRef.current > 0);
          } else {
            throw new Error('daemon unreachable');
          }
        }
      } catch {
        if (!cancelled) {
          failuresRef.current += 1;
          if (failuresRef.current >= 5) resetDaemonPortCache();
          setState((prev) => ({
            status: failuresRef.current >= 8 ? 'offline' : 'reconnecting',
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
