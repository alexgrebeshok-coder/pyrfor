import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { daemonFetch, getApiBase, getStoredBearerToken } from '../lib/apiFetch';
import { useDaemonHealth } from '../hooks/useDaemonHealth';

interface TerminalProps {
  cwd: string;
  onClose?: () => void;
}

export default function Terminal({ cwd }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const { status: daemonStatus } = useDaemonHealth();

  useEffect(() => {
    if (!containerRef.current || daemonStatus !== 'connected') return;
    setTerminalError(null);
    const rootStyles = getComputedStyle(document.documentElement);

    const term = new XTerm({
      theme: {
        background: rootStyles.getPropertyValue('--bg-primary').trim() || '#1e1f26',
        foreground: rootStyles.getPropertyValue('--text-primary').trim() || '#e4e4e7',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    try { fitAddon.fit(); } catch { /* container may have 0 size */ }
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    let cancelled = false;
    daemonFetch('/api/pty/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: cwd || '/', cols: term.cols, rows: term.rows }),
    })
      .then((r) => r.json())
      .then(async (data: { id: string }) => {
        if (cancelled) return;
        const ptyId = data.id;
        ptyIdRef.current = ptyId;

        const wsBase = getApiBase().replace(/^http/, 'ws');
        const wsUrl = new URL(`${wsBase}/ws/pty/${ptyId}`);
        const token = await getStoredBearerToken();
        if (token) wsUrl.searchParams.set('token', token);
        const ws = new WebSocket(wsUrl.toString());
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.addEventListener('open', () => {
          term.focus();
        });

        ws.addEventListener('message', (e) => {
          const data =
            e.data instanceof ArrayBuffer
              ? new TextDecoder().decode(e.data)
              : (e.data as string);
          term.write(data);
        });

        ws.addEventListener('close', () => {
          term.write('\r\n[disconnected]\r\n');
        });

        term.onData((d) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(d);
        });
      })
      .catch(() => {
        setTerminalError('Failed to connect to terminal. Check daemon health and try again.');
      });

    const ro = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        if (!fitAddonRef.current || !termRef.current || !ptyIdRef.current) return;
        try { fitAddonRef.current.fit(); } catch { /* ignore */ }
        daemonFetch(`/api/pty/${ptyIdRef.current}/resize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: termRef.current.cols, rows: termRef.current.rows }),
        }).catch(() => {});
      }, 100);
    });

    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      cancelled = true;
      ro.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      if (ptyIdRef.current) {
        daemonFetch(`/api/pty/${ptyIdRef.current}`, { method: 'DELETE' }).catch(() => {});
        ptyIdRef.current = null;
      }
      try { term.dispose(); } catch { /* ignore */ }
      termRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, daemonStatus]);

  const overlayMessage =
    terminalError ??
    (daemonStatus === 'offline'
      ? 'Daemon offline — terminal will reconnect automatically when the local runtime is back.'
      : daemonStatus === 'reconnecting'
      ? 'Starting local daemon… terminal will connect automatically.'
      : null);

  return (
    <div className="terminal-shell">
      {overlayMessage && (
        <div
          className={`terminal-overlay${terminalError ? ' terminal-overlay--error' : ''}`}
          role="status"
        >
          {overlayMessage}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--bg-primary)',
          overflow: 'hidden',
          opacity: overlayMessage ? 0.45 : 1,
        }}
      />
    </div>
  );
}
