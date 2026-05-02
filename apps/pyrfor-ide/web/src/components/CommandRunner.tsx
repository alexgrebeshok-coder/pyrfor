import React, { useState, useRef, useCallback } from 'react';
import { exec } from '../lib/api';

interface CommandRunnerProps {
  cwd: string;
  collapsed: boolean;
  onToggle: () => void;
  onToast: (msg: string, type?: string, dur?: number) => void;
}

type OutputLine = {
  kind: 'stdout' | 'stderr' | 'meta';
  text: string;
  color?: string;
};

export default function CommandRunner({ cwd, collapsed, onToggle, onToast }: CommandRunnerProps) {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState<OutputLine[]>([]);
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

    setOutput([{ kind: 'meta', text: 'Running…' }]);
    setRunning(true);
    try {
      const data = await exec(cmd, cwd || undefined);
      const lines: OutputLine[] = [];
      if (data.stdout) lines.push({ kind: 'stdout', text: data.stdout });
      if (data.stderr) lines.push({ kind: 'stderr', text: data.stderr });
      const color = data.exitCode === 0 ? 'var(--success)' : 'var(--error)';
      lines.push({
        kind: 'meta',
        text: `exit code ${data.exitCode} · ${data.durationMs}ms`,
        color,
      });
      setOutput(lines.length > 0 ? lines : [{ kind: 'meta', text: 'No output' }]);
    } catch (err: any) {
      setOutput([{ kind: 'stderr', text: err.message }]);
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
              setOutput([]);
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
        >
          {output.map((line, idx) => (
            <span
              key={idx}
              className={`out-${line.kind}`}
              style={{ color: line.color, whiteSpace: 'pre-wrap' }}
            >
              {idx > 0 ? '\n' : ''}
              {line.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
