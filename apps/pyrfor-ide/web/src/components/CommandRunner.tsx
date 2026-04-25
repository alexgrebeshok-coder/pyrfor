import React, { useState, useRef, useCallback } from 'react';
import { exec } from '../lib/api';

interface CommandRunnerProps {
  cwd: string;
  collapsed: boolean;
  onToggle: () => void;
  onToast: (msg: string, type?: string, dur?: number) => void;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function CommandRunner({ cwd, collapsed, onToggle, onToast }: CommandRunnerProps) {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('pyrfor-cmd-history') || '[]');
    } catch {
      return [];
    }
  });
  const [historyIdx, setHistoryIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd) return;
    const newHistory = [cmd, ...history.filter((c) => c !== cmd)].slice(0, 20);
    setHistory(newHistory);
    setHistoryIdx(-1);
    localStorage.setItem('pyrfor-cmd-history', JSON.stringify(newHistory));

    setOutput('<span class="out-meta">Running…</span>');
    setRunning(true);
    try {
      const data = await exec(cmd, cwd || undefined);
      let html = '';
      if (data.stdout) html += `<span class="out-stdout">${escapeHtml(data.stdout)}</span>`;
      if (data.stderr) html += `<span class="out-stderr">${escapeHtml(data.stderr)}</span>`;
      const color = data.exitCode === 0 ? 'var(--success)' : 'var(--error)';
      html += `\n<span class="out-meta" style="color:${color}">exit code ${data.exitCode} · ${data.durationMs}ms</span>`;
      setOutput(html || '<span class="out-meta">No output</span>');
    } catch (err: any) {
      setOutput(`<span class="out-stderr">${escapeHtml(err.message)}</span>`);
      onToast(`Exec error: ${err.message}`, 'error');
    } finally {
      setRunning(false);
    }
  }, [command, cwd, history, onToast]);

  return (
    <div className={`runner-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="runner-header" onClick={onToggle}>
        <span>Terminal</span>
        <div className="runner-header-actions">
          <button
            className="icon-btn"
            title="Clear output"
            onClick={(e) => {
              e.stopPropagation();
              setOutput('');
            }}
          >
            ✕
          </button>
          <button
            className="icon-btn"
            title="Toggle (Ctrl+`)"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>
      <div className="runner-body">
        <div className="runner-input-row">
          <textarea
            className="runner-input"
            placeholder="npm test, ls -la, …"
            rows={1}
            autoComplete="off"
            spellCheck={false}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run();
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (historyIdx < history.length - 1) {
                  const idx = historyIdx + 1;
                  setHistoryIdx(idx);
                  setCommand(history[idx] || '');
                }
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIdx > 0) {
                  const idx = historyIdx - 1;
                  setHistoryIdx(idx);
                  setCommand(history[idx] || '');
                } else {
                  setHistoryIdx(-1);
                  setCommand('');
                }
              }
            }}
          />
          <button className="btn btn-sm" disabled={running} onClick={run}>
            Run
          </button>
        </div>
        <div
          ref={outputRef}
          className="runner-output"
          aria-live="polite"
          dangerouslySetInnerHTML={{ __html: output }}
        />
      </div>
    </div>
  );
}
