import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getApiBase } from '../lib/api';

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

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
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
    const base = getApiBase();

    fetch(`${base}/api/pty/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: cwd || '/', cols: term.cols, rows: term.rows }),
    })
      .then((r) => r.json())
      .then((data: { id: string }) => {
        if (cancelled) return;
        const ptyId = data.id;
        ptyIdRef.current = ptyId;

        const wsBase = base.replace(/^http/, 'ws');
        const ws = new WebSocket(`${wsBase}/ws/pty/${ptyId}`);
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
        term.write('Failed to connect to terminal\r\n');
      });

    const ro = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        if (!fitAddonRef.current || !termRef.current || !ptyIdRef.current) return;
        try { fitAddonRef.current.fit(); } catch { /* ignore */ }
        const base2 = getApiBase();
        fetch(`${base2}/api/pty/${ptyIdRef.current}/resize`, {
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
        fetch(`${getApiBase()}/api/pty/${ptyIdRef.current}`, { method: 'DELETE' }).catch(() => {});
        ptyIdRef.current = null;
      }
      try { term.dispose(); } catch { /* ignore */ }
      termRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#1e1e1e', overflow: 'hidden' }}
    />
  );
}
